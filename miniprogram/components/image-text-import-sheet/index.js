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
        this.setData({ localText: value || "" });
      },
    },
    aiEnabled: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    localText: "",
    dragOffset: 0,
  },

  methods: {
    noop() {},

    onClose() {
      this.setData({ dragOffset: 0 });
      this.triggerEvent("close");
    },

    onTextInput(event) {
      this.setData({ localText: event.detail.value });
    },

    onParseText() {
      this.triggerEvent("parsetext", { rawText: this.data.localText });
    },

    onParseImage() {
      this.triggerEvent("parseimage");
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
