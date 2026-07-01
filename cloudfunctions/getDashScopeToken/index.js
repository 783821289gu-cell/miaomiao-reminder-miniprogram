const https = require("https");
const { acquireRateLimit, sleep } = require("./rate-limiter");

const TOKEN_HOST = "dashscope.aliyuncs.com";
const DEFAULT_TTL_SECONDS = 180;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 300;
const DASHSCOPE_RPS_LIMIT = Math.max(1, Math.min(20, Number(process.env.DASHSCOPE_RPS_LIMIT || 18)));

function getDatabase() {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  return cloud.database();
}

function clampTtl(value) {
  const parsed = Number(value || DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_SECONDS;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.floor(parsed)));
}

function requestTemporaryToken(apiKey, ttlSeconds) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: TOKEN_HOST,
      path: `/api/v1/tokens?expire_in_seconds=${ttlSeconds}`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Length": 0,
      },
      timeout: 1800,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let payload = {};
        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch (error) {
          reject(new Error(`DashScope token response is not JSON: ${raw.slice(0, 160)}`));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300 || !payload.token) {
          const detail = payload.message || payload.code || `HTTP ${response.statusCode}`;
          const tokenError = new Error(`DashScope token request failed: ${detail}`);
          tokenError.code = payload.code || response.statusCode;
          reject(tokenError);
          return;
        }
        resolve(payload);
      });
    });
    request.on("timeout", () => request.destroy(new Error("DashScope token request timeout")));
    request.on("error", reject);
    request.end();
  });
}

function isRetryableTokenError(error) {
  const text = `${error && error.code ? error.code : ""} ${error && error.message ? error.message : error || ""}`;
  return /429|Throttling|RateQuota|BurstRate|500|502|503|timeout|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(text);
}

async function requestTokenWithRetry(apiKey, ttlSeconds, database) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await acquireRateLimit(database, {
      key: "dashscope_paraformer_realtime_v2",
      limit: DASHSCOPE_RPS_LIMIT,
      windowMs: 1000,
      maxWaitMs: 900,
    });
    try {
      return await requestTemporaryToken(apiKey, ttlSeconds);
    } catch (error) {
      lastError = error;
      if (!isRetryableTokenError(error) || attempt >= 1) break;
      await sleep(160 * (2 ** attempt) + Math.floor(Math.random() * 80));
    }
  }
  throw lastError;
}

function friendlyTokenError(error) {
  const code = String((error && error.code) || "DASHSCOPE_TOKEN_FAILED");
  const message = String((error && error.message) || error || "");
  const text = `${code} ${message}`;
  if (/LOCAL_RATE_LIMITED|429|Throttling|RateQuota|BurstRate/i.test(text)) {
    return { code: "DASHSCOPE_RATE_LIMITED", errMsg: "语音识别请求较多，请稍后再试", retryable: true };
  }
  if (/401|403|InvalidApiKey|AccessDenied|Unauthorized/i.test(text)) {
    return { code, errMsg: "阿里云语音鉴权失败，请检查 API Key 和模型权限", retryable: false };
  }
  if (/500|502|503|timeout|ECONNRESET|ETIMEDOUT|network/i.test(text)) {
    return { code, errMsg: "阿里云语音服务暂时繁忙，请稍后再试", retryable: true };
  }
  return { code, errMsg: message || "获取阿里云语音临时凭证失败", retryable: false };
}

exports.main = async () => {
  const apiKey = String(process.env.DASHSCOPE_API_KEY || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      code: "DASHSCOPE_API_KEY_MISSING",
      errMsg: "缺少云函数环境变量 DASHSCOPE_API_KEY",
    };
  }

  const ttlSeconds = clampTtl(process.env.DASHSCOPE_TOKEN_TTL_SECONDS);
  try {
    const result = await requestTokenWithRetry(apiKey, ttlSeconds, getDatabase());
    return {
      ok: true,
      token: result.token,
      expiresAt: Number(result.expires_at || 0),
      endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
      workspaceId: String(process.env.DASHSCOPE_WORKSPACE_ID || "").trim(),
    };
  } catch (error) {
    console.error("[getDashScopeToken]", error);
    const detail = friendlyTokenError(error);
    return {
      ok: false,
      code: detail.code,
      errMsg: detail.errMsg,
      retryable: detail.retryable,
      retryAfterMs: Number(error && error.retryAfterMs) || 0,
    };
  }
};

exports._test = {
  clampTtl,
  requestTemporaryToken,
  isRetryableTokenError,
  friendlyTokenError,
};
