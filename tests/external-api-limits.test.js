const assert = require("assert");
const { acquireRateLimit } = require("../cloudfunctions/getDashScopeToken/rate-limiter");
const dashScopeToken = require("../cloudfunctions/getDashScopeToken/index");

function createFakeDatabase() {
  const records = new Map();
  const collection = () => ({
    doc(id) {
      return {
        async get() {
          if (!records.has(id)) {
            const error = new Error("DOCUMENT_NOT_FOUND");
            error.code = -502005;
            throw error;
          }
          return { data: records.get(id) };
        },
        async set({ data }) { records.set(id, Object.assign({}, data)); },
        async update({ data }) { records.set(id, Object.assign({}, records.get(id) || {}, data)); },
      };
    },
  });
  return {
    collection,
    runTransaction: async (handler) => handler({ collection }),
    createCollection: async () => {},
  };
}

async function main() {
  const db = createFakeDatabase();
  await acquireRateLimit(db, { key: "test", limit: 2, windowMs: 1000, maxWaitMs: 0 });
  await acquireRateLimit(db, { key: "test", limit: 2, windowMs: 1000, maxWaitMs: 0 });
  await assert.rejects(
    () => acquireRateLimit(db, { key: "test", limit: 2, windowMs: 1000, maxWaitMs: 0 }),
    (error) => error && error.code === "LOCAL_RATE_LIMITED" && error.retryAfterMs > 0,
  );

  assert.strictEqual(dashScopeToken._test.isRetryableTokenError({ code: 429, message: "Throttling" }), true);
  assert.strictEqual(dashScopeToken._test.isRetryableTokenError({ code: 401, message: "InvalidApiKey" }), false);
  assert.deepStrictEqual(
    dashScopeToken._test.friendlyTokenError({ code: "Throttling.RateQuota", message: "rate limited" }),
    { code: "DASHSCOPE_RATE_LIMITED", errMsg: "语音识别请求较多，请稍后再试", retryable: true },
  );
  assert.strictEqual(
    dashScopeToken._test.friendlyTokenError({ code: "InvalidApiKey", message: "HTTP 401" }).retryable,
    false,
  );

  console.log("External API limiter and error classification tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
