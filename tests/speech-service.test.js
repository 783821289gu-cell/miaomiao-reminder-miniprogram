const assert = require("assert");

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function main() {
  const sent = [];
  const handlers = {};
  let connectOptions = null;
  const socket = {
    send(options) {
      sent.push(options.data);
      setTimeout(() => options.success && options.success(), 0);
    },
    close() {},
    onOpen(callback) { handlers.open = callback; },
    onMessage(callback) { handlers.message = callback; },
    onError(callback) { handlers.error = callback; },
    onClose(callback) { handlers.close = callback; },
  };

  global.wx = {
    cloud: {
      callFunction(options) {
        setTimeout(() => options.success({
          result: {
            ok: true,
            token: "st-test-token",
            expiresAt: Math.floor(Date.now() / 1000) + 180,
            endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
          },
        }), 0);
      },
    },
    connectSocket(options) {
      connectOptions = options;
      return socket;
    },
  };

  const speechService = require("../miniprogram/services/speech-to-text");
  let finalResult = null;
  let finalError = null;
  const recognizer = speechService.createRealtimeRecognizer({
    onFinish(result) { finalResult = result; },
    onError(error) { finalError = error; },
  });

  recognizer.start();
  recognizer.sendFrame(new Uint8Array(2000).buffer);
  recognizer.sendFrame(new Uint8Array(2000).buffer);
  await tick();
  await tick();

  assert.strictEqual(connectOptions.url, "wss://dashscope.aliyuncs.com/api-ws/v1/inference");
  assert.strictEqual(connectOptions.header.Authorization, "Bearer st-test-token");
  handlers.open();
  await tick();

  const runTask = JSON.parse(sent[0]);
  const taskId = runTask.header.task_id;
  assert.strictEqual(runTask.header.action, "run-task");
  assert.strictEqual(runTask.payload.model, "paraformer-realtime-v2");
  assert.strictEqual(runTask.payload.parameters.sample_rate, 16000);
  assert.strictEqual(runTask.payload.parameters.semantic_punctuation_enabled, false);
  assert.strictEqual(runTask.payload.parameters.max_sentence_silence, 800);
  assert.strictEqual(runTask.payload.parameters.multi_threshold_mode_enabled, true);
  assert.strictEqual(runTask.payload.parameters.punctuation_prediction_enabled, true);
  assert.strictEqual(runTask.payload.parameters.inverse_text_normalization_enabled, true);
  assert.strictEqual(sent.length, 1, "audio must wait for task-started");

  handlers.message({ data: JSON.stringify({
    header: { event: "task-started", task_id: taskId },
    payload: {},
  }) });
  recognizer.finish();
  await tick();
  await tick();
  await tick();
  await tick();

  assert(sent[1] instanceof ArrayBuffer);
  assert.strictEqual(sent[1].byteLength, 3200);
  assert(sent[2] instanceof ArrayBuffer);
  assert.strictEqual(sent[2].byteLength, 800);
  assert.strictEqual(JSON.parse(sent[3]).header.action, "finish-task");

  handlers.message({ data: JSON.stringify({
    header: { event: "result-generated", task_id: taskId },
    payload: { output: { sentence: { text: "明天八点", sentence_end: false } } },
  }) });
  handlers.message({ data: JSON.stringify({
    header: { event: "result-generated", task_id: taskId },
    payload: { output: { sentence: { text: "明天八点交作业", sentence_end: true } } },
  }) });
  handlers.message({ data: JSON.stringify({
    header: { event: "task-finished", task_id: taskId },
    payload: { output: {}, usage: null },
  }) });

  assert.strictEqual(finalError, null);
  assert.strictEqual(finalResult.rawText, "明天八点交作业");
  assert.strictEqual(finalResult.taskId, taskId);
  console.log("DashScope speech service sequence test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
