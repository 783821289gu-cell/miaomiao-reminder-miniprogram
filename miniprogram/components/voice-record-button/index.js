const speechService = require("../../services/speech-to-text");
const speechConfig = require("../../config/aliyun-speech");

const START_DELAY_MS = 260;

function errorDetail(error, fallback) {
  if (!error) return { errMsg: fallback };
  if (typeof error === "string") return { errMsg: error || fallback };
  const message = error.errMsg || error.message || error.msg || fallback;
  return {
    errMsg: String(message || fallback),
    code: error.code || error.errCode || "",
  };
}

function createRequestId() {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

Component({
  data: {
    pressing: false,
    recording: false,
    seconds: 0,
    canceling: false,
  },

  lifetimes: {
    attached() {
      this.recorder = wx.getRecorderManager ? wx.getRecorderManager() : null;
      if (!this.recorder) return;

      this.recorder.onStop((result) => {
        this.stopTimer();
        const canceled = this.ignoreResult;
        const shortPress = this.shortPress;
        this.shortPress = false;
        this.recordStartTime = 0;
        this.setData({ pressing: false, recording: false, seconds: 0, canceling: false });
        if (canceled) {
          this.ignoreResult = false;
          if (this.realtimeRecognizer) {
            this.realtimeRecognizer.cancel();
            this.realtimeRecognizer = null;
          }
          if (shortPress) {
            this.triggerEvent("error", { errMsg: "按住说完再松手" });
            return;
          }
          this.triggerEvent("cancel");
          return;
        }
        if (this.realtimeRecognizer) {
          this.realtimeRecognizer.finish();
        } else {
          this.triggerEvent("error", { requestId: this.currentRequestId, errMsg: "语音识别暂时不可用" });
        }
      });

      if (this.recorder.onFrameRecorded) {
        this.recorder.onFrameRecorded((frame) => {
          if (this.ignoreResult || !this.realtimeRecognizer || !frame || !frame.frameBuffer) return;
          this.realtimeRecognizer.sendFrame(frame.frameBuffer);
        });
      }

      this.recorder.onError((error) => {
        this.stopTimer();
        this.ignoreResult = false;
        if (this.realtimeRecognizer) {
          this.realtimeRecognizer.cancel();
          this.realtimeRecognizer = null;
        }
        this.setData({ pressing: false, recording: false, seconds: 0, canceling: false });
        this.triggerEvent("error", errorDetail(error, "录音失败，请再试一次"));
      });
    },

    detached() {
      this.stopTimer();
      this.clearStartupTimer();
      this.ignoreResult = true;
      if (this.realtimeRecognizer) {
        this.realtimeRecognizer.cancel();
        this.realtimeRecognizer = null;
      }
      if (this.recorder && this.data.recording) {
        try {
          this.recorder.stop();
        } catch (error) {
          // Ignore teardown errors.
        }
      }
    },
  },

  methods: {
    onTouchStart(event) {
      if (this.data.recording) return;
      const touch = event.touches && event.touches[0];
      this.touching = true;
      this.ignoreResult = false;
      this.startY = touch ? touch.clientY : 0;
      this.setData({ pressing: true, canceling: false });
      this.clearStartupTimer();
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        if (!this.touching) {
          this.setData({ pressing: false, canceling: false });
          return;
        }
        this.requestRecordPermission();
      }, START_DELAY_MS);
    },

    onTouchMove(event) {
      const touch = event.touches && event.touches[0];
      if (!touch || !this.data.recording) return;
      if (!this.startY) this.startY = touch.clientY;
      const canceling = this.startY - touch.clientY > 90;
      if (canceling !== this.data.canceling) {
        this.setData({ canceling });
      }
    },

    onTouchEnd() {
      this.touching = false;
      if (this.startupTimer) {
        this.clearStartupTimer();
        this.setData({ pressing: false, canceling: false });
        return;
      }
      if (!this.data.recording) {
        this.setData({ pressing: false, canceling: false });
        return;
      }
      this.finishRecord(this.data.canceling);
    },

    onTouchCancel() {
      this.touching = false;
      if (this.startupTimer) {
        this.clearStartupTimer();
        this.setData({ pressing: false, canceling: false });
        return;
      }
      if (this.data.recording) {
        this.finishRecord(true);
      } else {
        this.setData({ pressing: false, canceling: false });
      }
    },

    requestRecordPermission() {
      if (!this.recorder) {
        this.setData({ pressing: false, recording: false, canceling: false });
        this.triggerEvent("error", { errMsg: "当前微信版本不支持录音" });
        return;
      }

      wx.authorize({
        scope: "scope.record",
        success: () => {
          if (!this.touching) {
            this.setData({ pressing: false, recording: false, canceling: false });
            return;
          }
          this.startRecord();
        },
        fail: () => {
          this.setData({ pressing: false, recording: false, canceling: false });
          this.triggerEvent("error", { errMsg: "请先允许麦克风权限" });
        },
      });
    },

    startRecord() {
      try {
        this.currentRequestId = createRequestId();
        const requestId = this.currentRequestId;
        this.realtimeRecognizer = speechService.createRealtimeRecognizer({
          onFinish: (result) => {
            if (this.currentRequestId !== requestId) return;
            this.realtimeRecognizer = null;
            this.triggerEvent("finish", {
              rawText: result.rawText || "",
              sid: result.sid || "",
              timing: result.timing || null,
              requestId,
            });
          },
          onError: (error) => {
            if (this.currentRequestId !== requestId) return;
            this.realtimeRecognizer = null;
            if (this.data.recording && this.recorder) {
              this.ignoreResult = true;
              try {
                this.recorder.stop();
              } catch (stopError) {
                // Ignore stop errors after recognizer failure.
              }
            }
            this.stopTimer();
            this.setData({ pressing: false, recording: false, seconds: 0, canceling: false });
            this.triggerEvent("error", Object.assign(
              { requestId },
              errorDetail(error, "语音识别失败，请再试一次"),
            ));
          },
        });
        this.realtimeRecognizer.start();
        this.setData({ pressing: true, recording: true, seconds: 0, canceling: false });
        this.recordStartTime = Date.now();
        this.shortPress = false;
        this.startTimer();
        this.triggerEvent("start", { requestId: this.currentRequestId });
        this.recorder.start({
          duration: 60000,
          sampleRate: speechConfig.sampleRate,
          numberOfChannels: speechConfig.numberOfChannels,
          encodeBitRate: 96000,
          format: "pcm",
          frameSize: 4,
        });
      } catch (error) {
        this.stopTimer();
        if (this.realtimeRecognizer) {
          this.realtimeRecognizer.cancel();
          this.realtimeRecognizer = null;
        }
        this.setData({ pressing: false, recording: false, seconds: 0, canceling: false });
        this.triggerEvent("error", errorDetail(error, "录音启动失败"));
      }
    },

    finishRecord(canceled) {
      const elapsed = Date.now() - (this.recordStartTime || Date.now());
      this.shortPress = !canceled && elapsed < 700;
      this.ignoreResult = !!canceled || this.shortPress;
      this.stopTimer();
      this.setData({ pressing: false, recording: false, seconds: 0, canceling: false });
      if (!canceled && !this.shortPress) {
        this.triggerEvent("processing", { requestId: this.currentRequestId });
      }
      try {
        this.recorder.stop();
      } catch (error) {
        this.ignoreResult = false;
        if (this.realtimeRecognizer) {
          this.realtimeRecognizer.cancel();
          this.realtimeRecognizer = null;
        }
        if (!canceled) {
          this.triggerEvent("error", errorDetail(error, "录音结束失败"));
        }
      }
    },

    startTimer() {
      this.stopTimer();
      this.recordTimer = setInterval(() => {
        this.setData({ seconds: this.data.seconds + 1 });
      }, 1000);
    },

    stopTimer() {
      if (this.recordTimer) {
        clearInterval(this.recordTimer);
        this.recordTimer = null;
      }
    },

    clearStartupTimer() {
      if (this.startupTimer) {
        clearTimeout(this.startupTimer);
        this.startupTimer = null;
      }
    },
  },
});
