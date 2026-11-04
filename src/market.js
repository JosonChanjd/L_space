'use strict';

/**
 * 市场数据层（工具箱）：东方财富 push2 / 腾讯行情
 *
 * 上游实测（fltt=2 时直接返回小数）：
 *   push2 clist 行业：fs=m:90+t:2，fields=f12,f14,f2,f3,f8,f20（total≈496）
 *   push2 clist ETF ：fs=b:MK0021，fields=f12,f14,f2,f3,f6,f8（total≈1375）
 *   push2 stock/get ：secid=100.HSAHP（AH溢价，f43=130.12）、133.HKDCNH（0.85）、133.USDCNH（6.67）
 *   push2 资金流    ：fid=f62 主力净流入；成分股 fs=b:<板块代码>
 *
 * 端点：/api/market/industries、/api/analytics/ah-premium、/api/analytics/fx-stock、
 *       /api/analytics/copper-oil、/api/analytics/stock-bond、/api/fund/etf、
 *       /api/stock/pick、/api/emotion/panel
 */

const fs = require('fs');
const path = require('path');

const config = require('./config');
const { getText } = require('./http');
const { fetchOne, fetchQuotes } = require('./tencent');
const { createCache, toNum, round } = require('./fund');
const indexValuation = require('./indexValuation');
const fearHistory = require('./fearHistory');
const collect = require('./collect');

// 东方财富行情接口有多个等价域名：海外机房访问 push2 偶发 502，按顺序自动降级
const PUSH2_HOSTS = [
  'https://push2.eastmoney.com',
  'https://push2delay.eastmoney.com',
  'https://push2his.eastmoney.com',
];
let push2Preferred = null;
const PUSH2_HEADERS = {
  Referer: 'https://quote.eastmoney.com/',
  Accept: 'application/json, text/plain, */*',
};

const HISTORY_FILE = path.join(config.DATA_DIR, 'analytics-history.json');
const CONFIG_FILE = path.join(config.DATA_DIR, 'analytics-config.json');
const HISTORY_MAX = 365;
const HISTORY_RETURN = 120;

const TTL = {
  industries: 60 * 1000,
  etf: 60 * 1000,
  ah: 60 * 1000,
  fxStock: 60 * 1000,
  copperOil: 120 * 1000,
  stockBond: 60 * 1000,
  stockPick: 5 * 60 * 1000,
  emotion: 60 * 1000,
};

const cache = createCache(120);

function num(value) {
  return toNum(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDate(ts) {
  const d = new Date(Number(ts) || Date.now());
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// ---------------- push2 抓取 ----------------

async function push2Json(apiPath, params) {
  const query = new URLSearchParams();
  for (const key of Object.keys(params)) query.set(key, String(params[key]));
  const suffix = apiPath + '?' + query.toString();
  const hosts = push2Preferred
    ? [push2Preferred].concat(PUSH2_HOSTS.filter((host) => host !== push2Preferred))
    : PUSH2_HOSTS.slice();

  let lastError = null;
  for (const host of hosts) {
    try {
      const text = await getText(host + suffix, {
        encoding: 'utf8',
        timeout: 9000,
        retries: 1,
        headers: PUSH2_HEADERS,
      });
      let json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        throw new Error('响应解析失败');
      }
      if (!json || (json.rc !== undefined && json.rc !== 0) || !json.data) {
        throw new Error('接口返回异常');
      }
      push2Preferred = host;
      return json.data;
    } catch (err) {
      lastError = err;
      if (push2Preferred === host) push2Preferred = null;
    }
  }
  throw new Error('东财行情接口不可用（' + (lastError && lastError.message ? lastError.message : 'unknown') + '）');
}

async function clist(options) {
  const data = await push2Json('/api/qt/clist/get', {
    pn: options.pn || 1,
    pz: options.pz || 50,
    po: options.po === 0 ? 0 : 1,
    np: 1,
    fltt: 2,
    invt: 2,
    fid: options.fid || 'f3',
    fs: options.fs,
    fields: options.fields,
  });
  return {
    total: num(data.total) || 0,
    diff: Array.isArray(data.diff) ? data.diff : [],
  };
}

async function stockGet(secid, fields) {
  return push2Json('/api/qt/stock/get', { secid, fields, fltt: 2, invt: 2 });
}

/** fltt=2 时字段已是小数；这里再对少数可能返回整型缩放的接口做兜底 */
function scaleIndexPrice(value) {
  const n = num(value);
  if (n === null) return null;
  return Math.abs(n) > 1000 ? n / 100 : n;
}

function scaleHkd(value) {
  const n = num(value);
  if (n === null) return null;
  return Math.abs(n) > 100 ? n / 10000 : n;
}

function scaleUsd(value) {
  const n = num(value);
  if (n === null) return null;
  if (Math.abs(n) > 1000) return n / 10000;
  if (Math.abs(n) > 100) return n / 100;
  return n;
}

function scalePct(value) {
  const n = num(value);
  if (n === null) return null;
  return Math.abs(n) > 100 ? n / 100 : n;
}

// ---------------- analytics-history.json ----------------

function readHistoryStore() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    if (!raw || !raw.trim()) return {};
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (err) {
    if (err && err.code !== 'ENOENT') console.warn('[market] 读取分析历史失败：', err && err.message);
    return {};
  }
}

function writeHistoryStore(store) {
  try {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    const tmpFile = HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmpFile, HISTORY_FILE);
    return true;
  } catch (err) {
    console.warn('[market] 写入分析历史失败：', err && err.message);
    return false;
  }
}

function sortByDate(list) {
  return list.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 读取某个比价序列的最近 limit 条 */
function getDailyHistory(key, limit) {
  const store = readHistoryStore();
  const list = Array.isArray(store[key]) ? store[key].filter((item) => item && typeof item.date === 'string' && Number.isFinite(Number(item.ratio))) : [];
  const count = Math.min(HISTORY_MAX, Math.max(1, Number.parseInt(limit, 10) || HISTORY_RETURN));
  return sortByDate(list).slice(-count);
}

/** 写入当日比率（同日覆盖，最多 365 条），返回最近 120 条 */
function recordDailyHistory(key, ratio) {
  const existing = getDailyHistory(key, HISTORY_RETURN);
  if (!Number.isFinite(ratio)) return existing;
  const date = localDate(Date.now());
  const store = readHistoryStore();
  const list = Array.isArray(store[key]) ? store[key].filter((item) => item && typeof item.date === 'string') : [];
  const item = list.find((entry) => entry.date === date);
  const value = round(ratio, 4);
  if (item) {
    if (item.ratio === value) return sortByDate(list).slice(-HISTORY_RETURN);
    item.ratio = value;
  } else {
    list.push({ date, ratio: value });
  }
  store[key] = sortByDate(list).slice(-HISTORY_MAX);
  writeHistoryStore(store);
  return store[key].slice(-HISTORY_RETURN);
}

// ---------------- 行业板块 ----------------

async function loadIndustries() {
  return cache.wrap('industries', TTL.industries, async () => {
    const { total, diff } = await clist({
      fs: 'm:90+t:2',
      fid: 'f3',
      fields: 'f12,f14,f2,f3,f8,f20',
      pz: 500,
    });
    const items = [];
    for (const row of diff) {
      const pct = num(row.f3);
      if (pct === null) continue;
      const cap = num(row.f20);
      items.push({
        code: String(row.f12 || ''),
        name: String(row.f14 || ''),
        pct,
        turnover: num(row.f8),
        marketCap: cap === null ? null : round(cap / 1e8, 2), // 亿元
      });
    }
    if (!items.length) throw new Error('行业板块数据为空');
    const up = items.filter((item) => item.pct > 0).length;
    const down = items.filter((item) => item.pct < 0).length;
    const flat = items.length - up - down;
    const avgPct = round(items.reduce((sum, item) => sum + item.pct, 0) / items.length, 2);
    const strong = items.filter((item) => item.pct >= 2).length;
    return {
      updatedAt: Date.now(),
      total: total || items.length,
      up,
      down,
      flat,
      avgPct,
      strongRatio: round((strong / items.length) * 100, 1), // 0-100
      items,
    };
  });
}

async function getIndustries(limit) {
  const cached = await loadIndustries();
  const count = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 30));
  const data = cached.value;
  return {
    ok: true,
    updatedAt: data.updatedAt,
    total: data.total,
    up: data.up,
    down: data.down,
    flat: data.flat,
    avgPct: data.avgPct,
    strongRatio: data.strongRatio,
    items: data.items.slice(0, count),
    source: cached.source,
  };
}

// ---------------- ETF 列表 ----------------

async function getEtfList(params) {
  const input = params || {};
  const sort = ['f3', 'f6', 'f8'].indexOf(String(input.sort)) >= 0 ? String(input.sort) : 'f3';
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const size = Math.min(50, Math.max(1, Number.parseInt(input.size, 10) || 20));
  const keyword = String(input.kw || '').trim();

  const cached = await cache.wrap('etf:' + sort + ':' + page + ':' + size + ':' + keyword, TTL.etf, async () => {
    const { total, diff } = await clist({
      fs: 'b:MK0021',
      fid: sort,
      fields: 'f12,f14,f2,f3,f6,f8',
      pn: keyword ? 1 : page,
      pz: keyword ? 500 : size,
    });
    let items = diff.map((row) => ({
      code: String(row.f12 || ''),
      name: String(row.f14 || ''),
      price: num(row.f2),
      changePct: num(row.f3),
      amount: num(row.f6), // 成交额（元）
      turnover: num(row.f8), // 换手率 %
    }));
    if (keyword) {
      items = items.filter((item) => item.code.indexOf(keyword) >= 0 || item.name.indexOf(keyword) >= 0);
      const start = (page - 1) * size;
      return { total: items.length, items: items.slice(start, start + size) };
    }
    return { total, items };
  });

  return { ok: true, page, size, total: cached.value.total, items: cached.value.items, source: cached.source };
}

// ---------------- AH 溢价 ----------------

const AH_PAIRS = [
  { name: '中国平安', aCode: 'sh601318', hCode: 'hk02318' },
  { name: '招商银行', aCode: 'sh600036', hCode: 'hk03968' },
  { name: '工商银行', aCode: 'sh601398', hCode: 'hk01398' },
];

async function fetchHsaopFromSina() {
  try {
    const text = await getText('https://hq.sinajs.cn/list=hkHSAHP', {
      encoding: 'gbk',
      timeout: 8000,
      retries: 1,
      headers: { Referer: 'https://finance.sina.com.cn/' },
    });
    const match = text.match(/hq_str_hkHSAHP="([^"]*)"/);
    if (!match || !match[1]) return null;
    const fields = match[1].split(',');
    // 新浪港股指数格式：code,name,open,prevClose,high,low,last,change,changePct,...
    const value = num(fields[6]);
    if (!(value > 0)) return null;
    return {
      value: round(value, 2),
      change: fields[7] === undefined ? null : round(num(fields[7]), 2),
      changePct: fields[8] === undefined ? null : round(num(fields[8]), 2),
    };
  } catch (err) {
    return null;
  }
}

async function fetchHkdCnyFromTencent() {
  try {
    const text = await getText('https://qt.gtimg.cn/q=whHKDCNY', {
      encoding: 'gbk',
      timeout: 8000,
      retries: 1,
    });
    const match = text.match(/v_whHKDCNY="([^"]*)"/);
    if (!match || !match[1]) return null;
    const fields = match[1].split('~');
    const value = num(fields[3]);
    return value > 0 ? round(value, 4) : null;
  } catch (err) {
    return null;
  }
}

async function getAhPremium() {
  const cached = await cache.wrap('ah-premium', TTL.ah, async () => {
    // 1) AH 溢价指数：优先东财 push2（多域名降级），失败回退新浪 hkHSAHP
    let index = null;
    try {
      const indexData = await stockGet('100.HSAHP', 'f43,f57,f58,f169,f170');
      index = {
        value: scaleIndexPrice(indexData.f43),
        change: scalePct(indexData.f169),
        changePct: scalePct(indexData.f170),
      };
    } catch (err) {
      index = await fetchHsaopFromSina();
    }

    // 2) 港币汇率：优先东财，失败回退腾讯 whHKDCNY
    let hkdCny = null;
    try {
      const hkdData = await stockGet('133.HKDCNH', 'f43,f57,f58');
      hkdCny = scaleHkd(hkdData.f43);
    } catch (err) {
      hkdCny = null;
    }
    if (!(hkdCny > 0)) hkdCny = await fetchHkdCnyFromTencent();
    if (!(hkdCny > 0)) throw new Error('港币汇率数据缺失');

    const codes = [];
    for (const pair of AH_PAIRS) codes.push(pair.aCode, pair.hCode);
    const { quotes } = await fetchQuotes(codes);
    const byCode = new Map(quotes.map((quote) => [quote.code, quote]));

    const pairs = AH_PAIRS.map((pair) => {
      const a = byCode.get(pair.aCode);
      const h = byCode.get(pair.hCode);
      const aPrice = a ? num(a.price) : null;
      const hPrice = h ? num(h.price) : null;
      let premiumPct = null;
      if (aPrice !== null && hPrice !== null && hPrice > 0) {
        premiumPct = round((aPrice / (hPrice * hkdCny) - 1) * 100, 2);
      }
      return { name: pair.name, aCode: pair.aCode, aPrice, hCode: pair.hCode, hPrice, premiumPct };
    });

    return {
      index,
      hkdCny: round(hkdCny, 4),
      pairs,
      note: index ? '' : 'AH 溢价指数暂不可用，可参考下方成分股 A/H 溢价',
      updatedAt: Date.now(),
    };
  });

  return {
    ok: true,
    index: cached.value.index,
    hkdCny: cached.value.hkdCny,
    pairs: cached.value.pairs,
    note: cached.value.note || '',
    updatedAt: cached.value.updatedAt,
    source: cached.source,
  };
}

// ---------------- 股汇比 ----------------

async function fetchUsdCnyFromTencent() {
  try {
    const text = await getText('https://qt.gtimg.cn/q=whUSDCNY', {
      encoding: 'gbk',
      timeout: 8000,
      retries: 1,
    });
    const match = text.match(/v_whUSDCNY="([^"]*)"/);
    if (!match || !match[1]) return null;
    const value = num(match[1].split('~')[3]);
    return value > 0 ? round(value, 4) : null;
  } catch (err) {
    return null;
  }
}

async function getFxStock() {
  const cached = await cache.wrap('fx-stock', TTL.fxStock, async () => {
    const shIndex = await fetchOne('sh000001');
    let usdCny = null;
    try {
      const usdData = await stockGet('133.USDCNH', 'f43,f57,f58');
      usdCny = scaleUsd(usdData.f43);
    } catch (err) {
      usdCny = null;
    }
    if (!(usdCny > 0)) usdCny = await fetchUsdCnyFromTencent();
    if (!(usdCny > 0)) throw new Error('美元兑离岸人民币数据缺失');
    if (!(shIndex.price > 0)) throw new Error('上证指数行情缺失');
    const ratio = round(shIndex.price / usdCny, 2);
    const history = recordDailyHistory('fx-stock', ratio);
    return {
      usdCny: round(usdCny, 4),
      index: {
        code: shIndex.code,
        name: shIndex.name,
        price: shIndex.price,
        changePct: shIndex.changePct,
      },
      ratio,
      history,
      updatedAt: Date.now(),
    };
  });

  return {
    ok: true,
    usdCny: cached.value.usdCny,
    index: cached.value.index,
    ratio: cached.value.ratio,
    history: cached.value.history,
    updatedAt: cached.value.updatedAt,
    source: cached.source,
  };
}

// ---------------- 铜油比 ----------------

async function getCopperOil() {
  const cached = await cache.wrap('copper-oil', TTL.copperOil, async () => {
    const { quotes } = await fetchQuotes(['sh512400', 'sh501018']);
    const byCode = new Map(quotes.map((quote) => [quote.code, quote]));
    const copper = byCode.get('sh512400');
    const oil = byCode.get('sh501018');
    if (!copper || !oil) throw new Error('铜/油代理标的行情缺失');
    if (!(copper.price > 0) || !(oil.price > 0)) throw new Error('铜/油代理标的价格异常');
    const ratio = round(copper.price / oil.price, 4);
    const history = recordDailyHistory('copper-oil', ratio);
    return {
      copper: { code: copper.code, name: copper.name, price: copper.price, changePct: copper.changePct },
      oil: { code: oil.code, name: oil.name, price: oil.price, changePct: oil.changePct },
      ratio,
      history,
      updatedAt: Date.now(),
    };
  });

  return {
    ok: true,
    copper: cached.value.copper,
    oil: cached.value.oil,
    ratio: cached.value.ratio,
    history: cached.value.history,
    updatedAt: cached.value.updatedAt,
    source: cached.source,
  };
}

// ---------------- 股债性价比 ----------------

function readBondYieldConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const data = JSON.parse(raw);
    const value = num(data && data.bondYield);
    if (Number.isFinite(value) && value >= 0 && value <= 15) return value;
  } catch (err) {
    /* 缺省 2.0 */
  }
  return null;
}

function stockBondZone(erp) {
  if (!Number.isFinite(erp)) {
    return { key: 'unknown', label: '数据不足', desc: '沪深300 估值或国债收益率缺失，无法判断股债性价比' };
  }
  if (erp >= 5) {
    return { key: 'extreme', label: '极高性价比', desc: 'ERP ≥ 5%：股票盈利收益率显著高于无风险利率，历史上多对应中长期底部区域' };
  }
  if (erp >= 3) {
    return { key: 'high', label: '较高性价比', desc: 'ERP 3%-5%：股票相对债券仍有较好吸引力，可维持偏股配置' };
  }
  if (erp >= 1) {
    return { key: 'balanced', label: '均衡', desc: 'ERP 1%-3%：股债性价比中性，建议均衡配置' };
  }
  if (erp >= 0) {
    return { key: 'low', label: '偏低', desc: 'ERP 0%-1%：股票相对债券吸引力偏低，注意控制仓位' };
  }
  return { key: 'bond', label: '债优于股', desc: 'ERP < 0：债券收益率高于股票盈利收益率，防御型配置更优' };
}

function findHs300(items) {
  if (!Array.isArray(items)) return null;
  return (
    items.find((item) => item && item.name === '沪深300') ||
    items.find((item) => item && /沪深\s*300/.test(item.name || '')) ||
    null
  );
}

async function getStockBond(bondYieldParam) {
  const key = 'stock-bond:' + (Number.isFinite(bondYieldParam) ? bondYieldParam : 'auto');
  const cached = await cache.wrap(key, TTL.stockBond, async () => {
    const valuation = await indexValuation.getIndexValuation();
    const hs = findHs300(valuation.items);
    if (!hs) throw new Error('沪深300 估值数据缺失');

    let bondYield = null;
    if (Number.isFinite(bondYieldParam) && bondYieldParam >= 0 && bondYieldParam <= 15) {
      bondYield = bondYieldParam;
    } else {
      const configured = readBondYieldConfig();
      bondYield = configured === null ? 2.0 : configured;
    }

    const pe = num(hs.pe);
    const ep = pe !== null && pe > 0 ? round(100 / pe, 2) : null;
    const erp = ep !== null ? round(ep - bondYield, 2) : null;
    return {
      hs300: {
        pe,
        pb: num(hs.pb),
        pePercentile: num(hs.pePercentile),
        yeild: num(hs.yeild),
        ep,
      },
      bondYield: round(bondYield, 2),
      erp,
      zone: stockBondZone(erp),
      source: 'manual', // 公开 10Y 国债收益率接口不可用，前端可编辑参考值
      updatedAt: valuation.updatedAt || Date.now(),
    };
  });

  return {
    ok: true,
    hs300: cached.value.hs300,
    bondYield: cached.value.bondYield,
    erp: cached.value.erp,
    zone: cached.value.zone,
    source: cached.value.source,
    updatedAt: cached.value.updatedAt,
  };
}

// ---------------- 牛人选股 ----------------

async function getStockPick(limit) {
  const count = Math.min(30, Math.max(1, Number.parseInt(limit, 10) || 10));
  const cached = await cache.wrap('stock-pick:' + count, TTL.stockPick, async () => {
    const industryData = await clist({
      fs: 'm:90+t:2',
      fid: 'f62',
      fields: 'f12,f14,f3,f62',
      pz: 496,
    });
    const industries = industryData.diff
      .map((row) => ({
        code: String(row.f12 || ''),
        name: String(row.f14 || ''),
        pct: num(row.f3),
        mainInflow: num(row.f62), // 元
      }))
      .filter((item) => item.code)
      .slice(0, 5);
    if (!industries.length) throw new Error('行业资金流数据缺失');

    const stockMap = new Map();
    for (const industry of industries) {
      try {
        const stockData = await clist({
          fs: 'b:' + industry.code,
          fid: 'f62',
          fields: 'f12,f14,f2,f3,f62,f20',
          pz: Math.max(count, 10),
        });
        for (const row of stockData.diff) {
          const code = String(row.f12 || '');
          if (!/^\d{6}$/.test(code) || stockMap.has(code)) continue;
          const cap = num(row.f20);
          stockMap.set(code, {
            code,
            name: String(row.f14 || ''),
            industry: industry.name,
            price: num(row.f2),
            changePct: num(row.f3),
            inflow: num(row.f62),
            marketCap: cap === null ? null : round(cap / 1e8, 2), // 亿元
          });
        }
      } catch (err) {
        /* 单个行业失败不影响整体 */
      }
    }

    const stocks = [...stockMap.values()]
      .sort((a, b) => (b.inflow === null ? -Infinity : b.inflow) - (a.inflow === null ? -Infinity : a.inflow))
      .slice(0, count);
    if (!stocks.length) throw new Error('行业成分股数据缺失');
    return { industries, stocks, updatedAt: Date.now() };
  });

  return {
    ok: true,
    updatedAt: cached.value.updatedAt,
    industries: cached.value.industries,
    stocks: cached.value.stocks,
    source: cached.source,
  };
}

// ---------------- 情绪面板 ----------------

async function getEmotionPanel() {
  const cached = await cache.wrap('emotion-panel', TTL.emotion, async () => {
    const snapshot = await collect.getSnapshot().catch(() => null);
    const valuation = await indexValuation.getIndexValuation().catch(() => ({ items: [] }));

    let industriesData = null;
    try {
      const industriesCached = await loadIndustries();
      industriesData = industriesCached.value;
    } catch (err) {
      industriesData = null;
    }

    const hs = valuation && Array.isArray(valuation.items) ? findHs300(valuation.items) : null;

    let quotes = [];
    try {
      const quoteResult = await fetchQuotes(['sh000001', 'sz399001', 'sz399006', 'sh000300']);
      quotes = quoteResult.quotes;
    } catch (err) {
      quotes = [];
    }

    return {
      updatedAt: Date.now(),
      fearGreed: snapshot ? snapshot.fearGreed : null,
      fearHistory: fearHistory.getHistory(60),
      valuation: {
        hs300: hs
          ? {
              pe: num(hs.pe),
              pb: num(hs.pb),
              pePercentile: num(hs.pePercentile),
              yeild: num(hs.yeild),
            }
          : null,
      },
      industries: industriesData
        ? {
            up: industriesData.up,
            down: industriesData.down,
            avgPct: industriesData.avgPct,
            strongRatio: industriesData.strongRatio,
          }
        : null,
      indices: quotes.map((quote) => ({
        code: quote.code,
        name: quote.name,
        price: quote.price,
        changePct: quote.changePct,
      })),
      note: industriesData ? '' : '行业板块数据暂不可用（海外机房对东财接口限制），其余指标正常',
    };
  });

  return {
    ok: true,
    updatedAt: cached.value.updatedAt,
    fearGreed: cached.value.fearGreed,
    fearHistory: cached.value.fearHistory,
    valuation: cached.value.valuation,
    industries: cached.value.industries,
    indices: cached.value.indices,
    note: cached.value.note || '',
    source: cached.source,
  };
}

module.exports = {
  TTL,
  getIndustries,
  getEtfList,
  getAhPremium,
  getFxStock,
  getCopperOil,
  getStockBond,
  getStockPick,
  getEmotionPanel,
  // 供 sectors.js / 调试复用
  loadIndustries,
  getDailyHistory,
  recordDailyHistory,
  _readBondYieldConfig: readBondYieldConfig,
  _stockBondZone: stockBondZone,
};
