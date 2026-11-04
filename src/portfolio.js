'use strict';

/**
 * 组合回测引擎（基金 + 股票混合，支持 20 年 / 半年·年再平衡 / 基准 / 回撤 / 盈亏 / 今日估值）
 *
 * GET /api/portfolio/backtest
 *   codes=110022,600519,AAPL  基金代码或股票代码（逗号分隔，最多 8 个）
 *   types=fund,stock,stock    与 codes 一一对应；缺省全 fund
 *   weights=50,30,20          权重（百分比或比例，服务端归一）
 *   years=1..20               默认 3（若传 start 则忽略）
 *   start=YYYY-MM-DD          指定起始日期（早于数据起点自动截断）
 *   capital=100000            初始资金
 *   rebalance=monthly|quarterly|halfyearly|yearly|none（默认 quarterly）
 *
 * 数据：基金用 fund.getFundInternal().navSeries；股票用东财后复权日线（fqt=2）；
 *       基准为沪深300（secid=1.000300，后复权）。
 *
 * 向后兼容：不传新参数时行为与原组合回测一致（curve 仍是净值倍数，metrics 旧字段含义不变）。
 */

const { getFundInternal, createCache, toNum, round, downsample } = require('./fund');
const stocks = require('./stocks');

const cache = createCache(60);
const TTL = 5 * 60 * 1000;
const YEAR_MS = 365 * 86400000;
const MAX_ASSETS = 8;
const DEFAULT_CAPITAL = 100000;
const BENCHMARK_SECID = '1.000300';
const BENCHMARK_NAME = '沪深300';
const REBALANCE_MODES = ['monthly', 'quarterly', 'halfyearly', 'yearly', 'none'];
const REBALANCE_LABEL = {
  monthly: '每月首个交易日再平衡',
  quarterly: '每季度首个交易日再平衡',
  halfyearly: '每半年（1/7 月）首个交易日再平衡',
  yearly: '每年（1 月）首个交易日再平衡',
  none: '不做再平衡',
};

function num(value) {
  return toNum(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatDate(ts) {
  const date = new Date(Number(ts));
  if (!Number.isFinite(date.getTime())) return null;
  const p = (x) => String(x).padStart(2, '0');
  return date.getFullYear() + '-' + p(date.getMonth() + 1) + '-' + p(date.getDate());
}

/** 'YYYY-MM-DD' → 本地零点时间戳 */
function parseStartDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
  if (!match) return null;
  const ts = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/**
 * 再平衡周期 key：
 *   monthly/yearly 看自然月/年；quarterly 按季；halfyearly 仅在 1 月与 7 月切分
 */
function periodKey(ts, mode) {
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = date.getMonth();
  if (mode === 'monthly') return year * 100 + month;
  if (mode === 'quarterly') return year * 10 + Math.floor(month / 3);
  if (mode === 'halfyearly') return year * 10 + (month < 6 ? 0 : 1);
  if (mode === 'yearly') return year;
  return null;
}

function parseWeights(raw, count) {
  let list = String(raw === null || raw === undefined ? '' : raw)
    .split(/[,，;；\s]+/)
    .filter(Boolean)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (list.length !== count) list = new Array(count).fill(1);
  let sum = list.reduce((total, value) => total + value, 0);
  if (!(sum > 0)) {
    list = new Array(count).fill(1);
    sum = count;
  }
  return list.map((value) => value / sum);
}

// ---------------- 资产加载 ----------------

async function loadAsset(code, type) {
  if (type === 'stock') {
    const series = await stocks.getStockSeries(code);
    return {
      type: 'stock',
      code: series.code,
      name: series.name,
      secid: series.secid,
      historyType: 'kline',
      points: series.points,
      dayPct: null,
    };
  }

  const detail = await getFundInternal(code);
  const fund = detail && detail.value;
  if (!fund || !Array.isArray(fund.navSeries) || fund.navSeries.length < 2) {
    throw new Error('基金历史净值不足：' + code);
  }
  return {
    type: 'fund',
    code: fund.code || code,
    name: fund.name || code,
    secid: null,
    historyType: 'nav',
    points: fund.navSeries.map((point) => ({ t: point.t, nav: point.nav })),
    dayPct: num(fund.dayPct),
  };
}

async function loadBenchmark() {
  try {
    const kline = await stocks.getKline(BENCHMARK_SECID);
    return { name: kline.name || BENCHMARK_NAME, points: kline.points };
  } catch (err) {
    return null;
  }
}

// ---------------- 今日涨跌估算 ----------------

async function buildToday(assets, weights) {
  const rows = await Promise.all(
    assets.map(async (asset) => {
      let changePct = null;
      if (asset.type === 'fund') {
        changePct = num(asset.dayPct);
      } else {
        const quote = await stocks.getStockQuote(asset.secid, asset.name);
        changePct = quote ? num(quote.changePct) : null;
        if (changePct === null) changePct = stocks.lastBarPct(asset.points);
      }
      return {
        code: asset.code,
        name: asset.name,
        type: asset.type,
        changePct: changePct === null ? null : round(changePct, 2),
      };
    })
  );

  let benchmarkPct = null;
  const benchQuote = await stocks.getStockQuote(BENCHMARK_SECID, BENCHMARK_NAME);
  if (benchQuote) benchmarkPct = num(benchQuote.changePct);
  if (benchmarkPct === null) {
    try {
      const benchKline = await stocks.getKline(BENCHMARK_SECID);
      benchmarkPct = stocks.lastBarPct(benchKline.points);
    } catch (err) {
      benchmarkPct = null;
    }
  }

  // 加权估算：只对「有今日涨跌数据」的资产重新归一权重
  let availableWeight = 0;
  let weightedSum = 0;
  rows.forEach((row, index) => {
    if (row.changePct === null) return;
    availableWeight += weights[index];
    weightedSum += weights[index] * row.changePct;
  });
  const portfolioPct = availableWeight > 0 ? round(weightedSum / availableWeight, 2) : null;

  return {
    portfolioPct,
    benchmarkPct: benchmarkPct === null ? null : round(benchmarkPct, 2),
    items: rows.map((row, index) => ({
      code: row.code,
      name: row.name,
      type: row.type,
      weight: round(weights[index] * 100, 2),
      changePct: row.changePct,
    })),
  };
}

// ---------------- 回撤序列 ----------------

function drawdownSeries(series) {
  let peak = null;
  const out = [];
  for (const point of series) {
    if (peak === null || point.v > peak) peak = point.v;
    out.push({ t: point.t, v: round((point.v / peak - 1) * 100, 2) });
  }
  return out;
}

function maxDrawdownOf(series) {
  let maxDrawdown = 0;
  for (const point of series) {
    if (point.v < maxDrawdown) maxDrawdown = point.v;
  }
  return round(maxDrawdown, 2);
}

// ---------------- 主流程 ----------------

async function portfolioBacktest(params) {
  const input = params || {};

  const codes = String(Array.isArray(input.codes) ? input.codes.join(',') : input.codes || '')
    .split(/[,，;；\s]+/)
    .map((value) => String(value).trim())
    .filter(Boolean)
    .slice(0, MAX_ASSETS);
  if (!codes.length) throw new Error('缺少有效的资产代码');

  let types = String(Array.isArray(input.types) ? input.types.join(',') : input.types || '')
    .split(/[,，;；\s]+/)
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
  if (types.length !== codes.length) types = codes.map(() => 'fund');
  types = types.map((type) => (type === 'stock' ? 'stock' : 'fund'));

  const weights = parseWeights(input.weights, codes.length);
  const years = clamp(Number.parseInt(input.years, 10) || 3, 1, 20);
  const startDateTs = parseStartDate(input.start);
  const capital = clamp(num(input.capital) || DEFAULT_CAPITAL, 1, 1e12);
  const rebalance =
    REBALANCE_MODES.indexOf(String(input.rebalance || 'quarterly')) >= 0
      ? String(input.rebalance || 'quarterly')
      : 'quarterly';

  const cacheKey = [
    'portfolio-v2',
    codes.join(','),
    types.join(','),
    weights.map((value) => round(value, 4)).join(','),
    startDateTs !== null ? 'start:' + startDateTs : 'years:' + years,
    rebalance,
    capital,
  ].join('|');

  const cached = await cache.wrap(cacheKey, TTL, async () => {
    // 1) 读取资产序列 + 基准（并行）
    const [assets, benchmark] = await Promise.all([
      Promise.all(
        codes.map(async (code, index) => {
          try {
            return await loadAsset(code, types[index]);
          } catch (err) {
            throw new Error('资产「' + code + '」数据获取失败：' + (err && err.message ? err.message : err));
          }
        })
      ),
      loadBenchmark(),
    ]);

    for (const asset of assets) {
      if (!asset.points || asset.points.length < 2) throw new Error('资产「' + asset.code + '」历史数据不足');
    }

    // 2) 共同区间：结束取各资产最后日期最小值；起点取 start/years 与各资产起点的较大者
    const endTs = Math.min.apply(
      null,
      assets.map((asset) => asset.points[asset.points.length - 1].t)
    );
    const earliestCommon = Math.max.apply(null, assets.map((asset) => asset.points[0].t));

    let startTs = startDateTs !== null ? startDateTs : endTs - years * YEAR_MS;
    let truncated = false;
    if (startTs < earliestCommon) {
      truncated = true;
      startTs = earliestCommon;
    }
    if (!(endTs > startTs)) {
      throw new Error(
        '可用共同历史区间不足（' + formatDate(earliestCommon) + ' ~ ' + formatDate(endTs) + '），请缩短年限或更换资产'
      );
    }

    // 3) 共同交易日时间轴（各资产日期并集）
    const timelineSet = new Set();
    for (const asset of assets) {
      for (const point of asset.points) {
        if (point.t >= startTs && point.t <= endTs) timelineSet.add(point.t);
      }
    }
    const timeline = [...timelineSet].sort((a, b) => a - b);
    if (timeline.length < 2) throw new Error('共同交易日不足，无法回测');

    // 4) 步进净值状态
    const states = assets.map((asset) => ({
      points: asset.points.filter((point) => point.t >= startTs && point.t <= endTs),
      index: -1,
      base: null,
    }));
    function advance(state, ts) {
      while (state.index + 1 < state.points.length && state.points[state.index + 1].t <= ts) state.index += 1;
      return state.index >= 0;
    }

    let firstIndex = -1;
    for (let i = 0; i < timeline.length; i += 1) {
      const ready = states.every((state) => state.points.length > 0 && state.points[0].t <= timeline[i]);
      if (ready) {
        firstIndex = i;
        break;
      }
    }
    if (firstIndex < 0) throw new Error('所选资产没有共同交易日，无法回测');

    for (const state of states) {
      state.index = -1;
      advance(state, timeline[firstIndex]);
      state.base = state.points[state.index].nav;
    }
    const startPoint = timeline[firstIndex];

    // 5) 组合净值曲线（归一化净值起始 = 1，shares 即目标权重）
    let shares = weights.slice();
    let lastRebalanceKey = periodKey(startPoint, rebalance);
    let rebalanceCount = 0;
    const curve = [];

    for (let i = firstIndex; i < timeline.length; i += 1) {
      const ts = timeline[i];
      const normalized = [];
      let ready = true;
      for (const state of states) {
        if (!advance(state, ts)) {
          ready = false;
          break;
        }
        normalized.push(state.points[state.index].nav / state.base);
      }
      if (!ready) continue;

      let value = shares.reduce((sum, share, idx) => sum + share * normalized[idx], 0);
      if (rebalance !== 'none') {
        const key = periodKey(ts, rebalance);
        if (i > firstIndex && key !== lastRebalanceKey) {
          lastRebalanceKey = key;
          rebalanceCount += 1;
          shares = weights.map((weight, idx) =>
            normalized[idx] > 0 ? (weight * value) / normalized[idx] : 0
          );
          value = shares.reduce((sum, share, idx) => sum + share * normalized[idx], 0);
        }
      }
      curve.push({ t: ts, v: round(value, 6) });
    }
    if (curve.length < 2) throw new Error('组合净值曲线为空');

    // 6) 指标
    const returns = [];
    for (let i = 1; i < curve.length; i += 1) {
      const r = curve[i].v / curve[i - 1].v - 1;
      if (Number.isFinite(r) && Math.abs(r) < 1) returns.push(r);
    }
    const totalReturn = round((curve[curve.length - 1].v / curve[0].v - 1) * 100, 2);
    const days = (curve[curve.length - 1].t - curve[0].t) / 86400000;
    const annualized =
      days > 0 ? round((Math.pow(curve[curve.length - 1].v / curve[0].v, 365 / days) - 1) * 100, 2) : null;

    let peak = null;
    let maxDrawdown = 0;
    for (const point of curve) {
      if (peak === null || point.v > peak) peak = point.v;
      const dd = (point.v / peak - 1) * 100;
      if (dd < maxDrawdown) maxDrawdown = dd;
    }

    let volatility = null;
    if (returns.length > 1) {
      const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
      const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
      volatility = round(Math.sqrt(variance) * Math.sqrt(252) * 100, 2);
    }
    const sharpe = volatility ? round((annualized - 1.5) / volatility, 2) : null;

    // 7) 基准（沪深300，后复权）、回撤 / 盈亏序列
    let benchmarkFull = [];
    let benchmarkReturn = null;
    let benchmarkMaxDrawdown = null;
    if (benchmark) {
      const points = benchmark.points.filter((point) => point.t >= startTs && point.t <= endTs);
      if (points.length >= 2) {
        const base = points[0].nav;
        benchmarkFull = points.map((point) => ({ t: point.t, v: round(point.nav / base, 6) }));
        benchmarkReturn = round((benchmarkFull[benchmarkFull.length - 1].v - 1) * 100, 2);
        benchmarkMaxDrawdown = maxDrawdownOf(drawdownSeries(benchmarkFull));
      }
    }

    const drawdownFull = drawdownSeries(curve);
    const pnlFull = curve.map((point) => ({ t: point.t, v: round(capital * (point.v - 1), 2) }));

    // 8) 各资产区间收益 / 金额 / 份额
    const items = assets.map((asset, index) => {
      const state = states[index];
      const lastNav = state.points[state.points.length - 1].nav;
      const baseNav = state.base;
      const ownReturn = baseNav > 0 ? round((lastNav / baseNav - 1) * 100, 2) : null;
      const amount = round(capital * weights[index], 2);
      return {
        code: asset.code,
        name: asset.name,
        type: asset.type,
        weight: round(weights[index] * 100, 2),
        ownReturn,
        historyType: asset.historyType,
        amount,
        shares: baseNav > 0 ? round(amount / baseNav, 4) : null,
        secid: asset.secid,
      };
    });

    // 9) 今日涨跌（基金用净值日涨跌，股票用实时行情；失败用日线最后两根兜底）
    const today = await buildToday(assets, weights);

    // 10) 说明
    const noteParts = [
      '区间 ' + formatDate(startPoint) + ' ~ ' + formatDate(curve[curve.length - 1].t),
      REBALANCE_LABEL[rebalance],
      benchmark ? '基准：沪深300（后复权）' : '基准数据暂不可用',
    ];
    if (truncated) {
      noteParts.push('起始日期早于部分资产数据起点，已自动截断至 ' + formatDate(startTs));
    }
    if (types.indexOf('stock') >= 0) {
      noteParts.push('股票价格使用东方财富后复权日线（fqt=2）');
    }
    noteParts.push('今日涨跌为加权估算（基金取最新净值日涨跌、股票取实时行情，缺失时用日线最后两根兜底）');

    return {
      startDate: formatDate(curve[0].t),
      endDate: formatDate(curve[curve.length - 1].t),
      rebalance,
      capital: round(capital, 2),
      curve: downsample(curve, 240),
      benchmark: downsample(benchmarkFull, 240),
      drawdown: downsample(drawdownFull, 240),
      benchmarkDrawdown: benchmarkFull.length ? downsample(drawdownSeries(benchmarkFull), 240) : [],
      pnl: downsample(pnlFull, 240),
      metrics: {
        totalReturn,
        annualized,
        maxDrawdown: round(maxDrawdown, 2),
        volatility,
        sharpe,
        benchmarkReturn,
        benchmarkMaxDrawdown,
        timeWeightedReturn: totalReturn, // 无外部现金流，单位净值收益即时间加权收益
        periods: rebalanceCount,
      },
      items,
      today,
      note: noteParts.join('；') + '。',
      desc:
        '按权重合成各资产历史净值，' + REBALANCE_LABEL[rebalance] +
        '；指标由组合净值序列计算，历史回测不代表未来收益。',
    };
  });

  // result 内也带 source（契约要求；顶层 source 保留给旧调用方）
  return { ok: true, result: { ...cached.value, source: cached.source }, source: cached.source };
}

module.exports = {
  portfolioBacktest,
  TTL,
  REBALANCE_MODES,
  _parseWeights: parseWeights,
  _periodKey: periodKey,
  _parseStartDate: parseStartDate,
};
