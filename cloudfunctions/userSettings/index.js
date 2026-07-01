const crypto = require("crypto");
const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const CUSTOM_BACKGROUND_LIMIT = 3;
const UNLOCKED_CUSTOM_BACKGROUND_LIMIT = 100;

function settingsDocId(openid) {
  return `user_settings_${crypto.createHash("sha256").update(String(openid || "anonymous")).digest("hex").slice(0, 32)}`;
}

function isMissingDoc(error) {
  const message = String((error && (error.errMsg || error.message)) || error || "");
  return /DOCUMENT_NOT_FOUND|not exist|does not exist|-502005/i.test(message);
}

function sanitizeBackground(item) {
  const source = item || {};
  return {
    id: String(source.id || ""),
    name: String(source.name || "自定义"),
    fileID: String(source.fileID || ""),
    url: String(source.url || ""),
    createdAt: Number(source.createdAt) || Date.now(),
    cropInfo: source.cropInfo && typeof source.cropInfo === "object" ? source.cropInfo : null,
    isCustom: true,
  };
}

function sanitizeCategory(item) {
  const source = item || {};
  return {
    id: String(source.id || ""),
    name: String(source.name || "").trim().slice(0, 6),
    icon: String(source.icon || "/assets/original/icon_tab_life.png"),
    isSystem: false,
    createdAt: Number(source.createdAt) || Date.now(),
  };
}

function sanitizeSettings(settings) {
  const source = settings || {};
  const backgroundUnlimited = !!source.backgroundUnlimited;
  const validBackgrounds = (Array.isArray(source.customBackgrounds) ? source.customBackgrounds : [])
    .map(sanitizeBackground)
    .filter((item) => item.id && item.fileID && item.url);
  return {
    hideBottomTip: !!source.hideBottomTip,
    themeBackgroundId: String(source.themeBackgroundId || "yellow_grid"),
    customBackgrounds: validBackgrounds.slice(0, backgroundUnlimited ? UNLOCKED_CUSTOM_BACKGROUND_LIMIT : CUSTOM_BACKGROUND_LIMIT),
    customCategories: (Array.isArray(source.customCategories) ? source.customCategories : [])
      .map(sanitizeCategory)
      .filter((item) => item.id && item.name && ["all", "work", "family", "life"].indexOf(item.id) < 0),
    aiEnabled: !!source.aiEnabled,
    backgroundUnlimited,
  };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const db = cloud.database();
  const ref = db.collection("settings").doc(settingsDocId(openid));
  const mode = String(event.mode || "load");

  if (mode === "save") {
    const settings = sanitizeSettings(event.settings);
    await ref.set({
      data: Object.assign({}, settings, {
        _openid: openid,
        key: "user_settings_v2",
        updatedAt: Date.now(),
      }),
    });
    return { ok: true, settings };
  }

  try {
    const result = await ref.get();
    return { ok: true, settings: sanitizeSettings(result.data) };
  } catch (error) {
    if (!isMissingDoc(error)) throw error;
    const settings = sanitizeSettings(event.fallback);
    await ref.set({
      data: Object.assign({}, settings, {
        _openid: openid,
        key: "user_settings_v2",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    });
    return { ok: true, settings, created: true };
  }
};
