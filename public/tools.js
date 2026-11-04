/* 韭研 · 工具中心核心（tools.js）
 * - 分类磁贴工具箱：挑选基金 / 制定策略 / 跟踪管理 / 其他工具
 * - 工具详情路由（每个工具一个独立视图）
 * - 供各工具模块复用的共享库 window.JYXT（格式化 / 接口 / SVG 图表 / 基金搜索 / 底部抽屉）
 * 模块文件约定：tools-fund.js、tools-strategy.js、tools-track.js、tools-other.js
 *   各自调用 JYXT.register(key, { title, category, icon, mount(body) })
 */
(function () {
  'use strict';

  var JY = window.JY;
  if (!JY) { console.warn('[tools] window.JY 未就绪，工具中心未加载'); return; }

  var $ = JY.$, $$ = JY.$$, esc = JY.esc, api = JY.api, toast = JY.toast;
  var fmt = JY.fmt, fmtPct = JY.fmtPct, fmtSigned = JY.fmtSigned, pctDir = JY.pctDir;
  var storage = JY.storage;

  // ================= 基础工具 =================
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function pad2(x) { return (x < 10 ? '0' : '') + x; }
  function fmtDate(ts) {
    if (ts == null) return '—';
    if (typeof ts === 'string') return ts;
    var d = new Date(ts);
    if (!isFinite(d.getTime())) return '—';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fmtDateTime(ts) {
    if (ts == null) return '—';
    var d = new Date(ts);
    if (!isFinite(d.getTime())) return '—';
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function fmtWan(v, digits) {
    var n = num(v);
    if (n == null) return '—';
    if (Math.abs(n) >= 100000000) return fmt(n / 100000000, digits == null ? 2 : digits) + ' 亿';
    if (Math.abs(n) >= 10000) return fmt(n / 10000, digits == null ? 2 : digits) + ' 万';
    return fmt(n, 0);
  }
  function dirText(v) { var d = pctDir(v); return d === 'up' ? '上涨' : d === 'down' ? '下跌' : '平盘'; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ================= SVG 图表 =================
  var PALETTE = ['#ff5b3a', '#2f7df6', '#17a673', '#f0a020', '#8e6cf0', '#20b2c9'];

  function lineChart(series, opts) {
    opts = opts || {};
    var W = 320, H = opts.height || 150, PL = opts.padLeft == null ? 44 : opts.padLeft, PR = 8, PT = 12, PB = opts.padBottom || 18;
    var all = [];
    (series || []).forEach(function (s) { (s.points || []).forEach(function (p) { if (p && num(p.t) != null && num(p.v) != null) all.push(p); }); });
    if (all.length < 2) return '<div class="t-empty"><p>暂无走势数据</p></div>';
    var xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    all.forEach(function (p) { if (p.t < xMin) xMin = p.t; if (p.t > xMax) xMax = p.t; if (p.v < yMin) yMin = p.v; if (p.v > yMax) yMax = p.v; });
    if (xMax <= xMin) xMax = xMin + 86400000;
    if (yMax === yMin) { yMax += 1; yMin -= 1; }
    if (opts.includeZero) { yMin = Math.min(yMin, 0); yMax = Math.max(yMax, 0); }
    var padY = (yMax - yMin) * 0.08 || 1;
    yMin -= padY; yMax += padY;
    var iw = W - PL - PR, ih = H - PT - PB;
    function sx(t) { return PL + ((t - xMin) / (xMax - xMin)) * iw; }
    function sy(v) { return PT + (1 - (v - yMin) / (yMax - yMin)) * ih; }
    var out = [];
    var tickCount = opts.ticks || 4;
    for (var i = 0; i <= tickCount; i++) {
      var v = yMin + (yMax - yMin) * (i / tickCount);
      var y = sy(v);
      out.push('<line x1="' + PL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + y.toFixed(1) + '" stroke="currentColor" stroke-opacity="0.10"/>');
      var label = opts.percent === false ? fmt(v, 1) : fmt(v, 1) + '%';
      out.push('<text x="' + (PL - 5) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="9" fill="currentColor" fill-opacity="0.55">' + label + '</text>');
    }
    if (yMin < 0 && yMax > 0) {
      out.push('<line x1="' + PL + '" y1="' + sy(0).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + sy(0).toFixed(1) + '" stroke="currentColor" stroke-opacity="0.35" stroke-dasharray="4 4"/>');
    }
    var xTicks = [xMin, xMin + (xMax - xMin) / 2, xMax];
    xTicks.forEach(function (t, idx) {
      var anchor = idx === 0 ? 'start' : (idx === xTicks.length - 1 ? 'end' : 'middle');
      out.push('<text x="' + sx(t).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '" font-size="9" fill="currentColor" fill-opacity="0.55">' + esc(dateLabel(t, xMax - xMin)) + '</text>');
    });
    (series || []).forEach(function (s, si) {
      var pts = (s.points || []).filter(function (p) { return p && num(p.t) != null && num(p.v) != null; });
      if (pts.length < 2) return;
      var color = s.color || PALETTE[si % PALETTE.length];
      var d = pts.map(function (p, idx) { return (idx ? 'L' : 'M') + sx(p.t).toFixed(1) + ' ' + sy(p.v).toFixed(1); }).join(' ');
      if (s.fill) {
        out.push('<path d="' + d + ' L ' + sx(pts[pts.length - 1].t).toFixed(1) + ' ' + (H - PB) + ' L ' + sx(pts[0].t).toFixed(1) + ' ' + (H - PB) + ' Z" fill="' + color + '" opacity="0.12"></path>');
      }
      out.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + (s.width || 2) + '" stroke-linejoin="round" stroke-linecap="round"></path>');
      var last = pts[pts.length - 1];
      out.push('<circle cx="' + sx(last.t).toFixed(1) + '" cy="' + sy(last.v).toFixed(1) + '" r="2.6" fill="' + color + '"></circle>');
    });
    return '<svg class="t-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img">' + out.join('') + '</svg>';
  }

  function dateLabel(t, span) {
    var d = new Date(t);
    if (span > 3 * 365 * 86400000) return d.getFullYear() + '';
    if (span > 90 * 86400000) return (d.getMonth() + 1) + '/' + d.getFullYear().toString().slice(2);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function sparkline(points, opts) {
    opts = opts || {};
    var W = 320, H = opts.height || 70;
    var pts = (points || []).filter(function (p) { return p && num(p.v) != null; });
    if (pts.length < 2) return '<div class="t-empty"><p>' + esc(opts.emptyText || '数据不足') + '</p></div>';
    var vs = pts.map(function (p) { return p.v; });
    var min = Math.min.apply(null, vs), max = Math.max.apply(null, vs);
    if (max === min) { max += 1; min -= 1; }
    var xs = function (i) { return 4 + (i / (pts.length - 1)) * (W - 8); };
    var ys = function (v) { return 4 + (1 - (v - min) / (max - min)) * (H - 8); };
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(p.v).toFixed(1); }).join(' ');
    var color = opts.color || '#ff5b3a';
    var refs = '';
    (opts.refLines || []).forEach(function (rv) {
      if (rv < min || rv > max) return;
      refs += '<line x1="0" x2="' + W + '" y1="' + ys(rv).toFixed(1) + '" y2="' + ys(rv).toFixed(1) + '" stroke="currentColor" stroke-opacity="0.18" stroke-dasharray="3 3"/>';
    });
    return '<svg class="t-chart t-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img">' + refs +
      '<path d="' + d + ' L ' + xs(pts.length - 1).toFixed(1) + ' ' + (H - 2) + ' L ' + xs(0).toFixed(1) + ' ' + (H - 2) + ' Z" fill="' + color + '" opacity="0.12"></path>' +
      '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linejoin="round"></path></svg>';
  }

  function donut(items, opts) {
    opts = opts || {};
    var total = 0;
    (items || []).forEach(function (it) { total += Math.max(0, num(it.value) || 0); });
    if (!total) return '<div class="t-empty"><p>暂无数据</p></div>';
    var r = 42, c = 2 * Math.PI * r, off = 0;
    var arcs = items.map(function (it, i) {
      var len = c * (Math.max(0, num(it.value) || 0) / total);
      var color = it.color || PALETTE[i % PALETTE.length];
      var seg = '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="13" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + (c - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 60 60)"></circle>';
      off += len;
      return seg;
    }).join('');
    var legend = (opts.legend === false) ? '' : '<div class="t-legend">' + items.map(function (it, i) {
      return '<span class="t-legend-item"><i class="t-dot" style="background:' + (it.color || PALETTE[i % PALETTE.length]) + '"></i>' + esc(it.label) + ' ' + fmt(it.value, 1) + (opts.suffix || '%') + '</span>';
    }).join('') + '</div>';
    return '<div class="t-donut"><svg viewBox="0 0 120 120" role="img">' + arcs +
      '<text x="60" y="62" text-anchor="middle" class="t-donut-label">' + esc(opts.center || '') + '</text></svg></div>' + legend;
  }

  function gauge(value, opts) {
    opts = opts || {};
    var v = Math.max(0, Math.min(100, num(value) || 0));
    var color = opts.color || gaugeColor(v);
    var ang = -120 + (v / 100) * 240;
    return '' +
      '<div class="t-gauge" style="--ang:' + ang.toFixed(1) + ';--gauge-color:' + color + '">' +
        '<div class="t-gauge-dial"></div><div class="t-gauge-needle"></div>' +
        '<div class="t-gauge-value">' + Math.round(v) + '</div>' +
        '<div class="t-gauge-level" style="color:' + color + '">' + esc(opts.level || '') + '</div>' +
      '</div>';
  }
  function gaugeColor(v) {
    if (v < 20) return '#2f9e6f';
    if (v < 40) return '#4aa3a3';
    if (v < 60) return '#d8a533';
    if (v < 80) return '#e56b34';
    return '#e5433b';
  }

  // ================= UI 组件 =================
  function card(title, sub, bodyHTML, extraClass) {
    return '<div class="t-card ' + (extraClass || '') + '">' +
      (title ? '<div class="t-card-head"><span class="t-title">' + esc(title) + '</span>' + (sub ? '<span class="t-sub">' + sub + '</span>' : '') + '</div>' : '') +
      '<div class="t-body">' + bodyHTML + '</div></div>';
  }
  function kpis(items) {
    return '<div class="t-kpis">' + items.map(function (it) {
      var cls = it.dir ? (it.dir === 'up' ? 'up' : it.dir === 'down' ? 'down' : '') : (it.raw ? '' : '');
      return '<div class="t-kpi"><span class="t-kpi-label">' + esc(it.label) + '</span><b class="t-kpi-value ' + cls + '">' + (it.raw ? it.value : esc(it.value)) + '</b></div>';
    }).join('') + '</div>';
  }
  function rowHTML(opts) {
    return '<div class="t-row" ' + (opts.attrs || '') + '>' +
      '<div class="t-row-main">' +
        '<div class="t-name">' + opts.name + (opts.code ? '<small class="t-code">' + esc(opts.code) + '</small>' : '') + '</div>' +
        (opts.meta ? '<div class="t-meta">' + opts.meta + '</div>' : '') +
      '</div>' +
      (opts.side ? '<div class="t-row-side">' + opts.side + '</div>' : '') +
      (opts.action ? '<div class="t-row-action">' + opts.action + '</div>' : '') +
      '</div>';
  }
  function chips(container, items, activeKey, onPick) {
    if (!container) return;
    container.innerHTML = items.map(function (it) {
      return '<button class="t-chip' + (it.key === activeKey ? ' active' : '') + '" data-chip="' + esc(it.key) + '">' + esc(it.label) + '</button>';
    }).join('');
    container.onclick = function (e) {
      var b = e.target.closest('[data-chip]');
      if (!b) return;
      if (onPick) onPick(b.getAttribute('data-chip'));
    };
  }
  function loading(el, text) {
    if (el) el.innerHTML = '<div class="t-skeleton"><span></span><span></span><span></span><p class="t-sub">' + esc(text || '加载中…') + '</p></div>';
  }
  function empty(el, opts) {
    opts = opts || {};
    if (!el) return;
    var html = '<div class="t-empty"><div class="t-empty-ico">' + (opts.icon || '📭') + '</div><p>' + esc(opts.title || '暂无数据') + '</p>' +
      (opts.desc ? '<p class="t-sub">' + esc(opts.desc) + '</p>' : '') +
      (opts.actionText ? '<button class="t-btn-primary" data-empty-action>' + esc(opts.actionText) + '</button>' : '') + '</div>';
    el.innerHTML = html;
    if (opts.onAction) {
      var b = el.querySelector('[data-empty-action]');
      if (b) b.onclick = opts.onAction;
    }
  }
  function errorBox(el, msg, retry) {
    if (!el) return;
    el.innerHTML = '<div class="t-empty"><div class="t-empty-ico">⚠️</div><p>加载失败</p><p class="t-sub">' + esc(msg || '请稍后重试') + '</p>' +
      (retry ? '<button class="t-btn-primary" data-retry>重试</button>' : '') + '</div>';
    var b = retry && el.querySelector('[data-retry]');
    if (b) b.onclick = retry;
  }

  // ================= 基金搜索 / 详情抽屉 =================
  var activeSearches = [];
  document.addEventListener('click', function (e) {
    activeSearches.forEach(function (s) {
      if (!s.input.contains(e.target) && !s.box.contains(e.target)) s.box.classList.add('hidden');
    });
  });

  function fundSearch(inputEl, suggestEl, onPick) {
    if (!inputEl || !suggestEl) return;
    var existed = false;
    activeSearches.forEach(function (s) { if (s.input === inputEl) { s.box = suggestEl; existed = true; } });
    if (!existed) activeSearches.push({ input: inputEl, box: suggestEl });
    var timer = null;
    function hide() { suggestEl.classList.add('hidden'); }
    function show(items, err) {
      if (err) { suggestEl.innerHTML = '<div class="t-suggest-empty">' + esc(err) + '</div>'; }
      else if (!items || !items.length) { suggestEl.innerHTML = '<div class="t-suggest-empty">没有匹配的基金</div>'; }
      else {
        suggestEl.innerHTML = items.slice(0, 8).map(function (f) {
          return '<button class="t-suggest-item" data-code="' + esc(f.code) + '" data-name="' + esc(f.name) + '">' +
            '<span>' + esc(f.name) + '</span><small>' + esc(f.code) + ' · ' + esc(f.type || '') + '</small></button>';
        }).join('');
      }
      suggestEl.classList.remove('hidden');
    }
    inputEl.addEventListener('input', function () {
      var q = inputEl.value.trim();
      clearTimeout(timer);
      if (!q) { hide(); return; }
      timer = setTimeout(function () {
        api('/api/fund/search?key=' + encodeURIComponent(q) + '&limit=8').then(function (d) {
          show((d && d.items) || []);
        }).catch(function (e) { show([], '搜索失败：' + e.message); });
      }, 250);
    });
    suggestEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-code]');
      if (!b) return;
      var f = { code: b.getAttribute('data-code'), name: b.getAttribute('data-name') };
      inputEl.value = f.name + ' (' + f.code + ')';
      hide();
      if (onPick) onPick(f);
    });
  }

  function openFundSheet(code, opts) {
    opts = opts || {};
    JY.openSheet('<div class="t-empty"><p>加载基金详情…</p></div>');
    Promise.all([
      api('/api/fund/detail?code=' + encodeURIComponent(code)),
      api('/api/fund/quotes?codes=' + encodeURIComponent(code)).catch(function () { return null; })
    ]).then(function (res) {
      var data = res[0];
      var f = data && data.fund;
      if (!f) { JY.openSheet('<div class="t-empty"><p>未获取到该基金数据</p></div>'); return; }
      var series = (f.navSeries || []).map(function (p) { return { t: p.t, v: p.nav }; });
      var mgr = f.manager || {};
      var inWatch = (JY.storage.get('jy_fund_watch_v1', []) || []).indexOf(f.code) >= 0;
      var dir = pctDir(f.dayPct);
      JY.openSheet('' +
        '<div class="fund-head">' +
          '<h3>' + esc(f.name) + ' <small class="muted">' + esc(f.code) + '</small></h3>' +
          '<div class="fund-tags"><span class="tag-pill">' + esc(f.type || '基金') + '</span>' +
            (mgr.name ? '<span class="tag-pill">经理 ' + esc(mgr.name) + (mgr.star ? ' ' + '★'.repeat(Math.max(0, Math.min(5, Number(mgr.star) || 0))) : '') + '</span>' : '') +
          '</div>' +
          '<div class="fund-navline"><b class="' + dir + '">' + fmt(f.nav, 4) + '</b>' +
            '<span class="' + dir + '">' + (num(f.dayPct) == null ? '' : fmtPct(f.dayPct)) + '</span>' +
            '<span class="muted sm">净值 ' + esc(f.navDate || '—') + '</span></div>' +
        '</div>' +
        '<div class="fund-stage-grid">' +
          ['近1月|m1', '近3月|m3', '近6月|m6', '近1年|y1', '近3年|y3', '成立来|since'].map(function (pair) {
            var arr = pair.split('|'); var v = f.stage && f.stage[arr[1]];
            return '<div class="stage-item"><span class="muted sm">' + arr[0] + '</span><b class="' + pctDir(v) + '">' + (num(v) == null ? '—' : fmtPct(v)) + '</b></div>';
          }).join('') +
        '</div>' +
        lineChart([{ points: series, color: num(f.stage && f.stage.y1) >= 0 ? '#e5433b' : '#17a673', fill: true }], { height: 140 }) +
        '<div class="fund-metrics-grid">' +
          '<div class="kv-item"><span>最大回撤</span><b class="down">' + (f.risk && num(f.risk.maxDrawdown) != null ? fmt(f.risk.maxDrawdown, 1) + '%' : '—') + '</b></div>' +
          '<div class="kv-item"><span>年化波动</span><b>' + (f.risk && num(f.risk.volatility) != null ? fmt(f.risk.volatility, 1) + '%' : '—') + '</b></div>' +
          '<div class="kv-item"><span>夏普比率</span><b>' + (f.risk && num(f.risk.sharpe) != null ? fmt(f.risk.sharpe, 2) : '—') + '</b></div>' +
          '<div class="kv-item"><span>成立年化</span><b>' + (f.risk && num(f.risk.annualized) != null ? fmt(f.risk.annualized, 1) + '%' : '—') + '</b></div>' +
        '</div>' +
        '<div class="fund-actions">' +
          '<button class="primary-btn" data-fwatch="' + esc(f.code) + '">' + (inWatch ? '★ 已在基金自选' : '☆ 加入基金自选') + '</button>' +
          '<button class="ghost-btn" data-fplan="' + esc(f.code) + '">用它定投</button>' +
        '</div>' +
        '<p class="muted sm fund-src">数据来源：天天基金公开净值，仅供参考，不构成投资建议。</p>');
      var wb = document.querySelector('[data-fwatch="' + f.code + '"]');
      if (wb) wb.onclick = function () {
        var arr = JY.storage.get('jy_fund_watch_v1', []) || [];
        var i = arr.indexOf(f.code);
        if (i >= 0) { arr.splice(i, 1); toast('已移出基金自选'); } else { arr.push(f.code); toast('已加入基金自选 ★'); }
        JY.storage.set('jy_fund_watch_v1', arr);
        wb.textContent = i >= 0 ? '☆ 加入基金自选' : '★ 已在基金自选';
      };
      var pb = document.querySelector('[data-fplan="' + f.code + '"]');
      if (pb) pb.onclick = function () {
        JY.closeSheet();
        if (window.JYXT && JYXT.open) JYXT.open('dca-plan');
      };
    }).catch(function (e) {
      JY.openSheet('<div class="t-empty"><p>基金详情加载失败</p><p class="t-sub">' + esc(e.message) + '</p></div>');
    });
  }

  // ================= 工具注册与路由 =================
  var TOOLS = [];
  var toolMap = {};
  var currentKey = null;
  var mounted = {};

  function register(key, def) {
    if (!key || !def || typeof def.mount !== 'function') return;
    if (toolMap[key]) return;
    var tool = { key: key, title: def.title || key, category: def.category || 'other', icon: def.icon || '🧩', badge: def.badge || '', order: def.order || 0, mount: def.mount };
    toolMap[key] = tool;
    TOOLS.push(tool);
    if (toolMap.__hubReady) renderHub();
  }

  var CATEGORIES = [
    { key: 'fund', title: '挑选基金' },
    { key: 'strategy', title: '制定策略' },
    { key: 'track', title: '跟踪管理' },
    { key: 'other', title: '其他工具' }
  ];

  function renderHub() {
    var hub = document.getElementById('toolsHub');
    if (!hub) return;
    var html = CATEGORIES.map(function (cat) {
      var list = TOOLS.filter(function (t) { return t.category === cat.key; }).sort(function (a, b) { return a.order - b.order; });
      if (!list.length) return '';
      return '<section class="tool-cat"><h3 class="tool-cat-title">' + esc(cat.title) + '</h3><div class="tool-grid">' +
        list.map(function (t) {
          return '<button class="tool-tile" data-tool-key="' + esc(t.key) + '">' +
            '<span class="tool-tile-ico">' + t.icon + '</span>' +
            '<span class="tool-tile-label">' + esc(t.title) + '</span>' +
            (t.badge ? '<span class="tool-tile-badge">' + esc(t.badge) + '</span>' : '') +
            '</button>';
        }).join('') + '</div></section>';
    }).join('');
    hub.innerHTML = html || '<div class="t-empty"><p>工具加载中…</p></div>';
    toolMap.__hubReady = true;
    if (!hub.__bound) {
      hub.__bound = true;
      hub.addEventListener('click', function (e) {
        var b = e.target.closest('[data-tool-key]');
        if (b) open(b.getAttribute('data-tool-key'));
      });
    }
  }

  function open(key) {
    var def = toolMap[key];
    if (!def) { toast('该工具尚未就绪'); return; }
    var hub = document.getElementById('toolsHub');
    var view = document.getElementById('toolView');
    if (!hub || !view) return;
    currentKey = key;
    hub.classList.add('hidden');
    view.classList.remove('hidden');
    view.innerHTML = '<div class="tool-view-head"><button class="tool-back" data-tool-back aria-label="返回">←</button>' +
      '<h2 class="tool-view-title">' + esc(def.title) + '</h2></div><div class="tool-view-body" id="toolViewBody"></div>';
    var body = document.getElementById('toolViewBody');
    view.querySelector('[data-tool-back]').onclick = back;
    try {
      def.mount(body, { key: key, title: def.title });
    } catch (err) {
      console.error('[tools] mount error', err);
      body.innerHTML = '<div class="t-empty"><p>工具加载异常</p><p class="t-sub">' + esc(err.message) + '</p></div>';
    }
    var scroller = view.closest('.view');
    if (scroller) scroller.scrollTop = 0;
  }

  function back() {
    var hub = document.getElementById('toolsHub');
    var view = document.getElementById('toolView');
    if (!hub || !view) return;
    view.classList.add('hidden');
    view.innerHTML = '';
    hub.classList.remove('hidden');
    currentKey = null;
    var v = hub.closest('.view');
    if (v) v.scrollTop = 0;
  }

  // ================= 对外共享库 =================
  window.JYXT = {
    register: register,
    open: open,
    back: back,
    // data
    api: api,
    // format
    esc: esc, fmt: fmt, fmtPct: fmtPct, fmtSigned: fmtSigned, pctDir: pctDir, num: num,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, fmtWan: fmtWan, dirText: dirText, uid: uid,
    // ui
    toast: toast, openSheet: JY.openSheet, closeSheet: JY.closeSheet,
    storage: storage,
    card: card, kpis: kpis, rowHTML: rowHTML, chips: chips,
    loading: loading, empty: empty, errorBox: errorBox,
    // charts
    lineChart: lineChart, sparkline: sparkline, donut: donut, gauge: gauge, gaugeColor: gaugeColor,
    palette: PALETTE,
    // fund widgets
    fundSearch: fundSearch, openFundSheet: openFundSheet,
    // 视图切换钩子（与 app.js 的 JY.onView 相同）
    onView: JY.onView,
    // raw helpers
    $: $, $$: $$,
    categories: CATEGORIES
  };
  // 兼容：部分模块可能用 window.JY.registerTool 注册
  JY.registerTool = register;

  function boot() {
    renderHub();
    JY.onToolsInit(function () {
      renderHub();
      // 每次进入工具 tab 回到工具箱首页
      var view = document.getElementById('toolView');
      if (view && !view.classList.contains('hidden')) back();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
