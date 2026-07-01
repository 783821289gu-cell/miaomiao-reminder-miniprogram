const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const GLOBAL_LOG_LIMIT = 5000;
const USER_LOG_LIMIT = 100;
const REMINDER_DIRTY_LIMIT = 100;
const REMINDER_STALE_GRACE_MS = 10 * 60 * 1000;
const ID_PAGE_SIZE = 100;
const REMOVE_CONCURRENCY = 20;
const MAX_EXPIRED_DELETE_PASSES = 100;

function isMissingCollection(error) {
  return /COLLECTION_NOT_EXIST|DATABASE_COLLECTION_NOT_EXIST|Db or Table not exist|collection.*not exist/i
    .test(String((error && (error.errMsg || error.message)) || error || ""));
}

function removedCount(result) {
  return Number(result && result.stats && result.stats.removed) || 0;
}

async function countLogs() {
  const result = await db.collection("aiLogs").count();
  return Number(result.total) || 0;
}

async function removeIds(collectionName, ids) {
  let removed = 0;
  for (let offset = 0; offset < ids.length; offset += REMOVE_CONCURRENCY) {
    const batch = ids.slice(offset, offset + REMOVE_CONCURRENCY);
    const results = await Promise.all(batch.map((id) => (
      db.collection(collectionName).doc(id).remove()
    )));
    removed += results.reduce((total, result) => total + removedCount(result), 0);
  }
  return removed;
}

async function removeExpired(cutoff) {
  let removed = 0;
  for (let pass = 0; pass < MAX_EXPIRED_DELETE_PASSES; pass += 1) {
    const result = await db.collection("aiLogs")
      .where({ createdAt: _.lt(cutoff) })
      .remove();
    const current = removedCount(result);
    removed += current;
    if (!current) break;
  }
  return removed;
}

async function listOverLimitOwners() {
  const result = await db.collection("aiLogs")
    .aggregate()
    .sortByCount("$_openid")
    .match({ count: _.gt(USER_LOG_LIMIT) })
    .end();
  return (result.list || result.data || [])
    .filter((item) => item && item._id && Number(item.count) > USER_LOG_LIMIT);
}

async function listOldestIds(collectionName, where, limit, sortField) {
  const result = await db.collection(collectionName)
    .where(where || {})
    .field({ _id: true })
    .orderBy(sortField || "createdAt", "asc")
    .limit(Math.min(ID_PAGE_SIZE, Math.max(1, Number(limit) || ID_PAGE_SIZE)))
    .get();
  return (result.data || []).map((item) => item._id).filter(Boolean);
}

async function removeOldest(collectionName, where, count, sortField) {
  let remaining = Math.max(0, Number(count) || 0);
  let removed = 0;
  while (remaining > 0) {
    const ids = await listOldestIds(collectionName, where, remaining, sortField);
    if (!ids.length) break;
    const current = await removeIds(collectionName, ids);
    removed += current;
    remaining -= ids.length;
    if (!current) break;
  }
  return removed;
}

async function trimPerUser() {
  const owners = await listOverLimitOwners();
  let removed = 0;
  for (let index = 0; index < owners.length; index += 1) {
    const owner = owners[index];
    removed += await removeOldest(
      "aiLogs",
      { _openid: owner._id },
      Number(owner.count) - USER_LOG_LIMIT,
    );
  }
  return { removed, owners: owners.length };
}

async function trimGlobal() {
  const total = await countLogs();
  if (total <= GLOBAL_LOG_LIMIT) return { removed: 0, before: total };
  return {
    removed: await removeOldest("aiLogs", {}, total - GLOBAL_LOG_LIMIT),
    before: total,
  };
}

function buildDirtyReminderCondition(now) {
  return _.or([
    { status: _.in(["sent", "failed", "cancelled"]) },
    {
      status: _.in(["pending", "processing"]),
      remindAtTs: _.lt(now - REMINDER_STALE_GRACE_MS),
    },
  ]);
}

async function cleanupReminderJobs(now) {
  try {
    const condition = buildDirtyReminderCondition(now);
    const countResult = await db.collection("reminderJobs").where(condition).count();
    const dirty = Number(countResult.total) || 0;
    if (dirty <= REMINDER_DIRTY_LIMIT) {
      return { dirty, kept: dirty, removed: 0 };
    }
    const removed = await removeOldest(
      "reminderJobs",
      condition,
      dirty - REMINDER_DIRTY_LIMIT,
      "updatedAt",
    );
    return {
      dirty,
      kept: Math.max(0, dirty - removed),
      removed,
    };
  } catch (error) {
    if (isMissingCollection(error)) return { dirty: 0, kept: 0, removed: 0 };
    throw error;
  }
}

exports.main = async () => {
  const startedAt = Date.now();
  try {
    const before = await countLogs();
    const expiredRemoved = await removeExpired(startedAt - RETENTION_MS);
    const perUser = await trimPerUser();
    const global = await trimGlobal();
    const after = await countLogs();
    const reminderJobs = await cleanupReminderJobs(startedAt);
    return {
      ok: true,
      before,
      after,
      removed: before - after,
      removedByRule: {
        expired: expiredRemoved,
        perUser: perUser.removed,
        global: global.removed,
      },
      overLimitOwners: perUser.owners,
      reminderJobs,
      limits: {
        global: GLOBAL_LOG_LIMIT,
        perUser: USER_LOG_LIMIT,
        retentionDays: 30,
        reminderDirty: REMINDER_DIRTY_LIMIT,
        reminderStaleMinutes: REMINDER_STALE_GRACE_MS / 60000,
      },
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (isMissingCollection(error)) {
      return { ok: true, before: 0, after: 0, removed: 0 };
    }
    throw error;
  }
};

exports._test = {
  removedCount,
  buildDirtyReminderCondition,
};
