const eventParser = require("../../utils/event-parser");

Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
      observer(value) {
        if (value) this.setData({ dragOffset: 0 });
      },
    },
    rawText: {
      type: String,
      value: "",
      observer(value) {
        this.setData({ localRawText: value || "" });
      },
    },
    candidate: {
      type: Object,
      value: {},
      observer(value) {
        this.setData({ localCandidate: Object.assign({}, value || {}) });
      },
    },
  },

  data: {
    localRawText: "",
    localCandidate: {},
    dragOffset: 0,
  },

  methods: {
    noop() {},

    notice(text) {
      this.triggerEvent("notice", { text });
    },

    onClose() {
      this.setData({ dragOffset: 0 });
      this.triggerEvent("close");
    },

    onRawInput(event) {
      this.setData({ localRawText: event.detail.value });
    },

    onReparse() {
      this.triggerEvent("reparse", { rawText: this.data.localRawText });
    },

    onFieldInput(event) {
      const field = event.currentTarget.dataset.field;
      const patch = {};
      patch[field] = event.detail.value;
      this.setData({
        localCandidate: Object.assign({}, this.data.localCandidate, patch),
      });
    },

    onFieldBlur(event) {
      const field = event.currentTarget.dataset.field;
      if (field !== "targetTime") return;
      const raw = String(event.detail.value || "").trim();
      const patch = {};
      if (!raw) {
        patch.targetTime = "";
      } else {
        const result = eventParser.extractTime(raw);
        if (!result.time) {
          this.notice("时间可写 08:00 或 八点半");
          patch.targetTime = "";
        } else {
          patch.targetTime = result.time;
        }
      }
      this.setData({
        localCandidate: Object.assign({}, this.data.localCandidate, patch),
      });
    },

    onGenerate() {
      const candidate = Object.assign({}, this.data.localCandidate, {
        rawText: this.data.localRawText,
        title: String(this.data.localCandidate.title || "").trim(),
        targetDate: String(this.data.localCandidate.targetDate || "").trim(),
        targetTime: String(this.data.localCandidate.targetTime || "").trim(),
      });
      if (!candidate.title || !candidate.targetDate) {
        this.notice("补全标题和日期后再生成");
        return;
      }
      if (candidate.targetTime) {
        const result = eventParser.extractTime(candidate.targetTime);
        if (!result.time) {
          this.notice("时间可写 08:00 或 八点半");
          return;
        }
        candidate.targetTime = result.time;
      }
      this.triggerEvent("confirm", candidate);
    },

    onDragStart(event) {
      const touch = event.touches && event.touches[0];
      this.dragStartY = touch ? touch.clientY : 0;
    },

    onDragMove(event) {
      const touch = event.touches && event.touches[0];
      if (!touch || !this.dragStartY) return;
      const delta = touch.clientY - this.dragStartY;
      const offset = delta < 0 ? Math.max(delta * 0.22, -24) : delta;
      this.setData({ dragOffset: offset });
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
