# 重要日微信小程序

猫咪风格的重要日/记事微信小程序，当前版本已接入云开发架构。

## 下载后运行

1. 使用微信开发者工具导入仓库根目录，并在 `project.config.json` 中填写自己的小程序 AppID。
2. 开通微信云开发，在 `miniprogram/config/env.js` 中填写云环境 ID 和订阅消息模板 ID。
3. 按“需要配置”章节创建数据库集合，并上传部署 `cloudfunctions` 下的云函数，选择“云端安装依赖”。
4. 在云函数环境变量中填写阿里云百炼、DeepSeek 和腾讯云 OCR 密钥。
5. 在小程序后台配置 socket 合法域名 `wss://dashscope.aliyuncs.com`，重新编译后即可运行。

仓库包含运行时背景、事件卡片素材以及 `img_new` 中的原始背景资源；永久 API Key 不保存在前端或 Git 仓库中。

## 当前能力

- 事件数据以微信云数据库为正式数据源，本地 storage 只做缓存兜底。
- 手动添加/编辑事件，支持日期、时间、分类、背景、置顶、微信提醒。
- 首页窄版倒数卡片，点击编辑，左滑删除。
- 长按语音实时识别：云函数生成阿里云百炼短期凭证，前端直连 DashScope WebSocket，使用 `paraformer-realtime-v2` 边录边识别。
- AI 识别开关：开启后语音文本交给 DeepSeek，返回新增、修改、删除、置顶、设置提醒等结构化操作列表，确认后批量执行。
- 文字导入和单张图片 OCR 导入只支持新增事项；真机大图会临时上传供 OCR 读取，识别后立即删除，不持久保存、不入库。
- 背景支持预设模板和用户自定义图片；自定义背景图片会上传云存储。

## 需要配置

1. 微信云开发
   - 在微信开发者工具里开通云开发。
   - 创建集合：`events`、`categories`、`settings`、`customBackgrounds`、`aiLogs`、`reminderJobs`。
   - 将云环境 ID 填到 `miniprogram/config/env.js` 的 `cloudEnvId`，也可以留空使用当前云环境。
   - 上传并部署 `cloudfunctions` 下的云函数。
   - `getDashScopeToken` 使用默认 3 秒超时即可；网络异常会在 2.2 秒内返回可重试错误。

2. 合法域名
   - socket 合法域名：`wss://dashscope.aliyuncs.com`
   - DeepSeek 和腾讯 OCR 都由云函数访问，不需要配到小程序前端 request 域名。

3. 云函数环境变量
   - 阿里云实时语音：`DASHSCOPE_API_KEY`；可选 `DASHSCOPE_WORKSPACE_ID`、`DASHSCOPE_TOKEN_TTL_SECONDS`
   - DeepSeek：`DEEPSEEK_API_KEY`，可选 `DEEPSEEK_MODEL=deepseek-v4-flash`
   - 腾讯云 OCR：`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`，可选 `TENCENT_REGION=ap-guangzhou`
   - 微信提醒模板 ID 只在 `miniprogram/config/env.js` 的 `reminderTemplateId` 中配置，云函数从事件提醒计划读取，不再硬编码。
   - 提醒模板字段必须为：`thing2` 提醒内容、`date4` 日程时间、`number42` 剩余天数、`time25` 时间。

4. 小程序前端配置
   - `miniprogram/config/env.js`
   - `reminderTemplateId` 填微信订阅消息模板 ID。
   - `defaultAiEnabled` 可控制首次进入时 AI 识别默认开关。

## 注意

- 前端不保存 DeepSeek、腾讯云、阿里云百炼永久密钥；语音识别只接收云函数签发的短期凭证。
- OCR 图片只在单次识别期间临时上传云存储，云函数读取后立即删除，不保存在数据库。
- 微信提醒使用订阅消息，不是系统闹钟；用户需要授权后才能发送。`sendReminders` 每分钟检查一次已到时间且尚未发送的提醒任务。
- `aiLogs` 仅用于排查 AI 解析质量和调用情况；日志保留 30 天，单用户最多 100 条，全局最多 5000 条，由 `cleanupData` 每日自动清理。
- 自动提醒保存时预先计算：距离事件至少 3 天生成三天前和一天前两条提醒；至少 1 天但不足 3 天只生成一天前提醒；不足 1 天不自动提醒。
- 用户手动提醒优先级最高；手动开启后会清空自动提醒计划，只保留用户设置的提醒。
