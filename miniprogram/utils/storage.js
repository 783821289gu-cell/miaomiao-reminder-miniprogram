const EVENT_KEY = "meow_events_v1";
const CATEGORY_KEY = "meow_categories_v1";
const SETTINGS_KEY = "meow_settings_v1";

const DEFAULT_CATEGORIES = [
  { id: "all", name: "全部", icon: "/assets/original/icon_tab_all.png", isSystem: true },
  { id: "work", name: "工作", icon: "/assets/original/icon_tab_work.png", isSystem: true },
  { id: "family", name: "家庭", icon: "/assets/original/icon_tab_family.png", isSystem: true },
  { id: "life", name: "生活", icon: "/assets/original/icon_tab_life.png", isSystem: true },
];

const SYSTEM_CATEGORY_IDS = DEFAULT_CATEGORIES.map((item) => item.id);

function normalizeCustomCategories(categories) {
  return (categories || [])
    .filter((item) => item && item.id && SYSTEM_CATEGORY_IDS.indexOf(item.id) < 0)
    .map((item) => ({
      id: String(item.id),
      name: String(item.name || "").trim().slice(0, 6),
      icon: String(item.icon || "/assets/original/icon_tab_life.png"),
      isSystem: false,
      createdAt: Number(item.createdAt) || Date.now(),
    }))
    .filter((item) => item.name);
}

function safeGet(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value || fallback;
  } catch (error) {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (error) {
    console.warn("本地保存失败", error);
  }
}

function getEvents() {
  return safeGet(EVENT_KEY, []);
}

function saveEvents(events) {
  safeSet(EVENT_KEY, events || []);
}

function getCategories() {
  const saved = safeGet(CATEGORY_KEY, []);
  return DEFAULT_CATEGORIES.concat(normalizeCustomCategories(saved));
}

function saveCategories(categories) {
  safeSet(CATEGORY_KEY, normalizeCustomCategories(categories));
}

function getSettings() {
  const settings = safeGet(SETTINGS_KEY, {
    hideBottomTip: false,
    themeBackgroundId: "yellow_grid",
    customBackgrounds: [],
  });
  return Object.assign({}, settings, {
    customCategories: normalizeCustomCategories(settings.customCategories || safeGet(CATEGORY_KEY, [])),
  });
}

function saveSettings(settings) {
  safeSet(SETTINGS_KEY, settings || {});
}

module.exports = {
  DEFAULT_CATEGORIES,
  normalizeCustomCategories,
  getEvents,
  saveEvents,
  getCategories,
  saveCategories,
  getSettings,
  saveSettings,
};
