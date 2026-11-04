'use strict';

/**
 * 数据编排：
 *   抓取腾讯行情 → 合成恐贪指数 → 组装快照 → 落盘缓存
 * 失败链路：实时抓取失败 → data/snapshot.json 缓存 → 内置演示数据（source 标注）
 */

const config = require('./config');
const { readSnapshot, writeSnapshot } = require('./snapshot');
const { fetchQuotes, normalizeCode, unitOf } = require('./tencent');
const { computeFearGreed, levelOf } = require('./fearGreed');
const { fetchCommodities } = require('./commodities');
const { getNextRefreshAt } = require('./scheduler');
const { recordSnapshot } = require('./fearHistory');

let current = null;
let inFlight = null;

function pad2(num) {
  return String(num).padStart(2, '0');
}

function round(num, digits = 2) {
  if (!Number.isFinite(num)) return null;
  const base = 10 ** digits;
  return Math.round(num * base) / base;
}

// ---------- 内置演示数据（最后兜底，保证页面永远可渲染） ----------
// 列：[code, name, price, prevClose, open, high, low, high52w, low52w]
const DEMO_ROWS = [
  ['sh000001', '上证指数', 3421.56, 3409.22, 3412.3, 3430.18, 3402.31, 3674.4, 2635.09],
  ['sz399001', '深证成指', 10876.34, 10812.55, 10830.1, 10912.4, 10801.22, 11689.3, 7908.52],
  ['sz399006', '创业板指', 2234.17, 2210.66, 2211.5, 2245.6, 2205.1, 2576.9, 1512.17],
  ['sh000300', '沪深300', 3987.62, 3972.15, 3975.4, 3995.8, 3960.2, 4268.31, 3144.3],
  ['sh600519', '贵州茅台', 1523.4, 1508.0, 1510.2, 1530.5, 1502.1, 1888.0, 1245.83],
  ['sz000001', '平安银行', 11.28, 11.15, 11.16, 11.35, 11.1, 13.48, 8.96],
  ['sz300750', '宁德时代', 258.6, 252.3, 253.0, 261.2, 251.4, 301.5, 142.3],
  ['sh601318', '中国平安', 52.34, 51.88, 51.9, 52.8, 51.6, 61.2, 38.45],
  ['sh600036', '招商银行', 38.92, 38.45, 38.5, 39.1, 38.3, 43.6, 29.8],
  ['sz002594', '比亚迪', 285.7, 279.9, 280.5, 288.4, 278.6, 332.8, 196.5],
  ['sz000858', '五粮液', 138.66, 137.2, 137.4, 139.8, 136.5, 179.6, 112.3],
  ['sh601899', '紫金矿业', 18.34, 18.02, 18.05, 18.52, 17.95, 20.8, 10.65],
  ['usDJI', '道琼斯', 42114.5, 41938.16, 42010.2, 42230.6, 41880.3, 45073.63, 32327.2],
  ['usIXIC', '纳斯达克', 18432.2, 18350.1, 18380.4, 18510.3, 18300.8, 19175.6, 14052.3],
  ['usINX', '标普500', 5842.3, 5815.2, 5820.1, 5860.4, 5800.6, 6017.5, 4450.2],
  ['usAAPL', '苹果', 228.52, 226.8, 227.1, 229.8, 226.1, 260.1, 164.08],
  ['usNVDA', '英伟达', 138.25, 136.9, 137.2, 140.1, 136.4, 153.13, 75.61],
  ['usTSLA', '特斯拉', 248.98, 251.4, 251.0, 253.2, 247.3, 488.54, 138.8],
  ['hkHSI', '恒生指数', 20432.18, 20318.66, 20360.1, 20510.4, 20305.2, 23241.6, 14794.16],
  ['hk00700', '腾讯控股', 412.6, 408.2, 409.0, 415.8, 407.2, 482.4, 268.3],
  ['hk09988', '阿里巴巴', 82.35, 81.1, 81.3, 83.2, 80.9, 122.0, 58.1],
  ['hk03690', '美团', 168.4, 166.9, 167.2, 170.1, 166.2, 217.0, 95.3],
];

function buildDemoQuotes() {
  return DEMO_ROWS.map((row) => {
    const [code, name, price, prevClose, open, high, low, high52w, low52w] = row;
    const market = /^us/i.test(code) ? 'us' : /^hk/i.test(code) ? 'hk' : 'a';
    return {
      name,
      code,
      market,
      price: round(price),
      change: round(price - prevClose, 3),
      changePct: round(((price - prevClose) / prevClose) * 100, 2),
      open: round(open),
      prevClose: round(prevClose),
      high: round(high),
      low: round(low),
      high52w: round(high52w),
      low52w: round(low52w),
      unit: unitOf(code, market),
    };
  });
}

// ---------- 快照组装 ----------

function buildSections(quotes) {
  const byCode = new Map(quotes.map((quote) => [quote.code, quote]));
  return config.SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    items: section.codes.map((code) => byCode.get(code)).filter(Boolean),
  }));
}

function buildChips(quotes) {
  const byCode = new Map(quotes.map((quote) => [quote.code, quote]));
  const chips = [];
  for (const code of config.CHIPS) {
    const quote = byCode.get(code);
    if (!quote) continue;
    chips.push({
      name: quote.name,
      code: quote.code,
      price: quote.price,
      change: quote.change,
      changePct: quote.changePct,
    });
  }
  // 配置的指数全失败时，退化为前 4 个已抓到的标的，保证速览区不空
  if (!chips.length) {
    for (const quote of quotes.slice(0, 4)) {
      chips.push({
        name: quote.name,
        code: quote.code,
        price: quote.price,
        change: quote.change,
        changePct: quote.changePct,
      });
    }
  }
  return chips;
}

function normalizeCommodities(input) {
  if (input && typeof input === 'object' && Array.isArray(input.items)) {
    return {
      available: Boolean(input.available),
      items: input.items,
      note: typeof input.note === 'string' ? input.note : '',
    };
  }
  return { available: false, items: [], note: '商品数据未接入' };
}

function buildCommoditySection(commodities) {
  if (!commodities || !commodities.available || !Array.isArray(commodities.items) || !commodities.items.length) {
    return null;
  }
  return {
    id: 'commodity',
    title: '商品市场',
    commodity: true,
    items: commodities.items.map((item) => ({
      name: item.name,
      code: String(item.code || ''),
      price: item.price,
      change: item.change,
      changePct: item.changePct,
      unit: item.unit || '',
      market: 'commodity',
    })),
  };
}

function buildSnapshot(quotes, failures, fetchedAt, commodities, source) {
  const effectiveSource = source || 'live';
  const sections = buildSections(quotes);
  const commoditySection = buildCommoditySection(commodities);
  if (commoditySection) sections.push(commoditySection);
  const chips = buildChips(quotes);
  const aSection = sections.find((section) => section.id === 'a');
  const aQuotes = aSection ? aSection.items : [];
  const fearGreed = computeFearGreed({ aQuotes, updatedAt: fetchedAt });
  const total = config.SECTIONS.reduce((sum, section) => sum + section.codes.length, 0);

  const notes = [];
  if (effectiveSource === 'demo') {
    notes.push('行情服务暂不可达，当前展示内置演示数据');
  } else {
    notes.push('行情来源：腾讯财经 qt.gtimg.cn，成功 ' + quotes.length + '/' + total + ' 个标的');
  }
  if (failures && failures.length) {
    const failedCodes = failures.slice(0, 6).map((item) => item.code).join('、');
    notes.push('抓取失败：' + failedCodes + (failures.length > 6 ? ' 等' : ''));
  }
  notes.push('恐贪指数 = 股价强度 40% + 市场广度 35% + 动能 25%');
  if (commodities && commodities.available && Array.isArray(commodities.items) && commodities.items.length) {
    notes.push('商品行情：' + commodities.items.map((item) => item.name).join('、'));
  } else {
    notes.push('商品行情接口暂不可达，已优雅降级');
  }
  notes.push(
    '每日 ' + pad2(config.REFRESH_HOUR) + ':' + pad2(config.REFRESH_MINUTE) + ' 自动抓取，页面每 60 秒轮询'
  );

  return {
    ok: true,
    updatedAt: fetchedAt,
    nextRefreshAt: getNextRefreshAt(),
    fearGreed,
    chips,
    sections,
    commodities: normalizeCommodities(commodities),
    notes,
    source: effectiveSource,
  };
}

function normalizeFearGreed(input, updatedAt) {
  if (input && Number.isFinite(input.value) && Array.isArray(input.factors)) {
    const band = levelOf(input.value);
    return {
      value: input.value,
      level: typeof input.level === 'string' && input.level ? input.level : band.level,
      color: typeof input.color === 'string' && input.color ? input.color : band.color,
      factors: input.factors,
      updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : updatedAt,
    };
  }
  return computeFearGreed({ aQuotes: [], updatedAt });
}

/** 统一补齐契约字段（缓存回退 / 演示数据都走这里） */
function normalizeSnapshot(input, source) {
  const now = Date.now();
  const base = input && typeof input === 'object' ? input : {};
  const updatedAt = Number.isFinite(base.updatedAt) ? base.updatedAt : now;
  return {
    ok: true,
    updatedAt,
    nextRefreshAt: getNextRefreshAt(),
    fearGreed: normalizeFearGreed(base.fearGreed, updatedAt),
    chips: Array.isArray(base.chips) ? base.chips : [],
    sections: Array.isArray(base.sections) ? base.sections : [],
    commodities: normalizeCommodities(base.commodities),
    notes: Array.isArray(base.notes) ? base.notes : [],
    source: source || base.source || 'cache',
  };
}

/** 每次对外输出都重算 nextRefreshAt，避免长时间运行后时间戳过期 */
function present(snapshot) {
  if (!snapshot) return null;
  return { ...snapshot, nextRefreshAt: getNextRefreshAt() };
}

function buildDemoSnapshot() {
  const fetchedAt = Date.now();
  const quotes = buildDemoQuotes();
  const commodities = {
    available: false,
    items: [],
    note: '演示数据：商品行情未接入（沙箱网络限制）',
  };
  const snapshot = buildSnapshot(quotes, [], fetchedAt, commodities, 'demo');
  snapshot.notes.unshift('⚠️ 行情服务暂不可达，已回退内置演示数据（source=demo）');
  return snapshot;
}

// ---------- 对外 API ----------

/** 启动预热：优先读磁盘缓存，保证首个请求不用等抓取 */
function warmCache() {
  if (current) return current;
  const cached = readSnapshot();
  if (cached) {
    current = normalizeSnapshot(cached, 'cache');
    console.log('[collect] 已加载本地快照缓存：', new Date(current.updatedAt).toLocaleString('zh-CN', { hour12: false }));
    // 恐贪历史：启动预热时用缓存快照补当日记录（同一天覆盖）
    recordSnapshot(current);
  }
  return current;
}

/** 立即抓取并刷新快照（并发请求会复用同一次抓取） */
async function refresh() {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const fetchedAt = Date.now();
    const codes = config.SECTIONS.flatMap((section) => section.codes);
    let quotes = [];
    let failures = [];

    try {
      const result = await fetchQuotes(codes);
      quotes = result.quotes;
      failures = result.failures;
    } catch (err) {
      console.error('[collect] 行情抓取整体失败：', err && err.message ? err.message : err);
      failures = codes.map((code) => ({
        code,
        error: err && err.message ? err.message : 'unknown',
      }));
    }

    let commodities;
    try {
      commodities = await fetchCommodities();
    } catch (err) {
      commodities = {
        available: false,
        items: [],
        note: '商品数据获取失败：' + (err && err.message ? err.message : '网络异常'),
      };
    }

    if (!quotes.length) {
      const cached = readSnapshot();
      if (cached) {
        console.warn('[collect] 全部标的抓取失败，回退 data/snapshot.json 缓存');
        const normalized = normalizeSnapshot(cached, 'cache');
        normalized.notes = [...normalized.notes, '本次实时抓取失败，当前展示上次缓存数据'];
        current = normalized;
        recordSnapshot(current);
        return present(current);
      }
      console.warn('[collect] 无缓存可回退，使用内置演示数据');
      current = buildDemoSnapshot();
      return present(current);
    }

    const snapshot = buildSnapshot(quotes, failures, fetchedAt, commodities, 'live');
    current = snapshot;
    writeSnapshot(snapshot);
    // 恐贪历史：实时快照成功后追加/覆盖当日记录
    recordSnapshot(snapshot);
    console.log(
      '[collect] 抓取完成：' +
        quotes.length +
        '/' +
        codes.length +
        ' 个标的，恐贪指数 ' +
        snapshot.fearGreed.value +
        '（' +
        snapshot.fearGreed.level +
        '）'
    );
    return present(snapshot);
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * 读取最新快照：内存 → 磁盘缓存 → 现场抓取（最多等 5 秒）→ 演示数据。
 * 永不抛错、永不长时间挂起：抓取超时时先返回演示数据，后台抓取完成后供下一次轮询使用。
 */
const FIRST_LOAD_WAIT_MS = 5000;

async function getSnapshot() {
  if (current) return present(current);

  const cached = readSnapshot();
  if (cached) {
    current = normalizeSnapshot(cached, 'cache');
    recordSnapshot(current);
    return present(current);
  }

  try {
    const refreshed = await Promise.race([
      refresh(),
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), FIRST_LOAD_WAIT_MS);
        if (timer.unref) timer.unref();
      }),
    ]);
    if (refreshed) return present(refreshed);
    console.warn('[collect] 首次抓取超过 ' + FIRST_LOAD_WAIT_MS + 'ms，先返回演示数据，后台继续抓取');
    return present(buildDemoSnapshot());
  } catch (err) {
    console.error('[collect] 获取快照失败，回退演示数据：', err && err.message ? err.message : err);
    return present(buildDemoSnapshot());
  }
}

/** 对外兜底快照（/api/snapshot 的最后一层保险），不覆盖当前内存快照 */
function fallbackSnapshot() {
  return present(buildDemoSnapshot());
}

/**
 * 查询任意代码行情（智能归一化）。
 * @param {string[]} rawCodes
 */
async function getQuotes(rawCodes) {
  const list = Array.isArray(rawCodes) ? rawCodes : [];
  const codes = [];
  for (const raw of list) {
    const code = normalizeCode(raw);
    if (code && !codes.includes(code)) codes.push(code);
  }
  const limited = codes.slice(0, config.MAX_QUOTE_CODES);

  if (!limited.length) {
    return {
      ok: false,
      quotes: [],
      failed: [],
      error: '缺少或无法识别 codes 参数，例：/api/quote?codes=600519,AAPL,700',
    };
  }

  try {
    const result = await fetchQuotes(limited);
    return {
      ok: result.quotes.length > 0,
      quotes: result.quotes,
      failed: result.failures.map((item) => item.code),
    };
  } catch (err) {
    return {
      ok: false,
      quotes: [],
      failed: limited,
      error: err && err.message ? err.message : '行情抓取失败',
    };
  }
}

/** 健康检查 / 调试用状态 */
function getState() {
  const snapshot = current || null;
  return {
    loaded: Boolean(snapshot),
    source: snapshot ? snapshot.source : 'none',
    updatedAt: snapshot ? snapshot.updatedAt : null,
    nextRefreshAt: getNextRefreshAt(),
    fearGreed: snapshot ? { value: snapshot.fearGreed.value, level: snapshot.fearGreed.level } : null,
  };
}

module.exports = {
  warmCache,
  refresh,
  getSnapshot,
  fallbackSnapshot,
  getQuotes,
  getState,
  buildDemoSnapshot,
  buildSnapshot,
  buildSections,
  buildChips,
};
