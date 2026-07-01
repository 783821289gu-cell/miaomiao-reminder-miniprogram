function clamp(value, min, max) {
  if (min > max) return (min + max) / 2;
  return Math.max(min, Math.min(max, value));
}

function normalizeCanvasImagePath(path, fallback) {
  const value = String(path || fallback || "").trim();
  if (!value) return "";
  if (/^(wxfile|http|https|file):\/\//.test(value) || value.charAt(0) === "/") return value;
  return `/${value}`;
}

function getTouchPoint(touch, event) {
  const target = (event && event.currentTarget) || {};
  const x = Number.isFinite(Number(touch && touch.x))
    ? Number(touch.x)
    : Number(touch && touch.clientX) - Number(target.offsetLeft || 0);
  const y = Number.isFinite(Number(touch && touch.y))
    ? Number(touch.y)
    : Number(touch && touch.clientY) - Number(target.offsetTop || 0);
  return { x, y };
}

function getDistance(first, second) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  return Math.sqrt(dx * dx + dy * dy);
}

Component({
  properties: {
    show: {
      type: Boolean,
      value: false,
      observer(value) {
        if (value && this.properties.src) this.loadImage();
      },
    },
    src: {
      type: String,
      value: "",
      observer(value) {
        if (value && this.properties.show) this.loadImage();
      },
    },
  },

  data: {
    imagePath: "",
    frameWidth: 260,
    frameHeight: 462,
    displayWidth: 260,
    displayHeight: 462,
    imageLeft: 0,
    imageTop: 0,
    scale: 1,
    ready: false,
    busy: false,
  },

  methods: {
    noop() {},

    emitNotice(text) {
      this.triggerEvent("notice", { text });
    },

    loadImage() {
      const src = this.properties.src;
      if (!src) return;
      const system = wx.getWindowInfo ? wx.getWindowInfo() : { windowWidth: 375 };
      const frameWidth = Math.floor(Math.min((system.windowWidth || 375) - 96, 286));
      const frameHeight = Math.floor(frameWidth * 16 / 9);
      this.setData({
        imagePath: src,
        frameWidth,
        frameHeight,
        ready: false,
        busy: false,
      });
      wx.getImageInfo({
        src,
        success: (info) => {
          this.imageInfo = info;
          this.applyLayout(1.18, 0, 0);
          this.setData({ ready: true });
        },
        fail: () => {
          this.emitNotice("图片读取失败，换一张试试");
          this.onCancel();
        },
      });
    },

    getLayout(scale, offsetX, offsetY) {
      const info = this.imageInfo || {};
      const frameWidth = this.data.frameWidth;
      const frameHeight = this.data.frameHeight;
      const imageWidth = Number(info.width || frameWidth);
      const imageHeight = Number(info.height || frameHeight);
      const coverScale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
      const nextScale = clamp(scale || 1, 1, 2.6);
      const displayWidth = imageWidth * coverScale * nextScale;
      const displayHeight = imageHeight * coverScale * nextScale;
      let imageLeft = (frameWidth - displayWidth) / 2 + (offsetX || 0);
      let imageTop = (frameHeight - displayHeight) / 2 + (offsetY || 0);
      imageLeft = clamp(imageLeft, frameWidth - displayWidth, 0);
      imageTop = clamp(imageTop, frameHeight - displayHeight, 0);
      return {
        scale: nextScale,
        displayWidth,
        displayHeight,
        imageLeft,
        imageTop,
        offsetX: imageLeft - (frameWidth - displayWidth) / 2,
        offsetY: imageTop - (frameHeight - displayHeight) / 2,
      };
    },

    applyLayout(scale, offsetX, offsetY) {
      const layout = this.getLayout(scale, offsetX, offsetY);
      this.currentOffsetX = layout.offsetX;
      this.currentOffsetY = layout.offsetY;
      this.setData({
        scale: layout.scale,
        displayWidth: layout.displayWidth,
        displayHeight: layout.displayHeight,
        imageLeft: layout.imageLeft,
        imageTop: layout.imageTop,
      });
    },

    onTouchStart(event) {
      if (!this.data.ready) return;
      const touches = event.touches || [];
      if (touches.length >= 2) {
        const first = getTouchPoint(touches[0], event);
        const second = getTouchPoint(touches[1], event);
        const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        this.pinchStart = {
          distance: Math.max(1, getDistance(first, second)),
          scale: this.data.scale,
          midpoint,
          imageLeft: this.data.imageLeft,
          imageTop: this.data.imageTop,
          displayWidth: this.data.displayWidth,
          displayHeight: this.data.displayHeight,
          focusX: (midpoint.x - this.data.imageLeft) / this.data.displayWidth,
          focusY: (midpoint.y - this.data.imageTop) / this.data.displayHeight,
        };
        this.startTouchX = undefined;
        this.startTouchY = undefined;
        return;
      }
      const touch = touches[0];
      if (!touch) return;
      const point = getTouchPoint(touch, event);
      this.pinchStart = null;
      this.startTouchX = point.x;
      this.startTouchY = point.y;
      this.startOffsetX = this.currentOffsetX || 0;
      this.startOffsetY = this.currentOffsetY || 0;
    },

    onTouchMove(event) {
      if (!this.data.ready) return;
      const touches = event.touches || [];
      if (touches.length >= 2) {
        const first = getTouchPoint(touches[0], event);
        const second = getTouchPoint(touches[1], event);
        if (!this.pinchStart) {
          this.onTouchStart(event);
          return;
        }
        const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        const nextScale = clamp(
          this.pinchStart.scale * getDistance(first, second) / this.pinchStart.distance,
          1,
          2.6,
        );
        const info = this.imageInfo || {};
        const coverScale = Math.max(
          this.data.frameWidth / Number(info.width || this.data.frameWidth),
          this.data.frameHeight / Number(info.height || this.data.frameHeight),
        );
        const displayWidth = Number(info.width || this.data.frameWidth) * coverScale * nextScale;
        const displayHeight = Number(info.height || this.data.frameHeight) * coverScale * nextScale;
        const desiredLeft = midpoint.x - this.pinchStart.focusX * displayWidth;
        const desiredTop = midpoint.y - this.pinchStart.focusY * displayHeight;
        this.applyLayout(
          nextScale,
          desiredLeft - (this.data.frameWidth - displayWidth) / 2,
          desiredTop - (this.data.frameHeight - displayHeight) / 2,
        );
        return;
      }
      const touch = touches[0];
      if (!touch || this.startTouchX === undefined) return;
      const point = getTouchPoint(touch, event);
      this.applyLayout(
        this.data.scale,
        this.startOffsetX + point.x - this.startTouchX,
        this.startOffsetY + point.y - this.startTouchY,
      );
    },

    onTouchEnd(event) {
      const touches = (event && event.touches) || [];
      if (touches.length === 1) {
        const point = getTouchPoint(touches[0], event);
        this.startTouchX = point.x;
        this.startTouchY = point.y;
        this.startOffsetX = this.currentOffsetX || 0;
        this.startOffsetY = this.currentOffsetY || 0;
      } else {
        this.startTouchX = undefined;
        this.startTouchY = undefined;
      }
      this.pinchStart = null;
    },

    onZoomIn() {
      this.applyLayout(this.data.scale + 0.16, this.currentOffsetX || 0, this.currentOffsetY || 0);
    },

    onZoomOut() {
      this.applyLayout(this.data.scale - 0.16, this.currentOffsetX || 0, this.currentOffsetY || 0);
    },

    onReset() {
      this.applyLayout(1.18, 0, 0);
    },

    onCancel() {
      if (this.data.busy) return;
      this.triggerEvent("close");
    },

    onConfirm() {
      if (!this.data.ready || this.data.busy || !this.imageInfo) return;
      this.setData({ busy: true });
      const query = this.createSelectorQuery();
      query.select("#cropCanvas").fields({ node: true, size: true }).exec((res) => {
        const canvas = res && res[0] && res[0].node;
        if (!canvas) {
          this.setData({ busy: false });
          this.emitNotice("裁剪组件没有准备好");
          return;
        }
        const sourceScale = this.data.displayWidth / this.imageInfo.width;
        const sx = Math.max(0, -this.data.imageLeft / sourceScale);
        const sy = Math.max(0, -this.data.imageTop / sourceScale);
        const sw = Math.min(this.imageInfo.width - sx, this.data.frameWidth / sourceScale);
        const sh = Math.min(this.imageInfo.height - sy, this.data.frameHeight / sourceScale);
        const outputWidth = 1440;
        const outputHeight = Math.round(outputWidth * 16 / 9);
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const ctx = canvas.getContext("2d");
        const img = canvas.createImage();
        img.onload = () => {
          ctx.clearRect(0, 0, outputWidth, outputHeight);
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
          wx.canvasToTempFilePath({
            canvas,
            destWidth: outputWidth,
            destHeight: outputHeight,
            fileType: "jpg",
            quality: 0.98,
            success: (result) => {
              this.setData({ busy: false });
              this.triggerEvent("confirm", {
                tempFilePath: result.tempFilePath,
                cropInfo: { ratio: "9:16", sx, sy, sw, sh, outputWidth, outputHeight, quality: 0.98 },
              });
            },
            fail: (error) => {
              this.setData({ busy: false });
              this.emitNotice((error && error.errMsg) || "裁剪失败，请重试");
            },
          }, this);
        };
        img.onerror = () => {
          this.setData({ busy: false });
          this.emitNotice("图片绘制失败，换一张试试");
        };
        img.src = normalizeCanvasImagePath(this.imageInfo.path, this.properties.src);
      });
    },
  },
});
