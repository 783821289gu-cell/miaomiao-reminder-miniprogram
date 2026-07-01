const reminderService = require("../../services/reminder");

const ACTION_LABELS = {
  create: "新增",
  update: "修改",
  delete: "删除",
  pin: "置顶",
  unpin: "取消置顶",
  set_reminder: "提醒",
};
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);
const MIN_REMINDER_DELAY_MS = 60 * 1000;

function pad(value) {
  return String(value).padStart(2, "0");
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function parseDateTime(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function defaultReminderDate() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0);
  const minimum = minimumReminderDate();
  return next.getTime() >= minimum.getTime() ? next : minimum;
}

function minimumReminderDate() {
  const minimum = new Date(Date.now() + MIN_REMINDER_DELAY_MS);
  if (minimum.getSeconds() || minimum.getMilliseconds()) minimum.setMinutes(minimum.getMinutes() + 1);
  minimum.setSeconds(0, 0);
  return minimum;
}

Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
      observer(value) {
        if (value) this.setData({ dragOffset: 0 });
      },
    },
    result: {
      type: Object,
      value: {},
      observer(value) {
        const operations = ((value && value.operations) || []).map((item, index) => this.normalizeOperation(item, index));
        this.setData({ operations, summary: `识别到${operations.length}个待确认操作` });
      },
    },
    events: {
      type: Array,
      value: [],
    },
  },

  data: {
    operations: [],
    summary: "",
    dragOffset: 0,
    showEventPicker: false,
    eventPickerOperationIndex: -1,
    showReminderPicker: false,
    reminderPickerOperationIndex: -1,
    reminderYears: [],
    reminderMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    reminderDays: [],
    reminderHours: HOURS,
    reminderMinutes: MINUTES,
    reminderPickerValue: [0, 0, 0, 0, 0],
    selectedReminderAt: "",
  },

  methods: {
    noop() {},

    buildSummary(item) {
      const target = item.targetEventQuery || item.title || "未选择事项";
      if (item.action === "create") return `新增「${item.title || "未填写"}」${item.targetDate ? `，日期 ${item.targetDate}` : ""}`;
      if (item.action === "update") {
        const changes = [];
        if (item.patchTitle) changes.push(`名称改为 ${item.patchTitle}`);
        if (item.patchDate) changes.push(`日期改为 ${item.patchDate}`);
        if (item.patchTime) changes.push(`时间改为 ${item.patchTime}`);
        return `修改「${target}」：${changes.join("，") || "请补充修改内容"}`;
      }
      if (item.action === "delete") return `删除「${target}」`;
      if (item.action === "pin") return `置顶「${target}」`;
      if (item.action === "unpin") return `取消「${target}」的置顶`;
      if (item.action === "set_reminder") {
        if (item.reminderMode === "off") return `关闭「${target}」的提醒`;
        if (item.reminderMode === "manual") return `在 ${item.remindAt || "待选择时间"} 提醒「${target}」`;
        return `为「${target}」开启自动提醒`;
      }
      return `操作「${target}」`;
    },

    normalizeOperation(source, index) {
      const item = source || {};
      const action = item.action || "create";
      const reminder = item.reminder || {};
      const operation = {
        id: item.id || `op_${index + 1}`,
        action,
        actionLabel: ACTION_LABELS[action] || "操作",
        confidence: Number(item.confidence || 0),
        possibleMatch: !!item.possibleMatch,
        alternatives: Array.isArray(item.alternatives) ? item.alternatives : [],
        title: item.title || "",
        targetDate: item.targetDate || "",
        targetTime: item.targetTime || "",
        targetEventId: item.targetEventId || "",
        targetEventQuery: item.targetEventQuery || "",
        patchTitle: item.patch && item.patch.title ? item.patch.title : "",
        patchDate: item.patch && item.patch.targetDate ? item.patch.targetDate : "",
        patchTime: item.patch && item.patch.targetTime ? item.patch.targetTime : "",
        reminderMode: reminder.mode || (reminder.remindAt ? "manual" : (reminder.enabled ? "auto" : "off")),
        remindAt: reminder.remindAt || "",
      };
      operation.summaryText = this.buildSummary(operation);
      return operation;
    },

    updateOperation(index, patch) {
      const list = this.data.operations.slice();
      list[index] = Object.assign({}, list[index], patch);
      list[index].summaryText = this.buildSummary(list[index]);
      this.setData({ operations: list });
    },

    onInput(event) {
      const index = Number(event.currentTarget.dataset.index);
      this.updateOperation(index, { [event.currentTarget.dataset.field]: event.detail.value });
    },

    onDeleteOperation(event) {
      const index = Number(event.currentTarget.dataset.index);
      const list = this.data.operations.slice();
      list.splice(index, 1);
      this.setData({ operations: list, summary: `识别到${list.length}个待确认操作` });
    },

    onOpenEventPicker(event) {
      this.setData({ showEventPicker: true, eventPickerOperationIndex: Number(event.currentTarget.dataset.index) });
    },

    onCloseEventPicker() {
      this.setData({ showEventPicker: false, eventPickerOperationIndex: -1 });
    },

    onSelectEvent(event) {
      const index = this.data.eventPickerOperationIndex;
      const eventId = String(event.currentTarget.dataset.id || "");
      const target = (this.properties.events || []).find((item) => String(item.id) === eventId);
      if (index < 0 || !target) return;
      this.updateOperation(index, {
        targetEventId: target.id,
        targetEventQuery: target.title,
        possibleMatch: false,
      });
      this.onCloseEventPicker();
    },

    onReminderModeTap(event) {
      const index = Number(event.currentTarget.dataset.index);
      const mode = event.currentTarget.dataset.mode;
      const operation = this.data.operations[index];
      if (!operation) return;
      this.updateOperation(index, { reminderMode: mode, remindAt: mode === "manual" ? operation.remindAt : "" });
      if (mode === "manual") this.openReminderPicker(index);
    },

    openReminderPicker(index) {
      const operation = this.data.operations[index];
      const requested = parseDateTime(operation && operation.remindAt);
      const selected = requested && requested.getTime() >= minimumReminderDate().getTime() ? requested : defaultReminderDate();
      const currentYear = new Date().getFullYear();
      const years = Array.from({ length: 23 }, (_, offset) => currentYear - 2 + offset);
      const yearIndex = Math.max(0, years.indexOf(selected.getFullYear()));
      const monthIndex = selected.getMonth();
      const days = Array.from({ length: daysInMonth(years[yearIndex], monthIndex + 1) }, (_, day) => day + 1);
      this.setData({
        showReminderPicker: true,
        reminderPickerOperationIndex: index,
        reminderYears: years,
        reminderDays: days,
        reminderPickerValue: [yearIndex, monthIndex, selected.getDate() - 1, selected.getHours(), selected.getMinutes()],
        selectedReminderAt: reminderService.toDateTimeString(selected),
      });
    },

    onOpenReminderPicker(event) {
      this.openReminderPicker(Number(event.currentTarget.dataset.index));
    },

    onReminderPickerChange(event) {
      const value = event.detail.value || [0, 0, 0, 0, 0];
      const year = this.data.reminderYears[value[0]];
      const month = this.data.reminderMonths[value[1]];
      const days = Array.from({ length: daysInMonth(year, month) }, (_, day) => day + 1);
      const dayIndex = Math.min(value[2], days.length - 1);
      const date = new Date(year, month - 1, days[dayIndex], this.data.reminderHours[value[3]], this.data.reminderMinutes[value[4]]);
      if (date.getTime() < minimumReminderDate().getTime()) {
        const minimum = minimumReminderDate();
        const minimumYearIndex = Math.max(0, this.data.reminderYears.indexOf(minimum.getFullYear()));
        const minimumDays = Array.from({ length: daysInMonth(minimum.getFullYear(), minimum.getMonth() + 1) }, (_, day) => day + 1);
        this.setData({
          reminderDays: minimumDays,
          reminderPickerValue: [minimumYearIndex, minimum.getMonth(), minimum.getDate() - 1, minimum.getHours(), minimum.getMinutes()],
          selectedReminderAt: reminderService.toDateTimeString(minimum),
        });
        return;
      }
      this.setData({
        reminderDays: days,
        reminderPickerValue: [value[0], value[1], dayIndex, value[3], value[4]],
        selectedReminderAt: reminderService.toDateTimeString(date),
      });
    },

    onReminderPickerCancel() {
      this.setData({ showReminderPicker: false, reminderPickerOperationIndex: -1 });
    },

    onReminderPickerConfirm() {
      const index = this.data.reminderPickerOperationIndex;
      if (index >= 0) this.updateOperation(index, { reminderMode: "manual", remindAt: this.data.selectedReminderAt });
      this.onReminderPickerCancel();
    },

    onClose() {
      this.setData({ dragOffset: 0, showEventPicker: false, showReminderPicker: false });
      this.triggerEvent("close");
    },

    onConfirm() {
      const operations = this.data.operations.map((item, index) => ({
        id: item.id || `op_${index + 1}`,
        action: item.action,
        confidence: Number(item.confidence || 0),
        title: item.title || "",
        targetDate: item.targetDate || "",
        targetTime: item.targetTime || "",
        targetEventId: item.targetEventId || "",
        targetEventQuery: item.targetEventQuery || "",
        alternatives: item.alternatives || [],
        patch: {
          title: item.patchTitle || "",
          targetDate: item.patchDate || "",
          targetTime: item.patchTime || "",
        },
        reminder: {
          enabled: item.action === "set_reminder" && item.reminderMode !== "off",
          mode: item.reminderMode || "off",
          remindAt: item.reminderMode === "manual" ? item.remindAt : "",
        },
      }));
      if (!operations.length) {
        this.triggerEvent("notice", { text: "没有可执行的操作" });
        return;
      }
      const invalidTarget = operations.find((item) => item.action !== "create" && !item.targetEventId);
      if (invalidTarget) {
        this.triggerEvent("notice", { text: "请先为每项操作选择目标事件" });
        return;
      }
      const invalidReminder = operations.find((item) => {
        if (item.action !== "set_reminder" || item.reminder.mode !== "manual") return false;
        const date = parseDateTime(item.reminder.remindAt);
        return !date || date.getTime() < minimumReminderDate().getTime();
      });
      if (invalidReminder) {
        this.triggerEvent("notice", { text: "手动提醒至少要在当前时间 1 分钟后" });
        return;
      }
      this.triggerEvent("confirm", { operations });
    },

    onDragStart(event) {
      const touch = event.touches && event.touches[0];
      this.dragStartY = touch ? touch.clientY : 0;
    },

    onDragMove(event) {
      const touch = event.touches && event.touches[0];
      if (!touch || !this.dragStartY) return;
      const delta = touch.clientY - this.dragStartY;
      this.setData({ dragOffset: delta < 0 ? Math.max(delta * 0.22, -24) : delta });
    },

    onDragEnd() {
      if (this.data.dragOffset > 90) return this.onClose();
      this.setData({ dragOffset: 0 });
    },
  },
});
