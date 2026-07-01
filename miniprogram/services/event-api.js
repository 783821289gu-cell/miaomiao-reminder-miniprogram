const env = require("../config/env");
const storage = require("../utils/storage");
const reminderService = require("./reminder");

const COLLECTIONS = {
  events: "events",
  categories: "categories",
};
const EVENT_PAGE_SIZE = 20;

const CUSTOM_BACKGROUND_LIMIT = 3;
const UNLOCKED_CUSTOM_BACKGROUND_LIMIT = 100;
let initCloudDataTask = null;

function canUseCloud() {
  return Boolean(wx.cloud && wx.cloud.database && wx.cloud.callFunction);
}

function isMissingCollection(error) {
  const message = String((error && (error.errMsg || error.message)) || error || "");
  return /COLLECTION_NOT_EXIST|DATABASE_COLLECTION_NOT_EXIST|Db or Table not exist|collection.*not exist/i.test(message);
}

function normalizeEvent(event) {
  const source = Object.assign({}, event || {});
  const cloudDocId = source.cloudDocId || source._id || "";
  delete source._id;
  delete source._openid;
  const base = Object.assign({
    isPinned: false,
    pinAt: 0,
    pinOrder: 0,
    reminderMode: "off",
    autoReminderDisabled: false,
    reminderPlan: [],
    reminder: {
      enabled: false,
      remindAt: "",
      templateId: env.reminderTemplateId || "",
      subscribed: false,
      sentAt: "",
    },
  }, source);
  return Object.assign({}, base, cloudDocId ? { cloudDocId } : {}, reminderService.normalizeEventReminder(base));
}

function normalizeCustomBackgrounds(list, unlimited) {
  const validBackgrounds = (list || [])
    .filter((item) => item && item.id && item.fileID && item.url);
  const limit = unlimited ? UNLOCKED_CUSTOM_BACKGROUND_LIMIT : CUSTOM_BACKGROUND_LIMIT;
  return validBackgrounds.slice(0, limit)
    .map((item, index) => Object.assign({}, item, {
      name: item.name || "自定义",
      isCustom: true,
      customLabel: `自定义 ${index + 1}/${limit}`,
      displayName: `自定义 ${index + 1}/${limit}`,
      createdAt: item.createdAt || Date.now(),
      cropInfo: item.cropInfo || null,
    }));
}

function normalizeSettings(settings) {
  const source = settings || {};
  const clean = Object.assign({}, source);
  delete clean._id;
  delete clean._openid;
  delete clean.key;
  return Object.assign({}, clean, {
    hideBottomTip: !!source.hideBottomTip,
    themeBackgroundId: source.themeBackgroundId || "yellow_grid",
    backgroundUnlimited: !!source.backgroundUnlimited,
    customBackgrounds: normalizeCustomBackgrounds(source.customBackgrounds || [], source.backgroundUnlimited),
    customCategories: storage.normalizeCustomCategories(source.customCategories || []),
  });
}

function callFunction(name, data) {
  return new Promise((resolve, reject) => {
    if (!canUseCloud()) {
      reject(new Error("cloud unavailable"));
      return;
    }
    wx.cloud.callFunction({
      name,
      data: data || {},
      success: (response) => resolve(response.result || {}),
      fail: reject,
    });
  });
}

function initCloudData() {
  if (!canUseCloud() || !env.functions.initCloudData) {
    return Promise.reject(new Error("cloud init unavailable"));
  }
  if (!initCloudDataTask) {
    initCloudDataTask = callFunction(env.functions.initCloudData, {})
      .then((result) => {
        if (!result || result.ok === false) {
          throw new Error((result && result.errMsg) || "云数据库初始化失败");
        }
        return result;
      })
      .finally(() => {
        initCloudDataTask = null;
      });
  }
  return initCloudDataTask;
}

function retryAfterInit(error, action) {
  if (!isMissingCollection(error)) return Promise.reject(error);
  return initCloudData().then(action);
}

function getDb() {
  return wx.cloud.database();
}

function listCloudEventDocuments() {
  const db = getDb();
  const fetchPage = (skip, collected) => db.collection(COLLECTIONS.events)
    .orderBy("createdAt", "asc")
    .skip(skip)
    .limit(EVENT_PAGE_SIZE)
    .get()
    .then((result) => {
      const page = result.data || [];
      const next = collected.concat(page);
      return page.length < EVENT_PAGE_SIZE ? next : fetchPage(skip + page.length, next);
    });
  return fetchPage(0, []);
}

function listCloudEvents() {
  if (!canUseCloud()) return Promise.reject(new Error("cloud unavailable"));
  const read = () => listCloudEventDocuments();
  return read()
    .catch((error) => retryAfterInit(error, read))
    .then((events) => events.map(normalizeEvent));
}

function loadEvent(eventId) {
  const id = String(eventId || "");
  const cached = storage.getEvents().find((item) => String(item.id) === id);
  if (!id || !canUseCloud()) return Promise.resolve(cached ? normalizeEvent(cached) : null);
  return getDb().collection(COLLECTIONS.events)
    .where({ id })
    .limit(1)
    .get()
    .then((result) => {
      const event = result.data && result.data[0];
      return event ? normalizeEvent(event) : (cached ? normalizeEvent(cached) : null);
    })
    .catch(() => (cached ? normalizeEvent(cached) : null));
}

function upsertCloudEvent(event, retried) {
  const db = getDb();
  const next = normalizeEvent(event);
  if (next.cloudDocId) {
    return db.collection(COLLECTIONS.events).doc(next.cloudDocId).update({
      data: Object.assign({}, next, { updatedAt: Date.now() }),
    }).then(() => next).catch((error) => {
      if (retried || !isMissingCollection(error)) return Promise.reject(error);
      return initCloudData().then(() => upsertCloudEvent(event, true));
    });
  }
  return db.collection(COLLECTIONS.events)
    .where({ id: next.id })
    .get()
    .then((result) => {
      const exists = result.data && result.data[0];
      if (exists) {
        return db.collection(COLLECTIONS.events).doc(exists._id).update({
          data: Object.assign({}, next, { updatedAt: Date.now() }),
        }).then(() => Object.assign({}, next, { cloudDocId: exists._id }));
      }
      return db.collection(COLLECTIONS.events).add({
        data: Object.assign({}, next, { updatedAt: Date.now() }),
      }).then((added) => Object.assign({}, next, { cloudDocId: added._id || "" }));
    })
    .catch((error) => {
      if (retried || !isMissingCollection(error)) return Promise.reject(error);
      return initCloudData().then(() => upsertCloudEvent(event, true));
    });
}

function saveEvent(event, options) {
  const normalized = normalizeEvent(event);
  if (!canUseCloud()) return Promise.resolve({ cloud: false, event: normalized });
  if (!normalized.cloudDocId) {
    const cloudDocId = String(normalized.id || `event_${Date.now()}`);
    return getDb().collection(COLLECTIONS.events).doc(cloudDocId).set({
      data: Object.assign({}, normalized, { updatedAt: Date.now() }),
    }).then(() => ({ cloud: true, event: Object.assign({}, normalized, { cloudDocId }) }))
      .catch((error) => ({ cloud: false, event: normalized, error }));
  }
  return upsertCloudEvent(normalized)
    .then((saved) => ({ cloud: true, event: normalizeEvent(saved) }))
    .catch((error) => ({ cloud: false, event: normalized, error }));
}

function deleteEvent(eventId, cloudDocId) {
  if (!canUseCloud()) return Promise.resolve({ cloud: false });
  const db = getDb();
  if (cloudDocId) {
    return db.collection(COLLECTIONS.events).doc(cloudDocId).remove()
      .then(() => ({ cloud: true }))
      .catch((error) => ({ cloud: false, error }));
  }
  return db.collection(COLLECTIONS.events).where({ id: eventId }).get().then((result) => (
    Promise.all((result.data || []).map((item) => db.collection(COLLECTIONS.events).doc(item._id).remove()))
  )).then(() => ({ cloud: true })).catch((error) => ({ cloud: false, error }));
}

function deleteMissingCloudEvents(events) {
  const ids = (events || []).map((item) => item.id);
  const db = getDb();
  const read = () => listCloudEventDocuments();
  return read().catch((error) => retryAfterInit(error, read)).then((documents) => {
    const removals = documents
      .filter((item) => ids.indexOf(item.id) < 0)
      .map((item) => db.collection(COLLECTIONS.events).doc(item._id).remove().catch(() => null));
    return Promise.all(removals);
  });
}

function saveEventsSnapshot(events) {
  const normalized = (events || []).map(normalizeEvent);
  storage.saveEvents(normalized);
  if (!canUseCloud()) return Promise.resolve({ cloud: false });
  return Promise.all(normalized.map(upsertCloudEvent))
    .then(() => deleteMissingCloudEvents(normalized))
    .then(() => ({ cloud: true }))
    .catch((error) => {
      if (!isMissingCollection(error)) {
        console.warn("云端事件同步失败", error);
      }
      return { cloud: false, error };
    });
}

function saveSettingsSnapshot(settings) {
  const normalized = normalizeSettings(settings);
  storage.saveSettings(normalized);
  if (!canUseCloud()) return Promise.resolve({ cloud: false, settings: normalized });
  return callFunction(env.functions.userSettings, { mode: "save", settings: normalized })
    .then((result) => ({ cloud: result.ok !== false, settings: normalizeSettings(result.settings || normalized) }))
    .catch((error) => {
      console.warn("云端设置同步失败", error);
      return { cloud: false, settings: normalized, error };
    });
}

function loadSettings() {
  const cached = normalizeSettings(storage.getSettings());
  if (!canUseCloud()) return Promise.resolve({ settings: cached, fromCache: true, cloud: false });
  return callFunction(env.functions.userSettings, { mode: "load", fallback: cached })
    .then((result) => {
      const settings = normalizeSettings(result.settings || cached);
      storage.saveSettings(settings);
      return { settings, fromCache: false, cloud: result.ok !== false };
    })
    .catch((error) => {
      console.warn("云端设置读取失败", error);
      return { settings: cached, fromCache: true, cloud: false, error };
    });
}

function migrateLocalEventsIfNeeded(localEvents) {
  if (!canUseCloud() || !localEvents || !localEvents.length) return Promise.resolve(false);
  return listCloudEvents()
    .then((cloudEvents) => {
      if (cloudEvents.length) return false;
      return saveEventsSnapshot(localEvents).then(() => true);
    })
    .catch(() => false);
}

function loadEvents() {
  const cached = storage.getEvents();
  if (!canUseCloud()) {
    return Promise.resolve({ events: cached.map(normalizeEvent), fromCache: true, cloud: false });
  }
  return migrateLocalEventsIfNeeded(cached)
    .then(() => listCloudEvents())
    .then((events) => {
      storage.saveEvents(events);
      return { events, fromCache: false, cloud: true };
    })
    .catch((error) => {
      if (!isMissingCollection(error)) {
        console.warn("云端事件读取失败", error);
      }
      return { events: cached.map(normalizeEvent), fromCache: true, cloud: false, error };
    });
}

function batchApply(operations, events) {
  if (!canUseCloud()) {
    return Promise.reject(new Error("请先开通云开发并上传 eventBatchApply 云函数"));
  }
  return callFunction(env.functions.eventBatchApply, { operations, events });
}

function syncEventReminders(event) {
  if (!canUseCloud() || !env.functions.reminderManager) return Promise.reject(new Error("提醒云函数不可用"));
  return callFunction(env.functions.reminderManager, { mode: "sync", event }).then((result) => {
    if (!result || !result.ok) {
      const error = new Error((result && result.message) || "提醒任务创建失败");
      error.code = (result && result.code) || "reminder_sync_failed";
      error.result = result;
      throw error;
    }
    return result;
  });
}

function cancelEventReminders(eventId) {
  if (!canUseCloud() || !env.functions.reminderManager) return Promise.reject(new Error("提醒云函数不可用"));
  return callFunction(env.functions.reminderManager, { mode: "cancel", eventId }).then((result) => {
    if (!result || !result.ok) throw new Error((result && result.message) || "取消提醒任务失败");
    return result;
  });
}

function getEventReminderStatus(eventId) {
  if (!canUseCloud() || !env.functions.reminderManager) return Promise.reject(new Error("提醒云函数不可用"));
  return callFunction(env.functions.reminderManager, { mode: "status", eventId }).then((result) => {
    if (!result || !result.ok) throw new Error((result && result.message) || "提醒任务状态读取失败");
    return result;
  });
}

module.exports = {
  canUseCloud,
  loadEvent,
  loadEvents,
  saveEvent,
  deleteEvent,
  saveEventsSnapshot,
  batchApply,
  syncEventReminders,
  cancelEventReminders,
  getEventReminderStatus,
  normalizeEvent,
  normalizeSettings,
  saveSettingsSnapshot,
  loadSettings,
};
