const assert = require("assert");
const reminderService = require("../miniprogram/services/reminder");

const triggeredEvent = {
  id: "event_triggered",
  title: "喝水",
  targetDate: "2026-08-30",
  reminderMode: "manual",
  reminderPlan: [{
    id: "plan_triggered",
    type: "manual",
    remindAt: "2026-06-30 14:29",
    subscribed: true,
    sentAt: "2026-06-30 14:30",
  }],
};

assert.strictEqual(reminderService.hasActiveReminder(triggeredEvent), false);
assert.strictEqual(reminderService.hasTriggeredReminder(triggeredEvent), true);
assert.strictEqual(
  reminderService.formatTriggeredReminderSummary(triggeredEvent),
  "手动提醒：2026年6月30日 14:29",
);

const oneAuthorizedAutoReminder = {
  id: "event_auto_once",
  title: "朋友生日",
  targetDate: "2026-07-14",
  reminderMode: "auto",
  reminderPlan: [{
    id: "auto_3d",
    type: "auto",
    remindAt: "2026-07-11 09:00",
    subscribed: false,
    sentAt: "",
  }, {
    id: "auto_1d",
    type: "auto",
    remindAt: "2026-07-13 09:00",
    subscribed: true,
    sentAt: "",
  }],
};
const normalizedAutoOnce = reminderService.normalizeEventReminder(oneAuthorizedAutoReminder);
assert.strictEqual(normalizedAutoOnce.reminderPlan.length, 1);
assert.strictEqual(normalizedAutoOnce.reminderPlan[0].id, "auto_1d");
assert.strictEqual(
  reminderService.formatReminderSummary(oneAuthorizedAutoReminder),
  "自动提醒：2026年7月13日 09:00",
);

let componentDefinition;
global.Component = (definition) => { componentDefinition = definition; };
delete require.cache[require.resolve("../miniprogram/components/add-event-modal/index")];
require("../miniprogram/components/add-event-modal/index");

function confirmForm(form) {
  const events = [];
  const notices = [];
  const context = {
    properties: { saving: false },
    data: { localForm: form },
    notice: (message) => notices.push(message),
    triggerEvent: (name, detail) => events.push({ name, detail }),
  };
  componentDefinition.methods.onConfirm.call(context);
  return { events, notices };
}

const untouchedActive = {
  id: "event_active",
  title: "开会",
  targetDate: "2026-08-30",
  targetTime: "",
  reminderMode: "manual",
  reminderWasActive: true,
  reminderChangedByUser: false,
  reminderAuthorizationRefresh: false,
  reminderPlan: [{
    id: "plan_active",
    type: "manual",
    remindAt: "2020-01-01 08:00",
    subscribed: true,
    sentAt: "",
  }],
  reminder: {
    enabled: true,
    remindAt: "2020-01-01 08:00",
    subscribed: true,
  },
};

const untouchedResult = confirmForm(untouchedActive);
assert.strictEqual(untouchedResult.notices.length, 0);
assert.strictEqual(untouchedResult.events[0].name, "confirm");
assert.strictEqual(untouchedResult.events[0].detail.preserveExistingReminder, true);

const triggeredResult = confirmForm(Object.assign({}, triggeredEvent, {
  reminderWasActive: false,
  reminderChangedByUser: false,
  reminderAuthorizationRefresh: false,
  reminder: {
    enabled: false,
    remindAt: "2026-06-30 14:29",
    sentAt: "2026-06-30 14:30",
  },
}));
assert.strictEqual(triggeredResult.notices.length, 0);
assert.strictEqual(triggeredResult.events[0].name, "confirm");
assert.strictEqual(triggeredResult.events[0].detail.preserveExistingReminder, true);

const changedExpired = confirmForm(Object.assign({}, untouchedActive, {
  reminderChangedByUser: true,
  reminderAuthorizationRefresh: true,
}));
assert.strictEqual(changedExpired.events.length, 0);
assert.strictEqual(changedExpired.notices.length, 1);

console.log("Reminder state tests passed.");
