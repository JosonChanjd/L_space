/* 韭研 · 投研工作台 —— 前端逻辑（零依赖，原生 JS）
 * 数据来自本地 Node 后端：GET /api/snapshot、POST /api/refresh、GET /api/quote
 */
(function () {
  'use strict';

  // ---------- 常量 ----------
  var LS_WATCH = 'jy_watch_v1';
  var LS_THEME = 'jy_theme_v1';
  var LS_FX = 'jy_fx_v1';
  var STORAGE_FX = 'jy_fx_rates_v1';
  var POLL_MS = 60000;           // 页面每 60s 同步一次快照
  var SEARCH_DEBOUNCE = 300;

  var FX_DEFAULT = { CNY: 1, USD: 7.10, HKD: 0.91, EUR: 7.72, JPY: 0.0472, GBP: 9.02 };
  var FX_NAME = { CNY: '人民币 CNY', USD: '美元 USD', HKD: '港币 HKD', EUR: '欧元 EUR', JPY: '日元 JPY', GBP: '英镑 GBP' };

  var STRATEGIES = [
    { key: 'etf', title: 'ETF 轮动', risk: '中风险', desc: '沪深300 / 创业板 / 恒生 三类宽基 ETF 按 20 日动量轮动，每月调仓一次，弱市切货基避险。', meta: '调仓频率：月 · 建议仓位随恐贪指数动态调整' },
    { key: 'grid', title: '网格交易', risk: '中高风险', desc: '对高波动宽基设 ±5% 网格，价格每下一格买入、上一格卖出，震荡市赚波动，单边市注意破网止损。', meta: '适合震荡市 · 网格区间需覆盖近一年振幅' },
    { key: 'dca', title: '基金定投', risk: '中低风险', desc: '每周/每月固定金额买入宽基指数基金，恐贪指数低于 30 时加倍定投，高于 80 时暂停买入。', meta: '长期持有 · 用情绪做加减速' },
    { key: 'asset', title: '资产配置', risk: '低风险', desc: '股 50% / 债 30% / 商品 15% / 现金 5% 的经典组合，每季度再平衡，降低单一市场回撤。', meta: '再平衡频率：季度 · 最大回撤优先' }
  ];

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ---------- 工具函数 ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function fmt(v, digits) {
    var n = num(v);
    if (n == null) return '—';
    digits = digits == null ? 2 : digits;
    return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function fmtPct(v) {
    var n = num(v);
    if (n == null) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtSigned(v, digits) {
    var n = num(v);
    if (n == null) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(digits == null ? 2 : digits);
  }
  function pctDir(v) { var n = num(v); return n == null ? 'flat' : (n > 0 ? 'up' : (n < 0 ? 'down' : 'flat')); }
  function pctDirByValue(v) { var n = num(v); return n == null ? 'flat' : (n > 0 ? 'up' : (n < 0 ? 'down' : 'flat')); }
  function nowFmt(ts) {
    var d = new Date(ts || Date.now());
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function hmFmt(ts) {
    var d = new Date(ts || Date.now());
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function relTime(ts) {
    var diff = Math.max(0, Date.now() - (ts || Date.now()));
    if (diff < 60000) return '刚刚';
    var m = Math.floor(diff / 60000);
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    return Math.floor(h / 24) + ' 天前';
  }
  function durFmt(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return p(h) + ':' + p(m) + ':' + p(sec);
  }
  function debounce(fn, wait) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }
  function readLS(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  }
  function writeLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

  // ---------- 应用状态 ----------
  var state = {
    snapshot: null,
    watch: readLS(LS_WATCH, ['sh000001', 'usAAPL', 'hk00700']) || [],
    fx: readLS(STORAGE_FX, null) || FX_DEFAULT,
    calcMode: 'dca',
    searchResults: [],
    searchQuery: '',
    loading: false,
    watchEditing: false,
    detailCode: null,
    lastUpdatedAt: 0
  };

  // ---------- API ----------
  function api(path, options) {
    return fetch(path, options || {}).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  // ---------- 视图切换 ----------
  var VIEWS = ['home', 'watch', 'strategy', 'tools', 'mine'];
  function setView(name, push) {
    if (VIEWS.indexOf(name) < 0) name = 'home';
    $$('.view').forEach(function (v) {
      var on = v.getAttribute('data-view') === name;
      v.classList.toggle('active', on);
    });
    $$('#tabbar .tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name);
    });
    if (push !== false) {
      var h = '#' + name;
      if (location.hash !== h) history.replaceState(null, '', h);
    }
    if (name === 'watch') renderWatch();
    if (name === 'strategy') renderStrategy();
    if (name === 'tools') { renderCalc(); renderFx(); renderToolFg(); fireToolsInit(); }
    if (name === 'mine') renderMine();
    fireViewHooks(name);
    var scroller = $('.view.active .scroll');
    if (scroller) scroller.scrollTop = 0;
  }

  // ---------- 视图切换钩子（供 strategy.js 等扩展脚本使用） ----------
  var viewHooks = [];
  function fireViewHooks(name) {
    viewHooks.forEach(function (cb) {
      try { cb(name); } catch (e) { console.error('[view hook]', e); }
    });
  }
  function currentView() {
    var v = document.querySelector('.view.active');
    return v ? v.getAttribute('data-view') : null;
  }
  function addViewHook(cb) {
    if (typeof cb !== 'function') return;
    viewHooks.push(cb);
    var cur = currentView();
    if (cur) { try { cb(cur); } catch (e) { console.error('[view hook]', e); } }
  }

  // ---------- 顶部提示 ----------
  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
      el.classList.add('hidden');
    }, ms || 2200);
  }

  // ---------- 渲染：恐贪仪表盘 ----------
  function fgLevelColor(value) {
    var v = num(value);
    if (v == null) return '#8a94a6';
    if (v < 20) return '#2f9e6f';
    if (v < 40) return '#4aa3a3';
    if (v < 60) return '#d8a533';
    if (v < 80) return '#e56b34';
    return '#e5433b';
  }

  function renderGauge(fg) {
    var wrap = $('#fgWrap');
    if (!wrap) return;
    if (!fg || num(fg.value) == null) {
      wrap.innerHTML = '<div class="empty"><div class="empty-ico">📉</div><p>恐贪指数暂时不可用</p><p class="muted sm">请稍后点右上角 ⟳ 刷新</p></div>';
      return;
    }
    var value = Math.max(0, Math.min(100, num(fg.value)));
    var color = fg.color || fgLevelColor(value);
    // 指针角度：0 → -120°，100 → +120°
    var ang = -120 + (value / 100) * 240;
    var factors = Array.isArray(fg.factors) ? fg.factors : [];
    var factorHTML = factors.map(function (f) {
      var fv = num(f.value);
      var w = fv == null ? 0 : Math.max(0, Math.min(100, fv));
      return '' +
        '<div class="fg-factor">' +
          '<div class="fg-factor-head"><span>' + esc(f.label || '') + '</span><b>' + (fv == null ? '—' : fv.toFixed(1)) + '</b></div>' +
          '<div class="fg-factor-bar"><i style="width:' + w.toFixed(1) + '%"></i></div>' +
          '<small class="muted">' + esc(f.desc || '') + '</small>' +
        '</div>';
    }).join('');

    wrap.innerHTML = '' +
      '<div class="fg-gauge" style="--ang:' + ang.toFixed(1) + ';--fg-color:' + esc(color) + '">' +
        '<div class="fg-dial"></div>' +
        '<div class="fg-needle"></div>' +
        '<div class="fg-value">' + Math.round(value) + '</div>' +
        '<div class="fg-level" style="color:' + esc(color) + '">' + esc(fg.level || '—') + '</div>' +
      '</div>' +
      '<div class="fg-factors">' + factorHTML + '</div>' +
      '<div class="fg-meta muted sm">多因子合成 · 更新于 ' + esc(relTime(fg.updatedAt || state.lastUpdatedAt)) + ' · 仅供参考</div>';
  }

  // ---------- 渲染：市场速览 chips ----------
  function renderChips(chips) {
    var box = $('#chips');
    if (!box) return;
    if (!chips || !chips.length) {
      box.innerHTML = '<div class="muted sm">暂无行情数据</div>';
      return;
    }
    box.innerHTML = chips.map(function (q) {
      var dir = pctDir(q.changePct);
      return '' +
        '<button class="chip" data-code="' + esc(q.code) + '">' +
          '<span class="chip-name">' + esc(q.name) + '</span>' +
          '<span class="chip-price ' + dir + '">' + fmt(q.price, 2) + '</span>' +
          '<span class="chip-pct ' + dir + '">' + fmtPct(q.changePct) + '</span>' +
        '</button>';
    }).join('');
  }

  // ---------- 渲染：行情分区 ----------
  function quoteRowHTML(q, opts) {
    opts = opts || {};
    var dir = pctDir(q.changePct);
    var starred = state.watch.indexOf(q.code) >= 0;
    var unit = opts.showUnit && q.unit ? '<small class="q-unit">' + esc(q.unit) + '</small>' : '';
    var codeText = q.market === 'commodity' ? '外盘期货' : (q.code || '').toUpperCase();
    return '' +
      '<div class="quote-row' + (opts.noClick ? ' quote-row-static' : '') + '" data-code="' + esc(q.code) + '"' +
        (opts.noClick ? ' data-noclick="1"' : ' role="button" tabindex="0"') + '>' +
        '<div class="q-main">' +
          '<span class="q-name">' + esc(q.name) + '<small class="q-code">' + esc(codeText) + '</small></span>' +
          '<span class="q-price ' + dir + '">' + fmt(q.price, 2) + unit + '</span>' +
        '</div>' +
        '<div class="q-sub">' +
          '<span class="q-pct ' + dir + '">' + fmtPct(q.changePct) + '</span>' +
          '<span class="q-chg ' + dir + '">' + fmtSigned(q.change) + '</span>' +
        '</div>' +
        (opts.noStar ? '' : '<button class="star ' + (starred ? 'on' : '') + '" data-star="' + esc(q.code) + '" aria-label="自选">' + (starred ? '★' : '☆') + '</button>') +
      '</div>';
  }

  function renderSections(sections) {
    var box = $('#marketSections');
    if (!box) return;
    if (!sections || !sections.length) {
      box.innerHTML = '<section class="card market-card"><div class="card-head"><span class="card-title">行情</span></div><div class="empty"><div class="empty-ico">📊</div><p>暂无行情数据</p><p class="muted sm">点右上角 ⟳ 重新抓取</p></div></section>';
      return;
    }
    box.innerHTML = sections.map(function (sec) {
      var items = Array.isArray(sec.items) ? sec.items : [];
      var isCommodity = sec.id === 'commodity' || sec.commodity === true;
      if (!items.length) {
        return '' +
          '<section class="card market-card">' +
            '<div class="card-head"><span class="card-title">' + esc(sec.title) + '</span></div>' +
            '<div class="empty"><p class="muted sm">该板块暂未接入数据源</p></div>' +
          '</section>';
      }
      return '' +
        '<section class="card market-card">' +
          '<div class="card-head"><span class="card-title">' + esc(sec.title) + '</span><span class="muted sm">' + (isCommodity ? '外盘 · 实时' : items.length + ' 项') + '</span></div>' +
          '<div class="quote-list">' + items.map(function (q) {
            return quoteRowHTML(q, { noStar: isCommodity, noClick: isCommodity, showUnit: isCommodity });
          }).join('') + '</div>' +
        '</section>';
    }).join('');
  }

  // ---------- 渲染：页脚时间 ----------
  function renderFooter(snap) {
    var s = snap || state.snapshot || {};
    var updated = num(s.updatedAt) || state.lastUpdatedAt || 0;
    var next = num(s.nextRefreshAt) || 0;
    if ($('#updatedLine')) $('#updatedLine').textContent = updated ? nowFmt(updated) + '（' + relTime(updated) + '）' : '—';
    if ($('#nextLine')) $('#nextLine').textContent = next ? hmFmt(next) + ' · 每日 19:00' : '每日 19:00';
    if ($('#mineNext')) $('#mineNext').textContent = next ? nowFmt(next) : '每日 19:00';
    tickCountdown();
  }

  function tickCountdown() {
    var el = $('#cdLine');
    var s = state.snapshot || {};
    var next = num(s.nextRefreshAt) || 0;
    if (!el) return;
    if (!next) { el.textContent = '—'; return; }
    var left = next - Date.now();
    el.textContent = left > 0 ? durFmt(left) + ' 后自动刷新' : '即将刷新…';
  }

  // ---------- 快照加载与刷新 ----------
  function applySnapshot(snap) {
    if (!snap) return;
    state.snapshot = snap;
    state.lastUpdatedAt = num(snap.updatedAt) || Date.now();
    renderGauge(snap.fearGreed);
    renderChips(snap.chips);
    renderSections(snap.sections);
    renderFooter(snap);
    if ($('.view.active') && $('.view.active').getAttribute('data-view') === 'watch') renderWatch();
    if ($('.view.active') && $('.view.active').getAttribute('data-view') === 'strategy') renderStrategy();
    if ($('.view.active') && $('.view.active').getAttribute('data-view') === 'tools') renderToolFg();
    renderMine();
  }

  function loadSnapshot(showError) {
    return api('/api/snapshot').then(function (data) {
      var snap = data && data.snapshot ? data.snapshot : data;
      applySnapshot(snap);
      return snap;
    }).catch(function (err) {
      if (showError) toast('加载失败：' + err.message + '，请确认本地服务已启动');
      throw err;
    });
  }

  function doRefresh() {
    if (state.loading) return;
    state.loading = true;
    var btn = $('#refreshBtn');
    if (btn) { btn.classList.add('spin'); btn.disabled = true; }
    toast('正在刷新行情…', 1200);
    api('/api/refresh', { method: 'POST' }).then(function (data) {
      var snap = data && data.snapshot ? data.snapshot : data;
      if (snap && snap.fearGreed) applySnapshot(snap);
      else return loadSnapshot(true);
      toast('行情已刷新 · ' + nowFmt(Date.now()));
    }).catch(function (err) {
      toast('刷新失败：' + err.message);
    }).then(function () {
      state.loading = false;
      if (btn) { btn.classList.remove('spin'); btn.disabled = false; }
    });
  }

  // ---------- 自选 ----------
  function saveWatch() { writeLS(LS_WATCH, state.watch); }

  function isWatched(code) { return state.watch.indexOf(code) >= 0; }

  function toggleWatch(code) {
    if (!code) return;
    var i = state.watch.indexOf(code);
    if (i >= 0) { state.watch.splice(i, 1); toast('已移出自选'); }
    else { state.watch.push(code); toast('已加入自选 ★'); }
    saveWatch();
    // 更新所有星标
    $$('.star').forEach(function (b) {
      if (b.getAttribute('data-star') === code) {
        b.classList.toggle('on', isWatched(code));
        b.textContent = isWatched(code) ? '★' : '☆';
      }
    });
    renderWatch();
    updateSheetWatchBtn();
  }

  function watchCodes() { return state.watch.slice(); }

  function renderWatch() {
    var box = $('#watchList');
    if (!box) return;
    var codes = watchCodes();
    if (!codes.length) {
      box.innerHTML = '' +
        '<div class="empty">' +
          '<div class="empty-ico">⭐</div>' +
          '<p>还没有自选标的</p>' +
          '<p class="muted sm">在行情或搜索结果里点 ☆ 即可加入</p>' +
          '<button class="primary-btn" data-goto="home">去行情页添加</button>' +
        '</div>';
      return;
    }
    box.innerHTML = '<div class="empty"><p class="muted sm">加载自选行情…</p></div>';
    api('/api/quote?codes=' + encodeURIComponent(codes.join(','))).then(function (data) {
      var quotes = (data && data.quotes) || [];
      if (!quotes.length) {
        box.innerHTML = '<div class="empty"><div class="empty-ico">⭐</div><p>暂无自选行情</p></div>';
        return;
      }
      box.innerHTML = quotes.map(function (q) {
        var dir = pctDir(q.changePct);
        return '' +
          '<div class="quote-card" data-code="' + esc(q.code) + '">' +
            '<div class="qc-head"><b>' + esc(q.name) + '</b><small class="muted">' + esc((q.code || '').toUpperCase()) + '</small></div>' +
            '<div class="qc-price ' + dir + '">' + fmt(q.price, 2) + '</div>' +
            '<div class="qc-pct ' + dir + '">' + fmtPct(q.changePct) + ' · ' + fmtSigned(q.change) + '</div>' +
            (state.watchEditing ? '<button class="del-btn" data-del="' + esc(q.code) + '">删除</button>' : '') +
          '</div>';
      }).join('');
    }).catch(function () {
      box.innerHTML = '<div class="empty"><div class="empty-ico">⚠️</div><p>自选行情加载失败</p><p class="muted sm">请确认本地服务已启动</p></div>';
    });
  }

  // ---------- 行情详情抽屉 ----------
  function rangeBar(label, value, min, max, fmtFn) {
    var v = num(value), lo = num(min), hi = num(max);
    var pct = null;
    if (v != null && lo != null && hi != null && hi > lo) {
      pct = Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
    }
    var f = fmtFn || function (x) { return fmt(x, 2); };
    return '' +
      '<div class="range-wrap">' +
        '<div class="range-label"><span>' + esc(label) + '</span>' +
          '<span class="muted sm">' + (pct == null ? '—' : pct.toFixed(0) + '%') + '</span></div>' +
        '<div class="range-bar">' + (pct == null ? '' : '<i class="range-fill" style="width:' + pct.toFixed(1) + '%"></i><b class="range-dot" style="left:' + pct.toFixed(1) + '%"></b>') + '</div>' +
        '<div class="range-ends"><span class="muted sm">' + f(lo) + '</span><span class="muted sm">' + f(hi) + '</span></div>' +
      '</div>';
  }

  function openDetail(code) {
    var sheet = $('#sheet'), mask = $('#sheetMask'), body = $('#sheetBody');
    if (!sheet || !mask || !body) return;
    state.detailCode = code;
    body.innerHTML = '<div class="empty"><p class="muted sm">加载中…</p></div>';
    mask.classList.remove('hidden');
    sheet.classList.remove('hidden');
    api('/api/quote?codes=' + encodeURIComponent(code)).then(function (data) {
      var q = (data && data.quotes && data.quotes[0]) || null;
      if (!q) { body.innerHTML = '<div class="empty"><p>未查询到标的行情</p></div>'; return; }
      var dir = pctDir(q.changePct);
      var unit = q.unit ? ' ' + esc(q.unit) : '';
      body.innerHTML = '' +
        '<div class="detail-head">' +
          '<h3>' + esc(q.name) + ' <small class="muted">' + esc((q.code || '').toUpperCase()) + '</small></h3>' +
          '<div class="detail-price ' + dir + '">' + fmt(q.price, 2) + unit + '</div>' +
          '<div class="detail-chg ' + dir + '">' + fmtSigned(q.change) + ' · ' + fmtPct(q.changePct) + '</div>' +
        '</div>' +
        '<div class="kv-grid">' +
          '<div class="kv-item"><span>今开</span><b>' + fmt(q.open) + '</b></div>' +
          '<div class="kv-item"><span>昨收</span><b>' + fmt(q.prevClose) + '</b></div>' +
          '<div class="kv-item"><span>最高</span><b class="up">' + fmt(q.high) + '</b></div>' +
          '<div class="kv-item"><span>最低</span><b class="down">' + fmt(q.low) + '</b></div>' +
        '</div>' +
        '<div class="range-group">' +
          rangeBar('日内区间', q.price, q.low, q.high) +
          rangeBar('52 周区间', q.price, q.low52w, q.high52w) +
        '</div>' +
        '<button class="primary-btn sheet-star ' + (isWatched(q.code) ? 'on' : '') + '" id="sheetWatchBtn" data-watch-code="' + esc(q.code) + '">' +
          (isWatched(q.code) ? '★ 已在自选' : '☆ 加入自选') +
        '</button>';
      var btn = $('#sheetWatchBtn');
      if (btn) btn.onclick = function () { toggleWatch(q.code); };
    }).catch(function (err) {
      body.innerHTML = '<div class="empty"><p>加载失败：' + esc(err.message) + '</p></div>';
    });
  }

  function updateSheetWatchBtn() {
    var btn = $('#sheetWatchBtn');
    if (!btn) return;
    var code = btn.getAttribute('data-watch-code');
    if (!code) return;
    var on = isWatched(code);
    btn.classList.toggle('on', on);
    btn.textContent = on ? '★ 已在自选' : '☆ 加入自选';
  }

  function closeDetail() {
    var sheet = $('#sheet'), mask = $('#sheetMask');
    if (sheet) sheet.classList.add('hidden');
    if (mask) mask.classList.add('hidden');
    state.detailCode = null;
  }

  // ---------- 通用底部抽屉（供扩展脚本复用） ----------
  function openSheet(html) {
    var sheet = $('#sheet'), mask = $('#sheetMask'), body = $('#sheetBody');
    if (!sheet || !mask || !body) return;
    body.innerHTML = html;
    mask.classList.remove('hidden');
    sheet.classList.remove('hidden');
  }

  // ---------- 扩展脚本（tools.js / tools-extra.js）初始化注册 ----------
  var toolsInitCallbacks = [];
  function fireToolsInit() {
    toolsInitCallbacks.forEach(function (cb) {
      try { cb(); } catch (e) { console.error('[tools init]', e); }
    });
  }
  function toolsViewActive() {
    var v = document.querySelector('.view.active');
    return !!v && v.getAttribute('data-view') === 'tools';
  }

  // ---------- 搜索 ----------
  function renderSearchResults(quotes, query) {
    var box = $('#searchResult');
    if (!box) return;
    if (!query) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (!quotes || !quotes.length) {
      box.innerHTML = '<div class="empty"><p>没有找到「' + esc(query) + '」相关标的</p><p class="muted sm">试试 600519 / AAPL / 700</p></div>';
      return;
    }
    box.innerHTML = quotes.map(quoteRowHTML).join('');
  }

  var doSearch = debounce(function (q) {
    if (!q) { renderSearchResults([], ''); return; }
    state.searchQuery = q;
    api('/api/quote?codes=' + encodeURIComponent(q))
      .then(function (data) {
        var quotes = (data && data.quotes) || [];
        state.searchResults = quotes;
        renderSearchResults(quotes, q);
      })
      .catch(function () {
        renderSearchResults([], q);
      });
  }, SEARCH_DEBOUNCE);

  // ---------- 策略 ----------
  function renderStrategy() {
    var hero = $('#sentimentHero'), list = $('#strategyList');
    var fg = (state.snapshot && state.snapshot.fearGreed) || null;
    var v = fg ? num(fg.value) : null;
    if (hero) {
      if (v == null) {
        hero.innerHTML = '<div class="senti-row"><span>市场情绪</span><b>—</b></div><p class="muted sm">恐贪指数不可用时无法给出情绪建议</p>';
      } else {
        var level = fg.level || '';
        var color = fg.color || fgLevelColor(v);
        var advice = v >= 80 ? '情绪极度贪婪，建议降低股票仓位、分批止盈' :
          v >= 60 ? '情绪偏贪婪，可持有但不再追高，逐步锁定收益' :
            v >= 40 ? '情绪中性，维持原有配置，等待方向确认' :
              v >= 20 ? '情绪偏恐惧，可小幅分批加仓优质宽基' :
                '情绪极度恐惧，历史上往往对应中长期底部区域，分批布局';
        hero.innerHTML = '' +
          '<div class="senti-row"><span>市场情绪</span><b style="color:' + esc(color) + '">' + esc(level) + ' · ' + Math.round(v) + '</b></div>' +
          '<div class="senti-bar"><i style="width:' + v.toFixed(1) + '%;background:' + esc(color) + '"></i></div>' +
          '<p class="senti-advice">' + esc(advice) + '</p>';
      }
    }
    if (list) {
      list.innerHTML = STRATEGIES.map(function (s) {
        var sug = '';
        if (v != null) {
          if (s.key === 'dca') sug = v < 30 ? '建议：加倍定投' : (v > 80 ? '建议：暂停买入' : '建议：正常定投');
          else if (s.key === 'etf') sug = v > 70 ? '建议：降低仓位' : (v < 30 ? '建议：逐步加仓' : '建议：持仓观望');
          else if (s.key === 'grid') sug = v > 75 || v < 25 ? '注意：单边行情风险' : '适合：震荡行情';
          else sug = v > 75 ? '建议：增配债券现金' : '建议：维持比例';
        }
        return '' +
          '<div class="strategy-card">' +
            '<div class="s-head"><h3>' + esc(s.title) + '</h3><span class="tag-pill">' + esc(s.risk) + '</span></div>' +
            '<p class="s-desc">' + esc(s.desc) + '</p>' +
            (sug ? '<p class="s-sug">' + esc(sug) + '</p>' : '') +
            '<div class="s-meta muted sm">' + esc(s.meta) + '</div>' +
          '</div>';
      }).join('');
    }
  }

  // ---------- 工具：收益计算器 ----------
  function renderCalc() {
    var body = $('#calcResult');
    if (!body) return;
    var mode = state.calcMode;
    var amt = num(($('#calcAmt') || {}).value) || 0;
    var rate = num(($('#calcRate') || {}).value) || 0;
    var years = Math.max(0, num(($('#calcYears') || {}).value) || 0);
    var r = rate / 100;
    var principal, total, gain;
    if (mode === 'dca') {
      var i = r / 12, m = Math.round(years * 12);
      principal = amt * m;
      total = i === 0 ? principal : amt * (Math.pow(1 + i, m) - 1) / i;
      gain = total - principal;
      body.innerHTML = '' +
        '<div class="calc-row"><span>累计投入</span><b>¥' + fmt(principal, 0) + '</b></div>' +
        '<div class="calc-row"><span>预期收益</span><b class="up">¥' + fmt(gain, 0) + '</b></div>' +
        '<div class="calc-total"><span>到期总额</span><b>¥' + fmt(total, 0) + '</b></div>' +
        '<p class="muted sm">按每月定投 ¥' + fmt(amt, 0) + '、年化 ' + rate + '%、共 ' + m + ' 期测算，仅为估算，不构成投资建议。</p>';
    } else {
      principal = amt;
      total = amt * Math.pow(1 + r, years);
      gain = total - principal;
      body.innerHTML = '' +
        '<div class="calc-row"><span>投入本金</span><b>¥' + fmt(principal, 0) + '</b></div>' +
        '<div class="calc-row"><span>预期收益</span><b class="up">¥' + fmt(gain, 0) + '</b></div>' +
        '<div class="calc-total"><span>到期总额</span><b>¥' + fmt(total, 0) + '</b></div>' +
        '<p class="muted sm">按一次性投入 ¥' + fmt(amt, 0) + '、年化 ' + rate + '%、持有 ' + years + ' 年复利测算。</p>';
    }
    var label = $('#amtLabel');
    if (label) label.textContent = mode === 'dca' ? '每月定投 (¥)' : '一次性投入 (¥)';
  }

  // ---------- 工具：汇率换算 ----------
  function renderFx() {
    var from = $('#fxFrom'), to = $('#fxTo'), out = $('#fxResult');
    if (from && !from.options.length) {
      from.innerHTML = Object.keys(state.fx).map(function (k) {
        return '<option value="' + k + '">' + FX_NAME[k] + '</option>';
      }).join('');
      from.value = 'USD';
    }
    if (to && !to.options.length) {
      to.innerHTML = Object.keys(state.fx).map(function (k) {
        return '<option value="' + k + '">' + FX_NAME[k] + '</option>';
      }).join('');
      to.value = 'CNY';
    }
    if (out && from && to) {
      var amt = num(($('#fxAmt') || {}).value) || 0;
      var f = from.value, t = to.value;
      var rf = num(state.fx[f]), rt = num(state.fx[t]);
      var result = rf && rt ? amt * rf / rt : null;
      out.innerHTML = '' +
        '<div class="fx-out"><b>' + esc(f) + ' ' + fmt(amt, 2) + '</b><span>≈</span><b>' + esc(t) + ' ' + (result == null ? '—' : fmt(result, 2)) + '</b></div>';
    }
    var grid = $('#fxRates');
    if (grid) {
      grid.innerHTML = Object.keys(state.fx).map(function (k) {
        return '' +
          '<label class="fx-rate"><span>' + esc(k) + '</span>' +
            '<input type="number" step="0.0001" min="0" data-fx="' + esc(k) + '" value="' + state.fx[k] + '">' +
          '</label>';
      }).join('');
    }
  }

  // ---------- 工具：恐贪说明 ----------
  function renderToolFg() {
    var method = $('#fgMethod'), now = $('#fgNow');
    var fg = (state.snapshot && state.snapshot.fearGreed) || null;
    if (method) {
      var weightText = '';
      if (fg && Array.isArray(fg.factors) && fg.factors.length) {
        weightText = fg.factors.map(function (f) {
          var pctW = num(f.weight) == null ? null : (Number(f.weight) > 1 ? Number(f.weight) : Number(f.weight) * 100);
          return (f.label || '') + '（' + (pctW == null ? '—' : pctW.toFixed(0) + '%') + '）';
        }).join('、');
      } else {
        weightText = '股价强度、市场广度、动能';
      }
      method.innerHTML = '恐贪指数把市场情绪量化为 0-100：<b>0-20 极度恐惧</b>、20-40 恐惧、40-60 中性、60-80 贪婪、<b>80-100 极度贪婪</b>。' +
        '本工具用三个真实因子合成：' + esc(weightText) + '；数值越高代表市场情绪越贪婪，越低代表越恐惧。';
    }
    if (now) {
      if (!fg || num(fg.value) == null) {
        now.innerHTML = '<p class="muted sm">当前恐贪指数不可用，请稍后刷新。</p>';
        return;
      }
      var v = num(fg.value);
      var color = fg.color || fgLevelColor(v);
      now.innerHTML = '' +
        '<div class="fg-now-row"><span>当前情绪</span><b style="color:' + esc(color) + '">' + esc(fg.level) + '</b></div>' +
        '<div class="fg-now-row"><span>恐贪值</span><b>' + Math.round(v) + ' / 100</b></div>' +
        '<div class="fg-now-row"><span>更新于</span><b>' + esc(relTime(fg.updatedAt || state.lastUpdatedAt)) + '</b></div>';
    }
  }

  // ---------- 我的 ----------
  function renderMine() {
    var sw = $('#themeSwitch');
    if (sw) sw.checked = document.documentElement.getAttribute('data-theme') === 'dark';
    renderFooter(state.snapshot);
  }

  // ---------- 主题 ----------
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    writeLS(LS_THEME, theme);
    var btn = $('#themeBtn');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    var sw = $('#themeSwitch');
    if (sw) sw.checked = theme === 'dark';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#15181d' : '#ff5b3a');
  }
  function toggleTheme() {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }

  // ---------- 下拉刷新 ----------
  function bindPullToRefresh() {
    var scroller = $('.view[data-view="home"] .scroll');
    var ptr = $('#ptr'), ptrText = $('#ptrText');
    if (!scroller || !ptr) return;
    var startY = 0, pulling = false, dist = 0;
    var THRESHOLD = 70;
    scroller.addEventListener('touchstart', function (e) {
      if (scroller.scrollTop <= 0 && e.touches.length === 1) {
        startY = e.touches[0].clientY;
        pulling = true;
        dist = 0;
      }
    }, { passive: true });
    scroller.addEventListener('touchmove', function (e) {
      if (!pulling) return;
      dist = Math.max(0, e.touches[0].clientY - startY);
      if (dist > 0) {
        var d = Math.min(dist * 0.5, 70);
        ptr.style.height = d + 'px';
        ptr.style.opacity = String(Math.min(1, d / 50));
        if (ptrText) ptrText.textContent = d >= THRESHOLD ? '松开刷新' : '下拉刷新';
      }
    }, { passive: true });
    scroller.addEventListener('touchend', function () {
      if (!pulling) return;
      pulling = false;
      var should = dist >= THRESHOLD * 2;
      ptr.style.height = '0px';
      ptr.style.opacity = '0';
      if (ptrText) ptrText.textContent = '下拉刷新';
      if (should) doRefresh();
    }, { passive: true });
  }

  // ---------- 自选：搜索添加 ----------
  var watchSearchTimer = null;
  function bindWatchSearch() {
    var input = $('#watchSearchInput');
    var clearBtn = $('#watchSearchClear');
    var resultBox = $('#watchSearchResult');
    if (!input || !resultBox) return;

    function renderWatchResults(items, query) {
      if (!query) { resultBox.innerHTML = ''; resultBox.classList.add('hidden'); return; }
      resultBox.classList.remove('hidden');
      if (!items || !items.length) {
        resultBox.innerHTML = '<div class="empty"><p class="muted sm">没有找到「' + esc(query) + '」相关标的</p><p class="muted sm">支持股票代码/名称：600519、AAPL、00700</p></div>';
        return;
      }
      resultBox.innerHTML = items.map(function (it) {
        var inWatch = state.watch.indexOf(it.code) >= 0;
        return '<div class="quote-row watch-result" data-code="' + esc(it.code) + '">' +
          '<div class="q-main"><span class="q-name">' + esc(it.name) + '<small class="q-code">' + esc(it.code) + '</small></span>' +
          '<span class="q-day muted sm">' + esc(it.market || '') + '</span></div>' +
          '<button class="watch-add-btn' + (inWatch ? ' added' : '') + '" data-add-code="' + esc(it.code) + '" data-add-name="' + esc(it.name) + '">' + (inWatch ? '已在自选' : '＋ 添加') + '</button>' +
          '</div>';
      }).join('');
    }

    function searchNow() {
      var q = input.value.trim();
      if (clearBtn) clearBtn.classList.toggle('hidden', !q);
      if (!q) { renderWatchResults([], ''); return; }
      api('/api/stock/search?key=' + encodeURIComponent(q) + '&limit=8').then(function (data) {
        var items = (data && data.items) || [];
        var codeLike = /^(sh|sz|hk|us)?[0-9A-Za-z.]{1,8}$/i.test(q) && !items.some(function (it) { return it.code === q; });
        if (!codeLike) { renderWatchResults(items, q); return; }
        api('/api/quote?codes=' + encodeURIComponent(q)).then(function (qd) {
          var quotes = (qd && qd.quotes) || [];
          var direct = quotes.map(function (x) { return { code: x.code, name: x.name, market: '直接添加' }; });
          renderWatchResults(direct.concat(items), q);
        }).catch(function () { renderWatchResults(items, q); });
      }).catch(function () { renderWatchResults([], q); });
    }

    input.addEventListener('input', function () {
      clearTimeout(watchSearchTimer);
      watchSearchTimer = setTimeout(searchNow, 250);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { clearTimeout(watchSearchTimer); searchNow(); }
    });
    if (clearBtn) clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.classList.add('hidden');
      renderWatchResults([], '');
    });
    resultBox.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-add-code]');
      if (!btn) return;
      e.stopPropagation();
      var rawCode = btn.getAttribute('data-add-code');
      var rawName = btn.getAttribute('data-add-name');
      // 统一用行情接口返回的归一化代码（600519→sh600519、AAPL→usAAPL），避免重复自选
      api('/api/quote?codes=' + encodeURIComponent(rawCode)).then(function (data) {
        var q = (data && data.quotes && data.quotes[0]) || null;
        var code = q ? q.code : rawCode;
        var name = q ? q.name : rawName;
        if (state.watch.indexOf(code) < 0) {
          state.watch.push(code);
          saveWatch();
          toast('已加入自选：' + name);
          renderWatch();
        }
        btn.classList.add('added');
        btn.textContent = '已在自选';
      }).catch(function () {
        if (state.watch.indexOf(rawCode) < 0) {
          state.watch.push(rawCode);
          saveWatch();
          toast('已加入自选：' + rawName);
          renderWatch();
        }
        btn.classList.add('added');
        btn.textContent = '已在自选';
      });
    });
  }

  // ---------- 事件绑定 ----------
  function bindEvents() {
    // 视图 tab
    $$('#tabbar .tab').forEach(function (t) {
      t.addEventListener('click', function () { setView(t.getAttribute('data-tab')); });
    });
    // 深链
    window.addEventListener('hashchange', function () { routeFromHash(); });

    // 顶栏
    var themeBtn = $('#themeBtn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    var refreshBtn = $('#refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', doRefresh);

    // 页面内点击委托
    document.addEventListener('click', function (e) {
      var star = e.target.closest('[data-star]');
      if (star) {
        e.stopPropagation();
        toggleWatch(star.getAttribute('data-star'));
        return;
      }
      var del = e.target.closest('[data-del]');
      if (del) {
        e.stopPropagation();
        var c = del.getAttribute('data-del');
        var idx = state.watch.indexOf(c);
        if (idx >= 0) { state.watch.splice(idx, 1); saveWatch(); renderWatch(); toast('已删除'); }
        return;
      }
      var goto = e.target.closest('[data-goto]');
      if (goto) { setView(goto.getAttribute('data-goto')); return; }
      var row = e.target.closest('.quote-row, .quote-card, .chip');
      if (row) {
        if (row.getAttribute('data-noclick')) return;
        var code = row.getAttribute('data-code');
        if (code) {
          openDetail(code);
          return;
        }
      }
      if (e.target.closest('#sheetMask') || e.target.closest('.sheet-handle')) closeDetail();
    });

    // 搜索
    var input = $('#searchInput');
    if (input) {
      input.addEventListener('input', function () {
        var q = input.value.trim();
        var clear = $('#searchClear');
        if (clear) clear.classList.toggle('hidden', !q);
        if (!q) renderSearchResults([], '');
        else doSearch(q);
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          var q = input.value.trim();
          if (q) { state.searchQuery = q; doSearch(q); }
        }
      });
    }
    var clearBtn = $('#searchClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (input) input.value = '';
        clearBtn.classList.add('hidden');
        renderSearchResults([], '');
      });
    }
    // 热门标签
    var hot = $('#hotTags');
    if (hot) {
      hot.addEventListener('click', function (e) {
        var tag = e.target.closest('[data-code]');
        if (!tag) return;
        if (input) input.value = tag.textContent.trim();
        state.searchQuery = tag.textContent.trim();
        doSearch(tag.getAttribute('data-code'));
      });
    }

    // 自选编辑
    var editBtn = $('#watchEditBtn');
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        state.watchEditing = !state.watchEditing;
        editBtn.textContent = state.watchEditing ? '完成' : '编辑';
        renderWatch();
      });
    }
    var clearWatch = $('#clearWatchBtn');
    if (clearWatch) {
      clearWatch.addEventListener('click', function () {
        if (!state.watch.length) { toast('自选已是空的'); return; }
        if (confirm('确定清空全部自选？')) {
          state.watch = [];
          saveWatch();
          renderWatch();
          toast('已清空自选');
        }
      });
    }

    // 工具：计算器
    var calcMode = $('#calcMode');
    if (calcMode) {
      calcMode.addEventListener('click', function (e) {
        var b = e.target.closest('[data-mode]');
        if (!b) return;
        state.calcMode = b.getAttribute('data-mode');
        $$('#calcMode .seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
        renderCalc();
      });
    }
    ['#calcAmt', '#calcRate', '#calcYears'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.addEventListener('input', renderCalc);
    });

    // 工具：汇率
    ['#fxAmt', '#fxFrom', '#fxTo'].forEach(function (sel) {
      var el = $(sel);
      if (el) { el.addEventListener('input', renderFx); el.addEventListener('change', renderFx); }
    });
    var rates = $('#fxRates');
    if (rates) {
      rates.addEventListener('input', function (e) {
        var inp = e.target.closest('[data-fx]');
        if (!inp) return;
        var k = inp.getAttribute('data-fx');
        var v = parseFloat(inp.value);
        if (isFinite(v) && v > 0) {
          state.fx[k] = v;
          writeLS(STORAGE_FX, state.fx);
          renderFx();
        }
      });
    }

    // 主题开关
    var themeSwitch = $('#themeSwitch');
    if (themeSwitch) {
      themeSwitch.addEventListener('change', function () {
        applyTheme(themeSwitch.checked ? 'dark' : 'light');
      });
    }

    // ESC 关闭抽屉
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDetail();
    });
  }

  // ---------- 路由 ----------
  function routeFromHash() {
    var h = (location.hash || '#home').replace(/^#/, '');
    if (h.indexOf('detail=') === 0) {
      var code = h.slice(7);
      setView('home', false);
      if (code) openDetail(code);
      return;
    }
    setView(VIEWS.indexOf(h) >= 0 ? h : 'home', false);
  }

  // ---------- 对外暴露给扩展脚本（tools.js / tools-extra.js） ----------
  window.JY = {
    api: api,
    $: $,
    $$: $$,
    esc: esc,
    fmt: fmt,
    fmtPct: fmtPct,
    fmtSigned: fmtSigned,
    pctDir: pctDir,
    toast: toast,
    openSheet: openSheet,
    closeSheet: closeDetail,
    storage: { get: readLS, set: writeLS },
    state: state,
    onView: addViewHook,
    onToolsInit: function (cb) {
      if (typeof cb !== 'function') return;
      toolsInitCallbacks.push(cb);
      if (toolsViewActive()) {
        try { cb(); } catch (e) { console.error('[tools init]', e); }
      }
    }
  };

  // ---------- 启动 ----------
  function boot() {
    var savedTheme = readLS(LS_THEME, null);
    if (!savedTheme) {
      savedTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(savedTheme);
    bindEvents();
    bindWatchSearch();
    bindPullToRefresh();
    routeFromHash();
    renderCalc();
    renderFx();
    loadSnapshot(true).catch(function () {});
    setInterval(tickCountdown, 1000);
    setInterval(function () {
      loadSnapshot(false).catch(function () {});
    }, POLL_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
