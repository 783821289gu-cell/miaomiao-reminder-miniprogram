const env = require("../config/env");
const dateUtils = require("../utils/date");

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_REMINDER_TIME = "09:00";
let subscribeRequestInFlight = false;
let lastSubscribeRequestEndedAt = 0;

function createPlanId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function parseTime(value) {
  const text = String(value || "").trim();
  if (!text) return { hour: 0, minute: 0 };
  const match = text.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseDateTime(dateValue, timeValue) {
  const date = dateUtils.fromDateString(dateValue);
  if (!date) return null;
  const time = parseTime(timeValue);
  if (!time) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.hour, time.minute);
}

function toDateTimeString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${dateUtils.toDateString(date)} ${dateUtils.pad(date.getHours())}:${dateUtils.pad(date.getMinutes())}`;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function normalizeReminderDate(targetDate, targetTime, now) {
  const today = now || new Date();
  const target = dateUtils.fromDateString(targetDate);
  if (!target) return toDateTimeString(addMinutes(today, 60));
  const diff = dateUtils.diffDays(targetDate, today);
  if (diff >= 3) {
    return `${dateUtils.toDateString(dateUtils.addDays(target, -3))} ${AUTO_REMINDER_TIME}`;
  }
  if (diff >= 1) {
    return `${dateUtils.toDateString(dateUtils.addDays(target, -1))} ${AUTO_REMINDER_TIME}`;
  }
  const later = addMinutes(today, 60);
  return toDateTimeString(later);
}

function dateTimeChanged(before, after) {
  if (!before || !after) return false;
  return String(before.targetDate || "") !== String(after.targetDate || "")
    || String(before.targetTime || "") !== String(after.targetTime || "");
}

function buildAutoReminderPlan(eventLike, now) {
  const targetDate = dateUtils.fromDateString(eventLike && eventLike.targetDate);
  if (!targetDate) return [];
  const nowDate = now || new Date();
  const diff = dateUtils.diffDays(eventLike.targetDate, nowDate);
  const offsets = diff >= 3 ? [3, 1] : (diff >= 1 ? [1] : []);
  return offsets.map((offsetDays) => {
    const remindAt = `${dateUtils.toDateString(dateUtils.addDays(targetDate, -offsetDays))} ${AUTO_REMINDER_TIME}`;
    return {
      id: createPlanId(`auto_${offsetDays}d`),
      type: "auto",
      offsetDays,
      remindAt,
      remainingDays: offsetDays,
      templateId: env.reminderTemplateId || "",
      subscribed: false,
      sentAt: "",
      lastError: "",
    };
  }).filter((item) => {
    const remindDate = parseDateTime(item.remindAt.slice(0, 10), item.remindAt.slice(11, 16));
    return remindDate && remindDate.getTime() > nowDate.getTime();
  });
}

function normalizePlanItem(item) {
  const plan = Object.assign({
    id: createPlanId("reminder"),
    type: "manual",
    offsetDays: 0,
    remindAt: "",
    remainingDays: 0,
    templateId: env.reminderTemplateId || "",
    subscribed: false,
    sentAt: "",
    lastError: "",
  }, item || {});
  plan.type = plan.type === "auto" ? "auto" : "manual";
  plan.templateId = env.reminderTemplateId || plan.templateId || "";
  plan.subscribed = !!plan.subscribed;
  return plan;
}

function normalizeLegacyReminder(reminder) {
  const legacy = Object.assign({
    enabled: false,
    remindAt: "",
    templateId: env.reminderTemplateId || "",
    subscribed: false,
    sentAt: "",
    lastError: "",
  }, reminder || {});
  legacy.enabled = !!legacy.enabled;
  legacy.templateId = env.reminderTemplateId || legacy.templateId || "";
  return legacy;
}

function getReminderMode(eventLike) {
  if (!eventLike) return "off";
  if (eventLike.reminderMode === "manual" || eventLike.reminderMode === "auto" || eventLike.reminderMode === "off") {
    return eventLike.reminderMode;
  }
  if (Array.isArray(eventLike.reminderPlan) && eventLike.reminderPlan.length) {
    return eventLike.reminderPlan.some((item) => item.type === "manual") ? "manual" : "auto";
  }
  if (eventLike.reminder && eventLike.reminder.enabled) return "manual";
  return "off";
}

function normalizeEventReminder(eventLike) {
  const event = eventLike || {};
  let plan = Array.isArray(event.reminderPlan) ? event.reminderPlan.map(normalizePlanItem).filter((item) => item.remindAt) : [];
  let mode = getReminderMode(event);
  const legacy = normalizeLegacyReminder(event.reminder);

  if (!plan.length && legacy.enabled && legacy.remindAt) {
    mode = "manual";
    plan = [normalizePlanItem({
      id: legacy.id || createPlanId("manual"),
      type: "manual",
      remindAt: legacy.remindAt,
      templateId: legacy.templateId,
      subscribed: legacy.subscribed,
      sentAt: legacy.sentAt,
      lastError: legacy.lastError,
    })];
  }

  if (mode === "off") {
    plan = [];
  }

  if (mode === "manual") {
    plan = plan.filter((item) => item.type === "manual").slice(0, 1);
  }

  if (mode === "auto") {
    // 自动提醒只展示和保存真正获得微信授权的计划。未授权的预览项
    // 不会生成 reminderJobs，也不应在编辑页显示为已设置提醒。
    plan = plan.filter((item) => item.type === "auto" && (item.subscribed || item.sentAt));
  }

  const first = plan[0] || {};
  return {
    reminderMode: mode,
    autoReminderDisabled: !!event.autoReminderDisabled,
    reminderPlan: plan,
    reminder: normalizeLegacyReminder({
      enabled: plan.length > 0,
      remindAt: first.remindAt || "",
      templateId: first.templateId || env.reminderTemplateId || "",
      subscribed: plan.some((item) => item.subscribed),
      sentAt: first.sentAt || "",
      lastError: first.lastError || "",
    }),
  };
}

function buildManualPlan(form, subscribed) {
  const remindAt = (form.reminder && form.reminder.remindAt)
    || form.remindAt
    || normalizeReminderDate(form.targetDate, form.targetTime);
  return [normalizePlanItem({
    id: (form.reminderPlan && form.reminderPlan[0] && form.reminderPlan[0].id) || createPlanId("manual"),
    type: "manual",
    remindAt,
    templateId: env.reminderTemplateId || "",
    subscribed: !!subscribed,
    subscriptionGrantedAt: subscribed ? Date.now() : 0,
  })];
}

function syncManualPlanByDelta(oldEvent, form) {
  const normalized = normalizeEventReminder(oldEvent);
  const oldPlan = normalized.reminderPlan[0];
  if (!oldPlan || !oldPlan.remindAt) {
    return buildManualPlan(form, oldPlan && oldPlan.subscribed);
  }
  const oldTarget = parseDateTime(oldEvent.targetDate, oldEvent.targetTime || "00:00");
  const newTarget = parseDateTime(form.targetDate, form.targetTime || "00:00");
  const oldReminder = parseDateTime(oldPlan.remindAt.slice(0, 10), oldPlan.remindAt.slice(11, 16));
  if (!oldTarget || !newTarget || !oldReminder) {
    return buildManualPlan(form, oldPlan.subscribed);
  }
  const delta = oldReminder.getTime() - oldTarget.getTime();
  return [normalizePlanItem(Object.assign({}, oldPlan, {
    id: oldPlan.id || createPlanId("manual"),
    remindAt: toDateTimeString(new Date(newTarget.getTime() + delta)),
    sentAt: "",
    lastError: "",
  }))];
}

function buildReminderFields(form, options) {
  const opts = options || {};
  if (opts.keepExisting && opts.oldEvent) {
    return normalizeEventReminder(opts.oldEvent);
  }

  const mode = getReminderMode(form);
  if (mode === "off") {
    return normalizeEventReminder(Object.assign({}, form, {
      reminderMode: "off",
      reminderPlan: [],
      reminder: { enabled: false },
    }));
  }

  if (mode === "manual") {
    const plan = opts.syncFromOld && opts.oldEvent
      ? syncManualPlanByDelta(opts.oldEvent, form)
      : buildManualPlan(form, opts.subscribed);
    const next = normalizeEventReminder(Object.assign({}, form, {
      reminderMode: "manual",
      reminderPlan: plan,
      reminder: {
        enabled: true,
        remindAt: plan[0] && plan[0].remindAt,
        templateId: env.reminderTemplateId || "",
        subscribed: plan.some((item) => item.subscribed),
        sentAt: "",
      },
    }));
    next.autoReminderDisabled = !!form.autoReminderDisabled;
    return next;
  }

  if (form.autoReminderDisabled) {
    return normalizeEventReminder(Object.assign({}, form, {
      reminderMode: "off",
      autoReminderDisabled: true,
      reminderPlan: [],
      reminder: { enabled: false },
    }));
  }

  const autoPlan = buildAutoReminderPlan(form);
  const subscriptionCount = Math.max(0, Number(opts.subscriptionCount) || (opts.subscribed ? 1 : 0));
  const grantedPlan = subscriptionCount > 0
    ? autoPlan.slice(Math.max(0, autoPlan.length - subscriptionCount))
    : [];
  const plan = grantedPlan.map((item) => Object.assign({}, item, {
    subscribed: true,
    subscriptionGrantedAt: Date.now(),
  }));
  return normalizeEventReminder(Object.assign({}, form, {
    reminderMode: "auto",
    reminderPlan: plan,
    reminder: {
      enabled: plan.length > 0,
      remindAt: plan[0] && plan[0].remindAt,
      templateId: env.reminderTemplateId || "",
      subscribed: plan.some((item) => item.subscribed),
      sentAt: "",
    },
  }));
}

function hasActiveReminder(eventLike) {
  const normalized = normalizeEventReminder(eventLike);
  return normalized.reminderPlan.some((item) => item.remindAt && !item.sentAt);
}

function hasTriggeredReminder(eventLike) {
  const normalized = normalizeEventReminder(eventLike);
  return normalized.reminderPlan.some((item) => item.remindAt && item.sentAt)
    || !!normalized.reminder.sentAt
    || !!(eventLike && eventLike.lastReminderTriggeredAt);
}

function formatReminderDateTime(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})$/);
  if (!match) return String(value || "");
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日 ${match[4]}`;
}

function formatTriggeredReminderSummary(eventLike) {
  const normalized = normalizeEventReminder(eventLike);
  const triggered = normalized.reminderPlan
    .filter((item) => item.remindAt && item.sentAt)
    .sort((left, right) => String(right.sentAt).localeCompare(String(left.sentAt)))[0];
  const remindAt = (triggered && triggered.remindAt)
    || (eventLike && eventLike.reminder && eventLike.reminder.remindAt)
    || "";
  const mode = triggered && triggered.type === "auto" ? "自动提醒" : "手动提醒";
  return remindAt ? `${mode}：${formatReminderDateTime(remindAt)}` : "微信提醒已发送";
}

function formatPlanSummary(plan) {
  const items = (plan || []).filter((item) => item.remindAt);
  if (!items.length) return "";
  return items.map((item) => {
    const date = item.remindAt.slice(5, 10).replace("-", "月");
    return `${date}日`;
  }).join("、");
}

function formatReminderSummary(eventLike) {
  const normalized = normalizeEventReminder(eventLike);
  const items = normalized.reminderPlan.filter((item) => item.remindAt && !item.sentAt);
  if (!items.length) return "";
  const modeText = normalized.reminderMode === "manual" ? "手动提醒" : "自动提醒";
  const times = items.map((item) => {
    const match = String(item.remindAt).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})$/);
    if (!match) return item.remindAt;
    return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日 ${match[4]}`;
  });
  return `${modeText}：${times.join("、")}`;
}

function normalizeSubscribeError(error) {
  const raw = String((error && (error.errMsg || error.message)) || error || "");
  if (/No template data return|verify the template id exist|template.*not.*exist/i.test(raw)) {
    return "微信提醒模板不可用，请确认该模板已添加到当前小程序后再试";
  }
  if (/cancel/i.test(raw)) {
    return "提醒未开启，可以再次点击授权";
  }
  if (/deny|reject|auth deny/i.test(raw)) {
    return "提醒未开启，可在事件编辑中再次授权";
  }
  if (/main switch.*off|switch is switched off|disabled/i.test(raw)) {
    return "微信订阅消息总开关已关闭，请在微信设置中开启后重试";
  }
  if (/user TAP gesture|must be invoked by user/i.test(raw)) {
    return "请点击确认按钮后立即完成微信提醒授权";
  }
  if (/last call has not ended/i.test(raw)) {
    return "正在等待上一次微信授权结果，请稍后再点一次";
  }
  return raw || "微信没有返回授权结果，请重新授权";
}

function getReminderSubscriptionSetting() {
  return new Promise((resolve) => {
    if (!wx.getSetting) {
      resolve({ mainSwitch: true, itemState: "", settings: {} });
      return;
    }
    wx.getSetting({
      withSubscriptions: true,
      success: (result) => {
        const subscriptions = result.subscriptionsSetting || {};
        const itemSettings = subscriptions.itemSettings || {};
        resolve({
          mainSwitch: subscriptions.mainSwitch !== false,
          itemState: itemSettings[env.reminderTemplateId] || "",
          settings: subscriptions,
        });
      },
      fail: () => resolve({ mainSwitch: true, itemState: "", settings: {} }),
    });
  });
}

function requestReminderSubscribe(count) {
  if (subscribeRequestInFlight || Date.now() - lastSubscribeRequestEndedAt < 500) {
    return Promise.resolve({
      subscribed: false,
      busy: true,
      state: "request_in_flight",
      errMsg: "正在等待上一次微信授权结果，请稍后再点一次",
    });
  }
  subscribeRequestInFlight = true;
  return getReminderSubscriptionSetting().then((liveSetting) => new Promise((resolve) => {
    if (!env.reminderTemplateId || !wx.requestSubscribeMessage) {
      resolve({ subscribed: false, errMsg: "还没有配置订阅消息模板 ID" });
      return;
    }
    if (!liveSetting.mainSwitch) {
      resolve({
        subscribed: false,
        state: "main_switch_off",
        needsOpenSetting: true,
        liveSetting,
        errMsg: "微信提醒总开关已关闭，请先到微信设置中开启",
      });
      return;
    }
    if (liveSetting.itemState === "reject") {
      resolve({
        subscribed: false,
        state: "persistent_reject",
        needsOpenSetting: true,
        liveSetting,
        errMsg: "该提醒已在微信设置中关闭，请先重新开启",
      });
      return;
    }
    wx.requestSubscribeMessage({
      tmplIds: [env.reminderTemplateId],
      success: (result) => {
        const state = result[env.reminderTemplateId];
        let errMsg = "";
        if (state === "reject") errMsg = "提醒未开启，可以再次点击授权";
        if (state === "ban") errMsg = "该提醒模板已被微信停用，请在小程序后台检查模板状态";
        if (!state) errMsg = "微信没有返回提醒模板状态，请确认模板属于当前小程序";
        resolve({
          subscribed: state === "accept",
          requestedCount: Math.max(1, Number(count) || 1),
          grantedCount: state === "accept" ? 1 : 0,
          errMsg,
          state: state || "",
          result,
        });
      },
      fail: (error) => {
        const rawError = String((error && error.errMsg) || error || "");
        if (!/last call has not ended/i.test(rawError)) console.warn("微信提醒授权失败", error);
        resolve({
          subscribed: false,
          errMsg: normalizeSubscribeError(error),
          rawErrMsg: rawError,
          busy: /last call has not ended/i.test(rawError),
          needsOpenSetting: /main switch.*off|switch is switched off|disabled/i.test(rawError),
        });
      },
    });
  })).then((result) => {
    subscribeRequestInFlight = false;
    lastSubscribeRequestEndedAt = Date.now();
    return result;
  }, (error) => {
    subscribeRequestInFlight = false;
    lastSubscribeRequestEndedAt = Date.now();
    throw error;
  });
}

function openReminderSettings() {
  return new Promise((resolve) => {
    if (!wx.openSetting) {
      resolve({ ok: false });
      return;
    }
    wx.openSetting({
      success: (result) => resolve({ ok: true, result }),
      fail: () => resolve({ ok: false }),
    });
  });
}


module.exports = {
  AUTO_REMINDER_TIME,
  normalizeReminderDate,
  parseDateTime,
  toDateTimeString,
  dateTimeChanged,
  buildAutoReminderPlan,
  normalizeLegacyReminder,
  normalizeEventReminder,
  buildReminderFields,
  hasActiveReminder,
  hasTriggeredReminder,
  formatPlanSummary,
  formatReminderSummary,
  formatTriggeredReminderSummary,
  normalizeSubscribeError,
  getReminderSubscriptionSetting,
  requestReminderSubscribe,
  openReminderSettings,
};
