'use strict';

/**
 * 基金 / 基金经理分析层（工具箱）
 *
 * 端点：/api/fund/similar、/api/fund/diagnose、/api/fund/manager-pick、
 *       /api/manager/score、/api/manager/compare、/api/fund/screen
 *
 * 复用 src/fund.js 的排行缓存（getRankItems）、详情缓存（getDetail/getFundInternal）与工具函数，
 * 不重复打上游。所有指标均为本地计算的经验值，仅供参考。
 */

const {
  getRankItems,
  getDetail,
  getFundInternal,
  createCache,
  toNum,
  round,
  mapLimit,
} = require('./fund');

const TTL = {
  similar: 10 * 60 * 1000,
  diagnose: 10 * 60 * 1000,
  managerPick: 10 * 60 * 1000,
  managerScore: 10 * 60 * 1000,
  screen: 10 * 60 * 1000,
};

const cache = createCache(120);

const RANK_TYPES = ['all', 'gp', 'hh', 'zq', 'zs', 'qdii'];
const SCREEN_SORTS = ['1nzf', '3yzf', '6yzf', 'jnzf'];
const SORT_FIELD = { '1nzf': 'y1', '3yzf': 'y3', '6yzf': 'm6', 'jnzf': 'ytd' };
// 前端把 3yzf 标注为「近3年收益」：候选池优先按东财 3nzf（近3年）排序，失败再退回 3yzf
const UPSTREAM_SORT = { '1nzf': '1nzf', '3yzf': '3nzf', '6yzf': '6yzf', 'jnzf': 'jnzf' };

function num(value) {
  return toNum(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 把详情里的 type 文案映射为排行榜 ft 参数 */
function mapFundType(type) {
  const text = String(type || '');
  if (/QDII/i.test(text)) return 'qdii';
  if (/股票/.test(text)) return 'gp';
  if (/混合/.test(text)) return 'hh';
  if (/债券/.test(text)) return 'zq';
  if (/指数/.test(text)) return 'zs';
  return 'all';
}

/** "6年又123天" / "260天" → 年数 */
function parseWorkYears(text) {
  const source = String(text || '');
  const yearMatch = source.match(/(\d+)\s*年/);
  const dayMatch = source.match(/(\d+)\s*天/);
  if (!yearMatch && !dayMatch) {
    const plain = source.match(/^(\d+(?:\.\d+)?)$/);
    return plain ? round(Number(plain[1]), 1) : null;
  }
  let years = yearMatch ? Number.parseInt(yearMatch[1], 10) : 0;
  if (dayMatch) years += Number.parseInt(dayMatch[1], 10) / 365;
  return round(years, 1);
}

function percentileOf(peers, key, value) {
  if (!Number.isFinite(value)) return null;
  const values = peers.map((item) => num(item[key])).filter((v) => v !== null);
  if (!values.length) return null;
  const below = values.filter((v) => v <= value).length;
  // 返回 0-1 小数：前端 ratioPct 会统一乘 100 展示为「前 X%」
  return round(below / values.length, 4);
}

/** 0-1 分位 → 0-100 文案用 */
function pct100(value) {
  const n = num(value);
  return n === null ? null : round(n * 100, 1);
}

function gradeOf(score) {
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

function adviceOf(grade) {
  if (grade === 'A') return '综合表现优秀，历史业绩与风险控制处于同类前列，可作为核心配置候选（非投资建议）。';
  if (grade === 'B') return '综合表现良好，可作为配置候选，建议持续关注回撤与基金经理变动（非投资建议）。';
  if (grade === 'C') return '综合表现一般，建议与同类基金横向对比后再做决定（非投资建议）。';
  return '综合评分偏低，建议谨慎，优先考虑更稳健的替代品种（非投资建议）。';
}

/** 各维度基础分（0-100） */
function subScores(fund) {
  const risk = (fund && fund.risk) || {};
  const manager = (fund && fund.manager) || {};
  const mdd = num(risk.maxDrawdown);
  const vol = num(risk.volatility);
  const sharpe = num(risk.sharpe);
  const star = num(manager.star);
  const workYears = parseWorkYears(manager.workTime);
  const scale = num(fund && fund.scale);

  return {
    mdd,
    vol,
    sharpe,
    star,
    workYears,
    scale,
    starScore: star === null ? 50 : clamp((star / 5) * 100, 0, 100),
    yearsScore: workYears === null ? 50 : clamp((workYears / 10) * 100, 0, 100),
    mddScore: mdd === null ? 50 : clamp(100 - (Math.abs(mdd) / 40) * 100, 0, 100),
    volScore: vol === null ? 50 : clamp(100 - (vol / 30) * 100, 0, 100),
    sharpeScore: sharpe === null ? 50 : clamp(((sharpe + 0.2) / 1.7) * 100, 0, 100),
    scaleScore: scale === null ? 60 : scale < 2 ? 40 : scale <= 200 ? 100 : scale <= 500 ? 80 : 50,
  };
}

function fmtNum(value, digits) {
  const n = num(value);
  return n === null ? '—' : n.toFixed(digits === undefined ? 2 : digits);
}

/** 同类基金池：优先同类型前 200，样本过少时退回全市场前 200 */
async function peersOf(type) {
  const typeKey = mapFundType(type);
  let rank = await getRankItems({ type: typeKey, sort: '1nzf', page: 1, size: 200 });
  if (rank.items.length < 30 && typeKey !== 'all') {
    const all = await getRankItems({ type: 'all', sort: '1nzf', page: 1, size: 200 });
    if (all.items.length > rank.items.length) rank = all;
  }
  return rank.items || [];
}

function buildDiagnoseDims(fund, scores, percentiles) {
  const py1 = pct100(percentiles.y1);
  const py3 = pct100(percentiles.y3);
  const returnScore = round((py1 === null ? 50 : py1) * 0.6 + (py3 === null ? 50 : py3) * 0.4, 1);
  const experienceScore = round(scores.starScore * 0.55 + scores.yearsScore * 0.45, 1);
  const riskScore = round(scores.mddScore * 0.6 + scores.volScore * 0.4, 1);
  const stabilityScore = round(scores.sharpeScore * 0.6 + scores.volScore * 0.4, 1);
  return [
    {
      key: 'return',
      label: '收益能力',
      score: returnScore,
      desc:
        '近1年同类分位 ' + fmtNum(py1, 1) + '%、近3年同类分位 ' +
        fmtNum(py3, 1) + '%（分位越高越好）',
    },
    {
      key: 'risk',
      label: '风险控制',
      score: riskScore,
      desc: '最大回撤 ' + fmtNum(scores.mdd, 1) + '%、年化波动率 ' + fmtNum(scores.vol, 1) + '%（越低越好）',
    },
    {
      key: 'manager',
      label: '基金经理',
      score: experienceScore,
      desc:
        '经理 ' + ((fund.manager && fund.manager.name) || '—') +
        '、星级 ' + fmtNum(scores.star, 0) +
        '、任职 ' + ((fund.manager && fund.manager.workTime) || '—'),
    },
    {
      key: 'stability',
      label: '稳定性',
      score: stabilityScore,
      desc: '夏普比率 ' + fmtNum(scores.sharpe, 2) + '、年化波动率 ' + fmtNum(scores.vol, 1) + '%',
    },
    {
      key: 'scale',
      label: '规模适配',
      score: scores.scaleScore,
      desc: '最新规模 ' + fmtNum(scores.scale, 1) + ' 亿元（<2 亿或 >500 亿适当扣分）',
    },
  ];
}

function buildManagerDims(fund, scores, percentiles) {
  const py1 = pct100(percentiles.y1);
  const py3 = pct100(percentiles.y3);
  const returnScore = round((py1 === null ? 50 : py1) * 0.6 + (py3 === null ? 50 : py3) * 0.4, 1);
  const experienceScore = round(scores.starScore * 0.55 + scores.yearsScore * 0.45, 1);
  const riskScore = round(scores.mddScore * 0.6 + scores.volScore * 0.4, 1);
  const stabilityScore = round(scores.sharpeScore * 0.6 + scores.volScore * 0.4, 1);
  return [
    {
      key: 'experience',
      label: '从业经验',
      score: experienceScore,
      desc:
        '管理 ' + ((fund.manager && fund.manager.name) || '—') +
        '、星级 ' + fmtNum(scores.star, 0) +
        '、任职 ' + ((fund.manager && fund.manager.workTime) || '—'),
    },
    {
      key: 'return',
      label: '收益能力',
      score: returnScore,
      desc: '近1年同类分位 ' + fmtNum(py1, 1) + '%、近3年 ' + fmtNum(py3, 1) + '%',
    },
    {
      key: 'risk',
      label: '抗风险',
      score: riskScore,
      desc: '最大回撤 ' + fmtNum(scores.mdd, 1) + '%、年化波动 ' + fmtNum(scores.vol, 1) + '%',
    },
    {
      key: 'stability',
      label: '稳定性',
      score: stabilityScore,
      desc: '夏普比率 ' + fmtNum(scores.sharpe, 2),
    },
    {
      key: 'scale',
      label: '管理规模',
      score: scores.scaleScore,
      desc: '在管规模 ' + fmtNum(scores.scale, 1) + ' 亿元',
    },
  ];
}

function buildTags(fund, scores, percentiles) {
  const tags = [];
  if (percentiles.y1 !== null && percentiles.y1 >= 0.8) tags.push('近1年同类前20%');
  if (percentiles.y3 !== null && percentiles.y3 >= 0.8) tags.push('近3年同类前20%');
  if (scores.mdd !== null && Math.abs(scores.mdd) <= 10) tags.push('回撤较小');
  if (scores.star !== null && scores.star >= 4) tags.push('明星经理');
  if (scores.sharpe !== null && scores.sharpe >= 1) tags.push('风险收益比优秀');
  if (scores.scale !== null && scores.scale >= 2 && scores.scale <= 200) tags.push('规模适中');
  return tags.slice(0, 4);
}

// ---------------- 相似基金 ----------------

async function getSimilar(code) {
  const cached = await cache.wrap('similar:' + code, TTL.similar, async () => {
    const detail = await getDetail(code);
    const base = detail.fund || {};
    const stage = base.stage || {};
    let baseVector = [num(stage.m6), num(stage.y1), num(stage.y3)];
    const typeKey = mapFundType(base.type);

    let rank = await getRankItems({ type: typeKey, sort: '1nzf', page: 1, size: 100 });
    if (baseVector.some((value) => value === null)) {
      const row = rank.items.find((item) => item.code === code);
      if (row) baseVector = [num(row.m6), num(row.y1), num(row.y3)];
    }
    if (baseVector.some((value) => value === null)) {
      throw new Error('基准基金阶段收益数据不足，无法计算相似度');
    }

    let candidates = rank.items.filter(
      (item) => item.code !== code && num(item.m6) !== null && num(item.y1) !== null && num(item.y3) !== null
    );
    if (!candidates.length) {
      rank = await getRankItems({ type: 'all', sort: '1nzf', page: 1, size: 100 });
      candidates = rank.items.filter(
        (item) => item.code !== code && num(item.m6) !== null && num(item.y1) !== null && num(item.y3) !== null
      );
    }
    if (!candidates.length) throw new Error('同类基金样本不足，无法计算相似度');

    const vectors = candidates.map((item) => [num(item.m6), num(item.y1), num(item.y3)]);
    vectors.push(baseVector);
    const mins = [0, 1, 2].map((dim) => Math.min.apply(null, vectors.map((vec) => vec[dim])));
    const maxs = [0, 1, 2].map((dim) => Math.max.apply(null, vectors.map((vec) => vec[dim])));
    const normalize = (vec) =>
      vec.map((value, dim) => (maxs[dim] - mins[dim] ? (value - mins[dim]) / (maxs[dim] - mins[dim]) : 0));
    const baseNorm = normalize(baseVector);

    const items = candidates
      .map((item) => {
        const vec = normalize([num(item.m6), num(item.y1), num(item.y3)]);
        const distance = Math.sqrt(
          vec.reduce((sum, value, dim) => sum + (value - baseNorm[dim]) ** 2, 0)
        );
        return {
          code: item.code,
          name: item.name,
          type: base.type || null,
          m6: num(item.m6),
          y1: num(item.y1),
          y3: num(item.y3),
          score: Math.round(clamp(100 - (distance / Math.sqrt(3)) * 100, 0, 100)),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return { base: { code: base.code, name: base.name, type: base.type || null }, items };
  });

  return { ok: true, ...cached.value, source: cached.source };
}

// ---------------- 基金诊断 ----------------

async function getDiagnose(code) {
  const cached = await cache.wrap('diagnose:' + code, TTL.diagnose, async () => {
    const detail = await getDetail(code);
    const fund = detail.fund || {};
    const peers = await peersOf(fund.type);
    const percentiles = {
      y1: percentileOf(peers, 'y1', num(fund.stage && fund.stage.y1)),
      y3: percentileOf(peers, 'y3', num(fund.stage && fund.stage.y3)),
    };
    const scores = subScores(fund);
    const dims = buildDiagnoseDims(fund, scores, percentiles);

    const weights = { return: 0.3, risk: 0.25, manager: 0.15, stability: 0.15, scale: 0.15 };
    let total = 0;
    for (const dim of dims) total += dim.score * (weights[dim.key] || 0);
    const score = Math.round(clamp(total, 0, 100));
    const grade = gradeOf(score);

    return {
      fund: { code: fund.code, name: fund.name, type: fund.type || null },
      score,
      grade,
      dims,
      tags: buildTags(fund, scores, percentiles),
      advice: adviceOf(grade),
      stage: fund.stage,
      risk: fund.risk,
      percentile: percentiles,
      updatedAt: Date.now(),
    };
  });

  return { ok: true, ...cached.value, source: cached.source };
}

// ---------------- 牛人选基 ----------------

async function getManagerPick(limit) {
  const count = Math.min(20, Math.max(1, Number.parseInt(limit, 10) || 8));
  const cached = await cache.wrap('manager-pick:' + count, TTL.managerPick, async () => {
    const rank = await getRankItems({ type: 'all', sort: '1nzf', page: 1, size: 30 });
    const picks = [];

    await mapLimit(rank.items, 4, async (item) => {
      try {
        const detail = await getFundInternal(item.code);
        const fund = detail.value;
        const star = num(fund.manager && fund.manager.star);
        if (star === null || star < 4) return;
        picks.push({
          fund: { code: fund.code, name: fund.name, type: fund.type || null },
          manager: fund.manager,
          y1: num(item.y1) !== null ? num(item.y1) : num(fund.stage && fund.stage.y1),
          y3: num(item.y3) !== null ? num(item.y3) : num(fund.stage && fund.stage.y3),
        });
      } catch (err) {
        /* 单只基金失败跳过 */
      }
    });

    if (!picks.length) throw new Error('暂无满足条件的高星级基金经理数据');
    picks.sort((a, b) => (b.y1 === null ? -Infinity : b.y1) - (a.y1 === null ? -Infinity : a.y1));
    return { items: picks.slice(0, count) };
  });

  return { ok: true, items: cached.value.items, source: cached.source };
}

// ---------------- 大佬评分 / PK ----------------

async function computeManagerScore(code) {
  const detail = await getDetail(code);
  const fund = detail.fund || {};
  const peers = await peersOf(fund.type);
  const percentiles = {
    y1: percentileOf(peers, 'y1', num(fund.stage && fund.stage.y1)),
    y3: percentileOf(peers, 'y3', num(fund.stage && fund.stage.y3)),
  };
  const scores = subScores(fund);
  const dims = buildManagerDims(fund, scores, percentiles);

  const weights = { experience: 0.2, return: 0.3, risk: 0.2, stability: 0.15, scale: 0.15 };
  let total = 0;
  for (const dim of dims) total += dim.score * (weights[dim.key] || 0);
  const score = Math.round(clamp(total, 0, 100));

  return {
    manager: fund.manager,
    fund: { code: fund.code, name: fund.name },
    score,
    grade: gradeOf(score),
    dims,
    updatedAt: Date.now(),
  };
}

async function getManagerScore(code) {
  const cached = await cache.wrap('manager-score:' + code, TTL.managerScore, () => computeManagerScore(code));
  return { ok: true, ...cached.value, source: cached.source };
}

async function getManagerCompare(codes) {
  const list = (Array.isArray(codes) ? codes : [])
    .map((raw) => String(raw === null || raw === undefined ? '' : raw).trim())
    .filter((code) => /^\d{6}$/.test(code))
    .filter((code, index, arr) => arr.indexOf(code) === index)
    .slice(0, 4);
  if (!list.length) throw new Error('缺少有效的基金代码');

  const cached = await cache.wrap('manager-compare:' + list.slice().sort().join(','), TTL.managerScore, async () => {
    const scores = await Promise.all(list.map((code) => computeManagerScore(code)));
    return {
      items: scores.map((item) => ({
        code: item.fund.code,
        name: item.fund.name,
        manager: item.manager,
        dims: item.dims,
        score: item.score,
        grade: item.grade,
      })),
    };
  });

  return { ok: true, items: cached.value.items, source: cached.source };
}

// ---------------- 基金筛选 ----------------

async function getFundScreen(params) {
  const input = params || {};
  const type = RANK_TYPES.indexOf(String(input.type || 'all')) >= 0 ? String(input.type || 'all') : 'all';
  const sort = SCREEN_SORTS.indexOf(String(input.sort)) >= 0 ? String(input.sort) : '1nzf';
  const minY1 = num(input.minY1);
  const minY3 = num(input.minY3);
  const minYtd = num(input.minYtd);
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const size = Math.min(50, Math.max(1, Number.parseInt(input.size, 10) || 20));

  const cached = await cache.wrap(
    'screen:' + [type, minY1, minY3, minYtd, sort].join('|'),
    TTL.screen,
    async () => {
      const upstreamSort = UPSTREAM_SORT[sort] || '1nzf';
      let rank;
      try {
        rank = await getRankItems({ type, sort: upstreamSort, page: 1, size: 200 });
        // 东财对未知排序码偶尔返回空列表而非报错：换回契约枚举值再试一次
        if (!rank.items.length && upstreamSort !== sort) {
          rank = await getRankItems({ type, sort, page: 1, size: 200 });
        }
      } catch (err) {
        // 东财排序码兼容兜底：退回契约枚举值本身
        rank = await getRankItems({ type, sort, page: 1, size: 200 });
      }
      let items = rank.items;
      if (minY1 !== null) items = items.filter((item) => num(item.y1) !== null && num(item.y1) >= minY1);
      if (minY3 !== null) items = items.filter((item) => num(item.y3) !== null && num(item.y3) >= minY3);
      if (minYtd !== null) items = items.filter((item) => num(item.ytd) !== null && num(item.ytd) >= minYtd);
      const field = SORT_FIELD[sort];
      items = items
        .slice()
        .sort((a, b) => (num(b[field]) === null ? -Infinity : num(b[field])) - (num(a[field]) === null ? -Infinity : num(a[field])));
      return { items, total: items.length, source: rank.source };
    }
  );

  const start = (page - 1) * size;
  return {
    ok: true,
    page,
    size,
    total: cached.value.total,
    items: cached.value.items.slice(start, start + size),
    source: cached.value.source,
  };
}

module.exports = {
  TTL,
  getSimilar,
  getDiagnose,
  getManagerPick,
  getManagerScore,
  getManagerCompare,
  getFundScreen,
  // 调试/复用
  _mapFundType: mapFundType,
  _parseWorkYears: parseWorkYears,
  _gradeOf: gradeOf,
};
