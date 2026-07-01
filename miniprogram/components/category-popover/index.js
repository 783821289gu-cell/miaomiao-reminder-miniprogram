Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
    },
    categories: {
      type: Array,
      value: [],
    },
    selectedId: {
      type: String,
      value: "all",
    },
  },

  methods: {
    onClose() {
      this.triggerEvent("close");
    },

    noop() {},

    onSelect(event) {
      this.triggerEvent("select", { id: event.currentTarget.dataset.id });
    },

    onAdd() {
      this.triggerEvent("add");
    },

    onDelete(event) {
      this.triggerEvent("delete", { id: event.currentTarget.dataset.id });
    },
  },
});
