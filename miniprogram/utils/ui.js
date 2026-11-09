/* 韭研 · 小程序交互 helper（utils/ui.js）
 * 页面统一用这里处理 toast / 确认框 / 跳转，避免每个页面重复写 wx API。
 */
'use strict';

function hasWx() {
  return typeof wx !== 'undefined' && !!wx;
}

function trimMsg(msg) {
  var text = String(msg || '操作失败');
  return text.length > 18 ? text.slice(0, 18) + '…' : text;
}

/** 轻提示 */
function toast(title, duration) {
  if (!hasWx() || typeof wx.showToast !== 'function') return;
  wx.showToast({ title: trimMsg(title), icon: 'none', duration: duration || 2000 });
}

/** 错误提示：接受 Error / 字符串 */
function toastErr(err) {
  var msg = '';
  if (err && err.message) msg = err.message;
  else if (err && err.errMsg) msg = err.errMsg;
  else if (typeof err === 'string') msg = err;
  toast(msg || '操作失败');
}

/** 确认框 -> Promise<boolean> */
function confirm(title, content) {
  return new Promise(function (resolve) {
    if (!hasWx() || typeof wx.showModal !== 'function') {
      resolve(false);
      return;
    }
    wx.showModal({
      title: title || '提示',
      content: content || '',
      confirmColor: '#ff5b3a',
      success: function (res) { resolve(!!(res && res.confirm)); },
      fail: function () { resolve(false); }
    });
  });
}

/** 普通页面跳转 */
function go(url) {
  if (!hasWx() || !url) return;
  wx.navigateTo({
    url: url,
    fail: function () { toast('页面打开失败'); }
  });
}

/** tabBar 页面跳转 */
function goTab(url) {
  if (!hasWx() || !url) return;
  wx.switchTab({
    url: url,
    fail: function () { toast('页面切换失败'); }
  });
}

function navigationTitle(title) {
  if (!hasWx() || !title || typeof wx.setNavigationBarTitle !== 'function') return;
  wx.setNavigationBarTitle({ title: title });
}

module.exports = {
  toast: toast,
  toastErr: toastErr,
  confirm: confirm,
  go: go,
  goTab: goTab,
  navigationTitle: navigationTitle
};
