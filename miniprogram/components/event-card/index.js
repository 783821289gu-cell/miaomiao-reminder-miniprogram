Component({
  properties: {
    event: {
      type: Object,
      value: {},
      observer() {
        this.closeSwipe();
      },
    },
    index: {
      type: Number,
      value: 0,
    },
  },

  data: {
    offsetX: 0,
    deleteWidth: 92,
    deleteButtonWidth: 88,
    opened: false,
    dragging: false,
  },

  methods: {
    closeSwipe() {
      this.setData({ offsetX: 0, opened: false, dragging: false });
    },

    onTap() {
      if (this.data.opened) {
        this.closeSwipe();
        return;
      }
      if (this.justDragged) return;
      this.triggerEvent("tapcard", { event: this.data.event });
    },

    onDeleteTap() {
      const current = this.data.event;
      this.closeSwipe();
      this.triggerEvent("deletecard", { event: current });
    },

    getTouchY(event) {
      const touch = event.touches && event.touches[0];
      const changed = event.changedTouches && event.changedTouches[0];
      return touch ? touch.clientY : (changed ? changed.clientY : (this.startY || 0));
    },

    onPinDragStart(event) {
      if (!this.data.event || !this.data.event.isPinned) return;
      this.pinDragging = true;
      this.closeSwipe();
      this.triggerEvent("pindragstart", {
        id: this.data.event.id,
        event: this.data.event,
        index: this.data.index,
        y: this.getTouchY(event),
      });
    },

    onPinDragMove(event) {
      if (!this.pinDragging) return;
      this.triggerEvent("pindragmove", {
        id: this.data.event.id,
        event: this.data.event,
        index: this.data.index,
        y: this.getTouchY(event),
      });
    },

    onPinDragEnd(event) {
      if (!this.pinDragging) return;
      this.pinDragging = false;
      this.triggerEvent("pindragend", {
        id: this.data.event.id,
        event: this.data.event,
        index: this.data.index,
        y: this.getTouchY(event),
      });
    },

    onLongPress(event) {
      if (!this.data.event || !this.data.event.isPinned || this.data.opened) return;
      this.pinDragging = true;
      this.dragLocked = false;
      this.justDragged = true;
      this.closeSwipe();
      this.triggerEvent("pindragstart", {
        id: this.data.event.id,
        event: this.data.event,
        index: this.data.index,
        y: this.getTouchY(event),
      });
    },

    onTouchStart(event) {
      if (this.pinDragging) return;
      const touch = event.touches && event.touches[0];
      this.startX = touch ? touch.clientX : 0;
      this.startY = touch ? touch.clientY : 0;
      this.startOffsetX = this.data.offsetX || 0;
      this.dragLocked = false;
      this.justDragged = false;
    },

    onTouchMove(event) {
      if (this.pinDragging) {
        this.triggerEvent("pindragmove", {
          id: this.data.event.id,
          event: this.data.event,
          index: this.data.index,
          y: this.getTouchY(event),
        });
        return;
      }
      const touch = event.touches && event.touches[0];
      if (!touch) return;
      const deltaX = touch.clientX - this.startX;
      const deltaY = touch.clientY - this.startY;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (!this.dragLocked) {
        if (absX < 10 && absY < 10) return;
        if (absY > absX) return;
        this.dragLocked = true;
        this.justDragged = true;
      }

      const next = Math.max(-this.data.deleteWidth, Math.min(0, this.startOffsetX + deltaX));
      this.setData({ offsetX: next, dragging: true });
    },

    onTouchEnd() {
      if (this.pinDragging) {
        this.pinDragging = false;
        this.triggerEvent("pindragend", {
          id: this.data.event.id,
          event: this.data.event,
          index: this.data.index,
          y: 0,
        });
        setTimeout(() => {
          this.justDragged = false;
        }, 220);
        return;
      }
      if (!this.dragLocked) return;
      const opened = this.data.offsetX < -this.data.deleteWidth / 2;
      this.setData({
        offsetX: opened ? -this.data.deleteWidth : 0,
        opened,
        dragging: false,
      });
      setTimeout(() => {
        this.justDragged = false;
      }, 180);
    },
  },
});
