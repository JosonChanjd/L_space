'use strict';

/**
 * 极简 HTTPS/HTTP 文本抓取工具（零依赖）。
 * - 支持 GBK 解码（腾讯行情返回 GBK 编码）
 * - 支持超时 + 指数退避重试
 */

const http = require('http');
const https = require('https');

const config = require('./config');

const DEFAULT_HEADERS = {
  'User-Agent': config.USER_AGENT,
  Accept: '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Referer: 'https://gu.qq.com/',
  Connection: 'close',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 单次请求，返回解码后的字符串（默认 GBK）。
 * @param {string} url
 * @param {{ timeout?: number, headers?: object, encoding?: string }} options
 * @returns {Promise<string>}
 */
function requestOnce(url, options = {}) {
  const timeout = Number.isFinite(options.timeout) ? options.timeout : config.HTTP_TIMEOUT;
  const encoding = options.encoding || 'gbk';
  const headers = { ...DEFAULT_HEADERS, ...(options.headers || {}) };

  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(new Error('非法 URL：' + url));
      return;
    }

    const isHttps = target.protocol === 'https:';
    const mod = isHttps ? https : http;

    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const req = mod.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: target.pathname + target.search,
        method: 'GET',
        headers,
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', (err) => finish(reject, err));
        res.on('end', () => {
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            finish(reject, new Error('HTTP ' + status));
            return;
          }
          const buf = Buffer.concat(chunks);
          let text;
          try {
            text = encoding && encoding !== 'utf8' ? new TextDecoder(encoding).decode(buf) : buf.toString('utf8');
          } catch (err) {
            // 极端环境下 TextDecoder 不支持 gbk 时兜底，避免整条链路挂掉
            text = buf.toString('utf8');
          }
          finish(resolve, text);
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('请求超时（' + timeout + 'ms）'));
    });
    req.on('error', (err) => finish(reject, err));
    req.end();
  });
}

/**
 * 带重试的 GET 文本抓取。
 * @param {string} url
 * @param {{ timeout?: number, retries?: number, retryDelay?: number, headers?: object, encoding?: string }} options
 * @returns {Promise<string>}
 */
async function getText(url, options = {}) {
  const retries = Number.isFinite(options.retries) ? Math.max(1, options.retries) : config.HTTP_RETRIES;
  const retryDelay = Number.isFinite(options.retryDelay) ? options.retryDelay : 300;

  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await requestOnce(url, options);
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        await sleep(retryDelay * (attempt + 1));
      }
    }
  }
  throw lastError || new Error('请求失败：' + url);
}

module.exports = { getText, requestOnce, sleep };
