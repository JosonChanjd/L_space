/* 韭研 · 小程序本地存储（utils/storage.js）
 * 所有 key 统一 jy_mp_ 前缀，避免与网页版 localStorage 语义混淆。
 */
'use strict';

var WATCH_KEY = 'jy_mp_watch_v1';          // 自选：[{code,name,type:'stock'|'fund'}]
var STRATEGIES_KEY = 'jy_mp_strategies_v1'; // 策略：[{id,type,...}]
var THEME_KEY = 'jy_mp_theme_v1';          // 主题：'light' | 'dark'
var PORTFOLIOS_KEY = 'jy_mp_portfolios_v1';
var TOOL_FAV_KEY = 'jy_mp_tool_fav_v1';

function hasWx() {
  return typeof wx !== 'undefined' && !!wx;
}

function read(key, fallback) {
  if (!hasWx() || !key) return fallback;
  try {
    var value = wx.getStorageSync(key);
    if (value === '' || value === undefined || value === null) return fallback;
    return value;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  if (!hasWx() || !key) return false;
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

/** 读-改-写：update(key, function(cur){ return next; }) */
function update(key, fn) {
  var current = read(key, null);
  var next = fn ? fn(current) : current;
  write(key, next);
  return next;
}

function remove(key) {
  if (!hasWx() || !key) return false;
  try {
    wx.removeStorageSync(key);
    return true;
  } catch (e) {
    return false;
  }
}

function uid() {
  return 'mp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = {
  WATCH_KEY: WATCH_KEY,
  STRATEGIES_KEY: STRATEGIES_KEY,
  THEME_KEY: THEME_KEY,
  PORTFOLIOS_KEY: PORTFOLIOS_KEY,
  TOOL_FAV_KEY: TOOL_FAV_KEY,
  read: read,
  write: write,
  update: update,
  remove: remove,
  uid: uid
};
