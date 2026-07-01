const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatChinaDateTime(timestamp) {
  const date = new Date(Number(timestamp || Date.now()) + 8 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function formatDateField(job) {
  return `${job.targetDate || ""}${job.targetTime ? ` ${job.targetTime}` : ""}`.slice(0, 20);
}

function calcRemainingDays(targetDate) {
  const target = new Date(targetDate + "T00:00:00+08:00");
  const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function formatReminderField(job) {
  const match = String(job.remindAt || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})$/);
  if (!match) return String(job.remindAt || "").slice(0, 20);
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日 ${match[4]}`;
}

function truncateThing(value) {
  return Array.from(String(value || "重要日")).slice(0, 20).join("");
}

function errorDetails(error) {
  const code = error && error.errCode !== undefined ? error.errCode : (error && error.code) || "send_failed";
  return {
    code: String(code),
    message: String((error && (error.errMsg || error.message)) || error || "发送失败"),
  };
}

function isRetryable(error) {
  const detail = errorDetails(error);
  const text = `${detail.code} ${detail.message}`;
  if (/40037|41030|43101|47003|template_missing|invalid template|user refuse/i.test(text)) return false;
  return /45009|frequency|rate limit|timeout|network|system error|Invalid wxCloudApiToken|-501007|-1\b|-500\b|-502\b|-503\b/i.test(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransactionConflict(error) {
  const detail = errorDetails(error);
  return /TransactionConflict|DATABASE_TRANSACTION_CONFLICT|-501001/i.test(`${detail.code} ${detail.message}`);
}

async function listDueJobs(now) {
  try {
    const result = await db.collection("reminderJobs")
      .where({ status: _.in(["pending", "processing"]), remindAtTs: _.lte(now) })
      .orderBy("remindAtTs", "asc")
      .limit(20)
      .get();
    return result.data || [];
  } catch (error) {
    try {
      const fallback = await db.collection("reminderJobs").limit(100).get();
      return (fallback.data || [])
        .filter((job) => Number(job.remindAtTs) <= now && (job.status === "pending" || job.status === "processing"))
        .sort((left, right) => Number(left.remindAtTs) - Number(right.remindAtTs))
        .slice(0, 20);
    } catch (fallbackError) {
      if (/COLLECTION_NOT_EXIST|DATABASE_COLLECTION_NOT_EXIST|Db or Table not exist|collection.*not exist/i
        .test(String((fallbackError && (fallbackError.errMsg || fallbackError.message)) || fallbackError || ""))) {
        await db.createCollection("reminderJobs").catch(() => {});
        return [];
      }
      throw fallbackError;
    }
  }
}

async function isJobStillActive(job) {
  const result = await db.collection("events")
    .where({ _openid: job._openid, id: job.eventId })
    .limit(1)
    .get();
  const event = result.data && result.data[0];
  if (!event) return false;
  const plan = (Array.isArray(event.reminderPlan) ? event.reminderPlan : [])
    .find((item) => String(item.id) === String(job.planId));
  return !!(plan
    && plan.subscribed
    && plan.remindAt
    && !plan.sentAt
    && String(plan.remindAt) === String(job.remindAt)
    && String(plan.templateId || "") === String(job.templateId || ""));
}

async function claimJob(job, now) {
  try {
    return await db.runTransaction(async (transaction) => {
      const ref = transaction.collection("reminderJobs").doc(job._id);
      const snapshot = await ref.get();
      const current = snapshot.data;
      const staleProcessing = current
        && current.status === "processing"
        && Number(current.processingAt || 0) < now - 2 * 60 * 1000;
      if (!current || (current.status !== "pending" && !staleProcessing) || Number(current.remindAtTs) > now) return null;
      const attempts = Number(current.attempts || 0) + 1;
      await ref.update({
        data: {
          status: "processing",
          processingAt: now,
          sendAttemptAt: now,
          attempts,
          updatedAt: now,
        },
      });
      return Object.assign({}, current, { attempts, processingAt: now, sendAttemptAt: now });
    });
  } catch (error) {
    if (isTransactionConflict(error)) return null;
    throw error;
  }
}

async function updateEventPlan(job, patch) {
  const result = await db.collection("events").where({ _openid: job._openid, id: job.eventId }).limit(1).get();
  const event = result.data && result.data[0];
  if (!event) throw new Error("reminder event not found");
  const plan = (Array.isArray(event.reminderPlan) ? event.reminderPlan : []).map((item) => (
    String(item.id) === String(job.planId) ? Object.assign({}, item, patch) : item
  ));
  const first = plan.find((item) => item.remindAt && !item.sentAt) || {};
  await db.collection("events").doc(event._id).update({
    data: {
      reminderPlan: plan,
      reminder: Object.assign({}, event.reminder || {}, {
        enabled: plan.some((item) => item.remindAt && !item.sentAt),
        remindAt: first.remindAt || "",
        subscribed: plan.some((item) => item.subscribed && !item.sentAt),
        sentAt: patch.sentAt || (event.reminder && event.reminder.sentAt) || "",
        lastError: patch.lastError || "",
      }),
      lastReminderTriggeredAt: patch.sentAt || event.lastReminderTriggeredAt || "",
      lastReminderPlanId: patch.sentAt ? String(job.planId || "") : (event.lastReminderPlanId || ""),
      updatedAt: Date.now(),
    },
  });
}

async function retry(action, attempts) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function markJob(jobId, data) {
  return db.collection("reminderJobs").doc(jobId).update({ data: Object.assign({}, data, { updatedAt: Date.now() }) });
}

async function sendJob(job, now) {
  const claimed = await claimJob(job, now);
  if (!claimed) return { skipped: true };
  let delivered = false;
  let deliveredResult = null;
  try {
    const active = await isJobStillActive(claimed);
    if (!active) {
      await markJob(job._id, { status: "cancelled", processingAt: 0 });
      return { skipped: true, cancelled: true };
    }
    if (!String(claimed.templateId || "").trim()) {
      const error = new Error("提醒模板 ID 缺失");
      error.code = "template_missing";
      throw error;
    }
    const sendResult = await cloud.openapi.subscribeMessage.send({
      touser: claimed._openid,
      templateId: claimed.templateId,
      page: "pages/index/index",
      data: {
        thing2: { value: truncateThing(claimed.title) },
        date4: { value: formatDateField(claimed) },
        // number42: { value: String(Math.max(0, Number(claimed.remainingDays) || 0)) },
        number42: { value: String(Math.max(0, calcRemainingDays(claimed.targetDate))) },
        time25: { value: formatReminderField(claimed) },
      },
    });
    delivered = true;
    deliveredResult = sendResult || null;
    const sentAt = formatChinaDateTime(now);
    await retry(() => updateEventPlan(claimed, { sentAt, lastError: "" }), 3);
    await db.collection("reminderJobs").doc(job._id).remove();
    return { sent: true, eventId: claimed.eventId, planId: claimed.planId, sendResult, jobRemoved: true };
  } catch (error) {
    if (delivered) {
      await markJob(job._id, {
        status: "sent",
        sentAt: now,
        processingAt: 0,
        sendResult: deliveredResult,
        errorMessage: "消息已发送，但事件状态回写失败",
      }).catch(() => {});
      return { sent: true, eventId: claimed.eventId, planId: claimed.planId, sendResult: deliveredResult, bookkeepingError: true };
    }
    const detail = errorDetails(error);
    const retry = isRetryable(error) && Number(claimed.attempts || 0) < 3;
    await markJob(job._id, {
      status: retry ? "pending" : "failed",
      processingAt: 0,
      errorCode: detail.code,
      errorMessage: detail.message,
      sendResult: error && error.result ? error.result : null,
    });
    if (!retry) await updateEventPlan(claimed, { lastError: detail.message }).catch(() => {});
    return { sent: false, retry, eventId: claimed.eventId, planId: claimed.planId, errorCode: detail.code, message: detail.message };
  }
}

exports.main = async () => {
  const now = Date.now();
  const jobs = await listDueJobs(now);
  const results = [];
  for (let index = 0; index < jobs.length; index += 1) {
    try {
      results.push(await sendJob(jobs[index], Date.now()));
    } catch (error) {
      const detail = errorDetails(error);
      results.push({ sent: false, retry: true, errorCode: detail.code, message: detail.message });
    }
    if (index < jobs.length - 1) await sleep(80);
  }
  return {
    ok: results.every((item) => item.sent || item.skipped || item.retry),
    checked: jobs.length,
    sent: results.filter((item) => item.sent),
    failed: results.filter((item) => item.sent === false && !item.retry),
    retried: results.filter((item) => item.retry),
    now: formatChinaDateTime(now),
  };
};
