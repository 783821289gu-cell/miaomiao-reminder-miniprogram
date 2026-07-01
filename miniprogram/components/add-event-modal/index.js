const dateUtils = require("../../utils/date");
const eventParser = require("../../utils/event-parser");
const reminderService = require("../../services/reminder");
const env = require("../../config/env");

const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);
const MIN_REMINDER_DELAY_MS = 60 * 1000;

const defaultForm = {
  id: "",
  title: "",
  targetDate: "",
  targetTime: "",
  categoryId: "life",
  repeat: "none",
  backgroundId: "yellow_grid",
  isPinned: false,
  pinOrder: 0,
  reminderMode: "off",
  autoReminderDisabled: false,
  reminderPlan: [],
  reminderWasActive: false,
  reminderEditorOpened: false,
  reminderChangedByUser: false,
  reminder: {
    enabled: false,
    remindAt: "",
    templateId: env.reminderTemplateId || "",
    subscribed: false,
    sentAt: "",
  },
};

function buildDefaultManualReminderTime(now) {
  const base = now || new Date();
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate(), base.getHours(), 0);
  if (date.getTime() <= base.getTime()) {
    date.setHours(date.getHours() + 1);
  }
  const minimum = getMinimumReminderDate(base);
  return reminderService.toDateTimeString(date.getTime() >= minimum.getTime() ? date : minimum);
}

function getMinimumReminderDate(now) {
  const base = now || new Date();
  const minimum = new Date(base.getTime() + MIN_REMINDER_DELAY_MS);
  if (minimum.getSeconds() || minimum.getMilliseconds()) minimum.setMinutes(minimum.getMinutes() + 1);
  minimum.setSeconds(0, 0);
  return minimum;
}

function parseReminderDateTime(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute
  ) {
    return null;
  }
  return date;
}

Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    form: {
      type: Object,
      value: {},
      observer(value) {
        const merged = Object.assign({}, defaultForm, value || {}, {
          reminder: Object.assign({}, defaultForm.reminder, (value && value.reminder) || {}),
        });
        const next = Object.assign({}, merged, reminderService.normalizeEventReminder(merged));
        const hasExistingReminder = !!next.reminderWasActive;
        const hasTriggeredReminder = !hasExistingReminder && reminderService.hasTriggeredReminder(next);
        this.setData({
          localForm: next,
          hasExistingReminder,
          hasTriggeredReminder,
          reminderEditMode: (!hasExistingReminder && !hasTriggeredReminder) || !!next.reminderEditorOpened,
          reminderSummary: hasExistingReminder
            ? reminderService.formatReminderSummary(next)
            : (hasTriggeredReminder ? reminderService.formatTriggeredReminderSummary(next) : ""),
        });
      },
    },
    categories: {
      type: Array,
      value: [],
      observer(value) {
        this.setData({
          editableCategories: (value || []).filter((item) => item.id !== "all"),
        });
      },
    },
    backgrounds: {
      type: Array,
      value: [],
    },
    subscriptionState: {
      type: String,
      value: "unknown",
    },
    reminderError: {
      type: String,
      value: "",
    },
    saving: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    localForm: Object.assign({}, defaultForm),
    showDatePicker: false,
    dateYears: [],
    dateMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    dateDays: [],
    datePickerValue: [0, 0, 0],
    selectedDate: "",
    selectedDateLabel: "",
    showReminderPicker: false,
    reminderYears: [],
    reminderMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    reminderDays: [],
    reminderHours: HOURS,
    reminderMinutes: MINUTES,
    reminderPickerValue: [0, 0, 0, 0, 0],
    selectedReminderAt: "",
    selectedReminderLabel: "",
    editableCategories: [],
    hasExistingReminder: false,
    hasTriggeredReminder: false,
    reminderEditMode: true,
    reminderSummary: "",
  },

  methods: {
    noop() {},

    notice(text) {
      this.triggerEvent("notice", { text });
    },

    updateForm(patch) {
      const next = Object.assign({}, this.data.localForm, patch);
      this.setData({
        localForm: next,
      });
      this.triggerEvent("change", next);
    },

    onTitleInput(event) {
      this.updateForm({ title: event.detail.value });
    },

    onTimeInput(event) {
      this.updateForm({ targetTime: event.detail.value });
    },

    onTimeBlur(event) {
      const raw = String(event.detail.value || "").trim();
      if (!raw) {
        this.updateForm({ targetTime: "" });
        return;
      }
      const result = eventParser.extractTime(raw);
      if (!result.time) {
        this.notice("时间可写 08:00 或 八点半");
        this.updateForm({ targetTime: "" });
        return;
      }
      this.updateForm({ targetTime: result.time });
    },

    ensureDateRanges() {
      if (this.data.dateYears.length) return;
      this.setData({ dateYears: dateUtils.buildYearRange() });
    },

    ensureReminderRanges(selectedYear) {
      let years = this.data.reminderYears.length ? this.data.reminderYears : dateUtils.buildYearRange();
      if (selectedYear && years.indexOf(selectedYear) < 0) {
        years = years.concat(selectedYear).sort((a, b) => a - b);
      }
      this.setData({ reminderYears: years });
      return years;
    },

    buildDateDays(year, month) {
      const days = [];
      const dayCount = dateUtils.getMonthDays(year, month);
      for (let day = 1; day <= dayCount; day += 1) days.push(day);
      return days;
    },

    formatReminderLabel(value) {
      const date = parseReminderDateTime(value);
      if (!date) return "";
      return `${dateUtils.formatDisplayDate(dateUtils.toDateString(date))} ${dateUtils.pad(date.getHours())}:${dateUtils.pad(date.getMinutes())}`;
    },

    setPickerDate(value) {
      this.ensureDateRanges();
      const date = dateUtils.fromDateString(value) || new Date();
      const years = this.data.dateYears.length ? this.data.dateYears : dateUtils.buildYearRange();
      const yearIndex = Math.max(0, years.indexOf(date.getFullYear()));
      const monthIndex = date.getMonth();
      const days = this.buildDateDays(years[yearIndex], monthIndex + 1);
      const dayIndex = Math.min(days.length - 1, date.getDate() - 1);
      const selectedDate = dateUtils.toDateString(new Date(years[yearIndex], monthIndex, dayIndex + 1));
      this.setData({
        dateYears: years,
        dateDays: days,
        datePickerValue: [yearIndex, monthIndex, dayIndex],
        selectedDate,
        selectedDateLabel: dateUtils.formatDisplayDate(selectedDate),
      });
    },

    onOpenDate() {
      this.setPickerDate(this.data.localForm.targetDate || dateUtils.getTodayString());
      this.setData({ showDatePicker: true });
    },

    onDatePickerChange(event) {
      const value = event.detail.value;
      const year = this.data.dateYears[value[0]];
      const month = this.data.dateMonths[value[1]];
      const days = this.buildDateDays(year, month);
      const dayIndex = Math.min(value[2], days.length - 1);
      const selectedDate = dateUtils.toDateString(new Date(year, month - 1, dayIndex + 1));
      this.setData({
        dateDays: days,
        datePickerValue: [value[0], value[1], dayIndex],
        selectedDate,
        selectedDateLabel: dateUtils.formatDisplayDate(selectedDate),
      });
    },

    onDateCancel() {
      this.setData({ showDatePicker: false });
    },

    onDateConfirm() {
      this.updateForm({ targetDate: this.data.selectedDate });
      this.setData({ showDatePicker: false });
    },

    setReminderPickerDate(value) {
      const minimum = getMinimumReminderDate();
      const requested = parseReminderDateTime(value);
      const parsed = requested && requested.getTime() >= minimum.getTime()
        ? requested
        : (parseReminderDateTime(buildDefaultManualReminderTime()) || minimum);
      const years = this.ensureReminderRanges(parsed.getFullYear());
      const yearIndex = Math.max(0, years.indexOf(parsed.getFullYear()));
      const monthIndex = parsed.getMonth();
      const days = this.buildDateDays(years[yearIndex], monthIndex + 1);
      const dayIndex = Math.min(days.length - 1, parsed.getDate() - 1);
      const hourIndex = parsed.getHours();
      const minuteIndex = parsed.getMinutes();
      const selectedReminderAt = reminderService.toDateTimeString(
        new Date(years[yearIndex], monthIndex, dayIndex + 1, hourIndex, minuteIndex)
      );
      this.setData({
        reminderYears: years,
        reminderDays: days,
        reminderPickerValue: [yearIndex, monthIndex, dayIndex, hourIndex, minuteIndex],
        selectedReminderAt,
        selectedReminderLabel: this.formatReminderLabel(selectedReminderAt),
      });
    },

    onOpenReminderPicker() {
      const current = this.data.localForm.reminder || {};
      this.setReminderPickerDate(current.remindAt || buildDefaultManualReminderTime());
      this.setData({ showReminderPicker: true });
    },

    onReminderPickerChange(event) {
      const value = event.detail.value;
      const year = this.data.reminderYears[value[0]];
      const month = this.data.reminderMonths[value[1]];
      const days = this.buildDateDays(year, month);
      const dayIndex = Math.min(value[2], days.length - 1);
      const hourIndex = Math.min(23, value[3]);
      const minuteIndex = Math.min(59, value[4]);
      const selectedReminderAt = reminderService.toDateTimeString(
        new Date(year, month - 1, dayIndex + 1, hourIndex, minuteIndex)
      );
      const selectedDate = parseReminderDateTime(selectedReminderAt);
      if (!selectedDate || selectedDate.getTime() < getMinimumReminderDate().getTime()) {
        this.setReminderPickerDate(reminderService.toDateTimeString(getMinimumReminderDate()));
        return;
      }
      this.setData({
        reminderDays: days,
        reminderPickerValue: [value[0], value[1], dayIndex, hourIndex, minuteIndex],
        selectedReminderAt,
        selectedReminderLabel: this.formatReminderLabel(selectedReminderAt),
      });
    },

    onReminderPickerCancel() {
      this.setData({ showReminderPicker: false });
    },

    onReminderPickerConfirm() {
      const remindAt = this.data.selectedReminderAt || buildDefaultManualReminderTime();
      const reminder = Object.assign({}, this.data.localForm.reminder || {}, {
        enabled: true,
        remindAt,
        templateId: env.reminderTemplateId || "",
      });
      this.updateForm({
        reminderMode: "manual",
        reminderPlan: [],
        reminder,
        reminderEditorOpened: true,
        reminderChangedByUser: true,
        reminderAuthorizationRefresh: true,
      });
      this.setData({ showReminderPicker: false });
    },

    onEditReminder() {
      if (this.data.hasTriggeredReminder) {
        this.updateForm({
          reminderMode: "manual",
          reminderPlan: [],
          reminder: Object.assign({}, this.data.localForm.reminder || {}, {
            enabled: false,
            remindAt: "",
            subscribed: false,
            sentAt: "",
            lastError: "",
            templateId: env.reminderTemplateId || "",
          }),
          reminderWasActive: false,
          reminderEditorOpened: true,
          reminderChangedByUser: true,
          reminderAuthorizationRefresh: true,
        });
        return;
      }
      this.updateForm({ reminderEditorOpened: true });
    },

    onCategoryTap(event) {
      this.updateForm({ categoryId: event.currentTarget.dataset.id });
    },

    onBackgroundTap(event) {
      this.updateForm({ backgroundId: event.currentTarget.dataset.id });
    },

    onTogglePinned() {
      const nextPinned = !this.data.localForm.isPinned;
      const now = Date.now();
      this.updateForm({
        isPinned: nextPinned,
        pinAt: nextPinned ? (this.data.localForm.pinAt || now) : 0,
        pinOrder: nextPinned ? (this.data.localForm.pinOrder || now) : 0,
      });
    },

    onReminderModeTap(event) {
      const mode = event.currentTarget.dataset.mode;
      if (mode === "manual") {
        const current = this.data.localForm.reminder || {};
        const remindAt = current.remindAt || buildDefaultManualReminderTime();
        this.updateForm({
          reminderMode: "manual",
          reminderPlan: [],
          reminder: Object.assign({}, current, {
            enabled: true,
            remindAt,
            templateId: env.reminderTemplateId || current.templateId || "",
          }),
          reminderAuthorizationRefresh: true,
          reminderEditorOpened: true,
          reminderChangedByUser: true,
        });
        return;
      }
      if (mode === "off") {
        this.updateForm({
          reminderMode: "off",
          reminderPlan: [],
          reminder: Object.assign({}, this.data.localForm.reminder || {}, {
            enabled: false,
            remindAt: "",
            templateId: env.reminderTemplateId || "",
          }),
          reminderAuthorizationRefresh: true,
          reminderEditorOpened: true,
          reminderChangedByUser: true,
        });
        return;
      }
      this.updateForm({
        reminderMode: "auto",
        autoReminderDisabled: false,
        reminderPlan: [],
        reminder: Object.assign({}, this.data.localForm.reminder || {}, {
          enabled: false,
          remindAt: "",
          templateId: env.reminderTemplateId || "",
        }),
        reminderAuthorizationRefresh: true,
        reminderEditorOpened: true,
        reminderChangedByUser: true,
      });
    },

    onCancel() {
      this.setData({ showDatePicker: false, showReminderPicker: false });
      this.triggerEvent("cancel");
    },

    onConfirm() {
      if (this.properties.saving) return;
      const form = Object.assign({}, this.data.localForm, {
        title: String(this.data.localForm.title || "").trim(),
        repeat: "none",
      });
      const rawTime = String(form.targetTime || "").trim();
      if (rawTime) {
        const timeResult = eventParser.extractTime(rawTime);
        if (!timeResult.time) {
          this.notice("时间可写 08:00 或 八点半");
          return;
        }
        form.targetTime = timeResult.time;
      }
      if (form.title === "959499") {
        this.triggerEvent("easter");
        return;
      }
      if (!form.title) {
        this.notice("先写个事件名称");
        return;
      }
      if (!form.targetDate) {
        this.notice("请选择日期");
        return;
      }
      const preserveExistingReminder = !!(
        !form.reminderChangedByUser
        && !form.reminderAuthorizationRefresh
        && (form.reminderWasActive || reminderService.hasTriggeredReminder(form))
      );
      if (!preserveExistingReminder && form.reminderMode === "manual" && (!form.reminder || !form.reminder.remindAt)) {
        form.reminder = Object.assign({}, form.reminder || {}, {
          enabled: true,
          remindAt: buildDefaultManualReminderTime(),
          templateId: env.reminderTemplateId || "",
        });
      }
      if (!preserveExistingReminder && form.reminderMode === "manual" && !parseReminderDateTime(form.reminder.remindAt)) {
        this.notice("请选择正确的提醒时间");
        return;
      }
      if (!preserveExistingReminder && form.reminderMode === "manual" && parseReminderDateTime(form.reminder.remindAt).getTime() < getMinimumReminderDate().getTime()) {
        this.notice("提醒时间至少要在当前时间 1 分钟后");
        return;
      }
      if (form.reminderMode === "off") {
        form.reminderPlan = [];
        form.reminder = Object.assign({}, form.reminder || {}, { enabled: false, remindAt: "" });
      }
      form.preserveExistingReminder = preserveExistingReminder;
      this.triggerEvent("confirm", form);
    },
  },
});
