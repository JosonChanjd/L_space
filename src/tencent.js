'use strict';

/**
 * 腾讯财经行情抓取与解析。
 *
 * 数据源：https://qt.gtimg.cn/q=<codes>（GBK 编码）
 * 已实测字段（`~` 分隔）：
 *   0 市场 | 1 名称 | 2 代码 | 3 现价 | 4 昨收 | 5 今开
 *   30 时间 | 31 涨跌 | 32 涨跌% | 33 最高 | 34 最低
 *   A股个股 52周高低 = f[67] / f[68]
 *   美股/港股 52周高低 = f[48] / f[49]
 *   A股指数一般没有 52 周字段，回退当日 f[33]/f[34] 兜底
 *
 * 说明：按 README 约定「逐码独立抓取 + 重试」，避免出口代理对长响应的随机截断。
 */

const config = require('./config');
const { getText } = require('./http');

const QUOTE_URL = 'https://qt.gtimg.cn/q=';

const A_INDEX_CODES = new Set([
  'sh000001',
  'sh000016',
  'sh000300',
  'sh000688',
  'sh000852',
  'sh000905',
  'sz399001',
  'sz399005',
  'sz399006',
  'sz399101',
]);
const US_INDEX_CODES = new Set(['usDJI', 'usIXIC', 'usINX', 'usSPX', 'usNDX', 'usDXY']);
const HK_INDEX_CODES = new Set(['hkHSI', 'hkHSCEI', 'hkHSTECH']);

// 常用简写 → 原样代码（避免 HSI 被误判成美股）
const CODE_ALIASES = {
  HSI: 'hkHSI',
  HSCEI: 'hkHSCEI',
  HSTECH: 'hkHSTECH',
  DJI: 'usDJI',
  IXIC: 'usIXIC',
  INX: 'usINX',
  SPX: 'usINX',
  NDX: 'usNDX',
};

// 6 位纯数字中的指数特例（000001 按约定映射到上证指数）
const NUMERIC_INDEX_CODES = {
  '000001': 'sh000001',
  '000016': 'sh000016',
  '000300': 'sh000300',
  '000688': 'sh000688',
  '000852': 'sh000852',
  '000905': 'sh000905',
};

function toNum(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/[%％,，\s]/g, '');
  if (!text) return null;
  const num = Number.parseFloat(text);
  return Number.isFinite(num) ? num : null;
}

function round(num, digits = 2) {
  if (!Number.isFinite(num)) return null;
  const base = 10 ** digits;
  return Math.round(num * base) / base;
}

/**
 * 智能归一化代码：
 *   600519 → sh600519   000001 → sh000001   399006 → sz399006
 *   AAPL → usAAPL       700 → hk00700        hk00700 / sz399006 原样
 * @param {string} raw
 * @returns {string|null}
 */
function normalizeCode(raw) {
  if (raw === undefined || raw === null) return null;
  let input = String(raw).trim().replace(/\s+/g, '');
  if (!input) return null;

  // 已带交易所前缀：sh/sz/bj + 6 位数字
  let match = input.match(/^(sh|sz|bj)(\d{6})$/i);
  if (match) return match[1].toLowerCase() + match[2];

  // 港股：hk00700 / hkHSI
  match = input.match(/^hk(\d{1,5}|[a-z]{1,6})$/i);
  if (match) {
    const tail = match[1];
    return 'hk' + (/^\d+$/.test(tail) ? tail.padStart(5, '0') : tail.toUpperCase());
  }

  // 美股：usAAPL
  match = input.match(/^us([a-z][a-z0-9.\-]{0,9})$/i);
  if (match) return 'us' + match[1].toUpperCase();

  // 纯 6 位数字
  if (/^\d{6}$/.test(input)) {
    if (NUMERIC_INDEX_CODES[input]) return NUMERIC_INDEX_CODES[input];
    if (/^[569]/.test(input)) return 'sh' + input;
    if (/^[0123]/.test(input)) return 'sz' + input;
    if (/^[48]/.test(input)) return 'bj' + input;
    return 'sh' + input;
  }

  // 纯 1-5 位数字 → 港股（700 → hk00700）
  if (/^\d{1,5}$/.test(input)) return 'hk' + input.padStart(5, '0');

  // 纯字母 → 美股 / 指数别名
  const alias = CODE_ALIASES[input.toUpperCase()];
  if (alias) return alias;
  if (/^[a-z][a-z0-9.\-]{0,9}$/i.test(input)) return 'us' + input.toUpperCase();

  return null;
}

function marketOf(code) {
  if (/^us/i.test(code)) return 'us';
  if (/^hk/i.test(code)) return 'hk';
  return 'a';
}

function isIndex(code) {
  return A_INDEX_CODES.has(code) || US_INDEX_CODES.has(code) || HK_INDEX_CODES.has(code);
}

function unitOf(code, market) {
  if (isIndex(code)) return '点';
  if (market === 'us') return '美元';
  if (market === 'hk') return '港元';
  return '元';
}

/** 解析一行 `v_sh600519="1~贵州茅台~600519~..."` */
function parseRawLine(text) {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/v_([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/);
  if (!match) return null;
  return { key: match[1], fields: match[2].split('~') };
}

/**
 * 52 周高低：优先按市场取专用字段，缺失时回退当日高低兜底（A股指数常见）。
 * @param {string} code
 * @param {'a'|'us'|'hk'} market
 * @param {string[]} fields
 */
function pick52wRange(code, market, fields) {
  let high = null;
  let low = null;

  if (market === 'us' || market === 'hk') {
    high = toNum(fields[48]);
    low = toNum(fields[49]);
  } else {
    high = toNum(fields[67]);
    low = toNum(fields[68]);
  }

  if (!(high > 0) || !(low > 0)) {
    // A股指数、部分海外标的无 52 周字段：用当日高低兜底，保证页面区间条可渲染
    high = toNum(fields[33]);
    low = toNum(fields[34]);
  }

  if (high !== null && low !== null && high < low) {
    const tmp = high;
    high = low;
    low = tmp;
  }
  if (!(high > 0)) high = null;
  if (!(low > 0)) low = null;
  return { high52w: high, low52w: low };
}

/**
 * 将原始字段拼成前端契约 quote 对象。
 * @param {string} code 归一化后的代码
 * @param {{ key: string, fields: string[] }} raw
 */
function buildQuote(code, raw) {
  const fields = raw.fields;
  const market = marketOf(code);
  const name = (fields[1] || '').trim() || code;

  const price = toNum(fields[3]);
  const prevClose = toNum(fields[4]);
  let change = toNum(fields[31]);
  let changePct = toNum(fields[32]);

  if (changePct === null && price !== null && prevClose) {
    changePct = round(((price - prevClose) / prevClose) * 100, 2);
  }
  if (change === null && price !== null && prevClose !== null) {
    change = round(price - prevClose, 3);
  }

  const range = pick52wRange(code, market, fields);

  return {
    name,
    code,
    market,
    price: price === null ? null : round(price, 3),
    change: change === null ? null : round(change, 3),
    changePct: changePct === null ? null : round(changePct, 2),
    open: toNum(fields[5]),
    prevClose,
    high: toNum(fields[33]),
    low: toNum(fields[34]),
    high52w: range.high52w,
    low52w: range.low52w,
    unit: unitOf(code, market),
  };
}

/**
 * 抓取单个标的（内部已带重试）。
 * @param {string} code 已归一化代码
 * @param {{ retries?: number, timeout?: number }} options
 */
async function fetchOne(code, options = {}) {
  const text = await getText(QUOTE_URL + encodeURIComponent(code), {
    retries: Number.isFinite(options.retries) ? options.retries : config.HTTP_RETRIES,
    timeout: Number.isFinite(options.timeout) ? options.timeout : config.HTTP_TIMEOUT,
    encoding: 'gbk',
  });

  const raw = parseRawLine(text);
  if (!raw) throw new Error('行情响应为空或格式异常');

  const quote = buildQuote(code, raw);
  if (quote.price === null && quote.prevClose === null) {
    throw new Error('未返回有效行情（代码可能不存在）');
  }
  return quote;
}

/**
 * 并发抓取多个标的（逐码独立请求 + 单个失败不影响整体）。
 * @param {string[]} codes 已归一化代码数组
 * @param {{ concurrency?: number, retries?: number, timeout?: number }} options
 * @returns {Promise<{ quotes: object[], failures: { code: string, error: string }[] }>}
 */
async function fetchQuotes(codes, options = {}) {
  const list = Array.isArray(codes) ? [...new Set(codes.filter(Boolean))] : [];
  const concurrency = Math.max(1, Math.min(options.concurrency || config.FETCH_CONCURRENCY, list.length || 1));

  const success = new Map();
  const failures = [];
  const queue = list.slice();

  async function worker() {
    while (queue.length) {
      const code = queue.shift();
      try {
        const quote = await fetchOne(code, options);
        success.set(code, quote);
      } catch (err) {
        failures.push({ code, error: err && err.message ? err.message : String(err) });
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i += 1) workers.push(worker());
  await Promise.all(workers);

  const quotes = list.map((code) => success.get(code)).filter(Boolean);
  return { quotes, failures };
}

module.exports = {
  QUOTE_URL,
  A_INDEX_CODES,
  US_INDEX_CODES,
  HK_INDEX_CODES,
  normalizeCode,
  marketOf,
  isIndex,
  unitOf,
  toNum,
  round,
  parseRawLine,
  pick52wRange,
  buildQuote,
  fetchOne,
  fetchQuotes,
};
