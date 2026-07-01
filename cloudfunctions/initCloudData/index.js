const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const COLLECTIONS = ["events", "settings", "categories", "customBackgrounds", "aiLogs", "reminderJobs", "apiRateLimits"];

function isExistsError(error) {
  const message = String((error && (error.errMsg || error.message)) || error || "");
  return /already exists|collection.*exist|DATABASE_COLLECTION_ALREADY_EXISTS/i.test(message);
}

exports.main = async () => {
  const db = cloud.database();
  const results = [];
  for (let index = 0; index < COLLECTIONS.length; index += 1) {
    const name = COLLECTIONS[index];
    try {
      await db.createCollection(name);
      results.push({ name, created: true });
    } catch (error) {
      if (isExistsError(error)) {
        results.push({ name, created: false, exists: true });
      } else {
        results.push({
          name,
          created: false,
          exists: false,
          errMsg: (error && (error.errMsg || error.message)) || String(error),
        });
      }
    }
  }
  return {
    ok: results.every((item) => item.created || item.exists),
    collections: results,
  };
};
