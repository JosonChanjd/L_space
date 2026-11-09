'use strict';

/**
 * 韭研 · 投研工作台 —— 零依赖 Node 后端
 *
 * 功能：
 *   - 托管前端：/ → index.html，/app.css → public/app.css，/app.js → public/app.js，
 *     /page/** → public/page/**，其余路径回退 public/ 与根目录静态文件
 *   - API：
 *       GET  /api/snapshot          最新快照（永远 200）
 *       POST /api/refresh           立即抓取并返回 { ok, snapshot }
 *       GET  /api/quote?codes=...   任意代码实时行情（智能归一化）
 *       GET  /api/health            健康检查
 *   - 启动时异步抓取一次；每日 19:00 自动抓取；快照落盘 data/snapshot.json
 *
 * 仅使用 Node 内置模块，无需 npm install。
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./src/config');
const collect = require('./src/collect');
const scheduler = require('./src/scheduler');
const fund = require('./src/fund');
const indexValuation = require('./src/indexValuation');
const fearHistory = require('./src/fearHistory');
const sectors = require('./src/sectors');
const market = require('./src/market');
const analytics = require('./src/analytics');
const portfolio = require('./src/portfolio');
const stocks = require('./src/stocks');
const strategies = require('./src/strategies');
const portfolioTemplates = require('./src/portfolioTemplates');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// ---------------- 基础响应工具 ----------------

function setCommonHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendJson(res, status, payload) {
  let body;
  let code = status;
  try {
    body = JSON.stringify(payload);
  } catch (err) {
    body = JSON.stringify({ ok: false, error: 'JSON 序列化失败' });
    code = 200;
  }
  const buffer = Buffer.from(body, 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

function sendText(res, status, text) {
  const buffer = Buffer.from(String(text), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-cache',
  });
  res.end(buffer);
}

// ---------------- 静态文件 ----------------

/** 防目录穿越：把 URL 路径安全地拼到 baseDir 下 */
function safeJoin(baseDir, urlPath) {
  if (!urlPath || urlPath[0] !== '/') return null;
  let resolved;
  try {
    resolved = path.resolve(baseDir, '.' + urlPath);
  } catch (err) {
    return null;
  }
  const relative = path.relative(baseDir, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return relative === '' ? resolved : null;
  }
  return resolved;
}

async function serveFile(req, res, filePath) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch (err) {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || 'application/octet-stream';
  const isHtml = ext === '.html' || ext === '.htm';

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': isHtml ? 'no-cache' : 'no-cache',
    'Last-Modified': stat.mtime.toUTCString(),
  });

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  await new Promise((resolve) => {
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      try {
        res.destroy();
      } catch (err) {
        /* noop */
      }
      resolve();
    });
    res.on('finish', resolve);
    res.on('close', resolve);
    stream.pipe(res);
  });
  return true;
}

async function serveStatic(req, res, pathname) {
  const candidates = [];

  if (pathname === '/' || pathname === '/index.html') {
    candidates.push(config.INDEX_FILE);
    candidates.push(path.join(config.PUBLIC_DIR, 'index.html'));
  } else if (pathname === '/app.css') {
    candidates.push(path.join(config.PUBLIC_DIR, 'app.css'));
  } else if (pathname === '/app.js') {
    candidates.push(path.join(config.PUBLIC_DIR, 'app.js'));
  } else if (pathname.startsWith('/page/')) {
    const target = safeJoin(config.PUBLIC_DIR, pathname);
    if (target) candidates.push(target);
  } else {
    const publicTarget = safeJoin(config.PUBLIC_DIR, pathname);
    if (publicTarget) candidates.push(publicTarget);
    // 根目录只回退「顶层静态文件」（如 favicon.ico），不暴露 src/ 等服务端源码
    const rootRelative = pathname.slice(1);
    const isTopLevelFile =
      Boolean(rootRelative) && !rootRelative.includes('/') && !rootRelative.includes('\\') && !rootRelative.startsWith('.');
    if (isTopLevelFile) {
      const rootTarget = safeJoin(config.ROOT_DIR, pathname);
      if (rootTarget) candidates.push(rootTarget);
    }
  }

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await serveFile(req, res, candidate)) return;
  }

  sendText(res, 404, '404 Not Found: ' + pathname);
}

// ---------------- 路由 ----------------

/** 读取查询参数中的数字，非法或缺失时回退 */
function queryNum(url, name, fallback) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  const num = Number.parseFloat(raw);
  return Number.isFinite(num) ? num : fallback;
}

/** 校验 6 位基金代码 */
function fundCode(url) {
  const raw = String(url.searchParams.get('code') || '').trim();
  return /^\d{6}$/.test(raw) ? raw : null;
}

/** 读取逗号分隔列表参数（支持重复参数与中英文分隔符） */
function listParam(url, name) {
  return url.searchParams
    .getAll(name)
    .join(',')
    .split(/[,，;；\s]+/)
    .filter(Boolean);
}

/** 统一的基金类接口包装：任何异常都以 HTTP 200 + {ok:false} 返回 */
async function sendApi(res, handler) {
  try {
    const payload = await handler();
    sendJson(res, 200, payload);
  } catch (err) {
    console.error('[server] 接口异常：', err && err.stack ? err.stack : err);
    sendJson(res, 200, { ok: false, error: err && err.message ? err.message : '服务内部错误' });
  }
}

/** 读取请求体（带大小上限，供 POST /api/strategy/validate 使用） */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('请求体过大（上限 ' + Math.round(limit / 1024) + 'KB）'));
        try {
          req.destroy();
        } catch (err) {
          /* noop */
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}

async function handleRequest(req, res) {
  setCommonHeaders(res);

  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  } catch (err) {
    sendText(res, 400, '400 Bad Request');
    return;
  }

  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch (err) {
    /* 保留原始路径 */
  }

  // 非 GET 请求默认排空 body，避免 keep-alive 连接被重置；
  // /api/strategy/validate 需要读取 JSON body，交给对应路由处理
  if (method !== 'GET' && method !== 'HEAD' && pathname !== '/api/strategy/validate') {
    req.resume();
  }

  // ---- GET /api/snapshot：必须永远 200 ----
  if (pathname === '/api/snapshot') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    try {
      const snapshot = await collect.getSnapshot();
      sendJson(res, 200, snapshot || collect.fallbackSnapshot());
    } catch (err) {
      console.error('[server] /api/snapshot 异常，返回兜底演示数据：', err && err.message);
      sendJson(res, 200, collect.fallbackSnapshot());
    }
    return;
  }

  // ---- POST /api/refresh ----
  if (pathname === '/api/refresh') {
    if (method !== 'POST') {
      sendJson(res, 405, { ok: false, error: '请使用 POST' });
      return;
    }
    try {
      const snapshot = await collect.refresh();
      sendJson(res, 200, { ok: true, snapshot: snapshot || collect.fallbackSnapshot() });
    } catch (err) {
      console.error('[server] /api/refresh 异常：', err && err.message);
      let snapshot = null;
      try {
        snapshot = await collect.getSnapshot();
      } catch (innerErr) {
        snapshot = null;
      }
      sendJson(res, 200, {
        ok: false,
        snapshot: snapshot || collect.fallbackSnapshot(),
        error: err && err.message ? err.message : '刷新失败',
      });
    }
    return;
  }

  // ---- GET /api/quote?codes=600519,AAPL,700 ----
  if (pathname === '/api/quote') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    const raw = url.searchParams.getAll('codes').join(',');
    const parts = raw.split(/[,，;；\s]+/).filter(Boolean);
    try {
      const result = await collect.getQuotes(parts);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 200, {
        ok: false,
        quotes: [],
        failed: parts,
        error: err && err.message ? err.message : '行情查询失败',
      });
    }
    return;
  }

  // ======== 基金数据层（新增能力，不影响上方原有行情接口） ========

  // ---- GET /api/fund/search?key=xxx&limit=10 ----
  if (pathname === '/api/fund/search') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    const key = url.searchParams.get('key') || '';
    await sendApi(res, () => fund.searchFunds(key, queryNum(url, 'limit', 10)));
    return;
  }

  // ---- GET /api/fund/rank?type=&sort=&page=&size= ----
  if (pathname === '/api/fund/rank') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () =>
      fund.getRank({
        type: url.searchParams.get('type') || 'all',
        sort: url.searchParams.get('sort') || '1nzf',
        page: queryNum(url, 'page', 1),
        size: queryNum(url, 'size', 20),
      })
    );
    return;
  }

  // ---- GET /api/fund/detail?code=110022 ----
  if (pathname === '/api/fund/detail') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    const code = fundCode(url);
    if (!code) {
      sendJson(res, 200, { ok: false, source: null, fund: null, error: 'code 参数需为 6 位基金代码' });
      return;
    }
    await sendApi(res, () => fund.getDetail(code));
    return;
  }

  // ---- GET /api/fund/nav?code=&range=1y|3y|5y|all ----
  if (pathname === '/api/fund/nav') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    const code = fundCode(url);
    if (!code) {
      sendJson(res, 200, { ok: false, code: null, items: [], error: 'code 参数需为 6 位基金代码' });
      return;
    }
    await sendApi(res, () => fund.getNav(code, url.searchParams.get('range') || '1y'));
    return;
  }

  // ---- GET /api/fund/quotes?codes=110022,000001 ----
  if (pathname === '/api/fund/quotes') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    const parts = url.searchParams.getAll('codes').join(',').split(/[,，;；\s]+/).filter(Boolean);
    await sendApi(res, () => fund.getFundQuotes(parts));
    return;
  }

  // ---- GET /api/fund/backtest?code=&amount=&freq=&years=&targetProfit=&stopLoss= ----
  if (pathname === '/api/fund/backtest') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    const code = fundCode(url);
    if (!code) {
      sendJson(res, 200, { ok: false, result: null, error: 'code 参数需为 6 位基金代码' });
      return;
    }
    await sendApi(res, () =>
      fund.backtest({
        code,
        amount: queryNum(url, 'amount', 1000),
        freq: url.searchParams.get('freq') || 'monthly',
        years: queryNum(url, 'years', 3),
        targetProfit: queryNum(url, 'targetProfit', null),
        stopLoss: queryNum(url, 'stopLoss', null),
      })
    );
    return;
  }

  // ---- GET /api/fund/compare?codes=a,b,c ----
  if (pathname === '/api/fund/compare') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    const parts = url.searchParams.getAll('codes').join(',').split(/[,，;；\s]+/).filter(Boolean);
    await sendApi(res, () => fund.compareFunds(parts));
    return;
  }

  // ---- GET /api/index-valuation ----
  if (pathname === '/api/index-valuation') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => indexValuation.getIndexValuation());
    return;
  }

  // ---- GET /api/fear-history?days=30 ----
  if (pathname === '/api/fear-history') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => ({ ok: true, items: fearHistory.getHistory(queryNum(url, 'days', 30)) }));
    return;
  }

  // ======== 工具箱数据层（新增，独立于原有行情/基金接口） ========

  // ---- [1] GET /api/fear/asset?key=jingong|quanshang|...|hangye ----
  if (pathname === '/api/fear/asset') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => sectors.getAssetFear(url.searchParams.get('key') || ''));
    return;
  }

  // ---- [2] GET /api/market/industries?limit=30 ----
  if (pathname === '/api/market/industries') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => market.getIndustries(queryNum(url, 'limit', 30)));
    return;
  }

  // ---- [3] GET /api/analytics/ah-premium ----
  if (pathname === '/api/analytics/ah-premium') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => market.getAhPremium());
    return;
  }

  // ---- [4] GET /api/analytics/fx-stock ----
  if (pathname === '/api/analytics/fx-stock') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => market.getFxStock());
    return;
  }

  // ---- [5] GET /api/analytics/copper-oil ----
  if (pathname === '/api/analytics/copper-oil') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => market.getCopperOil());
    return;
  }

  // ---- [6] GET /api/analytics/stock-bond?bondYield=2.0 ----
  if (pathname === '/api/analytics/stock-bond') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => market.getStockBond(queryNum(url, 'bondYield', null)));
    return;
  }

  // ---- [7] GET /api/fund/etf?sort=f3|f6|f8&page=&size=&kw= ----
  if (pathname === '/api/fund/etf') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () =>
      market.getEtfList({
        sort: url.searchParams.get('sort') || 'f3',
        page: queryNum(url, 'page', 1),
        size: queryNum(url, 'size', 20),
        kw: url.searchParams.get('kw') || '',
      })
    );
    return;
  }

  // ---- [8] GET /api/fund/similar?code=110022 ----
  if (pathname === '/api/fund/similar') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    const code = fundCode(url);
    if (!code) {
      sendJson(res, 200, { ok: false, base: null, items: [], error: 'code 参数需为 6 位基金代码' });
      return;
    }
    await sendApi(res, () => analytics.getSimilar(code));
    return;
  }

  // ---- [9] GET /api/fund/diagnose?code=110022 ----
  if (pathname === '/api/fund/diagnose') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    const code = fundCode(url);
    if (!code) {
      sendJson(res, 200, { ok: false, fund: null, error: 'code 参数需为 6 位基金代码' });
      return;
    }
    await sendApi(res, () => analytics.getDiagnose(code));
    return;
  }

  // ---- [10] GET /api/fund/manager-pick?limit=8 ----
  if (pathname === '/api/fund/manager-pick') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => analytics.getManagerPick(queryNum(url, 'limit', 8)));
    return;
  }

  // ---- [11] GET /api/manager/score?code= ----
  if (pathname === '/api/manager/score') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    const code = fundCode(url);
    if (!code) {
      sendJson(res, 200, { ok: false, manager: null, error: 'code 参数需为 6 位基金代码' });
      return;
    }
    await sendApi(res, () => analytics.getManagerScore(code));
    return;
  }

  // ---- [12] GET /api/manager/compare?codes=a,b ----
  if (pathname === '/api/manager/compare') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => analytics.getManagerCompare(listParam(url, 'codes')));
    return;
  }

  // ---- [13b] GET /api/portfolio/templates ----
  if (pathname === '/api/portfolio/templates') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => portfolioTemplates.getPortfolioTemplates());
    return;
  }

  // ---- [13] GET /api/portfolio/backtest?codes=&weights=&years=&rebalance= ----
  if (pathname === '/api/portfolio/backtest') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () =>
      portfolio.portfolioBacktest({
        codes: listParam(url, 'codes'),
        types: listParam(url, 'types'),
        weights: url.searchParams.get('weights') || '',
        years: queryNum(url, 'years', 3),
        start: url.searchParams.get('start') || '',
        capital: queryNum(url, 'capital', 100000),
        rebalance: url.searchParams.get('rebalance') || 'quarterly',
      })
    );
    return;
  }

  // ---- GET /api/stock/search?key=&limit= ----
  if (pathname === '/api/stock/search') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () =>
      stocks.searchStocks(url.searchParams.get('key') || '', queryNum(url, 'limit', 10))
    );
    return;
  }

  // ---- GET /api/stock/kline?code=600519&range=1y|3y|5y|all&days=250 ----
  if (pathname === '/api/stock/kline') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, async () => {
      const code = String(url.searchParams.get('code') || '').trim();
      if (!code) throw new Error('缺少 code 参数');
      const range = String(url.searchParams.get('range') || '1y');
      const daysParam = queryNum(url, 'days', null);
      const resolved = await stocks.resolveSecid(code);
      const secid = resolved && resolved.secid;
      if (!secid) throw new Error('未找到证券：' + code);
      const kline = await stocks.getKline(secid);
      const points = Array.isArray(kline.points) ? kline.points : [];
      if (!points.length) throw new Error('暂无 K 线数据：' + code);
      const defaultCount = range === '3y' ? 750 : range === '5y' ? 1250 : range === 'all' ? points.length : 250;
      const count = daysParam && daysParam > 0 ? daysParam : defaultCount;
      const sliced = points.slice(-Math.min(count, points.length));
      return {
        ok: true,
        code,
        name: kline.name || (resolved && resolved.name) || '',
        secid,
        source: kline.source || 'eastmoney',
        items: sliced.map((point) => ({
          t: point.t,
          date: point.date,
          open: point.open,
          high: point.high,
          low: point.low,
          close: point.close,
          volume: point.volume,
          amount: point.amount,
        })),
      };
    });
    return;
  }

  // ---- [14] GET /api/stock/pick?limit=10 ----
  if (pathname === '/api/stock/pick') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => market.getStockPick(queryNum(url, 'limit', 10)));
    return;
  }

  // ---- [15] GET /api/emotion/panel ----
  if (pathname === '/api/emotion/panel') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => market.getEmotionPanel());
    return;
  }

  // ---- [16] GET /api/fund/screen?type=&minY1=&minY3=&minYtd=&sort=&page=&size= ----
  if (pathname === '/api/fund/screen') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () =>
      analytics.getFundScreen({
        type: url.searchParams.get('type') || 'all',
        minY1: queryNum(url, 'minY1', null),
        minY3: queryNum(url, 'minY3', null),
        minYtd: queryNum(url, 'minYtd', null),
        sort: url.searchParams.get('sort') || '1nzf',
        page: queryNum(url, 'page', 1),
        size: queryNum(url, 'size', 20),
      })
    );
    return;
  }

  // ======== 技术指标策略引擎（公式 DSL / 指标 / 信号回测） ========

  // ---- GET /api/strategy/templates ----
  if (pathname === '/api/strategy/templates') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    await sendApi(res, () => strategies.getTemplates());
    return;
  }

  // ---- GET|POST /api/strategy/validate ----
  if (pathname === '/api/strategy/validate') {
    if (method === 'GET' || method === 'HEAD') {
      await sendApi(res, () =>
        strategies.validateFormulas({
          buy: url.searchParams.get('buy') || '',
          sell: url.searchParams.get('sell') || '',
          assetType: url.searchParams.get('assetType') || '',
        })
      );
      return;
    }
    if (method === 'POST') {
      let payload = {};
      try {
        const raw = await readBody(req, 256 * 1024);
        payload = raw.trim() ? JSON.parse(raw) : {};
      } catch (err) {
        sendJson(res, 200, {
          ok: false,
          variables: [],
          functions: [],
          usesVolume: false,
          error: '请求体解析失败：' + (err && err.message ? err.message : err),
        });
        return;
      }
      await sendApi(res, () => strategies.validateFormulas(payload));
      return;
    }
    sendJson(res, 405, { ok: false, error: '请使用 GET 或 POST' });
    return;
  }

  // ---- GET /api/strategy/backtest ----
  if (pathname === '/api/strategy/backtest') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    try {
      const result = await strategies.strategyBacktest({
        code: url.searchParams.get('code') || '',
        assetType: url.searchParams.get('assetType') || 'stock',
        buy: url.searchParams.get('buy') || '',
        sell: url.searchParams.get('sell') || '',
        years: queryNum(url, 'years', 3),
        start: url.searchParams.get('start') || '',
        end: url.searchParams.get('end') || '',
        capital: queryNum(url, 'capital', 100000),
        fee: queryNum(url, 'fee', 0.0005),
        stopLoss: queryNum(url, 'stopLoss', null),
        takeProfit: queryNum(url, 'takeProfit', null),
      });
      sendJson(res, 200, result);
    } catch (err) {
      console.error('[strategy/backtest]', err);
      const message = err && err.message ? String(err.message) : '服务内部错误';
      const payload = { ok: false, error: message };
      if (url.searchParams.get('debug') === '1') {
        payload.detail = err && err.stack ? err.stack : String(message);
      }
      sendJson(res, 200, payload);
    }
    return;
  }

  // ---- GET /api/health ----
  if (pathname === '/api/health') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: '请使用 GET' });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      uptime: Math.round(process.uptime()),
      port: config.PORT,
      state: collect.getState(),
      scheduler: scheduler.getStatus(),
    });
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { ok: false, error: '接口不存在：' + pathname });
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: '不支持的请求方法：' + method });
    return;
  }

  await serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[server] 请求处理异常：', err && err.stack ? err.stack : err);
    try {
      if (!res.headersSent) {
        sendJson(res, 200, { ok: false, error: '服务器内部错误' });
      } else {
        res.end();
      }
    } catch (innerErr) {
      /* noop */
    }
  });
});

// ---------------- 启动 ----------------

function bootstrap() {
  // 先加载缓存，保证首个请求立刻有内容可渲染
  try {
    collect.warmCache();
  } catch (err) {
    console.warn('[server] 加载快照缓存失败：', err && err.message);
  }

  server.on('error', (err) => {
    console.error('[server] 服务启动/运行错误：', err && err.message);
    if (err && err.code === 'EADDRINUSE') {
      console.error('[server] 端口 ' + config.PORT + ' 已被占用，可用 PORT=其他端口 启动');
      process.exitCode = 1;
    }
  });

  server.listen(config.PORT, config.HOST, () => {
    console.log('==============================================');
    console.log('  韭研 · 投研工作台（零依赖后端）');
    console.log('  本机访问：   http://localhost:' + config.PORT);
    if (config.HOST === '0.0.0.0') {
      console.log('  局域网访问： http://<本机IP>:' + config.PORT + '（小程序真机调试用）');
    }
    console.log('  数据缓存：   ' + config.SNAPSHOT_FILE);
    console.log('  自动抓取：   每日 ' + String(config.REFRESH_HOUR).padStart(2, '0') + ':' + String(config.REFRESH_MINUTE).padStart(2, '0'));
    console.log('==============================================');

    scheduler.start();

    // 启动时异步抓取一次（不阻塞 HTTP 服务）
    setImmediate(() => {
      console.log('[server] 启动后台抓取（异步，不阻塞请求）…');
      collect
        .refresh()
        .then((snapshot) => {
          if (!snapshot) return;
          console.log(
            '[server] 首次抓取完成：source=' +
              snapshot.source +
              '，updatedAt=' +
              new Date(snapshot.updatedAt).toLocaleString('zh-CN', { hour12: false }) +
              '，恐贪指数 ' +
              snapshot.fearGreed.value +
              '（' +
              snapshot.fearGreed.level +
              '）'
          );
        })
        .catch((err) => {
          console.error('[server] 首次抓取失败：', err && err.message ? err.message : err);
        });
    });
  });

  const shutdown = (signal) => {
    console.log('[server] 收到 ' + signal + '，正在关闭…');
    scheduler.stop();
    server.close(() => {
      console.log('[server] 已关闭');
      process.exit(0);
    });
    // 兜底：5 秒内没关干净就强制退出
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => {
    console.error('[server] unhandledRejection：', err && err.stack ? err.stack : err);
  });
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaughtException：', err && err.stack ? err.stack : err);
  });
}

if (require.main === module) {
  bootstrap();
}

module.exports = { server, bootstrap, handleRequest, safeJoin };
