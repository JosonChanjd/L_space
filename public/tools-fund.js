/* 韭研 · 投研工作台 —— 「挑选基金」8 个工具
 * key: etf / insight-pool / fund-screen / fund-rank / manager-pick / fund-diagnose / fund-pk / fund-similar
 * 特点：单文件、原生 JS（var/function 风格）、零依赖、无外链，全部使用通用设计系统 t-* 组件。
 * 依赖：window.JYXT（public/tools.js 提供）；JYXT 不存在时顶层直接 return，不影响其它脚本。
 * 数据接口：/api/fund/etf、/api/fund/screen、/api/fund/rank、/api/fund/search、/api/fund/detail、
 *          /api/fund/compare、/api/fund/diagnose、/api/fund/similar、/api/fund/manager-pick。
 */
(function () {
  'use strict';

  var J = window.JYXT;
  if (!J || typeof J.register !== 'function') return;

  var api = J.api;
  var esc = J.esc;
  var fmt = J.fmt;
  var fmtPct = J.fmtPct;
  var fmtDate = J.fmtDate;
  var fmtWan = J.fmtWan;
  var PALETTE = (J.palette && J.palette.length) ? J.palette : ['#ff5b3a', '#2f7df6', '#17a673', '#f0a020', '#8e6cf0', '#20b2c9'];

  var WATCH_KEY = 'jy_fund_watch_v1';

  var SORT_OPTS = [
    ['1nzf', '近1年收益'],
    ['3yzf', '近3年收益'],
    ['6yzf', '近6月收益'],
    ['1yzf', '近1月收益'],
    ['jnzf', '今年来收益'],
    ['rzdf', '日涨幅']
  ];
  var SORT_LABEL = {};
  SORT_OPTS.forEach(function (p) { SORT_LABEL[p[0]] = p[1]; });

  var TYPE_ITEMS = [
    { key: 'all', label: '全部' },
    { key: 'gp', label: '股票型' },
    { key: 'hh', label: '混合型' },
    { key: 'zq', label: '债券型' },
    { key: 'zs', label: '指数型' },
    { key: 'qdii', label: 'QDII' }
  ];
  var TYPE_LABEL = { all: '全部', gp: '股票型', hh: '混合型', zq: '债券型', zs: '指数型', qdii: 'QDII' };

  var DIAG_EXAMPLES = [
    { key: '110022', label: '110022 易方达消费行业' },
    { key: '161725', label: '161725 招商中证白酒' },
    { key: '003096', label: '003096 中欧医疗健康' }
  ];

  // ==================== 基础工具 ====================
  // JY 的 num/fmt 会把 null 当成 0，这里统一封装为「缺失显示 —」
  function n(v) {
    if (v === null || v === undefined || v === '') return null;
    var x = Number(v);
    return isFinite(x) ? x : null;
  }
  function f(v, digits) {
    var x = n(v);
    if (x === null) return '—';
    return fmt(x, digits == null ? 2 : digits);
  }
  function pct(v) {
    var x = n(v);
    if (x === null) return '—';
    return fmtPct(x);
  }
  function wan(v) {
    var x = n(v);
    if (x === null) return '—';
    return fmtWan(x);
  }
  function dirCls(v) {
    var x = n(v);
    if (x === null || x === 0) return '';
    return x > 0 ? 'up' : 'down';
  }
  function pctSpan(v) {
    var cls = dirCls(v);
    return '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + pct(v) + '</span>';
  }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function clampPct(v) {
    var x = n(v);
    if (x === null) return 0;
    return Math.max(0, Math.min(100, x));
  }
  function ratioPct(v) {
    var x = n(v);
    if (x === null) return null;
    if (Math.abs(x) <= 1) x = x * 100;
    return Math.max(0, Math.min(100, x));
  }
  function toTs(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' && isFinite(v)) return v < 1e12 ? v * 1000 : v;
    var s = String(v).trim();
    if (!s) return null;
    if (/^\d{10,13}$/.test(s)) {
      var x = Number(s);
      return isFinite(x) ? (x < 1e12 ? x * 1000 : x) : null;
    }
    var d = Date.parse(s.length <= 10 ? s + 'T00:00:00' : s);
    return isNaN(d) ? null : d;
  }
  function dateText(v) {
    if (v === null || v === undefined || v === '') return '—';
    var out = fmtDate(v);
    return out == null ? '—' : out;
  }
  function starText(v) {
    var k = Math.round(n(v) == null ? 0 : n(v));
    k = Math.max(0, Math.min(5, k));
    var s = '';
    for (var i = 0; i < k; i++) s += '★';
    return s;
  }
  function sizeText(v) {
    if (v === null || v === undefined || v === '') return '—';
    var x = n(v);
    if (x !== null) return f(x, 2) + ' 亿';
    return esc(String(v));
  }
  function tagText(t) {
    if (t === null || t === undefined) return '';
    if (typeof t === 'string') return t;
    if (typeof t === 'number') return String(t);
    return t.label || t.text || t.name || t.key || '';
  }
  function gradeOf(score) {
    var x = n(score);
    if (x === null) return '—';
    return x >= 80 ? 'A' : x >= 70 ? 'B' : x >= 60 ? 'C' : 'D';
  }
  function gradeCls(grade) {
    var g = String(grade || '').toUpperCase();
    if (g === 'A') return 'low';
    if (g === 'D') return 'high';
    return 'mid';
  }
  function note(html) { return '<p class="t-note">' + html + '</p>'; }
  function numberField(label, attr, ph) {
    return '<label class="t-field"><span class="t-sub">' + esc(label) + '</span>' +
      '<input class="t-input" type="number" step="0.1" inputmode="decimal" ' + attr +
      ' placeholder="' + esc(ph || '') + '" autocomplete="off"></label>';
  }
  function sortSelectHTML(attr, active) {
    return '<select class="t-select" ' + attr + '>' + SORT_OPTS.map(function (p) {
      return '<option value="' + p[0] + '"' + (p[0] === active ? ' selected' : '') + '>' + esc(p[1]) + '</option>';
    }).join('') + '</select>';
  }

  function getJSON(path) {
    var p;
    try { p = api(path); } catch (e) { return Promise.reject(e); }
    return p.then(function (d) {
      if (d && d.ok === false) throw new Error(d.error || d.note || '数据获取失败');
      return d || {};
    });
  }

  // ==================== 基金自选（localStorage） ====================
  function watchList() {
    var a = null;
    try { a = J.storage.get(WATCH_KEY, []); } catch (e) { a = null; }
    return Array.isArray(a) ? a.slice() : [];
  }
  function isWatched(code) { return watchList().indexOf(String(code)) >= 0; }
  function toggleWatch(code) {
    var key = String(code);
    var list = watchList();
    var idx = list.indexOf(key);
    var added = idx < 0;
    if (added) list.push(key); else list.splice(idx, 1);
    try { J.storage.set(WATCH_KEY, list); } catch (e) { /* 忽略存储失败 */ }
    J.toast(added ? '已加入基金自选 ★' : '已移出基金自选');
    return added;
  }
  function watchButton(code) {
    return '<button class="t-btn-mini" data-watch-code="' + esc(code) + '" title="加入 / 移出基金自选">' +
      (isWatched(code) ? '★' : '☆') + '</button>';
  }
  function syncWatch(scope, code) {
    if (!scope || !scope.querySelectorAll) return;
    var on = isWatched(code);
    var nodes = scope.querySelectorAll('[data-watch-code="' + String(code) + '"]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = on ? '★' : '☆';
  }

  // 列表行点击 / 自选点击（事件委托）
  function bindListClicks(listEl, onRow) {
    if (!listEl) return;
    listEl.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      var w = target.closest('[data-watch-code]');
      if (w) {
        e.preventDefault();
        var code = w.getAttribute('data-watch-code');
        toggleWatch(code);
        syncWatch(w.closest('.t-card') || listEl, code);
        return;
      }
      var row = target.closest('[data-code]');
      if (row) {
        var c = row.getAttribute('data-code');
        if (onRow) onRow(c);
        else J.openFundSheet(c);
      }
    });
  }

  // 通用「空 / 错误 / 加载更多」辅助
  function hideMore(btn) { if (btn) btn.style.display = 'none'; }
  function showMore(btn) { if (btn) btn.style.display = ''; }
  function setMoreLoading(btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    btn.textContent = on ? '加载中…' : '加载更多';
  }

  // ==================== 1) ETF ====================
  J.register('etf', {
    title: 'ETF',
    category: 'fund',
    icon: '🧾',
    order: 10,
    mount: function (body) {
      body.innerHTML =
        '<div class="t-card">' +
          '<div class="t-card-head"><span class="t-title">ETF 行情榜</span><span class="t-sub" data-etf-meta>加载中…</span></div>' +
          '<div class="t-body">' +
            '<div class="t-chips" data-etf-chips></div>' +
            '<div class="t-list" data-etf-list></div>' +
            '<div class="t-actions"><button class="t-btn-ghost" data-etf-more style="display:none">加载更多</button></div>' +
            note('数据来源：东方财富 ETF 行情（场内基金），按所选维度排序；点击行查看基金详情。') +
          '</div>' +
        '</div>';

      var chipsEl = body.querySelector('[data-etf-chips]');
      var listEl = body.querySelector('[data-etf-list]');
      var moreEl = body.querySelector('[data-etf-more]');
      var metaEl = body.querySelector('[data-etf-meta]');

      var SORTS = [
        { key: 'f3', label: '涨幅榜' },
        { key: 'f6', label: '成交额榜' },
        { key: 'f8', label: '换手榜' }
      ];
      var st = { sort: 'f3', size: 20, page: 1, total: null, items: [], lastLen: 0, rid: 0, busy: false };

      function sortLabel() {
        for (var i = 0; i < SORTS.length; i++) { if (SORTS[i].key === st.sort) return SORTS[i].label; }
        return '涨幅榜';
      }

      function rowHTML(it) {
        var side = '<b class="' + dirCls(it.changePct) + '">' + pct(it.changePct) + '</b>' +
          '<small>现价 ' + f(it.price, 3) + '</small>';
        var meta = '成交额 ' + wan(it.amount) + ' · 换手 ' + (n(it.turnover) == null ? '—' : f(it.turnover, 2) + '%');
        return J.rowHTML({
          name: esc(it.name || '—'),
          code: it.code,
          meta: meta,
          side: side,
          attrs: 'data-code="' + esc(it.code) + '"'
        });
      }

      function render() {
        if (!st.items.length) {
          hideMore(moreEl);
          J.empty(listEl, { icon: '🧾', title: '暂无 ETF 数据', desc: '稍后重试或切换榜单', actionText: '重新加载', onAction: function () { load(true); } });
          metaEl.textContent = '暂无数据';
          return;
        }
        listEl.innerHTML = st.items.map(rowHTML).join('');
        var loadedText = st.total != null ? ('共 ' + f(st.total, 0) + ' 只 · 已加载 ' + st.items.length) : ('已加载 ' + st.items.length + ' 只');
        metaEl.textContent = sortLabel() + ' · ' + loadedText;
        if (st.lastLen >= st.size && (st.total == null || st.items.length < st.total)) showMore(moreEl);
        else hideMore(moreEl);
      }

      function load(reset) {
        if (st.busy && !reset) return;
        if (reset) { st.page = 1; st.items = []; st.total = null; st.lastLen = 0; }
        var requestPage = st.page;
        var myRid = ++st.rid;
        st.busy = true;
        if (reset) J.loading(listEl, '加载 ETF 行情…');
        else setMoreLoading(moreEl, true);

        getJSON('/api/fund/etf?sort=' + encodeURIComponent(st.sort) + '&page=' + requestPage + '&size=' + st.size)
          .then(function (d) {
            if (myRid !== st.rid) return;
            st.busy = false;
            setMoreLoading(moreEl, false);
            var items = arr(d.items);
            st.lastLen = items.length;
            st.total = n(d.total);
            st.items = reset ? items.slice() : st.items.concat(items);
            st.page = requestPage + 1;
            render();
          })
          .catch(function (err) {
            if (myRid !== st.rid) return;
            st.busy = false;
            setMoreLoading(moreEl, false);
            if (reset) J.errorBox(listEl, err.message, function () { load(true); });
            else J.toast('加载更多失败：' + err.message);
          });
      }

      function renderChips() {
        J.chips(chipsEl, SORTS, st.sort, function (key) {
          if (key === st.sort) return;
          st.sort = key;
          renderChips();
          load(true);
        });
      }

      renderChips();
      bindListClicks(listEl);
      if (moreEl) moreEl.onclick = function () { load(false); };

      load(true);
    }
  });

  // ==================== 2) 灵感基金池 ====================
  J.register('insight-pool', {
    title: '灵感基金池',
    category: 'fund',
    icon: '💡',
    order: 20,
    mount: function (body) {
      var POOLS = [
        {
          key: 'steady', name: '稳健压舱石', type: 'hh',
          desc: '混合型 · 近 3 年收益 > 20%，追求稳稳的长期复利',
          screen: 'type=hh&minY3=20&sort=3yzf', primaryMin: 20
        },
        {
          key: 'dividend', name: '红利价值', type: 'zs',
          desc: '指数型中筛选名称含“红利 / 股息”的品种，低估值高分红',
          screen: 'type=zs&sort=1nzf', nameIncludes: ['红利', '股息', '价值']
        },
        {
          key: 'balanced', name: '均衡全能', type: 'hh',
          desc: '混合型 · 近 1 年收益 > 10%，攻守兼备',
          screen: 'type=hh&minY1=10&sort=1nzf', primaryMin: 10
        },
        {
          key: 'growth', name: '科技成长', type: 'gp',
          desc: '股票型 · 近 1 年收益 > 30%，高弹性进攻',
          screen: 'type=gp&minY1=30&sort=1nzf', primaryMin: 30
        },
        {
          key: 'bond', name: '低波债券', type: 'zq',
          desc: '债券型 · 近 1 年收益 > 2%，组合的减震器',
          screen: 'type=zq&minY1=2&sort=1nzf', primaryMin: 2
        }
      ];

      body.innerHTML =
        '<div class="t-card">' +
          '<div class="t-card-head"><span class="t-title">灵感基金池</span><span class="t-sub">精选 5 组 · 懒人抄作业</span></div>' +
          '<div class="t-body">' +
            '<div class="t-chips" data-pool-chips></div>' +
            '<div class="t-section">' +
              '<div class="t-section-title" data-pool-title>—</div>' +
              '<p class="t-sub" data-pool-desc></p>' +
              '<div class="t-list" data-pool-list></div>' +
            '</div>' +
            note('点击行查看基金详情，☆ 加入基金自选（保存在本机浏览器）。池内为条件筛选结果，非投资建议。') +
          '</div>' +
        '</div>';

      var chipsEl = body.querySelector('[data-pool-chips]');
      var listEl = body.querySelector('[data-pool-list]');
      var titleEl = body.querySelector('[data-pool-title]');
      var descEl = body.querySelector('[data-pool-desc]');

      var active = POOLS[0];
      var cache = {};
      var rid = 0;

      function applyPoolFilter(items, pool) {
        if (!pool.nameIncludes) return items;
        var hits = items.filter(function (it) {
          var name = String(it && it.name ? it.name : '');
          for (var i = 0; i < pool.nameIncludes.length; i++) {
            if (name.indexOf(pool.nameIncludes[i]) >= 0) return true;
          }
          return false;
        });
        return hits.length ? hits : items;
      }

      function fallbackRank(pool) {
        return getJSON('/api/fund/rank?type=' + encodeURIComponent(pool.type) + '&sort=1nzf&page=1&size=30')
          .then(function (d) {
            var items = arr(d.items);
            var filtered = applyPoolFilter(items, pool);
            return filtered.slice(0, 5);
          });
      }

      function fetchPool(pool) {
        return getJSON('/api/fund/screen?' + pool.screen + '&page=1&size=30')
          .then(function (d) {
            var items = applyPoolFilter(arr(d.items), pool);
            if (items.length) return items.slice(0, 5);
            return fallbackRank(pool);
          })
          .catch(function () {
            return fallbackRank(pool);
          });
      }

      function poolRow(it) {
        return J.rowHTML({
          name: esc(it.name || '—'),
          code: it.code,
          meta: '近3年 ' + pctSpan(it.y3) + ' · 今年来 ' + pctSpan(it.ytd),
          side: '<b class="' + dirCls(it.y1) + '">' + pct(it.y1) + '</b><small>近1年</small>',
          action: watchButton(it.code),
          attrs: 'data-code="' + esc(it.code) + '"'
        });
      }

      function renderItems(items) {
        if (items && items.length) listEl.innerHTML = items.map(poolRow).join('');
        else J.empty(listEl, { icon: '💡', title: '该池暂无符合条件的基金', desc: '切换其它池，或稍后重试' });
      }

      function renderPool() {
        var pool = active;
        titleEl.textContent = pool.name;
        descEl.textContent = pool.desc;
        if (cache[pool.key]) { renderItems(cache[pool.key]); return; }
        J.loading(listEl, '加载「' + pool.name + '」…');
        var myRid = ++rid;
        fetchPool(pool)
          .then(function (items) {
            if (myRid !== rid) return;
            cache[pool.key] = items;
            renderItems(items);
          })
          .catch(function (err) {
            if (myRid !== rid) return;
            J.errorBox(listEl, err.message, function () { delete cache[pool.key]; renderPool(); });
          });
      }

      function refreshChips() {
        J.chips(chipsEl, POOLS.map(function (p) { return { key: p.key, label: p.name }; }), active.key, function (key) {
          var next = null;
          for (var i = 0; i < POOLS.length; i++) { if (POOLS[i].key === key) next = POOLS[i]; }
          if (!next || next.key === active.key) return;
          active = next;
          refreshChips();
          renderPool();
        });
      }

      refreshChips();
      bindListClicks(listEl);
      renderPool();
    }
  });

  // ==================== 3) 基金筛选 ====================
  J.register('fund-screen', {
    title: '基金筛选',
    category: 'fund',
    icon: '🔍',
    order: 30,
    mount: function (body) {
      body.innerHTML =
        '<div class="t-card">' +
          '<div class="t-card-head"><span class="t-title">筛选条件</span><span class="t-sub">阶段收益下限 · 多条件组合</span></div>' +
          '<div class="t-body">' +
            '<div class="t-form">' +
              '<div class="t-section-title">基金类型</div>' +
              '<div class="t-chips" data-scr-types></div>' +
              '<div class="t-fields">' +
                numberField('近1年收益下限(%)', 'data-scr-miny1', '如 20') +
                numberField('近3年收益下限(%)', 'data-scr-miny3', '如 50') +
                numberField('今年来收益下限(%)', 'data-scr-minytd', '如 10') +
                '<label class="t-field"><span class="t-sub">排序</span>' + sortSelectHTML('data-scr-sort', '1nzf') + '</label>' +
              '</div>' +
              '<div class="t-actions">' +
                '<button class="t-btn-primary" data-scr-run>开始筛选</button>' +
                '<button class="t-btn-ghost" data-scr-reset>重置</button>' +
              '</div>' +
            '</div>' +
            note('收益下限单位为百分比，留空表示不限。数据来自天天基金开放排行，首次加载可能较慢。') +
          '</div>' +
        '</div>' +
        '<div class="t-card">' +
          '<div class="t-card-head"><span class="t-title">筛选结果</span><span class="t-sub" data-scr-meta>—</span></div>' +
          '<div class="t-body">' +
            '<div class="t-list" data-scr-list></div>' +
            '<div class="t-actions"><button class="t-btn-ghost" data-scr-more style="display:none">加载更多</button></div>' +
          '</div>' +
        '</div>';

      var typesEl = body.querySelector('[data-scr-types]');
      var listEl = body.querySelector('[data-scr-list]');
      var moreEl = body.querySelector('[data-scr-more]');
      var metaEl = body.querySelector('[data-scr-meta]');
      var inputY1 = body.querySelector('[data-scr-miny1]');
      var inputY3 = body.querySelector('[data-scr-miny3]');
      var inputYtd = body.querySelector('[data-scr-minytd]');
      var sortEl = body.querySelector('[data-scr-sort]');

      var st = { type: 'all', sort: '1nzf', page: 1, minY1: null, minY3: null, minYtd: null, lastLen: 0, loaded: 0, rid: 0, busy: false };

      function parseInput(el) {
        if (!el) return null;
        var s = String(el.value == null ? '' : el.value).trim();
        if (!s) return null;
        var x = Number(s);
        return isFinite(x) ? x : null;
      }
      function readInputs() {
        st.minY1 = parseInput(inputY1);
        st.minY3 = parseInput(inputY3);
        st.minYtd = parseInput(inputYtd);
        if (sortEl && sortEl.value) st.sort = sortEl.value;
      }

      function rowHTML(it) {
        var side = '<b class="' + dirCls(it.y1) + '">' + pct(it.y1) + '</b><small>近1年</small>';
        var meta = '近3年 ' + pctSpan(it.y3) + ' · 今年来 ' + pctSpan(it.ytd) + ' · 净值 ' + f(it.nav, 4);
        return J.rowHTML({
          name: esc(it.name || '—'),
          code: it.code,
          meta: meta,
          side: side,
          action: watchButton(it.code),
          attrs: 'data-code="' + esc(it.code) + '"'
        });
      }

      function renderTypes() {
        J.chips(typesEl, TYPE_ITEMS, st.type, function (key) {
          if (key === st.type) return;
          st.type = key;
          renderTypes();
          load(true);
        });
      }

      function load(reset) {
        if (st.busy && !reset) return;
        readInputs();
        if (reset) { st.page = 1; st.loaded = 0; }
        var requestPage = st.page;
        var myRid = ++st.rid;
        st.busy = true;
        if (reset) J.loading(listEl, '正在筛选…（首次加载可能较慢）');
        else setMoreLoading(moreEl, true);

        var url = '/api/fund/screen?type=' + encodeURIComponent(st.type) +
          '&sort=' + encodeURIComponent(st.sort) +
          '&page=' + requestPage + '&size=20';
        if (st.minY1 != null) url += '&minY1=' + encodeURIComponent(st.minY1);
        if (st.minY3 != null) url += '&minY3=' + encodeURIComponent(st.minY3);
        if (st.minYtd != null) url += '&minYtd=' + encodeURIComponent(st.minYtd);

        getJSON(url)
          .then(function (d) {
            if (myRid !== st.rid) return;
            st.busy = false;
            setMoreLoading(moreEl, false);
            var items = arr(d.items);
            st.lastLen = items.length;
            st.loaded += items.length;
            st.page = requestPage + 1;
            if (reset) {
              if (!items.length) {
                hideMore(moreEl);
                J.empty(listEl, {
                  icon: '🔍',
                  title: '没有符合条件的基金',
                  desc: '试试放宽收益下限，或切换基金类型',
                  actionText: '重置条件',
                  onAction: resetAll
                });
                metaEl.textContent = '0 只';
                return;
              }
              listEl.innerHTML = items.map(rowHTML).join('');
            } else if (!items.length) {
              hideMore(moreEl);
            } else {
              listEl.innerHTML += items.map(rowHTML).join('');
            }
            metaEl.textContent = '共 ' + st.loaded + ' 只 · ' + TYPE_LABEL[st.type] + ' · ' + (SORT_LABEL[st.sort] || '近1年收益');
            if (st.lastLen >= 20) showMore(moreEl); else hideMore(moreEl);
          })
          .catch(function (err) {
            if (myRid !== st.rid) return;
            st.busy = false;
            setMoreLoading(moreEl, false);
            if (reset) J.errorBox(listEl, err.message, function () { load(true); });
            else J.toast('加载更多失败：' + err.message);
          });
      }

      function resetAll() {
        st.type = 'all';
        st.sort = '1nzf';
        if (inputY1) inputY1.value = '';
        if (inputY3) inputY3.value = '';
        if (inputYtd) inputYtd.value = '';
        if (sortEl) sortEl.value = '1nzf';
        renderTypes();
        load(true);
      }

      renderTypes();
      bindListClicks(listEl);
      var runBtn = body.querySelector('[data-scr-run]');
      var resetBtn = body.querySelector('[data-scr-reset]');
      if (runBtn) runBtn.onclick = function () { load(true); };
      if (resetBtn) resetBtn.onclick = resetAll;
      if (moreEl) moreEl.onclick = function () { load(false); };
      if (sortEl) sortEl.onchange = function () { load(true); };

      load(true);
    }
  });

  // ==================== 4) 基金排行 ====================
  J.register('fund-rank', {
    title: '基金排行',
    category: 'fund',
    icon: '🏆',
    order: 40,
    mount: function (body) {
      body.innerHTML =
        '<div class="t-card">' +
          '<div class="t-card-head"><span class="t-title">基金排行</span><span class="t-sub" data-rank-meta>加载中…</span></div>' +
          '<div class="t-body">' +
            '<div class="t-chips" data-rank-types></div>' +
            '<div class="t-form"><div class="t-fields"><label class="t-field"><span class="t-sub">排序</span>' +
              sortSelectHTML('data-rank-sort', '1nzf') + '</label></div></div>' +
            '<div class="t-list" data-rank-list></div>' +
            '<div class="t-actions"><button class="t-btn-ghost" data-rank-more style="display:none">加载更多</button></div>' +
            note('红涨绿跌；数据来自天天基金开放排行，首次加载可能较慢；☆ 加入基金自选。') +
          '</div>' +
        '</div>';

      var typesEl = body.querySelector('[data-rank-types]');
      var sortEl = body.querySelector('[data-rank-sort]');
      var listEl = body.querySelector('[data-rank-list]');
      var moreEl = body.querySelector('[data-rank-more]');
      var metaEl = body.querySelector('[data-rank-meta]');

      var st = { type: 'all', sort: '1nzf', page: 1, items: [], total: null, lastLen: 0, source: '', rid: 0, busy: false };

      function rowHTML(it) {
        var side = '<b class="' + dirCls(it.y1) + '">' + pct(it.y1) + '</b><small>近1年</small>';
        var meta = '近3年 ' + pctSpan(it.y3) + ' · 今年来 ' + pctSpan(it.ytd) + ' · 净值 ' + f(it.nav, 4);
        return J.rowHTML({
          name: esc(it.name || '—'),
          code: it.code,
          meta: meta,
          side: side,
          action: watchButton(it.code),
          attrs: 'data-code="' + esc(it.code) + '"'
        });
      }

      function renderTypes() {
        J.chips(typesEl, TYPE_ITEMS, st.type, function (key) {
          if (key === st.type) return;
          st.type = key;
          renderTypes();
          load(true);
        });
      }

      function render() {
        if (!st.items.length) {
          hideMore(moreEl);
          J.empty(listEl, { icon: '🏆', title: '暂无排行数据', desc: '稍后重试或切换类型', actionText: '重新加载', onAction: function () { load(true); } });
          metaEl.textContent = '暂无数据';
          return;
        }
        listEl.innerHTML = st.items.map(rowHTML).join('');
        var srcText = st.source === 'cache' ? '缓存' : (st.source === 'live' ? '实时' : '');
        var countText = st.total != null ? ('共 ' + f(st.total, 0) + ' 只') : (st.items.length + ' 只');
        metaEl.textContent = (SORT_LABEL[st.sort] || '近1年收益') + ' · ' + countText + (srcText ? ' · ' + srcText : '');
        if (st.lastLen >= 20 && (st.total == null || st.items.length < st.total)) showMore(moreEl);
        else hideMore(moreEl);
      }

      function load(reset) {
        if (st.busy && !reset) return;
        if (reset) { st.page = 1; st.items = []; st.total = null; st.lastLen = 0; }
        var requestPage = st.page;
        var myRid = ++st.rid;
        st.busy = true;
        if (reset) J.loading(listEl, '加载基金排行…（首次加载可能较慢）');
        else setMoreLoading(moreEl, true);

        getJSON('/api/fund/rank?type=' + encodeURIComponent(st.type) + '&sort=' + encodeURIComponent(st.sort) +
          '&page=' + requestPage + '&size=20')
          .then(function (d) {
            if (myRid !== st.rid) return;
            st.busy = false;
            setMoreLoading(moreEl, false);
            var items = arr(d.items);
            st.lastLen = items.length;
            st.total = n(d.total);
            st.source = d.source || '';
            st.items = reset ? items.slice() : st.items.concat(items);
            st.page = requestPage + 1;
            render();
          })
          .catch(function (err) {
            if (myRid !== st.rid) return;
            st.busy = false;
            setMoreLoading(moreEl, false);
            if (reset) J.errorBox(listEl, err.message, function () { load(true); });
            else J.toast('加载更多失败：' + err.message);
          });
      }

      renderTypes();
      bindListClicks(listEl);
      if (moreEl) moreEl.onclick = function () { load(false); };
      if (sortEl) sortEl.onchange = function () { if (sortEl.value) { st.sort = sortEl.value; load(true); } };

      load(true);
    }
  });

  // ==================== 5) 牛人选基 ====================
  J.register('manager-pick', {
    title: '牛人选基',
    category: 'fund',
    icon: '🎖️',
    order: 50,
    mount: function (body) {
      body.innerHTML =
        '<div class="t-card">' +
          '<div class="t-card-head"><span class="t-title">牛人选基</span><span class="t-sub" data-mp-meta>按基金经理星级与业绩筛选</span></div>' +
          '<div class="t-body">' +
            '<div class="t-list" data-mp-list></div>' +
            note('按基金经理星级（≥4 星）与近 1 年业绩筛选，非投资建议；点击行查看基金详情。') +
          '</div>' +
        '</div>';

      var listEl = body.querySelector('[data-mp-list]');
      var metaEl = body.querySelector('[data-mp-meta]');

      function managerMeta(it) {
        var fund = it.fund || {};
        var mgr = it.manager || {};
        var parts = [];
        if (mgr.name) parts.push('经理 ' + esc(mgr.name) + (starText(mgr.star) ? ' ' + starText(mgr.star) : ''));
        if (mgr.workTime) parts.push('任职 ' + esc(String(mgr.workTime)));
        if (mgr.fundSize != null) parts.push('规模 ' + sizeText(mgr.fundSize));
        if (fund.type) parts.push(esc(String(fund.type)));
        return parts.length ? parts.join(' · ') : '经理信息暂缺';
      }

      function rowHTML(it) {
        var fund = it.fund || {};
        var side = '<b class="' + dirCls(it.y1) + '">' + pct(it.y1) + '</b>' +
          '<small>近1年 · 近3年 ' + pct(it.y3) + '</small>';
        return J.rowHTML({
          name: esc(fund.name || '—'),
          code: fund.code,
          meta: managerMeta(it),
          side: side,
          attrs: 'data-code="' + esc(fund.code) + '"'
        });
      }

      function render(items) {
        if (!items.length) {
          J.empty(listEl, { icon: '🎖️', title: '暂无牛人选基数据', desc: '上游数据获取较慢，请稍后重试', actionText: '重新加载', onAction: function () { load(); } });
          metaEl.textContent = '暂无数据';
          return;
        }
        listEl.innerHTML = items.map(rowHTML).join('');
        metaEl.textContent = '共 ' + items.length + ' 只 · 星级 ≥ 4 星';
      }

      function load() {
        J.loading(listEl, '加载牛人选基…（需要拉取多只基金详情，首次可能 3-5 秒）');
        getJSON('/api/fund/manager-pick?limit=8')
          .then(function (d) {
            var items = arr(d.items).filter(function (it) { return it && it.fund && it.fund.code; });
            render(items);
          })
          .catch(function (err) {
            J.errorBox(listEl, err.message, function () { load(); });
          });
      }

      bindListClicks(listEl);
      load();
    }
  });

  // ==================== 6) 基金诊断 ====================
  J.register('fund-diagnose', {
    title: '基金诊断',
    category: 'fund',
    icon: '🩺',
    order: 60,
    mount: function (body) {
      body.innerHTML =
        '<div class="t-card">' +
          '<div class="t-card-head"><span class="t-title">基金诊断</span><span class="t-sub">收益 · 风险 · 经理 · 稳定性 · 规模</span></div>' +
          '<div class="t-body">' +
            '<div class="t-field">' +
              '<input class="t-input" type="search" data-diag-input placeholder="输入基金代码 / 名称，如 110022" autocomplete="off">' +
              '<div class="t-suggest hidden" data-diag-suggest></div>' +
            '</div>' +
            '<div class="t-chips" data-diag-examples></div>' +
          '</div>' +
        '</div>' +
        '<div class="t-card">' +
          '<div class="t-card-head"><span class="t-title">诊断结果</span><span class="t-sub" data-diag-meta>—</span></div>' +
          '<div class="t-body"><div data-diag-result></div></div>' +
        '</div>';

      var inputEl = body.querySelector('[data-diag-input]');
      var suggestEl = body.querySelector('[data-diag-suggest]');
      var examplesEl = body.querySelector('[data-diag-examples]');
      var resultEl = body.querySelector('[data-diag-result]');
      var metaEl = body.querySelector('[data-diag-meta]');

      var rid = 0;

      var INTRO = '<div class="t-empty"><div class="t-empty-ico">🩺</div>' +
        '<p>搜索并选择一只基金，生成综合诊断</p>' +
        '<p class="t-sub">从收益、风险、经理、稳定性、规模适配五个维度评分，给出 A/B/C/D 等级与结论建议。点击上方热门示例可直接体验。</p></div>';
      resultEl.innerHTML = INTRO;

      function dimsHTML(dims) {
        if (!dims.length) return '<p class="t-sub">暂无维度评分数据</p>';
        return '<div class="t-section"><div class="t-section-title">五维评分</div>' +
          dims.map(function (dim) {
            var score = n(dim.score);
            var width = clampPct(score);
            return '<div class="t-field">' +
              '<div class="t-row">' +
                '<div class="t-row-main"><span class="t-name">' + esc(dim.label || dim.key || '维度') + '</span>' +
                  (dim.desc ? '<span class="t-meta">' + esc(dim.desc) + '</span>' : '') + '</div>' +
                '<div class="t-row-side"><b>' + (score == null ? '—' : Math.round(score)) + '</b></div>' +
              '</div>' +
              '<div class="t-progress"><i style="width:' + width + '%"></i></div>' +
            '</div>';
          }).join('') +
          '</div>';
      }

      function stageHTML(stage) {
        var pairs = [['近1月', 'm1'], ['近3月', 'm3'], ['近6月', 'm6'], ['近1年', 'y1'], ['近3年', 'y3'], ['成立来', 'since']];
        return J.kpis(pairs.map(function (p) {
          var v = stage[p[1]];
          return { label: p[0], value: pct(v), dir: dirCls(v) };
        }));
      }

      function riskHTML(risk) {
        return J.kpis([
          { label: '最大回撤', value: pct(risk.maxDrawdown), dir: dirCls(risk.maxDrawdown) },
          { label: '年化波动', value: n(risk.volatility) == null ? '—' : f(risk.volatility, 2) + '%', dir: '' },
          { label: '夏普比率', value: n(risk.sharpe) == null ? '—' : f(risk.sharpe, 2), dir: '' },
          { label: '成立年化', value: pct(risk.annualized), dir: dirCls(risk.annualized) }
        ]);
      }

      function render(d) {
        var fund = d.fund || {};
        var score = n(d.score);
        var grade = d.grade || gradeOf(score);
        var dims = arr(d.dims);
        var tags = arr(d.tags);
        var stage = d.stage || {};
        var risk = d.risk || {};
        var pc = d.percentile || {};
        var p1 = ratioPct(pc.y1);
        var p3 = ratioPct(pc.y3);
        var advice = d.advice || '';
        var updated = d.updatedAt ? dateText(d.updatedAt) : '—';

        var scoreCls = score == null ? '' : (score >= 80 ? 'up' : (score < 60 ? 'down' : ''));
        var tagsHTML = tags.length ? '<div class="t-chips">' + tags.map(function (t) {
          var text = tagText(t);
          return text ? '<span class="t-chip">' + esc(text) + '</span>' : '';
        }).join('') + '</div>' : '';
        var pcHTML = (p1 != null || p3 != null)
          ? note('同类分位：近1年 ' + (p1 == null ? '—' : '前 ' + f(p1, 1) + '%') + ' · 近3年 ' + (p3 == null ? '—' : '前 ' + f(p3, 1) + '%'))
          : '';

        metaEl.textContent = (fund.type ? fund.type + ' · ' : '') + '更新于 ' + updated;
        resultEl.innerHTML =
          '<div class="t-card">' +
            '<div class="t-card-head"><span class="t-title">' + esc(fund.name || fund.code || '基金') + '</span>' +
              '<span class="t-sub">' + esc(String(fund.code || '—') + ' · ' + String(fund.type || '基金')) + '</span></div>' +
            '<div class="t-body">' +
              '<div class="t-kpis">' +
                '<div class="t-kpi"><span class="t-kpi-label">综合评分</span><b class="t-kpi-value ' + scoreCls + '">' + (score == null ? '—' : Math.round(score)) + '</b></div>' +
                '<div class="t-kpi"><span class="t-kpi-label">等级</span><b class="t-kpi-value"><span class="t-badge ' + gradeCls(grade) + '">' + esc(String(grade)) + '</span></b></div>' +
              '</div>' +
              '<div class="t-section"><div class="t-section-title">综合得分</div>' +
                '<div class="t-progress"><i style="width:' + clampPct(score) + '%"></i></div></div>' +
              '<div class="t-section"><div class="t-section-title">阶段收益</div>' + stageHTML(stage) + '</div>' +
              dimsHTML(dims) +
              '<div class="t-section"><div class="t-section-title">风险指标</div>' + riskHTML(risk) + '</div>' +
              tagsHTML +
              pcHTML +
              note('诊断结论：' + (advice ? esc(advice) : '暂无结论建议')) +
              note('评分基于历史净值与公开信息计算，仅供参考，不构成投资建议。') +
            '</div>' +
          '</div>';
      }

      function load(code) {
        if (!code) return;
        var myRid = ++rid;
        J.loading(resultEl, '诊断中…需要拉取该基金历史净值，可能需要几秒');
        metaEl.textContent = '诊断中…';
        getJSON('/api/fund/diagnose?code=' + encodeURIComponent(code))
          .then(function (d) {
            if (myRid !== rid) return;
            if (!d.fund) throw new Error('未获取到该基金数据');
            render(d);
          })
          .catch(function (err) {
            if (myRid !== rid) return;
            metaEl.textContent = '—';
            J.errorBox(resultEl, err.message, function () { load(code); });
          });
      }

      J.fundSearch(inputEl, suggestEl, function (fund) {
        if (!fund || !fund.code) return;
        load(fund.code);
      });
      J.chips(examplesEl, DIAG_EXAMPLES.map(function (x) { return { key: x.key, label: x.label }; }), null, function (code) {
        if (inputEl) inputEl.value = code;
        load(code);
      });
    }
  });

  // ==================== 7) 基金 PK ====================
  J.register('fund-pk', {
    title: '基金PK',
    category: 'fund',
    icon: '⚔️',
    order: 70,
    mount: function (body) {
      body.innerHTML =
        '<div class="t-card">' +
          '<div class="t-card-head"><span class="t-title">选择基金</span><span class="t-sub">2-4 只 · 归一化走势对比</span></div>' +
          '<div class="t-body">' +
            '<div class="t-field">' +
              '<input class="t-input" type="search" data-pk-input placeholder="输入基金代码 / 名称添加，如 110022" autocomplete="off">' +
              '<div class="t-suggest hidden" data-pk-suggest></div>' +
            '</div>' +
            '<div class="t-chips" data-pk-tags></div>' +
            '<div class="t-actions">' +
              '<button class="t-btn-primary" data-pk-run>开始对比</button>' +
              '<button class="t-btn-ghost" data-pk-clear>清空</button>' +
            '</div>' +
            '<p class="t-sub" data-pk-count>已选 0 / 4 · 至少 2 只才能对比</p>' +
          '</div>' +
        '</div>' +
        '<div class="t-card">' +
          '<div class="t-card-head"><span class="t-title">对比结果</span><span class="t-sub" data-pk-meta>—</span></div>' +
          '<div class="t-body">' +
            '<div data-pk-chart><div class="t-empty"><p>选择 2 只以上基金后点「开始对比」</p></div></div>' +
            '<div class="t-legend" data-pk-legend></div>' +
            '<div data-pk-table></div>' +
            note('走势按共同统计区间起点归一化为 0%；指标来自天天基金公开净值，历史业绩不代表未来。') +
          '</div>' +
        '</div>';

      var inputEl = body.querySelector('[data-pk-input]');
      var suggestEl = body.querySelector('[data-pk-suggest]');
      var tagsEl = body.querySelector('[data-pk-tags]');
      var countEl = body.querySelector('[data-pk-count]');
      var chartEl = body.querySelector('[data-pk-chart]');
      var legendEl = body.querySelector('[data-pk-legend]');
      var tableEl = body.querySelector('[data-pk-table]');
      var metaEl = body.querySelector('[data-pk-meta]');
      var runBtn = body.querySelector('[data-pk-run]');
      var clearBtn = body.querySelector('[data-pk-clear]');

      var MAX = 4;
      var sel = [];
      var rid = 0;

      function renderTags() {
        tagsEl.innerHTML = sel.map(function (f) {
          return '<button class="t-chip active" data-remove-code="' + esc(f.code) + '" title="点击移除">' +
            esc(f.name || f.code) + ' <span class="muted">✕</span></button>';
        }).join('');
        countEl.textContent = '已选 ' + sel.length + ' / ' + MAX + ' · ' + (sel.length < 2 ? '至少 2 只才能对比' : '可开始对比');
      }

      function resetResult(msg) {
        chartEl.innerHTML = '<div class="t-empty"><p>' + esc(msg) + '</p></div>';
        legendEl.innerHTML = '';
        tableEl.innerHTML = '';
        metaEl.textContent = '—';
      }

      function addFund(fund) {
        if (!fund || !fund.code) return;
        var code = String(fund.code);
        for (var i = 0; i < sel.length; i++) {
          if (sel[i].code === code) { J.toast('该基金已添加'); return; }
        }
        if (sel.length >= MAX) { J.toast('最多对比 ' + MAX + ' 只基金'); return; }
        sel.push({ code: code, name: fund.name || code });
        if (inputEl) inputEl.value = '';
        renderTags();
        if (sel.length >= 2) compare();
        else resetResult('再添加 1 只基金即可开始对比');
      }

      function removeFund(code) {
        code = String(code);
        var next = [];
        for (var i = 0; i < sel.length; i++) { if (sel[i].code !== code) next.push(sel[i]); }
        sel = next;
        renderTags();
        if (sel.length < 2) { rid++; resetResult('至少选择 2 只基金才能对比'); }
        else compare();
      }

      function seriesOf(items) {
        return items.map(function (it, i) {
          var points = [];
          arr(it.series).forEach(function (p) {
            if (!p) return;
            var t = toTs(p.t);
            var v = n(p.pct);
            if (t != null && v != null) points.push({ t: t, v: v });
          });
          return { name: it.name || it.code, points: points, color: PALETTE[i % PALETTE.length] };
        });
      }

      function tableHTML(items) {
        var cols = [['m1', '近1月'], ['m3', '近3月'], ['m6', '近6月'], ['y1', '近1年'], ['y3', '近3年']];
        var head = '<tr><th>基金</th>' + cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') +
          '<th>最大回撤</th><th>年化</th></tr>';
        var rows = items.map(function (it) {
          var stage = it.stage || {};
          var risk = it.risk || {};
          var tds = '<td>' + esc(it.name || it.code) + '<br><span class="t-code">' + esc(String(it.code || '')) + '</span></td>';
          tds += cols.map(function (c) {
            var v = stage[c[0]];
            return '<td class="' + dirCls(v) + '">' + pct(v) + '</td>';
          }).join('');
          tds += '<td class="' + dirCls(risk.maxDrawdown) + '">' + pct(risk.maxDrawdown) + '</td>';
          tds += '<td class="' + dirCls(risk.annualized) + '">' + pct(risk.annualized) + '</td>';
          return '<tr>' + tds + '</tr>';
        }).join('');
        return '<div class="t-table-wrap"><table class="t-table" style="min-width:560px"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>';
      }

      function compare() {
        if (sel.length < 2) { J.toast('至少选择 2 只基金'); return; }
        var codes = sel.map(function (x) { return x.code; }).join(',');
        var myRid = ++rid;
        J.loading(chartEl, '正在对比…首次加载可能较慢');
        legendEl.innerHTML = '';
        tableEl.innerHTML = '';
        metaEl.textContent = '对比中…';
        getJSON('/api/fund/compare?codes=' + encodeURIComponent(codes))
          .then(function (d) {
            if (myRid !== rid) return;
            var items = arr(d.items).filter(function (it) { return it && it.code; });
            if (items.length < 2) {
              J.empty(chartEl, { icon: '⚔️', title: '可比数据不足', desc: '部分基金暂未获取到净值，请更换后再试' });
              metaEl.textContent = '数据不足';
              return;
            }
            var series = seriesOf(items);
            chartEl.innerHTML = J.lineChart(series, { height: 200 });
            legendEl.innerHTML = items.map(function (it, i) {
              return '<span class="t-legend-item"><i class="t-dot" style="background:' + PALETTE[i % PALETTE.length] + '"></i>' +
                esc(it.name || it.code) + '</span>';
            }).join('');
            tableEl.innerHTML = tableHTML(items);
            var win = d.window || {};
            metaEl.textContent = (win.start ? '区间 ' + dateText(win.start) + ' ~ ' + dateText(win.end) + ' · ' : '') + items.length + ' 只';
          })
          .catch(function (err) {
            if (myRid !== rid) return;
            metaEl.textContent = '—';
            J.errorBox(chartEl, err.message, function () { compare(); });
          });
      }

      J.fundSearch(inputEl, suggestEl, function (fund) { addFund(fund); });
      tagsEl.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var b = t.closest('[data-remove-code]');
        if (b) removeFund(b.getAttribute('data-remove-code'));
      });
      if (runBtn) runBtn.onclick = function () { compare(); };
      if (clearBtn) clearBtn.onclick = function () {
        sel = [];
        rid++;
        renderTags();
        resetResult('选择 2 只以上基金后点「开始对比」');
        if (inputEl) inputEl.value = '';
      };
      renderTags();
    }
  });

  // ==================== 8) 相似基金 ====================
  J.register('fund-similar', {
    title: '相似基金',
    category: 'fund',
    icon: '🧬',
    order: 80,
    mount: function (body) {
      body.innerHTML =
        '<div class="t-card">' +
          '<div class="t-card-head"><span class="t-title">相似基金</span><span class="t-sub">按收益向量相似度查找替代品</span></div>' +
          '<div class="t-body">' +
            '<div class="t-field">' +
              '<input class="t-input" type="search" data-sim-input placeholder="输入基准基金代码 / 名称，如 110022" autocomplete="off">' +
              '<div class="t-suggest hidden" data-sim-suggest></div>' +
            '</div>' +
            note('基于近6月 / 近1年 / 近3年收益向量的归一化欧氏距离计算相似度，仅供参考，不构成投资建议。') +
          '</div>' +
        '</div>' +
        '<div class="t-card">' +
          '<div class="t-card-head"><span class="t-title">相似基金列表</span><span class="t-sub" data-sim-meta>—</span></div>' +
          '<div class="t-body">' +
            '<div data-sim-base></div>' +
            '<div class="t-list" data-sim-list></div>' +
          '</div>' +
        '</div>';

      var inputEl = body.querySelector('[data-sim-input]');
      var suggestEl = body.querySelector('[data-sim-suggest]');
      var baseEl = body.querySelector('[data-sim-base]');
      var listEl = body.querySelector('[data-sim-list]');
      var metaEl = body.querySelector('[data-sim-meta]');

      var rid = 0;
      baseEl.innerHTML = '<div class="t-empty"><div class="t-empty-ico">🧬</div><p>搜索一只基金，查看与它风格相近的基金</p></div>';

      function renderBase(base) {
        base = base || {};
        baseEl.innerHTML = '<div class="t-row">' +
          '<div class="t-row-main">' +
            '<span class="t-name">' + esc(base.name || base.code || '—') +
              (base.code ? '<small class="t-code">' + esc(base.code) + '</small>' : '') + '</span>' +
            '<span class="t-meta">' + esc(String(base.type || '基金')) + ' · 基准基金</span>' +
          '</div></div>';
      }

      function renderItems(items) {
        items.sort(function (a, b) {
          var sa = n(a.score); var sb = n(b.score);
          return (sb == null ? -1 : sb) - (sa == null ? -1 : sa);
        });
        listEl.innerHTML = items.map(function (it) {
          var score = n(it.score);
          if (score != null && Math.abs(score) <= 1) score = score * 100;
          score = score == null ? null : Math.max(0, Math.min(100, score));
          var badgeCls = score == null ? '' : (score >= 80 ? 'low' : (score >= 60 ? 'mid' : ''));
          var badge = '<span class="t-badge ' + badgeCls + '">相似 ' + (score == null ? '—' : f(score, 0)) + '</span>';
          return J.rowHTML({
            name: esc(it.name || '—'),
            code: it.code,
            meta: '近6月 ' + pctSpan(it.m6) + ' · 近1年 ' + pctSpan(it.y1) + ' · 近3年 ' + pctSpan(it.y3),
            side: badge,
            attrs: 'data-code="' + esc(it.code) + '"'
          });
        }).join('');
      }

      function load(code) {
        if (!code) return;
        var myRid = ++rid;
        baseEl.innerHTML = '';
        J.loading(listEl, '正在计算相似基金…可能需要几秒');
        metaEl.textContent = '计算中…';
        getJSON('/api/fund/similar?code=' + encodeURIComponent(code))
          .then(function (d) {
            if (myRid !== rid) return;
            renderBase(d.base);
            var items = arr(d.items);
            if (!items.length) {
              J.empty(listEl, { icon: '🧬', title: '暂无相似基金', desc: '该基金暂无可比数据，换一只试试' });
              metaEl.textContent = '0 只';
              return;
            }
            renderItems(items);
            metaEl.textContent = '共 ' + items.length + ' 只 · 按相似度排序';
          })
          .catch(function (err) {
            if (myRid !== rid) return;
            metaEl.textContent = '—';
            J.errorBox(listEl, err.message, function () { load(code); });
          });
      }

      J.fundSearch(inputEl, suggestEl, function (fund) {
        if (fund && fund.code) load(fund.code);
      });
      bindListClicks(listEl);
    }
  });
})();
