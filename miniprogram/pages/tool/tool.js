/* 韭研 · 小程序通用工具页
 * 由 query.key 从 config/tools.js 取工具配置，渲染参数表单并请求后端：
 *   - 参数表单：input / picker / search（基金或股票搜索建议）
 *   - 自动结果：KPI 网格 / line-chart 折线 / 原生表格 / notes
 *   - custom：fear|gauge（情绪仪表）、backtest（回测摘要）、dca（定投计算）、
 *             ledger（基金账本）、alerts（策略提醒）、live（组合实盘）
 * 兼容：不依赖 DOM，仅 setData + wx:for；所有请求 catch；三态 + 下拉刷新。
 */
var apiModule = null;
try { apiModule = require('../../utils/api.js'); } catch (e) { apiModule = null; }
var formatModule = null;
try { formatModule = require('../../utils/format.js'); } catch (e) { formatModule = null; }
var storageModule = null;
try { storageModule = require('../../utils/storage.js'); } catch (e) { storageModule = null; }
var toolsConfig = require('../../config/tools.js');

var LINE_COLORS = ['#ff5b3a', '#2f7df6', '#17a673', '#f0a020', '#8e6cf0', '#20b2c9'];
var DCA_KEY = 'jy_mp_dca_v1';
var LEDGER_KEY = 'jy_mp_ledger_v1';
var ALERTS_KEY = 'jy_mp_alerts_v1';
var LIVE_KEY = 'jy_mp_portfolios_v1';

// ==================== 基础工具 ====================
function request(path, query) {
  if (apiModule && typeof apiModule.request === 'function') return apiModule.request(path, query || {});
  if (apiModule && typeof apiModule.get === 'function') return apiModule.get(path, query || {});
  return Promise.reject(new Error('api 模块未就绪'));
}
function post(path, body) {
  if (apiModule && typeof apiModule.post === 'function') return apiModule.post(path, body || {});
  return Promise.reject(new Error('api 模块未就绪'));
}
function toast(msg) {
  try {
    if (wx && typeof wx.showToast === 'function') {
      wx.showToast({ title: String(msg || '').slice(0, 40), icon: 'none' });
    }
  } catch (e) { /* 忽略 */ }
}
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}
function fmtNum(v, digits) {
  var n = toNum(v);
  if (n === null) return '—';
  var d = (digits === null || digits === undefined) ? 2 : digits;
  try {
    if (formatModule && typeof formatModule.fmt === 'function') return formatModule.fmt(n, d);
  } catch (e) { /* 回退 */ }
  return n.toFixed(d);
}
function fmtPct(v) {
  var n = toNum(v);
  if (n === null) return '—';
  return fmtNum(n, 2) + '%';
}
function fmtSigned(v) {
  var n = toNum(v);
  if (n === null) return '—';
  try {
    if (formatModule && typeof formatModule.pct === 'function') return formatModule.pct(n);
  } catch (e) { /* 回退 */ }
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}
function fmtMoney(v) {
  var n = toNum(v);
  if (n === null) return '—';
  try {
    if (formatModule && typeof formatModule.fmtMoney === 'function') return formatModule.fmtMoney(n);
  } catch (e) { /* 回退 */ }
  return (n < 0 ? '-' : '') + '¥' + wan(Math.abs(n));
}
function wan(v) {
  var n = toNum(v);
  if (n === null) return '—';
  if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(2) + '亿';
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(2) + '万';
  return n.toFixed(2);
}
function fmtYi(v) {
  var n = toNum(v);
  if (n === null) return '—';
  var x = Math.abs(n) >= 100000000 ? n / 100000000 : n;
  return x.toFixed(2) + '亿';
}
function fmtPercentile(v) {
  var n = toNum(v);
  if (n === null) return '—';
  var p = (n >= 0 && n <= 1) ? n * 100 : n;
  return p.toFixed(2) + '%';
}
function fmtYield(v) {
  var n = toNum(v);
  if (n === null) return '—';
  var p = (n > 0 && n < 1) ? n * 100 : n;
  return p.toFixed(2) + '%';
}
function fmtText(v) {
  if (v === null || v === undefined || v === '') return '—';
  return String(v);
}
function fmtBy(type, v) {
  switch (type) {
    case 'num': return fmtNum(v, 2);
    case 'int': { var n = toNum(v); return n === null ? '—' : String(Math.round(n)); }
    case 'pct': return fmtPct(v);
    case 'signed': return fmtSigned(v);
    case 'percentile': return fmtPercentile(v);
    case 'yield': return fmtYield(v);
    case 'money': return fmtMoney(v);
    case 'yi': return fmtYi(v);
    case 'text':
    default: return fmtText(v);
  }
}
function dirBy(type, v) {
  if (type !== 'signed') return '';
  var n = toNum(v);
  if (n === null) return '';
  return n > 0 ? 'up' : (n < 0 ? 'down' : '');
}
function clampNum(v, min, max, fallback) {
  var n = toNum(v);
  if (n === null) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
function getPath(obj, path) {
  if (!path) return obj;
  var parts = String(path).split('.');
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return null;
    cur = cur[parts[i]];
  }
  return cur;
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function todayStr() {
  var d = new Date();
  var p = function (x) { return (x < 10 ? '0' : '') + x; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function readStore(key, fallback) {
  try {
    if (storageModule && typeof storageModule.read === 'function') return storageModule.read(key, fallback);
  } catch (e) { /* 回退 */ }
  try {
    if (wx && typeof wx.getStorageSync === 'function') {
      var v = wx.getStorageSync(key);
      if (v === '' || v === null || v === undefined) return fallback;
      return v;
    }
  } catch (e2) { /* 忽略 */ }
  return fallback;
}
function writeStore(key, val) {
  try {
    if (storageModule && typeof storageModule.write === 'function') { storageModule.write(key, val); return; }
  } catch (e) { /* 回退 */ }
  try {
    if (wx && typeof wx.setStorageSync === 'function') wx.setStorageSync(key, val);
  } catch (e2) { /* 忽略 */ }
}
function cloneList(arr) {
  return (arr || []).map(function (x) {
    var out = {};
    for (var k in x) { if (Object.prototype.hasOwnProperty.call(x, k)) out[k] = x[k]; }
    return out;
  });
}
function buildParamsVM(params) {
  return (params || []).map(function (p) {
    var options = p.options || [];
    var def = (p.default === undefined || p.default === null) ? '' : p.default;
    var pickIndex = 0;
    var labelValue = '';
    if (p.type === 'picker') {
      for (var k = 0; k < options.length; k++) {
        if (String(options[k].value) === String(def)) { pickIndex = k; break; }
      }
      labelValue = options.length ? options[pickIndex].label : '';
      def = options.length ? options[pickIndex].value : '';
    }
    return {
      name: p.name,
      label: p.label || p.name,
      type: p.type || 'input',
      searchType: p.searchType || 'fund',
      placeholder: p.placeholder || '',
      inputType: p.inputType || 'text',
      maxLength: p.maxLength || 140,
      options: options,
      pickIndex: pickIndex,
      labelValue: labelValue,
      value: def === null || def === undefined ? '' : String(def)
    };
  });
}
function parseT(t, i) {
  if (typeof t === 'number' && isFinite(t)) return t;
  if (typeof t === 'string') {
    var s = t.trim();
    if (/^\d{10,13}$/.test(s)) {
      var n = Number(s);
      return n < 1000000000000 ? n * 1000 : n;
    }
    var d = Date.parse(s.length <= 10 ? s + 'T00:00:00' : s);
    if (!isNaN(d)) return d;
  }
  return i;
}
function mapPoints(arr) {
  var out = [];
  (arr || []).forEach(function (p, i) {
    if (p === null || p === undefined) return;
    var t;
    var v;
    if (typeof p === 'number') {
      t = i;
      v = p;
    } else {
      var rawT = p.t;
      if (rawT === undefined) rawT = p.date;
      if (rawT === undefined) rawT = p.x;
      if (rawT === undefined) rawT = p.ts;
      var rawV = p.v;
      if (rawV === undefined) rawV = p.value;
      if (rawV === undefined) rawV = p.nav;
      if (rawV === undefined) rawV = p.ratio;
      if (rawV === undefined) rawV = p.pct;
      t = parseT(rawT, i);
      v = toNum(rawV);
    }
    if (v === null) return;
    if (typeof t === 'number' && t < 1000000000) t = 1700000000000 + t * 86400000;
    out.push({ t: t, v: v });
  });
  return out;
}
function parseCodes(text) {
  return String(text || '').split(/[,，;；\s]+/).filter(function (x) { return !!x; });
}

Page({
  data: {
    key: '',
    title: '',
    desc: '',
    loading: true,
    error: '',
    hasData: false,
    isEmpty: false,
    params: [],
    freqOptions: ['每月', '每周'],
    suggestions: [],
    suggestForIndex: -1,
    kpis: [],
    notes: [],
    chartSeries: null,
    chartTitle: '',
    chartHeight: 220,
    chartPercent: true,
    table: null,
    // custom: 情绪仪表
    showGauge: false,
    gauge: { value: 0, level: '', color: '', ang: -120, factors: [], quote: null },
    // custom: 回测摘要
    showBacktest: false,
    backtest: null,
    // custom: 定投计算
    showDca: false,
    dca: {
      amount: '2000', rate: '8', years: '10', freq: 'monthly', freqLabel: '每月',
      periods: 0, invested: '—', fv: '—', gain: '—', gainDir: '', ret: '—', retDir: '',
      fearValue: '—', fearLevel: ''
    },
    // custom: 基金账本
    showLedger: false,
    ledger: { records: [], inputCode: '', inputAmount: '' },
    // custom: 策略提醒
    showAlerts: false,
    alerts: { rules: [], fearValue: '—', fearLevel: '', inputThreshold: '' },
    // custom: 组合实盘
    showLive: false,
    live: { portfolios: [], inputName: '', inputCapital: '', inputCodes: '110022,161725', creating: false }
  },

  onLoad: function (options) {
    var key = options && options.key ? String(options.key) : '';
    var tool = toolsConfig.findTool(key);
    if (!tool) {
      this.setData({ loading: false, error: '工具不存在：' + (key || '(空)') });
      return;
    }
    this.tool = tool;
    var paramsVM = buildParamsVM(tool.params);
    this._params = paramsVM;
    this.setData({
      key: tool.key,
      title: tool.title,
      desc: tool.desc || '',
      params: paramsVM,
      notes: (tool.render && tool.render.notes) || []
    });
    try {
      if (wx && typeof wx.setNavigationBarTitle === 'function') wx.setNavigationBarTitle({ title: tool.title });
    } catch (e) { /* 忽略 */ }
    this.fetchData();
  },

  onPullDownRefresh: function () {
    this.fetchData(true);
  },

  onRetry: function () {
    this.fetchData();
  },

  onQuery: function () {
    this.fetchData();
  },

  // ---------------- 参数表单 ----------------
  onParamInput: function (e) {
    var index = Number(e.currentTarget.dataset.index);
    var params = cloneList(this._params || this.data.params);
    if (!params[index]) return;
    params[index].value = e.detail.value;
    this._params = params;
    this.setData({ params: params });
  },

  onPickerChange: function (e) {
    var index = Number(e.currentTarget.dataset.index);
    var pickIndex = Number(e.detail.value);
    var params = cloneList(this._params || this.data.params);
    var p = params[index];
    if (!p || !p.options || !p.options[pickIndex]) return;
    p.pickIndex = pickIndex;
    p.value = String(p.options[pickIndex].value);
    p.labelValue = p.options[pickIndex].label;
    this._params = params;
    this.setData({ params: params });
  },

  onSearchInput: function (e) {
    var index = Number(e.currentTarget.dataset.index);
    var params = cloneList(this._params || this.data.params);
    if (!params[index]) return;
    params[index].value = e.detail.value;
    this._params = params;
    this.setData({ params: params });
    var that = this;
    var keyword = String(e.detail.value || '').trim();
    if (this._searchTimer) clearTimeout(this._searchTimer);
    if (!keyword) {
      this.setData({ suggestions: [], suggestForIndex: -1 });
      return;
    }
    this._searchTimer = setTimeout(function () { that.doSearch(index, keyword); }, 320);
  },

  doSearch: function (index, keyword) {
    var that = this;
    var param = this.data.params[index];
    if (!param) return;
    var path = param.searchType === 'stock' ? '/api/stock/search' : '/api/fund/search';
    request(path, { key: keyword, limit: 8 }).then(function (data) {
      var items = (data && data.items) || [];
      that.setData({
        suggestions: items.slice(0, 8).map(function (it) {
          return { code: it.code, name: it.name || it.code, type: it.type || '' };
        }),
        suggestForIndex: index
      });
    }).catch(function () {
      that.setData({ suggestions: [], suggestForIndex: index });
    });
  },

  onPickSuggestion: function (e) {
    var code = e.currentTarget.dataset.code;
    var index = this.data.suggestForIndex;
    var params = cloneList(this._params || this.data.params);
    if (index < 0 || !params[index]) return;
    if (this._searchTimer) { clearTimeout(this._searchTimer); this._searchTimer = null; }
    params[index].value = String(code || '');
    this._params = params;
    this.setData({ params: params, suggestions: [], suggestForIndex: -1 });
  },

  // ---------------- 请求与渲染 ----------------
  buildQuery: function () {
    var query = {};
    var fixed = this.tool && this.tool.query ? this.tool.query : {};
    for (var k in fixed) {
      if (Object.prototype.hasOwnProperty.call(fixed, k)) query[k] = fixed[k];
    }
    var params = this._params || this.data.params || [];
    for (var i = 0; i < params.length; i++) {
      var p = params[i];
      if (p.value === '' || p.value === null || p.value === undefined) continue;
      query[p.name] = p.value;
    }
    return query;
  },

  buildPostBody: function () {
    var form = {};
    (this._params || this.data.params || []).forEach(function (p) { form[p.name] = p.value; });
    if (this.tool && typeof this.tool.postBody === 'function') {
      try { return this.tool.postBody(form); } catch (e) { return form; }
    }
    return form;
  },

  fetchData: function (fromPull) {
    if (!this.tool) return;
    var that = this;
    var tool = this.tool;
    this.setData({ loading: true, error: '' });
    var promise;
    try {
      if (tool.method === 'POST') promise = post(tool.api, this.buildPostBody());
      else promise = request(tool.api, this.buildQuery());
    } catch (err) {
      promise = Promise.reject(err);
    }
    promise.then(function (data) {
      if (!data || data.ok === false) {
        throw new Error((data && data.error) || '接口返回异常');
      }
      that.applyData(data);
      if (fromPull) that.stopPull();
    }).catch(function (err) {
      that.setData({ loading: false, error: (err && err.message) || '加载失败，请稍后重试' });
      if (fromPull) that.stopPull();
    });
  },

  stopPull: function () {
    try {
      if (wx && typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh();
    } catch (e) { /* 忽略 */ }
  },

  applyData: function (data) {
    var tool = this.tool;
    var render = (tool && tool.render) || {};
    this._data = data;

    var kpis = (render.kpis || []).map(function (k) {
      var v = getPath(data, k.path);
      return { label: k.label, value: fmtBy(k.type, v), dir: dirBy(k.type, v) };
    });

    var chart = this.buildChart(render.chart, data);
    var table = this.buildTable(render.table, data);
    var patch = {
      loading: false,
      error: '',
      hasData: true,
      kpis: kpis,
      notes: render.notes || [],
      chartSeries: chart.series,
      chartTitle: chart.title,
      chartPercent: render.chart ? render.chart.percent !== false : true,
      table: table
    };
    var customPatch = this.buildCustom(tool.custom, data);
    for (var k in customPatch) {
      if (Object.prototype.hasOwnProperty.call(customPatch, k)) patch[k] = customPatch[k];
    }
    var hasCustomView = !!(patch.showGauge || patch.showBacktest || patch.showDca || patch.showLedger || patch.showAlerts || patch.showLive);
    patch.isEmpty = !kpis.length && !chart.series && !table && !(patch.notes && patch.notes.length) && !hasCustomView;
    this.setData(patch);
  },

  buildKpis: function () {
    return [];
  },

  buildChart: function (cfg, data) {
    if (!cfg) return { series: null, title: '' };
    var raw = getPath(data, cfg.path);
    var series = [];
    if (Array.isArray(raw) && raw.length) {
      var hasNestedSeries = raw.some(function (it) { return it && Array.isArray(it.series); });
      var hasNestedPoints = raw.some(function (it) { return it && Array.isArray(it.points); });
      if (hasNestedSeries) {
        raw.forEach(function (it, i) {
          if (!it || !Array.isArray(it.series)) return;
          var pts = mapPoints(it.series);
          if (pts.length) {
            series.push({
              name: it.name || it.code || ('基金' + (i + 1)),
              points: pts,
              color: LINE_COLORS[i % LINE_COLORS.length],
              fill: false
            });
          }
        });
      } else if (hasNestedPoints) {
        raw.forEach(function (s, i) {
          if (!s || !Array.isArray(s.points)) return;
          var pts = mapPoints(s.points);
          if (pts.length) {
            series.push({ name: s.name || ('序列' + (i + 1)), points: pts, color: s.color || LINE_COLORS[i % LINE_COLORS.length], fill: false });
          }
        });
      } else {
        var pts = mapPoints(raw);
        if (pts.length) series.push({ name: cfg.name || '走势', points: pts, color: LINE_COLORS[0], fill: true });
      }
    }
    return { series: series.length ? series : null, title: cfg.name || '走势' };
  },

  buildTable: function (cfg, data) {
    if (!cfg) return null;
    var raw = getPath(data, cfg.path);
    if (!Array.isArray(raw) || !raw.length) return null;
    var columns = cfg.columns || [];
    var limit = cfg.limit || 20;
    var head = columns.map(function (c, i) { return { label: c.label, key: 'h' + i }; });
    var rows = raw.slice(0, limit).map(function (row, ri) {
      var cells = columns.map(function (c, ci) {
        var v = getPath(row, c.path);
        return { key: 'c' + ci, text: fmtBy(c.type, v), dir: dirBy(c.type, v) };
      });
      return { id: 'r' + ri, cells: cells };
    });
    return {
      head: head,
      rows: rows,
      minWidth: columns.length * 160 + 40
    };
  },

  // ---------------- custom 渲染 ----------------
  buildCustom: function (kind, data) {
    var reset = {
      showGauge: false,
      showBacktest: false,
      backtest: null,
      showDca: false,
      showLedger: false,
      showAlerts: false,
      showLive: false
    };
    if (!kind) return reset;

    if (kind === 'fear') {
      var fearSrc = (data && data.fearGreed) ? data.fearGreed : data;
      var gaugePatch = this.makeGauge(fearSrc);
      if (gaugePatch) {
        reset.showGauge = true;
        reset.gauge = gaugePatch;
      }
      return reset;
    }

    if (kind === 'gauge') {
      var gp = this.makeGauge(data);
      if (gp) {
        reset.showGauge = true;
        reset.gauge = gp;
      }
      return reset;
    }

    if (kind === 'backtest') {
      var result = (data && data.result) || {};
      reset.showBacktest = true;
      reset.backtest = {
        startDate: result.startDate || '—',
        endDate: result.endDate || '—',
        rebalance: result.rebalance || '—',
        note: (data && data.note) || ''
      };
      return reset;
    }

    if (kind === 'dca') {
      var fear = (data && data.fearGreed) || {};
      var state = readStore(DCA_KEY, null) || {};
      var model = {
        amount: state.amount !== undefined ? String(state.amount) : '2000',
        rate: state.rate !== undefined ? String(state.rate) : '8',
        years: state.years !== undefined ? String(state.years) : '10',
        freq: state.freq === 'weekly' ? 'weekly' : 'monthly'
      };
      reset.showDca = true;
      reset.dca = this.computeDca(model, fear);
      return reset;
    }

    if (kind === 'ledger') {
      var records = readStore(LEDGER_KEY, []);
      if (!Array.isArray(records)) records = [];
      reset.showLedger = true;
      reset.ledger = {
        records: records.map(function (r) {
          return {
            id: r.id || uid(),
            code: r.code || '',
            name: r.name || r.code || '—',
            amount: fmtMoney(r.amount),
            nav: r.nav === null || r.nav === undefined ? '—' : fmtNum(r.nav, 4),
            date: r.date || ''
          };
        }),
        inputCode: this.data.ledger ? this.data.ledger.inputCode || '' : '',
        inputAmount: this.data.ledger ? this.data.ledger.inputAmount || '' : ''
      };
      return reset;
    }

    if (kind === 'alerts') {
      var rules = readStore(ALERTS_KEY, []);
      if (!Array.isArray(rules)) rules = [];
      var fearData = (data && data.fearGreed) || {};
      var fearValue = toNum(fearData.value);
      reset.showAlerts = true;
      reset.alerts = {
        fearValue: fearValue === null ? '—' : fearValue.toFixed(0),
        fearLevel: fearData.level || '',
        inputThreshold: this.data.alerts ? this.data.alerts.inputThreshold || '' : '',
        rules: rules.map(function (r) {
          var th = toNum(r.threshold);
          var hit = fearValue !== null && th !== null ? fearValue >= th : false;
          return { id: r.id || uid(), threshold: th === null ? '—' : th.toFixed(0), hit: hit };
        })
      };
      return reset;
    }

    if (kind === 'live') {
      var portfolios = readStore(LIVE_KEY, []);
      if (!Array.isArray(portfolios)) portfolios = [];
      var quotes = {};
      var items = (data && Array.isArray(data.items)) ? data.items : [];
      items.forEach(function (q) { if (q && q.code) quotes[q.code] = q; });
      reset.showLive = true;
      reset.live = {
        portfolios: this.buildLive(portfolios, quotes),
        inputName: this.data.live ? this.data.live.inputName || '' : '',
        inputCapital: this.data.live ? this.data.live.inputCapital || '' : '',
        inputCodes: this.data.live ? this.data.live.inputCodes || '110022,161725' : '110022,161725',
        creating: false
      };
      var that = this;
      var need = {};
      portfolios.forEach(function (p) {
        (p.funds || []).forEach(function (f) { if (f && f.code) need[f.code] = 1; });
      });
      var needList = Object.keys(need);
      if (needList.length) {
        setTimeout(function () { that.refreshLiveQuotes(needList); }, 0);
      }
      return reset;
    }

    return reset;
  },

  makeGauge: function (src) {
    if (!src) return null;
    var value = toNum(src.value);
    if (value === null) return null;
    var v = Math.max(0, Math.min(100, value));
    var factors = Array.isArray(src.factors) ? src.factors : [];
    return {
      value: v.toFixed(0),
      level: src.level || '',
      color: src.color || '#8e99a8',
      ang: (-120 + v * 2.4).toFixed(1),
      factors: factors.map(function (f) {
        var fv = toNum(f && f.value);
        return {
          label: (f && f.label) || '—',
          value: fv === null ? '—' : fv.toFixed(1),
          desc: (f && f.desc) || '',
          width: Math.max(0, Math.min(100, fv === null ? 0 : fv)).toFixed(1)
        };
      }),
      quote: src.quote ? {
        name: src.quote.name || '',
        price: fmtNum(src.quote.price, 2),
        changePct: fmtSigned(src.quote.changePct),
        dir: dirBy('signed', src.quote.changePct)
      } : null
    };
  },

  // ---------------- 定投计算 ----------------
  computeDca: function (model, fearData) {
    var amount = clampNum(model.amount, 0, 1e15, 0);
    var rate = clampNum(model.rate, -99, 1000, 0);
    var years = clampNum(model.years, 0, 100, 0);
    var freq = model.freq === 'weekly' ? 'weekly' : 'monthly';
    var ppy = freq === 'weekly' ? 52 : 12;
    var periods = Math.round(years * ppy);
    var i = (rate / 100) / ppy;
    var invested = amount * periods;
    var fv = 0;
    if (periods > 0) {
      if (Math.abs(i) < 1e-12) fv = invested;
      else if (i > -1) fv = amount * (Math.pow(1 + i, periods) - 1) / i;
    }
    var gain = fv - invested;
    var ret = invested > 0 ? (gain / invested) * 100 : null;
    var fearValue = toNum(fearData && fearData.value);
    return {
      amount: String(model.amount),
      rate: String(model.rate),
      years: String(model.years),
      freq: freq,
      freqLabel: freq === 'weekly' ? '每周' : '每月',
      periods: periods,
      invested: fmtMoney(invested),
      fv: fmtMoney(fv),
      gain: (gain > 0 ? '+¥' : gain < 0 ? '-¥' : '¥') + wan(Math.abs(gain)),
      gainDir: gain > 0 ? 'up' : (gain < 0 ? 'down' : ''),
      ret: ret === null ? '—' : (ret > 0 ? '+' : '') + ret.toFixed(2) + '%',
      retDir: ret === null ? '' : (ret > 0 ? 'up' : (ret < 0 ? 'down' : '')),
      fearValue: fearValue === null ? '—' : fearValue.toFixed(0),
      fearLevel: (fearData && fearData.level) || ''
    };
  },

  saveDca: function (dca) {
    writeStore(DCA_KEY, { amount: dca.amount, rate: dca.rate, years: dca.years, freq: dca.freq });
  },

  onDcaInput: function (e) {
    var field = e.currentTarget.dataset.field;
    if (!field) return;
    var dca = this.data.dca;
    dca[field] = e.detail.value;
    var next = this.computeDca(dca, this._data ? this._data.fearGreed : null);
    this.saveDca(next);
    this.setData({ dca: next });
  },

  onDcaPickFreq: function (e) {
    var dca = this.data.dca;
    dca.freq = Number(e.detail.value) === 1 ? 'weekly' : 'monthly';
    var next = this.computeDca(dca, this._data ? this._data.fearGreed : null);
    this.saveDca(next);
    this.setData({ dca: next });
  },

  // ---------------- 基金账本 ----------------
  onLedgerInput: function (e) {
    var field = e.currentTarget.dataset.field;
    if (!field) return;
    var ledger = this.data.ledger;
    ledger[field] = e.detail.value;
    this.setData({ ledger: ledger });
  },

  onLedgerAdd: function () {
    var that = this;
    var code = String(this.data.ledger.inputCode || '').trim();
    var amount = toNum(this.data.ledger.inputAmount);
    if (!code) { toast('请输入基金代码'); return; }
    if (amount === null || amount <= 0) { toast('请输入大于 0 的买入金额'); return; }
    if (!/^\d{6}$/.test(code)) { toast('基金代码为 6 位数字'); return; }
    request('/api/fund/quotes', { codes: code }).then(function (data) {
      var quote = data && data.items && data.items[0] ? data.items[0] : null;
      var records = readStore(LEDGER_KEY, []);
      if (!Array.isArray(records)) records = [];
      records.unshift({
        id: uid(),
        code: code,
        name: (quote && quote.name) || code,
        nav: quote ? quote.nav : null,
        amount: amount,
        date: todayStr()
      });
      writeStore(LEDGER_KEY, records);
      var ledger = that.data.ledger;
      ledger.records = records.map(function (r) {
        return {
          id: r.id, code: r.code, name: r.name || r.code,
          amount: fmtMoney(r.amount),
          nav: r.nav === null || r.nav === undefined ? '—' : fmtNum(r.nav, 4),
          date: r.date || ''
        };
      });
      ledger.inputCode = '';
      ledger.inputAmount = '';
      that.setData({ ledger: ledger });
      toast('已记一笔');
    }).catch(function (err) {
      toast('记录失败：' + ((err && err.message) || '网络异常'));
    });
  },

  onLedgerDelete: function (e) {
    var id = e.currentTarget.dataset.id;
    var records = readStore(LEDGER_KEY, []);
    if (!Array.isArray(records)) records = [];
    records = records.filter(function (r) { return r.id !== id; });
    writeStore(LEDGER_KEY, records);
    var ledger = this.data.ledger;
    ledger.records = ledger.records.filter(function (r) { return r.id !== id; });
    this.setData({ ledger: ledger });
  },

  // ---------------- 策略提醒 ----------------
  onAlertInput: function (e) {
    var alerts = this.data.alerts;
    alerts.inputThreshold = e.detail.value;
    this.setData({ alerts: alerts });
  },

  onAlertAdd: function () {
    var threshold = toNum(this.data.alerts.inputThreshold);
    if (threshold === null || threshold < 0 || threshold > 100) { toast('请输入 0-100 的恐贪阈值'); return; }
    var rules = readStore(ALERTS_KEY, []);
    if (!Array.isArray(rules)) rules = [];
    rules.push({ id: uid(), threshold: threshold, createdAt: Date.now() });
    writeStore(ALERTS_KEY, rules);
    this.applyAlerts(rules);
  },

  onAlertDelete: function (e) {
    var id = e.currentTarget.dataset.id;
    var rules = readStore(ALERTS_KEY, []);
    if (!Array.isArray(rules)) rules = [];
    rules = rules.filter(function (r) { return r.id !== id; });
    writeStore(ALERTS_KEY, rules);
    this.applyAlerts(rules);
  },

  applyAlerts: function (rules) {
    var fear = (this._data && this._data.fearGreed) || {};
    var fearValue = toNum(fear.value);
    var alerts = this.data.alerts;
    alerts.inputThreshold = '';
    alerts.fearValue = fearValue === null ? '—' : fearValue.toFixed(0);
    alerts.fearLevel = fear.level || '';
    alerts.rules = (rules || []).map(function (r) {
      var th = toNum(r.threshold);
      var hit = fearValue !== null && th !== null ? fearValue >= th : false;
      return { id: r.id || uid(), threshold: th === null ? '—' : th.toFixed(0), hit: hit };
    });
    this.setData({ alerts: alerts });
  },

  // ---------------- 组合实盘 ----------------
  onLiveInput: function (e) {
    var field = e.currentTarget.dataset.field;
    if (!field) return;
    var live = this.data.live;
    live[field] = e.detail.value;
    this.setData({ live: live });
  },

  buildLive: function (portfolios, quotes) {
    return (portfolios || []).map(function (p) {
      var capital = toNum(p.capital) || 0;
      var value = 0;
      (p.funds || []).forEach(function (f) {
        var q = quotes && quotes[f.code] ? quotes[f.code] : null;
        var nav = q ? toNum(q.nav) : toNum(f.buyNav);
        var weight = toNum(f.weight) || 0;
        var buyNav = toNum(f.buyNav);
        var shares = toNum(f.shares);
        if (shares === null && buyNav !== null && buyNav > 0) shares = capital * weight / 100 / buyNav;
        value += (nav || 0) * (shares || 0);
      });
      var gain = value - capital;
      return {
        id: p.id || uid(),
        name: p.name || '组合',
        capital: fmtMoney(capital),
        value: fmtMoney(value),
        gain: (gain > 0 ? '+¥' : gain < 0 ? '-¥' : '¥') + wan(Math.abs(gain)),
        gainDir: gain > 0 ? 'up' : (gain < 0 ? 'down' : ''),
        count: (p.funds || []).length
      };
    });
  },

  refreshLiveQuotes: function (codes) {
    var that = this;
    if (!codes || !codes.length) return;
    request('/api/fund/quotes', { codes: codes.join(',') }).then(function (data) {
      var quotes = {};
      var items = (data && Array.isArray(data.items)) ? data.items : [];
      items.forEach(function (q) { if (q && q.code) quotes[q.code] = q; });
      var portfolios = readStore(LIVE_KEY, []);
      if (!Array.isArray(portfolios)) portfolios = [];
      that.setData({ live: that.buildLive(portfolios, quotes) });
    }).catch(function () { /* 忽略，保留成本估值 */ });
  },

  onLiveCreate: function () {
    var that = this;
    var name = String(this.data.live.inputName || '').trim();
    var capital = toNum(this.data.live.inputCapital);
    var codes = parseCodes(this.data.live.inputCodes);
    if (!name) { toast('请输入组合名称'); return; }
    if (capital === null || capital <= 0) { toast('请输入初始资金'); return; }
    if (codes.length < 2 || codes.length > 5) { toast('请输入 2-5 只基金代码'); return; }
    var live = this.data.live;
    live.creating = true;
    this.setData({ live: live });
    request('/api/fund/quotes', { codes: codes.join(',') }).then(function (data) {
      var quotes = {};
      var items = (data && Array.isArray(data.items)) ? data.items : [];
      items.forEach(function (q) { if (q && q.code) quotes[q.code] = q; });
      var weight = 100 / codes.length;
      var funds = codes.map(function (code) {
        var q = quotes[code] || {};
        var buyNav = toNum(q.nav);
        return {
          code: code,
          name: q.name || code,
          weight: Math.round(weight * 100) / 100,
          buyNav: buyNav,
          shares: buyNav ? capital * weight / 100 / buyNav : null
        };
      });
      var portfolios = readStore(LIVE_KEY, []);
      if (!Array.isArray(portfolios)) portfolios = [];
      portfolios.unshift({ id: uid(), name: name, capital: capital, funds: funds, createdAt: Date.now() });
      writeStore(LIVE_KEY, portfolios);
      var now = that.data.live;
      now.inputName = '';
      now.inputCapital = '';
      now.portfolios = that.buildLive(portfolios, quotes);
      now.creating = false;
      that.setData({ live: now });
      toast('组合已创建');
    }).catch(function (err) {
      var now = that.data.live;
      now.creating = false;
      that.setData({ live: now });
      toast('创建失败：' + ((err && err.message) || '网络异常'));
    });
  },

  onLiveDelete: function (e) {
    var id = e.currentTarget.dataset.id;
    var portfolios = readStore(LIVE_KEY, []);
    if (!Array.isArray(portfolios)) portfolios = [];
    portfolios = portfolios.filter(function (p) { return p.id !== id; });
    writeStore(LIVE_KEY, portfolios);
    var live = this.data.live;
    live.portfolios = live.portfolios.filter(function (p) { return p.id !== id; });
    this.setData({ live: live });
  }
});
