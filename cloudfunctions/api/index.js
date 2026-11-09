/* 韭研 · 云函数 api：HTTPS 代理到 Render 后端
 *
 * 入参 event：
 *   { path: '/api/xxx', query: { k: v }, method: 'GET'|'POST', body: { ... } }
 * 出参：
 *   { ok: true, data: <后端 JSON> }  或  { ok: false, error: '...' }
 *
 * 说明：
 * - 只允许代理 /api/ 开头的路径，避免被当作任意 URL 转发。
 * - Render 免费实例会休眠，冷启动可能 30-60s；云函数超时需在控制台调成 60s。
 * - 无第三方依赖，只用 Node 内置 https / url 模块。
 */
'use strict';

const https = require('https');

const TARGET_HOST = 'jiuyan-workbench.onrender.com';
const TARGET_PORT = 443;
const TIMEOUT_MS = 55000;

function buildPath(path, query) {
  let target = String(path || '');
  if (target.charAt(0) !== '/') target = '/' + target;
  const parts = [];
  if (query && typeof query === 'object' && !Array.isArray(query)) {
    Object.keys(query).forEach((key) => {
      const value = query[key];
      if (value === undefined || value === null || value === '') return;
      const text = Array.isArray(value) ? value.join(',') : String(value);
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(text));
    });
  }
  if (!parts.length) return target;
  return target + (target.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');
}

function requestProxy(event) {
  return new Promise((resolve) => {
    const method = String(event.method || 'GET').toUpperCase();
    const bodyText =
      method === 'POST' && event.body && typeof event.body === 'object'
        ? JSON.stringify(event.body)
        : null;

    const headers = {
      Accept: 'application/json',
      'User-Agent': 'jiuyan-mp-cloudfn/1.6',
    };
    if (bodyText !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyText);
    }

    const options = {
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: buildPath(event.path, event.query),
      method,
      headers,
    };

    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode || 0;
        if (status >= 400) {
          finish({ ok: false, error: 'HTTP ' + status });
          return;
        }
        try {
          finish({ ok: true, data: JSON.parse(text) });
        } catch (err) {
          finish({ ok: false, error: '上游返回非 JSON' });
        }
      });
      res.on('error', (err) => {
        finish({ ok: false, error: (err && err.message) || '读取上游响应失败' });
      });
    });

    req.setTimeout(TIMEOUT_MS, () => {
      finish({ ok: false, error: '请求超时（Render 可能休眠冷启动中，请稍后重试）' });
      req.destroy();
    });
    req.on('error', (err) => {
      finish({ ok: false, error: (err && err.message) || '网络请求失败' });
    });

    if (bodyText !== null) req.write(bodyText);
    req.end();
  });
}

exports.main = async function (event) {
  const input = event && typeof event === 'object' ? event : {};
  const method = String(input.method || 'GET').toUpperCase();
  const path = String(input.path || '');

  if (!/^\/api\//.test(path)) {
    return { ok: false, error: '只允许代理 /api/ 接口' };
  }
  if (method !== 'GET' && method !== 'POST') {
    return { ok: false, error: '仅支持 GET / POST' };
  }

  try {
    return await requestProxy(Object.assign({}, input, { method, path }));
  } catch (err) {
    return { ok: false, error: (err && err.message) || '代理请求异常' };
  }
};
