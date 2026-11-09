/* 韭研 · 投研工作台（小程序）—— 新建 / 编辑指标公式策略
 * 标的搜索（股票 / 基金）+ 买入卖出公式 + 公式助手 + 参数 + 校验 / 回测预览 / 保存
 * 接口：GET /api/stock/search、GET /api/fund/search、POST /api/strategy/validate、GET /api/strategy/backtest
 */
const api = require('../../utils/api.js');
const F = require('../../utils/format.js') || {};
const S = require('../../utils/storage.js') || {};

const STRATEGIES_KEY = S.STRATEGIES_KEY || 'jy_mp_strategies_v1';
const DEFAULT_BUY = 'CROSS(MA(CLOSE,5),MA(CLOSE,20))';
const DEFAULT_SELL = 'CROSSDOWN(MA(CLOSE,5),MA(CLOSE,20))';
const YEAR_OPTIONS = [1, 3, 5, 10, 20];
const HELPERS = [
  { label: 'MA金叉', snippet: 'CROSS(MA(CLOSE,5),MA(CLOSE,20))' },
  { label: 'CROSSDOWN', snippet: 'CROSSDOWN(MA(CLOSE,5),MA(CLOSE,20))' },
  { label: 'MACD金叉', snippet: 'CROSS(DIF(CLOSE,12,26),DEA(CLOSE,12,26,9))' },
  { label: '神奇九转', snippet: 'TD_BUY(CLOSE)==9' },
  { label: '量价齐升', snippet: 'CLOSE>MA(CLOSE,20) AND VOL>MA(VOL,5)*1.5' },
  { label: '均线多头', snippet: 'MA(CLOSE,5)>MA(CLOSE,10) AND MA(CLOSE,10)>MA(CLOSE,20)' },
  { label: 'RSI超卖', snippet: 'RSI(CLOSE,14)<30' },
  { label: '布林突破', snippet: 'CROSS(CLOSE,BOLL_UPPER(CLOSE,20,2))' }
];

/* ---------- 格式化（优先 utils/format，缺失时本地兜底） ---------- */
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
function post(path, body) {
  try {
    if (api && typeof api.post === 'function') return Promise.resolve(api.post(path, body));
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.reject(new Error('api 模块未就绪'));
}
function errText(e) {
  if (!e) return '请求失败';
  return e.message ? String(e.message) : String(e);
}
function toast(msg) {
  try { wx.showToast({ title: String(msg || ''), icon: 'none' }); } catch (e) { /* ignore */ }
}
function priceText(v) {
  const n = num(v);
  return n === null ? '—' : fmt(n, 3);
}
function yearIndexOf(years) {
  const n = num(years);
  if (n === null) return 1;
  let best = 1;
  let gap = Infinity;
  for (let i = 0; i < YEAR_OPTIONS.length; i += 1) {
    const g = Math.abs(YEAR_OPTIONS[i] - n);
    if (g < gap) { gap = g; best = i; }
  }
  return best;
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
function pctPoints(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((p) => {
    const t = num(p && p.t);
    const v = num(p && p.v);
    if (t !== null && v !== null) out.push({ t: t, v: (v - 1) * 100 });
  });
  return out;
}

function buildPreview(res) {
  res = res || {};
  const m = res.metrics || {};
  const curve = Array.isArray(res.curve) ? res.curve : [];
  const bench = Array.isArray(res.benchmark) ? res.benchmark : [];
  const series = [{ name: '策略', points: pctPoints(curve), color: '#ff5b3a', fill: true }];
  if (bench.length >= 2) series.push({ name: '沪深300', points: pctPoints(bench), color: '#2f7df6' });
  const markers = [];
  (Array.isArray(res.markers) ? res.markers : []).forEach((mm) => {
    const t = num(mm && mm.t);
    if (t !== null) markers.push({ t: t, type: mm.type === 'sell' ? 'sell' : 'buy' });
  });
  const trades = [];
  const rawTrades = Array.isArray(res.trades) ? res.trades : [];
  rawTrades.slice(-5).reverse().forEach((tr, i) => { trades.push(mapTrade(tr, i)); });
  const winRate = num(m.winRate);
  const kpis = [
    { label: '总收益', value: pct(m.totalReturn), dir: dirOf(m.totalReturn) },
    { label: '年化收益', value: pct(m.annualized), dir: dirOf(m.annualized) },
    { label: '最大回撤', value: num(m.maxDrawdown) === null ? '—' : fmt(m.maxDrawdown, 2) + '%', dir: 'down' },
    { label: '交易次数', value: num(m.tradeCount) === null ? '—' : fmt(m.tradeCount, 0) + '笔' },
    { label: '胜率', value: winRate === null ? '—' : fmt(winRate, 1) + '%', dir: winRate === null ? '' : (winRate >= 50 ? 'up' : 'down') },
    { label: '基准收益', value: pct(m.benchmarkReturn), dir: dirOf(m.benchmarkReturn) }
  ];
  return {
    loading: false,
    error: '',
    startDate: res.startDate || '',
    endDate: res.endDate || '',
    capitalText: money(num(res.capital)),
    kpis: kpis,
    chartSeries: series,
    markers: markers,
    trades: trades,
    current: mapCurrent(res.current),
    note: res.note || ''
  };
}

// 兼容 Node 静态检查（无 Page 全局时不抛错）
var registerPage = (typeof Page === 'function') ? Page : function () {};

registerPage({
  data: {
    isDark: false,
    editing: false,
    editId: '',
    createdAt: 0,
    name: '',
    desc: '',
    asset: { code: '600519', codeName: '贵州茅台', assetType: 'stock', label: '股票/ETF' },
    stockQuery: '',
    fundQuery: '',
    stockResults: [],
    fundResults: [],
    searchingStock: false,
    searchingFund: false,
    buy: DEFAULT_BUY,
    sell: DEFAULT_SELL,
    buyCursor: DEFAULT_BUY.length,
    sellCursor: DEFAULT_SELL.length,
    lastFocus: 'buy',
    helpers: HELPERS,
    yearOptions: YEAR_OPTIONS,
    yearIndex: 1,
    capital: '100000',
    feePct: '0.05',
    stopLoss: '10',
    takeProfit: '',
    validateState: { cls: '', text: '' },
    preview: null
  },

  onLoad(query) {
    this.applyTheme();
    const q = query || {};
    if (q.id) this.prefill(q.id);
  },

  onShow() {
    this.applyTheme();
  },

  applyTheme() {
    let theme = 'light';
    try { theme = readStore(S.THEME_KEY || 'jy_mp_theme_v1', 'light'); } catch (e) { theme = 'light'; }
    this.setData({ isDark: theme === 'dark' });
  },

  onUnload() {
    if (this._searchTimer) { clearTimeout(this._searchTimer); this._searchTimer = null; }
  },

  prefill(id) {
    let list = [];
    try { list = readStore(STRATEGIES_KEY, []); } catch (e) { list = []; }
    let saved = null;
    (Array.isArray(list) ? list : []).forEach((s) => { if (s && String(s.id) === String(id)) saved = s; });
    if (!saved || saved.type !== 'indicator') {
      toast('未找到该指标策略');
      return;
    }
    const p = saved.params || {};
    const feePct = p.fee === null || p.fee === undefined ? 0.05 : Math.round(Number(p.fee) * 100 * 10000) / 10000;
    const buy = saved.buy || DEFAULT_BUY;
    const sell = saved.sell || DEFAULT_SELL;
    this.setData({
      editing: true,
      editId: String(saved.id),
      createdAt: saved.createdAt || Date.now(),
      name: saved.name || '',
      desc: saved.desc || '',
      asset: {
        code: saved.code || '',
        codeName: saved.codeName || saved.code || '',
        assetType: saved.assetType === 'fund' ? 'fund' : 'stock',
        label: saved.assetType === 'fund' ? '基金' : '股票/ETF'
      },
      buy: buy,
      sell: sell,
      buyCursor: buy.length,
      sellCursor: sell.length,
      yearIndex: yearIndexOf(p.years),
      capital: String(num(p.capital) === null ? 100000 : p.capital),
      feePct: String(feePct),
      stopLoss: p.stopLoss === null || p.stopLoss === undefined ? '' : String(p.stopLoss),
      takeProfit: p.takeProfit === null || p.takeProfit === undefined ? '' : String(p.takeProfit)
    });
    try { wx.setNavigationBarTitle({ title: '编辑指标策略' }); } catch (e) { /* ignore */ }
  },

  /* ---------- 表单输入 ---------- */
  onInput(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (!ds.field) return;
    const patch = {};
    patch[ds.field] = (e.detail && e.detail.value) === undefined ? '' : e.detail.value;
    this.setData(patch);
  },

  onFormulaFocus(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    this.setData({ lastFocus: ds.field === 'sell' ? 'sell' : 'buy' });
  },

  onFormulaInput(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const field = ds.field === 'sell' ? 'sell' : 'buy';
    const val = e && e.detail && e.detail.value !== undefined ? e.detail.value : '';
    const cursor = e && e.detail && num(e.detail.cursor) !== null ? num(e.detail.cursor) : val.length;
    const patch = {};
    patch[field] = val;
    patch[field + 'Cursor'] = cursor;
    patch.validateState = { cls: '', text: '' };
    this.setData(patch);
  },

  onYearChange(e) {
    const idx = Number(e && e.detail ? e.detail.value : 1);
    this.setData({ yearIndex: isFinite(idx) && idx >= 0 && idx < YEAR_OPTIONS.length ? idx : 1 });
  },

  /* ---------- 公式助手：插入到当前光标处 ---------- */
  onHelperTap(e) {
    const idx = Number(e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.index : -1);
    const item = HELPERS[idx];
    if (!item) return;
    const field = this.data.lastFocus === 'sell' ? 'sell' : 'buy';
    const val = String(this.data[field] || '');
    const cursor = field === 'buy' ? this.data.buyCursor : this.data.sellCursor;
    const pos = Math.max(0, Math.min(Number(cursor) || 0, val.length));
    const next = val.slice(0, pos) + item.snippet + val.slice(pos);
    const patch = {};
    patch[field] = next;
    patch[field + 'Cursor'] = pos + item.snippet.length;
    patch.validateState = { cls: '', text: '' };
    this.setData(patch);
  },

  /* ---------- 标的搜索 ---------- */
  onStockInput(e) {
    const val = e && e.detail && e.detail.value !== undefined ? e.detail.value : '';
    this.setData({ stockQuery: val });
    this.searchDebounced('stock');
  },

  onFundInput(e) {
    const val = e && e.detail && e.detail.value !== undefined ? e.detail.value : '';
    this.setData({ fundQuery: val });
    this.searchDebounced('fund');
  },

  searchDebounced(type) {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => { this.doSearch(type); }, 280);
  },

  doSearch(type) {
    const self = this;
    const isStock = type === 'stock';
    const key = (isStock ? this.data.stockQuery : this.data.fundQuery).trim();
    const flag = isStock ? 'searchingStock' : 'searchingFund';
    const resultsKey = isStock ? 'stockResults' : 'fundResults';
    if (!key) {
      const empty = {};
      empty[resultsKey] = [];
      empty[flag] = false;
      this.setData(empty);
      return;
    }
    const start = {};
    start[flag] = true;
    this.setData(start);
    const path = isStock ? '/api/stock/search' : '/api/fund/search';
    request(path, { key: key, limit: 8 }).then((d) => {
      const items = (d && Array.isArray(d.items)) ? d.items : [];
      const list = [];
      items.forEach((it) => {
        if (!it || !it.code) return;
        const assetType = isStock ? 'stock' : 'fund';
        const extra = isStock ? (it.market || it.type || '') : (it.type || '基金');
        list.push({
          code: String(it.code),
          name: String(it.name || it.code),
          assetType: assetType,
          label: isStock ? '股票/ETF' : '基金',
          sub: String(it.code) + (extra ? ' · ' + extra : '')
        });
      });
      const patch = {};
      patch[resultsKey] = list;
      patch[flag] = false;
      self.setData(patch);
    }).catch(() => {
      const patch = {};
      patch[resultsKey] = [];
      patch[flag] = false;
      self.setData(patch);
    });
  },

  onPickStock(e) {
    this.pickAsset(e, 'stock');
  },

  onPickFund(e) {
    this.pickAsset(e, 'fund');
  },

  pickAsset(e, source) {
    const idx = Number(e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.index : -1);
    const list = source === 'fund' ? this.data.fundResults : this.data.stockResults;
    const it = (Array.isArray(list) ? list : [])[idx];
    if (!it) return;
    this.setData({
      asset: { code: it.code, codeName: it.name, assetType: it.assetType, label: it.label },
      stockQuery: '',
      fundQuery: '',
      stockResults: [],
      fundResults: [],
      preview: null
    });
  },

  /* ---------- 校验 / 回测 / 保存 ---------- */
  formError(needName) {
    if (!this.data.asset || !this.data.asset.code) return '请先选择回测标的';
    if (!String(this.data.buy || '').trim() || !String(this.data.sell || '').trim()) return '请填写买入和卖出公式';
    if (needName && !String(this.data.name || '').trim()) return '请填写策略名称';
    const cap = num(this.data.capital);
    if (cap === null || !(cap > 0)) return '请填写有效的初始资金';
    const feePct = num(this.data.feePct);
    if (feePct === null || feePct < 0) return '请填写有效的手续费率';
    return '';
  },

  buildPayload() {
    const asset = this.data.asset || {};
    const years = YEAR_OPTIONS[Number(this.data.yearIndex)] || 3;
    const capital = num(this.data.capital) === null ? 100000 : num(this.data.capital);
    let feePct = num(this.data.feePct);
    if (feePct === null || feePct < 0) feePct = 0.05;
    const payload = {
      code: asset.code,
      assetType: asset.assetType === 'fund' ? 'fund' : 'stock',
      buy: String(this.data.buy || '').trim(),
      sell: String(this.data.sell || '').trim(),
      years: years,
      capital: capital,
      fee: Math.round((feePct / 100) * 1000000) / 1000000
    };
    const sl = num(this.data.stopLoss);
    if (sl !== null && sl > 0) payload.stopLoss = sl;
    const tp = num(this.data.takeProfit);
    if (tp !== null && tp > 0) payload.takeProfit = tp;
    return payload;
  },

  onValidate() {
    const err = this.formError(false);
    if (err) {
      this.setData({ validateState: { cls: 'err', text: err } });
      toast(err);
      return Promise.resolve(null);
    }
    const payload = this.buildPayload();
    this.setData({ validateState: { cls: '', text: '正在校验公式…' } });
    return post('/api/strategy/validate', {
      buy: payload.buy,
      sell: payload.sell,
      assetType: payload.assetType
    }).then((d) => {
      if (!d || d.ok === false) throw new Error((d && d.error) || '公式校验未通过');
      const fns = (Array.isArray(d.functions) ? d.functions : []).map((x) => String(x));
      let text = '公式校验通过';
      if (fns.length) text += '（使用函数：' + fns.join('、') + '）';
      if (d.usesVolume) text += ' · 含成交量指标';
      this.setData({ validateState: { cls: 'ok', text: text } });
      return d;
    }).catch((e) => {
      this.setData({ validateState: { cls: 'err', text: errText(e) } });
      return null;
    });
  },

  onBacktest() {
    const err = this.formError(false);
    if (err) {
      toast(err);
      this.setData({ validateState: { cls: 'err', text: err } });
      return Promise.resolve(null);
    }
    const payload = this.buildPayload();
    this.setData({
      preview: {
        loading: true,
        error: '',
        kpis: [],
        chartSeries: [],
        markers: [],
        trades: [],
        current: { holding: false, holdingText: '空仓', entryDate: '', entryPriceText: '—', lastSignalText: '—', lastSignalDate: '' },
        startDate: '',
        endDate: '',
        capitalText: '—',
        note: ''
      }
    });
    return request('/api/strategy/backtest', payload).then((d) => {
      if (!d || d.ok === false) throw new Error((d && d.error) || '回测失败');
      const res = d.result || d;
      const preview = buildPreview(res);
      this.setData({ preview: preview });
      return preview;
    }).catch((e) => {
      const msg = errText(e);
      this.setData({
        preview: {
          loading: false,
          error: msg,
          kpis: [],
          chartSeries: [],
          markers: [],
          trades: [],
          current: { holding: false, holdingText: '空仓', entryDate: '', entryPriceText: '—', lastSignalText: '—', lastSignalDate: '' },
          startDate: '',
          endDate: '',
          capitalText: '—',
          note: ''
        }
      });
      toast('回测失败：' + msg);
      return null;
    });
  },

  onSave() {
    const err = this.formError(true);
    if (err) {
      toast(err);
      this.setData({ validateState: { cls: 'err', text: err } });
      return;
    }
    const payload = this.buildPayload();
    const saved = {
      id: this.data.editing ? this.data.editId : uid(),
      type: 'indicator',
      name: String(this.data.name || '').trim(),
      desc: String(this.data.desc || '').trim(),
      code: payload.code,
      codeName: this.data.asset.codeName || payload.code,
      assetType: payload.assetType,
      buy: payload.buy,
      sell: payload.sell,
      params: {
        years: payload.years,
        capital: payload.capital,
        fee: payload.fee,
        stopLoss: payload.stopLoss === undefined ? null : payload.stopLoss,
        takeProfit: payload.takeProfit === undefined ? null : payload.takeProfit
      },
      createdAt: this.data.editing && this.data.createdAt ? this.data.createdAt : Date.now()
    };
    let list = [];
    try { list = readStore(STRATEGIES_KEY, []); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    let found = -1;
    list.forEach((s, i) => { if (s && String(s.id) === String(saved.id)) found = i; });
    if (found >= 0) list[found] = saved;
    else list.push(saved);
    writeStore(STRATEGIES_KEY, list);
    toast(found >= 0 ? '策略已更新' : '策略已保存');
    try { wx.navigateBack({ delta: 1 }); } catch (e) { /* ignore */ }
  }
});
