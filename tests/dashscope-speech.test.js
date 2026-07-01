const assert = require("assert");
const protocol = require("../miniprogram/services/dashscope-protocol");
const tokenFunction = require("../cloudfunctions/getDashScopeToken/index");

const taskId = protocol.createTaskId();
assert.match(taskId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const runTask = protocol.buildRunTask(taskId, {
  model: "paraformer-realtime-v2",
  format: "pcm",
  sampleRate: 16000,
  languageHints: ["zh"],
  semanticPunctuationEnabled: false,
  maxSentenceSilence: 800,
  multiThresholdModeEnabled: true,
  punctuationPredictionEnabled: true,
  inverseTextNormalizationEnabled: true,
});
assert.strictEqual(runTask.header.action, "run-task");
assert.strictEqual(runTask.header.task_id, taskId);
assert.strictEqual(runTask.payload.model, "paraformer-realtime-v2");
assert.strictEqual(runTask.payload.parameters.format, "pcm");
assert.strictEqual(runTask.payload.parameters.sample_rate, 16000);
assert.deepStrictEqual(runTask.payload.parameters.language_hints, ["zh"]);
assert.strictEqual(runTask.payload.parameters.semantic_punctuation_enabled, false);
assert.strictEqual(runTask.payload.parameters.max_sentence_silence, 800);
assert.strictEqual(runTask.payload.parameters.multi_threshold_mode_enabled, true);
assert.strictEqual(runTask.payload.parameters.punctuation_prediction_enabled, true);
assert.strictEqual(runTask.payload.parameters.inverse_text_normalization_enabled, true);

const finishTask = protocol.buildFinishTask(taskId);
assert.strictEqual(finishTask.header.action, "finish-task");
assert.strictEqual(finishTask.header.task_id, taskId);

let transcript = { committed: "", partial: "" };
transcript = protocol.applyRecognitionResult(transcript, {
  payload: { output: { sentence: { text: "明天八点", sentence_end: false } } },
});
assert.strictEqual(transcript.displayText, "明天八点");
transcript = protocol.applyRecognitionResult(transcript, {
  payload: { output: { sentence: { text: "明天八点交作业", sentence_end: true } } },
});
assert.strictEqual(transcript.displayText, "明天八点交作业");
transcript = protocol.applyRecognitionResult(transcript, {
  payload: { output: { sentence: { text: "，记得提醒我。", sentence_end: true } } },
});
assert.strictEqual(transcript.displayText, "明天八点交作业，记得提醒我。");

assert.strictEqual(tokenFunction._test.clampTtl(1), 60);
assert.strictEqual(tokenFunction._test.clampTtl(180), 180);
assert.strictEqual(tokenFunction._test.clampTtl(999), 300);

console.log("DashScope speech protocol tests passed.");
