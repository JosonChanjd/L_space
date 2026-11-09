/* 韭研 · 投研工作台（小程序）—— 策略详情
 * 模式：
 *   mode=template&key=     指标模板（/api/strategy/templates 取公式与参数）
 *   mode=indicator&id=     本机保存的指标策略（jy_mp_strategies_v1）
 *   mode=mine&id=          兼容入口：指标策略 / 组合策略
 *   mode=portfolio&id=     推荐组合模板（内置定义，/api/portfolio/templates 存在时优先）
 * 回测：/api/strategy/backtest 或 /api/portfolio/backtest
 */
const api = require('../../utils/api.js');
const F = require('../../utils/format.js') || {};
const S = require('../../utils/storage.js') || {};

const STRATEGIES_KEY = S.STRATEGIES_KEY || 'jy_mp_strategies_v1';

const RANGES = [
  { key: '1y', label: '近1年', years: 1 },
  { key: '3y', label: '近3年', years: 3 },
  { key: '5y', label: '近5年', years: 5 },
  { key: 'all', label: '全部', years: 20 }
];
const TABS = [
  { key: 'trend', label: '业绩走势' },
  { key: 'drawdown', label: '组合回撤' },
  { key: 'trades', label: '交易明细' },
  { key: 'formula', label: '公式说明' }
];
const FUNCTION_NAMES = ['MA', 'EMA', 'REF', 'HHV', 'LLV', 'SUM', 'STD', 'ABS', 'MAX', 'MIN', 'CROSS', 'CROSSDOWN', 'RSI', 'DIF', 'DEA', 'MACD_HIST', 'KDJ_K', 'KDJ_D', 'BOLL_MID', 'BOLL_UPPER', 'BOLL_LOWER', 'TD_BUY', 'TD_SELL'];

/* 组合模板兜底（与网页版 public/strategy.js 一致） */
const BUILTIN_PORTFOLIOS = [
  {
    id: 'tpl-gold', name: '黄金恐贪1期', icon: '🥇', baseYears: 3, rebalance: 'quarterly', capital: 100000,
    desc: '黄金 ETF 联接基金满仓跟踪金价，季度再平衡，用恐贪指数辅助判断节奏。',
    holdings: [{ code: '004253', name: '国泰黄金ETF联接C', type: 'fund', weight: 100 }]
  },
  {
    id: 'tpl-dividend', name: '红利低波', icon: '🧧', baseYears: 5, rebalance: 'quarterly', capital: 100000,
    desc: '红利 ETF + 红利低波 ETF + 低波固收资产，季度再平衡。',
    holdings: [
      { code: '510880', name: '红利ETF', type: 'fund', weight: 30 },
      { code: '512890', name: '红利低波ETF', type: 'fund', weight: 30 },
      { code: '003096', name: '低波固收基金', type: 'fund', weight: 40 }
    ]
  },
  {
    id: 'tpl-global', name: '全球资产配置', icon: '🌍', baseYears: 5, rebalance: 'quarterly', capital: 100000,
    desc: '沪深300 + 纳指 + 黄金 + 固收的多资产组合，季度再平衡。',
    holdings: [
      { code: '510300', name: '沪深300ETF', type: 'fund', weight: 40 },
      { code: '513100', name: '纳指ETF', type: 'fund', weight: 30 },
      { code: '518880', name: '黄金ETF', type: 'fund', weight: 20 },
      { code: '003096', name: '低波固收基金', type: 'fund', weight: 10 }
    ]
  },
  {
    id: 'tpl-tech', name: '科技成长', icon: '🚀', baseYears: 3, rebalance: 'quarterly', capital: 100000,
    desc: '纳指 + AI + 创业板50 三线成长，季度再平衡，波动较高。',
    holdings: [
      { code: '513100', name: '纳指ETF', type: 'fund', weight: 50 },
      { code: '515070', name: 'AI ETF', type: 'fund', weight: 30 },
      { code: '159949', name: '创业板50ETF', type: 'fund', weight: 20 }
    ]
  },
  {
    id: 'tpl-balance', name: '股债平衡', icon: '⚖️', baseYears: 5, rebalance: 'quarterly', capital: 100000,
    desc: '沪深300 与固收资产 5:5 经典平衡，季度再平衡。',
    holdings: [
      { code: '510300', name: '沪深300ETF', type: 'fund', weight: 50 },
      { code: '003096', name: '低波固收基金', type: 'fund', weight: 50 }
    ]
  }
];

/* ---------- 基础工具 ---------- */
function num(v) {
  if (F && typeof F.num === 'function') return F.num(v);
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function fmt(v, d) {
  if (F && typeof F.fmt === 'function') return F.fmt(v, d);
  const n = num(v);
  if (n === null) return '—';
  return n.toFixed(d === undefined ? 2 : d);
}
function pct(v) {
  if (F && typeof F.pct === 'function') return F.pct(v);
  const n = num(v);
  if (n === null) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}
function money(v) {
  if (F && typeof F.fmtMoney === 'function') return F.fmtMoney(v);
  const n = num(v);
  if (n === null) return '—';
  const abs = Math.abs(n);
  if (abs >= 100000000) return '¥' + (n / 100000000).toFixed(2) + '亿';
  if (abs >= 10000) return '¥' + (n / 10000).toFixed(2) + '万';
  return '¥' + n.toFixed(2);
}
function dirOf(v) {
  if (F && typeof F.dir === 'function') return F.dir(v);
  const n = num(v);
  if (n === null || n === 0) return '';
  return n > 0 ? 'up' : 'down';
}
function uid() {
  if (S && typeof S.uid === 'function') return S.uid();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function readStore(key, fallback) {
  if (S && typeof S.read === 'function') return S.read(key, fallback);
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function writeStore(key, value) {
  if (S && typeof S.write === 'function') { S.write(key, value); return; }
  try { wx.setStorageSync(key, value); } catch (e) { /* ignore */ }
}
function request(path, query) {
  try {
    if (api && typeof api.request === 'function') return Promise.resolve(api.request(path, query));
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.reject(new Error('api 模块未就绪'));
}
function errText(e) {
  if (!e) return '加载失败';
  return e.message ? String(e.message) : String(e);
}
function toast(msg) {
  try { wx.showToast({ title: String(msg || ''), icon: 'none' }); } catch (e) { /* ignore */ }
}
function navigate(url) {
  try { wx.navigateTo({ url: url }); } catch (e) { /* ignore */ }
}
function redirect(url) {
  try { wx.redirectTo({ url: url }); } catch (e) { /* ignore */ }
}
function rebalanceLabel(key) {
  const map = { monthly: '每月', quarterly: '每季度', halfyearly: '每半年', yearly: '每年', none: '不再平衡' };
  return map[key] || '每季度';
}
function signedMoney(v) {
  const n = num(v);
  if (n === null) return '—';
  const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
  return sign + money(Math.abs(n));
}
function priceText(v) {
  const n = num(v);
  return n === null ? '—' : fmt(n, 3);
}
function clampYears(v, dft) {
  const n = num(v);
  if (n === null) return dft;
  return Math.max(1, Math.min(20, Math.round(n)));
}
function normalizeParams(p) {
  p = p || {};
  const years = clampYears(p.years, 3);
  const capital = num(p.capital) === null ? 100000 : num(p.capital);
  const fee = num(p.fee) === null ? 0.0005 : num(p.fee);
  const stop = num(p.stopLoss);
  const take = num(p.takeProfit);
  return {
    years: years,
    capital: capital,
    fee: fee,
    stopLoss: stop === null || stop <= 0 ? null : stop,
    takeProfit: take === null || take <= 0 ? null : take
  };
}
function rangeYears(rangeKey) {
  for (let i = 0; i < RANGES.length; i += 1) {
    if (RANGES[i].key === rangeKey) return RANGES[i].years;
  }
  return 3;
}
function defaultRangeKey(years) {
  const n = num(years);
  if (n === null) return '3y';
  if (n <= 1) return '1y';
  if (n <= 3) return '3y';
  if (n <= 5) return '5y';
  return 'all';
}
function pctPoints(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((p) => {
    const t = num(p && p.t);
    const v = num(p && p.v);
    if (t !== null && v !== null) out.push({ t: t, v: (v - 1) * 100 });
  });
  return out;
}
function plainPoints(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((p) => {
    const t = num(p && p.t);
    const v = num(p && p.v);
    if (t !== null && v !== null) out.push({ t: t, v: v });
  });
  return out;
}
function drawdownSeries(points) {
  let peak = null;
  const out = [];
  (points || []).forEach((p) => {
    if (peak === null || p.v > peak) peak = p.v;
    out.push({ t: p.t, v: peak > 0 ? (p.v / peak - 1) * 100 : 0 });
  });
  return out;
}
function formulaFunctions(text) {
  const out = [];
  const s = String(text || '');
  for (let i = 0; i < FUNCTION_NAMES.length; i += 1) {
    const fn = FUNCTION_NAMES[i];
    const re = new RegExp('(^|[^A-Z0-9_])' + fn + '\\s*\\(', 'i');
    if (re.test(s)) out.push(fn);
  }
  return out;
}
function reasonOf(raw) {
  const s = String(raw === null || raw === undefined ? '' : raw).toLowerCase();
  if (s.indexOf('stop') >= 0) return { text: '止损', cls: 'stop' };
  if (s.indexOf('take') >= 0 || s.indexOf('profit') >= 0) return { text: '止盈', cls: 'profit' };
  if (s === 'end') return { text: '期末', cls: 'end' };
  return { text: '信号', cls: 'signal' };
}
function mapTrade(tr, i) {
  const r = reasonOf(tr && tr.reason);
  return {
    key: String((tr && tr.id) || i),
    buyDate: (tr && tr.buyDate) || '—',
    buyPrice: priceText(tr && tr.buyPrice),
    sellDate: (tr && tr.sellDate) || '—',
    sellPrice: priceText(tr && tr.sellPrice),
    holdDays: tr && num(tr.holdDays) !== null ? fmt(tr.holdDays, 0) + '天' : '—',
    pctText: pct(tr && tr.profitPct),
    pctDir: dirOf(tr && tr.profitPct),
    reasonText: r.text,
    reasonClass: r.cls
  };
}
function mapCurrent(cur) {
  cur = cur || {};
  const holding = !!cur.holding;
  let sig = '—';
  if (cur.lastSignal === 'buy') sig = '买入';
  else if (cur.lastSignal === 'sell') sig = '卖出';
  else if (cur.lastSignal) sig = String(cur.lastSignal);
  return {
    holding: holding,
    holdingText: holding ? '持仓中' : '空仓',
    entryDate: cur.entryDate || '',
    entryPriceText: num(cur.entryPrice) === null ? '—' : fmt(cur.entryPrice, 3),
    lastSignalText: sig,
    lastSignalDate: cur.lastSignalDate || ''
  };
}
function yearsAgoStr(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - (n || 3));
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

function targetView(t) {
  const isPortfolio = t.kind === 'portfolio';
  return {
    name: t.name || '',
    desc: t.desc || '',
    code: t.code || '',
    codeName: t.codeName || t.code || '',
    assetLabel: isPortfolio ? '组合' : (t.assetType === 'fund' ? '基金' : '股票/ETF'),
    isPortfolio: isPortfolio,
    isIndicator: !isPortfolio,
    isTemplate: !!t.template,
    isMine: !!t.mine
  };
}
function normalizePortfolioTarget(item, template) {
  const holdings = [];
  (Array.isArray(item.holdings) ? item.holdings : []).forEach((h) => {
    if (!h || !h.code) return;
    holdings.push({
      code: String(h.code),
      name: String(h.name || h.code),
      type: h.type === 'stock' ? 'stock' : 'fund',
      weight: num(h.weight) === null ? 0 : num(h.weight)
    });
  });
  return {
    kind: 'portfolio',
    template: !!template,
    mine: false,
    name: String(item.name || '组合策略'),
    desc: String(item.desc || ''),
    icon: item.icon || '🧺',
    baseYears: clampYears(item.baseYears, 3),
    rebalance: item.rebalance || 'quarterly',
    capital: num(item.capital) === null ? 100000 : num(item.capital),
    holdings: holdings
  };
}

// 兼容 Node 静态检查（无 Page 全局时不抛错）
var registerPage = (typeof Page === 'function') ? Page : function () {};

registerPage({
  data: {
    isDark: false,
    loading: true,
    error: '',
    rangeLoading: false,
    target: null,
    ranges: RANGES,
    tabs: TABS,
    activeRange: '3y',
    activeTab: 'trend',
    hero: null,
    metrics: [],
    note: '',
    chartSeries: [],
    markers: [],
    ddSeries: [],
    trades: [],
    tradeNote: '',
    holdings: [],
    current: null,
    formula: null,
    canEdit: false,
    canCopy: false,
    canDelete: false
  },

  onLoad(query) {
    this.applyTheme();
    const q = query || {};
    this.mode = q.mode || 'indicator';
    this.tplKey = q.key ? String(q.key) : '';
    this.id = q.id ? String(q.id) : '';
    this.target = null;
    return this.loadData();
  },

  onShow() {
    this.applyTheme();
    // 从「编辑」页返回时重新拉取回测数据
    if (this._needsReload) {
      this._needsReload = false;
      this.target = null;
      this.loadData();
    }
  },

  applyTheme() {
    let theme = 'light';
    try { theme = readStore(S.THEME_KEY || 'jy_mp_theme_v1', 'light'); } catch (e) { theme = 'light'; }
    this.setData({ isDark: theme === 'dark' });
  },

  onPullDownRefresh() {
    this.target = null;
    this.loadData().then(() => { try { wx.stopPullDownRefresh(); } catch (e) { /* ignore */ } })
      .catch(() => { try { wx.stopPullDownRefresh(); } catch (e) { /* ignore */ } });
  },

  /* ---------- 目标解析 ---------- */
  resolveTarget() {
    const mode = this.mode;
    if (mode === 'template') return this.resolveTemplate(this.tplKey);
    if (mode === 'portfolio') return this.resolvePortfolio(this.id);
    return this.resolveMine(this.id);
  },

  resolveTemplate(key) {
    return request('/api/strategy/templates').then((d) => {
      const items = (d && Array.isArray(d.items)) ? d.items : [];
      let tpl = null;
      items.forEach((it) => { if (it && String(it.key) === String(key)) tpl = it; });
      if (!tpl) throw new Error('未找到该指标模板');
      return {
        kind: 'indicator',
        template: true,
        mine: false,
        id: 'tpl-' + String(tpl.key),
        name: String(tpl.name || '指标策略'),
        desc: String(tpl.desc || ''),
        icon: tpl.icon || '📈',
        code: String(tpl.code || ''),
        codeName: String(tpl.codeName || tpl.code || ''),
        assetType: tpl.assetType === 'fund' ? 'fund' : 'stock',
        buy: String(tpl.buy || ''),
        sell: String(tpl.sell || ''),
        params: normalizeParams(tpl.params)
      };
    });
  },

  resolveMine(id) {
    let list = [];
    try { list = readStore(STRATEGIES_KEY, []); } catch (e) { list = []; }
    let saved = null;
    (Array.isArray(list) ? list : []).forEach((s) => { if (s && String(s.id) === String(id)) saved = s; });
    if (!saved) return Promise.reject(new Error('未找到该策略，可能已被删除'));
    if (saved.type === 'indicator') {
      return Promise.resolve({
        kind: 'indicator',
        template: false,
        mine: true,
        id: String(saved.id),
        name: String(saved.name || '指标策略'),
        desc: String(saved.desc || ''),
        icon: '📈',
        code: String(saved.code || ''),
        codeName: String(saved.codeName || saved.code || ''),
        assetType: saved.assetType === 'fund' ? 'fund' : 'stock',
        buy: String(saved.buy || ''),
        sell: String(saved.sell || ''),
        params: normalizeParams(saved.params),
        createdAt: saved.createdAt || 0
      });
    }
    const holdings = Array.isArray(saved.holdings) ? saved.holdings : [];
    return Promise.resolve({
      kind: 'portfolio',
      template: false,
      mine: true,
      id: String(saved.id),
      name: String(saved.name || '组合策略'),
      desc: String(saved.desc || ''),
      icon: '🧺',
      baseYears: 3,
      rebalance: saved.rebalance || 'quarterly',
      capital: num(saved.capital) === null ? 100000 : num(saved.capital),
      holdings: holdings.map((h) => ({
        code: String(h.code || ''),
        name: String(h.name || h.code || ''),
        type: h.type === 'stock' ? 'stock' : 'fund',
        weight: num(h.weight) === null ? 0 : num(h.weight)
      })).filter((h) => !!h.code)
    });
  },

  resolvePortfolio(id) {
    return request('/api/portfolio/templates').then((d) => {
      const items = (d && Array.isArray(d.items)) ? d.items : [];
      let found = null;
      items.forEach((it) => { if (it && String(it.id) === String(id)) found = it; });
      if (!found) throw new Error('not found');
      return normalizePortfolioTarget(found, true);
    }).catch(() => {
      let tpl = null;
      BUILTIN_PORTFOLIOS.forEach((it) => { if (String(it.id) === String(id)) tpl = it; });
      if (!tpl) throw new Error('未找到该组合模板');
      return normalizePortfolioTarget(tpl, true);
    });
  },

  /* ---------- 数据加载 ---------- */
  loadData() {
    this.setData({ loading: true, error: '', rangeLoading: false });
    const self = this;
    const p = this.target ? Promise.resolve(this.target) : this.resolveTarget();
    return p.then((target) => {
      self.target = target;
      const view = targetView(target);
      const defaultYears = view.isPortfolio ? (target.baseYears || 3) : ((target.params || {}).years || 3);
      const rangeKey = defaultRangeKey(defaultYears);
      self.setData({
        target: view,
        ranges: RANGES,
        tabs: TABS,
        activeRange: rangeKey,
        activeTab: 'trend',
        canEdit: !!(target.mine && view.isIndicator),
        canCopy: !!target.template,
        canDelete: !!target.mine
      });
      try { wx.setNavigationBarTitle({ title: target.name || '策略详情' }); } catch (e) { /* ignore */ }
      return self.runBacktest(target, rangeKey, true);
    }).catch((e) => {
      self.setData({ loading: false, rangeLoading: false, error: errText(e) });
    });
  },

  buildIndicatorRequest(target, years) {
    const p = target.params || normalizeParams({});
    const req = {
      code: target.code,
      assetType: target.assetType === 'fund' ? 'fund' : 'stock',
      buy: target.buy || '',
      sell: target.sell || '',
      years: years,
      capital: num(p.capital) === null ? 100000 : num(p.capital),
      fee: num(p.fee) === null ? 0.0005 : num(p.fee)
    };
    if (num(p.stopLoss) !== null && num(p.stopLoss) > 0) req.stopLoss = num(p.stopLoss);
    if (num(p.takeProfit) !== null && num(p.takeProfit) > 0) req.takeProfit = num(p.takeProfit);
    return req;
  },

  buildPortfolioRequest(target, years) {
    const codes = [];
    const types = [];
    const weights = [];
    (target.holdings || []).forEach((h) => {
      codes.push(h.code);
      types.push(h.type === 'stock' ? 'stock' : 'fund');
      weights.push(num(h.weight) === null ? 0 : num(h.weight));
    });
    return {
      codes: codes.join(','),
      types: types.join(','),
      weights: weights.join(','),
      years: years,
      rebalance: target.rebalance || 'quarterly',
      capital: num(target.capital) === null ? 100000 : num(target.capital)
    };
  },

  runBacktest(target, rangeKey, initial) {
    const self = this;
    const years = rangeYears(rangeKey);
    const isPortfolio = target.kind === 'portfolio';
    if (isPortfolio && (!target.holdings || !target.holdings.length)) {
      return Promise.reject(new Error('该组合没有资产配置'));
    }
    this.setData({ rangeLoading: true });
    const path = isPortfolio ? '/api/portfolio/backtest' : '/api/strategy/backtest';
    const req = isPortfolio ? this.buildPortfolioRequest(target, years) : this.buildIndicatorRequest(target, years);
    return request(path, req).then((d) => {
      if (!d || d.ok === false) throw new Error((d && d.error) || '回测失败');
      const res = d.result || d;
      self.applyResult(target, res, rangeKey);
      self.setData({ rangeLoading: false, loading: false, error: '' });
    }).catch((e) => {
      const msg = errText(e);
      if (initial) {
        self.setData({ loading: false, rangeLoading: false, error: msg });
      } else {
        self.setData({ rangeLoading: false });
        toast('回测失败：' + msg);
      }
      throw e;
    });
  },

  applyResult(target, res, rangeKey) {
    res = res || {};
    const isPortfolio = target.kind === 'portfolio';
    const m = res.metrics || {};
    const curve = Array.isArray(res.curve) ? res.curve : [];
    const bench = Array.isArray(res.benchmark) ? res.benchmark : [];
    const lastV = curve.length ? num(curve[curve.length - 1].v) : null;
    const capital = num(res.capital) === null ? (num(target.capital) || 100000) : num(res.capital);
    const amount = lastV === null ? null : capital * lastV;
    const pnl = amount === null ? null : amount - capital;
    let ret = num(m.totalReturn);
    if (ret === null && lastV !== null) ret = (lastV - 1) * 100;
    const benchRet = num(m.benchmarkReturn);

    let heroKpis;
    if (isPortfolio) {
      heroKpis = [
        { label: '组合金额', value: money(amount), dir: '' },
        { label: '累计盈亏', value: signedMoney(pnl), dir: dirOf(pnl) },
        { label: '基准收益', value: pct(benchRet), dir: dirOf(benchRet) }
      ];
    } else {
      const tradeCount = num(m.tradeCount);
      const winRate = num(m.winRate);
      const tradeText = (tradeCount === null ? '—' : fmt(tradeCount, 0) + '笔') +
        (winRate === null ? '' : ' · 胜率 ' + fmt(winRate, 1) + '%');
      heroKpis = [
        { label: '组合金额', value: money(amount), dir: '' },
        { label: '累计盈亏', value: signedMoney(pnl), dir: dirOf(pnl) },
        { label: '交易/胜率', value: tradeText, dir: '' }
      ];
    }
    const hero = {
      retText: pct(ret),
      retDir: dirOf(ret),
      sub: (res.startDate || '—') + ' ~ ' + (res.endDate || '—') + ' · ' +
        (isPortfolio
          ? '组合 · ' + rebalanceLabel(target.rebalance)
          : ((target.codeName || target.code || '—') + ' · ' + (target.assetType === 'fund' ? '基金' : '股票/ETF')))
    };
    hero.kpis = heroKpis;

    const metrics = [
      { label: '策略收益', value: pct(ret), dir: dirOf(ret) },
      { label: '沪深300 基准', value: pct(benchRet), dir: dirOf(benchRet) }
    ];

    const chartSeries = [{ name: '策略', points: pctPoints(curve), color: '#ff5b3a', fill: true }];
    if (bench.length >= 2) chartSeries.push({ name: '沪深300', points: pctPoints(bench), color: '#2f7df6' });

    const markers = [];
    (Array.isArray(res.markers) ? res.markers : []).forEach((mm) => {
      const t = num(mm && mm.t);
      if (t !== null) markers.push({ t: t, type: mm.type === 'sell' ? 'sell' : 'buy' });
    });

    const ddSeries = [];
    const drawdown = Array.isArray(res.drawdown) ? res.drawdown : [];
    if (drawdown.length >= 2) ddSeries.push({ name: '策略回撤', points: plainPoints(drawdown), color: '#ff5b3a', fill: true });
    else if (curve.length >= 2) ddSeries.push({ name: '策略回撤', points: drawdownSeries(pctPoints(curve)), color: '#ff5b3a', fill: true });
    const benchDd = Array.isArray(res.benchmarkDrawdown) ? res.benchmarkDrawdown : [];
    if (benchDd.length >= 2) ddSeries.push({ name: '沪深300回撤', points: plainPoints(benchDd), color: '#2f7df6' });
    else if (bench.length >= 2) ddSeries.push({ name: '沪深300回撤', points: drawdownSeries(plainPoints(bench)), color: '#2f7df6' });

    const trades = [];
    const holdings = [];
    if (isPortfolio) {
      (Array.isArray(res.items) ? res.items : []).forEach((it, i) => {
        holdings.push({
          key: String((it && it.code) || i),
          name: (it && it.name) || (it && it.code) || '—',
          code: (it && it.code) || '',
          typeLabel: it && it.type === 'stock' ? '股票' : '基金',
          weightText: num(it && it.weight) === null ? '—' : fmt(it.weight, 2) + '%',
          ownText: pct(it && it.ownReturn),
          ownDir: dirOf(it && it.ownReturn),
          amountText: money(it && it.amount)
        });
      });
    } else {
      const allTrades = Array.isArray(res.trades) ? res.trades : [];
      const startIdx = Math.max(0, allTrades.length - 50);
      allTrades.slice(startIdx).forEach((tr, i) => { trades.push(mapTrade(tr, i)); });
    }

    let current;
    if (isPortfolio) {
      current = {
        holding: holdings.length > 0,
        holdingText: holdings.length ? '持仓中' : '空仓',
        entryDate: res.startDate || '',
        entryPriceText: '—',
        lastSignalText: '持有',
        lastSignalDate: ''
      };
    } else {
      current = mapCurrent(res.current);
    }

    const formula = isPortfolio
      ? this.buildPortfolioFormula(target, res)
      : this.buildIndicatorFormula(target, res);

    this.setData({
      loading: false,
      error: '',
      hero: hero,
      metrics: metrics,
      note: res.note || '',
      chartSeries: chartSeries,
      markers: markers,
      ddSeries: ddSeries,
      trades: trades,
      tradeNote: isPortfolio ? '按目标权重与区间收益展示。' : '交易明细展示最近 50 条（按时间正序）；收益率为单笔交易扣除双边手续费后的结果。',
      holdings: holdings,
      current: current,
      formula: formula
    });
  },

  buildIndicatorFormula(target, res) {
    const p = target.params || normalizeParams({});
    let funcs = formulaFunctions(target.buy);
    formulaFunctions(target.sell).forEach((fn) => { if (funcs.indexOf(fn) < 0) funcs.push(fn); });
    const params = [
      { label: '回测区间', value: (res.startDate || '—') + ' ~ ' + (res.endDate || '—') },
      { label: '标的', value: (target.codeName || target.code || '—') + ' ' + (target.code || '') },
      { label: '资产类型', value: target.assetType === 'fund' ? '基金' : '股票/ETF' },
      { label: '初始资金', value: money(num(p.capital) === null ? 100000 : num(p.capital)) },
      { label: '手续费（单边）', value: num(p.fee) === null ? '—' : fmt(p.fee * 100, 3) + '%' },
      { label: '止损', value: num(p.stopLoss) === null ? '未设置' : fmt(p.stopLoss, 1) + '%' },
      { label: '止盈', value: num(p.takeProfit) === null ? '未设置' : fmt(p.takeProfit, 1) + '%' }
    ];
    return {
      buy: target.buy || '—',
      sell: target.sell || '—',
      funcs: funcs,
      params: params,
      disclaimer: '公式按多行赋值解析，可用 CLOSE / OPEN / HIGH / LOW / VOL / AMOUNT 与 MA、EMA、CROSS、TD_BUY 等函数；信号在下一交易日开盘成交。历史回测不代表未来收益，不构成投资建议。'
    };
  },

  buildPortfolioFormula(target, res) {
    const holdings = target.holdings || [];
    const lines = holdings.map((h) => {
      return (h.name || h.code) + ' ' + (num(h.weight) === null ? 0 : fmt(h.weight, 0)) + '%';
    });
    const params = [
      { label: '回测区间', value: (res.startDate || '—') + ' ~ ' + (res.endDate || '—') },
      { label: '再平衡', value: rebalanceLabel(target.rebalance) },
      { label: '初始资金', value: money(num(target.capital) === null ? 100000 : num(target.capital)) },
      { label: '资产数', value: String(holdings.length) }
    ];
    return {
      buy: lines.join('\n'),
      sell: '按「' + rebalanceLabel(target.rebalance) + '」周期调回目标权重',
      funcs: [],
      params: params,
      disclaimer: '组合按目标权重合成历史净值并定期再平衡；历史回测不代表未来收益，不构成投资建议。'
    };
  },

  /* ---------- 交互 ---------- */
  onRangeTap(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : '';
    if (!key || key === this.data.activeRange || !this.target) return;
    this.setData({ activeRange: key });
    this.runBacktest(this.target, key, false).catch(() => { /* 已在 runBacktest 内提示 */ });
  },

  onTabTap(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : '';
    if (!key) return;
    this.setData({ activeTab: key });
  },

  onRetry() {
    this.target = null;
    this.loadData();
  },

  onRecalc() {
    if (!this.target) return;
    toast('正在重新计算…');
    this.runBacktest(this.target, this.data.activeRange, false).catch(() => { /* ignore */ });
  },

  onEdit() {
    if (!this.target || !this.target.mine || this.target.kind !== 'indicator') {
      toast('该策略暂不支持编辑');
      return;
    }
    this._needsReload = true;
    navigate('/pages/strategy-create/strategy-create?id=' + encodeURIComponent(this.target.id));
  },

  onDelete() {
    const self = this;
    if (!self.target || !self.target.mine) return;
    try {
      wx.showModal({
        title: '删除策略',
        content: '确定删除「' + (self.target.name || '该策略') + '」吗？删除后不可恢复。',
        success(r) {
          if (!r || !r.confirm) return;
          let list = [];
          try { list = readStore(STRATEGIES_KEY, []); } catch (e) { list = []; }
          const out = [];
          (Array.isArray(list) ? list : []).forEach((s) => {
            if (s && String(s.id) !== String(self.target.id)) out.push(s);
          });
          writeStore(STRATEGIES_KEY, out);
          toast('策略已删除');
          try { wx.navigateBack({ delta: 1 }); } catch (e) { /* ignore */ }
        }
      });
    } catch (e) { /* 无 wx.showModal 时忽略 */ }
  },

  onCopy() {
    const t = this.target;
    if (!t || !t.template) return;
    let saved;
    if (t.kind === 'indicator') {
      saved = {
        id: uid(),
        type: 'indicator',
        name: t.name,
        desc: t.desc || '',
        code: t.code,
        codeName: t.codeName || t.code,
        assetType: t.assetType === 'fund' ? 'fund' : 'stock',
        buy: t.buy || '',
        sell: t.sell || '',
        params: normalizeParams(t.params),
        createdAt: Date.now()
      };
    } else {
      saved = {
        id: uid(),
        name: t.name,
        desc: t.desc || '',
        capital: num(t.capital) === null ? 100000 : num(t.capital),
        startDate: yearsAgoStr(t.baseYears || 3),
        rebalance: t.rebalance || 'quarterly',
        holdings: (t.holdings || []).map((h) => ({ code: h.code, name: h.name, type: h.type, weight: h.weight })),
        createdAt: Date.now()
      };
    }
    let list = [];
    try { list = readStore(STRATEGIES_KEY, []); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    list.push(saved);
    writeStore(STRATEGIES_KEY, list);
    toast('已复制为我的策略');
    const mode = t.kind === 'indicator' ? 'indicator' : 'mine';
    redirect('/pages/strategy-detail/strategy-detail?mode=' + mode + '&id=' + encodeURIComponent(saved.id));
  }
});
