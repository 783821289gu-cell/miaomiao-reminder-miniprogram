const crypto = require("crypto");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMissingDocument(error) {
  const message = String((error && (error.errMsg || error.message)) || error || "");
  return /DOCUMENT_NOT_FOUND|not exist|does not exist|-502005/i.test(message);
}

function isMissingCollection(error) {
  const message = String((error && (error.errMsg || error.message)) || error || "");
  return /COLLECTION_NOT_EXIST|DATABASE_COLLECTION_NOT_EXIST|Db or Table not exist|collection.*not exist/i.test(message);
}

function isTransactionConflict(error) {
  const message = String((error && (error.errMsg || error.message)) || error || "");
  return /TransactionConflict|DATABASE_TRANSACTION_CONFLICT|-501001/i.test(message);
}

function limiterDocId(key) {
  return `api_rate_${crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 32)}`;
}

async function tryAcquire(db, key, limit, windowMs) {
  const now = Date.now();
  const id = limiterDocId(key);
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection("apiRateLimits").doc(id);
    let current = null;
    try {
      const snapshot = await ref.get();
      current = snapshot.data || null;
    } catch (error) {
      if (!isMissingDocument(error)) throw error;
    }

    const expired = !current || now - Number(current.windowStartedAt || 0) >= windowMs;
    const windowStartedAt = expired ? now : Number(current.windowStartedAt || now);
    const count = expired ? 0 : Math.max(0, Number(current.count) || 0);
    if (count >= limit) {
      return { allowed: false, retryAfterMs: Math.max(20, windowMs - (now - windowStartedAt)) };
    }

    const data = { key, count: count + 1, limit, windowMs, windowStartedAt, updatedAt: now };
    if (current) await ref.update({ data });
    else await ref.set({ data });
    return { allowed: true, retryAfterMs: 0 };
  });
}

async function acquireRateLimit(db, options) {
  const key = String(options.key || "external_api");
  const limit = Math.max(1, Math.floor(Number(options.limit) || 1));
  const windowMs = Math.max(100, Math.floor(Number(options.windowMs) || 1000));
  const maxWaitMs = Math.max(0, Math.floor(Number(options.maxWaitMs) || 0));
  const deadline = Date.now() + maxWaitMs;
  let result;

  do {
    try {
      result = await tryAcquire(db, key, limit, windowMs);
    } catch (error) {
      if (isMissingCollection(error)) {
        await db.createCollection("apiRateLimits").catch(() => {});
        await sleep(30);
        continue;
      }
      if (isTransactionConflict(error)) {
        await sleep(20 + Math.floor(Math.random() * 50));
        continue;
      }
      throw error;
    }
    if (result.allowed) return result;
    if (Date.now() + result.retryAfterMs > deadline) break;
    await sleep(result.retryAfterMs + Math.floor(Math.random() * 40));
  } while (Date.now() <= deadline);

  const error = new Error("外部接口请求较多，请稍后重试");
  error.code = "LOCAL_RATE_LIMITED";
  error.retryAfterMs = result ? result.retryAfterMs : windowMs;
  throw error;
}

module.exports = { acquireRateLimit, sleep };
