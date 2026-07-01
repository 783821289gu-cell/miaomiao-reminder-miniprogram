Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: "确认操作",
    },
    content: {
      type: String,
      value: "",
    },
    cancelText: {
      type: String,
      value: "取消",
    },
    confirmText: {
      type: String,
      value: "确定",
    },
  },

  methods: {
    noop() {},

    onCancel() {
      this.triggerEvent("cancel");
    },

    onConfirm() {
      this.triggerEvent("confirm");
    },
  },
});
