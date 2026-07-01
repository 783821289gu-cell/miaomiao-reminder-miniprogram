const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function isMissingCollection(error) {
  return /COLLECTION_NOT_EXIST|DATABASE_COLLECTION_NOT_EXIST|Db or Table not exist|collection.*not exist/i
    .test(String((error && (error.errMsg || error.message)) || error || ""));
}

async function ensureReminderCollection() {
  try {
    await db.createCollection("reminderJobs");
  } catch (error) {
    if (!/already exists|exist/i.test(String((error && (error.errMsg || error.message)) || error || ""))) throw error;
  }
}

function parseChinaTimestamp(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return 0;
  return Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+08:00`);
}

function publicJob(job) {
  return {
    id: job._id || "",
    planId: String(job.planId || ""),
    remindAt: String(job.remindAt || ""),
    templateId: String(job.templateId || ""),
    status: String(job.status || ""),
    sentAt: job.sentAt || "",
    errorCode: job.errorCode || "",
    errorMessage: job.errorMessage || "",
  };
}

function buildJob(event, plan, openid, current) {
  const now = Date.now();
  const remindAt = String(plan.remindAt || "");
  return {
    _openid: openid,
    eventId: String(event.id || ""),
    eventCloudDocId: String(event.cloudDocId || ""),
    planId: String(plan.id || ""),
    type: plan.type === "auto" ? "auto" : "manual",
    title: String(event.title || "重要日").slice(0, 20),
    targetDate: String(event.targetDate || ""),
    targetTime: String(event.targetTime || ""),
    remindAt,
    remindAtTs: parseChinaTimestamp(remindAt),
    remainingDays: Number(plan.remainingDays) || 0,
    templateId: String(plan.templateId || ""),
    status: "pending",
    subscriptionGrantedAt: Number(plan.subscriptionGrantedAt) || now,
    attempts: 0,
    sendAttemptAt: 0,
    sentAt: "",
    sentAtTs: 0,
    errorCode: "",
    errorMessage: "",
    sendResult: null,
    processingAt: 0,
    cancelledAt: 0,
    createdAt: (current && current.createdAt) || now,
    updatedAt: now,
  };
}

async function listEventJobs(openid, eventId) {
  try {
    const result = await db.collection("reminderJobs").where({ _openid: openid, eventId }).limit(100).get();
    return result.data || [];
  } catch (error) {
    if (!isMissingCollection(error)) throw error;
    await ensureReminderCollection();
    return [];
  }
}

async function removeJobs(jobs) {
  const removable = (jobs || []).filter((job) => job && job._id);
  await Promise.all(removable.map((job) => db.collection("reminderJobs").doc(job._id).remove()));
  return removable.length;
}

function validatePlan(plan) {
  if (!plan || !plan.id || !plan.remindAt || !plan.subscribed) return false;
  return parseChinaTimestamp(plan.remindAt) > Date.now() && !plan.sentAt;
}

async function syncEvent(openid, event) {
  const startedAt = Date.now();
  const eventId = String(event.id || "");
  if (!eventId) throw new Error("缺少事件 ID");
  const jobs = await listEventJobs(openid, eventId);
  const existingByPlan = {};
  jobs.forEach((job) => { existingByPlan[String(job.planId)] = job; });

  const plans = Array.isArray(event.reminderPlan) ? event.reminderPlan : [];
  const candidatePlans = plans.filter(validatePlan);
  const missingTemplatePlans = candidatePlans.filter((plan) => !String(plan.templateId || "").trim());
  if (missingTemplatePlans.length) {
    const error = new Error("提醒模板 ID 缺失");
    error.code = "template_missing";
    throw error;
  }
  const validPlans = candidatePlans;
  const validIds = validPlans.map((plan) => String(plan.id));
  const obsolete = jobs.filter((job) => validIds.indexOf(String(job.planId)) < 0);
  await removeJobs(obsolete);

  const scheduledJobs = await Promise.all(validPlans.map(async (plan) => {
    const current = existingByPlan[String(plan.id)];
    const job = buildJob(event, plan, openid, current);
    if (current) {
      await db.collection("reminderJobs").doc(current._id).update({ data: job });
      return publicJob(Object.assign({ _id: current._id }, job));
    }
    const added = await db.collection("reminderJobs").add({ data: job });
    return publicJob(Object.assign({ _id: added._id || "" }, job));
  }));
  return { eventId, scheduledJobs, elapsedMs: Date.now() - startedAt };
}

exports.main = async (input) => {
  const openid = cloud.getWXContext().OPENID;
  const mode = String(input.mode || "sync");
  const eventId = String(input.eventId || (input.event && input.event.id) || "");
  if (mode === "cancel") {
    const jobs = eventId ? await listEventJobs(openid, eventId) : [];
    const cancelled = await removeJobs(jobs);
    return { ok: true, eventId, cancelled, jobs: jobs.map(publicJob) };
  }
  if (mode === "status") {
    const jobs = eventId ? await listEventJobs(openid, eventId) : [];
    return { ok: true, eventId, jobs: jobs.map(publicJob) };
  }
  try {
    const result = await syncEvent(openid, input.event || {});
    return Object.assign({ ok: true }, result);
  } catch (error) {
    return {
      ok: false,
      eventId,
      code: error.code || "sync_failed",
      message: error.message || "提醒任务创建失败",
    };
  }
};
