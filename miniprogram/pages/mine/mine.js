/* 韭研 · 小程序「我的」页（pages/mine/mine）
 * 版本 / 数据源说明 / 主题切换（jy_mp_theme_v1，页面 .is-dark 类）/ 清空本地数据 / 关于 / 复制网页版地址
 */
var storage = require('../../utils/storage.js');
var ui = require('../../utils/ui.js');

var WEB_URL = 'https://jiuyan-workbench.onrender.com';

var registerPage = (typeof Page === 'function') ? Page : function () {};

registerPage({
  data: {
    version: '1.6',
    webUrl: WEB_URL,
    isDark: false,
    watchCount: 0,
    strategyCount: 0,
    apiMode: '云函数代理（生产）'
  },

  onShow: function () {
    this.refresh();
  },

  refresh: function () {
    var theme = storage.read(storage.THEME_KEY, 'light');
    var watch = storage.read(storage.WATCH_KEY, []);
    var strategies = storage.read(storage.STRATEGIES_KEY, []);
    var g = {};
    try {
      if (typeof getApp === 'function') {
        var app = getApp();
        if (app && app.globalData) g = app.globalData;
      }
    } catch (e) { g = {}; }

    var useCloud = g.useCloud !== false;
    var isDark = theme === 'dark';

    this.setData({
      version: g.version || '1.6',
      webUrl: g.webUrl || WEB_URL,
      isDark: isDark,
      watchCount: Array.isArray(watch) ? watch.length : 0,
      strategyCount: Array.isArray(strategies) ? strategies.length : 0,
      apiMode: useCloud ? '云函数代理（生产）' : '直连 ' + (g.apiBase || 'http://localhost:8080')
    });
    this.applyNavColor(isDark);
  },

  applyNavColor: function (dark) {
    if (typeof wx === 'undefined' || !wx.setNavigationBarColor) return;
    wx.setNavigationBarColor({
      frontColor: dark ? '#ffffff' : '#000000',
      backgroundColor: dark ? '#12151c' : '#f6f7fb'
    });
  },

  onThemeChange: function (e) {
    var dark = !!(e && e.detail && e.detail.value);
    storage.write(storage.THEME_KEY, dark ? 'dark' : 'light');
    this.setData({ isDark: dark });
    this.applyNavColor(dark);
    ui.toast(dark ? '已切换深色模式' : '已切换浅色模式');
  },

  onClearAll: function () {
    var that = this;
    ui.confirm('清空本地数据', '将删除自选、策略、主题等本机缓存，且无法恢复。').then(function (ok) {
      if (!ok) return;
      try {
        if (typeof wx !== 'undefined' && wx.clearStorageSync) {
          wx.clearStorageSync();
        }
      } catch (e) { /* ignore */ }
      ui.toast('本地数据已清空');
      that.refresh();
    });
  },

  onCopyUrl: function () {
    var url = this.data.webUrl || WEB_URL;
    if (typeof wx === 'undefined' || !wx.setClipboardData) return;
    wx.setClipboardData({
      data: url,
      success: function () { ui.toast('网页版地址已复制'); },
      fail: function () { ui.toast('复制失败，地址：' + url); }
    });
  },

  onAbout: function () {
    if (typeof wx === 'undefined' || !wx.showModal) return;
    wx.showModal({
      title: '关于',
      content: '韭研 · 投研工作台 v' + this.data.version + '\n面向个人投资者的投研工具，数据来自公开行情接口，仅供学习研究，不构成投资建议。',
      showCancel: false,
      confirmColor: '#ff5b3a'
    });
  }
});
