const eventParser = require("./event-parser");
const reminderService = require("../services/reminder");

function normalizeTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const result = eventParser.extractTime(raw);
  return result.time || raw;
}

function normalizeReminderPlan(eventLike) {
  const normalized = reminderService.normalizeEventReminder(eventLike || {});
  return normalized.reminderPlan
    .map((item) => ({
      type: item.type === "auto" ? "auto" : "manual",
      offsetDays: Number(item.offsetDays) || 0,
      remainingDays: Number(item.remainingDays) || 0,
      remindAt: String(item.remindAt || ""),
    }))
    .sort((left, right) => (
      `${left.remindAt}|${left.type}|${left.offsetDays}`
        .localeCompare(`${right.remindAt}|${right.type}|${right.offsetDays}`)
    ));
}

function editableEventSnapshot(eventLike) {
  const event = eventLike || {};
  const reminder = reminderService.normalizeEventReminder(event);
  const pinned = !!event.isPinned;
  return {
    title: String(event.title || "").trim(),
    targetDate: String(event.targetDate || ""),
    targetTime: normalizeTime(event.targetTime),
    location: String(event.location || ""),
    categoryId: String(event.categoryId || "life"),
    repeat: String(event.repeat || "none"),
    backgroundId: String(event.backgroundId || "mint_stars"),
    customBackgroundFileID: String(event.customBackgroundFileID || ""),
    isPinned: pinned,
    pinAt: pinned ? Number(event.pinAt || 0) : 0,
    pinOrder: pinned ? Number(event.pinOrder || 0) : 0,
    reminderMode: reminder.reminderMode,
    autoReminderDisabled: !!reminder.autoReminderDisabled,
    reminderPlan: normalizeReminderPlan(event),
    reminderInteraction: !!event.reminderChangedByUser || !!event.reminderAuthorizationRefresh,
  };
}

function hasMeaningfulEventChanges(before, after) {
  return JSON.stringify(editableEventSnapshot(before))
    !== JSON.stringify(editableEventSnapshot(after));
}

module.exports = {
  editableEventSnapshot,
  hasMeaningfulEventChanges,
};
