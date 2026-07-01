const assert = require("assert");
const eventDiff = require("../miniprogram/utils/event-diff");

const original = {
  id: "event_1",
  title: "团队会议",
  targetDate: "2026-07-01",
  targetTime: "08:00",
  location: "会议室",
  categoryId: "work",
  repeat: "none",
  backgroundId: "mint_stars",
  isPinned: true,
  pinAt: 100,
  pinOrder: 100,
  reminderMode: "manual",
  reminderPlan: [{
    id: "plan_1",
    type: "manual",
    remindAt: "2026-07-01 07:30",
    subscribed: true,
    templateId: "template-id",
  }],
};

const untouchedForm = Object.assign({}, original, {
  targetTime: "8点",
  reminderWasActive: true,
  reminderEditorOpened: false,
  reminderChangedByUser: false,
  preserveExistingReminder: true,
});

assert.strictEqual(eventDiff.hasMeaningfulEventChanges(original, untouchedForm), false);
assert.strictEqual(eventDiff.hasMeaningfulEventChanges(original, Object.assign({}, untouchedForm, {
  title: "季度会议",
})), true);
assert.strictEqual(eventDiff.hasMeaningfulEventChanges(original, Object.assign({}, untouchedForm, {
  targetDate: "2026-07-02",
})), true);
assert.strictEqual(eventDiff.hasMeaningfulEventChanges(original, Object.assign({}, untouchedForm, {
  isPinned: false,
})), true);
assert.strictEqual(eventDiff.hasMeaningfulEventChanges(original, Object.assign({}, untouchedForm, {
  reminderMode: "off",
  reminderPlan: [],
})), true);
assert.strictEqual(eventDiff.hasMeaningfulEventChanges(original, Object.assign({}, untouchedForm, {
  reminderChangedByUser: true,
  reminderAuthorizationRefresh: true,
})), true);

console.log("Event diff tests passed.");
