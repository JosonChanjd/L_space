'use strict';

/**
 * 恐贪指数（Fear & Greed Index）本地合成。
 *
 * 方法：三因子加权，输出 0-100：
 *   1. 股价强度 trend    —— A股标的现价在 52 周高低区间中的位置（均值）
 *   2. 市场广度 breadth  —— A股个股监控池上涨家数占比
 *   3. 动能    momentum  —— A股监控池平均涨跌幅（±3% 映射满量程）
 *
 * 0 = 极度恐惧，100 = 极度贪婪；五档情绪文字 + 颜色。
 */

const config = require('./config');
const { isIndex } = require('./tencent');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function avg(list) {
  if (!list.length) return null;
  return list.reduce((sum, item) => sum + item, 0) / list.length;
}

/** 现价在 [low, high] 区间中的相对位置，归一化到 0-1；数据不足返回 null */
function positionInRange(price, low, high) {
  if (!Number.isFinite(price) || !Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (!(high > low)) return null;
  const pos = (price - low) / (high - low);
  if (!Number.isFinite(pos)) return null;
  return clamp(pos, 0, 1);
}

/**
 * 0-100 → 五档情绪文字 + 颜色。
 * 区间按契约取半开区间：[0,20) 极度恐惧 / [20,40) 恐惧 / [40,60) 中性 / [60,80) 贪婪 / [80,100] 极度贪婪，
 * 因此 value=60 归「贪婪」（与前端 app.js 的颜色分段一致）。
 */
function levelOf(value) {
  if (value < 20) return { level: '极度恐惧', color: '#1a9b6c' };
  if (value < 40) return { level: '恐惧', color: '#4fb37c' };
  if (value < 60) return { level: '中性', color: '#8e99a8' };
  if (value < 80) return { level: '贪婪', color: '#f08a24' };
  return { level: '极度贪婪', color: '#e5433b' };
}

/**
 * @param {{ aQuotes?: object[], updatedAt?: number }} input
 * @returns {{ value: number, level: string, color: string, factors: object[], updatedAt: number }}
 */
function computeFearGreed(input = {}) {
  const aQuotes = Array.isArray(input.aQuotes) ? input.aQuotes.filter(Boolean) : [];
  const updatedAt = Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now();
  const weights = config.FEAR_GREED_WEIGHTS;

  // ----- 因子 1：股价强度（52 周区间位置，缺失时回退日内区间） -----
  let positions = [];
  for (const quote of aQuotes) {
    const pos = positionInRange(quote.price, quote.low52w, quote.high52w);
    if (pos !== null) positions.push(pos);
  }
  let trendSource = '52 周区间';
  if (!positions.length) {
    for (const quote of aQuotes) {
      const pos = positionInRange(quote.price, quote.low, quote.high);
      if (pos !== null) positions.push(pos);
    }
    trendSource = '日内区间（52 周数据缺失，已回退）';
  }
  const trendAvg = avg(positions);
  const trendValue = trendAvg === null ? 50 : Math.round(clamp(trendAvg * 100, 0, 100));

  // ----- 因子 2：市场广度（A股个股上涨占比，不含指数） -----
  const stocks = aQuotes.filter(
    (quote) => !isIndex(quote.code) && Number.isFinite(quote.changePct)
  );
  const rising = stocks.filter((quote) => quote.changePct > 0).length;
  const flat = stocks.filter((quote) => quote.changePct === 0).length;
  const falling = stocks.length - rising - flat;
  const breadthValue = stocks.length ? Math.round(clamp((rising / stocks.length) * 100, 0, 100)) : 50;

  // ----- 因子 3：动能（平均涨跌幅 → 0-100，±3% 为满量程） -----
  const pcts = aQuotes.map((quote) => quote.changePct).filter((value) => Number.isFinite(value));
  const avgPct = avg(pcts);
  const momentumValue = avgPct === null ? 50 : Math.round(clamp(50 + (avgPct / 3) * 50, 0, 100));

  // ----- 加权合成 -----
  const weighted =
    trendValue * weights.trend +
    breadthValue * weights.breadth +
    momentumValue * weights.momentum;
  const value = Math.round(clamp(weighted, 0, 100));
  const band = levelOf(value);

  const positionText = trendAvg === null ? '—' : Math.round(trendAvg * 100) + '%';
  const momentumText =
    avgPct === null ? '—' : (avgPct >= 0 ? '+' : '') + avgPct.toFixed(2) + '%';

  const factors = [
    {
      key: 'trend',
      label: '股价强度',
      value: trendValue,
      weight: weights.trend,
      desc: `A股监控池现价位于${trendSource}的平均位置约 ${positionText}`,
    },
    {
      key: 'breadth',
      label: '市场广度',
      value: breadthValue,
      weight: weights.breadth,
      desc: stocks.length
        ? `A股监控池 ${stocks.length} 只标的：${rising} 涨 / ${flat} 平 / ${falling} 跌`
        : 'A股涨跌数据不足，按中性 50 处理',
    },
    {
      key: 'momentum',
      label: '动能',
      value: momentumValue,
      weight: weights.momentum,
      desc:
        avgPct === null
          ? '涨跌幅数据不足，按中性 50 处理'
          : `A股监控池平均涨跌幅 ${momentumText}（±3% 映射 0-100）`,
    },
  ];

  return { value, level: band.level, color: band.color, factors, updatedAt };
}

module.exports = { computeFearGreed, levelOf, positionInRange };
