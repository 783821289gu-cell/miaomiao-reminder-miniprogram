Component({
  properties: {
    show: {
      type: Boolean,
      value: true,
    },
  },

  methods: {
    onClose() {
      this.triggerEvent("close");
    },

    onNever() {
      this.triggerEvent("never");
    },
  },
});
