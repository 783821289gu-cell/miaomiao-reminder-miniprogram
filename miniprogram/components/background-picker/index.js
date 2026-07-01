Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    mode: {
      type: String,
      value: "theme",
    },
    backgrounds: {
      type: Array,
      value: [],
    },
    selectedId: {
      type: String,
      value: "",
    },
    customCount: {
      type: Number,
      value: 0,
    },
    customLimit: {
      type: Number,
      value: 3,
    },
    unlimited: {
      type: Boolean,
      value: false,
    },
  },

  methods: {
    noop() {},

    onClose() {
      this.triggerEvent("close");
    },

    onSelect(event) {
      this.triggerEvent("select", { id: event.currentTarget.dataset.id });
    },

    onDelete(event) {
      this.triggerEvent("delete", { id: event.currentTarget.dataset.id });
    },

    onImport() {
      this.triggerEvent("import");
    },
  },
});
