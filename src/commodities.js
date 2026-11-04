'use strict';

/**
 * 商品行情数据源（黄金 / 白银 / 原油 / 铜）
 *
 * 主数据源：腾讯财经外盘期货接口 qt.gtimg.cn（hf_GC / hf_SI / hf_CL / hf_HG），
 * 返回形如：v_hf_GC="4048.14,2.73,4046.40,4046.60,4062.20,3928.20,23:14:08,3940.40,3940.80,...,2026-11-04,纽约黄金"
 *   0 现价 | 1 涨跌幅% | 2 买价 | 3 卖价 | 4 最高 | 5 最低 | 6 时间 | 7 昨收 | 8 今开 | 12 日期 | 13 名称
 * 备用数据源：东方财富行情（COMEX 黄金 101.GC00Y / 白银 101.SI00Y / 铜 101.HG00Y）。
 * 任一数据源不可达时优雅降级（available:false），不影响主行情。
 *
 * 返回值契约：
 *   { available: true, items: [{ name, code, price, change, changePct, unit, date, source }], note }
 */

const { getText } = require('./http');

const TTL_MS = 60 * 1000;

const COMMODITY_DEFS = [
  { code: 'hf_GC', name: '纽约黄金', unit: '美元/盎司', emSecid: '101.GC00Y', divisor: 1 },
  { code: 'hf_SI', name: '纽约白银', unit: '美元/盎司', emSecid: '101.SI00Y', divisor: 1 },
  { code: 'hf_CL', name: 'WTI 原油', unit: '美元/桶', emSecid: null, divisor: 1 },
  // COMEX 铜在腾讯接口以「美分/磅」报价，统一换算为「美元/磅」
  { code: 'hf_HG', name: 'COMEX 铜', unit: '美元/磅', emSecid: '101.HG00Y', divisor: 100 },
];

const COMMODITY_URL = 'https://qt.gtimg.cn/q=' + COMMODITY_DEFS.map((item) => item.code).join(',');

let cache = { at: 0, value: null };
let inFlight = null;

function toNum(value) {
  const str = String(value === undefined || value === null ? '' : value).replace(/[%,\s]/g, '');
  if (!str || str === '-' || str === '--') return null;
  const num = Number.parseFloat(str);
  return Number.isFinite(num) ? num : null;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const base = Math.pow(10, digits === undefined ? 2 : digits);
  return Math.round(value * base) / base;
}

function itemFromTencent(def, fields) {
  const divisor = def.divisor || 1;
  const price = toNum(fields[0]) / divisor;
  const prevClose = toNum(fields[7]) / divisor;
  let pct = toNum(fields[1]);
  if (!(price > 0)) return null;
  if (pct === null && prevClose > 0) pct = ((price - prevClose) / prevClose) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) > 30) return null;
  return {
    name: (fields[13] || def.name).trim() || def.name,
    code: def.code,
    price: round(price, price >= 100 ? 2 : 3),
    change: prevClose > 0 ? round(price - prevClose, 3) : null,
    changePct: round(pct, 2),
    unit: def.unit,
    date: (fields[12] || '').trim() || null,
    source: 'tencent',
  };
}

async function fetchFromTencent(failures) {
  const text = await getText(COMMODITY_URL, {
    retries: 2,
    timeout: 6000,
    encoding: 'gbk',
    headers: { Referer: 'https://finance.qq.com/', Accept: '*/*' },
  });
  const items = [];
  for (const def of COMMODITY_DEFS) {
    const match = text.match(new RegExp('v_' + def.code + '\\s*=\\s*"([^"]*)"'));
    if (!match || !match[1]) { failures.push(def.code); continue; }
    // 外盘期货接口字段以英文逗号分隔（股票行情才是 ~ 分隔）
    const item = itemFromTencent(def, match[1].split(','));
    if (!item) { failures.push(def.code); continue; }
    items.push(item);
  }
  return items;
}

/** 东方财富备用源：仅能补黄金/白银/铜 */
async function fetchFromEastmoney() {
  const defs = COMMODITY_DEFS.filter((def) => def.emSecid);
  const items = [];
  for (const def of defs) {
    try {
      const url = 'https://push2.eastmoney.com/api/qt/stock/get?secid=' + def.emSecid +
        '&fields=f43,f57,f58,f59,f60,f169,f170';
      const text = await getText(url, {
        retries: 1,
        timeout: 5000,
        encoding: 'utf8',
        headers: { Referer: 'https://quote.eastmoney.com/', Accept: '*/*' },
      });
      const json = JSON.parse(text);
      const data = json && json.data;
      if (!data) continue;
      const scale = Math.pow(10, Number.isFinite(Number(data.f59)) ? Number(data.f59) : 2);
      const price = Number(data.f43) / scale;
      const change = Number(data.f169) / scale;
      const pct = Number(data.f170) / 100;
      if (!(price > 0) || !Number.isFinite(pct)) continue;
      items.push({
        name: def.name,
        code: def.code,
        price: round(price, price >= 100 ? 2 : 3),
        change: round(change, 2),
        changePct: round(pct, 2),
        unit: def.unit,
        date: null,
        source: 'eastmoney',
      });
    } catch (err) {
      /* 单只失败忽略 */
    }
  }
  return items;
}

function unavailable(note) {
  return { available: false, items: [], note: note || '商品行情暂不可达，已优雅降级' };
}

async function fetchCommodities() {
  if (cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const failures = [];
    let items = [];
    try {
      items = await fetchFromTencent(failures);
    } catch (err) {
      failures.push('tencent:' + (err && err.message ? err.message : 'error'));
    }

    if (!items.length) {
      try {
        items = await fetchFromEastmoney();
      } catch (err) {
        failures.push('eastmoney:' + (err && err.message ? err.message : 'error'));
      }
    }

    let result;
    if (items.length) {
      const missing = COMMODITY_DEFS.filter((def) => !items.some((item) => item.code === def.code));
      result = {
        available: true,
        items,
        note: '商品行情：腾讯财经外盘期货 / 东方财富（黄金、白银、原油、铜）' +
          (missing.length ? '；' + missing.map((def) => def.name).join('/') + ' 暂缺' : ''),
      };
    } else {
      result = unavailable('商品行情接口（腾讯外盘期货 / 东方财富）均不可达');
    }
    cache = { at: Date.now(), value: result };
    return result;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

module.exports = { fetchCommodities, COMMODITY_DEFS };
