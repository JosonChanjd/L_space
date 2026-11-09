/* 韭研 · 小程序统一请求层（utils/api.js）
 * 默认走云开发云函数 `api` 代理（https://jiuyan-workbench.onrender.com）；
 * 云函数不可用时自动回退到 wx.request 直连 getApp().globalData.apiBase（本地调试用）。
 *
 * 对外接口（其它页面/队友依赖，勿改签名）：
 *   api.request(path, query)  -> Promise<data>    GET
 *   api.post(path, body)      -> Promise<data>    POST
 *   api.apiBase               -> 默认直连地址
 *   api.getApiBase()          -> 当前生效直连地址
 */
'use strict';

var DEFAULT_BASE = 'http://localhost:8080';
var DIRECT_TIMEOUT = 10000;   // 直连（本地调试）超时 10s
var CLOUD_TIMEOUT = 60000;    // 云函数超时保护 60s（Render 免费实例冷启动 30-60s）

var apiBase = DEFAULT_BASE;

function appGlobalData() {
  try {
    if (typeof getApp === 'function') {
      var app = getApp();
      if (app && app.globalData) return app.globalData;
    }
  } catch (e) { /* ignore */ }
  return null;
}

function hasWx() {
  return typeof wx !== 'undefined' && !!wx;
}

function currentBase() {
  var g = appGlobalData();
  if (g && g.apiBase) {
    apiBase = g.apiBase;
    return g.apiBase;
  }
  return DEFAULT_BASE;
}

function cloudReady() {
  var g = appGlobalData();
  if (g && g.useCloud === false) return false;
  return hasWx() && wx.cloud && typeof wx.cloud.callFunction === 'function';
}

/** 对象 query -> ?a=1&b=2（数组按逗号连接，空值跳过） */
function serializeQuery(query) {
  if (!query || typeof query !== 'object') return '';
  var keys = Object.keys(query);
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var val = query[key];
    if (val === undefined || val === null || val === '') continue;
    if (Array.isArray(val)) val = val.join(',');
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(val)));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/** 统一解包：ok===false 抛错，返回后端 data */
function unwrap(data) {
  if (!data || typeof data !== 'object') throw new Error('接口返回格式异常');
  if (data.ok === false) throw new Error(data.error || '请求失败');
  return data;
}

function withTimeout(promise, ms, message) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      reject(new Error(message || '请求超时'));
    }, ms);
    promise.then(function (value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    }, function (err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** 云函数调用（成功返回结果对象；失败标记 _cloudFail 供上层回退） */
function callCloud(path, query, method, body) {
  return new Promise(function (resolve, reject) {
    if (!cloudReady()) {
      var skipErr = new Error('云开发不可用');
      skipErr._cloudFail = true;
      reject(skipErr);
      return;
    }
    var payload = { path: path, query: query || {}, method: method };
    if (method !== 'GET') payload.body = body || {};
    wx.cloud.callFunction({
      name: 'api',
      data: payload,
      success: function (res) {
        var result = res && res.result;
        if (result && result.ok) {
          resolve(result.data);
          return;
        }
        reject(new Error((result && result.error) || '云函数代理请求失败'));
      },
      fail: function (err) {
        var e = new Error((err && err.errMsg) || '云函数调用失败');
        e._cloudFail = true;
        reject(e);
      }
    });
  });
}

/** wx.request 直连（开发环境 / 云函数回退） */
function callDirect(path, query, method, body) {
  return new Promise(function (resolve, reject) {
    if (!hasWx() || typeof wx.request !== 'function') {
      reject(new Error('当前环境不支持 wx.request，无法请求接口'));
      return;
    }
    var base = currentBase();
    var url = String(base).replace(/\/+$/, '') + path + serializeQuery(query);
    var options = {
      url: url,
      method: method,
      timeout: DIRECT_TIMEOUT,
      header: { 'content-type': 'application/json' },
      success: function (res) {
        var status = res && res.statusCode;
        if (typeof status === 'number' && (status < 200 || status >= 300)) {
          reject(new Error('HTTP ' + status));
          return;
        }
        try {
          resolve(unwrap(res && res.data));
        } catch (e) {
          reject(e);
        }
      },
      fail: function (err) {
        reject(new Error((err && err.errMsg) || '网络请求失败'));
      }
    };
    if (method !== 'GET') options.data = body || {};
    try {
      wx.request(options);
    } catch (e) {
      reject(e);
    }
  });
}

function doRequest(path, query, method, body) {
  if (!path || typeof path !== 'string') return Promise.reject(new Error('接口路径无效'));
  if (!cloudReady()) return callDirect(path, query, method, body);
  return callCloud(path, query, method, body).catch(function (err) {
    // 仅“云函数调用异常”才回退直连；后端业务错误直接抛给页面
    if (!err || !err._cloudFail) throw err;
    return callDirect(path, query, method, body).catch(function () { throw err; });
  });
}

/** GET：request('/api/snapshot') / request('/api/quote', {codes:'sh000001'}) */
function request(path, query) {
  return withTimeout(doRequest(path, query || {}, 'GET', null), CLOUD_TIMEOUT + 5000, '请求超时，请稍后重试');
}

/** POST：post('/api/strategy/validate', {buy, sell}) */
function post(path, body) {
  return withTimeout(doRequest(path, {}, 'POST', body || {}), CLOUD_TIMEOUT + 5000, '请求超时，请稍后重试');
}

module.exports = {
  apiBase: DEFAULT_BASE,
  getApiBase: currentBase,
  request: request,
  post: post
};
