Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    event: {
      type: Object,
      value: {},
    },
  },

  methods: {
    onClose() {
      this.triggerEvent("close");
    },

    noop() {},

    onEdit() {
      this.triggerEvent("edit", { event: this.data.event });
    },

    onBackground() {
      this.triggerEvent("background", { event: this.data.event });
    },

    onDelete() {
      this.triggerEvent("delete", { event: this.data.event });
    },
  },
});
