module.exports = {
  // 开通微信云开发后，把环境 ID 填到这里，例如 "prod-xxxxx"。
  // 留空时使用开发者工具当前选择的云环境；未开通云开发会自动退回本地缓存。
  cloudEnvId: "cloud1-d9g5kxfb5753d303b",

  // 订阅消息模板 ID：用于事件提醒。没有配置时仍可保存提醒设置，但不会真正发送模板消息。
  reminderTemplateId: "0XjhZTl3Z8betw28sLRm1XcKqLWqcozlfvzmqtxCOX4",

  // AI 默认开启状态。用户可在首页开关里随时调整，设置会保存到本地和云端。
  defaultAiEnabled: false,

  // 云函数名称集中配置，方便后续改名。
  functions: {
    getDashScopeToken: "getDashScopeToken",
    aiIntent: "aiIntent",
    ocrGeneralBasic: "ocrGeneralBasic",
    eventBatchApply: "eventBatchApply",
    userSettings: "userSettings",
    initCloudData: "initCloudData",
    reminderManager: "reminderManager",
  },
};
