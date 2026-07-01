const assert = require("assert");
const cloudStorage = require("../miniprogram/utils/cloud-storage");

assert.deepStrictEqual(
  cloudStorage.getDeleteFileOutcome({ fileList: [{ status: 0, errMsg: "ok" }] }),
  { ok: true, missing: false, message: "" },
);

assert.deepStrictEqual(
  cloudStorage.getDeleteFileOutcome({
    fileList: [{ status: -1, errMsg: "STORAGE_FILE_NONEXIST" }],
  }),
  { ok: true, missing: true, message: "" },
);

assert.strictEqual(
  cloudStorage.isCloudFileMissing({ errMsg: "cloud.deleteFile:fail STORAGE_FILE_NONEXIST" }),
  true,
);
assert.strictEqual(cloudStorage.isCloudFileMissing({ code: "OBJECT_NOT_EXIST" }), true);
assert.strictEqual(cloudStorage.isCloudFileMissing({ errMsg: "file_not_found" }), true);

const permissionFailure = cloudStorage.getDeleteFileOutcome({
  fileList: [{ status: -1, errMsg: "STORAGE_EXCEED_AUTHORITY" }],
});
assert.strictEqual(permissionFailure.ok, false);
assert.strictEqual(permissionFailure.message, "STORAGE_EXCEED_AUTHORITY");

console.log("Cloud storage delete outcome tests passed.");
