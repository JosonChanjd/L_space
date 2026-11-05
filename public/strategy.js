/* 韭研 · 投研工作台 —— 策略页（strategy.js）
 * ---------------------------------------------------------------------------
 * 页面结构（index.html 已就绪）：
 *   <section class="view" data-view="strategy">
 *     <div class="view-head">…<button id="strategyCreateBtn">+ 新建策略</button></div>
 *     <div id="strategyHome"></div>
 *     <div class="tool-view hidden" id="strategyView"></div>
 *   </section>
 *
 * 功能：
 *   1. 策略首页：5 个组合推荐模板（异步加载近 1 年收益）+ 技术指标策略模板区
 *      （GET /api/strategy/templates）+ 我的策略（本机 localStorage，支持组合策略 / 指标策略两种类型）
 *   2. 组合策略详情：本期收益率大字 / 组合金额·累计盈亏·记账天数 / 区间切换 /
 *      时间加权收益 + 沪深300 基准 / 4 个 Tab（业绩走势·组合回撤·盈亏金额·实时估值）/
 *      持仓环形图 + 表格 / 编辑·复制·重新计算·删除
 *   3. 指标策略详情（GET /api/strategy/backtest）：回测收益率 hero / 区间 chips（近1/3/5年·全部）/
 *      策略 vs 沪深300 / 4 个 Tab（业绩走势含买卖点标记·组合回撤·交易明细·公式说明）/
 *      当前状态卡 / 编辑·重新计算·删除·复制
 *   4. 新建策略先选类型（组合配置 / 指标公式）；指标公式表单支持标的搜索、买入卖出公式、
 *      公式助手 chips、校验（POST /api/strategy/validate）、回测预览与保存
 *
 * 依赖：window.JYXT（public/tools.js 提供）、window.JY.onView（public/app.js）
 * 数据：GET /api/portfolio/backtest（新字段：curve/benchmark/drawdown/benchmarkDrawdown/
 *       pnl/metrics/items/today/startDate/endDate/note）
 *       GET /api/strategy/templates、POST /api/strategy/validate、GET /api/strategy/backtest
 *       GET /api/fund/search（经 JYXT.fundSearch）、GET /api/stock/search、
 *       GET /api/fund/quotes、GET /api/quote（实时估值兜底）
 * 写作用域：仅本文件。原生 JS、零依赖、无外链。
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var JYXT = window.JYXT;
  if (!JYXT) {
    if (window.console && console.warn) console.warn('[strategy] window.JYXT 未就绪，策略页未加载');
    return;
  }
  var JY = window.JY || {};

  var esc = JYXT.esc;
  var fmt = JYXT.fmt;
  var num = JYXT.num;
  var pctDir = JYXT.pctDir;
  var fmtSigned = JYXT.fmtSigned;
  var fmtDate = JYXT.fmtDate;
  var uid = JYXT.uid;
  var api = JYXT.api;
  var toast = JYXT.toast;
  var storage = JYXT.storage;

  // =========================================================================
  // 常量
  // =========================================================================
  var LS_KEY = 'jy_strategies_v1';
  var CACHE_TTL = 5 * 60 * 1000;
  var MAX_HOLDINGS = 8;
  var DAY_MS = 86400000;

  var C_PORT = '#ff5b3a';
  var C_BENCH = '#2f7df6';
  var C_DOWN = '#17a673';

  var RANGES = [
    { key: 'ytd', label: '今年以来' },
    { key: '1m', label: '近1月' },
    { key: '3m', label: '近3月' },
    { key: '6m', label: '近6月' },
    { key: '1y', label: '近1年' },
    { key: '3y', label: '近3年' },
    { key: 'since', label: '成立来' }
  ];

  var REBALANCES = [
    { key: 'monthly', label: '每月' },
    { key: 'quarterly', label: '每季度' },
    { key: 'halfyearly', label: '每半年' },
    { key: 'yearly', label: '每年' },
    { key: 'none', label: '不再平衡' }
  ];

  var TABS = [
    { key: 'trend', label: '业绩走势' },
    { key: 'drawdown', label: '组合回撤' },
    { key: 'pnl', label: '盈亏金额' },
    { key: 'today', label: '实时估值' }
  ];

  // ---------- 技术指标策略常量（task-16） ----------
  var IND_RANGES = [
    { key: '1y', label: '近1年', years: 1 },
    { key: '3y', label: '近3年', years: 3 },
    { key: '5y', label: '近5年', years: 5 },
    { key: 'all', label: '全部', years: 20 }
  ];
  var IND_YEARS = [1, 3, 5, 10, 20];
  var IND_TABS = [
    { key: 'trend', label: '业绩走势' },
    { key: 'drawdown', label: '组合回撤' },
    { key: 'trades', label: '交易明细' },
    { key: 'formula', label: '公式说明' }
  ];
  var IND_DEFAULT_PARAMS = { years: 3, capital: 100000, fee: 0.0005, stopLoss: 10, takeProfit: null };
  var IND_BUILTIN_FUNCTIONS = [
    'MA', 'EMA', 'REF', 'HHV', 'LLV', 'SUM', 'STD', 'ABS', 'MAX', 'MIN',
    'CROSS', 'CROSSDOWN', 'RSI', 'DIF', 'DEA', 'MACD_HIST', 'KDJ_K', 'KDJ_D',
    'BOLL_MID', 'BOLL_UPPER', 'BOLL_LOWER', 'TD_BUY', 'TD_SELL'
  ];
  // 公式助手 chips：点击把片段插入当前光标处的 textarea
  var IND_FORMULA_HELPERS = [
    { label: 'MA金叉', snippet: 'CROSS(MA(CLOSE,5),MA(CLOSE,20))' },
    { label: 'CROSSDOWN', snippet: 'CROSSDOWN(MA(CLOSE,5),MA(CLOSE,20))' },
    { label: 'MACD金叉', snippet: 'CROSS(DIF(CLOSE,12,26),DEA(CLOSE,12,26,9))' },
    { label: '神奇九转', snippet: 'TD_BUY(CLOSE)==9' },
    { label: '量价齐升', snippet: 'CLOSE>MA(CLOSE,20) AND VOL>MA(VOL,5)*1.5' },
    { label: '均线多头', snippet: 'MA(CLOSE,5)>MA(CLOSE,10) AND MA(CLOSE,10)>MA(CLOSE,20)' },
    { label: 'RSI超卖', snippet: 'RSI(CLOSE,14)<30' },
    { label: '布林突破', snippet: 'CROSS(CLOSE,BOLL_UPPER(CLOSE,20,2))' }
  ];

  // 推荐模板（向后端回测引擎传 codes/types/weights/start/rebalance/capital）
  var TEMPLATES = [
    {
      id: 'tpl-gold',
      name: '黄金恐贪1期',
      icon: '🥇',
      desc: '黄金 ETF 联接基金满仓跟踪金价，季度再平衡；用恐贪指数辅助判断加减仓节奏。',
      baseYears: 3,
      rebalance: 'quarterly',
      capital: 100000,
      holdings: [{ code: '004253', name: '国泰黄金ETF联接C', type: 'fund', weight: 100 }]
    },
    {
      id: 'tpl-dividend',
      name: '红利低波',
      icon: '🧧',
      desc: '红利 ETF + 红利低波 ETF + 低波固收资产，季度再平衡，追求低波动下的红利现金流。',
      baseYears: 5,
      rebalance: 'quarterly',
      capital: 100000,
      holdings: [
        { code: '510880', name: '红利ETF', type: 'fund', weight: 30 },
        { code: '512890', name: '红利低波ETF', type: 'fund', weight: 30 },
        { code: '003096', name: '低波固收基金', type: 'fund', weight: 40 }
      ]
    },
    {
      id: 'tpl-global',
      name: '全球资产配置',
      icon: '🌍',
      desc: '沪深300 + 纳指 + 黄金 + 固收 的多资产组合，季度再平衡，分散单一市场风险。',
      baseYears: 5,
      rebalance: 'quarterly',
      capital: 100000,
      holdings: [
        { code: '510300', name: '沪深300ETF', type: 'fund', weight: 40 },
        { code: '513100', name: '纳指ETF', type: 'fund', weight: 30 },
        { code: '518880', name: '黄金ETF', type: 'fund', weight: 20 },
        { code: '003096', name: '低波固收基金', type: 'fund', weight: 10 }
      ]
    },
    {
      id: 'tpl-tech',
      name: '科技成长',
      icon: '🚀',
      desc: '纳指 + AI + 创业板50 三线成长，季度再平衡，波动较高，适合长期风险偏好较高者。',
      baseYears: 3,
      rebalance: 'quarterly',
      capital: 100000,
      holdings: [
        { code: '513100', name: '纳指ETF', type: 'fund', weight: 50 },
        { code: '515070', name: 'AI ETF', type: 'fund', weight: 30 },
        { code: '159949', name: '创业板50ETF', type: 'fund', weight: 20 }
      ]
    },
    {
      id: 'tpl-balance',
      name: '股债平衡',
      icon: '⚖️',
      desc: '沪深300 与固收资产 5:5 经典平衡，季度再平衡，用纪律代替择时。',
      baseYears: 5,
      rebalance: 'quarterly',
      capital: 100000,
      holdings: [
        { code: '510300', name: '沪深300ETF', type: 'fund', weight: 50 },
        { code: '003096', name: '低波固收基金', type: 'fund', weight: 50 }
      ]
    }
  ];

  // 模板起始日期：优先用显式 startDate，否则按 baseYears 回填（成立来区间）
  TEMPLATES.forEach(function (t) {
    t.startDate = isDateStr(t.startDate) ? String(t.startDate) : yearsAgo(t.baseYears || 3);
  });

  // =========================================================================
  // 基础工具（ES5）
  // =========================================================================
  function q(sel, root) {
    try { return (root || document).querySelector(sel); } catch (e) { return null; }
  }
  function qa(sel, root) {
    try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; }
  }
  function enc(v) { return encodeURIComponent(String(v == null ? '' : v)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) {
    if (!(d instanceof Date) || !isFinite(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function todayStr() { return ymd(new Date()); }
  function monthsAgo(n) {
    var d = new Date();
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() - n);
    var dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, dim));
    return ymd(d);
  }
  function yearsAgo(n) {
    var d = new Date();
    var day = d.getDate();
    d.setDate(1);
    d.setFullYear(d.getFullYear() - n);
    var dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, dim));
    return ymd(d);
  }
  function parseTs(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') {
      var d0 = new Date(v);
      return isFinite(d0.getTime()) ? d0.getTime() : null;
    }
    var s = String(v);
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) {
      var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return isFinite(d.getTime()) ? d.getTime() : null;
    }
    var t = Date.parse(s);
    return isFinite(t) ? t : null;
  }
  function daysBetween(a, b) {
    var t1 = parseTs(a);
    var t2 = parseTs(b);
    if (t1 == null || t2 == null) return null;
    return Math.max(0, Math.round((t2 - t1) / DAY_MS));
  }
  function round2(v) {
    var n = num(v);
    if (n == null) return null;
    return Math.round(n * 100) / 100;
  }
  function roundTo(v, digits) {
    var n = num(v);
    if (n == null) return null;
    var base = Math.pow(10, digits == null ? 2 : digits);
    return Math.round(n * base) / base;
  }
  function clampInt(v, min, max, dft) {
    var n = num(v);
    if (n == null) return dft;
    n = Math.round(n);
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }
  function isDateStr(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v == null ? '' : v)); }

  // ---------- 格式化 ----------
  function signedPct(v) {
    var n = num(v);
    if (n == null) return '—';
    return (n > 0 ? '+' : '') + fmt(n, 2) + '%';
  }
  function money(v) {
    var n = num(v);
    if (n == null) return '—';
    var abs = Math.abs(n);
    if (abs >= 100000000) return '¥' + fmt(n / 100000000, 2) + '亿';
    if (abs >= 10000) return '¥' + fmt(n / 10000, 2) + '万';
    return '¥' + fmt(n, 2);
  }
  function signedMoney(v) {
    var n = num(v);
    if (n == null) return '—';
    var sign = n > 0 ? '+' : (n < 0 ? '-' : '');
    return sign + money(Math.abs(n));
  }
  function rebalanceLabel(key) {
    for (var i = 0; i < REBALANCES.length; i += 1) {
      if (REBALANCES[i].key === key) return REBALANCES[i].label;
    }
    return '每季度';
  }
  function rangeLabel(key) {
    for (var i = 0; i < RANGES.length; i += 1) {
      if (RANGES[i].key === key) return RANGES[i].label;
    }
    return '近1年';
  }
  function typeLabel(type) { return type === 'stock' ? '股票' : '基金'; }
  function typeBadge(type) {
    return type === 'stock'
      ? '<span class="t-badge mid">股票</span>'
      : '<span class="t-badge">基金</span>';
  }
  function legendItem(color, label, extra) {
    return '<span class="t-legend-item"><i class="t-dot" style="background:' + color + '"></i>' +
      esc(label) + (extra ? ' ' + extra : '') + '</span>';
  }

  // =========================================================================
  // 应用状态
  // =========================================================================
  var APP = {
    activated: false,
    tplState: {},        // templateId -> { status:'loading'|'done'|'error', ret, error }
    mine: {},            // strategyId -> { status:'loading'|'done'|'error', data, error }
    detail: null,        // { target, range, tab, data, loading, error, seq, todayFallback, todayFetching }
    form: null,          // 自建/编辑表单状态
    viewHead: null,      // 详情页隐藏的主 view-head
    tplQueue: [],
    tplBusy: false,
    mineQueue: [],
    mineBusy: false,
    detailCache: {},     // key -> { ts, data }
    formSeq: 0,
    // ---------- 技术指标策略 ----------
    indTpl: { status: 'idle', items: [], error: null }, // /api/strategy/templates
    indCache: {},        // 指标回测缓存 key -> { ts, data }
    idetail: null,       // { target, range, tab, data, loading, error, seq }
    indForm: null,       // 指标公式表单状态
    indFormSeq: 0
  };

  function strategySection() { return q('.view[data-view="strategy"]'); }
  function homeEl() { return q('#strategyHome'); }
  function viewEl() { return q('#strategyView'); }
  function detailBody() { return q('#stratDetailBody'); }
  function scrollStrategyTop() {
    var sec = strategySection();
    if (sec) sec.scrollTop = 0;
  }
  function hideViewHead() {
    var sec = strategySection();
    if (!sec) return;
    var head = q('.view-head', sec);
    if (!head) return;
    APP.viewHead = head;
    head.classList.add('hidden');
  }
  function restoreViewHead() {
    if (!APP.viewHead) return;
    if (APP.viewHead.classList) APP.viewHead.classList.remove('hidden');
    APP.viewHead = null;
  }

  // =========================================================================
  // 本地存储
  // =========================================================================
  function normalizeIndicatorParams(p) {
    p = p || {};
    var stop = num(p.stopLoss);
    var take = num(p.takeProfit);
    return {
      years: clampInt(p.years, 1, 20, 3),
      capital: num(p.capital) == null ? 100000 : round2(p.capital),
      fee: num(p.fee) == null ? 0.0005 : num(p.fee),
      stopLoss: stop == null || stop <= 0 ? null : round2(stop),
      takeProfit: take == null || take <= 0 ? null : round2(take)
    };
  }
  function normalizeIndicatorStrategy(s) {
    return {
      id: String(s.id),
      type: 'indicator',
      name: String(s.name),
      desc: String(s.desc || ''),
      code: String(s.code),
      codeName: String(s.codeName || s.code),
      assetType: s.assetType === 'fund' ? 'fund' : 'stock',
      buy: String(s.buy),
      sell: String(s.sell),
      params: normalizeIndicatorParams(s.params),
      createdAt: num(s.createdAt) || Date.now()
    };
  }
  function loadStrategies() {
    var arr = storage.get(LS_KEY, []);
    if (!Array.isArray(arr)) return [];
    var out = [];
    arr.forEach(function (s) {
      if (!s || !s.id || !s.name) return;
      // 指标公式策略：type === 'indicator'（旧数据无 type 字段，视为组合策略，向后兼容）
      if (s.type === 'indicator') {
        if (!s.code || !s.buy || !s.sell) return;
        out.push(normalizeIndicatorStrategy(s));
        return;
      }
      if (!Array.isArray(s.holdings)) return;
      var holdings = [];
      s.holdings.forEach(function (h) {
        if (!h || !h.code) return;
        holdings.push({
          code: String(h.code),
          name: String(h.name || h.code),
          type: h.type === 'stock' ? 'stock' : 'fund',
          weight: num(h.weight)
        });
      });
      if (!holdings.length) return;
      out.push({
        id: String(s.id),
        name: String(s.name),
        desc: String(s.desc || ''),
        capital: num(s.capital) || 100000,
        startDate: isDateStr(s.startDate) ? String(s.startDate) : yearsAgo(3),
        rebalance: rebalanceValid(s.rebalance),
        holdings: holdings,
        createdAt: num(s.createdAt) || Date.now()
      });
    });
    return out;
  }
  function saveStrategies(list) {
    storage.set(LS_KEY, Array.isArray(list) ? list : []);
  }
  function findStrategy(id) {
    var list = loadStrategies();
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === String(id)) return list[i];
    }
    return null;
  }
  function deleteStrategy(id) {
    var list = loadStrategies().filter(function (s) { return s.id !== String(id); });
    saveStrategies(list);
    delete APP.mine[id];
    delete APP.mine[String(id)];
  }
  function rebalanceValid(key) {
    for (var i = 0; i < REBALANCES.length; i += 1) {
      if (REBALANCES[i].key === key) return key;
    }
    return 'quarterly';
  }

  // =========================================================================
  // 目标（模板 / 我的策略）与回测请求
  // =========================================================================
  function templateById(id) {
    for (var i = 0; i < TEMPLATES.length; i += 1) {
      if (TEMPLATES[i].id === id) return TEMPLATES[i];
    }
    return null;
  }
  function templateTarget(tpl) {
    var t = tpl;
    if (!t) return null;
    return {
      kind: 'template',
      id: t.id,
      tplId: t.id,
      name: t.name,
      desc: t.desc,
      icon: t.icon,
      capital: num(t.capital) || 100000,
      startDate: isDateStr(t.startDate) ? t.startDate : yearsAgo(t.baseYears || 3),
      rebalance: rebalanceValid(t.rebalance),
      baseYears: num(t.baseYears) || 3,
      holdings: t.holdings.map(function (h) {
        return { code: h.code, name: h.name, type: h.type, weight: h.weight };
      })
    };
  }
  function mineTarget(s) {
    return {
      kind: 'mine',
      id: s.id,
      name: s.name,
      desc: s.desc,
      icon: '🧭',
      capital: num(s.capital) || 100000,
      startDate: s.startDate,
      rebalance: rebalanceValid(s.rebalance),
      baseYears: 3,
      createdAt: s.createdAt,
      holdings: s.holdings.map(function (h) {
        return { code: h.code, name: h.name, type: h.type, weight: h.weight };
      })
    };
  }
  function targetKey(t) {
    var holdKey = (t.holdings || []).map(function (h) {
      return (h.type || 'fund') + ':' + h.code + ':' + (num(h.weight) == null ? '' : num(h.weight));
    }).join('|');
    return [t.kind, t.id || '', holdKey, t.startDate || '', t.rebalance || '', num(t.capital) || 100000].join('~');
  }

  // ---------- 指标策略目标 / 区间 / 回测请求 ----------
  function indicatorTarget(s) {
    return {
      kind: 'indicator',
      id: s.id,
      template: false,
      name: s.name,
      desc: s.desc || '',
      icon: '📈',
      code: s.code,
      codeName: s.codeName || s.code,
      assetType: s.assetType === 'fund' ? 'fund' : 'stock',
      buy: s.buy || '',
      sell: s.sell || '',
      params: normalizeIndicatorParams(s.params),
      createdAt: s.createdAt
    };
  }
  function templateIndicatorTarget(it) {
    return {
      kind: 'indicator',
      id: 'tpl-' + String(it.key || it.name || ''),
      template: true,
      tplKey: String(it.key || ''),
      name: String(it.name || '指标策略'),
      desc: String(it.desc || ''),
      icon: it.icon || '📈',
      badge: String(it.badge || ''),
      code: String(it.code || ''),
      codeName: String(it.codeName || it.code || ''),
      assetType: it.assetType === 'fund' ? 'fund' : 'stock',
      buy: String(it.buy || ''),
      sell: String(it.sell || ''),
      params: normalizeIndicatorParams(it.params),
      createdAt: Date.now()
    };
  }
  function indicatorTargetKey(t) {
    return ['ind', t.id || '', t.code || '', t.assetType || 'stock', t.buy || '', t.sell || '',
      t.params.years, t.params.capital, t.params.fee,
      t.params.stopLoss == null ? '' : t.params.stopLoss,
      t.params.takeProfit == null ? '' : t.params.takeProfit].join('~');
  }
  // 区间 chips：近1/3/5年 + 全部；若保存的年限不在标准档位，额外插入「近N年」并作为默认
  function indicatorRanges(target) {
    var ys = target && target.params ? clampInt(target.params.years, 1, 20, 3) : 3;
    var list = [];
    var found = false;
    IND_RANGES.forEach(function (r) {
      if (r.key === 'all') return;
      if (r.years === ys) found = true;
      list.push({ key: r.key, label: r.label, years: r.years });
    });
    if (!found) list.push({ key: 'saved', label: '近' + ys + '年', years: ys });
    list.sort(function (a, b) { return a.years - b.years; });
    list.push({ key: 'all', label: '全部', years: 20 });
    return list;
  }
  function defaultIndicatorRange(target) {
    var ys = target && target.params ? clampInt(target.params.years, 1, 20, 3) : 3;
    var ranges = indicatorRanges(target);
    var key = '3y';
    for (var i = 0; i < ranges.length; i += 1) {
      if (ranges[i].years === ys) key = ranges[i].key;
    }
    return key;
  }
  function indicatorRangeYears(rangeKey, target) {
    if (rangeKey === 'form') {
      return target && target.params ? clampInt(target.params.years, 1, 20, 3) : 3;
    }
    var ranges = indicatorRanges(target);
    for (var i = 0; i < ranges.length; i += 1) {
      if (ranges[i].key === rangeKey) return ranges[i].years;
    }
    return 3;
  }
  function indicatorRangeLabel(rangeKey, target) {
    var ranges = indicatorRanges(target);
    for (var i = 0; i < ranges.length; i += 1) {
      if (ranges[i].key === rangeKey) return ranges[i].label;
    }
    return '近3年';
  }
  function buildIndicatorQuery(target, rangeKey) {
    var p = target.params || IND_DEFAULT_PARAMS;
    var parts = [
      'code=' + enc(target.code),
      'assetType=' + enc(target.assetType === 'fund' ? 'fund' : 'stock'),
      'buy=' + enc(target.buy || ''),
      'sell=' + enc(target.sell || ''),
      'years=' + enc(indicatorRangeYears(rangeKey, target)),
      'capital=' + enc(num(p.capital) || 100000),
      'fee=' + enc(num(p.fee) == null ? 0.0005 : p.fee)
    ];
    var stop = num(p.stopLoss);
    var take = num(p.takeProfit);
    if (stop != null && stop > 0) parts.push('stopLoss=' + enc(stop));
    if (take != null && take > 0) parts.push('takeProfit=' + enc(take));
    return '/api/strategy/backtest?' + parts.join('&');
  }
  function fetchIndicatorBacktest(target, rangeKey, force) {
    var key = indicatorTargetKey(target) + '~' + rangeKey;
    var cached = APP.indCache[key];
    if (!force && cached && (Date.now() - cached.ts) < CACHE_TTL) {
      return Promise.resolve(cached.data);
    }
    var url = buildIndicatorQuery(target, rangeKey);
    return api(url).then(function (data) {
      if (!data || data.ok === false || !data.result) {
        var msg = (data && (data.error || data.note)) || '指标回测服务暂不可用';
        throw new Error(msg);
      }
      APP.indCache[key] = { ts: Date.now(), data: data.result };
      return data.result;
    });
  }
  function rangeStart(rangeKey, target) {
    var cand = null;
    if (rangeKey === 'ytd') cand = todayStr().slice(0, 4) + '-01-01';
    else if (rangeKey === '1m') cand = monthsAgo(1);
    else if (rangeKey === '3m') cand = monthsAgo(3);
    else if (rangeKey === '6m') cand = monthsAgo(6);
    else if (rangeKey === '1y') cand = monthsAgo(12);
    else if (rangeKey === '3y') cand = monthsAgo(36);
    if (cand && target.kind === 'mine' && isDateStr(target.startDate)) {
      // 自建策略的区间不能早于策略起始日（更早的区间回测没有意义）
      var tCand = parseTs(cand);
      var tStart = parseTs(target.startDate);
      if (tCand != null && tStart != null && tStart > tCand) return target.startDate;
    }
    if (cand) return cand;
    if (rangeKey === 'since') {
      if (isDateStr(target.startDate)) return target.startDate;
      return null;
    }
    return null;
  }
  function buildBacktestQuery(target, rangeKey) {
    var codes = [];
    var types = [];
    var weights = [];
    (target.holdings || []).forEach(function (h) {
      codes.push(h.code);
      types.push(h.type === 'stock' ? 'stock' : 'fund');
      weights.push(num(h.weight) == null ? 0 : num(h.weight));
    });
    var parts = [
      'codes=' + enc(codes.join(',')),
      'types=' + enc(types.join(',')),
      'weights=' + enc(weights.join(',')),
      'capital=' + enc(num(target.capital) || 100000),
      'rebalance=' + enc(rebalanceValid(target.rebalance))
    ];
    var start = rangeStart(rangeKey, target);
    if (start) {
      parts.push('start=' + enc(start));
    } else {
      parts.push('years=' + enc(num(target.baseYears) || 3));
    }
    return '/api/portfolio/backtest?' + parts.join('&');
  }
  function fetchBacktest(target, rangeKey, force) {
    var key = targetKey(target) + '~' + rangeKey;
    var cached = APP.detailCache[key];
    if (!force && cached && (Date.now() - cached.ts) < CACHE_TTL) {
      return Promise.resolve(cached.data);
    }
    var url = buildBacktestQuery(target, rangeKey);
    return api(url).then(function (data) {
      if (!data || data.ok === false || !data.result) {
        var msg = (data && (data.error || data.note)) || '回测服务暂不可用';
        throw new Error(msg);
      }
      APP.detailCache[key] = { ts: Date.now(), data: data.result };
      return data.result;
    });
  }

  // ---------- 序列工具 ----------
  function lastCurveV(res) {
    var c = res && res.curve;
    if (!Array.isArray(c) || !c.length) return null;
    return num(c[c.length - 1].v);
  }
  function curveReturn(arr) {
    if (!Array.isArray(arr) || arr.length < 2) return null;
    var a = num(arr[0].v);
    var b = num(arr[arr.length - 1].v);
    if (a == null || b == null || !a) return null;
    return (b / a - 1) * 100;
  }
  function plainPoints(arr) {
    var out = [];
    if (!Array.isArray(arr)) return out;
    arr.forEach(function (p) {
      if (!p) return;
      var t = num(p.t);
      var v = num(p.v);
      if (t != null && v != null) out.push({ t: t, v: v });
    });
    return out;
  }
  function pctPoints(arr) {
    var out = [];
    if (!Array.isArray(arr)) return out;
    arr.forEach(function (p) {
      if (!p) return;
      var t = num(p.t);
      var v = num(p.v);
      if (t != null && v != null) out.push({ t: t, v: (v - 1) * 100 });
    });
    return out;
  }
  function drawdownFromCurve(arr) {
    var pts = plainPoints(arr);
    var peak = null;
    return pts.map(function (p) {
      if (peak == null || p.v > peak) peak = p.v;
      return { t: p.t, v: peak > 0 ? (p.v / peak - 1) * 100 : 0 };
    });
  }
  function oneYearReturn(curve) {
    var pts = plainPoints(curve);
    if (pts.length < 2) return null;
    var last = pts[pts.length - 1];
    var targetTs = last.t - 365 * DAY_MS;
    var base = pts[0];
    var bestGap = Infinity;
    pts.forEach(function (p) {
      var gap = Math.abs(p.t - targetTs);
      if (gap < bestGap) { bestGap = gap; base = p; }
    });
    if (!base || !(base.v > 0)) return null;
    return (last.v / base.v - 1) * 100;
  }
  function metricsOf(res) { return (res && res.metrics) || {}; }
  function intervalTwr(res) {
    var m = metricsOf(res);
    var v = num(m.timeWeightedReturn);
    if (v == null) v = curveReturn(res && res.curve);
    if (v == null) v = num(m.totalReturn);
    return v;
  }
  function intervalBench(res) {
    var m = metricsOf(res);
    var v = num(m.benchmarkReturn);
    if (v == null) v = curveReturn(res && res.benchmark);
    return v;
  }
  function itemWeight(it, target) {
    var w = num(it && it.weight);
    if (w != null) return w;
    var h = findHolding(target, it && it.code);
    return h ? num(h.weight) : null;
  }
  function findHolding(target, code) {
    if (!target || !Array.isArray(target.holdings)) return null;
    for (var i = 0; i < target.holdings.length; i += 1) {
      if (String(target.holdings[i].code) === String(code)) return target.holdings[i];
    }
    return null;
  }
  function itemType(it, target) {
    if (it && (it.type === 'stock' || it.type === 'fund')) return it.type;
    var h = findHolding(target, it && it.code);
    return h ? h.type : 'fund';
  }
  function itemAmount(it, target) {
    var amt = num(it && it.amount);
    if (amt != null) return amt;
    var capital = num(target.capital) || 100000;
    var w = itemWeight(it, target);
    return w == null ? null : capital * w / 100;
  }

  // =========================================================================
  // 首页：推荐模板
  // =========================================================================
  function homeShellHTML() {
    return '' +
      '<div class="t-section">' +
        '<div class="t-card-head"><span class="t-title">推荐策略</span>' +
          '<span class="t-sub">精选组合模板 · 点击查看</span></div>' +
        '<div class="strat-list" id="stratTplList"></div>' +
      '</div>' +
      '<div class="t-section">' +
        '<div class="t-card-head"><span class="t-title">技术指标策略</span>' +
          '<span class="t-sub">金叉死叉 · 九转 · 量能 · 均线</span></div>' +
        '<div class="strat-list" id="stratIndTplList"></div>' +
      '</div>' +
      '<div class="t-section">' +
        '<div class="t-card-head"><span class="t-title">我的策略</span>' +
          '<span class="t-sub"><button type="button" class="t-btn-mini" data-strat-new>＋ 新建</button></span></div>' +
        '<div id="stratMineList"></div>' +
      '</div>' +
      '<p class="t-note">推荐模板基于历史净值回测计算近 1 年收益；技术指标策略用日线行情 / 基金净值回测，信号在下一交易日开盘成交。' +
        '所有策略仅保存在本机浏览器，历史表现不代表未来收益，不构成投资建议。</p>';
  }

  function renderHome() {
    var home = homeEl();
    if (!home) return;
    if (!home.getAttribute('data-strat-ready')) {
      home.setAttribute('data-strat-ready', '1');
      home.innerHTML = homeShellHTML();
    }
    renderTemplates();
    renderIndicatorTemplates();
    renderMineSection();
    loadMineSummaries();
    loadIndicatorTemplates(false);
    queueTemplateReturns();
  }

  function tplStateOf(id) { return APP.tplState[id] || null; }

  function tplCardHTML(t) {
    var st = tplStateOf(t.id);
    var retHTML;
    if (st && st.status === 'done') {
      retHTML = '<div class="strat-return ' + pctDir(st.ret) + '">' + signedPct(st.ret) +
        '<small>近1年</small></div>';
    } else if (st && st.status === 'error') {
      retHTML = '<div class="strat-return muted">查看<small>近1年</small></div>';
    } else {
      retHTML = '<div class="strat-return muted">…<small>近1年</small></div>';
    }
    return '' +
      '<div class="strat-card t-card" data-strat-tpl="' + esc(t.id) + '" role="button" tabindex="0" style="cursor:pointer">' +
        '<div class="strat-card-head">' +
          '<div class="strat-card-name"><span class="strat-icon">' + (t.icon || '📊') + '</span>' +
            '<span class="t-name">' + esc(t.name) + '</span></div>' +
          retHTML +
        '</div>' +
        '<p class="t-meta strat-desc">' + esc(t.desc) + '</p>' +
        '<div class="strat-meta">' +
          '<span class="t-badge">' + esc(rebalanceLabel(t.rebalance)) + '</span>' +
          '<span class="t-badge">' + t.holdings.length + ' 个资产</span>' +
          '<span class="t-badge">起始 ' + esc(t.startDate) + '</span>' +
        '</div>' +
      '</div>';
  }

  function renderTemplates() {
    var box = q('#stratTplList');
    if (!box) return;
    box.innerHTML = TEMPLATES.map(tplCardHTML).join('');
  }

  function queueTemplateReturns() {
    TEMPLATES.forEach(function (t) {
      if (APP.tplState[t.id]) return;
      APP.tplState[t.id] = { status: 'loading' };
      APP.tplQueue.push(t);
    });
    pumpTemplateQueue();
  }
  function pumpTemplateQueue() {
    if (APP.tplBusy) return;
    var t = APP.tplQueue.shift();
    if (!t) return;
    APP.tplBusy = true;
    setTimeout(function () {
      requestTemplateReturn(t).then(function (ret) {
        APP.tplState[t.id] = { status: 'done', ret: ret };
      }).catch(function (err) {
        APP.tplState[t.id] = { status: 'error', error: (err && err.message) || '加载失败' };
      }).then(function () {
        APP.tplBusy = false;
        renderTemplates();
        pumpTemplateQueue();
      });
    }, 40);
  }
  function requestTemplateReturn(t) {
    var target = templateTarget(t);
    return fetchBacktest(target, '1y').then(function (res) {
      var ret = curveReturn(res && res.curve);
      if (ret == null) ret = num(metricsOf(res).totalReturn);
      if (ret == null) throw new Error('收益数据为空');
      return ret;
    });
  }

  // =========================================================================
  // 首页：技术指标策略模板（GET /api/strategy/templates）
  // =========================================================================
  function loadIndicatorTemplates(force) {
    var st = APP.indTpl;
    // 失败后不自动重试，避免每次渲染首页都打接口；用户可点「重试」或重新进入页面
    if (!force && st.status !== 'idle') return;
    APP.indTpl = { status: 'loading', items: st.items || [], error: null };
    renderIndicatorTemplates();
    api('/api/strategy/templates').then(function (data) {
      var items = (data && Array.isArray(data.items)) ? data.items : [];
      items = items.filter(function (it) { return it && (it.key || it.name) && it.buy && it.sell; });
      if (!items.length) throw new Error((data && data.error) || '暂无指标策略模板');
      APP.indTpl = { status: 'done', items: items, error: null };
      renderIndicatorTemplates();
    }).catch(function (err) {
      APP.indTpl = {
        status: 'error',
        items: st.items || [],
        error: (err && err.message) || '指标策略模板加载失败'
      };
      renderIndicatorTemplates();
    });
  }

  function renderIndicatorTemplates() {
    var box = q('#stratIndTplList');
    if (!box) return;
    var st = APP.indTpl;
    if (st.status === 'loading' && !st.items.length) {
      JYXT.loading(box, '正在加载指标策略模板…');
      return;
    }
    if (st.status === 'error' && !st.items.length) {
      JYXT.errorBox(box, st.error || '指标策略模板暂不可用', function () {
        loadIndicatorTemplates(true);
      });
      return;
    }
    box.innerHTML = (st.items || []).map(indTplCardHTML).join('');
  }

  function indTplCardHTML(it) {
    var key = String(it.key || it.name || '');
    var codeName = it.codeName || it.code || '';
    var years = num(it.params && it.params.years);
    if (years == null) years = 3;
    var assetLabel = it.assetType === 'fund' ? '基金' : '股票/ETF';
    return '<div class="strat-card t-card" data-ind-tpl="' + esc(key) + '" role="button" tabindex="0" style="cursor:pointer">' +
      '<div class="strat-card-head">' +
        '<div class="strat-card-name"><span class="strat-icon">' + esc(it.icon || '📈') + '</span>' +
          '<span class="t-name">' + esc(it.name || key) + '</span></div>' +
        '<span class="strat-badge">' + esc(it.badge || '指标') + '</span>' +
      '</div>' +
      '<p class="t-meta strat-desc">' + esc(it.desc || '') + '</p>' +
      '<div class="strat-meta">' +
        '<span class="t-badge">' + esc(codeName || '—') + '</span>' +
        '<span class="t-badge">' + esc(assetLabel) + '</span>' +
        '<span class="t-badge">默认 ' + esc(years) + ' 年</span>' +
      '</div>' +
    '</div>';
  }

  function findIndicatorTemplate(key) {
    var items = APP.indTpl.items || [];
    for (var i = 0; i < items.length; i += 1) {
      if (String(items[i].key) === String(key)) return items[i];
    }
    return null;
  }

  // =========================================================================
  // 首页：我的策略
  // =========================================================================
  function mineCardHTML(s) {
    var sum = APP.mine[s.id];
    var retHTML;
    if (!sum || sum.status === 'loading') {
      retHTML = '<div class="strat-return muted">…<small>本期收益</small></div>';
    } else if (sum.status === 'error') {
      retHTML = '<div class="strat-return muted">—<small>本期收益</small></div>';
    } else {
      retHTML = '<div class="strat-return ' + pctDir(sum.data.ret) + '">' +
        signedPct(sum.data.ret) + '<small>' + esc(sum.data.retLabel) + '</small></div>';
    }

    var kpiHTML;
    if (sum && sum.status === 'done') {
      kpiHTML = kpiItem('组合金额', money(sum.data.amount)) +
        kpiItem('累计盈亏', signedMoney(sum.data.pnl), pctDir(sum.data.pnl)) +
        kpiItem('记账天数', sum.data.days == null ? '—' : (sum.data.days + ' 天'));
    } else {
      kpiHTML = kpiItem('组合金额', '…') + kpiItem('累计盈亏', '…') + kpiItem('记账天数', '…');
    }

    var errHTML = (sum && sum.status === 'error')
      ? '<p class="t-note">数据加载失败：' + esc(sum.error || '未知错误') + '（点击卡片进入可重试）</p>'
      : '';

    return '' +
      '<div class="strat-card t-card" data-strat-id="' + esc(s.id) + '" role="button" tabindex="0" style="cursor:pointer">' +
        '<div class="strat-card-head">' +
          '<div class="strat-card-name"><span class="strat-icon">🧭</span>' +
            '<span class="t-name">' + esc(s.name) + '</span></div>' +
          retHTML +
        '</div>' +
        '<div class="strat-card-kpis">' + kpiHTML + '</div>' +
        errHTML +
        '<div class="strat-meta">' +
          '<span class="strat-card-type portfolio">组合策略</span>' +
          '<span class="t-badge">' + esc(rebalanceLabel(s.rebalance)) + '</span>' +
          '<span class="t-badge">' + s.holdings.length + ' 个资产</span>' +
          '<span class="t-badge">起始 ' + esc(s.startDate) + '</span>' +
        '</div>' +
        '<div class="strat-ops t-actions">' +
          '<button type="button" class="t-btn-mini" data-strat-del="' + esc(s.id) + '">删除</button>' +
        '</div>' +
      '</div>';
  }

  // 指标策略卡片：名称 / 类型徽章 / 回测收益 / 交易次数 / 胜率
  function indicatorCardHTML(s) {
    var sum = APP.mine[s.id];
    var retHTML;
    if (!sum || sum.status === 'loading') {
      retHTML = '<div class="strat-return muted">…<small>回测收益</small></div>';
    } else if (sum.status === 'error') {
      retHTML = '<div class="strat-return muted">—<small>回测收益</small></div>';
    } else {
      retHTML = '<div class="strat-return ' + pctDir(sum.data.ret) + '">' +
        signedPct(sum.data.ret) + '<small>' + esc(sum.data.retLabel) + '</small></div>';
    }
    var descText = s.desc || ('买入：' + s.buy + '　卖出：' + s.sell);
    if (descText.length > 96) descText = descText.slice(0, 96) + '…';
    var meta = '<span class="strat-card-type indicator">指标策略</span>' +
      '<span class="t-badge">' + esc(s.codeName || s.code) + '</span>';
    if (sum && sum.status === 'done') {
      meta += '<span class="t-badge">交易 ' + (sum.data.trades == null ? '—' : fmt(sum.data.trades, 0)) + ' 笔</span>' +
        '<span class="t-badge">胜率 ' + (sum.data.winRate == null ? '—' : fmt(sum.data.winRate, 1) + '%') + '</span>';
    } else {
      meta += '<span class="t-badge">交易 —</span><span class="t-badge">胜率 —</span>';
    }
    var errHTML = (sum && sum.status === 'error')
      ? '<p class="t-note">回测失败：' + esc(sum.error || '未知错误') + '（点击卡片进入可重试）</p>'
      : '';
    return '' +
      '<div class="strat-card t-card" data-strat-id="' + esc(s.id) + '" role="button" tabindex="0" style="cursor:pointer">' +
        '<div class="strat-card-head">' +
          '<div class="strat-card-name"><span class="strat-icon">📈</span>' +
            '<span class="t-name">' + esc(s.name) + '</span></div>' +
          retHTML +
        '</div>' +
        '<p class="t-meta strat-desc">' + esc(descText) + '</p>' +
        errHTML +
        '<div class="strat-meta">' + meta + '</div>' +
        '<div class="strat-ops t-actions">' +
          '<button type="button" class="t-btn-mini" data-strat-del="' + esc(s.id) + '">删除</button>' +
        '</div>' +
      '</div>';
  }

  function kpiItem(label, value, dir) {
    // 不使用 .t-kpi/.t-kpis：基础设计系统的「奇数末项占满整行」规则会把 3 列 KPI 的第 3 个挤到下一行，
    // 这里用 ui-stylist 的 .strat-card-kpi / .strat-kpis（task-14）承载布局。
    return '<div class="strat-card-kpi">' +
      '<span class="t-kpi-label">' + esc(label) + '</span>' +
      '<b class="t-kpi-value ' + (dir || '') + '">' + value + '</b></div>';
  }

  function renderMineSection() {
    var box = q('#stratMineList');
    if (!box) return;
    var list = loadStrategies();
    if (!list.length) {
      JYXT.empty(box, {
        icon: '🧭',
        title: '还没有自建策略',
        desc: '可以从上方模板复制，或按自己的配置 / 公式新建',
        actionText: '新建你的第一个策略',
        onAction: function () { openTypeChooser(); }
      });
      return;
    }
    box.innerHTML = '<div class="strat-list">' + list.map(function (s) {
      return s.type === 'indicator' ? indicatorCardHTML(s) : mineCardHTML(s);
    }).join('') + '</div>';
  }

  function loadMineSummaries() {
    loadStrategies().forEach(queueMineSummary);
  }
  function queueMineSummary(s) {
    var cur = APP.mine[s.id];
    if (cur && (cur.status === 'loading' || cur.status === 'done')) return;
    APP.mine[s.id] = { status: 'loading' };
    APP.mineQueue.push(s);
    pumpMineQueue();
  }
  function pumpMineQueue() {
    if (APP.mineBusy) return;
    var s = APP.mineQueue.shift();
    if (!s) return;
    APP.mineBusy = true;
    setTimeout(function () {
      requestMineSummary(s).then(function (sum) {
        APP.mine[s.id] = { status: 'done', data: sum };
      }).catch(function (err) {
        APP.mine[s.id] = { status: 'error', error: (err && err.message) || '加载失败' };
      }).then(function () {
        APP.mineBusy = false;
        renderMineSection();
        pumpMineQueue();
      });
    }, 40);
  }
  // 首页摘要口径：起始日不晚于「12 个月前」用近1年区间，否则用成立来（不足 1 年）。
  // 卡片四项指标（收益率/组合金额/累计盈亏/记账天数）必须统一到同一区间，避免混用被误判为 bug。
  function summaryRangeKey(s) {
    var startTs = parseTs(s.startDate);
    var yearAgoTs = parseTs(monthsAgo(12));
    if (startTs == null || yearAgoTs == null) return 'since';
    return startTs <= yearAgoTs ? '1y' : 'since';
  }
  function requestMineSummary(s) {
    if (s.type === 'indicator') return requestIndicatorSummary(s);
    var target = mineTarget(s);
    var rangeKey = summaryRangeKey(s);
    return fetchBacktest(target, rangeKey).then(function (res) {
      var capital = num(s.capital) || 100000;
      // 回测曲线起点归一为 1，故区间期末组合金额 = 初始资金 × 末净值倍数；
      // 收益率取同一区间 totalReturn，保证与金额/盈亏/天数同口径。
      var lastV = lastCurveV(res);
      var amount = lastV == null ? null : capital * lastV;
      var pnl = amount == null ? null : amount - capital;
      var ret = num(metricsOf(res).totalReturn);
      if (ret == null) ret = curveReturn(res && res.curve);
      var days = daysBetween(res && res.startDate, (res && res.endDate) || todayStr());
      return {
        ret: ret,
        retLabel: rangeKey === '1y' ? '近1年' : '成立来',
        amount: amount,
        pnl: pnl,
        days: days == null ? null : Math.max(1, days),
        rangeKey: rangeKey,
        startDate: res && res.startDate,
        endDate: res && res.endDate,
        res: res
      };
    });
  }

  // 指标策略首页摘要：默认按保存的年限区间回测，收益/交易次数/胜率同口径
  function requestIndicatorSummary(s) {
    var target = indicatorTarget(s);
    var rangeKey = defaultIndicatorRange(target);
    return fetchIndicatorBacktest(target, rangeKey).then(function (res) {
      var m = metricsOf(res);
      var ret = num(m.totalReturn);
      if (ret == null) ret = curveReturn(res && res.curve);
      return {
        ret: ret,
        retLabel: indicatorRangeLabel(rangeKey, target),
        trades: num(m.tradeCount),
        winRate: num(m.winRate),
        rangeKey: rangeKey,
        startDate: res && res.startDate,
        endDate: res && res.endDate,
        res: res
      };
    });
  }

  // =========================================================================
  // 详情页
  // =========================================================================
  function openDetail(target) {
    if (target && target.kind === 'indicator') {
      openIndicatorDetail(target);
      return;
    }
    var view = viewEl();
    var home = homeEl();
    if (!view || !target) return;
    APP.idetail = null;
    APP.detail = {
      target: target,
      range: '1y',
      tab: 'trend',
      data: null,
      loading: true,
      error: null,
      seq: 0,
      todayFallback: null,
      todayFetching: false
    };
    if (home) home.classList.add('hidden');
    view.classList.remove('hidden');
    view.innerHTML = '<div class="tool-view-head">' +
      '<button type="button" class="tool-back" data-strat-back aria-label="返回">←</button>' +
      '<h2 class="tool-view-title">' + esc(target.name) + '</h2>' +
      '</div>' +
      '<div class="tool-view-body" id="stratDetailBody"></div>';
    hideViewHead();
    scrollStrategyTop();
    paintDetail();
    loadDetail(false);
  }

  function goHome() {
    var view = viewEl();
    var home = homeEl();
    if (view) {
      view.classList.add('hidden');
      view.innerHTML = '';
    }
    if (home) home.classList.remove('hidden');
    restoreViewHead();
    APP.detail = null;
    APP.idetail = null;
    scrollStrategyTop();
    renderMineSection();
    loadMineSummaries();
  }

  function paintDetail() {
    var d = APP.detail;
    var body = detailBody();
    if (!d || !body) return;
    if (d.loading) {
      body.innerHTML = detailSkeletonHTML();
      return;
    }
    if (d.error) {
      body.innerHTML = detailErrorHTML(d.error) + opsHTML(d.target);
      return;
    }
    if (!d.data) {
      body.innerHTML = detailErrorHTML('回测数据为空') + opsHTML(d.target);
      return;
    }
    body.innerHTML = '' +
      heroHTML(d, d.data) +
      metricsHTML(d, d.data) +
      tabsHTML(d, d.data) +
      holdingsHTML(d, d.data) +
      opsHTML(d.target);
    bindRangeChips();
    if (d.tab === 'today') ensureTodayFallback();
  }

  function detailSkeletonHTML() {
    return '' +
      '<div class="t-card"><div class="t-skeleton"><span></span><span></span><span></span>' +
        '<p class="t-sub">正在回测历史数据，首次可能需要几秒…</p></div></div>' +
      '<div class="t-card"><div class="t-skeleton"><span></span><span></span><span></span></div></div>';
  }
  function detailErrorHTML(msg) {
    return '<div class="t-card"><div class="t-empty"><div class="t-empty-ico">⚠️</div>' +
      '<p>回测数据加载失败</p><p class="t-sub">' + esc(msg || '请稍后重试') + '</p>' +
      '<button type="button" class="t-btn-primary" data-strat-op="retry">重试</button></div></div>';
  }

  function heroHTML(d, res) {
    var target = d.target;
    var capital = num(target.capital) || 100000;
    var lastV = lastCurveV(res);
    var amount = lastV == null ? null : capital * lastV;
    var pnl = amount == null ? null : amount - capital;
    var days = daysBetween(res.startDate || target.startDate, res.endDate || todayStr());
    var ret = intervalTwr(res);
    var sub = (res.startDate || '—') + ' ~ ' + (res.endDate || '—') + ' · ' +
      rebalanceLabel(target.rebalance) + ' · ' + (target.holdings || []).length + ' 个资产';
    var kpis = kpiItem('组合金额', money(amount)) +
      kpiItem('累计盈亏', signedMoney(pnl), pctDir(pnl)) +
      kpiItem('记账天数', days == null ? '—' : (Math.max(1, days) + ' 天'));
    return '' +
      '<div class="t-card strat-hero">' +
        '<div class="strat-hero-main">' +
          '<div class="strat-hero-label">本期收益率' +
            '<span class="t-badge">' + esc(rangeLabel(d.range)) + '</span></div>' +
          '<div class="strat-hero-value strat-return ' + pctDir(ret) + '">' + signedPct(ret) + '</div>' +
          '<div class="strat-hero-sub muted sm">' + esc(sub) + '</div>' +
          (target.desc ? '<p class="strat-desc muted sm">' + esc(target.desc) + '</p>' : '') +
        '</div>' +
        '<div class="strat-kpis">' + kpis + '</div>' +
        '<div class="t-chips strat-ranges" id="stratRanges"></div>' +
      '</div>' +
      (res.note ? '<p class="t-note">' + esc(res.note) + '</p>' : '');
  }

  function metricsHTML(d, res) {
    var tw = intervalTwr(res);
    var bench = intervalBench(res);
    var sub = (res.startDate || '—') + ' ~ ' + (res.endDate || '—');
    var kpis = JYXT.kpis([
      { label: '时间加权收益', value: signedPct(tw), dir: pctDir(tw) },
      { label: '沪深300 基准', value: bench == null ? '—' : signedPct(bench), dir: pctDir(bench) }
    ]);
    var note = bench == null
      ? '<p class="t-note">沪深300 基准数据暂不可用。</p>'
      : '<p class="t-note">时间加权收益剔除资金进出影响；沪深300 为同期后复权基准。</p>';
    return '<div class="t-card">' +
      '<div class="t-card-head"><span class="t-title">区间表现</span>' +
        '<span class="t-sub">' + esc(sub) + '</span></div>' +
      '<div class="t-body">' + kpis + note + '</div></div>';
  }

  function tabsHTML(d, res) {
    var tabs = TABS.map(function (t) {
      return '<button type="button" class="strat-tab' + (d.tab === t.key ? ' active' : '') +
        '" data-dtab="' + esc(t.key) + '">' + esc(t.label) + '</button>';
    }).join('');
    return '<div class="t-card">' +
      '<div class="strat-tabs">' + tabs + '</div>' +
      '<div class="strat-panel" id="stratPanel">' + panelHTML(d, res) + '</div>' +
      '</div>';
  }

  function panelHTML(d, res) {
    if (!res) return panelEmpty('暂无数据');
    if (d.tab === 'drawdown') return panelDrawdown(d, res);
    if (d.tab === 'pnl') return panelPnl(d, res);
    if (d.tab === 'today') return panelToday(d, res);
    return panelTrend(d, res);
  }
  function panelEmpty(text) {
    return '<div class="t-empty"><div class="t-empty-ico">📉</div><p>' + esc(text) + '</p></div>';
  }

  function panelTrend(d, res) {
    var port = pctPoints(res.curve);
    var bench = pctPoints(res.benchmark);
    if (port.length < 2) return panelEmpty('暂无走势数据');
    var series = [{ points: port, color: C_PORT, fill: true, width: 2 }];
    var legend = legendItem(C_PORT, '策略', signedPct(curveReturn(res.curve)));
    if (bench.length >= 2) {
      series.push({ points: bench, color: C_BENCH, width: 1.6 });
      legend += legendItem(C_BENCH, '沪深300', signedPct(curveReturn(res.benchmark)));
    }
    var note = bench.length >= 2
      ? '曲线为区间累计收益（%），起点归一为 0%；蓝色为沪深300 同期基准。'
      : '曲线为区间累计收益（%），起点归一为 0%；沪深300 基准数据暂不可用。';
    return '<div class="t-legend">' + legend + '</div>' +
      JYXT.lineChart(series, { height: 180 }) +
      '<p class="t-note">' + esc(note) + '</p>';
  }

  function panelDrawdown(d, res) {
    var dd = plainPoints(res.drawdown);
    if (!dd.length && res.curve) dd = drawdownFromCurve(res.curve);
    var bdd = plainPoints(res.benchmarkDrawdown);
    if (!bdd.length && res.benchmark) bdd = drawdownFromCurve(res.benchmark);
    if (dd.length < 2) return panelEmpty('暂无回撤数据');
    var m = metricsOf(res);
    var maxDD = num(m.maxDrawdown);
    var benchDD = num(m.benchmarkMaxDrawdown);
    if (maxDD == null && dd.length) {
      maxDD = dd.reduce(function (a, p) { return Math.min(a, p.v); }, 0);
    }
    if (benchDD == null && bdd.length) {
      benchDD = bdd.reduce(function (a, p) { return Math.min(a, p.v); }, 0);
    }
    var kpis = JYXT.kpis([
      { label: '策略最大回撤', value: maxDD == null ? '—' : fmt(maxDD, 2) + '%', dir: 'down' },
      { label: '基准最大回撤', value: benchDD == null ? '—' : fmt(benchDD, 2) + '%', dir: 'down' }
    ]);
    var series = [{ points: dd, color: C_PORT, fill: true, width: 1.8 }];
    var legend = legendItem(C_PORT, '组合回撤');
    if (bdd.length >= 2) {
      series.push({ points: bdd, color: C_BENCH, width: 1.4 });
      legend += legendItem(C_BENCH, '沪深300 回撤');
    }
    return kpis + '<div class="t-legend">' + legend + '</div>' +
      JYXT.lineChart(series, { height: 170, includeZero: true }) +
      '<p class="t-note">回撤 = 相对区间内前高点的跌幅（≤0），数值越低回撤越深。</p>';
  }

  function panelPnl(d, res) {
    var capital = num(d.target.capital) || 100000;
    var pnl = plainPoints(res.pnl);
    if (!pnl.length && Array.isArray(res.curve)) {
      pnl = plainPoints(res.curve).map(function (p) { return { t: p.t, v: capital * (p.v - 1) }; });
    }
    if (pnl.length < 2) return panelEmpty('暂无盈亏数据');
    var last = pnl[pnl.length - 1].v;
    var maxV = pnl.reduce(function (a, p) { return Math.max(a, p.v); }, pnl[0].v);
    var minV = pnl.reduce(function (a, p) { return Math.min(a, p.v); }, pnl[0].v);
    var kpis = JYXT.kpis([
      { label: '期末累计盈亏', value: signedMoney(last), dir: pctDir(last) },
      { label: '区间最大盈利', value: signedMoney(maxV), dir: pctDir(maxV) },
      { label: '区间最大亏损', value: signedMoney(minV), dir: pctDir(minV) }
    ]);
    var color = last >= 0 ? C_PORT : C_DOWN;
    return kpis +
      JYXT.lineChart([{ points: pnl, color: color, fill: true, width: 1.8 }],
        { height: 170, percent: false, padLeft: 56 }) +
      '<p class="t-note">盈亏金额 = 初始资金 ×（区间净值倍数 - 1），单位：元。</p>';
  }

  function panelToday(d, res) {
    var backend = res.today && typeof res.today === 'object' ? res.today : null;
    var useBackend = !!backend && (
      (Array.isArray(backend.items) && backend.items.length > 0) ||
      num(backend.portfolioPct) != null
    );
    var src = useBackend ? backend : d.todayFallback;
    if (!src) {
      if (!d.todayFetching) ensureTodayFallback();
      return '<div class="t-empty"><div class="t-empty-ico">⏱️</div><p>正在获取实时估值…</p>' +
        '<p class="t-sub">基金按 T-1 净值、股票按实时行情估算</p></div>';
    }
    var port = num(src.portfolioPct);
    var bench = num(src.benchmarkPct);
    var items = Array.isArray(src.items) ? src.items : [];
    var kpis = JYXT.kpis([
      { label: '今日组合估值', value: port == null ? '—' : signedPct(port), dir: pctDir(port) },
      { label: '今日沪深300', value: bench == null ? '—' : signedPct(bench), dir: pctDir(bench) }
    ]);
    var rows = items.map(function (it) {
      var type = itemType(it, d.target);
      var weight = itemWeight(it, d.target);
      var pct = num(it && it.changePct);
      return JYXT.rowHTML({
        name: esc((it && (it.name || it.code)) || '—'),
        code: it && it.code ? it.code : '',
        meta: typeLabel(type) + ' · 权重 ' + (weight == null ? '—' : fmt(weight, 2) + '%'),
        side: '<b class="' + pctDir(pct) + '">' + signedPct(pct) + '</b>'
      });
    }).join('');
    var fromFallback = !useBackend;
    var note = fromFallback
      ? '实时估值由前端按基金 T-1 净值 / 股票实时行情加权估算，仅供参考。'
      : '基金按 T-1 净值、股票按实时行情估算，仅供参考。';
    return kpis +
      (rows ? '<div class="t-list">' + rows + '</div>' : '<p class="t-note">暂无持仓估值明细。</p>') +
      '<p class="t-note">' + esc(note) + '</p>';
  }

  // ---------- 实时估值兜底（后端 today 缺失时前端估算） ----------
  function stockTencentCode(h) {
    if (!h || !h.code) return null;
    var code = String(h.code).trim();
    var market = String(h.market || '');
    if (/^(sh|sz|hk|us)[0-9A-Za-z.]+$/i.test(code)) return code.toLowerCase();
    if (/^[A-Za-z][A-Za-z.]*$/.test(code)) return 'us' + code.toUpperCase();
    if (/^\d{1,4}$/.test(code)) return 'hk' + ('00000' + code).slice(-5);
    if (/^\d{5}$/.test(code)) return 'hk' + code;
    if (/^\d{6}$/.test(code)) {
      if (market.indexOf('港') >= 0) return 'hk' + code;
      if (/^[569]/.test(code)) return 'sh' + code;
      if (/^[03]/.test(code)) return 'sz' + code;
      if (/^[48]/.test(code)) return null;
      return 'sh' + code;
    }
    return null;
  }
  function ensureTodayFallback() {
    var d = APP.detail;
    if (!d || !d.data) return;
    if (d.todayFallback || d.todayFetching) return;
    if (d.data.today && (num(d.data.today.portfolioPct) != null ||
      (Array.isArray(d.data.today.items) && d.data.today.items.length))) return;
    d.todayFetching = true;
    var holdings = d.target.holdings || [];
    var funds = holdings.filter(function (h) { return h.type !== 'stock'; });
    var stocks = holdings.filter(function (h) { return h.type === 'stock'; });
    var fundPromise = funds.length
      ? api('/api/fund/quotes?codes=' + enc(funds.map(function (f) { return f.code; }).join(',')))
          .catch(function () { return null; })
      : Promise.resolve(null);
    var tencent = stocks.map(stockTencentCode).filter(Boolean);
    var stockPromise = tencent.length
      ? api('/api/quote?codes=' + enc(tencent.join(','))).catch(function () { return null; })
      : Promise.resolve(null);
    Promise.all([fundPromise, stockPromise]).then(function (res) {
      d.todayFetching = false;
      if (APP.detail !== d) return;
      var fundItems = (res[0] && res[0].items) || [];
      var quoteItems = (res[1] && res[1].quotes) || [];
      var fundMap = {};
      fundItems.forEach(function (it) { fundMap[String(it.code)] = num(it.dayPct); });
      var quoteMap = {};
      quoteItems.forEach(function (it) { quoteMap[String(it.code).toLowerCase()] = num(it.changePct); });
      var items = [];
      var sum = 0;
      var wsum = 0;
      holdings.forEach(function (h) {
        var type = h.type === 'stock' ? 'stock' : 'fund';
        var pct = null;
        if (type === 'stock') {
          var tc = stockTencentCode(h);
          if (tc) pct = num(quoteMap[tc]);
        } else {
          pct = num(fundMap[String(h.code)]);
        }
        var w = num(h.weight) || 0;
        items.push({ name: h.name, code: h.code, type: type, weight: w, changePct: pct });
        if (pct != null && w > 0) { sum += pct * w; wsum += w; }
      });
      d.todayFallback = {
        portfolioPct: wsum > 0 ? sum / wsum : null,
        benchmarkPct: null,
        items: items,
        source: 'fallback'
      };
      if (APP.detail === d && d.tab === 'today') paintPanel();
    }).catch(function () {
      d.todayFetching = false;
      if (APP.detail !== d) return;
      d.todayFallback = { portfolioPct: null, benchmarkPct: null, items: [], source: 'error' };
      if (d.tab === 'today') paintPanel();
    });
  }

  // ---------- 持仓 ----------
  function holdingsHTML(d, res) {
    var target = d.target;
    var items = Array.isArray(res.items) ? res.items.filter(Boolean) : [];
    if (!items.length) {
      items = (target.holdings || []).map(function (h) {
        return { code: h.code, name: h.name, type: h.type, weight: h.weight, ownReturn: null, amount: null };
      });
    }
    if (!items.length) return '';
    var donutItems = items.map(function (it) {
      return { label: (it.name || it.code), value: itemWeight(it, target) || 0 };
    });
    var rows = items.map(function (it) {
      var type = itemType(it, target);
      var weight = itemWeight(it, target);
      var own = num(it.ownReturn);
      var amount = itemAmount(it, target);
      return '<tr data-hold-code="' + esc(it.code || '') + '" data-hold-type="' + esc(type) + '" style="cursor:pointer">' +
        '<td>' + esc(it.name || it.code || '—') + typeBadge(type) +
          '<small class="t-code">' + esc(it.code || '') + '</small></td>' +
        '<td>' + (weight == null ? '—' : fmt(weight, 2) + '%') + '</td>' +
        '<td class="' + pctDir(own) + '">' + (own == null ? '—' : signedPct(own)) + '</td>' +
        '<td>' + money(amount) + '</td>' +
        '</tr>';
    }).join('');
    var note = '策略起始 ' + esc(target.startDate || '—') + ' · ' + esc(rebalanceLabel(target.rebalance)) +
      ' · 初始资金 ' + money(num(target.capital) || 100000) +
      '；持仓金额 = 初始资金 × 目标权重，点击行查看资产详情。';
    return '<div class="t-card">' +
      '<div class="t-card-head"><span class="t-title">持仓明细</span>' +
        '<span class="t-sub">' + items.length + ' 个资产 · 按权重</span></div>' +
      '<div class="t-body">' +
        JYXT.donut(donutItems, { center: '持仓', suffix: '%' }) +
        '<div class="strat-holdings t-table-wrap"><table class="t-table"><thead><tr>' +
          '<th>资产</th><th>权重</th><th>区间收益</th><th>持仓金额</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="t-note">' + note + '</p>' +
      '</div></div>';
  }

  // ---------- 底部操作 ----------
  function opsHTML(target) {
    var isMine = target && target.kind === 'mine';
    var primary = isMine
      ? '<button type="button" class="t-btn t-btn-ghost" data-strat-op="edit">编辑策略</button>'
      : '<button type="button" class="t-btn t-btn-primary" data-strat-op="copy">复制为我的策略</button>';
    return '<div class="t-card"><div class="t-actions strat-ops">' + primary +
      '<button type="button" class="t-btn" data-strat-op="recalc">重新计算</button>' +
      (isMine
        ? '<button type="button" class="t-btn t-btn-ghost" data-strat-op="delete">删除策略</button>'
        : '') +
      '</div></div>';
  }

  // ---------- 详情数据加载 ----------
  function loadDetail(force) {
    var d = APP.detail;
    if (!d) return;
    var seq = d.seq + 1;
    d.seq = seq;
    if (!d.data) {
      d.loading = true;
      d.error = null;
      paintDetail();
    }
    fetchBacktest(d.target, d.range, !!force).then(function (res) {
      if (APP.detail !== d || d.seq !== seq) return;
      d.data = res;
      d.loading = false;
      d.error = null;
      d.todayFallback = null;
      paintDetail();
    }).catch(function (err) {
      if (APP.detail !== d || d.seq !== seq) return;
      d.loading = false;
      d.error = (err && err.message) || '回测数据加载失败';
      d.data = null;
      paintDetail();
    });
  }
  function recalcDetail() {
    var d = APP.detail;
    if (!d) return;
    var key = targetKey(d.target) + '~' + d.range;
    delete APP.detailCache[key];
    d.data = null;
    d.error = null;
    d.loading = true;
    d.seq += 1;
    d.todayFallback = null;
    paintDetail();
    loadDetail(true);
  }
  function switchRange(key) {
    var d = APP.detail;
    if (!d || d.range === key) return;
    d.range = key;
    d.data = null;
    d.error = null;
    d.loading = true;
    d.seq += 1;
    d.todayFallback = null;
    paintDetail();
    loadDetail(false);
  }
  function bindRangeChips() {
    var el = q('#stratRanges');
    var d = APP.detail;
    if (!el || !d) return;
    JYXT.chips(el, RANGES.map(function (r) { return { key: r.key, label: r.label }; }),
      d.range, function (key) { switchRange(key); });
  }
  function setTab(key) {
    var d = APP.detail;
    if (!d || !d.data) return;
    d.tab = key;
    qa('#strategyView [data-dtab]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-dtab') === key);
    });
    paintPanel();
  }
  function paintPanel() {
    var d = APP.detail;
    var panel = q('#stratPanel');
    if (!d || !d.data || !panel) return;
    panel.innerHTML = panelHTML(d, d.data);
    if (d.tab === 'today') ensureTodayFallback();
  }

  // ---------- 详情操作 ----------
  function copyTemplate(target) {
    var saved = {
      id: uid(),
      name: target.name,
      desc: target.desc || '',
      capital: num(target.capital) || 100000,
      startDate: isDateStr(target.startDate) ? target.startDate : yearsAgo(3),
      rebalance: rebalanceValid(target.rebalance),
      holdings: (target.holdings || []).map(function (h) {
        return { code: h.code, name: h.name, type: h.type, weight: h.weight };
      }),
      createdAt: Date.now()
    };
    var list = loadStrategies();
    list.push(saved);
    saveStrategies(list);
    delete APP.mine[saved.id];
    toast('已复制为我的策略：' + saved.name);
    renderHome();
    openDetail(mineTarget(saved));
  }

  function openHoldingDetail(tr) {
    var code = tr.getAttribute('data-hold-code');
    var type = tr.getAttribute('data-hold-type');
    if (!code) return;
    if (type !== 'stock') {
      if (JYXT.openFundSheet) JYXT.openFundSheet(code);
      return;
    }
    var d = APP.detail;
    var item = null;
    if (d && d.data && Array.isArray(d.data.items)) {
      d.data.items.forEach(function (it) { if (it && String(it.code) === String(code)) item = it; });
    }
    var holding = (d && d.target) ? findHolding(d.target, code) : null;
    JYXT.openSheet('<div class="t-empty"><p>加载行情…</p></div>');
    var tc = stockTencentCode(holding || { code: code });
    var req = tc
      ? api('/api/quote?codes=' + enc(tc)).catch(function () { return null; })
      : Promise.resolve(null);
    req.then(function (data) {
      var q = (data && data.quotes && data.quotes[0]) || null;
      renderStockSheet(code, item, holding, q);
    }).catch(function () {
      renderStockSheet(code, item, holding, null);
    });
  }
  function renderStockSheet(code, item, holding, quote) {
    if (!APP.detail) return;
    var name = (item && item.name) || (holding && holding.name) || code;
    var weight = itemWeight(item || {}, APP.detail.target);
    var own = num(item && item.ownReturn);
    var amount = item ? itemAmount(item, APP.detail.target) : null;
    if (weight == null && holding) weight = num(holding.weight);
    var priceHTML = '';
    if (quote) {
      var dir = pctDir(quote.changePct);
      priceHTML = '<div class="detail-head"><h3>' + esc(quote.name || name) +
        ' <small class="muted">' + esc(code) + '</small></h3>' +
        '<div class="detail-price ' + dir + '">' + fmt(quote.price, 2) + '</div>' +
        '<div class="detail-chg ' + dir + '">' + fmtSigned(quote.change) + ' · ' + fmtPctSafe(quote.changePct) + '</div></div>';
    }
    JYXT.openSheet(priceHTML +
      '<div class="kv-grid">' +
        '<div class="kv-item"><span>资产名称</span><b>' + esc(name) + '</b></div>' +
        '<div class="kv-item"><span>类型</span><b>股票 / ETF</b></div>' +
        '<div class="kv-item"><span>目标权重</span><b>' + (weight == null ? '—' : fmt(weight, 2) + '%') + '</b></div>' +
        '<div class="kv-item"><span>区间收益</span><b class="' + pctDir(own) + '">' + (own == null ? '—' : signedPct(own)) + '</b></div>' +
        '<div class="kv-item"><span>持仓金额</span><b>' + money(amount) + '</b></div>' +
      '</div>' +
      '<p class="t-note">股票仅展示行情接口返回字段；基金可点击持仓行查看完整基金详情。</p>');
  }
  function fmtPctSafe(v) {
    var n = num(v);
    return n == null ? '—' : ((n > 0 ? '+' : '') + fmt(n, 2) + '%');
  }

  // =========================================================================
  // 指标策略详情（模板 / 我的指标策略）
  // =========================================================================
  function openIndicatorDetail(target) {
    var view = viewEl();
    var home = homeEl();
    if (!view || !target) return;
    APP.detail = null;
    APP.idetail = {
      target: target,
      range: defaultIndicatorRange(target),
      tab: 'trend',
      data: null,
      loading: true,
      error: null,
      seq: 0
    };
    if (home) home.classList.add('hidden');
    view.classList.remove('hidden');
    view.innerHTML = '<div class="tool-view-head">' +
      '<button type="button" class="tool-back" data-strat-back aria-label="返回">←</button>' +
      '<h2 class="tool-view-title">' + esc(target.name) + '</h2>' +
      '</div>' +
      '<div class="tool-view-body" id="stratDetailBody"></div>';
    hideViewHead();
    scrollStrategyTop();
    paintIndicatorDetail();
    loadIndicatorDetail(false);
  }

  function paintIndicatorDetail() {
    var d = APP.idetail;
    var body = detailBody();
    if (!d || !body) return;
    if (d.loading) {
      body.innerHTML = detailSkeletonHTML();
      return;
    }
    if (d.error) {
      body.innerHTML = indicatorErrorHTML(d.error) + indicatorOpsHTML(d.target);
      return;
    }
    if (!d.data) {
      body.innerHTML = indicatorErrorHTML('指标回测数据为空') + indicatorOpsHTML(d.target);
      return;
    }
    body.innerHTML = indicatorHeroHTML(d, d.data) +
      indicatorMetricsHTML(d, d.data) +
      indicatorStatusHTML(d, d.data) +
      indicatorTabsHTML(d, d.data) +
      indicatorOpsHTML(d.target);
    bindIndicatorRangeChips();
  }

  function indicatorErrorHTML(msg) {
    return '<div class="t-card"><div class="t-empty"><div class="t-empty-ico">⚠️</div>' +
      '<p>指标回测加载失败</p><p class="t-sub">' + esc(msg || '请稍后重试') + '</p>' +
      '<button type="button" class="t-btn-primary" data-ind-op="retry">重试</button></div></div>';
  }

  function indicatorHeroHTML(d, res) {
    var t = d.target;
    var p = t.params || IND_DEFAULT_PARAMS;
    var capital = num(p.capital) || 100000;
    var m = metricsOf(res);
    var lastV = lastCurveV(res);
    var amount = lastV == null ? null : capital * lastV;
    var pnl = amount == null ? null : amount - capital;
    var ret = num(m.totalReturn);
    if (ret == null) ret = curveReturn(res.curve);
    var tradeCount = num(m.tradeCount);
    var winRate = num(m.winRate);
    var sub = (res.startDate || '—') + ' ~ ' + (res.endDate || '—') + ' · ' +
      (t.codeName || t.code || '—') + ' · ' + assetTypeLabel(t.assetType);
    var tradeText = (tradeCount == null ? '—' : fmt(tradeCount, 0) + ' 笔') +
      (winRate == null ? '' : ' / ' + fmt(winRate, 1) + '%');
    var kpis = kpiItem('组合金额', money(amount)) +
      kpiItem('累计盈亏', signedMoney(pnl), pctDir(pnl)) +
      kpiItem('交易/胜率', tradeText);
    return '' +
      '<div class="t-card strat-hero">' +
        '<div class="strat-hero-main">' +
          '<div class="strat-hero-label">回测收益率' +
            '<span class="t-badge">' + esc(indicatorRangeLabel(d.range, t)) + '</span></div>' +
          '<div class="strat-hero-value strat-return ' + pctDir(ret) + '">' + signedPct(ret) + '</div>' +
          '<div class="strat-hero-sub muted sm">' + esc(sub) + '</div>' +
          (t.desc ? '<p class="strat-desc muted sm">' + esc(t.desc) + '</p>' : '') +
        '</div>' +
        '<div class="strat-kpis">' + kpis + '</div>' +
        '<div class="t-chips strat-ranges" id="stratIndRanges"></div>' +
      '</div>' +
      (res.note ? '<p class="t-note">' + esc(res.note) + '</p>' : '');
  }

  function indicatorMetricsHTML(d, res) {
    var m = metricsOf(res);
    var ret = num(m.totalReturn);
    if (ret == null) ret = curveReturn(res.curve);
    var bench = num(m.benchmarkReturn);
    if (bench == null) bench = curveReturn(res.benchmark);
    var ann = num(m.annualized);
    var mdd = num(m.maxDrawdown);
    var tradeCount = num(m.tradeCount);
    var kpis = JYXT.kpis([
      { label: '策略收益', value: signedPct(ret), dir: pctDir(ret) },
      { label: '沪深300 基准', value: signedPct(bench), dir: pctDir(bench) }
    ]);
    var extra = '年化 ' + (ann == null ? '—' : signedPct(ann)) +
      ' · 最大回撤 ' + (mdd == null ? '—' : fmt(mdd, 2) + '%') +
      ' · 交易次数 ' + (tradeCount == null ? '—' : fmt(tradeCount, 0) + ' 笔');
    return '<div class="t-card">' +
      '<div class="t-card-head"><span class="t-title">区间表现</span>' +
        '<span class="t-sub">' + esc((res.startDate || '—') + ' ~ ' + (res.endDate || '—')) + '</span></div>' +
      '<div class="t-body">' + kpis +
        '<p class="t-note">' + esc(extra) + '</p>' +
        '<p class="t-note">策略用日线 / 净值回测，信号在下一交易日开盘成交；沪深300 为同期后复权基准。</p>' +
      '</div></div>';
  }

  function indicatorStatusHTML(d, res) {
    var cur = (res && res.current) || {};
    var holding = !!cur.holding;
    var badge = holding
      ? '<span class="signal-badge holding">持仓中</span>'
      : '<span class="signal-badge flat">当前空仓</span>';
    var rows = '';
    if (holding) {
      rows += '<div class="kv-item"><span>建仓日期</span><b>' + esc(cur.entryDate || '—') + '</b></div>' +
        '<div class="kv-item"><span>建仓价</span><b>' +
          (num(cur.entryPrice) == null ? '—' : fmt(cur.entryPrice, 3)) + '</b></div>';
    }
    rows += '<div class="kv-item"><span>最近信号</span><b>' + esc(lastSignalText(cur)) + '</b></div>' +
      '<div class="kv-item"><span>信号日期</span><b>' + esc(cur.lastSignalDate || '—') + '</b></div>';
    return '<div class="t-card">' +
      '<div class="t-card-head"><span class="t-title">当前状态</span>' +
        '<span class="t-sub">' + (holding ? '按最新信号持仓' : '当前无持仓') + '</span></div>' +
      '<div class="t-body"><div class="strat-signal-card">' + badge +
        '<div class="kv-grid">' + rows + '</div></div>' +
        '<p class="t-note">信号在下一交易日开盘成交；止损 / 止盈按盘中最高最低价触发（止损优先）。</p>' +
      '</div></div>';
  }

  function lastSignalText(cur) {
    if (!cur) return '—';
    var v = cur.lastSignal;
    if (v == null || v === '' || v === 0 || v === '0' || v === false) return '—';
    var s = String(v).toLowerCase();
    if (s === 'buy' || s === '1' || s === 'true' || s === '买入') return '买入';
    if (s === 'sell' || s === '-1' || s === '卖出') return '卖出';
    return String(v);
  }

  function indicatorTabsHTML(d, res) {
    var tabs = IND_TABS.map(function (t) {
      return '<button type="button" class="strat-tab' + (d.tab === t.key ? ' active' : '') +
        '" data-ind-tab="' + esc(t.key) + '">' + esc(t.label) + '</button>';
    }).join('');
    return '<div class="t-card">' +
      '<div class="strat-tabs">' + tabs + '</div>' +
      '<div class="strat-panel" id="stratIndPanel">' + indicatorPanelHTML(d, res) + '</div>' +
      '</div>';
  }

  function indicatorPanelHTML(d, res) {
    if (!res) return panelEmpty('暂无数据');
    if (d.tab === 'drawdown') return indicatorPanelDrawdown(d, res);
    if (d.tab === 'trades') return indicatorPanelTrades(d, res);
    if (d.tab === 'formula') return indicatorPanelFormula(d, res);
    return indicatorPanelTrend(d, res);
  }

  // ---------- 买卖点标记：在 JYXT.lineChart 的 SVG 上叠加圆点 / 三角 ----------
  function lineChartMarkers(series, markers, opts) {
    var svg = JYXT.lineChart(series, opts);
    if (!markers || !markers.length) return svg;
    if (!svg || svg.indexOf('<svg') < 0) return svg;
    var overlay = markerOverlay(series, markers, opts || {});
    if (!overlay) return svg;
    return svg.replace(/<\/svg>\s*$/, overlay + '</svg>');
  }
  function markerOverlay(series, markers, opts) {
    // 与 tools.js lineChart 保持相同的坐标映射，保证标记落在曲线上
    var H = opts.height || 150;
    var PL = opts.padLeft == null ? 44 : opts.padLeft;
    var PR = 8;
    var PT = 12;
    var PB = opts.padBottom || 18;
    var all = [];
    (series || []).forEach(function (s) {
      (s.points || []).forEach(function (p) {
        if (p && num(p.t) != null && num(p.v) != null) all.push(p);
      });
    });
    if (all.length < 2) return '';
    var xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    all.forEach(function (p) {
      if (p.t < xMin) xMin = p.t;
      if (p.t > xMax) xMax = p.t;
      if (p.v < yMin) yMin = p.v;
      if (p.v > yMax) yMax = p.v;
    });
    if (xMax <= xMin) xMax = xMin + 86400000;
    if (yMax === yMin) { yMax += 1; yMin -= 1; }
    if (opts.includeZero) { yMin = Math.min(yMin, 0); yMax = Math.max(yMax, 0); }
    var padY = (yMax - yMin) * 0.08 || 1;
    yMin -= padY;
    yMax += padY;
    var iw = 320 - PL - PR;
    var ih = H - PT - PB;
    if (iw <= 0 || ih <= 0) return '';
    return markers.map(function (m) {
      var x = PL + ((m.t - xMin) / (xMax - xMin)) * iw;
      var y = PT + (1 - (m.v - yMin) / (yMax - yMin)) * ih;
      if (!isFinite(x) || !isFinite(y)) return '';
      var xf = x.toFixed(1);
      var yf = y.toFixed(1);
      if (m.type === 'sell') {
        return '<path class="strat-marker-sell" d="M ' + xf + ' ' + yf +
          ' l -3.4 -5.4 l 6.8 0 Z" fill="' + C_DOWN + '" stroke="#ffffff" stroke-width="0.8"/>';
      }
      return '<circle class="strat-marker-buy" cx="' + xf + '" cy="' + yf +
        '" r="2.9" fill="' + C_PORT + '" stroke="#ffffff" stroke-width="0.8"/>';
    }).join('');
  }
  function indicatorMarkers(res, curvePoints) {
    var out = [];
    var raw = Array.isArray(res && res.markers) ? res.markers : [];
    var pts = Array.isArray(curvePoints) && curvePoints.length ? curvePoints : pctPoints(res && res.curve);
    if (!pts.length) return out;
    raw.forEach(function (m) {
      if (!m) return;
      var t = num(m.t);
      if (t == null) return;
      var v = nearestPointValue(pts, t);
      if (v == null) return;
      out.push({ t: t, v: v, type: m.type === 'sell' ? 'sell' : 'buy' });
    });
    return out;
  }
  function nearestPointValue(pts, t) {
    var best = null;
    var bestGap = Infinity;
    for (var i = 0; i < pts.length; i += 1) {
      var gap = Math.abs(pts[i].t - t);
      if (gap < bestGap) { bestGap = gap; best = pts[i]; }
    }
    return best ? best.v : null;
  }
  function markerLegendHTML() {
    return '<span class="t-legend-item"><i class="t-dot strat-marker-buy"></i>买入</span>' +
      '<span class="t-legend-item"><i class="t-dot strat-marker-sell"></i>卖出</span>';
  }

  function indicatorPanelTrend(d, res) {
    var port = pctPoints(res.curve);
    var bench = pctPoints(res.benchmark);
    if (port.length < 2) return panelEmpty('暂无走势数据');
    var series = [{ points: port, color: C_PORT, fill: true, width: 2 }];
    var legend = legendItem(C_PORT, '策略', signedPct(curveReturn(res.curve)));
    if (bench.length >= 2) {
      series.push({ points: bench, color: C_BENCH, width: 1.6 });
      legend += legendItem(C_BENCH, '沪深300', signedPct(curveReturn(res.benchmark)));
    }
    var markers = indicatorMarkers(res, port);
    var svg = lineChartMarkers(series, markers, { height: 200 });
    return '<div class="t-legend">' + legend + (markers.length ? markerLegendHTML() : '') + '</div>' + svg +
      '<p class="t-note">曲线为区间累计收益（%），起点归一为 0%' +
      (markers.length ? '；圆点为买入信号、三角为卖出信号，均标注在成交日净值位置' : '') + '。</p>';
  }

  function indicatorPanelDrawdown(d, res) {
    var dd = plainPoints(res.drawdown);
    if (!dd.length && res.curve) dd = drawdownFromCurve(res.curve);
    var bdd = res.benchmark ? drawdownFromCurve(res.benchmark) : [];
    if (dd.length < 2) return panelEmpty('暂无回撤数据');
    var m = metricsOf(res);
    var maxDD = num(m.maxDrawdown);
    if (maxDD == null) maxDD = dd.reduce(function (a, p) { return Math.min(a, p.v); }, 0);
    var benchDD = null;
    if (bdd.length >= 2) {
      benchDD = bdd.reduce(function (a, p) { return Math.min(a, p.v); }, 0);
    }
    var kpis = JYXT.kpis([
      { label: '策略最大回撤', value: maxDD == null ? '—' : fmt(maxDD, 2) + '%', dir: 'down' },
      { label: '基准最大回撤', value: benchDD == null ? '—' : fmt(benchDD, 2) + '%', dir: 'down' }
    ]);
    var series = [{ points: dd, color: C_PORT, fill: true, width: 1.8 }];
    var legend = legendItem(C_PORT, '策略回撤');
    if (bdd.length >= 2) {
      series.push({ points: bdd, color: C_BENCH, width: 1.4 });
      legend += legendItem(C_BENCH, '沪深300 回撤');
    }
    return kpis + '<div class="t-legend">' + legend + '</div>' +
      JYXT.lineChart(series, { height: 170, includeZero: true }) +
      '<p class="t-note">回撤 = 相对区间内前高点的跌幅（≤0），数值越低回撤越深。</p>';
  }

  function tradeReason(raw) {
    var s = String(raw == null ? '' : raw).toLowerCase();
    if (s.indexOf('stop') >= 0 || s === '止损') return { label: '止损', cls: 'stop' };
    if (s.indexOf('take') >= 0 || s.indexOf('profit') >= 0 || s === '止盈') return { label: '止盈', cls: 'profit' };
    if (s === 'end' || s === '期末') return { label: '期末', cls: 'end' };
    if (!s || s === 'signal' || s === '信号') return { label: '信号', cls: 'signal' };
    return { label: String(raw), cls: '' };
  }
  function tradesRowsHTML(trades) {
    return trades.map(function (tr) {
      var pct = num(tr.profitPct);
      var reason = tradeReason(tr.reason);
      return '<tr>' +
        '<td>' + esc(tr.buyDate || '—') + '</td>' +
        '<td>' + (num(tr.buyPrice) == null ? '—' : fmt(tr.buyPrice, 3)) + '</td>' +
        '<td>' + esc(tr.sellDate || '—') + '</td>' +
        '<td>' + (num(tr.sellPrice) == null ? '—' : fmt(tr.sellPrice, 3)) + '</td>' +
        '<td>' + (num(tr.holdDays) == null ? '—' : fmt(tr.holdDays, 0)) + '</td>' +
        '<td class="' + pctDir(pct) + '">' + (pct == null ? '—' : signedPct(pct)) + '</td>' +
        '<td><span class="strat-trade-reason ' + reason.cls + '">' + esc(reason.label) + '</span></td>' +
        '</tr>';
    }).join('');
  }
  function tradesTableHTML(trades) {
    return '<div class="t-table-wrap"><table class="strat-trade-table" style="min-width:470px"><thead><tr>' +
      '<th>买入日</th><th>买入价</th><th>卖出日</th><th>卖出价</th><th>持有天数</th><th>收益率</th><th>原因</th>' +
      '</tr></thead><tbody>' + tradesRowsHTML(trades) + '</tbody></table></div>';
  }

  function indicatorPanelTrades(d, res) {
    var trades = Array.isArray(res.trades) ? res.trades.filter(Boolean) : [];
    if (!trades.length) return panelEmpty('区间内没有产生交易');
    var m = metricsOf(res);
    var tradeCount = num(m.tradeCount);
    var winRate = num(m.winRate);
    var avgHold = num(m.avgHoldDays);
    var pf = num(m.profitFactor);
    var kpis = JYXT.kpis([
      { label: '交易次数', value: tradeCount == null ? fmt(trades.length, 0) + ' 笔' : fmt(tradeCount, 0) + ' 笔' },
      { label: '胜率', value: winRate == null ? '—' : fmt(winRate, 1) + '%', dir: winRate == null ? '' : (winRate >= 50 ? 'up' : 'down') },
      { label: '平均持有', value: avgHold == null ? '—' : fmt(avgHold, 0) + ' 天' },
      { label: '盈亏比', value: pf == null ? '—' : fmt(pf, 2) }
    ]);
    return kpis + tradesTableHTML(trades.slice().reverse()) +
      '<p class="t-note">表格按时间倒序；原因包含「信号 / 止损 / 止盈 / 期末」，收益率为单笔交易扣除双边手续费后的结果。</p>';
  }

  function formulaFunctionsOf(text) {
    var out = [];
    var s = String(text || '');
    IND_BUILTIN_FUNCTIONS.forEach(function (fn) {
      var re = new RegExp('(^|[^A-Z0-9_])' + fn + '\\s*\\(', 'i');
      if (re.test(s) && out.indexOf(fn) < 0) out.push(fn);
    });
    return out;
  }

  function indicatorPanelFormula(d, res) {
    var t = d.target;
    var p = t.params || IND_DEFAULT_PARAMS;
    var funcs = formulaFunctionsOf(t.buy);
    formulaFunctionsOf(t.sell).forEach(function (fn) {
      if (funcs.indexOf(fn) < 0) funcs.push(fn);
    });
    var fnHTML = funcs.length
      ? '<div class="formula-help">' + funcs.map(function (fn) {
        return '<span class="formula-helper-chip">' + esc(fn) + '</span>';
      }).join('') + '</div>'
      : '<p class="t-note">未识别到内置函数（可能使用了自定义变量赋值）。</p>';
    var paramsHTML = '<div class="kv-grid">' +
      '<div class="kv-item"><span>回测区间</span><b>' + esc((res.startDate || '—') + ' ~ ' + (res.endDate || '—')) + '</b></div>' +
      '<div class="kv-item"><span>标的</span><b>' + esc(t.codeName || t.code || '—') + ' <small class="muted">' + esc(t.code || '') + '</small></b></div>' +
      '<div class="kv-item"><span>资产类型</span><b>' + esc(assetTypeLabel(t.assetType)) + '</b></div>' +
      '<div class="kv-item"><span>初始资金</span><b>' + money(num(p.capital) || 100000) + '</b></div>' +
      '<div class="kv-item"><span>手续费（单边）</span><b>' + (num(p.fee) == null ? '—' : fmt(p.fee * 100, 3) + '%') + '</b></div>' +
      '<div class="kv-item"><span>止损</span><b>' + (num(p.stopLoss) == null ? '未设置' : fmt(p.stopLoss, 1) + '%') + '</b></div>' +
      '<div class="kv-item"><span>止盈</span><b>' + (num(p.takeProfit) == null ? '未设置' : fmt(p.takeProfit, 1) + '%') + '</b></div>' +
      '</div>';
    return '<div class="t-section-title">策略公式</div>' +
      '<div class="strat-formula-block"><div class="t-sub muted">买入公式</div><code>' + esc(t.buy || '—') + '</code></div>' +
      '<div class="strat-formula-block"><div class="t-sub muted">卖出公式</div><code>' + esc(t.sell || '—') + '</code></div>' +
      '<div class="t-section-title">使用函数</div>' + fnHTML +
      '<div class="t-section-title">回测参数</div>' + paramsHTML +
      '<p class="t-note">公式按多行赋值解析：可用 CLOSE / OPEN / HIGH / LOW / VOL / AMOUNT 与 ' +
        'MA / EMA / CROSS / TD_BUY 等函数。历史回测不代表未来收益，不构成投资建议。</p>';
  }

  function indicatorOpsHTML(target) {
    var isMine = !!target && !target.template;
    var primary = isMine
      ? '<button type="button" class="t-btn t-btn-ghost" data-ind-op="edit">编辑策略</button>'
      : '<button type="button" class="t-btn t-btn-primary" data-ind-op="copy">复制为我的策略</button>';
    return '<div class="t-card"><div class="t-actions strat-ops">' + primary +
      '<button type="button" class="t-btn" data-ind-op="recalc">重新计算</button>' +
      (isMine
        ? '<button type="button" class="t-btn t-btn-ghost" data-ind-op="delete">删除策略</button>'
        : '') +
      '</div></div>';
  }

  function loadIndicatorDetail(force) {
    var d = APP.idetail;
    if (!d) return;
    var seq = d.seq + 1;
    d.seq = seq;
    if (!d.data) {
      d.loading = true;
      d.error = null;
      paintIndicatorDetail();
    }
    fetchIndicatorBacktest(d.target, d.range, !!force).then(function (res) {
      if (APP.idetail !== d || d.seq !== seq) return;
      d.data = res;
      d.loading = false;
      d.error = null;
      paintIndicatorDetail();
    }).catch(function (err) {
      if (APP.idetail !== d || d.seq !== seq) return;
      d.loading = false;
      d.error = (err && err.message) || '指标回测加载失败';
      d.data = null;
      paintIndicatorDetail();
    });
  }
  function recalcIndicatorDetail() {
    var d = APP.idetail;
    if (!d) return;
    var key = indicatorTargetKey(d.target) + '~' + d.range;
    delete APP.indCache[key];
    d.data = null;
    d.error = null;
    d.loading = true;
    d.seq += 1;
    paintIndicatorDetail();
    loadIndicatorDetail(true);
  }
  function switchIndicatorRange(key) {
    var d = APP.idetail;
    if (!d || d.range === key) return;
    d.range = key;
    d.data = null;
    d.error = null;
    d.loading = true;
    d.seq += 1;
    paintIndicatorDetail();
    loadIndicatorDetail(false);
  }
  function bindIndicatorRangeChips() {
    var el = q('#stratIndRanges');
    var d = APP.idetail;
    if (!el || !d) return;
    var ranges = indicatorRanges(d.target);
    JYXT.chips(el, ranges.map(function (r) { return { key: r.key, label: r.label }; }),
      d.range, function (key) { switchIndicatorRange(key); });
  }
  function setIndicatorTab(key) {
    var d = APP.idetail;
    if (!d || !d.data) return;
    d.tab = key;
    qa('#strategyView [data-ind-tab]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-ind-tab') === key);
    });
    paintIndicatorPanel();
  }
  function paintIndicatorPanel() {
    var d = APP.idetail;
    var panel = q('#stratIndPanel');
    if (!d || !d.data || !panel) return;
    panel.innerHTML = indicatorPanelHTML(d, d.data);
  }

  function copyIndicatorTarget(target) {
    var saved = {
      id: uid(),
      type: 'indicator',
      name: target.name,
      desc: target.desc || '',
      code: target.code,
      codeName: target.codeName || target.code,
      assetType: target.assetType === 'fund' ? 'fund' : 'stock',
      buy: target.buy || '',
      sell: target.sell || '',
      params: normalizeIndicatorParams(target.params),
      createdAt: Date.now()
    };
    var list = loadStrategies();
    list.push(saved);
    saveStrategies(list);
    delete APP.mine[saved.id];
    toast('已复制为我的指标策略：' + saved.name);
    renderHome();
    openIndicatorDetail(indicatorTarget(saved));
  }

  function handleIndicatorOp(btn) {
    var d = APP.idetail;
    if (!d) return;
    var op = btn.getAttribute('data-ind-op');
    if (op === 'retry' || op === 'recalc') {
      if (op === 'recalc') toast('正在重新计算…', 1200);
      recalcIndicatorDetail();
      return;
    }
    if (op === 'edit') {
      var s = findStrategy(d.target.id);
      if (s && s.type === 'indicator') openIndicatorForm(s);
      return;
    }
    if (op === 'copy') {
      copyIndicatorTarget(d.target);
      return;
    }
    if (op === 'delete') {
      if (!btn.__stratArmed) {
        btn.__stratArmed = true;
        btn.textContent = '再点一次确认删除';
        setTimeout(function () {
          btn.__stratArmed = false;
          if (btn.textContent === '再点一次确认删除') btn.textContent = '删除策略';
        }, 4000);
        return;
      }
      btn.__stratArmed = false;
      var removed = findStrategy(d.target.id);
      deleteStrategy(d.target.id);
      toast(removed ? '已删除策略：' + removed.name : '策略已删除');
      goHome();
    }
  }

  function assetTypeLabel(type) {
    return type === 'fund' ? '基金' : '股票/ETF';
  }

  // =========================================================================
  // 自建 / 编辑策略表单（底部抽屉）
  // =========================================================================
  function deepCopyHoldings(list) {
    return (Array.isArray(list) ? list : []).map(function (h) {
      return { code: h.code, name: h.name, type: h.type === 'stock' ? 'stock' : 'fund', weight: num(h.weight) };
    });
  }

  function openCreateForm(editing) {
    var src = editing || null;
    APP.indForm = null; // 防止抽屉被点遮罩关闭后残留的指标表单状态
    APP.indFormSeq += 1;
    APP.form = {
      mode: src ? 'edit' : 'create',
      id: src ? src.id : null,
      createdAt: src ? src.createdAt : null,
      name: src ? String(src.name || '') : '',
      desc: src ? String(src.desc || '') : '',
      capital: src && num(src.capital) != null ? num(src.capital) : 100000,
      startDate: src && isDateStr(src.startDate) ? String(src.startDate) : yearsAgo(3),
      rebalance: src ? rebalanceValid(src.rebalance) : 'quarterly',
      holdings: src ? deepCopyHoldings(src.holdings) : []
    };
    paintForm();
  }

  function paintForm() {
    var f = APP.form;
    if (!f) return;
    APP.formSeq += 1;
    var seq = APP.formSeq;
    JYXT.openSheet(formHTML(f));
    if (seq !== APP.formSeq) return;
    var fundInput = q('#sfFundInput');
    var fundSuggest = q('#sfFundSuggest');
    if (fundInput && fundSuggest && JYXT.fundSearch) {
      JYXT.fundSearch(fundInput, fundSuggest, function (fund) {
        addFormHolding({ code: fund.code, name: fund.name, type: 'fund' });
      });
    }
    var stockInput = q('#sfStockInput');
    var stockSuggest = q('#sfStockSuggest');
    if (stockInput && stockSuggest) stockSearch(stockInput, stockSuggest);
  }

  function fieldHTML(label, control) {
    return '<div class="t-field"><label>' + esc(label) + '</label>' + control + '</div>';
  }
  function formHTML(f) {
    var rebalanceOptions = REBALANCES.map(function (r) {
      return '<option value="' + esc(r.key) + '"' + (f.rebalance === r.key ? ' selected' : '') + '>' +
        esc(r.label) + '</option>';
    }).join('');
    return '' +
      '<div class="strategy-create-form">' +
        '<div class="t-card-head"><span class="t-title">' +
          (f.mode === 'edit' ? '编辑策略' : '新建策略') + '</span>' +
          '<button type="button" class="t-btn-mini" data-sf-cancel>取消</button></div>' +
        '<div class="t-form">' +
          fieldHTML('策略名称', '<input class="t-input" id="sfName" autocomplete="off" maxlength="30" placeholder="如 我的红利策略" value="' + esc(f.name) + '">') +
          fieldHTML('说明（可选）', '<input class="t-input" id="sfDesc" autocomplete="off" maxlength="60" placeholder="一句话说明" value="' + esc(f.desc) + '">') +
          '<div class="t-fields">' +
            fieldHTML('初始资金 (¥)', '<input class="t-input" id="sfCapital" type="number" min="1000" step="1000" inputmode="decimal" value="' + esc(f.capital) + '">') +
            fieldHTML('起始日期', '<input class="t-input" id="sfStart" type="date" max="' + todayStr() + '" value="' + esc(f.startDate) + '">') +
          '</div>' +
          fieldHTML('再平衡周期', '<select class="t-select" id="sfRebalance">' + rebalanceOptions + '</select>') +
          '<div class="t-section-title">资产配置' +
            '<span class="t-sub">最多 ' + MAX_HOLDINGS + ' 个 · 权重保存时自动归一</span></div>' +
          holdingsFormHTML(f) +
          '<div class="t-fields">' +
            '<div class="t-field"><label>添加基金</label>' +
              '<input class="t-input" id="sfFundInput" autocomplete="off" placeholder="搜索基金名称 / 代码">' +
              '<div class="t-suggest hidden" id="sfFundSuggest"></div></div>' +
            '<div class="t-field"><label>添加股票 / ETF</label>' +
              '<input class="t-input" id="sfStockInput" autocomplete="off" placeholder="搜索股票名称 / 代码">' +
              '<div class="t-suggest hidden" id="sfStockSuggest"></div></div>' +
          '</div>' +
          '<div class="t-actions">' +
            '<button type="button" class="t-btn-primary" data-sf-save>保存策略</button>' +
            '<button type="button" class="t-btn-ghost" data-sf-cancel>取消</button>' +
          '</div>' +
          '<p class="t-note">策略仅保存在本机浏览器；起始日期允许回填历史（更早的数据会以后端可得区间为准）。' +
            '历史回测不代表未来收益，不构成投资建议。</p>' +
        '</div>' +
      '</div>';
  }
  function holdingsFormHTML(f) {
    if (!f.holdings.length) {
      return '<p class="t-note strat-empty">还没有资产，用下方搜索添加基金或股票（最多 ' + MAX_HOLDINGS + ' 个）。</p>';
    }
    var rows = f.holdings.map(function (h, i) {
      var weight = num(h.weight);
      return '<div class="t-row">' +
        '<div class="t-row-main">' +
          '<div class="t-name">' + esc(h.name || h.code) +
            '<small class="t-code">' + esc(h.code) + '</small></div>' +
          '<div class="t-meta">' + typeBadge(h.type) +
            ' · 权重 ' + (weight == null ? '—' : fmt(weight, 2) + '%') + '</div>' +
        '</div>' +
        '<div class="t-row-side">' +
          '<input class="t-input" type="number" min="0" max="100" step="1" inputmode="decimal" ' +
            'data-sf-weight="' + i + '" value="' + (weight == null ? 0 : weight) + '"><span>%</span>' +
        '</div>' +
        '<div class="t-row-action">' +
          '<button type="button" class="t-btn-mini" data-sf-del="' + i + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="t-list">' + rows + '</div>';
  }

  function readForm() {
    var f = APP.form;
    if (!f) return;
    var nameEl = q('#sfName');
    if (!nameEl) return; // 表单已关闭
    f.name = nameEl.value || '';
    var descEl = q('#sfDesc');
    if (descEl) f.desc = descEl.value || '';
    var capEl = q('#sfCapital');
    if (capEl) f.capital = num(capEl.value);
    var startEl = q('#sfStart');
    if (startEl) f.startDate = startEl.value || '';
    var rbEl = q('#sfRebalance');
    if (rbEl) f.rebalance = rbEl.value || 'quarterly';
    var weightInputs = qa('[data-sf-weight]');
    weightInputs.forEach(function (inp) {
      var i = parseInt(inp.getAttribute('data-sf-weight'), 10);
      if (!isFinite(i) || !f.holdings[i]) return;
      f.holdings[i].weight = num(inp.value);
    });
  }

  function equalizeWeights(list) {
    var n = list.length;
    if (!n) return;
    var w = round2(100 / n);
    list.forEach(function (h, i) {
      h.weight = i === n - 1 ? round2(100 - w * (n - 1)) : w;
    });
  }
  function normalizeWeights(values) {
    var n = values.length;
    if (!n) return [];
    var arr = values.map(function (v) {
      var x = num(v);
      return x == null || x < 0 ? 0 : x;
    });
    var sum = arr.reduce(function (a, b) { return a + b; }, 0);
    if (!(sum > 0)) {
      var w = round2(100 / n);
      arr = arr.map(function (h, i) { return i === n - 1 ? round2(100 - w * (n - 1)) : w; });
      return arr;
    }
    arr = arr.map(function (x) { return round2(x * 100 / sum); });
    var total = arr.reduce(function (a, b) { return a + b; }, 0);
    if (Math.abs(total - 100) > 0.01) arr[n - 1] = round2(arr[n - 1] + (100 - total));
    return arr;
  }

  function addFormHolding(h) {
    if (!APP.form) return;
    readForm();
    if (!APP.form) return;
    if (APP.form.holdings.length >= MAX_HOLDINGS) {
      toast('最多添加 ' + MAX_HOLDINGS + ' 个资产');
      return;
    }
    var dup = false;
    APP.form.holdings.forEach(function (x) { if (String(x.code) === String(h.code)) dup = true; });
    if (dup) {
      toast('该资产已在列表中');
      return;
    }
    APP.form.holdings.push({
      code: String(h.code || ''),
      name: String(h.name || h.code || ''),
      type: h.type === 'stock' ? 'stock' : 'fund',
      weight: 0
    });
    equalizeWeights(APP.form.holdings);
    paintForm();
  }

  function saveForm() {
    readForm();
    var f = APP.form;
    if (!f) return;
    var name = String(f.name || '').trim();
    if (!name) { toast('请填写策略名称'); return; }
    var holdings = (f.holdings || []).filter(function (h) { return h && h.code; });
    if (!holdings.length) { toast('请至少添加 1 个资产'); return; }
    var capital = num(f.capital);
    if (capital == null || !(capital > 0)) { toast('请填写有效的初始资金'); return; }
    var startDate = isDateStr(f.startDate) ? String(f.startDate) : yearsAgo(3);
    var rebalance = rebalanceValid(f.rebalance);
    var weights = normalizeWeights(holdings.map(function (h) { return num(h.weight); }));
    var saved = {
      id: f.id || uid(),
      name: name,
      desc: String(f.desc || '').trim(),
      capital: round2(capital),
      startDate: startDate,
      rebalance: rebalance,
      holdings: holdings.map(function (h, i) {
        return {
          code: String(h.code),
          name: String(h.name || h.code),
          type: h.type === 'stock' ? 'stock' : 'fund',
          weight: weights[i]
        };
      }),
      createdAt: f.createdAt || Date.now()
    };
    var list = loadStrategies();
    var found = -1;
    list.forEach(function (s, i) { if (s.id === saved.id) found = i; });
    if (found >= 0) list[found] = saved; else list.push(saved);
    saveStrategies(list);
    delete APP.mine[saved.id];
    closeForm();
    toast(found >= 0 ? '策略已更新：' + saved.name : '策略已保存：' + saved.name);
    renderHome();
    openDetail(mineTarget(saved));
  }

  function closeForm() {
    APP.form = null;
    APP.formSeq += 1;
    if (JYXT.closeSheet) JYXT.closeSheet();
  }

  // ---------- 股票搜索（/api/stock/search） ----------
  function stockSearch(inputEl, suggestEl) {
    var timer = null;
    var lastItems = [];
    inputEl.addEventListener('input', function () {
      var keyword = inputEl.value.trim();
      clearTimeout(timer);
      if (!keyword) {
        suggestEl.classList.add('hidden');
        return;
      }
      timer = setTimeout(function () {
        api('/api/stock/search?key=' + enc(keyword) + '&limit=8').then(function (data) {
          lastItems = (data && data.items) || [];
          if (!lastItems.length) {
            suggestEl.innerHTML = '<div class="t-suggest-empty">没有匹配的股票 / ETF</div>';
          } else {
            suggestEl.innerHTML = lastItems.map(function (s, i) {
              return '<button type="button" class="t-suggest-item" data-sf-stock="' + i + '">' +
                '<span>' + esc(s.name || s.code) + '</span>' +
                '<small>' + esc(s.code) + ' · ' + esc(s.market || s.type || '') + '</small>' +
                '</button>';
            }).join('');
          }
          suggestEl.classList.remove('hidden');
        }).catch(function () {
          lastItems = [];
          suggestEl.innerHTML = '<div class="t-suggest-empty">股票搜索暂不可用，请稍后重试</div>';
          suggestEl.classList.remove('hidden');
        });
      }, 260);
    });
    suggestEl.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-sf-stock]') : null;
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-sf-stock'), 10);
      var s = lastItems[idx];
      if (!s) return;
      inputEl.value = '';
      suggestEl.classList.add('hidden');
      addFormHolding({
        code: String(s.code || ''),
        name: String(s.name || s.code || ''),
        type: 'stock',
        market: s.market || ''
      });
    });
  }

  // =========================================================================
  // 新建类型选择（组合配置 / 指标公式）
  // =========================================================================
  function openTypeChooser() {
    APP.form = null;
    APP.indForm = null;
    JYXT.openSheet(typeChooserHTML());
  }
  function typeChooserHTML() {
    return '<div class="strategy-create-form">' +
      '<div class="t-card-head"><span class="t-title">新建策略</span>' +
        '<button type="button" class="t-btn-mini" data-ct-cancel>取消</button></div>' +
      '<p class="t-sub">先选择要创建的策略类型</p>' +
      '<div class="strat-type-choice">' +
        '<button type="button" class="strat-type-card" data-ct-choice="portfolio">' +
          '<span class="strat-type-card-ico">🧺</span>' +
          '<span class="strat-type-card-title">组合配置</span>' +
          '<span class="strat-type-card-desc">选择基金 / 股票并按权重配置，定期再平衡，适合资产配置</span>' +
        '</button>' +
        '<button type="button" class="strat-type-card" data-ct-choice="indicator">' +
          '<span class="strat-type-card-ico">📈</span>' +
          '<span class="strat-type-card-title">指标公式</span>' +
          '<span class="strat-type-card-desc">用技术指标公式（金叉死叉 / 九转 / 量能 / 均线）定义买卖信号</span>' +
        '</button>' +
      '</div>' +
      '<p class="t-note">组合配置使用历史净值回测；指标公式使用后复权日线行情回测，信号在下一交易日开盘成交。' +
        '历史回测不代表未来收益，不构成投资建议。</p>' +
    '</div>';
  }

  // =========================================================================
  // 指标公式表单（新建 / 编辑）
  // =========================================================================
  function defaultIndicatorDraft() {
    return {
      mode: 'create',
      id: null,
      createdAt: null,
      name: '',
      desc: '',
      code: '600519',
      codeName: '贵州茅台',
      assetType: 'stock',
      buy: 'CROSS(MA(CLOSE,5),MA(CLOSE,20))',
      sell: 'CROSSDOWN(MA(CLOSE,5),MA(CLOSE,20))',
      params: { years: 3, capital: 100000, fee: 0.0005, stopLoss: 10, takeProfit: null },
      lastEditor: 'buy'
    };
  }
  function openIndicatorForm(src) {
    var f;
    if (src && src.type === 'indicator') {
      f = {
        mode: 'edit',
        id: src.id,
        createdAt: src.createdAt,
        name: String(src.name || ''),
        desc: String(src.desc || ''),
        code: String(src.code || ''),
        codeName: String(src.codeName || src.code || ''),
        assetType: src.assetType === 'fund' ? 'fund' : 'stock',
        buy: String(src.buy || ''),
        sell: String(src.sell || ''),
        params: normalizeIndicatorParams(src.params),
        lastEditor: 'buy'
      };
    } else {
      f = defaultIndicatorDraft();
    }
    APP.form = null;
    APP.indForm = f;
    APP.indFormSeq += 1;
    JYXT.openSheet(indicatorFormHTML(f));
    bindIndicatorForm(f);
  }
  function indicatorAssetBoxHTML(f) {
    if (!f || !f.code) {
      return '<p class="t-note strat-empty">还没有选择标的，用下方搜索选择基金或股票 / ETF。</p>';
    }
    return '<div class="t-row">' +
      '<div class="t-row-main">' +
        '<div class="t-name">' + esc(f.codeName || f.code) +
          '<small class="t-code">' + esc(f.code) + '</small></div>' +
        '<div class="t-meta">' + esc(assetTypeLabel(f.assetType)) + ' · 回测标的</div>' +
      '</div>' +
      '<div class="t-row-side"><span class="t-badge">当前</span></div>' +
    '</div>';
  }
  function indicatorFormHTML(f) {
    var yearList = IND_YEARS.slice();
    if (yearList.indexOf(Number(f.params.years)) < 0) {
      yearList.push(Number(f.params.years));
      yearList.sort(function (a, b) { return a - b; });
    }
    var yearsOptions = yearList.map(function (y) {
      return '<option value="' + y + '"' + (Number(f.params.years) === y ? ' selected' : '') + '>近 ' + y + ' 年</option>';
    }).join('');
    var feePct = roundTo((num(f.params.fee) == null ? 0.0005 : num(f.params.fee)) * 100, 4);
    if (feePct == null) feePct = 0.05;
    var helperChips = IND_FORMULA_HELPERS.map(function (h, i) {
      return '<button type="button" class="formula-helper-chip" data-if-helper="' + i + '">' + esc(h.label) + '</button>';
    }).join('');
    return '<div class="strategy-create-form">' +
      '<div class="t-card-head"><span class="t-title">' +
        (f.mode === 'edit' ? '编辑指标策略' : '新建指标策略') + '</span>' +
        '<button type="button" class="t-btn-mini" data-if-cancel>取消</button></div>' +
      '<div class="t-form">' +
        fieldHTML('策略名称', '<input class="t-input" id="ifName" autocomplete="off" maxlength="30" placeholder="如 茅台均线金叉" value="' + esc(f.name) + '">') +
        fieldHTML('说明（可选）', '<input class="t-input" id="ifDesc" autocomplete="off" maxlength="60" placeholder="一句话说明" value="' + esc(f.desc) + '">') +
        '<div class="t-section-title">回测标的<span class="t-sub">股票 / ETF 用日线行情，基金用净值</span></div>' +
        '<div id="ifAssetBox">' + indicatorAssetBoxHTML(f) + '</div>' +
        '<div class="t-fields">' +
          '<div class="t-field"><label>添加基金</label>' +
            '<input class="t-input" id="ifFundInput" autocomplete="off" placeholder="搜索基金名称 / 代码">' +
            '<div class="t-suggest hidden" id="ifFundSuggest"></div></div>' +
          '<div class="t-field"><label>添加股票 / ETF</label>' +
            '<input class="t-input" id="ifStockInput" autocomplete="off" placeholder="搜索股票 / ETF 名称或代码">' +
            '<div class="t-suggest hidden" id="ifStockSuggest"></div></div>' +
        '</div>' +
        '<div class="t-section-title">交易公式<span class="t-sub">支持 MA / CROSS / TD_BUY 等函数，可多行赋值</span></div>' +
        '<div class="t-field"><label>买入公式（条件成立时买入）</label>' +
          '<textarea class="formula-editor" id="ifBuy" rows="3" spellcheck="false" placeholder="CROSS(MA(CLOSE,5),MA(CLOSE,20))">' + esc(f.buy) + '</textarea></div>' +
        '<div class="t-field"><label>卖出公式（条件成立时卖出）</label>' +
          '<textarea class="formula-editor" id="ifSell" rows="3" spellcheck="false" placeholder="CROSSDOWN(MA(CLOSE,5),MA(CLOSE,20))">' + esc(f.sell) + '</textarea></div>' +
        '<div class="formula-help" id="ifHelpers">' + helperChips + '</div>' +
        '<p class="formula-hint">点击片段插入到「买入 / 卖出」当前光标处；可用 CLOSE / OPEN / HIGH / LOW / VOL / AMOUNT 与 MA / EMA / RSI / TD_BUY 等函数。</p>' +
        '<div id="ifStatus"></div>' +
        '<div class="t-section-title">回测参数</div>' +
        '<div class="t-fields">' +
          fieldHTML('回测年限', '<select class="t-select" id="ifYears">' + yearsOptions + '</select>') +
          fieldHTML('初始资金 (¥)', '<input class="t-input" id="ifCapital" type="number" min="1000" step="1000" inputmode="decimal" value="' + esc(round2(num(f.params.capital) || 100000)) + '">') +
        '</div>' +
        '<div class="t-fields">' +
          fieldHTML('手续费（单边 %）', '<input class="t-input" id="ifFee" type="number" min="0" step="0.01" inputmode="decimal" value="' + esc(feePct) + '">') +
          fieldHTML('止损 %（可空）', '<input class="t-input" id="ifStop" type="number" min="0" step="1" inputmode="decimal" value="' + esc(f.params.stopLoss == null ? '' : f.params.stopLoss) + '">') +
          fieldHTML('止盈 %（可空）', '<input class="t-input" id="ifTake" type="number" min="0" step="1" inputmode="decimal" value="' + esc(f.params.takeProfit == null ? '' : f.params.takeProfit) + '">') +
        '</div>' +
        '<div class="t-actions">' +
          '<button type="button" class="t-btn" data-if-validate>校验公式</button>' +
          '<button type="button" class="t-btn-primary" data-if-run>开始回测</button>' +
          '<button type="button" class="t-btn-ghost" data-if-save>保存策略</button>' +
        '</div>' +
        '<div id="ifResult"></div>' +
        '<p class="t-note">公式仅保存在本机浏览器；回测用后复权日线 / 基金净值，信号在下一交易日开盘成交，未计滑点。' +
          '历史回测不代表未来收益，不构成投资建议。</p>' +
      '</div>' +
    '</div>';
  }

  function bindIndicatorForm(f) {
    if (!f) return;
    var fundInput = q('#ifFundInput');
    var fundSuggest = q('#ifFundSuggest');
    if (fundInput && fundSuggest && JYXT.fundSearch) {
      JYXT.fundSearch(fundInput, fundSuggest, function (fund) {
        if (APP.indForm !== f || !fund) return;
        setIndicatorAsset(f, { code: fund.code, name: fund.name, assetType: 'fund' });
      });
    }
    var stockInput = q('#ifStockInput');
    var stockSuggest = q('#ifStockSuggest');
    if (stockInput && stockSuggest) {
      bindStockSuggest(stockInput, stockSuggest, function (s) {
        if (APP.indForm !== f || !s) return;
        setIndicatorAsset(f, { code: s.code, name: s.name, assetType: 'stock' });
      });
    }
    ['buy', 'sell'].forEach(function (key) {
      var el = key === 'buy' ? q('#ifBuy') : q('#ifSell');
      if (!el) return;
      el.addEventListener('focus', function () {
        if (APP.indForm === f) f.lastEditor = key;
      });
    });
  }

  function bindStockSuggest(inputEl, suggestEl, onPick) {
    var timer = null;
    var items = [];
    inputEl.addEventListener('input', function () {
      var keyword = inputEl.value.trim();
      clearTimeout(timer);
      if (!keyword) {
        suggestEl.classList.add('hidden');
        return;
      }
      timer = setTimeout(function () {
        api('/api/stock/search?key=' + enc(keyword) + '&limit=8').then(function (data) {
          items = (data && data.items) || [];
          if (!items.length) {
            suggestEl.innerHTML = '<div class="t-suggest-empty">没有匹配的股票 / ETF</div>';
          } else {
            suggestEl.innerHTML = items.map(function (s, i) {
              return '<button type="button" class="t-suggest-item" data-if-stock="' + i + '">' +
                '<span>' + esc(s.name || s.code) + '</span>' +
                '<small>' + esc(s.code) + ' · ' + esc(s.market || s.type || '') + '</small>' +
                '</button>';
            }).join('');
          }
          suggestEl.classList.remove('hidden');
        }).catch(function () {
          items = [];
          suggestEl.innerHTML = '<div class="t-suggest-empty">股票搜索暂不可用，请稍后重试</div>';
          suggestEl.classList.remove('hidden');
        });
      }, 260);
    });
    suggestEl.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-if-stock]') : null;
      if (!btn) return;
      var idx = parseInt(btn.getAttribute('data-if-stock'), 10);
      var s = items[idx];
      if (!s) return;
      inputEl.value = '';
      suggestEl.classList.add('hidden');
      onPick(s);
    });
  }

  function setIndicatorAsset(f, a) {
    if (!f || !a || !a.code) return;
    f.code = String(a.code);
    f.codeName = String(a.name || a.code);
    f.assetType = a.assetType === 'fund' ? 'fund' : 'stock';
    var box = q('#ifAssetBox');
    if (box) box.innerHTML = indicatorAssetBoxHTML(f);
    setFormulaStatus('', '');
  }

  function setFormulaStatus(cls, text) {
    var el = q('#ifStatus');
    if (!el) return;
    if (!text) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = '<div class="formula-status ' + (cls || '') + '">' + esc(text) + '</div>';
  }

  function readIndicatorForm() {
    var f = APP.indForm;
    if (!f) return null;
    var nameEl = q('#ifName');
    if (!nameEl) return f;
    f.name = nameEl.value || '';
    var descEl = q('#ifDesc');
    if (descEl) f.desc = descEl.value || '';
    var buyEl = q('#ifBuy');
    if (buyEl) f.buy = buyEl.value || '';
    var sellEl = q('#ifSell');
    if (sellEl) f.sell = sellEl.value || '';
    var yearsEl = q('#ifYears');
    var capEl = q('#ifCapital');
    var feeEl = q('#ifFee');
    var stopEl = q('#ifStop');
    var takeEl = q('#ifTake');
    var feePct = feeEl ? num(feeEl.value) : null;
    var stopV = stopEl ? num(stopEl.value) : null;
    var takeV = takeEl ? num(takeEl.value) : null;
    f.params = {
      years: clampInt(yearsEl && yearsEl.value, 1, 20, 3),
      capital: capEl && num(capEl.value) != null ? round2(num(capEl.value)) : 100000,
      fee: feePct == null || feePct < 0 ? 0.0005 : roundTo(feePct / 100, 6),
      stopLoss: stopV == null || stopV <= 0 ? null : round2(stopV),
      takeProfit: takeV == null || takeV <= 0 ? null : round2(takeV)
    };
    return f;
  }

  function insertTextAtCursor(el, text) {
    if (!el || !text) return;
    var start = el.selectionStart == null ? el.value.length : el.selectionStart;
    var end = el.selectionEnd == null ? start : el.selectionEnd;
    var value = el.value || '';
    el.value = value.slice(0, start) + text + value.slice(end);
    var pos = start + text.length;
    try {
      el.focus();
      el.setSelectionRange(pos, pos);
    } catch (e) { /* 部分浏览器不支持 setSelectionRange 时忽略 */ }
  }

  function indicatorFormError(f) {
    if (!f || !f.code) return '请先选择回测标的';
    if (!String(f.buy || '').trim() || !String(f.sell || '').trim()) return '请填写买入和卖出公式';
    if (!(num(f.params && f.params.capital) > 0)) return '请填写有效的初始资金';
    return null;
  }

  function indicatorTargetFromForm(f) {
    return {
      kind: 'indicator',
      id: f.id || 'draft',
      template: f.mode !== 'edit',
      name: f.name || '未命名指标策略',
      desc: f.desc || '',
      code: f.code,
      codeName: f.codeName,
      assetType: f.assetType === 'fund' ? 'fund' : 'stock',
      buy: f.buy,
      sell: f.sell,
      params: normalizeIndicatorParams(f.params),
      createdAt: f.createdAt
    };
  }

  function validateIndicatorForm() {
    var f = readIndicatorForm();
    if (!f) return;
    var buy = String(f.buy || '').trim();
    var sell = String(f.sell || '').trim();
    if (!buy || !sell) {
      setFormulaStatus('err', '请先填写买入和卖出公式');
      return;
    }
    setFormulaStatus('loading', '正在校验公式…');
    var seq = APP.indFormSeq + 1;
    APP.indFormSeq = seq;
    api('/api/strategy/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buy: buy, sell: sell, assetType: f.assetType })
    }).then(function (data) {
      if (APP.indForm !== f || APP.indFormSeq !== seq) return;
      if (!data || data.ok === false) {
        setFormulaStatus('err', (data && data.error) || '公式校验未通过');
        return;
      }
      var fnList = Array.isArray(data.functions) ? data.functions.map(function (x) { return String(x); }) : [];
      var text = '公式校验通过';
      if (fnList.length) text += '（使用函数：' + fnList.join('、') + '）';
      if (data.usesVolume) text += ' · 含成交量指标';
      setFormulaStatus('ok', text);
    }).catch(function (err) {
      if (APP.indForm !== f || APP.indFormSeq !== seq) return;
      setFormulaStatus('err', '校验请求失败：' + ((err && err.message) || '网络异常'));
    });
  }

  function runIndicatorPreview() {
    var f = readIndicatorForm();
    if (!f) return;
    var err = indicatorFormError(f);
    if (err) {
      setFormulaStatus('err', err);
      toast(err);
      return;
    }
    var box = q('#ifResult');
    if (box) {
      JYXT.loading(box, '正在回测 ' + f.codeName + ' · 近 ' + f.params.years + ' 年，首次可能需要几秒…');
    }
    var seq = APP.indFormSeq + 1;
    APP.indFormSeq = seq;
    var target = indicatorTargetFromForm(f);
    fetchIndicatorBacktest(target, 'form', true).then(function (res) {
      if (APP.indForm !== f || APP.indFormSeq !== seq) return;
      f.preview = res;
      if (box) box.innerHTML = indicatorPreviewHTML(res, f);
    }).catch(function (e) {
      if (APP.indForm !== f || APP.indFormSeq !== seq) return;
      if (box) JYXT.errorBox(box, (e && e.message) || '回测失败', function () { runIndicatorPreview(); });
    });
  }

  function indicatorPreviewHTML(res, f) {
    var m = metricsOf(res);
    var port = pctPoints(res.curve);
    var bench = pctPoints(res.benchmark);
    var series = [{ points: port, color: C_PORT, fill: true, width: 2 }];
    var legend = legendItem(C_PORT, '策略');
    if (bench.length >= 2) {
      series.push({ points: bench, color: C_BENCH, width: 1.6 });
      legend += legendItem(C_BENCH, '沪深300');
    }
    var chart = port.length >= 2
      ? lineChartMarkers(series, indicatorMarkers(res, port), { height: 180 })
      : panelEmpty('暂无走势数据');
    var total = num(m.totalReturn);
    var ann = num(m.annualized);
    var mdd = num(m.maxDrawdown);
    var tradeCount = num(m.tradeCount);
    var winRate = num(m.winRate);
    var benchRet = num(m.benchmarkReturn);
    var kpis = JYXT.kpis([
      { label: '总收益', value: signedPct(total), dir: pctDir(total) },
      { label: '年化收益', value: ann == null ? '—' : signedPct(ann), dir: pctDir(ann) },
      { label: '最大回撤', value: mdd == null ? '—' : fmt(mdd, 2) + '%', dir: 'down' },
      { label: '交易次数', value: tradeCount == null ? '—' : fmt(tradeCount, 0) + ' 笔' },
      { label: '胜率', value: winRate == null ? '—' : fmt(winRate, 1) + '%', dir: winRate == null ? '' : (winRate >= 50 ? 'up' : 'down') },
      { label: '基准收益', value: benchRet == null ? '—' : signedPct(benchRet), dir: pctDir(benchRet) }
    ]);
    var trades = Array.isArray(res.trades) ? res.trades.filter(Boolean).slice(-5).reverse() : [];
    var tradeSection = trades.length
      ? '<div class="t-section-title">最近交易<span class="t-sub">按时间倒序，最多 5 条</span></div>' + tradesTableHTML(trades)
      : '<p class="t-note">区间内还没有产生交易。</p>';
    var cur = res.current || {};
    var status = cur.holding
      ? '<span class="signal-badge holding">持仓中</span>'
      : '<span class="signal-badge flat">空仓</span>';
    var lastSig = lastSignalText(cur);
    var previewMarkers = indicatorMarkers(res, port);
    return '<div class="t-card">' +
      '<div class="t-card-head"><span class="t-title">回测预览</span>' +
        '<span class="t-sub">' + esc((res.startDate || '—') + ' ~ ' + (res.endDate || '—')) + '</span></div>' +
      '<div class="t-body">' + kpis +
        '<div class="t-legend">' + legend + (previewMarkers.length ? markerLegendHTML() : '') + '</div>' + chart +
        '<div class="strat-signal-card">' + status +
          '<p>最近信号：' + esc(lastSig) + (cur.lastSignalDate ? ' · ' + esc(cur.lastSignalDate) : '') + '</p></div>' +
        tradeSection +
        (res.note ? '<p class="t-note">' + esc(res.note) + '</p>' : '') +
        '<p class="t-note">「保存策略」后可在策略详情查看完整交易明细与回撤。</p>' +
      '</div></div>';
  }

  function saveIndicatorForm() {
    var f = readIndicatorForm();
    if (!f) return;
    var err = indicatorFormError(f);
    if (err) {
      setFormulaStatus('err', err);
      toast(err);
      return;
    }
    var name = String(f.name || '').trim();
    if (!name) {
      toast('请填写策略名称');
      setFormulaStatus('err', '请填写策略名称');
      return;
    }
    var saved = {
      id: f.id || uid(),
      type: 'indicator',
      name: name,
      desc: String(f.desc || '').trim(),
      code: f.code,
      codeName: f.codeName || f.code,
      assetType: f.assetType === 'fund' ? 'fund' : 'stock',
      buy: String(f.buy || '').trim(),
      sell: String(f.sell || '').trim(),
      params: normalizeIndicatorParams(f.params),
      createdAt: f.createdAt || Date.now()
    };
    var list = loadStrategies();
    var found = -1;
    list.forEach(function (s, i) { if (s.id === saved.id) found = i; });
    if (found >= 0) list[found] = saved; else list.push(saved);
    saveStrategies(list);
    delete APP.mine[saved.id];
    closeIndicatorForm();
    toast(found >= 0 ? '指标策略已更新：' + saved.name : '指标策略已保存：' + saved.name);
    renderHome();
    openIndicatorDetail(indicatorTarget(saved));
  }

  function closeIndicatorForm() {
    APP.indForm = null;
    APP.indFormSeq += 1;
    if (JYXT.closeSheet) JYXT.closeSheet();
  }

  function handleIndicatorFormClick(t) {
    var f = APP.indForm;
    if (!f || !t) return;
    if (t.closest('[data-if-cancel]')) {
      closeIndicatorForm();
      return;
    }
    var helper = t.closest('[data-if-helper]');
    if (helper) {
      var idx = parseInt(helper.getAttribute('data-if-helper'), 10);
      var item = IND_FORMULA_HELPERS[idx];
      if (!item) return;
      var key = f.lastEditor === 'sell' ? 'sell' : 'buy';
      var el = key === 'sell' ? q('#ifSell') : q('#ifBuy');
      if (el) {
        insertTextAtCursor(el, item.snippet);
        f[key] = el.value;
        setFormulaStatus('', '');
      }
      return;
    }
    if (t.closest('[data-if-validate]')) {
      validateIndicatorForm();
      return;
    }
    if (t.closest('[data-if-run]')) {
      runIndicatorPreview();
      return;
    }
    if (t.closest('[data-if-save]')) {
      saveIndicatorForm();
    }
  }

  // =========================================================================
  // 事件绑定
  // =========================================================================
  function bindCreateBtn() {
    var btn = q('#strategyCreateBtn');
    if (!btn || btn.getAttribute('data-strat-bound')) return;
    btn.setAttribute('data-strat-bound', '1');
    btn.addEventListener('click', function () { openTypeChooser(); });
  }

  function bindHomeEvents() {
    var home = homeEl();
    if (!home || home.getAttribute('data-strat-events')) return;
    home.setAttribute('data-strat-events', '1');
    home.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-strat-new]')) {
        openTypeChooser();
        return;
      }
      var del = t.closest('[data-strat-del]');
      if (del) {
        handleHomeDelete(del);
        return;
      }
      var indTpl = t.closest('[data-ind-tpl]');
      if (indTpl) {
        var it = findIndicatorTemplate(indTpl.getAttribute('data-ind-tpl'));
        if (it) openDetail(templateIndicatorTarget(it));
        else toast('该指标模板暂不可用，请刷新重试');
        return;
      }
      var tpl = t.closest('[data-strat-tpl]');
      if (tpl) {
        var tplId = tpl.getAttribute('data-strat-tpl');
        var tplData = templateById(tplId);
        if (tplData) openDetail(templateTarget(tplData));
        return;
      }
      var card = t.closest('[data-strat-id]');
      if (card) {
        var s = findStrategy(card.getAttribute('data-strat-id'));
        if (s) openDetail(s.type === 'indicator' ? indicatorTarget(s) : mineTarget(s));
      }
    });
  }

  function handleHomeDelete(btn) {
    var id = btn.getAttribute('data-strat-del');
    if (!btn.__stratArmed) {
      btn.__stratArmed = true;
      btn.textContent = '再点一次确认';
      setTimeout(function () {
        btn.__stratArmed = false;
        if (btn.textContent === '再点一次确认') btn.textContent = '删除';
      }, 4000);
      return;
    }
    btn.__stratArmed = false;
    var s = findStrategy(id);
    deleteStrategy(id);
    renderMineSection();
    toast(s ? '已删除策略：' + s.name : '策略已删除');
  }

  function bindViewEvents() {
    var view = viewEl();
    if (!view || view.getAttribute('data-strat-events')) return;
    view.setAttribute('data-strat-events', '1');
    view.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('[data-strat-back]')) {
        goHome();
        return;
      }
      var itab = t.closest('[data-ind-tab]');
      if (itab) {
        setIndicatorTab(itab.getAttribute('data-ind-tab'));
        return;
      }
      var iop = t.closest('[data-ind-op]');
      if (iop) {
        handleIndicatorOp(iop);
        return;
      }
      var tabBtn = t.closest('[data-dtab]');
      if (tabBtn) {
        setTab(tabBtn.getAttribute('data-dtab'));
        return;
      }
      var op = t.closest('[data-strat-op]');
      if (op) {
        handleDetailOp(op);
        return;
      }
      var hold = t.closest('[data-hold-code]');
      if (hold) openHoldingDetail(hold);
    });
  }

  function handleDetailOp(btn) {
    var d = APP.detail;
    if (!d) return;
    var op = btn.getAttribute('data-strat-op');
    if (op === 'retry' || op === 'recalc') {
      if (op === 'recalc') toast('正在重新计算…', 1200);
      recalcDetail();
      return;
    }
    if (op === 'edit') {
      var s = findStrategy(d.target.id);
      if (s) openCreateForm(s);
      return;
    }
    if (op === 'copy') {
      copyTemplate(d.target);
      return;
    }
    if (op === 'delete') {
      if (!btn.__stratArmed) {
        btn.__stratArmed = true;
        btn.textContent = '再点一次确认删除';
        setTimeout(function () {
          btn.__stratArmed = false;
          if (btn.textContent === '再点一次确认删除') btn.textContent = '删除策略';
        }, 4000);
        return;
      }
      btn.__stratArmed = false;
      var removed = findStrategy(d.target.id);
      deleteStrategy(d.target.id);
      toast(removed ? '已删除策略：' + removed.name : '策略已删除');
      goHome();
    }
  }

  function bindSheetEvents() {
    var body = q('#sheetBody');
    if (!body || body.getAttribute('data-strat-events')) return;
    body.setAttribute('data-strat-events', '1');
    body.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      // 1) 新建类型选择（组合配置 / 指标公式）
      if (t.closest('[data-ct-cancel]')) {
        closeSheetForm();
        return;
      }
      var choice = t.closest('[data-ct-choice]');
      if (choice) {
        var kind = choice.getAttribute('data-ct-choice');
        closeSheetForm();
        if (kind === 'indicator') openIndicatorForm(null);
        else openCreateForm(null);
        return;
      }
      // 2) 指标公式表单
      if (APP.indForm) {
        handleIndicatorFormClick(t);
        return;
      }
      // 3) 组合配置表单
      if (!APP.form) return;
      if (t.closest('[data-sf-cancel]')) {
        closeForm();
        return;
      }
      if (t.closest('[data-sf-save]')) {
        saveForm();
        return;
      }
      var del = t.closest('[data-sf-del]');
      if (del) {
        readForm();
        if (!APP.form) return;
        var idx = parseInt(del.getAttribute('data-sf-del'), 10);
        if (!isFinite(idx) || !APP.form.holdings[idx]) return;
        APP.form.holdings.splice(idx, 1);
        paintForm();
      }
    });
    // 点击抽屉外任意位置时收起搜索建议（覆盖组合表单 + 指标表单 + 基金搜索）
    document.addEventListener('click', function (e) {
      qa('.t-suggest').forEach(function (box) {
        if (!box || box.classList.contains('hidden')) return;
        if (box.contains(e.target)) return;
        var field = box.parentNode;
        if (field && field.contains(e.target)) return;
        box.classList.add('hidden');
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (APP.indForm) {
        closeIndicatorForm();
        return;
      }
      if (APP.form) closeForm();
    });
  }

  // 关闭抽屉里的临时表单（类型选择 / 指标公式 / 组合配置）
  function closeSheetForm() {
    APP.form = null;
    APP.indForm = null;
    APP.formSeq += 1;
    APP.indFormSeq += 1;
    if (JYXT.closeSheet) JYXT.closeSheet();
  }

  // =========================================================================
  // 激活
  // =========================================================================
  function activate() {
    try {
      bindCreateBtn();
      bindHomeEvents();
      bindViewEvents();
      if (!APP.activated) {
        APP.activated = true;
        renderHome();
      } else if (!APP.detail && !APP.idetail) {
        renderMineSection();
        loadMineSummaries();
      }
    } catch (err) {
      if (window.console) console.error('[strategy] 渲染失败', err);
    }
  }

  function boot() {
    var sec = strategySection();
    if (!sec) return;
    bindSheetEvents();
    if (JY && typeof JY.onView === 'function') {
      JY.onView(function (name) {
        if (name === 'strategy') activate();
      });
    } else {
      // 兜底：监听底部 tab 点击 + 首帧检查
      document.addEventListener('click', function (e) {
        var tab = e.target && e.target.closest ? e.target.closest('#tabbar .tab[data-tab="strategy"]') : null;
        if (tab) setTimeout(activate, 0);
      }, true);
      var current = q('.view.active');
      if (current && current.getAttribute('data-view') === 'strategy') activate();
    }
    // 暴露调试入口（可手动刷新策略首页 / 打开模板）
    window.JYStrategy = {
      refresh: function () { renderHome(); },
      refreshIndicatorTemplates: function () { loadIndicatorTemplates(true); },
      openTemplate: function (id) {
        var tpl = templateById(id);
        if (tpl) openDetail(templateTarget(tpl));
      },
      openIndicatorTemplate: function (key) {
        var it = findIndicatorTemplate(key);
        if (it) openDetail(templateIndicatorTarget(it));
      },
      openIndicatorStrategy: function (id) {
        var s = findStrategy(id);
        if (s && s.type === 'indicator') openDetail(indicatorTarget(s));
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
