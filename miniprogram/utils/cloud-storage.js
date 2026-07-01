function errorText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const parts = [
    value.code,
    value.errCode,
    value.status,
    value.errMsg,
    value.message,
  ].filter((item) => item !== undefined && item !== null);
  try {
    parts.push(JSON.stringify(value));
  } catch (error) {
    // Ignore objects that cannot be serialized.
  }
  return parts.join(" ");
}

function isCloudFileMissing(value) {
  return /STORAGE_FILE_NONEXIST|OBJECT_NOT_EXIST|FILE_NONEXIST|FILE_NOT_EXIST|NONEXIST|NOT[\s_-]*EXIST|NOT[\s_-]*FOUND|不存在|找不到|\b404\b/i.test(errorText(value));
}

function getDeleteFileOutcome(result) {
  const fileList = (result && result.fileList) || [];
  const item = fileList[0];
  if (item && Number(item.status) === 0) {
    return { ok: true, missing: false, message: "" };
  }
  if (isCloudFileMissing(item) || isCloudFileMissing(result)) {
    return { ok: true, missing: true, message: "" };
  }
  const message = String(
    (item && (item.errMsg || item.message))
      || (result && (result.errMsg || result.message))
      || "云端图片删除失败",
  );
  return { ok: false, missing: false, message };
}

module.exports = {
  getDeleteFileOutcome,
  isCloudFileMissing,
};
