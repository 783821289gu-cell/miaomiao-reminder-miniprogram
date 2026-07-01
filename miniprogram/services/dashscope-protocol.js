function createTaskId() {
  const bytes = [];
  for (let index = 0; index < 16; index += 1) {
    bytes.push(Math.floor(Math.random() * 256));
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function buildRunTask(taskId, options) {
  const config = options || {};
  const parameters = {
    format: config.format || "pcm",
    sample_rate: Number(config.sampleRate || 16000),
    disfluency_removal_enabled: !!config.disfluencyRemovalEnabled,
  };
  if (Array.isArray(config.languageHints) && config.languageHints.length) {
    parameters.language_hints = config.languageHints;
  }
  if (typeof config.semanticPunctuationEnabled === "boolean") {
    parameters.semantic_punctuation_enabled = config.semanticPunctuationEnabled;
  }
  if (Number.isFinite(Number(config.maxSentenceSilence))) {
    parameters.max_sentence_silence = Number(config.maxSentenceSilence);
  }
  if (typeof config.multiThresholdModeEnabled === "boolean") {
    parameters.multi_threshold_mode_enabled = config.multiThresholdModeEnabled;
  }
  if (typeof config.punctuationPredictionEnabled === "boolean") {
    parameters.punctuation_prediction_enabled = config.punctuationPredictionEnabled;
  }
  if (typeof config.inverseTextNormalizationEnabled === "boolean") {
    parameters.inverse_text_normalization_enabled = config.inverseTextNormalizationEnabled;
  }
  return {
    header: {
      action: "run-task",
      task_id: taskId,
      streaming: "duplex",
    },
    payload: {
      task_group: "audio",
      task: "asr",
      function: "recognition",
      model: config.model || "paraformer-realtime-v2",
      parameters,
      input: {},
    },
  };
}

function buildFinishTask(taskId) {
  return {
    header: {
      action: "finish-task",
      task_id: taskId,
      streaming: "duplex",
    },
    payload: {
      input: {},
    },
  };
}

function applyRecognitionResult(state, payload) {
  const current = state || { committed: "", partial: "" };
  const sentence = payload
    && payload.payload
    && payload.payload.output
    && payload.payload.output.sentence;
  if (!sentence || sentence.heartbeat) {
    return Object.assign({}, current, { displayText: `${current.committed}${current.partial}` });
  }
  const text = String(sentence.text || "");
  if (sentence.sentence_end) {
    const committed = `${current.committed}${text}`;
    return { committed, partial: "", displayText: committed };
  }
  return {
    committed: current.committed,
    partial: text,
    displayText: `${current.committed}${text}`,
  };
}

module.exports = {
  applyRecognitionResult,
  buildFinishTask,
  buildRunTask,
  createTaskId,
};
