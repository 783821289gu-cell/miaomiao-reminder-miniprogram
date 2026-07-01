// const tencentcloud = require("tencentcloud-sdk-nodejs");

// function getErrorCode(error) {
//   return String(
//     (error && (error.code || error.Code || error.name))
//     || (error && error.response && error.response.Error && error.response.Error.Code)
//     || "",
//   );
// }

// function getErrorMessage(error) {
//   return String(
//     (error && (error.message || error.Message || error.errMsg))
//     || (error && error.response && error.response.Error && error.response.Error.Message)
//     || error
//     || "OCR 调用失败",
//   );
// }

// function shouldFallbackToBasic(error) {
//   const code = getErrorCode(error);
//   return [
//     "FailedOperation.UnOpenError",
//     "ResourceUnavailable.ResourcePackageRunOut",
//     "ResourceUnavailable.InArrears",
//     "ResourcesSoldOut.ChargeStatusException",
//     "UnauthorizedOperation",
//     "UnsupportedOperation",
//     "InvalidAction",
//   ].some((item) => code.indexOf(item) >= 0);
// }

// function extractBlocks(response) {
//   return (response.TextDetections || [])
//     .map((item, index) => {
//       const polygon = item && item.ItemPolygon ? item.ItemPolygon : {};
//       const points = item && Array.isArray(item.Polygon) ? item.Polygon : [];
//       const xs = points.map((point) => Number(point.X || 0));
//       const ys = points.map((point) => Number(point.Y || 0));
//       const x = Number(polygon.X);
//       const y = Number(polygon.Y);
//       const width = Number(polygon.Width);
//       const height = Number(polygon.Height);
//       return {
//         index,
//         text: String((item && item.DetectedText) || "").trim(),
//         confidence: Number((item && item.Confidence) || 0),
//         x: Number.isFinite(x) ? x : (xs.length ? Math.min(...xs) : 0),
//         y: Number.isFinite(y) ? y : (ys.length ? Math.min(...ys) : index * 10),
//         width: Number.isFinite(width) ? width : (xs.length ? Math.max(...xs) - Math.min(...xs) : 0),
//         height: Number.isFinite(height) ? height : (ys.length ? Math.max(...ys) - Math.min(...ys) : 0),
//       };
//     })
//     .filter((item) => item.text)
//     .sort((left, right) => {
//       const lineTolerance = Math.max(8, Math.min(left.height || 16, right.height || 16) * 0.6);
//       if (Math.abs(left.y - right.y) <= lineTolerance) return left.x - right.x;
//       return left.y - right.y;
//     });
// }

// function buildResult(response, engine, fallbackReason) {
//   const blocks = extractBlocks(response);
//   return {
//     ok: true,
//     engine,
//     blocks,
//     lines: blocks.map((item) => item.text),
//     text: blocks.map((item) => item.text).join("\n"),
//     requestId: response.RequestId || "",
//     fallback: !!fallbackReason,
//     fallbackReason: fallbackReason || "",
//   };
// }

// async function callAccurate(client, imageBase64) {
//   const response = await client.GeneralAccurateOCR({
//     ImageBase64: imageBase64,
//     ConfigID: process.env.TENCENT_OCR_CONFIG_ID || "OCR",
//     IsWords: false,
//     EnableDetectText: true,
//     WordsType: "0",
//   });
//   return buildResult(response, "GeneralAccurateOCR", "");
// }

// async function callBasic(client, imageBase64, fallbackReason) {
//   const response = await client.GeneralBasicOCR({
//     ImageBase64: imageBase64,
//     LanguageType: process.env.TENCENT_OCR_LANGUAGE || "zh",
//   });
//   return buildResult(response, "GeneralBasicOCR", fallbackReason);
// }

// exports.main = async (event) => {
//   const secretId = process.env.TENCENT_SECRET_ID;
//   const secretKey = process.env.TENCENT_SECRET_KEY;
//   const region = process.env.TENCENT_REGION || "ap-guangzhou";
//   const imageBase64 = String(event.imageBase64 || "");
//   if (!secretId || !secretKey) {
//     return { ok: false, errMsg: "缺少腾讯云 OCR 环境变量 TENCENT_SECRET_ID / TENCENT_SECRET_KEY" };
//   }
//   if (!imageBase64) return { ok: false, errMsg: "没有拿到图片内容" };
//   const OcrClient = tencentcloud.ocr.v20181119.Client;
//   const client = new OcrClient({
//     credential: { secretId, secretKey },
//     region,
//     profile: { httpProfile: { endpoint: "ocr.tencentcloudapi.com" } },
//   });
//   try {
//     return await callAccurate(client, imageBase64);
//   } catch (error) {
//     if (!shouldFallbackToBasic(error)) {
//       return {
//         ok: false,
//         engine: "GeneralAccurateOCR",
//         errCode: getErrorCode(error),
//         errMsg: getErrorMessage(error),
//       };
//     }
//     try {
//       return await callBasic(client, imageBase64, `${getErrorCode(error)} ${getErrorMessage(error)}`.trim());
//     } catch (fallbackError) {
//       return {
//         ok: false,
//         engine: "GeneralBasicOCR",
//         errCode: getErrorCode(fallbackError),
//         errMsg: getErrorMessage(fallbackError),
//         accurateErrCode: getErrorCode(error),
//         accurateErrMsg: getErrorMessage(error),
//       };
//     }
//   }
// };

//这里开始
const cloud = require("wx-server-sdk");
const tencentcloud = require("tencentcloud-sdk-nodejs");
const { acquireRateLimit, sleep } = require("./rate-limiter");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ACCURATE_QPS_LIMIT = Math.max(1, Number(process.env.TENCENT_OCR_ACCURATE_QPS || 8));
const BASIC_QPS_LIMIT = Math.max(1, Number(process.env.TENCENT_OCR_BASIC_QPS || 16));
const OCR_MAX_ATTEMPTS = Math.max(1, Math.min(2, Number(process.env.TENCENT_OCR_MAX_ATTEMPTS || 2)));

function getErrorCode(error) {
  return String(
    (error && (error.code || error.Code || error.name))
    || (error && error.response && error.response.Error && error.response.Error.Code)
    || "",
  );
}

function getErrorMessage(error) {
  return String(
    (error && (error.message || error.Message || error.errMsg))
    || (error && error.response && error.response.Error && error.response.Error.Message)
    || error
    || "OCR 调用失败",
  );
}

function shouldFallbackToBasic(error) {
  const code = getErrorCode(error);
  return [
    "FailedOperation.UnOpenError",
    "ResourceUnavailable.ResourcePackageRunOut",
    "ResourceUnavailable.InArrears",
    "ResourcesSoldOut.ChargeStatusException",
    "UnauthorizedOperation",
    "UnsupportedOperation",
    "InvalidAction",
  ].some((item) => code.indexOf(item) >= 0);
}

function isRetryableOcrError(error) {
  const text = `${getErrorCode(error)} ${getErrorMessage(error)}`;
  return /RequestLimitExceeded|Throttling|ServiceUnavailable|InternalError|EngineRecognizeTimeout|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(text);
}

function friendlyOcrMessage(error) {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  const text = `${code} ${message}`;
  if (/LOCAL_RATE_LIMITED|RequestLimitExceeded|Throttling/i.test(text)) return "图片识别请求较多，请稍后再试";
  if (/AuthFailure|UnauthorizedOperation|InvalidSecretId|Signature/i.test(text)) return "图片识别鉴权失败，请检查腾讯云密钥和权限";
  if (/ResourcePackageRunOut|InArrears|ChargeStatusException|CountLimitError|LimitExceeded/i.test(text)) return "图片识别额度暂不可用，请检查腾讯云额度";
  if (/ImageSizeTooLarge|TooLargeFile|RequestSizeLimitExceeded/i.test(text)) return "图片仍然过大，请裁剪后重试";
  if (/ImageNoText|EmptyImage/i.test(text)) return "图片中没有识别到文字";
  if (/ServiceUnavailable|InternalError|EngineRecognizeTimeout|timeout/i.test(text)) return "图片识别服务繁忙，请稍后再试";
  return message || "图片识别失败";
}

async function callWithRetry(engine, action) {
  const accurate = engine === "GeneralAccurateOCR";
  const qpsLimit = accurate ? ACCURATE_QPS_LIMIT : BASIC_QPS_LIMIT;
  let lastError;
  for (let attempt = 0; attempt < OCR_MAX_ATTEMPTS; attempt += 1) {
    await acquireRateLimit(db, {
      key: `tencent_ocr_${engine}`,
      limit: qpsLimit,
      windowMs: 1000,
      maxWaitMs: 600,
    });
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isRetryableOcrError(error) || attempt >= OCR_MAX_ATTEMPTS - 1) break;
      await sleep(120 * (2 ** attempt) + Math.floor(Math.random() * 80));
    }
  }
  throw lastError;
}

function extractBlocks(response) {
  return (response.TextDetections || [])
    .map((item, index) => {
      const polygon = item && item.ItemPolygon ? item.ItemPolygon : {};
      const points = item && Array.isArray(item.Polygon) ? item.Polygon : [];
      const xs = points.map((point) => Number(point.X || 0));
      const ys = points.map((point) => Number(point.Y || 0));
      const x = Number(polygon.X);
      const y = Number(polygon.Y);
      const width = Number(polygon.Width);
      const height = Number(polygon.Height);

      return {
        index,
        text: String((item && item.DetectedText) || "").trim(),
        confidence: Number((item && item.Confidence) || 0),
        x: Number.isFinite(x) ? x : (xs.length ? Math.min(...xs) : 0),
        y: Number.isFinite(y) ? y : (ys.length ? Math.min(...ys) : index * 10),
        width: Number.isFinite(width) ? width : (xs.length ? Math.max(...xs) - Math.min(...xs) : 0),
        height: Number.isFinite(height) ? height : (ys.length ? Math.max(...ys) - Math.min(...ys) : 0),
      };
    })
    .filter((item) => item.text)
    .sort((left, right) => {
      const lineTolerance = Math.max(8, Math.min(left.height || 16, right.height || 16) * 0.6);
      if (Math.abs(left.y - right.y) <= lineTolerance) return left.x - right.x;
      return left.y - right.y;
    });
}

function buildResult(response, engine, fallbackReason) {
  const blocks = extractBlocks(response);

  return {
    ok: true,
    engine,
    blocks,
    lines: blocks.map((item) => item.text),
    text: blocks.map((item) => item.text).join("\n"),
    requestId: response.RequestId || "",
    fallback: !!fallbackReason,
    fallbackReason: fallbackReason || "",
  };
}

async function callAccurate(client, imageBase64) {
  const response = await callWithRetry("GeneralAccurateOCR", () => client.GeneralAccurateOCR({
    ImageBase64: imageBase64,
    ConfigID: process.env.TENCENT_OCR_CONFIG_ID || "OCR",
    IsWords: false,
    EnableDetectText: true,
    WordsType: "0",
  }));

  return buildResult(response, "GeneralAccurateOCR", "");
}

async function callBasic(client, imageBase64, fallbackReason) {
  const response = await callWithRetry("GeneralBasicOCR", () => client.GeneralBasicOCR({
    ImageBase64: imageBase64,
    LanguageType: process.env.TENCENT_OCR_LANGUAGE || "zh",
  }));

  return buildResult(response, "GeneralBasicOCR", fallbackReason);
}

async function downloadImageBase64(fileID) {
  const downloadRes = await cloud.downloadFile({ fileID });
  const fileContent = downloadRes && downloadRes.fileContent;

  if (!fileContent || !Buffer.isBuffer(fileContent)) {
    throw new Error("云存储图片内容为空");
  }

  return fileContent.toString("base64");
}

async function runOcr(imageBase64) {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  const region = process.env.TENCENT_REGION || "ap-guangzhou";

  if (!secretId || !secretKey) {
    return { ok: false, errMsg: "缺少腾讯云 OCR 环境变量 TENCENT_SECRET_ID / TENCENT_SECRET_KEY" };
  }

  if (!imageBase64) {
    return { ok: false, errMsg: "没有拿到图片内容" };
  }

  const OcrClient = tencentcloud.ocr.v20181119.Client;
  const client = new OcrClient({
    credential: { secretId, secretKey },
    region,
    profile: { httpProfile: { endpoint: "ocr.tencentcloudapi.com" } },
  });

  try {
    return await callAccurate(client, imageBase64);
  } catch (error) {
    if (!shouldFallbackToBasic(error)) {
      return {
        ok: false,
        engine: "GeneralAccurateOCR",
        errCode: getErrorCode(error),
        errMsg: friendlyOcrMessage(error),
        retryable: isRetryableOcrError(error),
        retryAfterMs: Number(error && error.retryAfterMs) || 0,
      };
    }

    try {
      return await callBasic(client, imageBase64, `${getErrorCode(error)} ${getErrorMessage(error)}`.trim());
    } catch (fallbackError) {
      return {
        ok: false,
        engine: "GeneralBasicOCR",
        errCode: getErrorCode(fallbackError),
        errMsg: friendlyOcrMessage(fallbackError),
        retryable: isRetryableOcrError(fallbackError),
        retryAfterMs: Number(fallbackError && fallbackError.retryAfterMs) || 0,
        accurateErrCode: getErrorCode(error),
        accurateErrMsg: getErrorMessage(error),
      };
    }
  }
}

exports.main = async (event) => {
  const fileID = String((event && event.fileID) || "");

  if (!fileID) {
    return { ok: false, errMsg: "没有拿到图片文件ID" };
  }

  try {
    let imageBase64;

    try {
      imageBase64 = await downloadImageBase64(fileID);
    } catch (error) {
      return {
        ok: false,
        errMsg: "图片下载失败: " + getErrorMessage(error),
      };
    }

    return await runOcr(imageBase64);
  } finally {
    // OCR 完成或失败后都尝试删除临时图片。
    cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
  }
};
