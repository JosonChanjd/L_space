'use strict';

/**
 * 指数估值（蛋卷指数估值接口，零依赖）
 *
 * 上游：https://danjuanfunds.com/djapi/index_eva/dj
 *   （原 https://danjuanapp.com/djapi/index_eva/dj 已 301 跨域跳转到 danjuanfunds.com，
 *     Node 的 http 模块不会自动跟随重定向，因此这里直接用新域名，并把旧域名作为兜底候选）
 * 实测 items 63 条，字段：index_code,name,pe,pb,pe_percentile,pb_percentile,roe,yeild,eva_type('low'|'mid'|'high'),date
 *
 * 说明：
 *   - pe_percentile / pb_percentile 上游是 0-1 小数，这里统一转成 0-100（保留 2 位小数），
 *     前端直接按百分数展示，无需再换算。
 *   - eva_type 上游实际值为 low / mid / high（mid 归一化为 normal，文案「正常」）。
 *   - 过滤 pe<=0 且 pb<=0 的无效条目。
 *   - 内存 TTL 30 分钟 + 进行中请求合并；失败回退旧缓存（source:'cache'）。
 */

const { getText } = require('./http');

const VALUATION_URLS = [
  'https://danjuanfunds.com/djapi/index_eva/dj',
  'https://danjuanapp.com/djapi/index_eva/dj',
];
const TTL_MS = 30 * 60 * 1000;
const EVA_TEXT = { low: '低估', normal: '正常', high: '高估' };

const store = new Map();
const inflight = new Map();

function toNum(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/[%％,，\s]/g, '');
  if (!text || text === '--' || text === '---') return null;
  const num = Number.parseFloat(text);
  return Number.isFinite(num) ? num : null;
}

function round(num, digits = 2) {
  if (!Number.isFinite(num)) return null;
  const base = 10 ** digits;
  return Math.round(num * base) / base;
}

/** 0-1 小数 → 0-100 百分数 */
function toPercent100(value) {
  const num = toNum(value);
  if (num === null) return null;
  return round(num * 100, 2);
}

function normalizeEvaType(value) {
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (text === 'low' || text === '低估') return 'low';
  if (text === 'high' || text === '高估') return 'high';
  if (text === 'normal' || text === '正常' || text === 'mid' || text === 'middle') return 'normal';
  if (/低估/.test(text)) return 'low';
  if (/高估/.test(text)) return 'high';
  if (/正常|合理/.test(text)) return 'normal';
  return 'normal';
}

function mapItem(item) {
  if (!item || typeof item !== 'object') return null;
  const pe = toNum(item.pe);
  const pb = toNum(item.pb);
  // 过滤 pe、pb 都缺失/非正的条目
  if ((pe === null || pe <= 0) && (pb === null || pb <= 0)) return null;
  const code = String(item.index_code || item.code || '').trim();
  if (!code) return null;
  const evaType = normalizeEvaType(item.eva_type || item.evaType);
  return {
    code,
    name: String(item.name || code).trim(),
    evaType,
    evaTypeText: EVA_TEXT[evaType] || '',
    pe,
    pb,
    pePercentile: toPercent100(item.pe_percentile),
    pbPercentile: toPercent100(item.pb_percentile),
    roe: toNum(item.roe),
    yeild: toNum(item.yeild),
  };
}

async function fetchValuation() {
  let lastError = null;
  for (const url of VALUATION_URLS) {
    let text;
    try {
      // 蛋卷接口对 UA / Referer 敏感，尽量模拟浏览器请求
      text = await getText(url, {
        encoding: 'utf8',
        timeout: 15000,
        retries: 2,
        headers: {
          Referer: 'https://danjuanfunds.com/',
          Origin: 'https://danjuanfunds.com',
          Accept: 'application/json, text/plain, */*',
        },
      });
    } catch (err) {
      lastError = err;
      continue;
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      lastError = new Error('指数估值响应解析失败');
      continue;
    }

    const payload = json && (json.data || json.Data) ? json.data || json.Data : json;
    const rawItems = Array.isArray(payload && payload.items)
      ? payload.items
      : Array.isArray(payload && payload.list)
        ? payload.list
        : Array.isArray(payload)
          ? payload
          : [];
    if (!rawItems.length) {
      lastError = new Error('指数估值接口无有效数据');
      continue;
    }

    // 数据日期：取 items 里最大的 ts（上游是数据日 00:00 UTC+8 的时间戳）
    let dataTs = null;
    for (const item of rawItems) {
      const ts = toNum(item && item.ts);
      if (Number.isFinite(ts) && (dataTs === null || ts > dataTs)) dataTs = ts;
    }

    const items = rawItems.map(mapItem).filter(Boolean);
    if (!items.length) {
      lastError = new Error('指数估值接口无有效数据');
      continue;
    }
    return { updatedAt: dataTs || Date.now(), items };
  }
  throw lastError || new Error('指数估值获取失败');
}

async function getIndexValuation() {
  const key = 'index-valuation';
  const now = Date.now();
  const entry = store.get(key);

  if (entry && entry.value) {
    if (entry.failAt && now - entry.failAt < 60000) {
      return { ok: true, updatedAt: entry.value.updatedAt, items: entry.value.items, source: 'cache' };
    }
    if (now - entry.at <= TTL_MS) {
      return { ok: true, updatedAt: entry.value.updatedAt, items: entry.value.items, source: 'live' };
    }
  }
  if (inflight.has(key)) return inflight.get(key);

  const task = (async () => {
    try {
      const value = await fetchValuation();
      store.delete(key);
      store.set(key, { value, at: Date.now() });
      return { ok: true, updatedAt: value.updatedAt, items: value.items, source: 'live' };
    } catch (err) {
      const stale = store.get(key);
      if (stale && stale.value) {
        stale.failAt = Date.now();
        return { ok: true, updatedAt: stale.value.updatedAt, items: stale.value.items, source: 'cache' };
      }
      return {
        ok: false,
        updatedAt: null,
        items: [],
        error: err && err.message ? err.message : '指数估值获取失败',
      };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

module.exports = { getIndexValuation, TTL_MS, _normalizeEvaType: normalizeEvaType, _toPercent100: toPercent100 };
