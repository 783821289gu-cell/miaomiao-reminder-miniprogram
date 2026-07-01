const env = require("../config/env");

const WARM_TIP = "我可以根据现有事项帮你新增、修改、删除、置顶重要日，也能设置提醒。可以试试：删除下周的会议，把生日置顶，修改周五之后的事项。";
let activeAnalyzeTask = null;

function normalizeQuota(quota) {
  const source = quota || {};
  const unlimited = !!source.unlimited;
  const used = Math.max(0, Number(source.used) || 0);
  const limit = Math.max(1, Number(source.limit) || 50);
  return {
    unlimited,
    used,
    limit,
    remaining: unlimited ? null : Math.max(0, Number.isFinite(Number(source.remaining)) ? Number(source.remaining) : limit - used),
  };
}

function normalizeAiResult(result) {
  if (!result || typeof result !== "object") {
    return { type: "warm_tip", message: WARM_TIP };
  }
  const hasQuota = !!(result.quota && typeof result.quota === "object");
  const quota = hasQuota ? normalizeQuota(result.quota) : null;
  if (result.type === "quota_exhausted") {
    return Object.assign({ type: "quota_exhausted", message: result.message || "AI识别次数已用完" }, hasQuota ? { quota } : {});
  }
  if (result.type === "service_error") {
    return Object.assign({
      type: "service_error",
      code: result.code || "AI_SERVICE_ERROR",
      message: result.message || "AI 识别暂时不可用，请稍后再试",
      retryable: !!result.retryable,
    }, hasQuota ? { quota } : {});
  }
  if (result.type === "operations" && Array.isArray(result.operations)) {
    return Object.assign({ summary: `识别到${result.operations.length}个操作` }, result, {
      operations: result.operations.map((item, index) => Object.assign({
        id: `op_${index + 1}`,
        action: "create",
        confidence: 0,
        title: "",
        targetDate: "",
        targetTime: "",
        targetEventId: "",
        targetEventQuery: "",
        alternatives: [],
        patch: {},
        reminder: { enabled: false, mode: "off", remindAt: "" },
        message: "",
      }, item || {})),
    }, hasQuota ? { quota } : {});
  }
  return Object.assign({ type: "warm_tip", message: result.message || WARM_TIP }, hasQuota ? { quota } : {});
}

function callAiFunction(data) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || !wx.cloud.callFunction) {
      reject(new Error("请先开通云开发并上传 AI 云函数"));
      return;
    }
    wx.cloud.callFunction({
      name: env.functions.aiIntent,
      data: data || {},
      success: (response) => resolve(response.result || {}),
      fail: reject,
    });
  });
}

function analyzeText(rawText, context) {
  if (activeAnalyzeTask) {
    const error = new Error("AI 正在整理上一条内容，请稍等");
    error.code = "AI_REQUEST_IN_PROGRESS";
    return Promise.reject(error);
  }
  activeAnalyzeTask = callAiFunction({ rawText, context: context || {} }).then(normalizeAiResult);
  return activeAnalyzeTask.then((result) => {
    activeAnalyzeTask = null;
    return result;
  }, (error) => {
    activeAnalyzeTask = null;
    throw error;
  });
}

function getQuotaStatus() {
  return callAiFunction({ mode: "quota_status" }).then((result) => ({
    type: "quota_status",
    quota: normalizeQuota(result.quota),
  }));
}

function unlockUnlimited(code) {
  return callAiFunction({ mode: "unlock_unlimited", code }).then((result) => ({
    ok: !!result.ok,
    message: result.message || "",
    quota: normalizeQuota(result.quota),
  }));
}

module.exports = {
  WARM_TIP,
  analyzeText,
  getQuotaStatus,
  unlockUnlimited,
  normalizeAiResult,
  normalizeQuota,
};
