const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const cleanupConfig = JSON.parse(fs.readFileSync(
  path.join(root, "cloudfunctions", "cleanupData", "config.json"),
  "utf8",
));
const reminderConfig = JSON.parse(fs.readFileSync(
  path.join(root, "cloudfunctions", "sendReminders", "config.json"),
  "utf8",
));
const cleanupSource = fs.readFileSync(
  path.join(root, "cloudfunctions", "cleanupData", "index.js"),
  "utf8",
);
const reminderSenderSource = fs.readFileSync(
  path.join(root, "cloudfunctions", "sendReminders", "index.js"),
  "utf8",
);

assert.deepStrictEqual(cleanupConfig.triggers, [{
  name: "cleanupDataDaily",
  type: "timer",
  config: "0 15 3 * * * *",
}]);
assert.deepStrictEqual(reminderConfig.triggers, [{
  name: "sendRemindersEveryMinute",
  type: "timer",
  config: "0 * * * * * *",
}]);
assert.strictEqual(cleanupSource.includes("listLogs"), false);
assert.strictEqual(cleanupSource.includes(".skip("), false);
assert.strictEqual(cleanupSource.includes(".sortByCount(\"$_openid\")"), true);
assert.strictEqual(cleanupSource.includes(".where({ createdAt: _.lt(cutoff) })"), true);
assert.strictEqual(cleanupSource.includes("REMINDER_DIRTY_LIMIT = 100"), true);
assert.strictEqual(cleanupSource.includes("db.collection(\"reminderJobs\")"), true);
assert.strictEqual(cleanupSource.includes("dirty - REMINDER_DIRTY_LIMIT"), true);
assert.strictEqual(reminderSenderSource.includes("cleanupHistory(now)"), false);
assert.strictEqual(reminderSenderSource.includes("updateEventPlan(claimed"), true);
assert.strictEqual(reminderSenderSource.includes('collection("reminderJobs").doc(job._id).remove()'), true);

console.log("Cloud trigger and cleanup regression tests passed.");
