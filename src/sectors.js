'use strict';

/**
 * 板块恐贪（工具箱）：用各板块 ETF / 指数作为代理，计算单资产恐贪指数
 *
 * 算法：52 周区间位置 50% + 20 日动量 25% + 距 52 周高点回撤 25%
 * 20 日动量来自腾讯日线 kline（web.ifzq.gtimg.cn），失败时退化为当日涨跌幅 ±3% 映射。
 * 行业整体（key=hangye）：上涨行业占比 40% + 平均涨幅 30% + 强势行业占比 30%。
 */

const { getText } = require('./http');
const { fetchOne } = require('./tencent');
const { createCache, toNum, round } = require('./fund');
const { levelOf } = require('./fearGreed');
const market = require('./market');

const cache = createCache(60);

const KLINE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=';
const TTL = {
  kline: 10 * 60 * 1000,
  asset: 60 * 1000,
};

const HANGYE_KEY = 'hangye';

const ASSETS = {
  jingong: { code: 'sh512660', name: '军工ETF', proxy: '军工ETF国泰 · 军工板块代理' },
  quanshang: { code: 'sh512000', name: '券商ETF', proxy: '券商ETF华宝 · 券商板块代理' },
  newenergy: { code: 'sh515030', name: '新能源车ETF', proxy: '新能源车ETF华夏 · 新能源车板块代理' },
  guangfu: { code: 'sh515790', name: '光伏ETF', proxy: '光伏ETF华泰柏瑞 · 光伏板块代理' },
  dianchi: { code: 'sz159755', name: '电池ETF', proxy: '电池ETF广发 · 电池板块代理' },
  chuang50: { code: 'sz159949', name: '创业板50ETF', proxy: '创业板50ETF华安 · 成长风格代理' },
  us: { code: 'usIXIC', name: '纳斯达克指数', proxy: '纳斯达克综合指数 · 美股科技情绪代理' },
  a500: { code: 'sh512050', name: '中证A500ETF', proxy: 'A500ETF华夏 · 中证A500 代理' },
  ai: { code: 'sh515070', name: '人工智能ETF', proxy: '人工智能ETF华夏 · AI 板块代理' },
  gold: { code: 'sh518880', name: '黄金ETF', proxy: '黄金ETF华安 · 黄金情绪代理' },
  gushou: { code: 'sh511010', name: '国债ETF', proxy: '国债ETF国泰 · 固收+情绪代理' },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function positionInRange(price, low, high) {
  if (!Number.isFinite(price) || !Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (!(high > low)) return null;
  return clamp((price - low) / (high - low), 0, 1);
}

/** 近 20 个交易日涨跌幅（%）；失败返回 null */
async function getMomentum20(code) {
  try {
    const cached = await cache.wrap('kline20:' + code, TTL.kline, async () => {
      const text = await getText(KLINE_URL + code + ',day,,,30,qfq', {
        encoding: 'utf8',
        timeout: 10000,
        retries: 2,
        headers: { Referer: 'https://gu.qq.com/' },
      });
      let json;
      try {
        json = JSON.parse(text);
      } catch (err) {
        throw new Error('日线数据解析失败');
      }
      const node = json && json.data && json.data[code];
      const rows = node ? node.qfqday || node.day : null;
      if (!Array.isArray(rows) || rows.length < 2) throw new Error('日线数据缺失');
      const closes = rows
        .map((row) => toNum(row && row[2]))
        .filter((value) => value !== null && value > 0);
      if (closes.length < 2) throw new Error('日线收盘价缺失');
      const baseIndex = Math.max(0, closes.length - 21);
      const base = closes[baseIndex];
      if (!(base > 0)) throw new Error('日线基准价异常');
      return round((closes[closes.length - 1] / base - 1) * 100, 2);
    });
    return cached.value;
  } catch (err) {
    return null;
  }
}

function buildAssetFear(key, def, quote, momentum) {
  const price = toNum(quote.price);
  const high52w = toNum(quote.high52w);
  const low52w = toNum(quote.low52w);
  const dayPct = toNum(quote.changePct);

  const position = positionInRange(price, low52w, high52w);
  const trendValue = position === null ? 50 : round(position * 100, 1);

  let momentumValue;
  let momentumDesc;
  if (momentum !== null && Number.isFinite(momentum)) {
    momentumValue = round(clamp(50 + (momentum / 10) * 50, 0, 100), 1);
    momentumDesc = '近20交易日涨跌幅 ' + momentum + '%（±10% 映射 0-100）';
  } else {
    const day = dayPct === null ? 0 : dayPct;
    momentumValue = round(clamp(50 + (day / 3) * 50, 0, 100), 1);
    momentumDesc = '日线数据缺失，退化为当日涨跌幅 ' + (dayPct === null ? '—' : dayPct + '%') + '（±3% 映射 0-100）';
  }

  const drawdown = high52w > 0 && Number.isFinite(price) ? price / high52w - 1 : null;
  const drawdownValue = drawdown === null ? 50 : round(clamp(100 + (drawdown / 0.3) * 100, 0, 100), 1);

  const value = Math.round(clamp(trendValue * 0.5 + momentumValue * 0.25 + drawdownValue * 0.25, 0, 100));
  const band = levelOf(value);

  return {
    key,
    name: def.name,
    value,
    level: band.level,
    color: band.color,
    factors: [
      {
        key: 'trend',
        label: '52周区间位置',
        value: trendValue,
        weight: 0.5,
        desc:
          position === null
            ? '52 周高低数据缺失，按中性 50 处理'
            : '现价处于 52 周区间的 ' + trendValue + '% 位置',
      },
      {
        key: 'momentum',
        label: '20日动量',
        value: momentumValue,
        weight: 0.25,
        desc: momentumDesc,
      },
      {
        key: 'drawdown',
        label: '距52周高点回撤',
        value: drawdownValue,
        weight: 0.25,
        desc:
          drawdown === null
            ? '52 周高点数据缺失，按中性 50 处理'
            : '距 52 周高点回撤 ' + Math.abs(round(drawdown * 100, 2)) + '%（回撤越小分越高）',
      },
    ],
    quote: {
      name: quote.name || def.name,
      code: quote.code || def.code,
      price,
      change: toNum(quote.change),
      changePct: dayPct,
      high52w,
      low52w,
    },
    proxy: def.proxy,
    updatedAt: Date.now(),
  };
}

async function buildIndustryFear() {
  const industries = await market.getIndustries(500);
  const total = (industries.up || 0) + (industries.down || 0) + (industries.flat || 0);
  const upRatio = total ? round((industries.up / total) * 100, 1) : 50;
  const avgPct = industries.avgPct;
  const avgScore = avgPct === null ? 50 : round(clamp(50 + (avgPct / 3) * 50, 0, 100), 1);
  const strongScore = industries.strongRatio === null ? 50 : round(clamp(industries.strongRatio, 0, 100), 1);

  const value = Math.round(clamp(upRatio * 0.4 + avgScore * 0.3 + strongScore * 0.3, 0, 100));
  const band = levelOf(value);

  return {
    key: HANGYE_KEY,
    name: '行业板块',
    value,
    level: band.level,
    color: band.color,
    factors: [
      {
        key: 'breadth',
        label: '上涨行业占比',
        value: upRatio,
        weight: 0.4,
        desc: industries.up + ' 涨 / ' + industries.down + ' 跌 / ' + industries.flat + ' 平（共 ' + total + ' 个行业板块）',
      },
      {
        key: 'avg',
        label: '平均涨幅',
        value: avgScore,
        weight: 0.3,
        desc: '行业平均涨跌幅 ' + (avgPct === null ? '—' : avgPct + '%') + '（±3% 映射 0-100）',
      },
      {
        key: 'strong',
        label: '强势行业占比',
        value: strongScore,
        weight: 0.3,
        desc: '涨幅 ≥2% 的强势行业占比 ' + (industries.strongRatio === null ? '—' : industries.strongRatio + '%'),
      },
    ],
    quote: {
      name: 'A股行业板块',
      code: 'industry',
      price: null,
      change: avgPct,
      changePct: avgPct,
      high52w: null,
      low52w: null,
    },
    proxy: '全行业板块聚合（约 496 个板块）',
    updatedAt: Date.now(),
  };
}

async function getAssetFear(key) {
  const assetKey = String(key === null || key === undefined ? '' : key).trim();
  if (!assetKey) throw new Error('缺少 key 参数');

  const cached = await cache.wrap('asset-fear:' + assetKey, TTL.asset, async () => {
    if (assetKey === HANGYE_KEY) return buildIndustryFear();
    const def = ASSETS[assetKey];
    if (!def) throw new Error('未知的板块 key：' + assetKey + '（可选：' + Object.keys(ASSETS).join('/') + '/hangye）');
    const [quote, momentum] = await Promise.all([fetchOne(def.code), getMomentum20(def.code)]);
    if (!quote || quote.price === null) throw new Error(def.name + ' 行情获取失败');
    return buildAssetFear(assetKey, def, quote, momentum);
  });

  return { ok: true, ...cached.value, source: cached.source };
}

module.exports = { ASSETS, HANGYE_KEY, TTL, getAssetFear, _buildAssetFear: buildAssetFear };
