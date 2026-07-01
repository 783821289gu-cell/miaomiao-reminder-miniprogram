Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    name: "",
    selectedIcon: "/assets/original/icon_calendar.png",
    iconOptions: [
      "/assets/original/icon_calendar.png",
      "/assets/original/icon_tab_work.png",
      "/assets/original/icon_tab_family.png",
      "/assets/original/icon_tab_life.png",
      "/assets/original/icon_256_transparent.png",
      "/assets/original/icon_plus_paw.png",
    ],
  },

  observers: {
    show(value) {
      if (value) this.setData({ name: "", selectedIcon: "/assets/original/icon_calendar.png" });
    },
  },

  methods: {
    noop() {},

    onClose() {
      this.triggerEvent("close");
    },

    onInput(event) {
      this.setData({ name: event.detail.value });
    },

    onIconSelect(event) {
      this.setData({ selectedIcon: event.currentTarget.dataset.icon });
    },

    onConfirm() {
      this.triggerEvent("confirm", { name: this.data.name, icon: this.data.selectedIcon });
    },
  },
});
