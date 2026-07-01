const dateUtils = require("../../utils/date");
const storage = require("../../utils/storage");
const eventParser = require("../../utils/event-parser");
const env = require("../../config/env");
const eventApi = require("../../services/event-api");
const aiIntent = require("../../services/ai-intent");
const ocrImport = require("../../services/ocr-import");
const reminderService = require("../../services/reminder");
const cloudStorage = require("../../utils/cloud-storage");
const eventDiff = require("../../utils/event-diff");

const BACKGROUNDS = [
  { id: "yellow_grid", name: "小兔", pageImage: "/assets/themes/page-yellow_grid.jpg", cardImage: "/assets/themes/card-yellow_grid.jpg" },
  { id: "peach_gingham", name: "郁金香", pageImage: "/assets/themes/page-peach_gingham.jpg", cardImage: "/assets/themes/card-peach_gingham.jpg" },
  { id: "green_gingham", name: "四叶草", pageImage: "/assets/themes/page-green_gingham.jpg", cardImage: "/assets/themes/card-green_gingham.jpg" },
  { id: "pink_dots", name: "草莓蕾丝", pageImage: "/assets/themes/page-pink_dots.jpg", cardImage: "/assets/themes/card-pink_dots.jpg" },
  { id: "lavender_check", name: "紫格手帐", pageImage: "/assets/themes/page-lavender_check.jpg", cardImage: "/assets/themes/card-lavender_check.jpg" },
  { id: "mint_stars", name: "云朵星空", pageImage: "/assets/themes/page-mint_stars.jpg", cardImage: "/assets/themes/card-mint_stars.jpg" },
  { id: "peach_plain", name: "草莓绿格", pageImage: "/assets/themes/page-peach_plain.jpg", cardImage: "/assets/themes/card-peach_plain.jpg" },
  { id: "blue_dots", name: "猫爪手帐", pageImage: "/assets/themes/page-blue_dots.jpg", cardImage: "/assets/themes/card-blue_dots.jpg" },
];

const DEFAULT_BACKGROUND_ID = "mint_stars";
const CUSTOM_BACKGROUND_LIMIT = 3;
const UNLOCKED_CUSTOM_BACKGROUND_LIMIT = 100;

const BACKGROUND_STYLES = {
  yellow_grid: "background-color: #ffe39b; background-image: linear-gradient(rgba(255, 253, 248, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 253, 248, 0.5) 1px, transparent 1px); background-size: 24rpx 24rpx;",
  peach_gingham: "background-color: #ffd0c5; background-image: linear-gradient(90deg, rgba(255, 253, 248, 0.42) 50%, transparent 50%), linear-gradient(rgba(255, 253, 248, 0.42) 50%, transparent 50%); background-size: 52rpx 52rpx;",
  green_gingham: "background-color: #b9cfaa; background-image: linear-gradient(90deg, rgba(255, 253, 248, 0.28) 50%, transparent 50%), linear-gradient(rgba(255, 253, 248, 0.28) 50%, transparent 50%); background-size: 58rpx 58rpx;",
  pink_dots: "background-color: #ffd1d8; background-image: radial-gradient(circle, rgba(235, 95, 145, 0.28) 0 5rpx, transparent 6rpx); background-size: 34rpx 34rpx;",
  lavender_check: "background-color: #ddd2f5; background-image: linear-gradient(90deg, rgba(255, 253, 248, 0.34) 50%, transparent 50%), linear-gradient(rgba(255, 253, 248, 0.34) 50%, transparent 50%); background-size: 54rpx 54rpx;",
  mint_stars: "background-color: #bfe8d9; background-image: linear-gradient(90deg, transparent 0 45%, rgba(255, 253, 248, 0.75) 45% 55%, transparent 55%), linear-gradient(transparent 0 45%, rgba(255, 253, 248, 0.75) 45% 55%, transparent 55%); background-size: 36rpx 36rpx;",
  peach_plain: "background-color: #f7c7ba; background-image: linear-gradient(135deg, rgba(255, 253, 248, 0.22), rgba(255, 253, 248, 0)); background-size: 120rpx 120rpx;",
  blue_dots: "background-color: #b9d6ee; background-image: radial-gradient(circle, rgba(70, 63, 58, 0.2) 0 4rpx, transparent 5rpx); background-size: 36rpx 36rpx;",
};

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
      pagePreview: item.url,
      cardPreview: item.url,
    }));
}

function buildBackgroundList(customBackgrounds, unlimited) {
  return BACKGROUNDS.map((item) => Object.assign({
    isCustom: false,
    displayName: item.name,
    pagePreview: item.pageImage,
    cardPreview: item.cardImage,
  }, item))
    .concat(normalizeCustomBackgrounds(customBackgrounds, unlimited));
}

function buildBackgroundStyle(background) {
  return background && background.color ? `background-color: ${background.color};` : "";
}

function getPageBackgroundImage(background) {
  return (background && (background.pagePreview || background.pageImage || background.url)) || "";
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function getSortRank(event) {
  if (event.isPinned) return 0;
  if (event.status === "today") return 1;
  if (event.status === "future") return 2;
  return 3;
}

function defaultForm() {
  return {
    id: "",
    title: "",
    targetDate: dateUtils.getTodayString(),
    targetTime: "",
    location: "",
    categoryId: "life",
    repeat: "none",
    backgroundId: "mint_stars",
    isPinned: false,
    pinOrder: 0,
    reminderMode: "off",
    autoReminderDisabled: false,
    reminderPlan: [],
    reminderWasActive: false,
    reminderEditorOpened: false,
    reminderChangedByUser: false,
    reminder: {
      enabled: false,
      remindAt: "",
      templateId: env.reminderTemplateId || "",
      subscribed: false,
      sentAt: "",
    },
  };
}

Page({
  data: {
    statusBarHeight: 20,
    categories: [],
    events: [],
    displayEvents: [],
    selectedCategoryId: "all",
    selectedCategoryName: "全部",
    backgrounds: buildBackgroundList([]),
    customBackgroundCount: 0,
    customBackgroundLimit: CUSTOM_BACKGROUND_LIMIT,
    pageBackgroundId: BACKGROUNDS[0].id,
    pageBackgroundImage: getPageBackgroundImage(BACKGROUNDS[0]),
    pageBackgroundStyle: buildBackgroundStyle(BACKGROUNDS[0]),

    showCategory: false,
    showCategoryCreate: false,
    showAddModal: false,
    addForm: defaultForm(),
    reminderError: "",
    savingEvent: false,

    showAction: false,
    actionEvent: {},
    showBackgroundPicker: false,
    showBackgroundCropper: false,
    backgroundCropImagePath: "",
    backgroundPickerMode: "theme",

    showVoiceResult: false,
    voiceRawText: "",
    voiceCandidate: {},

    showImportSheet: false,
    importRawText: "",
    showImportResults: false,
    importCandidates: [],

    showEaster: false,
    showConfirm: false,
    confirmTitle: "",
    confirmContent: "",
    confirmAction: null,

    showBottomTip: true,
    showCenterToast: false,
    centerToastText: "",
    centerToastIcon: "",
    centerToastType: "",
    showVoiceBusy: false,
    showImageBusy: false,
    imageBusyText: "",
    showTextBusy: false,
    textBusyText: "",
    showBackgroundBusy: false,
    backgroundBusyText: "",
    cloudReady: false,
    syncText: "",
    aiEnabled: false,
    aiQuotaRemaining: 50,
    aiUnlimited: false,
    backgroundUnlimited: false,
    aiQuotaLoaded: false,
    aiQuotaChecking: false,
    showAiTip: false,
    showAiOperations: false,
    aiOperationResult: {},
    confirmCancelText: "取消",
    confirmConfirmText: "确定",
    showAutoReminderNotice: false,
    autoReminderNoticeText: "",
    reminderSubscriptionState: "unknown",
  },

  onLoad() {
    const system = wx.getWindowInfo ? wx.getWindowInfo() : { statusBarHeight: 20, windowWidth: 375 };
    const categories = storage.getCategories();
    const storedEvents = storage.getEvents();
    const events = storedEvents.filter((item) => String(item.title || "").trim() !== "959499");
    if (events.length !== storedEvents.length) {
      storage.saveEvents(events);
    }
    const settings = eventApi.normalizeSettings(storage.getSettings());
    const backgroundUnlimited = !!settings.backgroundUnlimited;
    const customBackgrounds = normalizeCustomBackgrounds(settings.customBackgrounds || [], backgroundUnlimited);
    const backgrounds = buildBackgroundList(customBackgrounds, backgroundUnlimited);
    const theme = backgrounds.find((item) => item.id === settings.themeBackgroundId) || BACKGROUNDS[0];

    this.setData({
      statusBarHeight: system.statusBarHeight || 20,
      categories,
      events: events.map(eventApi.normalizeEvent),
      backgrounds,
      customBackgroundCount: customBackgrounds.length,
      backgroundUnlimited,
      customBackgroundLimit: backgroundUnlimited ? UNLOCKED_CUSTOM_BACKGROUND_LIMIT : CUSTOM_BACKGROUND_LIMIT,
      pageBackgroundId: theme.id,
      pageBackgroundImage: getPageBackgroundImage(theme),
      pageBackgroundStyle: buildBackgroundStyle(theme),
      showBottomTip: !settings.hideBottomTip,
      aiEnabled: Object.prototype.hasOwnProperty.call(settings, "aiEnabled") ? !!settings.aiEnabled : !!env.defaultAiEnabled,
    }, () => {
      this.refreshDisplay();
    });
    this.refreshAiQuotaStatus({ silent: true, disableWhenExhausted: true });
    eventApi.loadSettings().then((result) => {
      this.applySettingsToPage(result.settings || settings);
    });
    eventApi.loadEvents().then((result) => {
      const loadedEvents = (result.events || [])
        .filter((item) => String(item.title || "").trim() !== "959499")
        .map(eventApi.normalizeEvent);
      this.setData({
        events: loadedEvents,
        cloudReady: !!result.cloud,
        syncText: result.cloud ? "云端已同步" : (result.fromCache ? "当前显示本地缓存" : ""),
      }, () => {
        this.refreshDisplay();
      });
      const currentSettings = storage.getSettings();
      if (result.cloud && !currentSettings.reminderJobsMigratedV2) {
        const reminderEvents = loadedEvents.filter((item) => {
          const reminder = reminderService.normalizeEventReminder(item);
          return reminder.reminderPlan.some((plan) => plan.subscribed && plan.remindAt && !plan.sentAt);
        });
        Promise.all(reminderEvents.map((item) => eventApi.syncEventReminders(item).catch(() => null)))
          .then(() => this.persistSettings(Object.assign({}, storage.getSettings(), {
            reminderJobsMigratedV2: true,
          }), { apply: false }));
      }
    });
  },

  onUnload() {
    if (this.centerNoticeTimer) {
      clearTimeout(this.centerNoticeTimer);
      this.centerNoticeTimer = null;
    }
  },

  onShow() {
    this.refreshReminderSubscriptionSetting();
  },

  refreshReminderSubscriptionSetting() {
    return reminderService.getReminderSubscriptionSetting().then((setting) => {
      const state = !setting.mainSwitch || setting.itemState === "reject"
        ? "off"
        : (setting.itemState === "accept" ? "accept" : "unknown");
      this.setData({ reminderSubscriptionState: state });
      return setting;
    });
  },

  applySettingsToPage(settings) {
    const normalized = eventApi.normalizeSettings(settings || storage.getSettings());
    const backgroundUnlimited = !!normalized.backgroundUnlimited || !!this.data.aiUnlimited;
    const customBackgrounds = normalizeCustomBackgrounds(normalized.customBackgrounds || [], backgroundUnlimited);
    const backgrounds = buildBackgroundList(customBackgrounds, backgroundUnlimited);
    const theme = backgrounds.find((item) => item.id === normalized.themeBackgroundId) || BACKGROUNDS[0];
    const categories = storage.DEFAULT_CATEGORIES.concat(storage.normalizeCustomCategories(normalized.customCategories || []));
    this.setData({
      categories,
      backgrounds,
      customBackgroundCount: customBackgrounds.length,
      customBackgroundLimit: backgroundUnlimited ? UNLOCKED_CUSTOM_BACKGROUND_LIMIT : CUSTOM_BACKGROUND_LIMIT,
      backgroundUnlimited,
      pageBackgroundId: theme.id,
      pageBackgroundImage: getPageBackgroundImage(theme),
      pageBackgroundStyle: buildBackgroundStyle(theme),
      showBottomTip: !normalized.hideBottomTip,
      aiEnabled: Object.prototype.hasOwnProperty.call(normalized, "aiEnabled") ? !!normalized.aiEnabled : !!env.defaultAiEnabled,
    }, () => this.refreshDisplay());
  },

  persistSettings(settings, options) {
    const normalized = eventApi.normalizeSettings(settings || storage.getSettings());
    storage.saveSettings(normalized);
    if (!options || options.apply !== false) {
      this.applySettingsToPage(normalized);
    }
    return eventApi.saveSettingsSnapshot(normalized).then((result) => {
      if (!result.cloud && result.error) {
        console.warn("设置已保存到本地，云端设置同步失败", result.error);
      }
      return result;
    });
  },

  refreshDisplay() {
    const selectedId = this.data.selectedCategoryId;
    const category = this.data.categories.find((item) => item.id === selectedId) || this.data.categories[0];
    const hydrated = this.data.events
      .map((event) => this.hydrateEvent(event))
      .filter((event) => selectedId === "all" || event.categoryId === selectedId)
      .sort((left, right) => {
        const rankDiff = getSortRank(left) - getSortRank(right);
        if (rankDiff) return rankDiff;
        if (left.isPinned && right.isPinned) {
          const leftOrder = Number(left.pinOrder || left.pinAt || 0);
          const rightOrder = Number(right.pinOrder || right.pinAt || 0);
          return rightOrder - leftOrder;
        }
        if (left.status === "past" && right.status === "past") {
          return String(right.targetDate).localeCompare(String(left.targetDate));
        }
        return String(left.targetDate).localeCompare(String(right.targetDate));
      });

    this.setData({
      displayEvents: hydrated,
      selectedCategoryName: category ? category.name : "全部",
    });
  },

  hydrateEvent(event) {
    const background = this.data.backgrounds.find((item) => item.id === event.backgroundId) || BACKGROUNDS[0];
    const cardImage = background.cardPreview || background.cardImage || background.url || "";
    const category = this.data.categories.find((item) => item.id === event.categoryId) || { name: "生活" };
    const info = dateUtils.getCountdownInfo(event.targetDate);
    const reminder = reminderService.normalizeEventReminder(event);
    const hasReminder = reminder.reminderPlan.some((item) => item.remindAt && !item.sentAt);
    return Object.assign({}, event, info, {
      backgroundClass: cardImage ? "" : `bg-template-${background.id}`,
      backgroundStyle: "",
      cardImage,
      cardStyle: cardImage ? "" : (BACKGROUND_STYLES[background.id] || BACKGROUND_STYLES.yellow_grid),
      categoryName: category.name,
      displayDate: dateUtils.formatDisplayDate(event.targetDate),
      displayMeta: `${category.name}${event.targetTime ? ` · ${event.targetTime}` : ""}`,
      pinnedText: event.isPinned ? "置顶重要" : "",
      reminderBadgeText: hasReminder ? "已设提醒" : "",
    });
  },

  persistEventChanges(events, changedIds) {
    const normalized = (events || []).map(eventApi.normalizeEvent);
    const ids = new Set((changedIds || []).filter(Boolean));
    const changedEvents = normalized.filter((item) => ids.has(item.id));
    storage.saveEvents(normalized);
    this.setData({ events: normalized }, () => this.refreshDisplay());
    if (!changedEvents.length) return Promise.resolve({ cloud: true });
    return Promise.all(changedEvents.map((item) => eventApi.saveEvent(item)))
      .then((results) => {
        const cloud = results.every((item) => item && item.cloud);
        this.setData({
          cloudReady: cloud,
          syncText: cloud ? "云端已同步" : "已保存到本地，云端同步失败",
        });
        return { cloud, results };
      })
      .catch((error) => {
        this.setData({ cloudReady: false, syncText: "已保存到本地，云端同步失败" });
        return { cloud: false, error };
      });
  },

  showParseHint(candidate) {
    this.showCenterNotice(candidate && candidate.message ? candidate.message : eventParser.EXAMPLE_HINT);
  },

  decorateImportCandidates(candidates, sourceType) {
    return (candidates || []).map((item) => Object.assign({}, item, {
      missingText: item.message || (item.missingFields || []).join("、"),
      sourceType: sourceType || item.sourceType || "text_import",
    }));
  },

  buildImportCandidatesFromAi(result, rawText, sourceType) {
    if (!result || result.type === "warm_tip") return [];
    const operations = Array.isArray(result.operations) ? result.operations : [];
    return operations
      .filter((item) => item && item.action === "create")
      .map((item, index) => {
        const title = String(item.title || "").trim();
        const targetDate = String(item.targetDate || "").trim();
        const targetTime = String(item.targetTime || "").trim();
        const missingFields = [];
        if (!title) missingFields.push("事项");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) missingFields.push("日期");
        const canSave = missingFields.length === 0;
        return {
          id: `ai_import_${Date.now()}_${index}`,
          rawText: item.message || title || rawText,
          ok: canSave,
          canSave,
          selected: canSave,
          title,
          targetDate: canSave ? targetDate : targetDate,
          targetTime,
          location: "",
          action: title,
          categoryId: "life",
          repeat: "none",
          reminderOffsets: targetTime ? ["1d", "2h"] : [],
          missingFields,
          missingText: missingFields.length ? `需要补上${missingFields.join("、")}` : "",
          message: missingFields.length ? `需要补上${missingFields.join("、")}` : "",
          sourceType: sourceType || "image_ocr",
        };
      });
  },

  onNotice(event) {
    const detail = event.detail || {};
    this.showCenterNotice(detail.text || detail.message || eventParser.EXAMPLE_HINT, detail);
  },

  buildEventFromForm(form, sourceType, sourceText) {
    const now = Date.now();
    const reminderFields = reminderService.normalizeEventReminder(form);
    return {
      id: form.id || createId("event"),
      title: form.title,
      targetDate: form.targetDate,
      targetTime: form.targetTime || "",
      location: form.location || "",
      categoryId: form.categoryId || "life",
      repeat: form.repeat || "none",
      reminderOffsets: form.reminderOffsets || [],
      reminderMode: reminderFields.reminderMode,
      autoReminderDisabled: !!reminderFields.autoReminderDisabled,
      reminderPlan: reminderFields.reminderPlan,
      reminder: reminderFields.reminder,
      isPinned: !!form.isPinned,
      pinAt: form.isPinned ? (form.pinAt || now) : 0,
      pinOrder: form.isPinned ? (form.pinOrder || form.pinAt || now) : 0,
      backgroundId: form.backgroundId || "yellow_grid",
      customBackgroundFileID: form.customBackgroundFileID || "",
      cloudDocId: form.cloudDocId || "",
      sourceType: sourceType || "manual",
      sourceText: sourceText || form.rawText || "",
      createdAt: form.createdAt || now,
      updatedAt: now,
    };
  },

  onOpenCategory() {
    this.setData({ showCategory: true });
  },

  onCloseCategory() {
    this.setData({ showCategory: false });
  },

  onSelectCategory(event) {
    this.setData({
      selectedCategoryId: event.detail.id,
      showCategory: false,
    }, () => {
      this.refreshDisplay();
    });
  },

  onAddCategory() {
    this.setData({
      showCategory: false,
      showCategoryCreate: true,
    });
  },

  onCloseCategoryCreate() {
    this.setData({ showCategoryCreate: false });
  },

  onCategoryCreateConfirm(event) {
    const name = String(event.detail.name || "").trim().slice(0, 6);
    if (!name) {
      this.showCenterNotice("写个分类名称");
      return;
    }
    if (this.data.categories.some((item) => item.name === name)) {
      this.showCenterNotice("这个分类已经存在");
      return;
    }
    const category = {
      id: createId("category"),
      name,
      icon: event.detail.icon || "/assets/original/icon_calendar.png",
      isSystem: false,
      createdAt: Date.now(),
    };
    const categories = this.data.categories.concat(category);
    storage.saveCategories(categories);
    const settings = storage.getSettings();
    this.persistSettings(Object.assign({}, settings, {
      customCategories: storage.normalizeCustomCategories(categories),
    }), { apply: false });
    this.setData({ categories, showCategoryCreate: false });
  },

  onDeleteCategory(event) {
    const category = this.data.categories.find((item) => item.id === event.detail.id);
    if (!category || category.isSystem) return;
    const usedCount = this.data.events.filter((item) => item.categoryId === category.id).length;
    this.setData({
      showCategory: false,
      showConfirm: true,
      confirmTitle: "删除分类",
      confirmContent: usedCount
        ? `删除「${category.name}」后，${usedCount} 条事项会移到「生活」。`
        : `确定删除「${category.name}」吗？`,
      confirmCancelText: "取消",
      confirmConfirmText: "删除",
      confirmAction: { type: "deleteCategory", category },
    });
  },

  deleteCategory(category) {
    if (!category || category.isSystem) return;
    const categories = this.data.categories.filter((item) => item.id !== category.id);
    const events = this.data.events.map((item) => (
      item.categoryId === category.id
        ? Object.assign({}, item, { categoryId: "life", updatedAt: Date.now() })
        : item
    ));
    storage.saveCategories(categories);
    const settings = storage.getSettings();
    this.persistSettings(Object.assign({}, settings, {
      customCategories: storage.normalizeCustomCategories(categories),
    }), { apply: false });
    const changedIds = this.data.events.filter((item) => item.categoryId === category.id).map((item) => item.id);
    this.persistEventChanges(events, changedIds);
    this.setData({
      categories,
      selectedCategoryId: this.data.selectedCategoryId === category.id ? "all" : this.data.selectedCategoryId,
    }, () => this.refreshDisplay());
    this.showCenterNotice("分类已删除", { icon: "✓", type: "success" });
  },

  onOpenAdd() {
    this.setData({
      addForm: defaultForm(),
      showAddModal: true,
      reminderError: "",
    });
  },

  onCloseAdd() {
    this.setData({ showAddModal: false, reminderError: "" });
  },

  onAddFormChange(event) {
    this.setData({ addForm: Object.assign({}, this.data.addForm, event.detail || {}) });
  },

  getEventById(id) {
    if (!id) return null;
    return this.data.events.find((item) => item.id === id) || null;
  },

  onAddConfirm(event) {
    const form = event.detail;
    const oldEvent = this.getEventById(form.id);
    if (oldEvent && !eventDiff.hasMeaningfulEventChanges(oldEvent, form)) {
      this.setData({
        showAddModal: false,
        reminderError: "",
        savingEvent: false,
      });
      return;
    }
    this.setData({ reminderError: "" });
    const nextReminder = reminderService.normalizeEventReminder(form);
    if (
      oldEvent
      && nextReminder.reminderMode !== "off"
      && reminderService.dateTimeChanged(oldEvent, form)
      && reminderService.hasActiveReminder(oldEvent)
    ) {
      this.setData({
        showConfirm: true,
        confirmTitle: "事件时间已变动",
        confirmContent: "要把提醒时间也一起同步吗？",
        confirmCancelText: "保持不变",
        confirmConfirmText: "同步提醒",
        confirmAction: { type: "syncReminderTime", form, oldEvent },
      });
      return;
    }
    this.prepareAndSaveForm(form, { oldEvent });
  },

  prepareAndSaveForm(form, options) {
    const opts = options || {};
    const oldEvent = opts.oldEvent || this.getEventById(form.id);
    const currentReminder = reminderService.normalizeEventReminder(form);
    const mode = currentReminder.reminderMode;
    const oldReminder = reminderService.normalizeEventReminder(oldEvent || {});
    const now = Date.now();
    const activeGrantedPlans = currentReminder.reminderPlan.concat(oldReminder.reminderPlan).filter((item) => {
      if (!item || !item.subscribed || item.sentAt || !item.remindAt) return false;
      const remindDate = reminderService.parseDateTime(item.remindAt.slice(0, 10), item.remindAt.slice(11, 16));
      return remindDate && remindDate.getTime() > now;
    });
    const activeGrantCount = activeGrantedPlans.length;
    const autoPreview = mode === "auto" && !form.autoReminderDisabled ? reminderService.buildAutoReminderPlan(form) : [];
    const oldMode = oldReminder.reminderMode;
    const oldRemindAt = oldReminder.reminder && oldReminder.reminder.remindAt;
    const nextRemindAt = currentReminder.reminder && currentReminder.reminder.remindAt;
    const reminderChanged = !oldEvent
      || oldMode !== mode
      || oldRemindAt !== nextRemindAt
      || !!form.reminderAuthorizationRefresh;
    const keepExisting = !!(
      opts.keepExisting
      || (form.preserveExistingReminder && !opts.syncFromOld)
      || (oldEvent && !reminderChanged)
    );
    if (mode === "off" || keepExisting) {
      const reminderFields = reminderService.buildReminderFields(form, {
        oldEvent,
        keepExisting,
        syncFromOld: opts.syncFromOld,
      });
      this.saveConfirmedForm(Object.assign({}, form, reminderFields), Object.assign({}, opts, {
        showAutoNotice: !keepExisting && reminderFields.reminderMode === "auto" && reminderFields.reminderPlan.length > 0,
        preserveReminderJobs: keepExisting,
      }));
      return;
    }

    const requiredCount = mode === "auto" ? autoPreview.length : 1;
    if (!requiredCount) {
      const offFields = reminderService.buildReminderFields(Object.assign({}, form, { reminderMode: "off" }), {});
      this.saveConfirmedForm(Object.assign({}, form, offFields), Object.assign({}, opts, { showAutoNotice: false }));
      return;
    }

    if (!form.reminderAuthorizationRefresh && activeGrantCount >= requiredCount) {
      this.finalizeReminderSave(form, opts, oldEvent, requiredCount);
      return;
    }

    reminderService.requestReminderSubscribe(1).then((result) => {
      if (!result || !result.subscribed) {
        this.handleReminderAuthorizationFailure(result);
        return;
      }
      if (mode === "auto" && requiredCount > 1) {
        this.pendingReminderSave = { form, opts, oldEvent, grantedCount: 1 };
        this.setData({
          showConfirm: true,
          confirmTitle: "再授权一次提醒",
          confirmContent: "一天前提醒已授权。继续授权后，还会在三天前提醒一次。横幅样式由微信中的“接收并提醒”设置决定。",
          confirmCancelText: "只提醒一次",
          confirmConfirmText: "授权三天前提醒",
          confirmAction: { type: "authorizeAutoThreeDay" },
        });
        return;
      }
      this.finalizeReminderSave(form, opts, oldEvent, 1);
    });
  },

  handleReminderAuthorizationFailure(result) {
    const message = (result && result.errMsg) || "微信没有返回授权结果，请重新授权";
    this.setData({ reminderError: message });
    if (result && result.needsOpenSetting) {
      this.setData({
        showConfirm: true,
        confirmTitle: "开启微信提醒",
        confirmContent: "微信提醒已在设置中关闭。请先去设置开启，返回后再点事件的确定按钮重新授权。",
        confirmCancelText: "暂不开启",
        confirmConfirmText: "去设置",
        confirmAction: { type: "openReminderSettings" },
      });
    }
  },

  finalizeReminderSave(form, options, oldEvent, grantedCount) {
    const reminderFields = reminderService.buildReminderFields(form, {
      oldEvent,
      syncFromOld: options && options.syncFromOld,
      subscribed: grantedCount > 0,
      subscriptionCount: grantedCount,
    });
    this.saveConfirmedForm(Object.assign({}, form, reminderFields), Object.assign({}, options, {
      showAutoNotice: reminderFields.reminderMode === "auto" && reminderFields.reminderPlan.length > 0,
      subscribed: grantedCount > 0,
    }));
  },

  async saveConfirmedForm(form, options) {
    if (this.data.savingEvent) return;
    const saveStartedAt = Date.now();
    const opts = options || {};
    const nextEvent = this.buildEventFromForm(form, opts.sourceType || "manual", opts.sourceText || form.rawText || "");
    const oldEvent = this.data.events.find((item) => item.id === nextEvent.id) || null;
    const exists = !!oldEvent;
    if (oldEvent && oldEvent.cloudDocId) nextEvent.cloudDocId = oldEvent.cloudDocId;
    const previousEvents = this.data.events.slice();
    let events = exists
      ? this.data.events.map((item) => (item.id === nextEvent.id ? Object.assign({}, item, nextEvent, { createdAt: item.createdAt }) : item))
      : this.data.events.concat(nextEvent);
    const oldHadReminder = oldEvent && reminderService.hasActiveReminder(oldEvent);
    const canSaveOptimistically = nextEvent.reminderMode === "off" && !oldHadReminder;

    if (canSaveOptimistically) {
      storage.saveEvents(events);
      this.setData({
        events,
        showAddModal: false,
        savingEvent: false,
        reminderError: "",
      }, () => this.refreshDisplay());
      this.showCenterNotice(exists ? "已更新" : "已添加", { icon: "✓", type: "success" });

      eventApi.saveEvent(nextEvent, { create: !exists }).then((result) => {
        if (!result.cloud) throw (result.error || new Error("事件未同步到云端"));
        const current = this.data.events.find((item) => item.id === nextEvent.id);
        if (!current || Number(current.updatedAt) !== Number(nextEvent.updatedAt)) return;
        const savedEvent = Object.assign({}, current, result.event || {});
        const syncedEvents = this.data.events.map((item) => (item.id === savedEvent.id ? savedEvent : item));
        storage.saveEvents(syncedEvents);
        this.setData({
          events: syncedEvents,
          cloudReady: true,
          syncText: "云端已同步",
        }, () => this.refreshDisplay());
        console.info("事件保存耗时", {
          totalMs: Date.now() - saveStartedAt,
          reminderMode: "off",
          backgroundSync: true,
        });
      }).catch((error) => {
        const current = this.data.events.find((item) => item.id === nextEvent.id);
        if (!current || Number(current.updatedAt) !== Number(nextEvent.updatedAt)) return;
        storage.saveEvents(previousEvents);
        this.setData({
          events: previousEvents,
          cloudReady: false,
          syncText: "云端同步失败",
        }, () => this.refreshDisplay());
        this.showCenterNotice(error.message || error.errMsg || "云端同步失败，请重试", { type: "error" });
      });
      return;
    }

    this.setData({ savingEvent: true, reminderError: "" });
    let saveResult = null;
    try {
      const subscribedPlans = nextEvent.reminderPlan.filter((item) => item.subscribed && !item.sentAt);
      const reminderTask = opts.preserveReminderJobs
        ? Promise.resolve({ ok: true, scheduledJobs: subscribedPlans, preserved: true, elapsedMs: 0 })
        : (nextEvent.reminderMode !== "off"
          ? eventApi.syncEventReminders(nextEvent)
          : (oldHadReminder ? eventApi.cancelEventReminders(nextEvent.id) : Promise.resolve({ ok: true, scheduledJobs: [] })));
      const results = await Promise.all([eventApi.saveEvent(nextEvent, { create: !exists }), reminderTask]);
      saveResult = results[0];
      const syncResult = results[1];
      if (!saveResult.cloud) throw (saveResult.error || new Error("事件未同步到云端"));
      if (nextEvent.reminderMode !== "off" && !opts.preserveReminderJobs) {
        if ((syncResult.scheduledJobs || []).length !== subscribedPlans.length) {
          throw new Error("提醒任务数量校验失败");
        }
      }
      const savedEvent = Object.assign({}, nextEvent, saveResult.event || {});
      events = exists
        ? events.map((item) => (item.id === savedEvent.id ? Object.assign({}, item, savedEvent) : item))
        : events.map((item) => (item.id === savedEvent.id ? savedEvent : item));
      storage.saveEvents(events);
      this.setData({
        events,
        cloudReady: true,
        syncText: "云端已同步",
      }, () => this.refreshDisplay());
      console.info("事件保存耗时", {
        totalMs: Date.now() - saveStartedAt,
        reminderMode: nextEvent.reminderMode,
        reminderCloudMs: Number(syncResult.elapsedMs || 0),
      });
    } catch (error) {
      if (!opts.preserveReminderJobs) await eventApi.cancelEventReminders(nextEvent.id).catch(() => {});
      if (saveResult && saveResult.cloud) {
        if (oldEvent) await eventApi.saveEvent(oldEvent).catch(() => {});
        else await eventApi.deleteEvent(nextEvent.id, saveResult.event && saveResult.event.cloudDocId).catch(() => {});
      }
      storage.saveEvents(previousEvents);
      this.setData({
        events: previousEvents,
        savingEvent: false,
        reminderError: error.message || error.errMsg || "保存失败，请检查云开发后重试",
      }, () => this.refreshDisplay());
      return;
    }
    this.setData({ showAddModal: false, reminderError: "", savingEvent: false });
    if (options && options.showAutoNotice) {
      const summary = reminderService.formatPlanSummary(nextEvent.reminderPlan);
      const reminderText = `${summary ? `会在 ${summary} 提醒你` : "已保存自动提醒"}。横幅样式由微信中的“接收并提醒”设置决定。`;
      this.clearCenterNotice();
      this.setData({
        showAutoReminderNotice: true,
        autoReminderNoticeText: reminderText,
      });
      return;
    }
    this.showCenterNotice(exists ? "已更新" : "已添加", { icon: "✓", type: "success" });
  },

  onAddEaster() {
    this.setData({
      showAddModal: false,
      addForm: defaultForm(),
      showEaster: true,
    });
    aiIntent.unlockUnlimited("959499")
      .then((result) => {
        if (!result.ok) return;
        this.applyAiQuota(result.quota);
      })
      .catch(() => {});
    setTimeout(() => {
      this.setData({ showEaster: false });
    }, 1350);
  },

  openEventEditor(item) {
    if (!item) return;
    const reminderWasActive = reminderService.hasActiveReminder(item);
    if (wx.hideKeyboard) wx.hideKeyboard();
    setTimeout(() => {
      this.setData({
        addForm: Object.assign({}, defaultForm(), item, {
          reminderWasActive,
          reminderEditorOpened: false,
          reminderChangedByUser: false,
          reminderAuthorizationRefresh: false,
        }),
        showAddModal: true,
        reminderError: "",
      });
    }, 60);
  },

  onCardTap(event) {
    const card = event.detail.event;
    const cached = this.data.events.find((entry) => entry.id === card.id) || card;
    eventApi.loadEvent(card.id).then((cloudEvent) => {
      const freshEnough = cloudEvent
        && Number(cloudEvent.updatedAt || 0) >= Number(cached.updatedAt || 0);
      const item = freshEnough ? cloudEvent : cached;
      if (freshEnough) {
        const events = this.data.events.map((entry) => (entry.id === item.id ? item : entry));
        storage.saveEvents(events);
        this.setData({ events }, () => this.refreshDisplay());
      }
      this.openEventEditor(item);
    });
  },

  onCardDelete(event) {
    const card = event.detail.event;
    const reminder = reminderService.normalizeEventReminder(card);
    const hasReminder = reminder.reminderPlan.some((item) => item.remindAt && !item.sentAt);
    this.setData({
      showConfirm: true,
      confirmTitle: "删除事件",
      confirmContent: hasReminder
        ? `确定删除「${card.title}」吗？删除后，未发送的微信提醒也会取消。`
        : `确定删除「${card.title}」吗？`,
      confirmCancelText: "取消",
      confirmConfirmText: "确定",
      confirmAction: { type: "delete", id: card.id },
    });
  },

  getVisiblePinned() {
    return (this.data.displayEvents || []).filter((item) => item.isPinned);
  },

  moveItem(list, fromIndex, toIndex) {
    const next = list.slice();
    const item = next.splice(fromIndex, 1)[0];
    next.splice(toIndex, 0, item);
    return next;
  },

  composeDisplayWithPinnedOrder(pinnedOrder) {
    const pinnedIds = pinnedOrder.map((item) => item.id);
    const pinnedMap = {};
    pinnedOrder.forEach((item) => {
      pinnedMap[item.id] = item;
    });
    const pinnedSet = {};
    pinnedIds.forEach((id) => {
      pinnedSet[id] = true;
    });
    const rest = (this.data.displayEvents || []).filter((item) => !pinnedSet[item.id]);
    return pinnedOrder.concat(rest);
  },

  onPinnedDragStart(event) {
    const detail = event.detail || {};
    const pinned = this.getVisiblePinned();
    const startPinnedIndex = pinned.findIndex((item) => item.id === detail.id);
    if (startPinnedIndex < 0) return;
    const system = wx.getWindowInfo ? wx.getWindowInfo() : { windowWidth: 375 };
    this.pinnedDrag = {
      id: detail.id,
      startY: Number(detail.y || 0),
      startPinnedIndex,
      currentPinnedIndex: startPinnedIndex,
      itemHeight: Math.max(78, 154 * ((system.windowWidth || 375) / 750)),
    };
    this.setData({
      displayEvents: (this.data.displayEvents || []).map((item) => (
        item.id === detail.id ? Object.assign({}, item, { draggingPinned: true, dragOffsetY: 0 }) : item
      )),
    });
  },

  onPinnedDragMove(event) {
    if (!this.pinnedDrag) return;
    const detail = event.detail || {};
    const pinned = this.getVisiblePinned().map((item) => (
      item.id === this.pinnedDrag.id ? Object.assign({}, item, { draggingPinned: true }) : item
    ));
    if (pinned.length <= 1) return;
    const delta = Number(detail.y || 0) - this.pinnedDrag.startY;
    const step = Math.round(delta / this.pinnedDrag.itemHeight);
    const targetIndex = Math.max(0, Math.min(pinned.length - 1, this.pinnedDrag.startPinnedIndex + step));
    const currentIndex = pinned.findIndex((item) => item.id === this.pinnedDrag.id);
    const nextPinned = targetIndex === this.pinnedDrag.currentPinnedIndex
      ? pinned
      : this.moveItem(pinned, currentIndex, targetIndex);
    this.pinnedDrag.currentPinnedIndex = targetIndex;
    const visualOffset = delta - (targetIndex - this.pinnedDrag.startPinnedIndex) * this.pinnedDrag.itemHeight;
    this.setData({
      displayEvents: this.composeDisplayWithPinnedOrder(nextPinned.map((item) => (
        item.id === this.pinnedDrag.id ? Object.assign({}, item, { draggingPinned: true, dragOffsetY: visualOffset }) : item
      ))),
    });
  },

  onPinnedDragEnd() {
    if (!this.pinnedDrag) return;
    const dragId = this.pinnedDrag.id;
    const visiblePinned = this.getVisiblePinned().map((item) => Object.assign({}, item, { draggingPinned: false, dragOffsetY: 0 }));
    this.pinnedDrag = null;
    if (!visiblePinned.length) {
      this.refreshDisplay();
      return;
    }
    const base = Date.now();
    const orderById = {};
    visiblePinned.forEach((item, index) => {
      orderById[item.id] = base + (visiblePinned.length - index) * 1000;
    });
    const events = this.data.events.map((item) => {
      if (!item.isPinned || !Object.prototype.hasOwnProperty.call(orderById, item.id)) return item;
      return Object.assign({}, item, {
        pinOrder: orderById[item.id],
        pinAt: item.pinAt || orderById[item.id],
        updatedAt: Date.now(),
      });
    });
    this.persistEventChanges(events, Object.keys(orderById));
    this.showCenterNotice("置顶顺序已更新", { duration: 900 });
  },

  clearCenterNotice() {
    if (this.centerNoticeTimer) {
      clearTimeout(this.centerNoticeTimer);
      this.centerNoticeTimer = null;
    }
    this.setData({
      showCenterToast: false,
      centerToastText: "",
      centerToastIcon: "",
      centerToastType: "",
    });
  },

  showCenterNotice(text, options) {
    if (this.centerNoticeTimer) {
      clearTimeout(this.centerNoticeTimer);
    }
    const duration = options && Object.prototype.hasOwnProperty.call(options, "duration") ? Number(options.duration) : 1400;
    this.setData({
      showCenterToast: true,
      centerToastText: String(text || ""),
      centerToastIcon: options && options.icon ? options.icon : "",
      centerToastType: options && options.type ? options.type : "",
    });
    if (duration <= 0) {
      this.centerNoticeTimer = null;
      return;
    }
    this.centerNoticeTimer = setTimeout(() => {
      this.setData({
        showCenterToast: false,
        centerToastText: "",
        centerToastIcon: "",
        centerToastType: "",
      });
      this.centerNoticeTimer = null;
    }, duration);
  },

  onCardMenu(event) {
    this.setData({
      actionEvent: event.detail.event,
      showAction: true,
    });
  },

  onCloseAction() {
    this.setData({ showAction: false });
  },

  onActionEdit(event) {
    const item = this.data.events.find((entry) => entry.id === event.detail.event.id);
    const reminderWasActive = reminderService.hasActiveReminder(item || {});
    this.setData({
      addForm: Object.assign({}, defaultForm(), item || {}, {
        reminderWasActive,
        reminderEditorOpened: false,
        reminderChangedByUser: false,
        reminderAuthorizationRefresh: false,
      }),
      showAction: false,
      showAddModal: true,
    });
  },

  onActionBackground(event) {
    this.setData({
      actionEvent: event.detail.event,
      backgroundPickerMode: "event",
      showAction: false,
      showBackgroundPicker: true,
    });
  },

  onOpenThemePicker() {
    this.setData({
      backgroundPickerMode: "theme",
      showBackgroundPicker: true,
    });
  },

  onCloseBackgroundPicker() {
    this.setData({ showBackgroundPicker: false });
  },

  onSelectBackground(event) {
    const allBackgrounds = this.data.backgrounds || BACKGROUNDS;
    const selectedBackground = allBackgrounds.find((item) => item.id === event.detail.id) || BACKGROUNDS[0];
    if (this.data.backgroundPickerMode === "event" && this.data.actionEvent.id) {
      const events = this.data.events.map((item) => (
        item.id === this.data.actionEvent.id ? Object.assign({}, item, { backgroundId: selectedBackground.id, customBackgroundFileID: selectedBackground.fileID || "", updatedAt: Date.now() }) : item
      ));
      this.persistEventChanges(events, [this.data.actionEvent.id]);
      this.setData({ showBackgroundPicker: false, actionEvent: {} });
      return;
    }

    const settings = storage.getSettings();
    this.persistSettings(Object.assign({}, settings, { themeBackgroundId: selectedBackground.id }), { apply: true });
    this.setData({ showBackgroundPicker: false });
  },

  onDeleteCustomBackground(event) {
    const background = (this.data.backgrounds || []).find((item) => item.id === event.detail.id);
    if (!background || !background.isCustom) return;
    this.setData({
      showConfirm: true,
      confirmTitle: "删除背景",
      confirmContent: "删除这张背景？",
      confirmCancelText: "取消",
      confirmConfirmText: "删除",
      confirmAction: { type: "deleteBackground", background },
    });
  },

  onImportBackground() {
    const settings = eventApi.normalizeSettings(storage.getSettings());
    const backgroundUnlimited = !!settings.backgroundUnlimited || !!this.data.aiUnlimited;
    const customBackgrounds = normalizeCustomBackgrounds(settings.customBackgrounds || [], backgroundUnlimited);
    const backgroundLimit = backgroundUnlimited ? UNLOCKED_CUSTOM_BACKGROUND_LIMIT : CUSTOM_BACKGROUND_LIMIT;
    if (customBackgrounds.length >= backgroundLimit) {
      this.showCenterNotice(`自定义背景最多 ${backgroundLimit} 张，先删除旧背景再导入`);
      return;
    }
    wx.chooseImage({
      count: 1,
      sizeType: ["original"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const filePath = result.tempFilePaths && result.tempFilePaths[0];
        if (!filePath) return;
        this.setData({
          showBackgroundPicker: false,
          showBackgroundCropper: true,
          backgroundCropImagePath: filePath,
        });
      },
      fail: () => {},
    });
  },

  onCloseBackgroundCropper() {
    this.setData({
      showBackgroundCropper: false,
      backgroundCropImagePath: "",
      showBackgroundPicker: true,
    });
  },

  onBackgroundCropConfirm(event) {
    const detail = event.detail || {};
    const filePath = detail.tempFilePath;
    if (!filePath) {
      this.showCenterNotice("裁剪失败，请重试");
      return;
    }
    this.setData({
      showBackgroundCropper: false,
      backgroundCropImagePath: "",
    });
    this.uploadCustomBackground(filePath, detail.cropInfo || { ratio: "9:16" });
  },

  removeCustomBackgroundConfig(background) {
    const settings = eventApi.normalizeSettings(storage.getSettings());
    const customBackgrounds = normalizeCustomBackgrounds(settings.customBackgrounds || [], settings.backgroundUnlimited)
      .filter((item) => item.id !== background.id && item.fileID !== background.fileID);
    const nextThemeBackgroundId = settings.themeBackgroundId === background.id
      ? DEFAULT_BACKGROUND_ID
      : settings.themeBackgroundId;
    const settingsSaved = this.persistSettings(Object.assign({}, settings, {
      customBackgrounds,
      themeBackgroundId: nextThemeBackgroundId,
    }), { apply: true });

    const changedIds = [];
    const events = this.data.events.map((item) => {
      if (item.backgroundId !== background.id && item.customBackgroundFileID !== background.fileID) return item;
      changedIds.push(item.id);
      return Object.assign({}, item, {
        backgroundId: DEFAULT_BACKGROUND_ID,
        customBackgroundFileID: "",
        updatedAt: Date.now(),
      });
    });
    if (changedIds.length) {
      this.persistEventChanges(events, changedIds);
    }
    this.setData({
      showBackgroundBusy: false,
      backgroundBusyText: "",
      actionEvent: this.data.actionEvent && this.data.actionEvent.backgroundId === background.id ? {} : this.data.actionEvent,
    });
    settingsSaved.then((result) => {
      this.showCenterNotice(result.cloud ? "背景已移除" : "背景已移除，云端配置同步失败", { icon: "✓", type: "success", duration: result.cloud ? 1400 : 2600 });
    });
  },

  deleteCustomBackground(background) {
    if (!background || !background.isCustom) return;
    if (!background.fileID) {
      this.setData({ showBackgroundBusy: true, backgroundBusyText: "正在删除背景" });
      this.removeCustomBackgroundConfig(background);
      return;
    }
    if (!wx.cloud || !wx.cloud.deleteFile) {
      this.showCenterNotice("云存储暂不可用，稍后再试");
      return;
    }
    this.setData({ showBackgroundBusy: true, backgroundBusyText: "正在删除背景" });
    wx.cloud.deleteFile({
      fileList: [background.fileID],
      success: (result) => {
        const outcome = cloudStorage.getDeleteFileOutcome(result);
        if (!outcome.ok) {
          this.setData({ showBackgroundBusy: false, backgroundBusyText: "" });
          this.showCenterNotice(outcome.message);
          return;
        }
        this.removeCustomBackgroundConfig(background);
      },
      fail: (error) => {
        if (cloudStorage.isCloudFileMissing(error)) {
          this.removeCustomBackgroundConfig(background);
          return;
        }
        this.setData({ showBackgroundBusy: false, backgroundBusyText: "" });
        this.showCenterNotice(error.errMsg || "云端图片删除失败");
      },
    });
  },

  uploadCustomBackground(filePath, cropInfo) {
    if (!wx.cloud || !wx.cloud.uploadFile) {
      this.showCenterNotice("请先开通云开发后再导入背景");
      return;
    }
    const settings = eventApi.normalizeSettings(storage.getSettings());
    const backgroundUnlimited = !!settings.backgroundUnlimited || !!this.data.aiUnlimited;
    const currentCustomBackgrounds = normalizeCustomBackgrounds(settings.customBackgrounds || [], backgroundUnlimited);
    const backgroundLimit = backgroundUnlimited ? UNLOCKED_CUSTOM_BACKGROUND_LIMIT : CUSTOM_BACKGROUND_LIMIT;
    if (currentCustomBackgrounds.length >= backgroundLimit) {
      this.showCenterNotice(`自定义背景最多 ${backgroundLimit} 张，先删除旧背景再导入`);
      return;
    }
    const cloudPath = `custom-backgrounds/${Date.now()}_${Math.floor(Math.random() * 10000)}.jpg`;
    this.setData({ showBackgroundBusy: true, backgroundBusyText: "正在保存背景" });
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (uploadResult) => {
        wx.cloud.getTempFileURL({
          fileList: [uploadResult.fileID],
          success: (urlResult) => {
            const urlItem = urlResult.fileList && urlResult.fileList[0];
            const background = {
              id: `custom_${Date.now()}`,
              name: "自定义",
              fileID: uploadResult.fileID,
              url: (urlItem && urlItem.tempFileURL) || filePath,
              createdAt: Date.now(),
              cropInfo: cropInfo || { ratio: "9:16" },
              isCustom: true,
            };
            const customBackgrounds = normalizeCustomBackgrounds(currentCustomBackgrounds.concat(background), backgroundUnlimited);
            const nextSettings = Object.assign({}, settings, {
              customBackgrounds,
              themeBackgroundId: this.data.backgroundPickerMode === "event" ? settings.themeBackgroundId : background.id,
            });
            const settingsSaved = this.persistSettings(nextSettings, { apply: true });
            if (this.data.backgroundPickerMode === "event" && this.data.actionEvent.id) {
              const events = this.data.events.map((item) => (
                item.id === this.data.actionEvent.id
                  ? Object.assign({}, item, {
                    backgroundId: background.id,
                    customBackgroundFileID: background.fileID || "",
                    updatedAt: Date.now(),
                  })
                  : item
              ));
              this.persistEventChanges(events, [this.data.actionEvent.id]);
            }
            this.setData({
              showBackgroundPicker: false,
              actionEvent: {},
              showBackgroundBusy: false,
              backgroundBusyText: "",
            });
            settingsSaved.then((saveResult) => {
              this.showCenterNotice(saveResult.cloud ? "背景已导入" : "背景已导入，云端配置同步失败", { icon: "✓", type: "success", duration: saveResult.cloud ? 1400 : 2600 });
            });
          },
          fail: () => {
            this.setData({ showBackgroundBusy: false, backgroundBusyText: "" });
            this.showCenterNotice("背景地址获取失败");
          },
        });
      },
      fail: (error) => {
        this.setData({ showBackgroundBusy: false, backgroundBusyText: "" });
        this.showCenterNotice(error.errMsg || "背景上传失败");
      },
    });
  },

  onActionDelete(event) {
    const reminder = reminderService.normalizeEventReminder(event.detail.event);
    const hasReminder = reminder.reminderPlan.some((item) => item.remindAt && !item.sentAt);
    this.setData({
      showAction: false,
      showConfirm: true,
      confirmTitle: "删除事件",
      confirmContent: hasReminder
        ? `确定删除「${event.detail.event.title}」吗？删除后，未发送的微信提醒也会取消。`
        : `确定删除「${event.detail.event.title}」吗？`,
      confirmCancelText: "取消",
      confirmConfirmText: "确定",
      confirmAction: { type: "delete", id: event.detail.event.id },
    });
  },

  onConfirmCancel() {
    const action = this.data.confirmAction;
    if (action && action.type === "syncReminderTime") {
      this.prepareAndSaveForm(action.form, { oldEvent: action.oldEvent, keepExisting: true });
    }
    if (action && action.type === "authorizeAutoThreeDay" && this.pendingReminderSave) {
      const pending = this.pendingReminderSave;
      this.pendingReminderSave = null;
      this.finalizeReminderSave(pending.form, pending.opts, pending.oldEvent, 1);
    }
    if (action && action.type === "authorizeNextAiReminder") {
      this.pendingAiExecution = null;
      this.showCenterNotice("提醒授权未完成，操作列表已保留", { duration: 2200 });
    }
    this.setData({ showConfirm: false, confirmAction: null });
  },

  onConfirmOk() {
    const action = this.data.confirmAction;
    if (action && action.type === "delete") {
      const target = this.data.events.find((item) => item.id === action.id);
      const events = this.data.events.filter((item) => item.id !== action.id);
      const cancelTask = target && reminderService.hasActiveReminder(target)
        ? eventApi.cancelEventReminders(action.id)
        : Promise.resolve({ ok: true });
      Promise.all([
        cancelTask,
        eventApi.deleteEvent(action.id, target && target.cloudDocId),
      ]).then((results) => {
          if (!results[1].cloud) throw (results[1].error || new Error("云端删除失败"));
          storage.saveEvents(events);
          this.setData({ events }, () => this.refreshDisplay());
          this.showCenterNotice("已删除", { icon: "✓", type: "success" });
        })
        .catch((error) => this.showCenterNotice(error.message || error.errMsg || "删除失败，请重试", { duration: 2400 }));
    }
    if (action && action.type === "syncReminderTime") {
      this.prepareAndSaveForm(action.form, { oldEvent: action.oldEvent, syncFromOld: true });
    }
    if (action && action.type === "authorizeAutoThreeDay" && this.pendingReminderSave) {
      const pending = this.pendingReminderSave;
      reminderService.requestReminderSubscribe(1).then((result) => {
        if (!result || !result.subscribed) {
          this.handleReminderAuthorizationFailure(result);
          return;
        }
        this.pendingReminderSave = null;
        this.finalizeReminderSave(pending.form, pending.opts, pending.oldEvent, 2);
      });
    }
    if (action && action.type === "authorizeNextAiReminder" && this.pendingAiExecution) {
      this.requestNextAiReminderGrant();
    }
    if (action && action.type === "deleteBackground") {
      this.deleteCustomBackground(action.background);
    }
    if (action && action.type === "deleteCategory") {
      this.deleteCategory(action.category);
    }
    if (action && action.type === "openReminderSettings") {
      reminderService.openReminderSettings().then(() => {
        if (this.data.showAddModal) {
          this.setData({ reminderError: "设置完成后，请再次点击确定按钮重新授权提醒" });
        }
      });
    }
    this.setData({ showConfirm: false, confirmAction: null });
  },

  onCloseAutoReminderNotice() {
    this.setData({
      showAutoReminderNotice: false,
      autoReminderNoticeText: "",
    });
  },

  applyAiQuota(quota) {
    const normalized = aiIntent.normalizeQuota(quota);
    this.setData({
      aiQuotaRemaining: normalized.unlimited ? 0 : normalized.remaining,
      aiUnlimited: normalized.unlimited,
      aiQuotaLoaded: true,
      aiQuotaChecking: false,
    });
    if (normalized.unlimited) {
      const settings = storage.getSettings();
      if (!settings.backgroundUnlimited) {
        this.persistSettings(Object.assign({}, settings, { backgroundUnlimited: true }), { apply: true });
      }
    }
    return normalized;
  },

  setAiEnabled(aiEnabled, options) {
    const enabled = !!aiEnabled;
    const settings = storage.getSettings();
    this.persistSettings(Object.assign({}, settings, { aiEnabled: enabled }), { apply: false });
    this.setData({ aiEnabled: enabled });
    if (!options || !options.silent) {
      this.showCenterNotice(enabled ? "AI识别已开启" : "AI识别已关闭");
    }
  },

  refreshAiQuotaStatus(options) {
    const opts = options || {};
    if (this.data.aiQuotaChecking) return Promise.resolve(null);
    this.setData({ aiQuotaChecking: true });
    return aiIntent.getQuotaStatus()
      .then((result) => {
        const quota = this.applyAiQuota(result.quota);
        if (opts.disableWhenExhausted && !quota.unlimited && quota.remaining <= 0 && this.data.aiEnabled) {
          this.setAiEnabled(false, { silent: true });
        }
        return quota;
      })
      .catch((error) => {
        this.setData({ aiQuotaChecking: false });
        if (!opts.silent) this.showCenterNotice(error.errMsg || error.message || "AI次数读取失败");
        return null;
      });
  },

  onToggleAi() {
    if (this.data.aiEnabled) {
      this.setAiEnabled(false);
      return;
    }
    if (this.data.aiQuotaLoaded && !this.data.aiUnlimited && this.data.aiQuotaRemaining <= 0) {
      this.showCenterNotice("AI识别次数已用完", { duration: 2400 });
      return;
    }

    // 开关先即时响应；额度校验在后台完成，避免云函数冷启动阻塞交互。
    this.setAiEnabled(true);
    this.refreshAiQuotaStatus({ silent: true, disableWhenExhausted: true });
  },

  onOpenAiTip() {
    this.setData({ showAiTip: true });
  },

  onCloseAiTip() {
    this.setData({ showAiTip: false });
  },

  buildAiContext() {
    return {
      today: dateUtils.getTodayString(new Date()),
      events: this.data.events.map((item) => ({
        id: item.id,
        title: item.title,
        targetDate: item.targetDate,
        targetTime: item.targetTime || "",
        categoryId: item.categoryId || "",
        categoryName: (this.data.categories.find((category) => category.id === item.categoryId) || {}).name || "",
        isPinned: !!item.isPinned,
        reminderMode: item.reminderMode || "off",
        reminder: item.reminder || { enabled: false, remindAt: "" },
      })),
    };
  },

  acceptAiResult(result) {
    if (result && result.quota) this.applyAiQuota(result.quota);
    if (result && result.type === "quota_exhausted") {
      this.setAiEnabled(false, { silent: true });
      this.showCenterNotice(result.message || "AI识别次数已用完", { duration: 2400 });
      return false;
    }
    return true;
  },

  openAiOperations(result) {
    if (result.type === "warm_tip" || result.type === "service_error") {
      this.showCenterNotice(result.message || aiIntent.WARM_TIP, { duration: 2600 });
      return;
    }
    this.setData({
      aiOperationResult: result,
      showAiOperations: true,
    });
  },

  onCloseAiOperations() {
    this.setData({ showAiOperations: false, aiOperationResult: {} });
  },

  onConfirmAiOperations(event) {
    const operations = event.detail.operations || [];
    if (!operations.length) return;
    const grantTasks = [];
    operations.forEach((operation, opIndex) => {
      if (operation.action !== "set_reminder" || !operation.reminder || operation.reminder.mode === "off") return;
      if (operation.reminder.mode === "manual") {
        grantTasks.push({ opIndex, label: `授权「${operation.targetEventQuery}」的手动提醒` });
        return;
      }
      const target = this.data.events.find((item) => item.id === operation.targetEventId);
      const count = reminderService.buildAutoReminderPlan(target || {}).length;
      for (let index = 0; index < count; index += 1) {
        grantTasks.push({
          opIndex,
          label: index === 0 ? `授权「${operation.targetEventQuery}」的一天前提醒` : `授权「${operation.targetEventQuery}」的三天前提醒`,
        });
      }
    });
    this.pendingAiExecution = {
      operations,
      grantTasks,
      taskIndex: 0,
      grantsByOperation: {},
    };
    if (!grantTasks.length) {
      this.executePreparedAiOperations(operations, {});
      return;
    }
    this.requestNextAiReminderGrant(true);
  },

  requestNextAiReminderGrant(immediate) {
    const pending = this.pendingAiExecution;
    if (!pending) return;
    const task = pending.grantTasks[pending.taskIndex];
    if (!task) {
      this.executePreparedAiOperations(pending.operations, pending.grantsByOperation);
      return;
    }
    const request = () => reminderService.requestReminderSubscribe(1).then((subscribe) => {
      if (!subscribe || !subscribe.subscribed) {
        this.pendingAiExecution = null;
        if (subscribe && subscribe.needsOpenSetting) {
          this.setData({
            showConfirm: true,
            confirmTitle: "开启微信提醒",
            confirmContent: "微信提醒已在设置中关闭。开启后请重新确认这组 AI 操作，当前列表不会丢失。",
            confirmCancelText: "暂不开启",
            confirmConfirmText: "去设置",
            confirmAction: { type: "openReminderSettings" },
          });
        } else {
          this.showCenterNotice((subscribe && subscribe.errMsg) || "授权未完成，整批操作未执行", { duration: 2400 });
        }
        return;
      }
      pending.grantsByOperation[task.opIndex] = Number(pending.grantsByOperation[task.opIndex] || 0) + 1;
      pending.taskIndex += 1;
      if (pending.taskIndex >= pending.grantTasks.length) {
        this.executePreparedAiOperations(pending.operations, pending.grantsByOperation);
        return;
      }
      const nextTask = pending.grantTasks[pending.taskIndex];
      this.setData({
        showConfirm: true,
        confirmTitle: "继续授权提醒",
        confirmContent: `${nextTask.label}。所有提醒授权完成后才会执行整组操作。`,
        confirmCancelText: "取消全部",
        confirmConfirmText: "继续授权",
        confirmAction: { type: "authorizeNextAiReminder" },
      });
    });
    if (immediate) {
      request();
      return;
    }
    request();
  },

  prepareAiReminderFields(operation, grantCount) {
    if (operation.action !== "set_reminder") return null;
    const target = this.data.events.find((item) => item.id === operation.targetEventId) || {};
    const reminder = operation.reminder || { mode: "off" };
    const form = Object.assign({}, target, {
      reminderMode: reminder.mode || "off",
      reminderPlan: [],
      reminder: Object.assign({}, target.reminder || {}, { enabled: reminder.mode !== "off", remindAt: reminder.remindAt || "" }),
      reminderAuthorizationRefresh: false,
    });
    return reminderService.buildReminderFields(form, {
      subscribed: grantCount > 0,
      subscriptionCount: grantCount,
    });
  },

  executePreparedAiOperations(operations, grantsByOperation) {
    const preparedOperations = operations.map((operation, index) => {
      const reminderFields = this.prepareAiReminderFields(operation, Number(grantsByOperation[index] || 0));
      return reminderFields ? Object.assign({}, operation, { reminderFields }) : operation;
    });
    this.pendingAiExecution = null;
    this.setData({ showAiOperations: false, showVoiceBusy: true });
    eventApi.batchApply(preparedOperations, this.data.events)
      .then((result) => {
        if (!result || !result.ok) throw new Error((result && result.message) || "AI 操作校验失败");
        const successCount = (result.results || []).filter((item) => item.ok).length;
        return eventApi.loadEvents().then((loadResult) => {
          const loadedEvents = loadResult.events || this.data.events;
          const changedIds = (result.results || []).map((item) => item.eventId).filter(Boolean);
          const reminderEvents = loadedEvents.filter((item) => changedIds.indexOf(item.id) >= 0 && item.reminderPlan.some((plan) => plan.subscribed && !plan.sentAt));
          return Promise.all(reminderEvents.map((item) => eventApi.syncEventReminders(item))).then(() => {
            this.setData({
              events: loadedEvents,
              showVoiceBusy: false,
              cloudReady: !!loadResult.cloud,
            }, () => this.refreshDisplay());
            this.showCenterNotice(`已完成${successCount}项操作`, { icon: "✓", type: "success" });
          });
        });
      })
      .catch((error) => {
        this.setData({ showVoiceBusy: false, showAiOperations: true });
        this.showCenterNotice(error.errMsg || error.message || "AI操作执行失败", { duration: 2600 });
      });
  },

  ensureVoiceIgnoreMap() {
    if (!this.ignoredVoiceRequests) {
      this.ignoredVoiceRequests = {};
    }
  },

  shouldIgnoreVoiceResult(requestId) {
    if (!requestId) return false;
    this.ensureVoiceIgnoreMap();
    if (this.ignoredVoiceRequests[requestId]) {
      delete this.ignoredVoiceRequests[requestId];
      return true;
    }
    return this.activeVoiceRequestId && requestId !== this.activeVoiceRequestId;
  },

  onVoiceStart(event) {
    const detail = event.detail || {};
    this.ensureVoiceIgnoreMap();
    this.activeVoiceRequestId = detail.requestId || "";
    if (this.activeVoiceRequestId) {
      delete this.ignoredVoiceRequests[this.activeVoiceRequestId];
    }
    this.clearCenterNotice();
    this.setData({ showVoiceBusy: false });
  },

  onVoiceProcessing(event) {
    const detail = event.detail || {};
    if (detail.requestId) {
      this.activeVoiceRequestId = detail.requestId;
    }
    this.clearCenterNotice();
    this.setData({ showVoiceBusy: true });
  },

  onVoiceCancel() {
    this.setData({ showVoiceBusy: false });
    this.clearCenterNotice();
  },

  onVoiceBusyClose() {
    this.ensureVoiceIgnoreMap();
    if (this.activeVoiceRequestId) {
      this.ignoredVoiceRequests[this.activeVoiceRequestId] = true;
    }
    this.setData({ showVoiceBusy: false });
    this.clearCenterNotice();
    this.showCenterNotice("已取消等待");
  },

  onVoiceError(event) {
    const detail = event.detail || {};
    if (this.shouldIgnoreVoiceResult(detail.requestId)) {
      return;
    }
    const message = typeof detail === "string"
      ? detail
      : detail.errMsg || detail.message || detail.msg || "语音识别失败，请再试一次";
    if (detail.code) {
      console.warn("[voice-recognize]", detail.code, message);
    }
    this.setData({ showVoiceBusy: false });
    this.clearCenterNotice();
    this.showCenterNotice(message);
  },

  onVoiceFinish(event) {
    const detail = event.detail || {};
    if (this.shouldIgnoreVoiceResult(detail.requestId)) {
      return;
    }
    const rawText = String(detail.rawText || "").trim();
    if (detail.timing) {
      console.info("[voice-recognize timing]", detail.timing);
    }
    this.setData({ showVoiceBusy: false });
    this.clearCenterNotice();
    if (!rawText) {
      this.showCenterNotice("没听清，试试：明天交作业");
      return;
    }
    if (this.data.aiEnabled) {
      this.setData({ showVoiceBusy: true });
      aiIntent.analyzeText(rawText, this.buildAiContext())
        .then((result) => {
          this.setData({ showVoiceBusy: false });
          if (!this.acceptAiResult(result)) return;
          this.openAiOperations(result);
        })
        .catch((error) => {
          this.setData({ showVoiceBusy: false });
          this.showCenterNotice(error.errMsg || error.message || "AI识别暂时不可用", { duration: 2600 });
        });
      return;
    }
    const candidate = eventParser.parseCreateEventText(rawText, new Date());
    if (!candidate.ok) {
      this.showParseHint(candidate);
      return;
    }
    this.setData({
      showVoiceResult: true,
      voiceRawText: rawText,
      voiceCandidate: candidate,
    });
  },

  onVoiceClose() {
    this.setData({ showVoiceResult: false });
  },

  onVoiceReparse(event) {
    const candidate = eventParser.parseCreateEventText(event.detail.rawText, new Date());
    if (!candidate.ok) {
      this.setData({ showVoiceResult: false });
      this.showParseHint(candidate);
      return;
    }
    this.setData({
      voiceRawText: event.detail.rawText,
      voiceCandidate: candidate,
    });
  },

  onVoiceConfirm(event) {
    const candidate = event.detail;
    const form = Object.assign({}, defaultForm(), candidate, {
      backgroundId: "peach_gingham",
    });
    this.setData({ showVoiceResult: false });
    this.prepareAndSaveForm(form, { sourceType: "voice", sourceText: candidate.rawText });
  },

  noop() {},

  onOpenImport() {
    this.setData({
      showImportSheet: true,
      importRawText: "",
    });
  },

  onCloseImport() {
    this.setData({ showImportSheet: false });
  },

  onParseImportText(event) {
    const rawText = String(event.detail.rawText || "").trim();
    if (!rawText) {
      this.showCenterNotice(eventParser.EXAMPLE_HINT);
      return;
    }
    if (this.data.aiEnabled) {
      this.setData({
        showImportSheet: false,
        showTextBusy: true,
        textBusyText: "正在整理文字内容",
      });
      aiIntent.analyzeText(rawText, Object.assign({}, this.buildAiContext(), {
        importMode: "create_only",
        source: "text_import",
      }))
        .then((aiResult) => {
          this.setData({ showTextBusy: false, textBusyText: "" });
          if (!this.acceptAiResult(aiResult)) return;
          const candidates = this.buildImportCandidatesFromAi(aiResult, rawText, "text_import");
          if (!candidates.length) {
            this.showCenterNotice((aiResult && aiResult.message) || "没有整理出可新增的事项");
            return;
          }
          this.setData({
            showImportResults: true,
            importRawText: rawText,
            importCandidates: candidates,
          });
        })
        .catch((error) => {
          this.setData({ showTextBusy: false, textBusyText: "" });
          this.showCenterNotice(error.errMsg || error.message || "文字整理失败，请再试一次", { duration: 2600 });
        });
      return;
    }
    const candidates = this.decorateImportCandidates(eventParser.parseImportedText(rawText, new Date()), "text_import");
    if (!candidates.length) {
      this.showCenterNotice(eventParser.EXAMPLE_HINT);
      return;
    }
    if (!candidates.some((item) => item.canSave)) {
      this.showCenterNotice("没有可生成事项，试试：明天交作业");
    }
    this.setData({
      showImportSheet: false,
      showImportResults: true,
      importRawText: rawText,
      importCandidates: candidates,
    });
  },

  onParseImportImage() {
    let requestId = 0;
    ocrImport.chooseSingleImage()
      .then((filePath) => {
        if (!filePath) return null;
        requestId = (this.imageImportRequestId || 0) + 1;
        this.imageImportRequestId = requestId;
        this.setData({
          showImportSheet: false,
          showImageBusy: true,
          imageBusyText: "正在识别图片",
        });
        return ocrImport.recognizeImage(filePath);
      })
      .then((result) => {
        if (!result || requestId !== this.imageImportRequestId) return null;
        const rawText = String(result.text || "").trim();
        if (!rawText) {
          this.setData({ showImageBusy: false, imageBusyText: "" });
          this.showCenterNotice("图片里没有识别到事项文字");
          return null;
        }
        if (this.data.aiEnabled) {
          this.setData({ imageBusyText: "正在整理图片内容" });
          return aiIntent.analyzeText(rawText, Object.assign({}, this.buildAiContext(), {
            importMode: "create_only",
            source: "image_ocr",
            ocrEngine: result.engine || "",
            ocrBlocks: Array.isArray(result.blocks) ? result.blocks : [],
          }))
            .then((aiResult) => {
              if (requestId !== this.imageImportRequestId) return null;
              this.setData({ showImageBusy: false, imageBusyText: "" });
              if (!this.acceptAiResult(aiResult)) return;
              const candidates = this.buildImportCandidatesFromAi(aiResult, rawText, "image_ocr");
              if (!candidates.length) {
                this.showCenterNotice((aiResult && aiResult.message) || "没有整理出可新增的事项");
                return;
              }
              this.setData({
                showImportResults: true,
                importRawText: rawText,
                importCandidates: candidates,
              });
              return null;
            });
        }
        const candidates = this.decorateImportCandidates(eventParser.parseImportedText(rawText, new Date()), "image_ocr");
        this.setData({
          showImageBusy: false,
          imageBusyText: "",
          showImportResults: true,
          importRawText: rawText,
          importCandidates: candidates,
        });
        return null;
      })
      .catch((error) => {
        if (requestId && requestId !== this.imageImportRequestId) return;
        this.setData({ showImageBusy: false, imageBusyText: "" });
        if (/cancel/i.test(String((error && (error.errMsg || error.message)) || ""))) return;
        this.showCenterNotice(error.errMsg || error.message || "图片识别失败，请再试一次", { duration: 2600 });
      });
  },

  onImageBusyClose() {
    this.imageImportRequestId = (this.imageImportRequestId || 0) + 1;
    this.setData({ showImageBusy: false, imageBusyText: "" });
  },

  onCloseImportResults() {
    this.setData({ showImportResults: false });
  },

  onImportConfirm(event) {
    const forms = event.detail.candidates.map((candidate) => Object.assign({}, defaultForm(), candidate, {
      backgroundId: "yellow_grid",
      reminderMode: "off",
      reminderPlan: [],
      reminder: {
        enabled: false,
        remindAt: "",
        templateId: env.reminderTemplateId || "",
        subscribed: false,
        sentAt: "",
      },
    }));
    const newEvents = forms.map((form, index) => {
      const candidate = event.detail.candidates[index];
      return this.buildEventFromForm(form, candidate.sourceType || "text_import", candidate.rawText);
    });
    this.persistEventChanges(this.data.events.concat(newEvents), newEvents.map((item) => item.id));
    this.setData({ showImportResults: false });
    this.showCenterNotice(`已生成${newEvents.length}条`, { icon: "✓", type: "success" });
  },

  onBottomClose() {
    this.setData({ showBottomTip: false });
  },

  onBottomNever() {
    const settings = storage.getSettings();
    this.persistSettings(Object.assign({}, settings, { hideBottomTip: true }), { apply: false });
    this.setData({ showBottomTip: false });
  },

  onShareAppMessage(options) {
    const id = options && options.target && options.target.dataset ? options.target.dataset.eventId : "";
    const event = this.data.events.find((item) => item.id === id) || this.data.events[0];
    if (event) {
      return {
        title: `${event.title} · ${dateUtils.formatShortDate(event.targetDate)}`,
        path: `/pages/index/index?eventId=${event.id}`,
      };
    }
    return {
      title: "重要日和小事都记住",
      path: "/pages/index/index",
    };
  },
});
