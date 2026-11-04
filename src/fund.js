'use strict';

/**
 * 基金数据层（零依赖，复用 src/http.js）
 *
 * 上游（均为天天基金 / 蛋卷公开接口）：
 *   - 搜索：https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=
 *   - 排行：https://fund.eastmoney.com/data/rankhandler.aspx
 *   - 详情/净值：https://fund.eastmoney.com/pingzhongdata/<code>.js
 *
 * 特性：
 *   - 内存 TTL 缓存（rank 10min / detail 10min / quotes 5min / search 5min / backtest 5min）
 *   - 同一 key 的进行中请求合并，避免并发击穿上游
 *   - 上游失败时回退旧缓存并标注 source:'cache'；无旧缓存则抛错由路由层返回 {ok:false}
 *   - 上游编码自适应：UTF-8 出现乱码替换符时自动用 GBK 重取一次
 */

const { getText } = require('./http');

const FUND_REFERER = 'https://fund.eastmoney.com/';
const SUGGEST_URL = 'https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=';
const RANK_URL = 'https://fund.eastmoney.com/data/rankhandler.aspx';
const PINGZHONG_URL = 'https://fund.eastmoney.com/pingzhongdata/';

const TTL = {
  rank: 10 * 60 * 1000,
  detail: 10 * 60 * 1000,
  quotes: 5 * 60 * 1000,
  search: 5 * 60 * 1000,
  backtest: 5 * 60 * 1000,
  compare: 5 * 60 * 1000,
  type: 5 * 60 * 1000,
};

const FUND_TYPE_KEYS = { all: 'all', gp: 'gp', hh: 'hh', zq: 'zq', zs: 'zs', qdii: 'qdii' };
// 内部允许的东财排序码（3nzf=近3年、2nzf=近2年、lnzf=成立来；对外 /api/fund/rank 仍以契约枚举为主）
const RANK_SORTS = ['1nzf', '3yzf', '6yzf', '1yzf', 'rzdf', 'jnzf', '2nzf', '3nzf', 'lnzf'];

// ---------------- 基础工具 ----------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNum(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[%％,，\s]/g, '');
  if (!text || text === '--' || text === '---' || text === 'null') return null;
  const num = Number.parseFloat(text);
  return Number.isFinite(num) ? num : null;
}

function round(num, digits = 2) {
  if (!Number.isFinite(num)) return null;
  const base = 10 ** digits;
  return Math.round(num * base) / base;
}

function pad2(num) {
  return String(num).padStart(2, '0');
}

/** 时间戳 → 'YYYY-MM-DD'（本地时区，天天基金的时间戳是 UTC+8 零点） */
function formatDate(ts) {
  const date = new Date(Number(ts));
  if (!Number.isFinite(date.getTime())) return null;
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function stripTags(html) {
  return String(html === null || html === undefined ? '' : html)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .trim();
}

/** 等距降采样，保留首尾，按 t 去重 */
function downsample(list, max) {
  if (!Array.isArray(list) || !list.length) return [];
  if (list.length <= max) return list.slice();
  const out = [];
  const step = (list.length - 1) / (max - 1);
  let lastT = null;
  for (let i = 0; i < max; i += 1) {
    const item = list[Math.round(i * step)];
    if (!item) continue;
    if (lastT !== null && item.t === lastT) continue;
    out.push(item);
    lastT = item.t;
  }
  return out;
}

async function mapLimit(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;
  const concurrency = Math.max(1, Math.min(limit, list.length));
  let cursor = 0;
  async function runner() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      await worker(list[index], index);
    }
  }
  const runners = [];
  for (let i = 0; i < concurrency; i += 1) runners.push(runner());
  await Promise.all(runners);
}

// ---------------- TTL 缓存（带请求合并 + 失败回退） ----------------

function createCache(maxEntries) {
  const store = new Map();
  const inflight = new Map();
  const max = maxEntries || 80;

  function prune() {
    while (store.size > max) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  function wrap(key, ttlMs, loader) {
    const now = Date.now();
    const entry = store.get(key);
    if (entry && entry.value !== undefined) {
      if (entry.failAt && now - entry.failAt < 30000) {
        // 刚刚失败过：30s 内直接回退旧缓存，避免打爆上游
        return Promise.resolve({ value: entry.value, source: 'cache', fetchedAt: entry.at, error: entry.error });
      }
      if (now - entry.at <= ttlMs) {
        // TTL 内命中，数据视为最新（source 记 live）
        return Promise.resolve({ value: entry.value, source: 'live', fetchedAt: entry.at });
      }
    }
    if (inflight.has(key)) return inflight.get(key);

    const task = (async () => {
      try {
        const value = await loader();
        store.delete(key);
        store.set(key, { value, at: Date.now() });
        prune();
        return { value, source: 'live', fetchedAt: Date.now() };
      } catch (err) {
        if (entry && entry.value !== undefined) {
          entry.failAt = Date.now();
          entry.error = err && err.message ? err.message : String(err);
          return { value: entry.value, source: 'cache', fetchedAt: entry.at, error: entry.error };
        }
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, task);
    return task;
  }

  return { wrap, store };
}

const cache = createCache(120);

// ---------------- 上游抓取（编码自适应） ----------------

async function fetchSmart(url, options = {}) {
  const timeout = options.timeout || 15000;
  const retries = options.retries || 2;
  const headers = Object.assign({ Referer: options.referer || FUND_REFERER }, options.headers || {});
  const text = await getText(url, { encoding: 'utf8', timeout, retries, headers });
  // 天天基金部分接口是 GBK：UTF-8 解出替换符时自动改用 GBK 重取一次
  if (typeof text === 'string' && text.indexOf('\uFFFD') >= 0) {
    try {
      return await getText(url, { encoding: 'gbk', timeout, retries: 1, headers });
    } catch (err) {
      return text;
    }
  }
  return text;
}

// ---------------- pingzhongdata JS 变量抽取 ----------------

/** 宽松 JSON 解析：兼容 pingzhongdata 里的 undefined / 未加引号 key / 尾逗号 */
function parseLoose(raw) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    /* 继续尝试修复 */
  }
  const fixed = String(raw)
    .replace(/:\s*undefined\b/g, ':null')
    .replace(/,\s*undefined\b/g, ',null')
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([\]}])/g, '$1');
  try {
    return JSON.parse(fixed);
  } catch (err) {
    return undefined;
  }
}

/** 从 JS 文本中抽取 `var <name> = <value>;` 的值（字符串 / 数字 / 数组 / 对象） */
function extractJsValue(text, name) {
  if (!text) return undefined;
  const re = new RegExp('var\\s+' + name + '\\s*=');
  const match = re.exec(text);
  if (!match) return undefined;

  let i = match.index + match[0].length;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (i >= text.length) return undefined;

  const first = text[i];

  if (first === '"' || first === "'") {
    let out = '';
    let j = i + 1;
    while (j < text.length) {
      const ch = text[j];
      if (ch === '\\') {
        out += text[j + 1] || '';
        j += 2;
        continue;
      }
      if (ch === first) break;
      out += ch;
      j += 1;
    }
    return out;
  }

  if (first === '[' || first === '{') {
    const close = first === '[' ? ']' : '}';
    let depth = 0;
    let inStr = false;
    let quote = '';
    for (let j = i; j < text.length; j += 1) {
      const ch = text[j];
      if (inStr) {
        if (ch === '\\') {
          j += 1;
          continue;
        }
        if (ch === quote) inStr = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = true;
        quote = ch;
        continue;
      }
      if (ch === first) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) return parseLoose(text.slice(i, j + 1));
      }
    }
    return undefined;
  }

  let j = i;
  while (j < text.length && !/[;,\n]/.test(text[j])) j += 1;
  return parseLoose(text.slice(i, j).trim());
}

// ---------------- 基金搜索 ----------------

async function searchUpstream(key, limit) {
  const url = SUGGEST_URL + encodeURIComponent(key);
  const text = await fetchSmart(url, { referer: FUND_REFERER, timeout: 12000, retries: 2 });
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error('基金搜索响应解析失败');
  }
  const raw = Array.isArray(json && json.Datas)
    ? json.Datas
    : Array.isArray(json && json.Data)
      ? json.Data
      : [];
  const items = [];
  for (const entry of raw) {
    if (!entry) continue;
    // 只保留基金条目：搜索接口会同时返回股票/指数（CATEGORY 150/600，无 FundBaseInfo）
    if (!entry.FundBaseInfo) continue;
    const base = entry.FundBaseInfo;
    const code = String(entry.CODE || entry.code || '').trim();
    if (!/^\d{6}$/.test(code)) continue;
    items.push({
      code,
      name: stripTags(entry.NAME || entry.name || code),
      type: stripTags(base.FTYPE || '') || null,
      manager: base.JJJL ? String(base.JJJL).trim() : null,
      company: base.JJGS ? String(base.JJGS).trim() : null,
      nav: toNum(base.DWJZ),
      navDate: base.FSRQ ? String(base.FSRQ).trim() : null,
      minBuy: toNum(base.MINSG),
    });
    if (items.length >= limit) break;
  }
  return items;
}

async function searchFunds(key, limit) {
  const keyword = String(key === null || key === undefined ? '' : key).trim();
  const count = Math.min(30, Math.max(1, Number.parseInt(limit, 10) || 10));
  if (!keyword) return { ok: true, items: [] };
  const cached = await cache.wrap('search:' + keyword + ':' + count, TTL.search, () =>
    searchUpstream(keyword, count)
  );
  return { ok: true, items: cached.value, source: cached.source };
}

/** 用搜索接口反查基金类型（详情/对比展示用），失败返回 null */
async function getFundType(code) {
  try {
    const cached = await cache.wrap('type:' + code, TTL.type, async () => {
      const items = await searchUpstream(code, 5);
      const hit = items.find((item) => item.code === code);
      return hit ? hit.type || null : null;
    });
    return cached.value || null;
  } catch (err) {
    return null;
  }
}

async function resolveFundType(code) {
  try {
    const value = await Promise.race([getFundType(code), sleep(2500).then(() => null)]);
    return value || null;
  } catch (err) {
    return null;
  }
}

// ---------------- 基金排行 ----------------

function parseRankPayload(text) {
  const source = String(text || '');
  // 东财偶发风控：返回 {ErrCode:-999,Data:"无访问权限"}，直接抛错走缓存回退
  if (/ErrCode\s*:\s*-999/.test(source) || /无访问权限/.test(source)) {
    throw new Error('基金榜单上游限流/无访问权限');
  }
  const match = source.match(/datas:\[([\s\S]*?)\],allRecords/);
  let block = match ? match[1] : null;
  if (block === null) {
    const loose = source.match(/datas:\[([\s\S]*?)\]/);
    if (loose) block = loose[1];
    else if (/datas:\s*\[\s*\]/.test(source)) block = '';
    else throw new Error('基金榜单响应格式异常');
  }
  const rows = [];
  const re = /"([^"]*)"/g;
  let hit;
  while ((hit = re.exec(block))) rows.push(hit[1]);
  const totalMatch = source.match(/allRecords:(\d+)/);
  return { rows, allRecords: totalMatch ? Number.parseInt(totalMatch[1], 10) : null };
}

function parseRankRows(rows) {
  const items = [];
  for (const row of rows) {
    if (typeof row !== 'string' || !row) continue;
    const fields = row.split(',');
    const code = fields[0];
    if (!/^\d{6}$/.test(code || '')) continue;
    items.push({
      code,
      name: fields[1] || code,
      date: fields[3] || null,
      nav: toNum(fields[4]),
      cumNav: toNum(fields[5]),
      dayPct: toNum(fields[6]),
      weekPct: toNum(fields[7]),
      monthPct: toNum(fields[8]),
      m3: toNum(fields[9]),
      m6: toNum(fields[10]),
      y1: toNum(fields[11]),
      y2: toNum(fields[12]),
      y3: toNum(fields[13]),
      ytd: toNum(fields[14]),
      since: toNum(fields[15]),
      foundingDate: fields[16] || null,
      buyFee: toNum(fields[19]),
      saleFee: toNum(fields[20]),
    });
  }
  return items;
}

/** 排行上游抓取 + 缓存（内部复用：/api/fund/rank、screen、similar、manager-pick） */
async function loadRankData(type, sort, page, size) {
  const url =
    RANK_URL +
    '?op=ph&dt=kf&ft=' + type +
    '&rs=&gs=0&sc=' + sort +
    '&st=desc&sd=2024-01-01&ed=2025-12-31&qdii=&tabSubtype=,,,,,&pi=' + page +
    '&pn=' + size + '&dx=1';

  return cache.wrap('rank:' + type + ':' + sort + ':' + page + ':' + size, TTL.rank, async () => {
    // 与浏览器行为一致：从排行榜页面发起的 ajax 会带该 Referer
    const text = await fetchSmart(url, {
      referer: 'https://fund.eastmoney.com/data/fundranking.html',
      timeout: 20000,
      retries: 2,
    });
    return parseRankPayload(text);
  });
}

function normalizeRankParams(params, maxSize) {
  const input = params || {};
  return {
    type: FUND_TYPE_KEYS[String(input.type || 'all')] || 'all',
    sort: RANK_SORTS.indexOf(String(input.sort)) >= 0 ? String(input.sort) : '1nzf',
    page: Math.max(1, Number.parseInt(input.page, 10) || 1),
    size: Math.min(maxSize, Math.max(1, Number.parseInt(input.size, 10) || 20)),
  };
}

async function getRank(params) {
  const { type, sort, page, size } = normalizeRankParams(params, 50);
  const cached = await loadRankData(type, sort, page, size);
  return {
    ok: true,
    page,
    size,
    items: parseRankRows(cached.value.rows),
    total: cached.value.allRecords,
    source: cached.source,
  };
}

/** 内部复用：取较大规模的同类型排行（screen / similar / manager-pick 用，size 上限 300） */
async function getRankItems(params) {
  const { type, sort, page, size } = normalizeRankParams(params, 300);
  const cached = await loadRankData(type, sort, page, size);
  return {
    ok: true,
    page,
    size,
    items: parseRankRows(cached.value.rows),
    total: cached.value.allRecords,
    source: cached.source,
  };
}

// ---------------- 基金详情 ----------------

function returnOverDays(points, days) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const last = points[points.length - 1];
  if (!days || !Number.isFinite(days)) {
    const first = points[0];
    return first.nav > 0 ? round((last.nav / first.nav - 1) * 100, 2) : null;
  }
  const cutoff = last.t - days * 86400000;
  let base = null;
  for (const point of points) {
    if (point.t >= cutoff) {
      base = point;
      break;
    }
  }
  if (!base || !(base.nav > 0)) return null;
  return round((last.nav / base.nav - 1) * 100, 2);
}

function computeRisk(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return { maxDrawdown: null, volatility: null, sharpe: null, annualized: null };
  }
  const returns = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1].nav;
    const cur = points[i].nav;
    if (!(prev > 0) || !(cur > 0)) continue;
    const r = cur / prev - 1;
    if (Number.isFinite(r) && Math.abs(r) < 1) returns.push(r);
  }

  let volatility = null;
  if (returns.length > 1) {
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const days = (last.t - first.t) / 86400000;
  const annualized =
    days > 0 && first.nav > 0 && last.nav > 0
      ? (Math.pow(last.nav / first.nav, 365 / days) - 1) * 100
      : null;

  const sharpe = volatility && annualized !== null ? (annualized - 1.5) / volatility : null;

  let peak = null;
  let maxDrawdown = 0;
  for (const point of points) {
    if (!(point.nav > 0)) continue;
    if (peak === null || point.nav > peak) peak = point.nav;
    const dd = (point.nav / peak - 1) * 100;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }

  return {
    maxDrawdown: round(maxDrawdown, 2),
    volatility: round(volatility, 2),
    sharpe: round(sharpe, 2),
    annualized: round(annualized, 2),
  };
}

function buildGrandTotalSeries(grandTotal, fundName) {
  const out = { fund: [], hs300: [], peer: [] };
  if (!Array.isArray(grandTotal)) return out;

  const pick = (entry) => {
    if (!entry || !Array.isArray(entry.data)) return [];
    const points = [];
    for (const pair of entry.data) {
      if (!Array.isArray(pair)) continue;
      const t = toNum(pair[0]);
      const pct = toNum(pair[1]);
      if (Number.isFinite(t) && Number.isFinite(pct)) points.push({ t, pct });
    }
    points.sort((a, b) => a.t - b.t);
    return downsample(points, 600);
  };

  for (const entry of grandTotal) {
    if (!entry) continue;
    const entryName = typeof entry.name === 'string' ? entry.name : '';
    if (!out.hs300.length && /沪深\s*300/.test(entryName)) {
      out.hs300 = pick(entry);
      continue;
    }
    if (!out.peer.length && /同类/.test(entryName)) {
      out.peer = pick(entry);
      continue;
    }
    if (!out.fund.length && (!fundName || entryName === fundName)) {
      out.fund = pick(entry);
    }
  }
  if (!out.fund.length && grandTotal.length) out.fund = pick(grandTotal[0]);
  return out;
}

function parsePingzhongData(code, text) {
  const name = String(extractJsValue(text, 'fS_name') || code).trim() || code;

  const navTrend = extractJsValue(text, 'Data_netWorthTrend');
  const acTrend = extractJsValue(text, 'Data_ACWorthTrend');
  const grandTotal = extractJsValue(text, 'Data_grandTotal');
  const managers = extractJsValue(text, 'Data_currentFundManager');
  const scaleData = extractJsValue(text, 'Data_fluctuationScale');
  const assetAlloc = extractJsValue(text, 'Data_assetAllocation');

  const syl1n = toNum(extractJsValue(text, 'syl_1n')); // 近 1 年
  const syl6y = toNum(extractJsValue(text, 'syl_6y')); // 近 6 月
  const syl3y = toNum(extractJsValue(text, 'syl_3y')); // 近 3 月
  const syl1y = toNum(extractJsValue(text, 'syl_1y')); // 近 1 月

  const points = [];
  if (Array.isArray(navTrend)) {
    for (const item of navTrend) {
      if (!item) continue;
      const t = toNum(item.x);
      const nav = toNum(item.y);
      if (!Number.isFinite(t) || !Number.isFinite(nav) || nav <= 0) continue;
      points.push({ t, nav, equityReturn: toNum(item.equityReturn) });
    }
  }
  points.sort((a, b) => a.t - b.t);
  if (!points.length) throw new Error('该基金净值序列为空（代码可能不存在）');

  const latest = points[points.length - 1];
  const previous = points.length > 1 ? points[points.length - 2] : null;
  const nav = latest.nav;
  const navDate = formatDate(latest.t);
  let dayPct = latest.equityReturn;
  if (dayPct === null && previous && previous.nav > 0) {
    dayPct = round((nav / previous.nav - 1) * 100, 2);
  }

  let cumNav = null;
  if (Array.isArray(acTrend)) {
    for (let i = acTrend.length - 1; i >= 0; i -= 1) {
      const row = acTrend[i];
      const value = Array.isArray(row) ? toNum(row[1]) : toNum(row && row.y);
      if (Number.isFinite(value)) {
        cumNav = value;
        break;
      }
    }
  }
  if (cumNav === null) cumNav = nav;

  const navSeries = points.map((point) => ({ t: point.t, nav: point.nav }));

  const stage = {
    m1: syl1y !== null ? syl1y : returnOverDays(points, 30),
    m3: syl3y !== null ? syl3y : returnOverDays(points, 91),
    m6: syl6y !== null ? syl6y : returnOverDays(points, 182),
    y1: syl1n !== null ? syl1n : returnOverDays(points, 365),
    y3: returnOverDays(points, 1095),
    since: cumNav > 0 ? round((cumNav - 1) * 100, 2) : returnOverDays(points, 0),
  };

  const risk = computeRisk(points);

  let manager = { name: null, star: null, workTime: null, fundSize: null };
  if (Array.isArray(managers) && managers[0]) {
    const item = managers[0];
    manager = {
      name: item.name ? String(item.name).trim() : null,
      star: item.star === null || item.star === undefined ? null : toNum(item.star),
      workTime: item.workTime ? String(item.workTime).trim() : null,
      fundSize: item.fundSize ? String(item.fundSize).trim() : null,
    };
  }

  let scale = null;
  if (scaleData && Array.isArray(scaleData.series) && scaleData.series.length) {
    const lastScale = scaleData.series[scaleData.series.length - 1];
    scale = toNum(lastScale && lastScale.y);
  }
  if (scale === null && manager.fundSize) {
    scale = toNum(String(manager.fundSize).replace(/[^\d.]/g, ''));
  }

  const assetAllocation = { stock: null, bond: null, cash: null };
  if (assetAlloc && Array.isArray(assetAlloc.series)) {
    for (const series of assetAlloc.series) {
      if (!series) continue;
      const seriesName = String(series.name || '');
      const values = Array.isArray(series.data) ? series.data : [];
      const lastValue = values.length ? toNum(values[values.length - 1]) : null;
      if (/股票/.test(seriesName)) assetAllocation.stock = lastValue;
      else if (/债券/.test(seriesName)) assetAllocation.bond = lastValue;
      else if (/现金/.test(seriesName)) assetAllocation.cash = lastValue;
    }
  }

  return {
    code,
    name,
    type: null,
    nav: round(nav, 4),
    navDate,
    dayPct: round(dayPct, 2),
    cumNav: round(cumNav, 4),
    stage,
    risk,
    manager,
    scale: round(scale, 2),
    assetAllocation,
    topHoldings: [],
    navSeries,
    compareSeries: buildGrandTotalSeries(grandTotal, name),
    fetchedAt: Date.now(),
  };
}

async function loadFundInternal(code) {
  return cache.wrap('detail:' + code, TTL.detail, async () => {
    const text = await fetchSmart(PINGZHONG_URL + code + '.js', {
      referer: FUND_REFERER,
      timeout: 20000,
      retries: 1,
    });
    return parsePingzhongData(code, text);
  });
}

function buildPublicFund(internal) {
  return {
    code: internal.code,
    name: internal.name,
    type: internal.type || null,
    nav: internal.nav,
    navDate: internal.navDate,
    dayPct: internal.dayPct,
    cumNav: internal.cumNav,
    stage: internal.stage,
    risk: internal.risk,
    manager: internal.manager,
    scale: internal.scale,
    assetAllocation: internal.assetAllocation,
    topHoldings: Array.isArray(internal.topHoldings) ? internal.topHoldings : [],
    navSeries: downsample(internal.navSeries, 300).map((point) => ({ t: point.t, nav: point.nav })),
    compareSeries: {
      fund: downsample(internal.compareSeries.fund, 300),
      hs300: downsample(internal.compareSeries.hs300, 300),
      peer: downsample(internal.compareSeries.peer, 300),
    },
  };
}

async function getDetail(code) {
  const cached = await loadFundInternal(code);
  const fund = buildPublicFund(cached.value);
  if (!fund.type) {
    const type = await resolveFundType(code);
    if (type) {
      fund.type = type;
      cached.value.type = type;
    }
  }
  return { ok: true, source: cached.source, fund };
}

// ---------------- 基金净值序列 ----------------

async function getNav(code, range) {
  const cached = await loadFundInternal(code);
  const points = cached.value.navSeries;
  const rangeKey = String(range || '1y') === 'all' ? 'all' : String(range || '1y');
  let scope = points;
  if (rangeKey !== 'all') {
    const days = rangeKey === '3y' ? 1095 : rangeKey === '5y' ? 1825 : 365;
    const cutoff = points[points.length - 1].t - days * 86400000;
    scope = points.filter((point) => point.t >= cutoff);
  }
  return {
    ok: true,
    code,
    items: downsample(scope, 400).map((point) => ({ t: point.t, nav: point.nav })),
    source: cached.source,
  };
}

// ---------------- 基金最新净值（复用详情缓存） ----------------

async function getFundQuotes(codes) {
  const list = [];
  for (const raw of Array.isArray(codes) ? codes : []) {
    const code = String(raw === null || raw === undefined ? '' : raw).trim();
    if (/^\d{6}$/.test(code) && list.indexOf(code) < 0) list.push(code);
  }
  const scope = list.slice(0, 20);
  const items = [];
  const failed = [];

  await mapLimit(scope, 3, async (code) => {
    try {
      const cached = await cache.wrap('quote:' + code, TTL.quotes, async () => {
        const detail = await loadFundInternal(code);
        const fund = detail.value;
        return {
          code: fund.code,
          name: fund.name,
          nav: fund.nav,
          navDate: fund.navDate,
          dayPct: fund.dayPct,
        };
      });
      items.push(cached.value);
    } catch (err) {
      failed.push(code);
    }
  });

  items.sort((a, b) => scope.indexOf(a.code) - scope.indexOf(b.code));
  return { ok: items.length > 0, items, failed };
}

// ---------------- 定投回测 ----------------

function periodKey(ts, freq) {
  const date = new Date(ts);
  if (freq === 'weekly') {
    const day = date.getDay();
    const offset = (day + 6) % 7; // 周一 = 0
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
    return 'w' + monday.getFullYear() + '-' + (monday.getMonth() + 1) + '-' + monday.getDate();
  }
  return 'm' + date.getFullYear() + '-' + (date.getMonth() + 1);
}

/** XIRR（资金加权年化），返回百分数；无解返回 null */
function xirr(flows) {
  if (!Array.isArray(flows) || flows.length < 2) return null;
  const t0 = flows[0].t;
  const YEAR_MS = 365 * 86400000;
  const npv = (rate) =>
    flows.reduce((sum, flow) => sum + flow.amount / Math.pow(1 + rate, (flow.t - t0) / YEAR_MS), 0);

  let low = -0.9999;
  let high = 10;
  let fLow = npv(low);
  let fHigh = npv(high);
  if (!Number.isFinite(fLow) || !Number.isFinite(fHigh) || fLow * fHigh > 0) return null;
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-7) return mid * 100;
    if (fLow * fMid < 0) {
      high = mid;
      fHigh = fMid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }
  return ((low + high) / 2) * 100;
}

function curveDrawdown(curve) {
  let peak = null;
  let maxDrawdown = 0;
  for (const point of curve) {
    if (!(point.invested > 0)) continue;
    if (peak === null || point.value > peak) peak = point.value;
    const dd = (point.value / peak - 1) * 100;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }
  return maxDrawdown;
}

function simulateBacktest(options) {
  const { code, name, points, amount, freq, years, targetProfit, stopLoss } = options;
  if (!Array.isArray(points) || points.length < 2) return null;

  const endTs = points[points.length - 1].t;
  const startTs = endTs - years * 365 * 86400000;
  const scope = points.filter((point) => point.t >= startTs);
  if (scope.length < 2) return null;

  const target = Number.isFinite(targetProfit) && targetProfit > 0 ? targetProfit : null;
  const stop = Number.isFinite(stopLoss) ? (stopLoss > 0 ? -stopLoss : stopLoss) : null;

  let units = 0;
  let invested = 0;
  let periods = 0;
  let lastKey = null;
  let triggered = null;
  let endPoint = null;
  const flows = [];
  const curve = [];

  for (const point of scope) {
    const key = periodKey(point.t, freq);
    if (key !== lastKey) {
      lastKey = key;
      units += amount / point.nav;
      invested += amount;
      periods += 1;
      flows.push({ t: point.t, amount: -amount });
    }

    const value = units * point.nav;
    curve.push({ t: point.t, invested: round(invested, 2), value: round(value, 2) });

    if (!(units > 0)) continue;
    const pct = ((value - invested) / invested) * 100;
    if (target !== null && pct >= target) {
      triggered = 'stopProfit';
      endPoint = point;
      break;
    }
    if (stop !== null && pct <= stop) {
      triggered = 'stopLoss';
      endPoint = point;
      break;
    }
  }

  const lastScope = scope[scope.length - 1];
  const finalPoint = endPoint || lastScope;
  const finalValue = units * finalPoint.nav;
  const profit = finalValue - invested;
  const profitPct = invested > 0 ? (profit / invested) * 100 : null;

  flows.push({ t: finalPoint.t, amount: finalValue });
  const annualized = xirr(flows);
  const maxDrawdown = curveDrawdown(curve);
  const startPoint = scope[0];

  return {
    code,
    name,
    invested: round(invested, 2),
    finalValue: round(finalValue, 2),
    profit: round(profit, 2),
    profitPct: round(profitPct, 2),
    annualized: round(annualized, 2),
    maxDrawdown: round(maxDrawdown, 2),
    periods,
    triggered,
    startDate: formatDate(startPoint.t),
    endDate: formatDate(finalPoint.t),
    curve: downsample(curve, 240),
    desc:
      '定投规则：' + (freq === 'weekly' ? '每周' : '每月') + '首个交易日买入 ¥' + amount +
      '，区间 ' + formatDate(startPoint.t) + ' 至 ' + formatDate(finalPoint.t) +
      '，共 ' + periods + ' 期。年化收益采用 XIRR（资金加权）计算；最大回撤基于组合市值曲线（含定投本金流入影响），仅供参考，不构成投资建议。',
  };
}

async function backtest(params) {
  const input = params || {};
  const code = String(input.code || '').trim();
  const amount = Math.min(10000000, Math.max(10, toNum(input.amount) || 1000));
  const freq = String(input.freq || 'monthly') === 'weekly' ? 'weekly' : 'monthly';
  const years = Math.min(20, Math.max(1, Number.parseInt(input.years, 10) || 3));
  const targetProfit = toNum(input.targetProfit);
  const stopLoss = toNum(input.stopLoss);

  const cacheKey = ['bt', code, amount, freq, years, targetProfit, stopLoss].join('|');
  const cached = await cache.wrap(cacheKey, TTL.backtest, async () => {
    const detail = await loadFundInternal(code);
    const internal = detail.value;
    return simulateBacktest({
      code: internal.code,
      name: internal.name,
      points: internal.navSeries,
      amount,
      freq,
      years,
      targetProfit,
      stopLoss,
    });
  });

  if (!cached.value) {
    return { ok: true, result: null, note: '该基金历史净值不足，无法回测' };
  }
  return { ok: true, result: cached.value };
}

// ---------------- 基金对比 ----------------

function normalizeCompareSeries(points, startTs, endTs, restrict) {
  let scope = points;
  if (restrict) scope = points.filter((point) => point.t >= startTs && point.t <= endTs);
  if (scope.length < 2) scope = points;
  const base = scope[0].nav;
  if (!(base > 0)) return [];
  const series = scope.map((point) => ({
    t: point.t,
    pct: round((point.nav / base - 1) * 100, 2),
  }));
  return downsample(series, 300);
}

async function compareFunds(codes) {
  const list = [];
  for (const raw of Array.isArray(codes) ? codes : []) {
    const code = String(raw === null || raw === undefined ? '' : raw).trim();
    if (/^\d{6}$/.test(code) && list.indexOf(code) < 0) list.push(code);
  }
  const scope = list.slice(0, 4);
  if (!scope.length) throw new Error('缺少有效的基金代码');

  const cached = await cache.wrap('cmp:' + scope.slice().sort().join(','), TTL.compare, async () => {
    const loaded = await Promise.all(
      scope.map(async (code) => {
        try {
          const detail = await loadFundInternal(code);
          return { code, internal: detail.value };
        } catch (err) {
          return { code, internal: null };
        }
      })
    );
    const valid = loaded.filter((item) => item.internal);
    if (!valid.length) throw new Error('未能获取所选基金的净值数据，请检查代码或稍后重试');

    const typeList = await Promise.all(scope.map((code) => resolveFundType(code)));
    const typeMap = {};
    scope.forEach((code, index) => {
      typeMap[code] = typeList[index] || null;
    });

    const starts = valid.map((item) => item.internal.navSeries[0].t);
    const ends = valid.map((item) => item.internal.navSeries[item.internal.navSeries.length - 1].t);
    let startTs = Math.max.apply(null, starts);
    let endTs = Math.min.apply(null, ends);
    const hasCommonWindow = endTs > startTs;
    if (!hasCommonWindow) {
      startTs = Math.min.apply(null, starts);
      endTs = Math.max.apply(null, ends);
    }

    const byCode = new Map(valid.map((item) => [item.code, item.internal]));
    const items = scope
      .filter((code) => byCode.has(code))
      .map((code) => {
        const internal = byCode.get(code);
        return {
          code,
          name: internal.name,
          type: typeMap[code],
          stage: internal.stage,
          risk: internal.risk,
          series: normalizeCompareSeries(internal.navSeries, startTs, endTs, hasCommonWindow),
        };
      });

    return {
      items,
      window: { start: formatDate(startTs), end: formatDate(endTs) },
    };
  });

  return cached.value;
}

module.exports = {
  TTL,
  searchFunds,
  getRank,
  getRankItems,
  getDetail,
  getNav,
  getFundQuotes,
  backtest,
  compareFunds,
  // 供其它数据层复用（工具箱：板块恐贪 / 分析 / 组合回测）
  createCache,
  downsample,
  toNum,
  round,
  mapLimit,
  computeRisk,
  getFundInternal: (code) => loadFundInternal(code),
  // 供调试/测试
  _parsePingzhongData: parsePingzhongData,
  _parseRankPayload: parseRankPayload,
  _simulateBacktest: simulateBacktest,
  _extractJsValue: extractJsValue,
  _clearCache: () => cache.store.clear(),
};
