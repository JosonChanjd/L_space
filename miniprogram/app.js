/* 韭研 · 投研工作台 —— 微信小程序入口（miniprogram/app.js）
 * 生产：使用云开发云函数 `api` 代理请求 Render 后端（https://jiuyan-workbench.onrender.com）
 * 调试：未开通云开发 / 云函数不可用时，utils/api.js 自动回退到 globalData.apiBase 直连。
 */
var registerApp = (typeof App === 'function') ? App : function () {};

registerApp({
  globalData: {
    version: '1.6',
    useCloud: true,
    apiBase: 'http://localhost:8080',
    envId: '',
    webUrl: 'https://jiuyan-workbench.onrender.com'
  },

  onLaunch: function () {
    var g = this.globalData;
    if (typeof wx === 'undefined' || !wx) {
      g.useCloud = false;
      return;
    }
    if (wx.cloud) {
      try {
        wx.cloud.init({
          env: g.envId || undefined,
          traceUser: true
        });
      } catch (e) {
        g.useCloud = false;
        if (wx.showToast) {
          wx.showToast({ title: '云开发初始化失败，已切换直连调试', icon: 'none' });
        }
      }
    } else {
      g.useCloud = false;
    }
  }
});
