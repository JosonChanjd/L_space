/* 工具箱首页：分类分组 + 本地搜索过滤（不联网） */
var toolsConfig = require('../../config/tools.js');

Page({
  data: {
    groups: [],
    keyword: '',
    total: 0,
    filteredCount: 0,
    configReady: true
  },

  onLoad: function () {
    var total = (toolsConfig.TOOLS || []).length;
    this.setData({ total: total, configReady: total > 0 });
    this.buildGroups('');
  },

  buildGroups: function (keyword) {
    var kw = String(keyword || '').trim().toLowerCase();
    var groups = [];
    var count = 0;
    (toolsConfig.CATEGORIES || []).forEach(function (cat) {
      var list = (toolsConfig.TOOLS || []).filter(function (t) {
        if (!t || t.category !== cat.key) return false;
        if (!kw) return true;
        var text = String(t.key || '') + ' ' + String(t.title || '') + ' ' + String(t.desc || '');
        return text.toLowerCase().indexOf(kw) >= 0;
      });
      if (!list.length) return;
      count += list.length;
      groups.push({
        key: cat.key,
        title: cat.title,
        icon: cat.icon,
        desc: cat.desc || '',
        items: list.map(function (t) {
          return { key: t.key, title: t.title, icon: t.icon, desc: t.desc || '' };
        })
      });
    });
    this.setData({ groups: groups, filteredCount: count });
  },

  onSearchInput: function (e) {
    var value = e.detail.value;
    this.setData({ keyword: value });
    this.buildGroups(value);
  },

  onClearSearch: function () {
    this.setData({ keyword: '' });
    this.buildGroups('');
  },

  onTapTool: function (e) {
    var key = e.currentTarget.dataset.key;
    if (!key) return;
    try {
      wx.navigateTo({ url: '/pages/tool/tool?key=' + encodeURIComponent(key) });
    } catch (err) {
      try {
        if (wx && typeof wx.showToast === 'function') wx.showToast({ title: '打开失败', icon: 'none' });
      } catch (e2) { /* 忽略 */ }
    }
  }
});
