const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ALLOWED_ACTIONS = ["create", "update", "delete", "pin", "unpin", "set_reminder"];

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function normalizeReminderFields(fields) {
  const source = fields || {};
  const mode = ["auto", "manual", "off"].includes(source.reminderMode) ? source.reminderMode : "off";
  const plan = mode === "off" ? [] : (Array.isArray(source.reminderPlan) ? source.reminderPlan : []).map((item) => ({
    id: String(item.id || createId(item.type === "auto" ? "auto" : "manual")),
    type: item.type === "auto" ? "auto" : "manual",
    offsetDays: Number(item.offsetDays) || 0,
    remindAt: String(item.remindAt || ""),
    remainingDays: Number(item.remainingDays) || 0,
    templateId: String(item.templateId || ""),
    subscribed: !!item.subscribed,
    subscriptionGrantedAt: Number(item.subscriptionGrantedAt) || 0,
    sentAt: "",
    lastError: "",
  })).filter((item) => item.subscribed);
  plan.forEach((item) => {
    if (item.subscribed && !item.templateId) throw new Error("提醒模板 ID 缺失");
    if (item.subscribed && !/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(item.remindAt)) throw new Error("提醒时间格式无效");
  });
  const first = plan[0] || {};
  return {
    reminderMode: mode,
    autoReminderDisabled: !!source.autoReminderDisabled,
    reminderPlan: plan,
    reminder: {
      enabled: plan.length > 0,
      remindAt: first.remindAt || "",
      templateId: first.templateId || "",
      subscribed: plan.some((item) => item.subscribed),
      sentAt: "",
      lastError: "",
    },
  };
}

function buildEventFromOperation(op, openid) {
  const now = Date.now();
  const reminderFields = normalizeReminderFields(op.reminderFields);
  return Object.assign({
    _openid: openid,
    id: op.eventId || createId("event"),
    title: String(op.title || (op.patch && op.patch.title) || "未命名事项").trim(),
    targetDate: String(op.targetDate || (op.patch && op.patch.targetDate) || ""),
    targetTime: String(op.targetTime || (op.patch && op.patch.targetTime) || ""),
    location: String(op.location || ""),
    categoryId: op.categoryId || "life",
    repeat: "none",
    reminderOffsets: [],
    isPinned: !!op.isPinned,
    pinAt: op.isPinned ? now : 0,
    pinOrder: op.isPinned ? now : 0,
    backgroundId: op.backgroundId || "yellow_grid",
    sourceType: "ai",
    sourceText: op.rawText || "",
    customBackgroundFileID: op.customBackgroundFileID || "",
    createdAt: now,
    updatedAt: now,
  }, reminderFields);
}

function validateOperations(operations, events) {
  const byId = {};
  events.forEach((item) => { byId[String(item.id)] = item; });
  const simulated = Object.assign({}, byId);
  return operations.map((source, index) => {
    const op = Object.assign({}, source || {});
    op.id = op.id || `op_${index + 1}`;
    if (!ALLOWED_ACTIONS.includes(op.action)) throw new Error(`第 ${index + 1} 项操作类型无效`);
    if (op.action === "create") {
      if (!String(op.title || "").trim()) throw new Error(`第 ${index + 1} 项新增事项缺少名称`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(op.targetDate || ""))) throw new Error(`第 ${index + 1} 项新增事项缺少有效日期`);
      normalizeReminderFields(op.reminderFields);
      return op;
    }
    const eventId = String(op.targetEventId || "");
    if (!eventId || !simulated[eventId]) throw new Error(`第 ${index + 1} 项没有选定有效目标事项`);
    op.target = simulated[eventId];
    if (op.action === "update") {
      const patch = op.patch && typeof op.patch === "object" ? op.patch : {};
      const allowed = ["title", "targetDate", "targetTime", "location", "categoryId", "backgroundId"];
      if (!allowed.some((key) => Object.prototype.hasOwnProperty.call(patch, key) && String(patch[key] || "").trim())) {
        throw new Error(`第 ${index + 1} 项没有可执行的修改内容`);
      }
      simulated[eventId] = Object.assign({}, simulated[eventId], patch);
    }
    if (op.action === "delete") delete simulated[eventId];
    if (op.action === "set_reminder") normalizeReminderFields(op.reminderFields);
    return op;
  });
}

async function markReminderJobsCancelled(openid, eventIds) {
  for (let index = 0; index < eventIds.length; index += 1) {
    const eventId = eventIds[index];
    const result = await db.collection("reminderJobs").where({ _openid: openid, eventId }).limit(100).get().catch(() => ({ data: [] }));
    await Promise.all((result.data || []).map((item) => db.collection("reminderJobs").doc(item._id).remove()));
  }
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID;
  const operations = Array.isArray(event.operations) ? event.operations : [];
  if (!operations.length) return { ok: false, code: "empty_operations", message: "没有可执行的操作", results: [] };
  const snapshot = await db.collection("events").where({ _openid: openid }).limit(1000).get();
  const existingEvents = snapshot.data || [];
  let validated;
  try {
    validated = validateOperations(operations, existingEvents);
  } catch (error) {
    return { ok: false, code: "validation_failed", message: error.message || "操作列表校验失败", results: [] };
  }

  const results = [];
  const cancelJobEventIds = [];
  try {
    await db.runTransaction(async (transaction) => {
      for (let index = 0; index < validated.length; index += 1) {
        const op = validated[index];
        if (op.action === "create") {
          const doc = buildEventFromOperation(op, openid);
          const docId = createId("event_doc");
          await transaction.collection("events").doc(docId).set({ data: doc });
          results.push({ id: op.id, ok: true, action: op.action, eventId: doc.id, docId, message: `已新增：${doc.title}` });
          continue;
        }
        const target = op.target;
        const ref = transaction.collection("events").doc(target._id);
        if (op.action === "delete") {
          await ref.remove();
          cancelJobEventIds.push(target.id);
          results.push({ id: op.id, ok: true, action: op.action, eventId: target.id, message: `已删除：${target.title}` });
          continue;
        }
        if (op.action === "pin" || op.action === "unpin") {
          const now = Date.now();
          const pinned = op.action === "pin";
          await ref.update({ data: { isPinned: pinned, pinAt: pinned ? (target.pinAt || now) : 0, pinOrder: pinned ? now : 0, updatedAt: now } });
          results.push({ id: op.id, ok: true, action: op.action, eventId: target.id, message: `${pinned ? "已置顶" : "已取消置顶"}：${target.title}` });
          continue;
        }
        if (op.action === "set_reminder") {
          const reminderPatch = Object.assign({}, normalizeReminderFields(op.reminderFields), { updatedAt: Date.now() });
          await ref.update({ data: reminderPatch });
          cancelJobEventIds.push(target.id);
          results.push({ id: op.id, ok: true, action: op.action, eventId: target.id, message: `已更新提醒：${target.title}` });
          continue;
        }
        const patch = {};
        ["title", "targetDate", "targetTime", "location", "categoryId", "backgroundId"].forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(op.patch || {}, field)) patch[field] = op.patch[field];
        });
        patch.updatedAt = Date.now();
        await ref.update({ data: patch });
        results.push({ id: op.id, ok: true, action: op.action, eventId: target.id, message: `已修改：${patch.title || target.title}` });
      }
    });
  } catch (error) {
    return { ok: false, code: "transaction_failed", message: error.message || "批量操作执行失败", results: [] };
  }
  await markReminderJobsCancelled(openid, Array.from(new Set(cancelJobEventIds)));
  return { ok: true, results };
};
