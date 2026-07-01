// const env = require("../config/env");

// // Base64 adds about one third to the payload. Keep the binary below 300 KB so
// // the complete cloud-function request remains below the client request limit.
// const MAX_OCR_FILE_BYTES = 300 * 1024;

// function readImageBase64(filePath) {
//   return new Promise((resolve, reject) => {
//     wx.getFileSystemManager().readFile({
//       filePath,
//       encoding: "base64",
//       success: (result) => resolve(result.data || ""),
//       fail: reject,
//     });
//   });
// }

// function getFileSize(filePath) {
//   return new Promise((resolve, reject) => {
//     wx.getFileSystemManager().getFileInfo({
//       filePath,
//       success: (result) => resolve(Number(result.size) || 0),
//       fail: reject,
//     });
//   });
// }

// function compressImage(filePath, options) {
//   return new Promise((resolve, reject) => {
//     wx.compressImage({
//       src: filePath,
//       quality: options.quality,
//       compressedWidth: options.width,
//       success: (result) => resolve(result.tempFilePath || filePath),
//       fail: reject,
//     });
//   });
// }

// function getImageInfo(filePath) {
//   return new Promise((resolve) => {
//     wx.getImageInfo({
//       src: filePath,
//       success: resolve,
//       fail: () => resolve({}),
//     });
//   });
// }

// async function prepareImageForOcr(filePath) {
//   let currentPath = filePath;
//   let currentSize = await getFileSize(currentPath);
//   if (currentSize <= MAX_OCR_FILE_BYTES) return currentPath;

//   const imageInfo = await getImageInfo(filePath);
//   const sourceWidth = Math.max(1, Number(imageInfo.width) || 1600);

//   const attempts = [
//     { width: 1600, quality: 82 },
//     { width: 1280, quality: 76 },
//     { width: 1080, quality: 70 },
//     { width: 900, quality: 64 },
//   ];
//   for (let index = 0; index < attempts.length; index += 1) {
//     currentPath = await compressImage(currentPath, Object.assign({}, attempts[index], {
//       width: Math.min(sourceWidth, attempts[index].width),
//     }));
//     currentSize = await getFileSize(currentPath);
//     if (currentSize <= MAX_OCR_FILE_BYTES) return currentPath;
//   }
//   throw new Error("图片文件较大，请裁剪后再试");
// }

// function chooseSingleImage() {
//   return new Promise((resolve, reject) => {
//     wx.chooseImage({
//       count: 1,
//       sizeType: ["compressed"],
//       sourceType: ["album", "camera"],
//       success: (result) => {
//         const path = result.tempFilePaths && result.tempFilePaths[0];
//         if (!path) {
//           reject(new Error("没有选择图片"));
//           return;
//         }
//         resolve(path);
//       },
//       fail: (error) => {
//         if (/cancel/i.test(String((error && error.errMsg) || ""))) {
//           resolve("");
//           return;
//         }
//         reject(error);
//       },
//     });
//   });
// }

// function recognizeImage(filePath) {
//   return prepareImageForOcr(filePath).then(readImageBase64).then((imageBase64) => new Promise((resolve, reject) => {
//     if (!wx.cloud || !wx.cloud.callFunction) {
//       reject(new Error("请先开通云开发并上传 OCR 云函数"));
//       return;
//     }
//     wx.cloud.callFunction({
//       name: env.functions.ocrGeneralBasic,
//       data: { imageBase64 },
//       success: (response) => {
//         const result = response.result || {};
//         if (!result.ok) {
//           reject(new Error(result.errMsg || "图片识别失败"));
//           return;
//         }
//         resolve(result);
//       },
//       fail: reject,
//     });
//   }));
// }

// module.exports = {
//   chooseSingleImage,
//   prepareImageForOcr,
//   recognizeImage,
// };

//这里开始的
const env = require("../config/env");

// 上传到云存储后不再通过 callFunction.data 传 base64。
// 这里保留压缩逻辑，是为了避免腾讯 OCR 端图片过大。
const MAX_OCR_FILE_BYTES = 300 * 1024;
let activeOcrTask = null;

function getFileSize(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({
      filePath,
      success: (result) => resolve(Number(result.size) || 0),
      fail: reject,
    });
  });
}

function compressImage(filePath, options) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: filePath,
      quality: options.quality,
      compressedWidth: options.width,
      success: (result) => resolve(result.tempFilePath || filePath),
      fail: reject,
    });
  });
}

function getImageInfo(filePath) {
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: filePath,
      success: resolve,
      fail: () => resolve({}),
    });
  });
}

async function prepareImageForOcr(filePath) {
  let currentPath = filePath;
  let currentSize = await getFileSize(currentPath);
  if (currentSize <= MAX_OCR_FILE_BYTES) return currentPath;

  const imageInfo = await getImageInfo(filePath);
  const sourceWidth = Math.max(1, Number(imageInfo.width) || 1600);

  const attempts = [
    { width: 1600, quality: 82 },
    { width: 1280, quality: 76 },
    { width: 1080, quality: 70 },
    { width: 900, quality: 64 },
  ];

  for (let index = 0; index < attempts.length; index += 1) {
    currentPath = await compressImage(currentPath, Object.assign({}, attempts[index], {
      width: Math.min(sourceWidth, attempts[index].width),
    }));
    currentSize = await getFileSize(currentPath);
    if (currentSize <= MAX_OCR_FILE_BYTES) return currentPath;
  }

  throw new Error("图片文件较大，请裁剪后再试");
}

function chooseSingleImage() {
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count: 1,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const path = result.tempFilePaths && result.tempFilePaths[0];
        if (!path) {
          reject(new Error("没有选择图片"));
          return;
        }
        resolve(path);
      },
      fail: (error) => {
        if (/cancel/i.test(String((error && error.errMsg) || ""))) {
          resolve("");
          return;
        }
        reject(error);
      },
    });
  });
}

function getCloudPath(filePath) {
  const extMatch = String(filePath || "").match(/\.(jpg|jpeg|png|webp)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : "jpg";
  return `ocr-temp/${Date.now()}_${Math.floor(Math.random() * 100000)}.${ext}`;
}

function runRecognizeImage(filePath) {
  if (!wx.cloud || !wx.cloud.callFunction || !wx.cloud.uploadFile) {
    return Promise.reject(new Error("请先开通云开发并上传 OCR 云函数"));
  }

  return prepareImageForOcr(filePath).then((preparedPath) => new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath: getCloudPath(preparedPath),
      filePath: preparedPath,
      success: (uploadRes) => {
        const fileID = uploadRes.fileID;

        if (!fileID) {
          reject(new Error("图片上传失败：没有拿到 fileID"));
          return;
        }

        wx.cloud.callFunction({
          name: env.functions.ocrGeneralBasic,
          data: { fileID },
          success: (response) => {
            const result = response.result || {};
            if (!result.ok) {
              const error = new Error(result.errMsg || "图片识别失败");
              error.code = result.errCode || "OCR_FAILED";
              error.retryable = !!result.retryable;
              error.retryAfterMs = Number(result.retryAfterMs) || 0;
              reject(error);
              return;
            }
            resolve(result);
          },
          fail: (error) => {
            // 云函数没有成功执行时，前端尝试清理临时图片。
            if (wx.cloud.deleteFile) {
              wx.cloud.deleteFile({ fileList: [fileID] });
            }
            reject(error);
          },
        });
      },
      fail: reject,
    });
  }));
}

function recognizeImage(filePath) {
  if (activeOcrTask) {
    const error = new Error("正在识别上一张图片，请稍等");
    error.code = "OCR_REQUEST_IN_PROGRESS";
    return Promise.reject(error);
  }
  activeOcrTask = runRecognizeImage(filePath);
  return activeOcrTask.then((result) => {
    activeOcrTask = null;
    return result;
  }, (error) => {
    activeOcrTask = null;
    throw error;
  });
}

module.exports = {
  chooseSingleImage,
  prepareImageForOcr,
  recognizeImage,
};
