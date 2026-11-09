/* 韭研 · 投研工作台（小程序）—— 策略首页
 * 技术指标策略模板（/api/strategy/templates）+ 推荐组合策略（/api/portfolio/templates，失败用内置 5 个）
 * + 我的策略（本地存储 jy_mp_strategies_v1，兼容指标策略 / 组合策略两种类型）
 */
const api = require('../../utils/api.js');
const S = require('../../utils/storage.js') || {};

const STRATEGIES_KEY = S.STRATEGIES_KEY || 'jy_mp_strategies_v1';

function request(path, query) {
  try {
    if (api && typeof api.request === 'function') return Promise.resolve(api.request(path, query));
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.reject(new Error('api 模块未就绪'));
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
function rebalanceLabel(key) {
  const map = { monthly: '每月', quarterly: '每季度', halfyearly: '每半年', yearly: '每年', none: '不再平衡' };
  return map[key] || '每季度';
}

// /api/portfolio/templates 未提供时的兜底（与网页版组合模板一致）
const PORTFOLIO_FALLBACK = [
  {
    id: 'tpl-gold', name: '黄金恐贪1期', icon: '🥇',
    desc: '黄金 ETF 联接基金满仓跟踪金价，季度再平衡，用恐贪指数辅助判断节奏。',
    rebalance: 'quarterly', capital: 100000, baseYears: 3,
    holdings: [{ code: '004253', name: '国泰黄金ETF联接C', type: 'fund', weight: 100 }]
  },
  {
    id: 'tpl-dividend', name: '红利低波', icon: '🧧',
    desc: '红利 ETF + 红利低波 ETF + 低波固收资产，季度再平衡。',
    rebalance: 'quarterly', capital: 100000, baseYears: 5,
    holdings: [
      { code: '510880', name: '红利ETF', type: 'fund', weight: 30 },
      { code: '512890', name: '红利低波ETF', type: 'fund', weight: 30 },
      { code: '003096', name: '低波固收基金', type: 'fund', weight: 40 }
    ]
  },
  {
    id: 'tpl-global', name: '全球资产配置', icon: '🌍',
    desc: '沪深300 + 纳指 + 黄金 + 固收的多资产组合，季度再平衡。',
    rebalance: 'quarterly', capital: 100000, baseYears: 5,
    holdings: [
      { code: '510300', name: '沪深300ETF', type: 'fund', weight: 40 },
      { code: '513100', name: '纳指ETF', type: 'fund', weight: 30 },
      { code: '518880', name: '黄金ETF', type: 'fund', weight: 20 },
      { code: '003096', name: '低波固收基金', type: 'fund', weight: 10 }
    ]
  },
  {
    id: 'tpl-tech', name: '科技成长', icon: '🚀',
    desc: '纳指 + AI + 创业板50 三线成长，季度再平衡，波动较高。',
    rebalance: 'quarterly', capital: 100000, baseYears: 3,
    holdings: [
      { code: '513100', name: '纳指ETF', type: 'fund', weight: 50 },
      { code: '515070', name: 'AI ETF', type: 'fund', weight: 30 },
      { code: '159949', name: '创业板50ETF', type: 'fund', weight: 20 }
    ]
  },
  {
    id: 'tpl-balance', name: '股债平衡', icon: '⚖️',
    desc: '沪深300 与固收资产 5:5 经典平衡，季度再平衡。',
    rebalance: 'quarterly', capital: 100000, baseYears: 5,
    holdings: [
      { code: '510300', name: '沪深300ETF', type: 'fund', weight: 50 },
      { code: '003096', name: '低波固收基金', type: 'fund', weight: 50 }
    ]
  }
];

function normalizeIndicatorTpl(item) {
  if (!item) return null;
  const params = item.params || {};
  return {
    key: String(item.key || item.name || ''),
    name: String(item.name || '指标策略'),
    desc: String(item.desc || ''),
    icon: item.icon || '📈',
    badge: String(item.badge || '指标'),
    code: String(item.code || ''),
    codeName: String(item.codeName || item.code || ''),
    assetType: item.assetType === 'fund' ? 'fund' : 'stock',
    assetLabel: item.assetType === 'fund' ? '基金' : '股票/ETF',
    years: params.years == null ? 3 : params.years
  };
}

function normalizePortfolioTpl(item) {
  if (!item) return null;
  const holdings = Array.isArray(item.holdings) ? item.holdings : [];
  return {
    id: String(item.id || item.key || item.name || ''),
    name: String(item.name || '组合策略'),
    desc: String(item.desc || ''),
    icon: item.icon || '🧺',
    rebalance: item.rebalance || 'quarterly',
    holdingsCount: holdings.length,
    meta: rebalanceLabel(item.rebalance) + ' · ' + holdings.length + ' 个资产'
  };
}

function normalizeMine(s) {
  if (!s || !s.id || !s.name) return null;
  if (s.type === 'indicator') {
    const p = s.params || {};
    const years = p.years == null ? 3 : p.years;
    const assetType = s.assetType === 'fund' ? 'fund' : 'stock';
    return {
      id: String(s.id),
      type: 'indicator',
      name: String(s.name),
      desc: String(s.desc || ''),
      badge: '指标',
      badgeClass: 'badge-indicator',
      createdAt: Number(s.createdAt) || 0,
      summary: (s.codeName || s.code || '—') + ' · 近' + years + '年 · ' + (assetType === 'fund' ? '基金' : '股票/ETF')
    };
  }
  const holdings = Array.isArray(s.holdings) ? s.holdings : [];
  return {
    id: String(s.id),
    type: 'portfolio',
    name: String(s.name),
    desc: String(s.desc || ''),
    badge: '组合',
    badgeClass: 'badge-portfolio',
    createdAt: Number(s.createdAt) || 0,
    summary: holdings.length + ' 个资产 · ' + rebalanceLabel(s.rebalance)
  };
}

// 兼容 Node 静态检查（无 Page 全局时不抛错）
var registerPage = (typeof Page === 'function') ? Page : function () {};

registerPage({
  data: {
    isDark: false,
    indicatorTemplates: [],
    portfolioTemplates: [],
    mine: [],
    loadingTpl: true,
    loadingPf: true,
    tplError: ''
  },

  onLoad() {
    this.applyTheme();
    this.loadMine();
    return Promise.all([this.loadTemplates(), this.loadPortfolioTemplates()]);
  },

  onShow() {
    this.applyTheme();
    this.loadMine();
  },

  applyTheme() {
    let theme = 'light';
    try { theme = readStore(S.THEME_KEY || 'jy_mp_theme_v1', 'light'); } catch (e) { theme = 'light'; }
    this.setData({ isDark: theme === 'dark' });
  },

  onPullDownRefresh() {
    const done = () => { try { wx.stopPullDownRefresh(); } catch (e) { /* ignore */ } };
    Promise.all([this.loadTemplates(), this.loadPortfolioTemplates()]).then(done).catch(done);
    this.loadMine();
  },

  loadTemplates() {
    this.setData({ loadingTpl: true, tplError: '' });
    return request('/api/strategy/templates').then((d) => {
      const items = (d && Array.isArray(d.items)) ? d.items : [];
      const list = [];
      items.forEach((it) => { const t = normalizeIndicatorTpl(it); if (t && t.key) list.push(t); });
      this.setData({ indicatorTemplates: list, loadingTpl: false });
    }).catch((e) => {
      this.setData({ loadingTpl: false, tplError: errText(e) });
      toast('指标模板加载失败：' + errText(e));
    });
  },

  loadPortfolioTemplates() {
    this.setData({ loadingPf: true });
    return request('/api/portfolio/templates').then((d) => {
      const items = (d && Array.isArray(d.items)) ? d.items : [];
      if (!items.length) throw new Error('empty');
      const list = [];
      items.forEach((it) => { const t = normalizePortfolioTpl(it); if (t && t.id) list.push(t); });
      if (!list.length) throw new Error('empty');
      this.setData({ portfolioTemplates: list, loadingPf: false });
    }).catch(() => {
      const list = [];
      PORTFOLIO_FALLBACK.forEach((it) => { const t = normalizePortfolioTpl(it); if (t) list.push(t); });
      this.setData({ portfolioTemplates: list, loadingPf: false });
    });
  },

  loadMine() {
    let list = [];
    try { list = readStore(STRATEGIES_KEY, []); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    const out = [];
    list.forEach((s) => { const n = normalizeMine(s); if (n) out.push(n); });
    // 最近创建的排前面
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    this.setData({ mine: out });
  },

  retryTemplates() {
    this.loadTemplates();
  },

  onCreate() {
    navigate('/pages/strategy-create/strategy-create');
  },

  onTapTemplate(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.key : '';
    if (!key) return;
    navigate('/pages/strategy-detail/strategy-detail?mode=template&key=' + encodeURIComponent(key));
  },

  onTapPortfolio(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : '';
    if (!id) return;
    navigate('/pages/strategy-detail/strategy-detail?mode=portfolio&id=' + encodeURIComponent(id));
  },

  onTapMine(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (!ds.id) return;
    const mode = ds.type === 'indicator' ? 'indicator' : 'mine';
    navigate('/pages/strategy-detail/strategy-detail?mode=' + mode + '&id=' + encodeURIComponent(ds.id));
  }
});
