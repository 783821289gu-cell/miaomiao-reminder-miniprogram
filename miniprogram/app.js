App({
  onLaunch() {
    const env = require("./config/env");
    if (wx.cloud) {
      wx.cloud.init({
        env: env.cloudEnvId || undefined,
        traceUser: true,
      });
    }
    this.globalData = {
      appName: "重要日",
    };
  },
});
