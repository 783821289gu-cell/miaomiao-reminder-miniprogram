const env = require("../config/env");
const speechConfig = require("../config/aliyun-speech");
const protocol = require("./dashscope-protocol");

const MAX_BUFFERED_AUDIO_BYTES = 2 * 1024 * 1024;
let activeSpeechSession = null;

function normalizeError(error) {
  const code = error && (error.code || error.errCode || error.errorCode);
  const message = String((error && (error.errMsg || error.message || error.msg)) || error || "");
  if (/scope\.record|microphone|麦克风|authorize.*record|auth deny/i.test(message)) {
    return { errMsg: "请先允许麦克风权限", code: code || "" };
  }
  if (/cloud|callFunction|FunctionName|未开通|环境|env/i.test(message)) {
    return { errMsg: "请先开通云开发并部署阿里云语音凭证云函数", code: code || "" };
  }
  if (/url not in domain|合法域名|not in domain list|domain/i.test(message)) {
    return { errMsg: "请先把 dashscope.aliyuncs.com 加到小程序 socket 合法域名", code: code || "" };
  }
  if (/DASHSCOPE_API_KEY_MISSING|缺少.*DASHSCOPE_API_KEY/i.test(message)) {
    return { errMsg: "请先在云函数环境变量配置阿里云百炼 API Key", code: code || "" };
  }
  if (/401|403|InvalidApiKey|Unauthorized|authorization|鉴权|认证/i.test(`${code || ""} ${message}`)) {
    return { errMsg: "阿里云语音鉴权失败，请检查北京地域的百炼 API Key", code: code || "" };
  }
  if (/DASHSCOPE_RATE_LIMITED|LOCAL_RATE_LIMITED|429|Throttling|RateQuota|BurstRate|请求较多|限流/i.test(`${code || ""} ${message}`)) {
    return { errMsg: "语音识别请求较多，请稍后再试", code: code || "DASHSCOPE_RATE_LIMITED", retryable: true };
  }
  if (/Model.*not.*found|model.*access|AccessDenied|forbidden/i.test(message)) {
    return { errMsg: "阿里云实时语音模型未开通或当前 Key 无权限", code: code || "" };
  }
  if (/timeout|time out|超时/i.test(message)) {
    return { errMsg: "语音识别超时，请再试一次", code: code || "" };
  }
  if (/too short|时间太短|NO_VALID_AUDIO/i.test(message)) {
    return { errMsg: "说话时间太短，请重新长按说话", code: code || "" };
  }
  if (/DASHSCOPE_SESSION_BUSY|上一段语音仍在识别/i.test(`${code || ""} ${message}`)) {
    return { errMsg: "上一段语音仍在识别，请稍等", code: code || "DASHSCOPE_SESSION_BUSY", retryable: true };
  }
  return { errMsg: message || "语音识别失败，请再试一次", code: code || "" };
}

function getAccessInfo() {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || !wx.cloud.callFunction) {
      reject(new Error("cloud callFunction unavailable"));
      return;
    }
    wx.cloud.callFunction({
      name: env.functions.getDashScopeToken,
      data: {},
      success: (response) => {
        const result = response.result || {};
        if (!result.ok || !result.token) {
          const error = new Error(result.errMsg || "missing DashScope temporary token");
          error.code = result.code || "DASHSCOPE_TOKEN_FAILED";
          reject(error);
          return;
        }
        if (result.expiresAt && Number(result.expiresAt) <= Math.floor(Date.now() / 1000) + 10) {
          reject(new Error("DashScope temporary token expired"));
          return;
        }
        resolve(result);
      },
      fail: reject,
    });
  });
}

function mergeBytes(left, right) {
  if (!left || !left.length) return new Uint8Array(right);
  if (!right || !right.length) return new Uint8Array(left);
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}

function normalizeTranscript(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function createRealtimeRecognizer(options) {
  const callbacks = options || {};
  let socketTask = null;
  let settled = false;
  let socketOpen = false;
  let taskStarted = false;
  let finishRequested = false;
  let finishTaskQueued = false;
  let inputFrameCount = 0;
  let audioBytes = 0;
  let audioRemainder = new Uint8Array(0);
  let transcriptState = { committed: "", partial: "" };
  let timeoutTimer = null;
  let sending = false;
  const pendingAudio = [];
  const outboundQueue = [];
  const taskId = protocol.createTaskId();
  const sessionId = `speech_${taskId}`;
  const startedAt = Date.now();
  const timing = {
    authMs: 0,
    socketOpenMs: 0,
    taskStartedMs: 0,
    firstFrameMs: 0,
    firstTextMs: 0,
    finalMs: 0,
    frames: 0,
    audioBytes: 0,
  };

  function clearTimer() {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
  }

  function releaseSession() {
    if (activeSpeechSession === sessionId) activeSpeechSession = null;
  }

  function safeClose() {
    if (!socketTask) return;
    try {
      socketTask.close({ code: 1000, reason: "finished" });
    } catch (error) {
      // The socket may already be closed after a task failure.
    }
  }

  function fail(error) {
    if (settled) return;
    settled = true;
    clearTimer();
    outboundQueue.length = 0;
    pendingAudio.length = 0;
    safeClose();
    releaseSession();
    if (callbacks.onError) callbacks.onError(normalizeError(error));
  }

  function finish(result) {
    if (settled) return;
    settled = true;
    clearTimer();
    safeClose();
    releaseSession();
    if (callbacks.onFinish) callbacks.onFinish(result);
  }

  function drainOutboundQueue() {
    if (sending || settled || !socketOpen || !socketTask || !outboundQueue.length) return;
    const item = outboundQueue.shift();
    sending = true;
    if (item.kind === "audio" && !timing.firstFrameMs) {
      timing.firstFrameMs = Date.now() - startedAt;
    }
    socketTask.send({
      data: item.data,
      success: () => {
        sending = false;
        drainOutboundQueue();
      },
      fail: (error) => {
        sending = false;
        fail(error);
      },
    });
  }

  function enqueue(kind, data) {
    if (settled) return;
    outboundQueue.push({ kind, data });
    drainOutboundQueue();
  }

  function enqueueJson(payload) {
    enqueue("control", JSON.stringify(payload));
  }

  function enqueueAudio(bytes) {
    if (!bytes || !bytes.length) return;
    const copy = bytes.slice();
    enqueue("audio", copy.buffer);
  }

  function flushPendingAudio() {
    if (!taskStarted || settled) return;
    while (pendingAudio.length) {
      enqueueAudio(pendingAudio.shift());
    }
    if (finishRequested && !finishTaskQueued) {
      if (audioRemainder.length) {
        enqueueAudio(audioRemainder);
        audioRemainder = new Uint8Array(0);
      }
      finishTaskQueued = true;
      enqueueJson(protocol.buildFinishTask(taskId));
    }
  }

  function queueCompleteChunk(bytes) {
    if (taskStarted) {
      enqueueAudio(bytes);
      return;
    }
    pendingAudio.push(bytes.slice());
  }

  function appendAudio(frameBuffer) {
    const incoming = new Uint8Array(frameBuffer);
    if (!incoming.length) return;
    inputFrameCount += 1;
    audioBytes += incoming.length;
    if (audioBytes > MAX_BUFFERED_AUDIO_BYTES) {
      fail(new Error("语音内容过长，请分成多次记录"));
      return;
    }
    const chunkBytes = Number(speechConfig.audioChunkBytes || 3200);
    const merged = mergeBytes(audioRemainder, incoming);
    let offset = 0;
    while (merged.length - offset >= chunkBytes) {
      queueCompleteChunk(merged.slice(offset, offset + chunkBytes));
      offset += chunkBytes;
    }
    audioRemainder = merged.slice(offset);
  }

  function handleServerMessage(message) {
    let payload;
    try {
      payload = typeof message.data === "string"
        ? JSON.parse(message.data)
        : JSON.parse(String(message.data || "{}"));
    } catch (error) {
      fail(error);
      return;
    }
    const header = payload.header || {};
    const eventName = header.event;
    if (header.task_id && header.task_id !== taskId) return;

    if (eventName === "task-started") {
      taskStarted = true;
      timing.taskStartedMs = Date.now() - startedAt;
      flushPendingAudio();
      return;
    }
    if (eventName === "result-generated") {
      transcriptState = protocol.applyRecognitionResult(transcriptState, payload);
      const currentText = normalizeTranscript(transcriptState.displayText);
      if (currentText && !timing.firstTextMs) timing.firstTextMs = Date.now() - startedAt;
      if (currentText && callbacks.onPartialText) callbacks.onPartialText(currentText);
      return;
    }
    if (eventName === "task-failed") {
      fail({
        code: header.error_code || "DASHSCOPE_TASK_FAILED",
        errMsg: header.error_message || "阿里云语音识别任务失败",
      });
      return;
    }
    if (eventName === "task-finished") {
      const rawText = normalizeTranscript(`${transcriptState.committed}${transcriptState.partial}`);
      if (!rawText) {
        fail(new Error("没有识别到有效内容"));
        return;
      }
      timing.finalMs = Date.now() - startedAt;
      timing.frames = inputFrameCount;
      timing.audioBytes = audioBytes;
      if (speechConfig.debugTiming) {
        console.info("[voice-realtime timing]", timing);
      }
      finish({ rawText, sid: taskId, taskId, timing });
    }
  }

  function start() {
    if (activeSpeechSession && activeSpeechSession !== sessionId) {
      const error = new Error("上一段语音仍在识别，请稍等");
      error.code = "DASHSCOPE_SESSION_BUSY";
      fail(error);
      return;
    }
    activeSpeechSession = sessionId;
    timeoutTimer = setTimeout(() => fail(new Error("speech recognize timeout")), speechConfig.timeoutMs || 70000);
    getAccessInfo()
      .then((accessInfo) => {
        if (settled) return;
        timing.authMs = Date.now() - startedAt;
        const header = {
          Authorization: `Bearer ${accessInfo.token}`,
        };
        if (accessInfo.workspaceId) {
          header["X-DashScope-WorkSpace"] = accessInfo.workspaceId;
        }
        socketTask = wx.connectSocket({
          url: accessInfo.endpoint || speechConfig.endpoint,
          header,
          tcpNoDelay: true,
          fail,
        });
        socketTask.onOpen(() => {
          socketOpen = true;
          timing.socketOpenMs = Date.now() - startedAt;
          if (callbacks.onOpen) callbacks.onOpen({ timing });
          enqueueJson(protocol.buildRunTask(taskId, speechConfig));
        });
        socketTask.onMessage(handleServerMessage);
        socketTask.onError(fail);
        socketTask.onClose(() => {
          socketOpen = false;
          if (!settled) {
            const currentText = normalizeTranscript(`${transcriptState.committed}${transcriptState.partial}`);
            fail(new Error(currentText ? "语音识别连接提前关闭" : "语音识别连接失败"));
          }
        });
      })
      .catch(fail);
  }

  return {
    start,
    sendFrame(frameBuffer) {
      if (settled || finishRequested || !frameBuffer) return;
      appendAudio(frameBuffer);
    },
    finish() {
      if (settled || finishRequested) return;
      finishRequested = true;
      if (inputFrameCount < 2 || audioBytes < 1600) {
        fail(new Error("NO_VALID_AUDIO: too short"));
        return;
      }
      flushPendingAudio();
    },
    cancel() {
      if (settled) return;
      settled = true;
      clearTimer();
      outboundQueue.length = 0;
      pendingAudio.length = 0;
      safeClose();
      releaseSession();
    },
  };
}

module.exports = {
  createRealtimeRecognizer,
};
