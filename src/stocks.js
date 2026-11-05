'use strict';

/**
 * 股票搜索 / 证券解析 / 后复权日线（工具箱 + 回测引擎）
 *
 * 上游（已实测）：
 *   搜索：https://searchapi.eastmoney.com/api/suggest/get
 *         → QuotationCodeTable.Data[]：Code / Name / Classify(AStock/HkStock/UsStock/Index…)
 *           SecurityTypeName(沪A/深A/港股/美股…) / QuoteID(1.600519 / 116.00700 / 105.AAPL / 1.000300)
 *   日线：https://push2his.eastmoney.com/api/qt/stock/kline/get
 *         → data.klines = ["2024-01-02,open,close,high,low,volume,amount,pct", …]（f51 日期 / f53 收盘）
 *         **必须 fqt=2 后复权**：fqt=1 前复权在 20 年高分红股会出现负价
 *
 * secid 解析：优先搜索接口反查 QuoteID（缓存 30min）；失败再用启发式
 *   6 位：6/5/9 → 1.xxxxxx；0/3 → 0.xxxxxx；15/16 → 0.xxxxxx
 *   1-5 位港 → 116. 补零到 5 位；字母美股 → 105.SYMBOL
 */

const { getText } = require('./http');
const { createCache, toNum, round } = require('./fund');

const SEARCH_URL = 'https://searchapi.eastmoney.com/api/suggest/get';
const KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
// push2 在部分海外机房会 502，push2his 同样提供行情查询接口，故报价走 push2his
const QUOTE_URL = 'https://push2his.eastmoney.com/api/qt/stock/get';
const SMARTBOX_URL = 'https://smartbox.gtimg.cn/s3/';
const TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';

const TTL = {
  search: 5 * 60 * 1000,
  secid: 30 * 60 * 1000,
  kline: 5 * 60 * 1000,
  quote: 60 * 1000,
};

const HEADERS = {
  Referer: 'https://quote.eastmoney.com/',
  Accept: 'application/json, text/plain, */*',
};

const cache = createCache(200);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function fetchJson(url, timeout) {
  const text = await getText(url, {
    encoding: 'utf8',
    timeout: timeout || 12000,
    retries: 2,
    headers: HEADERS,
  });
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error('东财接口响应解析失败');
  }
}

/** 'YYYY-MM-DD' → 本地零点时间戳 */
function localMidnight(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!match) return null;
  const ts = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function classifyMarket(row) {
  const securityType = String(row.SecurityTypeName || '');
  const classify = String(row.Classify || '');
  if (/港/.test(securityType) || /HkStock/i.test(classify)) return '港股';
  if (/美/.test(securityType) || /UsStock/i.test(classify)) return '美股';
  if (/指数/.test(securityType) || /^Index/i.test(classify)) return '指数';
  if (/沪|深|A股|B股/.test(securityType) || /AStock|BStock/i.test(classify)) return 'A股';
  if (/基金/.test(securityType) || /Fund/i.test(classify)) return '基金';
  if (/债/.test(securityType) || /Bond/i.test(classify)) return '债券';
  return securityType || classify || '其他';
}

function isFundOrBond(row) {
  const classify = String(row.Classify || '');
  const securityType = String(row.SecurityTypeName || '');
  return (
    /Fund/i.test(classify) ||
    /Bond/i.test(classify) ||
    /基金/.test(securityType) ||
    /债/.test(securityType)
  );
}

async function loadSearchRows(keyword, count) {
  const url =
    SEARCH_URL +
    '?input=' + encodeURIComponent(keyword) +
    '&type=14&token=' + TOKEN +
    '&count=' + clamp(Number.parseInt(count, 10) || 10, 1, 50);
  const json = await fetchJson(url, 12000);
  const table = json && json.QuotationCodeTable;
  return table && Array.isArray(table.Data) ? table.Data : [];
}

/** 腾讯 smartbox 搜索兜底（东财搜索在海外机房偶发解析失败/限流时使用） */
async function loadSmartboxRows(keyword) {
  const text = await getText(
    SMARTBOX_URL + '?q=' + encodeURIComponent(keyword) + '&t=all',
    {
      encoding: 'gbk',
      timeout: 8000,
      retries: 1,
      headers: { Referer: 'https://gu.qq.com/' },
    }
  );
  const match = text.match(/v_hint="([^"]*)"/);
  if (!match || !match[1]) return [];
  let raw = match[1];
  try {
    raw = JSON.parse('"' + raw.replace(/"/g, '\\"') + '"');
  } catch (err) {
    /* 保留原始转义文本 */
  }
  return raw
    .split('^')
    .filter(Boolean)
    .map((part) => {
      const fields = part.split('~');
      return {
        market: String(fields[0] || '').trim(),
        code: String(fields[1] || '').trim(),
        name: String(fields[2] || '').trim(),
        type: String(fields[4] || '').trim(),
      };
    });
}

/** 把 smartbox 结果归一化为与东财搜索一致的 items */
function smartboxToItems(rows, count) {
  const items = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || !row.code || !row.name) continue;
    if (!/^(GP|ZS|ETF)/.test(row.type)) continue;
    const market = row.market;
    let code = row.code;
    let secid = null;
    let marketName = '';
    let type = null;
    if (market === 'sh' || market === 'sz') {
      const digits = code.replace(/\D/g, '');
      if (!/^\d{6}$/.test(digits)) continue;
      code = digits;
      secid = (market === 'sh' ? '1.' : '0.') + code;
      marketName = row.type === 'ZS' ? '指数' : market === 'sh' ? '沪A' : '深A';
      type = row.type === 'ZS' ? 'Index' : row.type === 'ETF' ? 'ETF' : 'AStock';
    } else if (market === 'hk') {
      const digits = code.replace(/\D/g, '').padStart(5, '0');
      if (!/^\d{5}$/.test(digits)) continue;
      code = digits;
      secid = '116.' + code;
      marketName = '港股';
      type = 'HkStock';
    } else if (market === 'us') {
      code = code.split('.')[0].toUpperCase();
      if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(code)) continue;
      secid = '105.' + code;
      marketName = '美股';
      type = 'UsStock';
    } else if (market === 'bj') {
      if (!/^\d{6}$/.test(code)) continue;
      secid = '0.' + code;
      marketName = '京A';
      type = 'AStock';
    } else {
      continue;
    }
    if (seen.has(secid)) continue;
    seen.add(secid);
    items.push({ code, name: row.name, market: marketName, secid, type });
    if (items.length >= count) break;
  }
  return items;
}

/** 只保留可交易/可回测的市场（A股 / 港股 / 美股 / 指数），过滤基金、债券、英股韩股等噪音 */
function isSupportedMarket(row) {
  if (!row || isFundOrBond(row)) return false;
  const classify = String(row.Classify || '');
  const securityType = String(row.SecurityTypeName || '');
  if (/AStock|BStock|HkStock|UsStock|Index/i.test(classify)) return true;
  if (/沪A|深A|京A|港股|美股|指数/.test(securityType)) return true;
  return false;
}

/** 同一代码多市场命中时的优先级：A股 > 港股 > 美股 > 指数 > 其它 */
function marketPriority(row) {
  const market = classifyMarket(row);
  if (market === 'A股') return 0;
  if (market === '港股') return 1;
  if (market === '美股') return 2;
  if (market === '指数') return 3;
  return 9;
}

/**
 * 股票 / 指数搜索（自选搜索 + 回测资产选择）
 * @returns {Promise<{ok:true, items:Array, source:string}>}
 */
async function searchStocks(key, limit) {
  const keyword = String(key === null || key === undefined ? '' : key).trim();
  const count = clamp(Number.parseInt(limit, 10) || 10, 1, 30);
  if (!keyword) return { ok: true, items: [], source: 'empty' };

  const cached = await cache.wrap('stock-search:' + keyword + ':' + count, TTL.search, async () => {
    // 1) 东财搜索（主源）
    let items = [];
    try {
      const rows = await loadSearchRows(keyword, Math.max(count * 2, 10));
      for (const row of rows) {
        if (!row || !row.Code || !row.QuoteID) continue;
        if (!isSupportedMarket(row)) continue;
        items.push({
          code: String(row.Code).trim(),
          name: String(row.Name || '').trim(),
          market: String(row.SecurityTypeName || '').trim() || classifyMarket(row),
          secid: String(row.QuoteID).trim(),
          type: String(row.Classify || '').trim() || null,
        });
        if (items.length >= count) break;
      }
    } catch (err) {
      items = [];
    }

    // 2) 腾讯 smartbox（兜底：数字代码解析失败、海外机房限制等）
    if (!items.length) {
      try {
        const rows = await loadSmartboxRows(keyword);
        const fallback = smartboxToItems(rows, count);
        if (fallback.length) return { items: fallback, source: 'tencent-smartbox' };
      } catch (err) {
        /* 兜底失败则返回空 */
      }
    }
    return { items, source: 'eastmoney' };
  });

  return { ok: true, items: cached.value.items, source: cached.source };
}

/** 启发式 secid（搜索接口失败时兜底） */
function heuristicSecid(code) {
  const raw = String(code === null || code === undefined ? '' : code).trim();
  if (!raw) return null;
  if (/^\d{6}$/.test(raw)) {
    if (/^(15|16)/.test(raw)) return '0.' + raw;
    if (/^[659]/.test(raw)) return '1.' + raw;
    if (/^[03]/.test(raw)) return '0.' + raw;
    return '0.' + raw;
  }
  if (/^\d{1,5}$/.test(raw)) return '116.' + raw.padStart(5, '0');
  if (/^[A-Za-z][A-Za-z0-9.\-]*$/.test(raw)) return '105.' + raw.toUpperCase();
  return null;
}

/**
 * 代码 → { secid, code, name, market }（缓存 30min）
 * 优先搜索接口反查 QuoteID，失败再用启发式。
 */
async function resolveSecid(code) {
  const raw = String(code === null || code === undefined ? '' : code).trim();
  if (!raw) throw new Error('缺少证券代码');

  const cached = await cache.wrap('secid:' + raw.toLowerCase(), TTL.secid, async () => {
    let searched = null;
    try {
      const rows = await loadSearchRows(raw, 20);
      const upper = raw.toUpperCase();
      // 同一代码可能命中多个市场（如 000300：韩股/沪深300指数），按优先级取国内/美股/指数
      const hits = rows
        .filter(
          (row) =>
            row &&
            String(row.Code || '').trim().toUpperCase() === upper &&
            row.QuoteID &&
            isSupportedMarket(row)
        )
        .sort((a, b) => marketPriority(a) - marketPriority(b));
      const hit = hits[0];
      if (hit) {
        searched = {
          secid: String(hit.QuoteID).trim(),
          code: String(hit.Code).trim(),
          name: String(hit.Name || '').trim(),
          market: classifyMarket(hit),
          source: 'search',
        };
      }
    } catch (err) {
      /* 搜索失败 → 启发式 */
    }
    if (searched) return searched;
    const fallback = heuristicSecid(raw);
    if (!fallback) throw new Error('无法解析证券代码：' + raw + '（搜索接口与启发式均失败）');
    return { secid: fallback, code: raw, name: raw, market: null, source: 'heuristic' };
  });

  return cached.value;
}

/**
 * 后复权日线（fqt=2，2005 至今），返回 points:[{t,nav}]
 * @param {string} secid 如 1.600519 / 116.00700 / 105.AAPL / 1.000300
 */
async function getKline(secid) {
  const key = String(secid || '').trim();
  if (!key) throw new Error('缺少 secid');

  const cached = await cache.wrap('kline:' + key, TTL.kline, async () => {
    let lastError = null;
    // 1) 东财 K 线（多个等价域名轮换，海外机房偶发 502/socket hang up）
    for (const host of EASTMONEY_KLINE_HOSTS) {
      try {
        const url =
          host +
          '/api/qt/stock/kline/get?secid=' + encodeURIComponent(key) +
          '&klt=101&fqt=2&beg=20050101&end=20500101' +
          '&fields1=f1,f2,f3,f4,f5,f6' +
          '&fields2=f51,f52,f53,f54,f55,f56,f57,f58';
        const json = await fetchJson(url, 15000);
        const data = json && json.data;
        const rows = data && Array.isArray(data.klines) ? data.klines : [];
        const points = parseEastmoneyKlines(rows);
        if (points.length >= 2) {
          return {
            secid: key,
            code: String((data && data.code) || ''),
            name: String((data && data.name) || ''),
            points,
            source: 'eastmoney',
          };
        }
        lastError = new Error('K 线数据不足：' + key);
      } catch (err) {
        lastError = err;
      }
    }

    // 2) 腾讯 K 线兜底（前复权约 640 根；不足时用不复权长序列，策略会自动截断区间）
    try {
      const fallback = await fetchTencentKline(key);
      if (fallback && fallback.points.length >= 2) return fallback;
    } catch (err) {
      lastError = err;
    }

    throw new Error(
      '行情接口暂时不可用（东财/腾讯均失败）：' + (lastError && lastError.message ? lastError.message : 'unknown')
    );
  });

  return cached.value;
}

const EASTMONEY_KLINE_HOSTS = [
  'https://push2his.eastmoney.com',
  'https://push2delay.eastmoney.com',
  'https://push2.eastmoney.com',
];

function parseEastmoneyKlines(rows) {
  const points = [];
  for (const row of rows || []) {
    if (typeof row !== 'string') continue;
    const fields = row.split(',');
    const date = fields[0];
    const close = toNum(fields[2]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    // fqt=2 后复权价格应为正；仍做保护，避免脏数据
    if (close === null || !(close > 0)) continue;
    const t = localMidnight(date);
    if (!Number.isFinite(t)) continue;
    const open = toNum(fields[1]);
    const high = toNum(fields[3]);
    const low = toNum(fields[4]);
    points.push({
      t,
      date,
      nav: close,
      close,
      open: open === null || !(open > 0) ? close : open,
      high: high === null || !(high > 0) ? close : high,
      low: low === null || !(low > 0) ? close : low,
      volume: toNum(fields[5]),
      amount: toNum(fields[6]),
    });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

/** 东财 secid → 腾讯行情代码（1.600519 → sh600519 / 116.00700 → hk00700 / 105.AAPL → usAAPL） */
function tencentSymbolFromSecid(secid) {
  const raw = String(secid || '').trim();
  const match = /^(\d+)\.(.+)$/.exec(raw);
  if (!match) return null;
  const market = match[1];
  let code = match[2];
  if (market === '1') return 'sh' + code;
  if (market === '0') return 'sz' + code;
  if (market === '116') return 'hk' + code.padStart(5, '0');
  if (market === '105' || market === '106' || market === '107') return 'us' + code.toUpperCase();
  return null;
}

/** 新浪美股日 K（返回全历史，兜底海外行情接口不可用） */
async function fetchSinaUsKline(symbol) {
  const code = String(symbol).replace(/^us/i, '').toUpperCase();
  const url =
    'https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20d/US_MinKService.getDailyK?symbol=' +
    encodeURIComponent(code) + '&___qn=3';
  const text = await getText(url, {
    encoding: 'utf8',
    timeout: 15000,
    retries: 1,
    headers: { Referer: 'https://finance.sina.com.cn/' },
  });
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('新浪美股 K 线解析失败：' + code);
  let rows;
  try {
    rows = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new Error('新浪美股 K 线解析失败：' + code);
  }
  if (!Array.isArray(rows)) throw new Error('新浪美股 K 线为空：' + code);
  const points = [];
  for (const row of rows) {
    const date = String(row && row.d || '');
    const close = toNum(row && row.c);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null || !(close > 0)) continue;
    const t = localMidnight(date);
    if (!Number.isFinite(t)) continue;
    const open = toNum(row.o);
    const high = toNum(row.h);
    const low = toNum(row.l);
    points.push({
      t,
      date,
      nav: close,
      close,
      open: open === null || !(open > 0) ? close : open,
      high: high === null || !(high > 0) ? close : high,
      low: low === null || !(low > 0) ? close : low,
      volume: toNum(row.v),
      amount: null,
    });
  }
  points.sort((a, b) => a.t - b.t);
  return { secid: '105.' + code, code, name: '', points, source: 'sina-us' };
}

function parseTencentKlines(symbol, payload) {  const data = payload && payload.data ? payload.data[symbol] : null;
  if (!data) return [];
  const arr = data.qfqday || data.day || [];
  if (!Array.isArray(arr)) return [];
  const points = [];
  for (const row of arr) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const date = String(row[0]);
    const open = toNum(row[1]);
    const close = toNum(row[2]);
    const high = toNum(row[3]);
    const low = toNum(row[4]);
    const volume = toNum(row[5]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null || !(close > 0)) continue;
    const t = localMidnight(date);
    if (!Number.isFinite(t)) continue;
    points.push({
      t,
      date,
      nav: close,
      close,
      open: open === null || !(open > 0) ? close : open,
      high: high === null || !(high > 0) ? close : high,
      low: low === null || !(low > 0) ? close : low,
      volume,
      amount: null,
    });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

async function fetchTencentKline(secid) {
  const symbol = tencentSymbolFromSecid(secid);
  if (!symbol) throw new Error('无法转换腾讯代码：' + secid);

  // 美股：腾讯前复权接口只返回头尾两根，改用新浪美股日 K（含全历史）
  if (/^us/.test(symbol)) {
    try {
      const sina = await fetchSinaUsKline(symbol);
      if (sina && sina.points.length >= 10) return sina;
    } catch (err) {
      /* 继续尝试腾讯 */
    }
  }

  async function requestTencent(type) {
    const param = symbol + ',day,,,640,' + type;
    const url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + encodeURIComponent(param);
    const text = await getText(url, {
      encoding: 'utf8',
      timeout: 12000,
      retries: 1,
      headers: { Referer: 'https://gu.qq.com/' },
    });
    return JSON.parse(text);
  }

  let payload = null;
  try {
    payload = await requestTencent('qfq');
  } catch (err) {
    payload = null;
  }
  let points = parseTencentKlines(symbol, payload);
  if (points.length < 10) {
    // 部分市场（如美股）前复权接口返回行数异常，改用不复权长序列兜底
    try {
      payload = await requestTencent('day');
      const rawPoints = parseTencentKlines(symbol, payload);
      if (rawPoints.length > points.length) points = rawPoints;
    } catch (err) {
      /* 忽略，使用已有结果 */
    }
  }
  if (!points.length) throw new Error('腾讯 K 线为空：' + symbol);
  return {
    secid,
    code: secid.split('.')[1] || secid,
    name: '',
    points,
    source: 'tencent',
  };
}

/**
 * 实时报价（用于「今日」涨跌幅）：push2 stock/get fltt=2
 * 失败返回 null（调用方可用日线倒数两根兜底）。
 */
async function getStockQuote(secid, name) {
  const key = String(secid || '').trim();
  if (!key) return null;
  try {
    const cached = await cache.wrap('stock-quote:' + key, TTL.quote, async () => {
      const url =
        QUOTE_URL +
        '?secid=' + encodeURIComponent(key) +
        '&fields=f43,f57,f58,f170&fltt=2&invt=2';
      const json = await fetchJson(url, 10000);
      const data = json && json.data;
      if (!data) throw new Error('实时行情缺失');
      const price = toNum(data.f43);
      const changePct = toNum(data.f170);
      if (price === null) throw new Error('实时行情缺失');
      return {
        price,
        changePct,
        code: String(data.f57 || ''),
        name: String(data.f58 || name || ''),
      };
    });
    return cached.value;
  } catch (err) {
    return null;
  }
}

/** 回测用：代码 → 股票资产序列 */
async function getStockSeries(code) {
  const resolved = await resolveSecid(code);
  const kline = await getKline(resolved.secid);
  return {
    type: 'stock',
    code: String(resolved.code || code),
    name: kline.name || resolved.name || String(code),
    secid: resolved.secid,
    market: resolved.market,
    historyType: 'kline',
    points: kline.points,
  };
}

/** 最新一根日线涨跌幅（实时报价失败时兜底） */
function lastBarPct(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const last = points[points.length - 1].nav;
  const prev = points[points.length - 2].nav;
  if (!(prev > 0)) return null;
  return round((last / prev - 1) * 100, 2);
}

module.exports = {
  TTL,
  searchStocks,
  resolveSecid,
  getKline,
  getStockQuote,
  getStockSeries,
  heuristicSecid,
  lastBarPct,
  _classifyMarket: classifyMarket,
  _localMidnight: localMidnight,
};
