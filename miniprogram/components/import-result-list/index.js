const eventParser = require("../../utils/event-parser");
const dateUtils = require("../../utils/date");

Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
      observer(value) {
        if (value) this.setData({ dragOffset: 0 });
      },
    },
    candidates: {
      type: Array,
      value: [],
      observer(value) {
        this.setData({
          localCandidates: (value || []).map((item) => Object.assign({}, item, {
            missingText: item.missingText || (item.missingFields || []).join("、"),
          })),
        });
      },
    },
  },

  data: {
    localCandidates: [],
    dragOffset: 0,
    showDatePicker: false,
    activeDateIndex: -1,
    dateYears: [],
    dateMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    dateDays: [],
    datePickerValue: [0, 0, 0],
    selectedDate: "",
    selectedDateLabel: "",
  },

  methods: {
    noop() {},

    notice(text) {
      this.triggerEvent("notice", { text });
    },

    isValidDateString(value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parts = value.split("-").map((item) => Number(item));
      const date = new Date(parts[0], parts[1] - 1, parts[2]);
      return date.getFullYear() === parts[0]
        && date.getMonth() === parts[1] - 1
        && date.getDate() === parts[2];
    },

    onClose() {
      this.setData({ dragOffset: 0, showDatePicker: false, activeDateIndex: -1 });
      this.triggerEvent("close");
    },

    onToggle(event) {
      const index = event.currentTarget.dataset.index;
      const list = this.data.localCandidates.slice();
      if (!list[index].canSave) {
        this.notice(list[index].message || "这条还不能生成");
        return;
      }
      list[index].selected = !list[index].selected;
      this.setData({ localCandidates: list });
    },

    refreshCandidate(item) {
      const next = Object.assign({}, item);
      const wasSaveable = !!next.canSave;
      const missing = [];
      const title = String(next.title || "").trim();
      let date = String(next.targetDate || "").trim();
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const resolved = eventParser.resolveRelativeDate(date, new Date());
        if (resolved && resolved.date) date = resolved.date;
      }
      next.title = title;
      next.targetDate = date;
      if (!title) missing.push("事项");
      if (!date || !this.isValidDateString(date)) missing.push("日期");
      next.missingFields = missing;
      next.canSave = missing.length === 0;
      next.ok = next.canSave;
      next.selected = next.canSave ? (wasSaveable ? next.selected !== false : true) : false;
      next.missingText = missing.length ? `需要补上${missing.join("、")}` : "";
      next.message = next.missingText;
      return next;
    },

    onInput(event) {
      const index = event.currentTarget.dataset.index;
      const field = event.currentTarget.dataset.field;
      const list = this.data.localCandidates.slice();
      list[index][field] = event.detail.value;
      list[index] = this.refreshCandidate(list[index]);
      this.setData({ localCandidates: list });
    },

    buildDateDays(year, month) {
      return Array.from({ length: dateUtils.getMonthDays(year, month) }, (_, index) => index + 1);
    },

    onOpenDatePicker(event) {
      const index = Number(event.currentTarget.dataset.index);
      const candidate = this.data.localCandidates[index];
      if (!candidate) return;
      const years = this.data.dateYears.length ? this.data.dateYears : dateUtils.buildYearRange();
      const parsed = dateUtils.fromDateString(candidate.targetDate) || new Date();
      let yearIndex = years.indexOf(parsed.getFullYear());
      if (yearIndex < 0) yearIndex = 0;
      const monthIndex = parsed.getMonth();
      const days = this.buildDateDays(years[yearIndex], monthIndex + 1);
      const dayIndex = Math.min(days.length - 1, parsed.getDate() - 1);
      const selectedDate = dateUtils.toDateString(new Date(years[yearIndex], monthIndex, dayIndex + 1));
      this.setData({
        showDatePicker: true,
        activeDateIndex: index,
        dateYears: years,
        dateDays: days,
        datePickerValue: [yearIndex, monthIndex, dayIndex],
        selectedDate,
        selectedDateLabel: dateUtils.formatDisplayDate(selectedDate),
      });
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

    onDatePickerCancel() {
      this.setData({ showDatePicker: false, activeDateIndex: -1 });
    },

    onDatePickerConfirm() {
      const index = this.data.activeDateIndex;
      const list = this.data.localCandidates.slice();
      if (index < 0 || !list[index]) {
        this.onDatePickerCancel();
        return;
      }
      list[index].targetDate = this.data.selectedDate;
      list[index] = this.refreshCandidate(list[index]);
      this.setData({
        localCandidates: list,
        showDatePicker: false,
        activeDateIndex: -1,
      });
    },

    onBlur(event) {
      const index = event.currentTarget.dataset.index;
      const field = event.currentTarget.dataset.field;
      if (field !== "targetTime") return;
      const list = this.data.localCandidates.slice();
      const raw = String(list[index].targetTime || "").trim();
      if (!raw) {
        list[index].targetTime = "";
      } else {
        const result = eventParser.extractTime(raw);
        if (!result.time) {
          this.notice("时间可写 08:00 或 八点半");
          list[index].targetTime = "";
        } else {
          list[index].targetTime = result.time;
        }
      }
      this.setData({ localCandidates: list });
    },

    onDelete(event) {
      const index = event.currentTarget.dataset.index;
      const list = this.data.localCandidates.slice();
      list.splice(index, 1);
      this.setData({ localCandidates: list });
    },

    onConfirm() {
      const selected = this.data.localCandidates
        .filter((item) => item.selected && item.canSave && item.title && item.targetDate)
        .map((item) => Object.assign({}, item));
      if (!selected.length) {
        this.notice("没有可生成的事项");
        return;
      }
      for (let index = 0; index < selected.length; index += 1) {
        const rawTime = String(selected[index].targetTime || "").trim();
        if (!rawTime) continue;
        const result = eventParser.extractTime(rawTime);
        if (!result.time) {
          this.notice("时间可写 08:00 或 八点半");
          return;
        }
        selected[index].targetTime = result.time;
      }
      this.triggerEvent("confirm", { candidates: selected });
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
      if (this.data.dragOffset > 90) {
        this.onClose();
        return;
      }
      this.setData({ dragOffset: 0 });
    },
  },
});
