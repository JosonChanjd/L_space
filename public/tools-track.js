/* 韭研 · 工具中心 —— 跟踪管理（tools-track.js）
 * 4 个工具：基金账本 / 策略提醒 / 组合回测 / 组合实盘
 * 单文件、原生 JS、零依赖、无外链；本地数据用 localStorage，实时净值走本地 Node 后端。
 * 依赖：public/tools.js 暴露的 window.JYXT，后端 /api/snapshot、/api/fund/quotes、/api/portfolio/backtest。
 */
(function () {
  'use strict';

  var JYXT = window.JYXT;
  if (!JYXT) {
    try { console.warn('[tools-track] window.JYXT 未就绪，跟踪管理工具未加载'); } catch (e) { /* ignore */ }
    return;
  }

  // ==================== 常量 ====================
  var LS_LEDGER = 'jy_ledger_v1';
  var LS_ALERTS = 'jy_alerts_v1';
  var LS_PORTFOLIOS = 'jy_portfolios_v1';
  var ALERT_TICK_MS = 60000;
  var DRIFT_WARN = 5;
  var CHART_UP = '#e5433b';
  var CHART_DOWN = '#17a673';
  var SAMPLE_FUNDS = [
    { code: '110022', name: '易方达消费行业' },
    { code: '161725', name: '招商中证白酒' },
    { code: '003096', name: '中欧医疗健康混合A' }
  ];

  var esc = JYXT.esc;
  var api = JYXT.api;
  var toast = JYXT.toast;
  var storage = JYXT.storage;
  var uid = JYXT.uid;
  var fmt = JYXT.fmt;
  var fmtDate = JYXT.fmtDate;
  var fmtDateTime = JYXT.fmtDateTime;
  var pctDir = JYXT.pctDir;

  // ==================== 基础小工具 ====================
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function round(v, digits) {
    var n = num(v);
    if (n === null) return null;
    var d = digits == null ? 2 : digits;
    var f = Math.pow(10, d);
    return Math.round(n * f) / f;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function dateKey(ts) {
    var n = num(ts);
    if (n === null) return '';
    var d = new Date(n);
    if (!isFinite(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function extractFundCode(text) {
    var m = String(text == null ? '' : text).match(/(\d{6})/);
    return m ? m[1] : null;
  }
  function numText(v, digits) {
    var n = num(v);
    if (n === null) return '—';
    var d = digits == null ? 2 : digits;
    return String(parseFloat(n.toFixed(d)));
  }
  /** 安全格式化：缺失值显示 —（JYXT.fmt 会把 null 当成 0） */
  function nf(v, digits) {
    var n = num(v);
    if (n === null) return '—';
    return fmt(n, digits == null ? 2 : digits);
  }
  function money(v) {
    var n = num(v);
    return n === null ? '—' : '¥' + fmt(n, 2);
  }
  function signedMoney(v) {
    var n = num(v);
    if (n === null) return '—';
    if (n > 0) return '+¥' + fmt(n, 2);
    if (n < 0) return '-¥' + fmt(Math.abs(n), 2);
    return '¥0.00';
  }
  function signedPct(v) {
    var n = num(v);
    if (n === null) return '—';
    return (n > 0 ? '+' : '') + fmt(n, 2) + '%';
  }
  function readLS(key, fallback) {
    try { return storage.get(key, fallback); } catch (e) { return fallback; }
  }
  function writeLS(key, val) {
    try { storage.set(key, val); } catch (e) { /* ignore */ }
  }
  function req(path) {
    try { return api(path); } catch (e) { return Promise.reject(e); }
  }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function isLive(el) { return !!el && document.body.contains(el); }
  function fundNameOf(item, fallback) {
    if (item && item.name) return item.name;
    return fallback || '';
  }

  /** 批量取基金最新净值（复用后端 detail 缓存；每 20 个一组，失败不抛） */
  function fetchFundQuotes(codes) {
    var list = [];
    (codes || []).forEach(function (c) {
      var code = String(c == null ? '' : c).trim();
      if (/^\d{6}$/.test(code) && list.indexOf(code) < 0) list.push(code);
    });
    if (!list.length) return Promise.resolve({ map: {}, failed: [], list: [] });
    var chunks = [];
    for (var i = 0; i < list.length; i += 20) chunks.push(list.slice(i, i + 20));
    return Promise.all(chunks.map(function (chunk) {
      return req('/api/fund/quotes?codes=' + encodeURIComponent(chunk.join(',')))
        .then(function (data) { return (data && data.items) || []; })
        .catch(function () { return []; });
    })).then(function (groups) {
      var map = {};
      groups.forEach(function (items) {
        (items || []).forEach(function (it) { if (it && it.code) map[String(it.code)] = it; });
      });
      var failed = list.filter(function (code) {
        return !map[code] || num(map[code].nav) === null;
      });
      return { map: map, failed: failed, list: list };
    });
  }

  // ==================== 组合权重编辑器（回测 / 实盘共用） ====================
  function weightEditorHTML() {
    var samples = SAMPLE_FUNDS.map(function (f) {
      return '<button class="t-chip" data-sample="' + esc(f.code) + '" data-sample-name="' + esc(f.name) + '">' + esc(f.name) + '</button>';
    }).join('');
    return '' +
      '<div class="t-field"><label class="t-sub">添加基金（2-5 只）</label>' +
        '<input class="t-input" data-role="search" autocomplete="off" placeholder="输入基金名称 / 代码搜索">' +
        '<div class="t-suggest hidden" data-role="suggest"></div></div>' +
      '<div class="t-chips" data-role="tags"><span class="t-sub">还没有添加基金</span></div>' +
      '<div class="t-list" data-role="weights"></div>' +
      '<p class="t-note" data-role="sum">权重合计 0%</p>' +
      '<div class="t-chips" data-role="samples"><span class="t-sub">快速添加：</span>' + samples + '</div>';
  }

  function createWeightEditor(root, opts) {
    opts = opts || {};
    var maxCount = opts.max || 5;
    var minCount = opts.min || 2;
    var funds = [];
    var customized = false;
    var searchInput = q('[data-role="search"]', root);
    var suggestEl = q('[data-role="suggest"]', root);
    var tagsEl = q('[data-role="tags"]', root);
    var weightsEl = q('[data-role="weights"]', root);
    var sumEl = q('[data-role="sum"]', root);
    var samplesEl = q('[data-role="samples"]', root);

    function findFund(code) {
      for (var i = 0; i < funds.length; i++) {
        if (String(funds[i].code) === String(code)) return funds[i];
      }
      return null;
    }
    function inputValue(v) {
      var n = num(v);
      if (n === null) return '';
      return String(Math.round(n * 100) / 100);
    }
    function equalize() {
      var n = funds.length;
      if (!n) return;
      var base = Math.round((100 / n) * 100) / 100;
      var acc = 0;
      for (var i = 0; i < n; i++) {
        if (i === n - 1) funds[i].weight = Math.round((100 - acc) * 100) / 100;
        else { funds[i].weight = base; acc += base; }
      }
    }
    function render() {
      if (tagsEl) {
        tagsEl.innerHTML = funds.length ? funds.map(function (f) {
          return '<button class="t-chip active" data-remove="' + esc(f.code) + '">' + esc(f.name) + ' ✕</button>';
        }).join('') : '<span class="t-sub">还没有添加基金</span>';
      }
      if (weightsEl) {
        weightsEl.innerHTML = funds.map(function (f) {
          return '<div class="t-row">' +
            '<div class="t-row-main"><div class="t-name">' + esc(f.name) + '<small class="t-code">' + esc(f.code) + '</small></div></div>' +
            '<div class="t-row-side"><input class="t-input" data-weight="' + esc(f.code) + '" type="number" min="0" max="100" step="1" inputmode="decimal" value="' + inputValue(f.weight) + '"><span class="t-sub">%</span></div>' +
            '</div>';
        }).join('');
      }
      updateSum();
    }
    function addFund(f) {
      if (!f || !f.code) return;
      if (funds.length >= maxCount) { toast('最多添加 ' + maxCount + ' 只基金'); return; }
      if (findFund(f.code)) { toast('该基金已经添加过了'); return; }
      funds.push({ code: String(f.code), name: fundNameOf(f, String(f.code)), weight: 0 });
      if (!customized) {
        equalize();
      } else {
        var sumOthers = 0;
        for (var i = 0; i < funds.length - 1; i++) sumOthers += num(funds[i].weight) || 0;
        funds[funds.length - 1].weight = Math.max(0, Math.round((100 - sumOthers) * 100) / 100);
      }
      render();
    }
    function removeFund(code) {
      var next = [];
      for (var i = 0; i < funds.length; i++) {
        if (String(funds[i].code) !== String(code)) next.push(funds[i]);
      }
      funds = next;
      if (!customized) {
        equalize();
      } else if (funds.length) {
        var sum = 0;
        funds.forEach(function (f) { sum += num(f.weight) || 0; });
        if (sum > 0) {
          funds.forEach(function (f) { f.weight = Math.round((f.weight / sum) * 10000) / 100; });
        }
      }
      render();
    }
    function readWeights() {
      if (weightsEl) {
        qa('[data-weight]', weightsEl).forEach(function (inp) {
          var f = findFund(inp.getAttribute('data-weight'));
          if (!f) return;
          var v = num(inp.value);
          f.weight = (v === null || v < 0) ? 0 : v;
        });
      }
      return funds.map(function (f) { return num(f.weight) || 0; });
    }
    function updateSum() {
      var w = readWeights();
      var sum = 0;
      for (var i = 0; i < w.length; i++) sum += w[i];
      if (sumEl) {
        if (!funds.length) sumEl.textContent = '权重合计 0%';
        else sumEl.textContent = '权重合计 ' + fmt(sum, 2) + '%' + (Math.abs(sum - 100) > 0.005 ? ' · 提交时按比例自动归一' : '');
      }
      return sum;
    }
    function getWeights() {
      var raw = readWeights();
      if (!funds.length) return [];
      var sum = 0;
      raw.forEach(function (v) { sum += v; });
      var out;
      if (!(sum > 0)) {
        var base = Math.round((100 / funds.length) * 100) / 100;
        out = funds.map(function () { return base; });
        sum = base * funds.length;
      } else {
        out = raw.map(function (v) { return Math.round((v / sum) * 10000) / 100; });
      }
      var total = 0;
      out.forEach(function (v) { total += v; });
      if (out.length) out[out.length - 1] = Math.round((out[out.length - 1] + (100 - total)) * 100) / 100;
      return out;
    }
    if (searchInput && suggestEl) {
      JYXT.fundSearch(searchInput, suggestEl, function (picked) {
        addFund(picked);
        if (searchInput) searchInput.value = '';
      });
    }
    if (tagsEl) {
      tagsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-remove]');
        if (btn) removeFund(btn.getAttribute('data-remove'));
      });
    }
    if (weightsEl) {
      weightsEl.addEventListener('input', function (e) {
        var inp = e.target.closest('[data-weight]');
        if (!inp) return;
        customized = true;
        updateSum();
      });
    }
    if (samplesEl) {
      samplesEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-sample]');
        if (!btn) return;
        addFund({
          code: btn.getAttribute('data-sample'),
          name: btn.getAttribute('data-sample-name') || btn.getAttribute('data-sample')
        });
      });
    }
    render();
    return {
      min: minCount,
      add: addFund,
      reset: function () {
        funds = [];
        customized = false;
        if (searchInput) searchInput.value = '';
        render();
      },
      getFunds: function () {
        return funds.map(function (f) { return { code: f.code, name: f.name }; });
      },
      getWeights: getWeights,
      count: function () { return funds.length; }
    };
  }

  // ==================== 1. 基金账本 ====================
  function loadLedger() {
    var arr = readLS(LS_LEDGER, []);
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (t) {
      return t && t.code && (t.side === 'buy' || t.side === 'sell');
    });
  }
  function txKey(t) {
    if (!t) return '';
    if (t.id) return 'id:' + t.id;
    return 'k:' + [t.code, t.side, t.date, t.createdAt, t.nav, t.shares, t.amount].join('|');
  }
  function sortTxs(arr) {
    return arr.slice().sort(function (a, b) {
      var da = String(a.date || '');
      var db = String(b.date || '');
      if (da !== db) return da < db ? -1 : 1;
      var ca = Number(a.createdAt) || 0;
      var cb = Number(b.createdAt) || 0;
      if (ca !== cb) return ca - cb;
      return String(a.id || '') < String(b.id || '') ? -1 : 1;
    });
  }
  /** 移动加权成本试算：返回每只基金持仓、已实现盈亏、累计投入与卖出回款 */
  function computeLedger(txs) {
    var map = {};
    var order = [];
    txs.forEach(function (t) {
      var code = String(t.code || '');
      if (!code) return;
      var p = map[code];
      if (!p) {
        p = map[code] = {
          code: code,
          name: t.name || code,
          shares: 0,
          avgCost: 0,
          realized: 0,
          invested: 0,
          returned: 0
        };
        order.push(code);
      }
      if (t.name) p.name = t.name;
      var nav = num(t.nav);
      var shares = num(t.shares);
      var amount = num(t.amount);
      if (shares === null || !(shares > 0)) shares = nav !== null && nav > 0 && amount !== null && amount > 0 ? amount / nav : 0;
      if (amount === null || !(amount > 0)) amount = nav !== null && nav > 0 ? shares * nav : 0;
      var feeRate = num(t.fee);
      if (feeRate === null || feeRate < 0) feeRate = 0;
      var feeAmt = amount * feeRate / 100;
      if (t.side === 'buy') {
        var cost = amount + feeAmt;
        var newShares = p.shares + shares;
        p.avgCost = newShares > 0 ? (p.shares * p.avgCost + cost) / newShares : 0;
        p.shares = newShares;
        p.invested += cost;
      } else {
        var proceeds = amount - feeAmt;
        if (p.shares > 0 && shares > 0) {
          var sold = Math.min(shares, p.shares);
          p.realized += proceeds - sold * p.avgCost;
          p.shares = Math.max(0, p.shares - sold);
          if (p.shares <= 1e-9) { p.shares = 0; p.avgCost = 0; }
        }
        p.returned += proceeds;
      }
    });
    var out = {
      positions: order.map(function (code) { return map[code]; }),
      invested: 0,
      returned: 0
    };
    out.positions.forEach(function (p) {
      out.invested += p.invested;
      out.returned += p.returned;
    });
    return out;
  }

  function ledgerShell() {
    return '' +
      '<div class="t-card">' +
        '<div class="t-card-head"><span class="t-title">记一笔</span><span class="t-sub">数据仅保存在本机浏览器</span></div>' +
        '<div class="t-body"><div class="t-form">' +
          '<div class="t-field"><label class="t-sub">基金</label>' +
            '<input class="t-input" id="lgSearch" autocomplete="off" placeholder="搜索基金名称 / 代码">' +
            '<div class="t-suggest hidden" id="lgSuggest"></div></div>' +
          '<div id="lgPicked"></div>' +
          '<div class="t-chips" id="lgSide"></div>' +
          '<div class="t-fields">' +
            '<div class="t-field"><label class="t-sub">净值</label><input class="t-input" id="lgNav" type="number" min="0" step="0.0001" inputmode="decimal" placeholder="如 1.2345"></div>' +
            '<div class="t-field"><label class="t-sub">份额</label><input class="t-input" id="lgShares" type="number" min="0" step="0.01" inputmode="decimal" placeholder="自动换算"></div>' +
            '<div class="t-field"><label class="t-sub">金额 (¥)</label><input class="t-input" id="lgAmount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="自动换算"></div>' +
            '<div class="t-field"><label class="t-sub">交易日期</label><input class="t-input" id="lgDate" type="date"></div>' +
            '<div class="t-field"><label class="t-sub">费率 (%)</label><input class="t-input" id="lgFee" type="number" min="0" step="0.01" inputmode="decimal" value="0.15"></div>' +
          '</div>' +
          '<div class="t-actions"><button class="t-btn t-btn-primary" id="lgAdd">记一笔</button><button class="t-btn t-btn-ghost" id="lgReset">重置</button></div>' +
          '<p class="t-note">份额与金额填一个即可，另一个会按净值自动换算；费率用于计算投入成本与已实现盈亏（买入通常约 0.15%，卖出按持有天数递减，可自行修改）。</p>' +
        '</div></div>' +
      '</div>' +
      '<div class="t-card">' +
        '<div class="t-card-head"><span class="t-title">持仓汇总</span><span class="t-sub">按最新净值估值</span></div>' +
        '<div class="t-body"><div class="t-kpis" id="lgSumKpis"></div><div class="t-list" id="lgHoldList"></div>' +
          '<p class="t-note" id="lgQuoteNote">数据仅保存在本机浏览器</p>' +
          '<div class="t-actions"><button class="t-btn t-btn-ghost" id="lgRefresh">刷新净值</button></div></div>' +
      '</div>' +
      '<div class="t-card">' +
        '<div class="t-card-head"><span class="t-title">交易流水</span><span class="t-sub" id="lgTxCount">0 笔</span></div>' +
        '<div class="t-body"><div class="t-list" id="lgTxList"></div>' +
          '<div class="t-actions"><button class="t-btn t-btn-ghost" id="lgClear">清空账本</button></div></div>' +
      '</div>';
  }

  function mountLedger(body) {
    if (!body) return;
    var picked = null;
    var side = 'buy';
    var quotes = {};
    var quoteSeq = 0;
    body.innerHTML = ledgerShell();

    var searchInput = q('#lgSearch', body);
    var suggestEl = q('#lgSuggest', body);
    var pickedBox = q('#lgPicked', body);
    var sideChips = q('#lgSide', body);
    var navEl = q('#lgNav', body);
    var sharesEl = q('#lgShares', body);
    var amountEl = q('#lgAmount', body);
    var dateEl = q('#lgDate', body);
    var feeEl = q('#lgFee', body);
    var sumEl = q('#lgSumKpis', body);
    var holdListEl = q('#lgHoldList', body);
    var txListEl = q('#lgTxList', body);
    var quoteNoteEl = q('#lgQuoteNote', body);
    var txCountEl = q('#lgTxCount', body);

    if (dateEl) dateEl.value = todayStr();

    function renderPicked() {
      if (!pickedBox) return;
      if (!picked) {
        pickedBox.innerHTML = '<span class="t-sub">未选择基金：搜索选取，或直接输入 6 位基金代码后记录</span>';
        return;
      }
      pickedBox.innerHTML = '<div class="t-row"><div class="t-row-main"><div class="t-name">' + esc(picked.name) +
        '<small class="t-code">' + esc(picked.code) + '</small></div></div>' +
        '<div class="t-row-side"><button class="t-btn t-btn-mini" data-clear-picked>清除</button></div></div>';
    }
    function renderSide() {
      if (!sideChips) return;
      JYXT.chips(sideChips, [{ key: 'buy', label: '买入' }, { key: 'sell', label: '卖出' }], side, function (key) {
        side = key === 'sell' ? 'sell' : 'buy';
        renderSide();
      });
    }
    function syncFromAmount() {
      var nav = num(navEl && navEl.value);
      var amt = num(amountEl && amountEl.value);
      if (nav !== null && nav > 0 && amt !== null && sharesEl) sharesEl.value = String(round(amt / nav, 2));
    }
    function syncFromShares() {
      var nav = num(navEl && navEl.value);
      var sh = num(sharesEl && sharesEl.value);
      if (nav !== null && nav > 0 && sh !== null && amountEl) amountEl.value = String(round(sh * nav, 2));
    }

    if (searchInput && suggestEl) {
      JYXT.fundSearch(searchInput, suggestEl, function (pickedFund) {
        picked = { code: pickedFund.code, name: pickedFund.name };
        renderPicked();
        fetchFundQuotes([pickedFund.code]).then(function (res) {
          var quote = res.map[pickedFund.code];
          if (!quote || num(quote.nav) === null || !navEl) return;
          navEl.value = String(num(quote.nav));
          if (num(sharesEl && sharesEl.value) !== null) syncFromShares();
          else if (num(amountEl && amountEl.value) !== null) syncFromAmount();
        }).catch(function () { /* 拉不到净值时用户手填即可 */ });
      });
      searchInput.addEventListener('input', function () {
        if (picked && String(searchInput.value).indexOf(picked.code) < 0) {
          picked = null;
          renderPicked();
        }
      });
    }
    if (pickedBox) {
      pickedBox.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-clear-picked]');
        if (!btn) return;
        picked = null;
        if (searchInput) searchInput.value = '';
        renderPicked();
      });
    }
    if (sharesEl) sharesEl.addEventListener('input', syncFromShares);
    if (amountEl) amountEl.addEventListener('input', syncFromAmount);
    if (navEl) {
      navEl.addEventListener('input', function () {
        if (num(sharesEl && sharesEl.value) !== null) syncFromShares();
        else if (num(amountEl && amountEl.value) !== null) syncFromAmount();
      });
    }

    function addTx() {
      var code = picked ? picked.code : extractFundCode(searchInput && searchInput.value);
      var name = picked ? picked.name : (code ? '基金 ' + code : '');
      if (!code) { toast('请先搜索并选择基金'); return; }
      if (!/^\d{6}$/.test(code)) { toast('基金代码需为 6 位数字'); return; }
      var nav = num(navEl && navEl.value);
      var shares = num(sharesEl && sharesEl.value);
      var amount = num(amountEl && amountEl.value);
      if (nav === null || nav <= 0) { toast('请填写有效净值'); return; }
      if ((shares === null || shares <= 0) && (amount === null || amount <= 0)) { toast('请填写份额或金额'); return; }
      if (shares === null || shares <= 0) shares = round(amount / nav, 2);
      if (amount === null || amount <= 0) amount = round(shares * nav, 2);
      if (shares === null || shares <= 0 || amount === null || amount <= 0) { toast('份额或金额换算结果无效'); return; }
      var d = dateEl ? String(dateEl.value || '') : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) d = todayStr();
      var fee = num(feeEl && feeEl.value);
      if (fee === null || fee < 0) fee = 0;
      var txs = loadLedger();
      txs.push({
        id: uid(),
        code: code,
        name: name || code,
        side: side,
        nav: round(nav, 4),
        shares: round(shares, 2),
        amount: round(amount, 2),
        date: d,
        fee: round(fee, 4),
        createdAt: Date.now()
      });
      writeLS(LS_LEDGER, sortTxs(txs));
      toast(side === 'buy' ? '已记录一笔买入' : '已记录一笔卖出');
      if (navEl) navEl.value = '';
      if (sharesEl) sharesEl.value = '';
      if (amountEl) amountEl.value = '';
      renderAll();
    }

    function renderTxList(txs) {
      if (txCountEl) txCountEl.textContent = txs.length + ' 笔';
      if (!txListEl) return;
      if (!txs.length) {
        JYXT.empty(txListEl, { icon: '📝', title: '暂无交易流水', desc: '上方「记一笔」后会显示在这里' });
        return;
      }
      txListEl.innerHTML = txs.slice().reverse().map(function (t) {
        var isBuy = t.side === 'buy';
        var amount = num(t.amount) || 0;
        var feeAmt = amount * ((num(t.fee) || 0) / 100);
        var flow = isBuy ? -amount : amount;
        return JYXT.rowHTML({
          name: '<span class="t-badge ' + (isBuy ? 'up' : 'down') + '">' + (isBuy ? '买入' : '卖出') + '</span> ' + esc(t.name || t.code),
          code: t.code,
          meta: fmtDate(t.date) + ' · 净值 ' + nf(t.nav, 4) + ' · 份额 ' + nf(t.shares, 2) +
            '<br>金额 ' + money(t.amount) + ' · 费率 ' + nf(t.fee, 2) + '%（约 ' + money(feeAmt) + '）',
          side: '<span class="' + pctDir(flow) + '">' + signedMoney(flow) + '</span>',
          action: '<button class="t-btn t-btn-mini" data-del-tx="' + esc(txKey(t)) + '">删除</button>'
        });
      }).join('');
    }

    function renderPositions(data) {
      if (!sumEl || !holdListEl) return;
      if (!data.positions.length) {
        sumEl.innerHTML = '';
        JYXT.empty(holdListEl, {
          icon: '📒',
          title: '账本还是空的',
          desc: '用上方表单记下第一笔买入或卖出',
          actionText: '去记第一笔',
          onAction: function () { if (searchInput) searchInput.focus(); }
        });
        return;
      }
      var totalValue = 0;
      var totalCost = 0;
      var floating = 0;
      var realized = 0;
      data.positions.forEach(function (p) {
        var quote = quotes[p.code];
        p.price = quote && num(quote.nav) !== null ? num(quote.nav) : null;
        p.cost = p.shares * p.avgCost;
        p.value = p.shares * (p.price !== null ? p.price : p.avgCost);
        p.floating = p.value - p.cost;
        p.rate = p.cost > 0 ? (p.floating / p.cost) * 100 : null;
        totalValue += p.value;
        totalCost += p.cost;
        floating += p.floating;
        realized += p.realized;
      });
      var totalProfit = floating + realized;
      var totalRate = data.invested > 0 ? (totalProfit / data.invested) * 100 : null;
      sumEl.innerHTML = JYXT.kpis([
        { label: '总市值', value: money(totalValue) },
        { label: '持仓成本', value: money(totalCost) },
        { label: '浮动盈亏', value: signedMoney(floating), dir: pctDir(floating) },
        { label: '已实现盈亏', value: signedMoney(realized), dir: pctDir(realized) },
        { label: '总盈亏', value: signedMoney(totalProfit), dir: pctDir(totalProfit) },
        { label: '总收益率', value: totalRate === null ? '—' : signedPct(totalRate), dir: pctDir(totalRate) }
      ]);
      holdListEl.innerHTML = data.positions.map(function (p) {
        var quote = quotes[p.code];
        var title = (quote && quote.name) || p.name || p.code;
        var dir = pctDir(p.floating);
        var meta = '份额 ' + fmt(p.shares, 2) + ' · 成本 ' + fmt(p.avgCost, 4) +
          ' · 现价 ' + (p.price === null ? '—' : fmt(p.price, 4)) +
          '<br>市值 ' + money(p.value) + ' · 已实现 ' + signedMoney(p.realized);
        return JYXT.rowHTML({
          name: esc(title) + (p.shares <= 0 ? ' <span class="t-badge">已清仓</span>' : ''),
          code: p.code,
          meta: meta,
          side: '<span class="' + dir + '">' + signedMoney(p.floating) + '</span><span class="t-sub">' + (p.rate === null ? '' : signedPct(p.rate)) + '</span>',
          action: '<button class="t-btn t-btn-mini" data-open-fund="' + esc(p.code) + '">详情</button>',
          attrs: 'data-code="' + esc(p.code) + '" data-open-fund="' + esc(p.code) + '"'
        });
      }).join('');
    }

    function refreshPositions() {
      var data = computeLedger(sortTxs(loadLedger()));
      renderPositions(data);
      var codes = data.positions.map(function (p) { return p.code; });
      var seq = ++quoteSeq;
      if (quoteNoteEl && codes.length) quoteNoteEl.textContent = '正在获取最新净值…';
      fetchFundQuotes(codes).then(function (res) {
        if (seq !== quoteSeq) return;
        quotes = res.map || {};
        renderPositions(computeLedger(sortTxs(loadLedger())));
        if (!quoteNoteEl) return;
        if (!codes.length) { quoteNoteEl.textContent = '数据仅保存在本机浏览器'; return; }
        if (res.failed.length) {
          quoteNoteEl.textContent = '部分基金最新净值获取失败（' + res.failed.join('、') + '），市值暂按成本价估算。';
          return;
        }
        var navDate = '';
        data.positions.forEach(function (p) {
          if (!navDate && quotes[p.code] && quotes[p.code].navDate) navDate = quotes[p.code].navDate;
        });
        quoteNoteEl.textContent = '最新净值' + (navDate ? '（' + navDate + '）' : '') + '已更新 · 数据仅保存在本机浏览器';
      }).catch(function () {
        if (seq !== quoteSeq) return;
        renderPositions(computeLedger(sortTxs(loadLedger())));
        if (quoteNoteEl) quoteNoteEl.textContent = '最新净值获取失败，市值暂按成本价估算。';
      });
    }

    function renderAll() {
      var txs = sortTxs(loadLedger());
      renderTxList(txs);
      refreshPositions();
    }

    var addBtn = q('#lgAdd', body);
    if (addBtn) addBtn.addEventListener('click', addTx);
    var refreshBtn = q('#lgRefresh', body);
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
      toast('正在刷新最新净值…', 1200);
      refreshPositions();
    });
    var resetBtn = q('#lgReset', body);
    if (resetBtn) resetBtn.addEventListener('click', function () {
      picked = null;
      side = 'buy';
      if (searchInput) searchInput.value = '';
      if (navEl) navEl.value = '';
      if (sharesEl) sharesEl.value = '';
      if (amountEl) amountEl.value = '';
      if (dateEl) dateEl.value = todayStr();
      if (feeEl) feeEl.value = '0.15';
      renderPicked();
      renderSide();
    });
    var clearBtn = q('#lgClear', body);
    var clearArmed = false;
    var clearTimer = null;
    if (clearBtn) clearBtn.addEventListener('click', function () {
      if (!loadLedger().length) { toast('账本已经是空的'); return; }
      if (!clearArmed) {
        clearArmed = true;
        clearBtn.textContent = '再点一次确认清空';
        clearTimeout(clearTimer);
        clearTimer = setTimeout(function () {
          clearArmed = false;
          clearBtn.textContent = '清空账本';
        }, 4000);
        return;
      }
      clearArmed = false;
      clearTimeout(clearTimer);
      clearBtn.textContent = '清空账本';
      writeLS(LS_LEDGER, []);
      toast('账本已清空');
      renderAll();
    });
    if (holdListEl) {
      holdListEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-open-fund]');
        if (!btn) return;
        var code = btn.getAttribute('data-open-fund');
        if (code && JYXT.openFundSheet) JYXT.openFundSheet(code);
      });
    }
    if (txListEl) {
      txListEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-del-tx]');
        if (!btn) return;
        var key = btn.getAttribute('data-del-tx');
        writeLS(LS_LEDGER, sortTxs(loadLedger().filter(function (t) { return txKey(t) !== key; })));
        toast('已删除该笔流水');
        renderAll();
      });
    }

    renderPicked();
    renderSide();
    renderAll();
  }

  // ==================== 2. 策略提醒 ====================
  var alertsTimer = null;
  var evaluatingAlerts = false;
  var alertRuntime = {};

  function loadAlerts() {
    var arr = readLS(LS_ALERTS, []);
    if (!Array.isArray(arr)) return [];
    var out = [];
    arr.forEach(function (r) {
      if (!r || (r.type !== 'fear' && r.type !== 'fund')) return;
      if (r.op !== '>=' && r.op !== '<=') return;
      if (num(r.threshold) === null) return;
      var rule = r;
      rule.enabled = rule.enabled !== false;
      out.push(rule);
    });
    return out;
  }
  function alertLabel(rule) {
    if (rule.type === 'fear') return '恐贪指数 ' + rule.op + ' ' + numText(rule.threshold);
    return (rule.name || rule.code || '基金') + ' 收益 ' + rule.op + ' ' + numText(rule.threshold) + '%';
  }
  function ruleKey(rule) {
    if (!rule) return '';
    if (rule.id) return 'id:' + rule.id;
    return 'k:' + [rule.type, rule.code || '', rule.op, rule.threshold, rule.createdAt || ''].join('|');
  }

  function alertsShell() {
    return '' +
      '<div class="t-card">' +
        '<div class="t-card-head"><span class="t-title">新建提醒</span><span class="t-sub">本地规则 · 页面打开时检查</span></div>' +
        '<div class="t-body"><div class="t-form">' +
          '<div class="t-chips" id="alType"></div>' +
          '<div class="t-field hidden" id="alFundWrap"><label class="t-sub">基金</label>' +
            '<input class="t-input" id="alSearch" autocomplete="off" placeholder="搜索基金名称 / 代码">' +
            '<div class="t-suggest hidden" id="alSuggest"></div></div>' +
          '<div id="alPicked" class="hidden"></div>' +
          '<div class="t-fields">' +
            '<div class="t-field"><label class="t-sub">条件</label><select class="t-select" id="alOp"><option value="&gt;=">≥ 大于等于</option><option value="&lt;=">≤ 小于等于</option></select></div>' +
            '<div class="t-field"><label class="t-sub">阈值</label><input class="t-input" id="alThreshold" type="number" step="0.1" inputmode="decimal" placeholder="如 80"></div>' +
            '<div class="t-field hidden" id="alCostWrap"><label class="t-sub">成本净值（可选）</label><input class="t-input" id="alCost" type="number" min="0" step="0.0001" inputmode="decimal" placeholder="留空按当前净值"></div>' +
          '</div>' +
          '<div class="t-actions"><button class="t-btn t-btn-primary" id="alAdd">添加提醒</button></div>' +
          '<p class="t-note">恐贪阈值范围 0-100；基金收益阈值按「最新净值 ÷ 成本净值 - 1」计算，可填负数（如 -10 表示亏损 10%）。成本净值留空时按当前净值作为买入成本。</p>' +
        '</div></div>' +
      '</div>' +
      '<div class="t-card">' +
        '<div class="t-card-head"><span class="t-title">提醒规则</span><span class="t-sub">每 60 秒检查一次</span></div>' +
        '<div class="t-body"><div class="t-kpis" id="alKpis"></div><div class="t-list" id="alList"></div>' +
          '<div class="t-actions"><button class="t-btn t-btn-ghost" id="alCheck">立即检查</button></div>' +
          '<p class="t-note">仅在页面打开时本地检查并弹提示，不发送系统通知；同一规则同一天只提醒一次。</p></div>' +
      '</div>';
  }

  function mountAlerts(body) {
    if (!body) return;
    if (alertsTimer) { clearInterval(alertsTimer); alertsTimer = null; }
    var type = 'fear';
    var picked = null;
    body.innerHTML = alertsShell();

    var typeEl = q('#alType', body);
    var fundWrap = q('#alFundWrap', body);
    var searchInput = q('#alSearch', body);
    var suggestEl = q('#alSuggest', body);
    var pickedBox = q('#alPicked', body);
    var opEl = q('#alOp', body);
    var thresholdEl = q('#alThreshold', body);
    var costWrap = q('#alCostWrap', body);
    var costEl = q('#alCost', body);
    var addBtn = q('#alAdd', body);
    var listEl = q('#alList', body);
    var kpisEl = q('#alKpis', body);

    function renderPicked() {
      if (!pickedBox) return;
      if (!picked) {
        pickedBox.innerHTML = '<span class="t-sub">未选择基金</span>';
        return;
      }
      pickedBox.innerHTML = '<div class="t-row"><div class="t-row-main"><div class="t-name">' + esc(picked.name) +
        '<small class="t-code">' + esc(picked.code) + '</small></div></div>' +
        '<div class="t-row-side"><button class="t-btn t-btn-mini" data-clear-picked>清除</button></div></div>';
    }
    function renderType() {
      if (typeEl) {
        JYXT.chips(typeEl, [{ key: 'fear', label: '恐贪指数' }, { key: 'fund', label: '基金收益' }], type, function (key) {
          type = key === 'fund' ? 'fund' : 'fear';
          renderType();
        });
      }
      if (fundWrap) fundWrap.classList.toggle('hidden', type !== 'fund');
      if (costWrap) costWrap.classList.toggle('hidden', type !== 'fund');
      if (pickedBox) pickedBox.classList.toggle('hidden', type !== 'fund');
      if (thresholdEl) thresholdEl.placeholder = type === 'fear' ? '如 80' : '如 -10';
    }

    if (searchInput && suggestEl) {
      JYXT.fundSearch(searchInput, suggestEl, function (pickedFund) {
        picked = { code: pickedFund.code, name: pickedFund.name };
        renderPicked();
      });
      searchInput.addEventListener('input', function () {
        if (picked && String(searchInput.value).indexOf(picked.code) < 0) {
          picked = null;
          renderPicked();
        }
      });
    }
    if (pickedBox) {
      pickedBox.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-clear-picked]');
        if (!btn) return;
        picked = null;
        if (searchInput) searchInput.value = '';
        renderPicked();
      });
    }

    function commitAlert(partial) {
      var rule = { id: uid(), enabled: true, lastFiredAt: null, createdAt: Date.now(), name: '', code: '', costNav: null };
      for (var k in partial) {
        if (Object.prototype.hasOwnProperty.call(partial, k)) rule[k] = partial[k];
      }
      var list = loadAlerts();
      list.push(rule);
      writeLS(LS_ALERTS, list);
      toast('提醒规则已添加');
      if (thresholdEl) thresholdEl.value = '';
      if (costEl) costEl.value = '';
      renderList(list);
      evaluateAlerts(true);
    }

    function addAlert() {
      var threshold = num(thresholdEl && thresholdEl.value);
      if (threshold === null) { toast('请填写有效的阈值'); return; }
      var op = opEl && opEl.value === '<=' ? '<=' : '>=';
      if (type === 'fear') {
        if (threshold < 0 || threshold > 100) { toast('恐贪阈值需在 0-100 之间'); return; }
        commitAlert({ type: 'fear', name: '恐贪指数', op: op, threshold: round(threshold, 2) });
        return;
      }
      if (!picked) { toast('请先搜索并选择基金'); return; }
      var cost = num(costEl && costEl.value);
      if (cost !== null && !(cost > 0)) { toast('成本净值需大于 0'); return; }
      if (cost !== null) {
        commitAlert({ type: 'fund', code: picked.code, name: picked.name, op: op, threshold: round(threshold, 2), costNav: round(cost, 4) });
        return;
      }
      if (addBtn) addBtn.disabled = true;
      fetchFundQuotes([picked.code]).then(function (res) {
        if (addBtn) addBtn.disabled = false;
        var quote = res.map[picked.code];
        var nav = quote ? num(quote.nav) : null;
        if (nav === null || !(nav > 0)) { toast('暂时无法获取该基金净值，请填写成本净值后重试'); return; }
        commitAlert({ type: 'fund', code: picked.code, name: picked.name, op: op, threshold: round(threshold, 2), costNav: round(nav, 4) });
      }).catch(function () {
        if (addBtn) addBtn.disabled = false;
        toast('获取基金净值失败，请填写成本净值后重试');
      });
    }

    function renderList(rules) {
      if (kpisEl) {
        var enabledCount = 0;
        var hitCount = 0;
        rules.forEach(function (r) {
          if (r.enabled !== false) enabledCount += 1;
          var rt = alertRuntime[ruleKey(r)];
          if (rt && rt.hit) hitCount += 1;
        });
        kpisEl.innerHTML = JYXT.kpis([
          { label: '规则数', value: String(rules.length) },
          { label: '监听中', value: String(enabledCount) },
          { label: '当前命中', value: String(hitCount) }
        ]);
      }
      if (!listEl) return;
      if (!rules.length) {
        JYXT.empty(listEl, { icon: '🔔', title: '还没有提醒规则', desc: '在上方添加一条恐贪指数或基金收益提醒' });
        return;
      }
      listEl.innerHTML = rules.map(function (r) {
        var key = ruleKey(r);
        var rt = alertRuntime[key] || {};
        var isHit = !!rt.hit;
        var enabledFlag = r.enabled !== false;
        var cur = rt.current === null || rt.current === undefined ? null : rt.current;
        var curText = cur === null ? '—' : fmt(cur, 2) + (r.type === 'fear' ? '' : '%');
        var meta = '条件：' + (r.type === 'fear' ? '恐贪值 ' : '持有收益 ') + r.op + ' ' + numText(r.threshold, 2) +
          (r.type === 'fear' ? '' : '%');
        if (r.type === 'fund') meta += ' · 成本净值 ' + (num(r.costNav) === null ? '—' : fmt(r.costNav, 4));
        meta += '<br>当前 <span class="' + (isHit ? 'up' : '') + '">' + curText + '</span>';
        if (r.lastFiredAt) meta += ' · 上次触发 ' + esc(fmtDateTime(r.lastFiredAt));
        var side = isHit ? '<span class="t-badge high">已触发</span>' :
          (enabledFlag ? '<span class="t-badge low">监听中</span>' : '<span class="t-badge">已停用</span>');
        return JYXT.rowHTML({
          name: esc(r.name || (r.type === 'fear' ? '恐贪指数' : '基金 ' + (r.code || ''))),
          code: r.type === 'fund' ? r.code : '',
          meta: meta,
          side: side,
          action: '<button class="t-btn t-btn-mini" data-toggle-alert="' + esc(key) + '">' + (enabledFlag ? '停用' : '启用') + '</button>' +
            '<button class="t-btn t-btn-mini" data-del-alert="' + esc(key) + '">删除</button>',
          attrs: r.type === 'fund' && r.code ? 'data-code="' + esc(r.code) + '" data-open-fund="' + esc(r.code) + '"' : ''
        });
      }).join('');
    }

    function evaluateAlerts(silent) {
      var rules = loadAlerts();
      if (!rules.length) {
        renderList(rules);
        return;
      }
      if (evaluatingAlerts) return;
      var needFear = false;
      var codes = [];
      rules.forEach(function (r) {
        if (r.enabled === false) return;
        if (r.type === 'fear') needFear = true;
        else if (r.code && codes.indexOf(String(r.code)) < 0) codes.push(String(r.code));
      });
      if (!needFear && !codes.length) {
        renderList(rules);
        return;
      }
      evaluatingAlerts = true;
      var jobs = [
        needFear ? req('/api/snapshot').catch(function () { return null; }) : Promise.resolve(null),
        codes.length ? fetchFundQuotes(codes) : Promise.resolve({ map: {}, failed: [] })
      ];
      Promise.all(jobs).then(function (res) {
        var snap = res[0];
        var fgValue = null;
        if (snap) {
          var s = snap.snapshot ? snap.snapshot : snap;
          if (s && s.fearGreed) fgValue = num(s.fearGreed.value);
        }
        var quoteMap = (res[1] && res[1].map) || {};
        var today = dateKey(Date.now());
        var fired = [];
        rules.forEach(function (r) {
          var cur = null;
          if (r.type === 'fear') {
            cur = fgValue;
          } else if (r.type === 'fund') {
            var quote = quoteMap[r.code];
            var nav = quote ? num(quote.nav) : null;
            var cost = num(r.costNav);
            if (nav !== null && cost !== null && cost > 0) cur = ((nav / cost) - 1) * 100;
          }
          var rt = alertRuntime[ruleKey(r)] || (alertRuntime[ruleKey(r)] = {});
          rt.current = cur;
          rt.checkedAt = Date.now();
          var hit = false;
          if (r.enabled !== false && cur !== null) {
            var threshold = num(r.threshold);
            if (threshold !== null) hit = r.op === '>=' ? cur >= threshold : cur <= threshold;
          }
          rt.hit = hit;
          if (hit && dateKey(r.lastFiredAt) !== today) {
            r.lastFiredAt = Date.now();
            fired.push({ rule: r, current: cur });
          }
        });
        if (fired.length) {
          writeLS(LS_ALERTS, rules);
          if (fired.length === 1) {
            toast('提醒触发：' + alertLabel(fired[0].rule) + '，当前 ' + fmt(fired[0].current, 2) + (fired[0].rule.type === 'fear' ? '' : '%'));
          } else {
            toast(fired.length + ' 条提醒触发：' + fired.map(function (item) { return alertLabel(item.rule); }).join('、'));
          }
        }
        renderList(rules);
      }).catch(function (err) {
        renderList(loadAlerts());
        if (!silent) toast('提醒检查失败：' + ((err && err.message) || '网络异常'));
      }).then(function () {
        evaluatingAlerts = false;
      });
    }

    if (addBtn) addBtn.addEventListener('click', addAlert);
    var checkBtn = q('#alCheck', body);
    if (checkBtn) checkBtn.addEventListener('click', function () {
      toast('正在检查提醒规则…', 1200);
      evaluateAlerts(false);
    });
    if (listEl) {
      listEl.addEventListener('click', function (e) {
        var toggle = e.target.closest('[data-toggle-alert]');
        if (toggle) {
          var toggleKey = toggle.getAttribute('data-toggle-alert');
          var list = loadAlerts().map(function (r) {
            if (ruleKey(r) === toggleKey) r.enabled = r.enabled === false;
            return r;
          });
          writeLS(LS_ALERTS, list);
          renderList(list);
          toast('状态已更新');
          evaluateAlerts(true);
          return;
        }
        var del = e.target.closest('[data-del-alert]');
        if (del) {
          var delKey = del.getAttribute('data-del-alert');
          var left = loadAlerts().filter(function (r) { return ruleKey(r) !== delKey; });
          writeLS(LS_ALERTS, left);
          delete alertRuntime[delKey];
          renderList(left);
          toast('提醒已删除');
          return;
        }
        var openRow = e.target.closest('[data-open-fund]');
        if (openRow) {
          var openCode = openRow.getAttribute('data-open-fund');
          if (openCode && JYXT.openFundSheet) JYXT.openFundSheet(openCode);
        }
      });
    }

    renderType();
    renderPicked();
    renderList(loadAlerts());
    evaluateAlerts(true);
    alertsTimer = setInterval(function () {
      if (!isLive(body)) {
        clearInterval(alertsTimer);
        alertsTimer = null;
        return;
      }
      evaluateAlerts(true);
    }, ALERT_TICK_MS);
  }

  // ==================== 3. 组合回测 ====================
  var MAX_BACKTEST_ASSETS = 8;
  var BACKTEST_YEARS = [1, 2, 3, 5, 10, 15, 20];
  var BACKTEST_REBALANCE = [
    { key: 'monthly', label: '每月' },
    { key: 'quarterly', label: '每季度' },
    { key: 'halfyearly', label: '每半年' },
    { key: 'yearly', label: '每年' },
    { key: 'none', label: '不再平衡' }
  ];
  var BACKTEST_SAMPLES = [
    { type: 'fund', code: '110022', name: '易方达消费行业', label: '易方达消费', market: '' },
    { type: 'fund', code: '161725', name: '招商中证白酒', label: '招商白酒', market: '' },
    { type: 'stock', code: '600519', name: '贵州茅台', label: '贵州茅台', market: '沪A' },
    { type: 'stock', code: '00700', name: '腾讯控股', label: '腾讯控股', market: '港股' },
    { type: 'stock', code: 'AAPL', name: '苹果', label: '苹果', market: '美股' }
  ];
  var CHART_PORT = '#ff5b3a';
  var CHART_BENCH = '#2f7df6';
  var CHART_DD = '#e5433b';
  var CHART_DD_BENCH = '#8a94a6';

  function rebalanceText(key) {
    for (var i = 0; i < BACKTEST_REBALANCE.length; i++) {
      if (BACKTEST_REBALANCE[i].key === key) return BACKTEST_REBALANCE[i].label;
    }
    return '每季度';
  }
  function assetTypeBadge(type) {
    if (type === 'stock') return '<span class="t-badge mid">股票</span>';
    return '<span class="t-badge low">基金</span>';
  }

  function backtestAssetEditorHTML() {
    var yearsOpts = BACKTEST_YEARS.map(function (y) {
      return '<option value="' + y + '"' + (y === 3 ? ' selected' : '') + '>' + y + ' 年</option>';
    }).join('');
    var rebalOpts = BACKTEST_REBALANCE.map(function (r) {
      return '<option value="' + r.key + '"' + (r.key === 'quarterly' ? ' selected' : '') + '>' + r.label + '</option>';
    }).join('');
    var samples = BACKTEST_SAMPLES.map(function (s) {
      return '<button class="t-chip" data-bt-sample="1" data-type="' + esc(s.type) + '" data-code="' + esc(s.code) +
        '" data-name="' + esc(s.name) + '" data-market="' + esc(s.market || '') + '">' + esc(s.label) + '</button>';
    }).join('');
    return '' +
      '<div class="t-field"><label class="t-sub">添加基金（搜索）</label>' +
        '<input class="t-input" id="btFundSearch" autocomplete="off" placeholder="基金名称 / 代码">' +
        '<div class="t-suggest hidden" id="btFundSuggest"></div></div>' +
      '<div class="t-field"><label class="t-sub">添加股票 / ETF（搜索）</label>' +
        '<input class="t-input" id="btStockSearch" autocomplete="off" placeholder="股票名称 / 代码（A股 / 港股 / 美股）">' +
        '<div class="t-suggest hidden" id="btStockSuggest"></div></div>' +
      '<div class="t-list" id="btAssetList"></div>' +
      '<p class="t-note" id="btAssetSum">已选 0 / ' + MAX_BACKTEST_ASSETS + ' 个资产 · 权重合计 0%</p>' +
      '<div class="t-chips" id="btSamples"><span class="t-sub">快速添加：</span>' + samples + '</div>' +
      '<div class="t-fields">' +
        '<div class="t-field"><label class="t-sub">回测年限</label><select class="t-select" id="btYears">' + yearsOpts + '</select></div>' +
        '<div class="t-field"><label class="t-sub">再平衡</label><select class="t-select" id="btRebalance">' + rebalOpts + '</select></div>' +
        '<div class="t-field"><label class="t-sub">初始资金 (¥)</label><input class="t-input" id="btCapital" type="number" min="0" step="1000" inputmode="decimal" value="100000"></div>' +
      '</div>';
  }

  function backtestShell() {
    return '' +
      '<div class="t-card">' +
        '<div class="t-card-head"><span class="t-title">组合回测</span><span class="t-sub">基金 + 股票混合 · 最长 20 年</span></div>' +
        '<div class="t-body"><div class="t-form" id="btForm">' +
          backtestAssetEditorHTML() +
          '<div class="t-actions"><button class="t-btn t-btn-primary" id="btRun">开始回测</button><button class="t-btn t-btn-ghost" id="btClear">清空</button></div>' +
          '<p class="t-note">基金与 A股 / 港股 / 美股 可混合回测，最多 ' + MAX_BACKTEST_ASSETS + ' 个资产；权重合计按比例自动归一。股票用后复权日线、基金用净值，未计交易费用与税费。</p>' +
        '</div></div>' +
      '</div>' +
      '<div class="t-card">' +
        '<div class="t-card-head"><span class="t-title">回测结果</span><span class="t-sub" id="btResultSub">—</span></div>' +
        '<div class="t-body"><div id="btResult"></div></div>' +
      '</div>';
  }

  /** 基金 + 股票/ETF 混合资产编辑器（仅组合回测使用，portfolio-live 仍用 createWeightEditor） */
  function createBacktestAssetEditor(root, opts) {
    opts = opts || {};
    var maxCount = opts.max || MAX_BACKTEST_ASSETS;
    var assets = [];
    var customized = false;
    var fundInput = q('#btFundSearch', root);
    var fundSuggest = q('#btFundSuggest', root);
    var stockInput = q('#btStockSearch', root);
    var stockSuggest = q('#btStockSuggest', root);
    var listEl = q('#btAssetList', root);
    var sumEl = q('#btAssetSum', root);
    var samplesEl = q('#btSamples', root);
    var stockTimer = null;
    var stockSeq = 0;

    function assetKey(type, code) { return type + '|' + code; }
    function findAsset(type, code) {
      var key = assetKey(type, String(code));
      for (var i = 0; i < assets.length; i++) {
        if (assetKey(assets[i].type, assets[i].code) === key) return assets[i];
      }
      return null;
    }
    function equalize() {
      var n = assets.length;
      if (!n) return;
      var base = Math.round((100 / n) * 100) / 100;
      var acc = 0;
      for (var i = 0; i < n; i++) {
        if (i === n - 1) assets[i].weight = Math.round((100 - acc) * 100) / 100;
        else { assets[i].weight = base; acc += base; }
      }
    }
    function weightInputValue(v) {
      var n = num(v);
      return n === null ? '' : String(Math.round(n * 100) / 100);
    }
    function render() {
      if (listEl) {
        if (!assets.length) {
          listEl.innerHTML = '<div class="t-empty"><p>还没有添加资产</p><p class="t-sub">用上方搜索框添加基金或股票 / ETF</p></div>';
        } else {
          listEl.innerHTML = assets.map(function (a) {
            var meta = a.type === 'stock'
              ? ((a.market || '股票') + ' · 后复权日线')
              : '基金 · 按净值回测';
            return '<div class="t-row">' +
              '<div class="t-row-main">' +
                '<div class="t-name">' + assetTypeBadge(a.type) + ' ' + esc(a.name) +
                  '<small class="t-code">' + esc(String(a.code)) + '</small></div>' +
                '<div class="t-meta">' + esc(meta) + '</div>' +
              '</div>' +
              '<div class="t-row-side"><input class="t-input" data-asset-weight="' + esc(assetKey(a.type, a.code)) + '" type="number" min="0" max="100" step="1" inputmode="decimal" value="' + weightInputValue(a.weight) + '"><span class="t-sub">%</span></div>' +
              '<div class="t-row-action"><button class="t-btn t-btn-mini" data-remove-asset="' + esc(assetKey(a.type, a.code)) + '">删除</button></div>' +
            '</div>';
          }).join('');
        }
      }
      updateSum();
    }
    function readWeights() {
      if (listEl) {
        qa('[data-asset-weight]', listEl).forEach(function (inp) {
          var key = inp.getAttribute('data-asset-weight');
          for (var i = 0; i < assets.length; i++) {
            if (assetKey(assets[i].type, assets[i].code) === key) {
              var v = num(inp.value);
              assets[i].weight = (v === null || v < 0) ? 0 : v;
            }
          }
        });
      }
      return assets.map(function (a) { return num(a.weight) || 0; });
    }
    function updateSum() {
      var weights = readWeights();
      var sum = 0;
      for (var i = 0; i < weights.length; i++) sum += weights[i];
      if (sumEl) {
        sumEl.textContent = '已选 ' + assets.length + ' / ' + maxCount + ' 个资产 · 权重合计 ' + fmt(sum, 2) + '%' +
          (assets.length && Math.abs(sum - 100) > 0.005 ? ' · 提交时自动按比例归一' : '');
      }
      return sum;
    }
    function addAsset(a) {
      if (!a || !a.code || (a.type !== 'fund' && a.type !== 'stock')) return;
      if (assets.length >= maxCount) { toast('最多添加 ' + maxCount + ' 个资产'); return; }
      if (findAsset(a.type, a.code)) { toast('该资产已经添加过了'); return; }
      assets.push({
        code: String(a.code),
        name: a.name || String(a.code),
        type: a.type,
        market: a.market || '',
        weight: 0
      });
      if (!customized) {
        equalize();
      } else {
        var sumOthers = 0;
        for (var i = 0; i < assets.length - 1; i++) sumOthers += num(assets[i].weight) || 0;
        assets[assets.length - 1].weight = Math.max(0, Math.round((100 - sumOthers) * 100) / 100);
      }
      render();
    }
    function removeAsset(key) {
      var next = [];
      for (var i = 0; i < assets.length; i++) {
        if (assetKey(assets[i].type, assets[i].code) !== key) next.push(assets[i]);
      }
      assets = next;
      if (!customized) {
        equalize();
      } else if (assets.length) {
        var sum = 0;
        assets.forEach(function (a) { sum += num(a.weight) || 0; });
        if (sum > 0) assets.forEach(function (a) { a.weight = Math.round((a.weight / sum) * 10000) / 100; });
      }
      render();
    }
    function getAssets() {
      return assets.map(function (a) { return { code: a.code, name: a.name, type: a.type, market: a.market }; });
    }
    function normalizedWeights() {
      var raw = readWeights();
      if (!assets.length) return [];
      var sum = 0;
      raw.forEach(function (v) { sum += v; });
      var out;
      if (!(sum > 0)) {
        var base = Math.round((100 / assets.length) * 100) / 100;
        out = assets.map(function () { return base; });
        sum = base * assets.length;
      } else {
        out = raw.map(function (v) { return Math.round((v / sum) * 10000) / 100; });
      }
      var total = 0;
      out.forEach(function (v) { total += v; });
      if (out.length) out[out.length - 1] = Math.round((out[out.length - 1] + (100 - total)) * 100) / 100;
      return out;
    }
    function rawWeightSum() {
      var raw = readWeights();
      var sum = 0;
      raw.forEach(function (v) { sum += v; });
      return sum;
    }
    function reset() {
      assets = [];
      customized = false;
      if (fundInput) fundInput.value = '';
      if (stockInput) stockInput.value = '';
      render();
    }

    if (fundInput && fundSuggest) {
      JYXT.fundSearch(fundInput, fundSuggest, function (fund) {
        addAsset({ code: fund.code, name: fund.name, type: 'fund', market: '' });
        if (fundInput) fundInput.value = '';
      });
    }
    if (stockInput && stockSuggest) {
      stockInput.addEventListener('input', function () {
        var keyword = String(stockInput.value || '').trim();
        clearTimeout(stockTimer);
        if (!keyword) { stockSuggest.classList.add('hidden'); return; }
        stockTimer = setTimeout(function () {
          var seq = ++stockSeq;
          stockSuggest.innerHTML = '<div class="t-suggest-empty">搜索中…</div>';
          stockSuggest.classList.remove('hidden');
          req('/api/stock/search?key=' + encodeURIComponent(keyword) + '&limit=10').then(function (data) {
            if (seq !== stockSeq) return;
            if (data && data.ok === false) {
              stockSuggest.innerHTML = '<div class="t-suggest-empty">' + esc(data.error || '股票搜索暂不可用') + '</div>';
              return;
            }
            var items = data && Array.isArray(data.items) ? data.items : [];
            var picks = items.slice(0, 10).filter(function (it) { return it && it.code; });
            if (!picks.length) {
              stockSuggest.innerHTML = '<div class="t-suggest-empty">没有匹配的股票 / ETF</div>';
              return;
            }
            stockSuggest.innerHTML = picks.map(function (it) {
              var market = it.market || it.type || '';
              return '<button class="t-suggest-item" data-stock-pick="1" data-code="' + esc(it.code) +
                '" data-name="' + esc(it.name || it.code) + '" data-market="' + esc(market) + '">' +
                '<span>' + esc(it.name || it.code) + '</span><small>' + esc(it.code || '') +
                (market ? ' · ' + esc(market) : '') + '</small></button>';
            }).join('');
          }).catch(function (err) {
            if (seq !== stockSeq) return;
            stockSuggest.innerHTML = '<div class="t-suggest-empty">搜索失败：' + esc((err && err.message) || '网络异常') + '</div>';
          });
        }, 250);
      });
      stockSuggest.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-stock-pick]');
        if (!btn) return;
        addAsset({
          code: btn.getAttribute('data-code'),
          name: btn.getAttribute('data-name'),
          market: btn.getAttribute('data-market'),
          type: 'stock'
        });
        if (stockInput) stockInput.value = '';
        stockSuggest.classList.add('hidden');
      });
      document.addEventListener('click', function (e) {
        if (!(stockInput.contains(e.target) || stockSuggest.contains(e.target))) stockSuggest.classList.add('hidden');
      });
    }
    if (listEl) {
      listEl.addEventListener('input', function (e) {
        var inp = e.target.closest('[data-asset-weight]');
        if (!inp) return;
        customized = true;
        updateSum();
      });
      listEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-remove-asset]');
        if (btn) removeAsset(btn.getAttribute('data-remove-asset'));
      });
    }
    if (samplesEl) {
      samplesEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-bt-sample]');
        if (!btn) return;
        addAsset({
          code: btn.getAttribute('data-code'),
          name: btn.getAttribute('data-name'),
          type: btn.getAttribute('data-type'),
          market: btn.getAttribute('data-market')
        });
      });
    }
    render();
    return {
      add: addAsset,
      reset: reset,
      getAssets: getAssets,
      getWeights: normalizedWeights,
      getRawSum: rawWeightSum,
      count: function () { return assets.length; },
      max: maxCount
    };
  }

  function mountBacktest(body) {
    if (!body) return;
    body.innerHTML = backtestShell();
    var formEl = q('#btForm', body);
    var resultEl = q('#btResult', body);
    var resultSub = q('#btResultSub', body);
    var capitalEl = q('#btCapital', body);
    var yearsEl = q('#btYears', body);
    var rebalanceEl = q('#btRebalance', body);
    var runBtn = q('#btRun', body);
    var clearBtn = q('#btClear', body);
    var editor = createBacktestAssetEditor(formEl, { max: MAX_BACKTEST_ASSETS });
    var busy = false;
    var runSeq = 0;

    function showPlaceholder() {
      if (resultSub) resultSub.textContent = '—';
      if (resultEl) {
        JYXT.empty(resultEl, { icon: '📈', title: '还没有回测结果', desc: '添加基金或股票 / ETF 后点击「开始回测」' });
      }
    }
    function setBusy(flag) {
      busy = flag;
      if (runBtn) {
        runBtn.disabled = flag;
        runBtn.textContent = flag ? '回测中…' : '开始回测';
      }
      if (clearBtn) clearBtn.disabled = flag;
    }

    function runBacktest() {
      if (!resultEl || busy) return;
      var assets = editor.getAssets();
      if (!assets.length) { toast('请先添加至少 1 个资产（基金或股票）'); return; }
      var rawSum = editor.getRawSum();
      if (!(rawSum > 0)) { toast('请设置权重，权重合计不能为 0'); return; }
      var capital = num(capitalEl && capitalEl.value);
      if (capital === null || !(capital > 0)) { toast('请填写有效的初始资金'); return; }
      var weights = editor.getWeights();
      var years = yearsEl ? String(yearsEl.value || '3') : '3';
      var rebalance = rebalanceEl ? String(rebalanceEl.value || 'quarterly') : 'quarterly';
      var codes = assets.map(function (a) { return a.code; }).join(',');
      var types = assets.map(function (a) { return a.type; }).join(',');
      var url = '/api/portfolio/backtest?codes=' + encodeURIComponent(codes) +
        '&types=' + encodeURIComponent(types) +
        '&weights=' + encodeURIComponent(weights.join(',')) +
        '&years=' + encodeURIComponent(years) +
        '&rebalance=' + encodeURIComponent(rebalance) +
        '&capital=' + encodeURIComponent(String(Math.round(capital)));
      var seq = ++runSeq;
      setBusy(true);
      JYXT.loading(resultEl, '正在回测 ' + assets.length + ' 个资产 · ' + years + ' 年，首次加载可能 10-30 秒…');
      if (resultSub) resultSub.textContent = '回测中…';
      req(url).then(function (data) {
        if (seq !== runSeq) return;
        setBusy(false);
        if (!data || data.ok === false || !data.result) {
          if (resultSub) resultSub.textContent = '—';
          JYXT.errorBox(resultEl, (data && (data.error || data.note)) || '回测服务暂不可用', function () { runBacktest(); });
          return;
        }
        renderResult(data.result, capital, rebalance);
      }).catch(function (err) {
        if (seq !== runSeq) return;
        setBusy(false);
        if (resultSub) resultSub.textContent = '—';
        JYXT.errorBox(resultEl, (err && err.message) || '回测请求失败', function () { runBacktest(); });
      });
    }

    function normalizeCurve(list) {
      var out = [];
      (Array.isArray(list) ? list : []).forEach(function (p) {
        if (!p) return;
        var t = num(p.t);
        var v = num(p.v);
        if (t !== null && v !== null) out.push({ t: t, v: (v - 1) * 100 });
      });
      return out;
    }
    function plainPoints(list) {
      var out = [];
      (Array.isArray(list) ? list : []).forEach(function (p) {
        if (!p) return;
        var t = num(p.t);
        var v = num(p.v);
        if (t !== null && v !== null) out.push({ t: t, v: v });
      });
      return out;
    }

    function renderResult(result, submittedCapital, submittedRebalance) {
      if (!resultEl) return;
      var metrics = result.metrics || {};
      var items = Array.isArray(result.items) ? result.items : [];
      var capital = num(result.capital);
      if (capital === null) capital = num(submittedCapital);
      var total = num(metrics.totalReturn);
      var bench = num(metrics.benchmarkReturn);
      var maxDd = num(metrics.maxDrawdown);
      var rebalanceKey = result.rebalance || submittedRebalance || 'quarterly';
      var startDate = fmtDate(result.startDate);
      var endDate = fmtDate(result.endDate);
      if (resultSub) resultSub.textContent = startDate + ' ~ ' + endDate + ' · ' + rebalanceText(rebalanceKey);
      var curvePoints = normalizeCurve(result.curve);
      var benchPoints = normalizeCurve(result.benchmark);
      var html = JYXT.kpis([
        { label: '总收益', value: total === null ? '—' : signedPct(total), dir: pctDir(total) },
        { label: '年化收益', value: num(metrics.annualized) === null ? '—' : signedPct(metrics.annualized), dir: pctDir(metrics.annualized) },
        { label: '最大回撤', value: maxDd === null ? '—' : fmt(maxDd, 2) + '%', dir: maxDd === null ? '' : 'down' },
        { label: '年化波动', value: num(metrics.volatility) === null ? '—' : fmt(metrics.volatility, 2) + '%' },
        { label: '夏普比率', value: num(metrics.sharpe) === null ? '—' : fmt(metrics.sharpe, 2) },
        { label: '沪深300基准收益', value: bench === null ? '—' : signedPct(bench), dir: pctDir(bench) }
      ]);
      var legend = '<span class="t-legend-item"><i class="t-dot" style="background:' + CHART_PORT + '"></i>策略</span>';
      if (benchPoints.length >= 2) {
        legend += '<span class="t-legend-item"><i class="t-dot" style="background:' + CHART_BENCH + '"></i>沪深300</span>';
      }
      legend += '<span class="t-legend-item">' + esc(startDate) + ' ~ ' + esc(endDate) + '</span>' +
        '<span class="t-legend-item">初始资金 ' + money(capital) + '</span>' +
        '<span class="t-legend-item">再平衡：' + esc(rebalanceText(rebalanceKey)) + '</span>';
      html += '<div class="t-legend">' + legend + '</div>';
      html += JYXT.lineChart([
        { name: '策略', points: curvePoints, color: CHART_PORT, fill: true },
        { name: '沪深300', points: benchPoints, color: CHART_BENCH }
      ], { height: 180, percent: true });
      var ddPoints = plainPoints(result.drawdown);
      var ddBenchPoints = plainPoints(result.benchmarkDrawdown);
      if (ddPoints.length >= 2 || ddBenchPoints.length >= 2) {
        var ddLegend = '';
        if (ddPoints.length >= 2) ddLegend += '<span class="t-legend-item"><i class="t-dot" style="background:' + CHART_DD + '"></i>组合回撤</span>';
        if (ddBenchPoints.length >= 2) ddLegend += '<span class="t-legend-item"><i class="t-dot" style="background:' + CHART_DD_BENCH + '"></i>沪深300回撤</span>';
        html += '<div class="t-legend">' + ddLegend + '</div>';
        html += JYXT.lineChart([
          { name: '组合回撤', points: ddPoints, color: CHART_DD, fill: true },
          { name: '沪深300回撤', points: ddBenchPoints, color: CHART_DD_BENCH }
        ], { height: 128, percent: true });
      }
      if (items.length) {
        var rows = items.map(function (it) {
          var type = it.type === 'stock' ? 'stock' : 'fund';
          var weight = num(it.weight);
          var own = num(it.ownReturn);
          return '<tr>' +
            '<td>' + esc(it.name || it.code || '—') + '<br><small class="t-code">' + esc(it.code || '') + '</small></td>' +
            '<td>' + assetTypeBadge(type) + '</td>' +
            '<td>' + (weight === null ? '—' : fmt(weight, 2) + '%') + '</td>' +
            '<td class="' + pctDir(own) + '">' + (own === null ? '—' : signedPct(own)) + '</td>' +
          '</tr>';
        }).join('');
        html += '<div class="t-table-wrap"><table class="t-table"><thead><tr><th>资产</th><th>类型</th><th>目标权重</th><th>区间收益</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
      if (result.note) html += '<p class="t-note">' + esc(result.note) + '</p>';
      html += '<p class="t-note">历史回测不代表未来收益；股票用后复权日线、基金用净值，未计交易费用与税费。</p>';
      resultEl.innerHTML = html;
    }

    if (runBtn) runBtn.addEventListener('click', runBacktest);
    if (clearBtn) clearBtn.addEventListener('click', function () {
      if (busy) return;
      editor.reset();
      if (capitalEl) capitalEl.value = '100000';
      if (yearsEl) yearsEl.value = '3';
      if (rebalanceEl) rebalanceEl.value = 'quarterly';
      showPlaceholder();
    });
    showPlaceholder();
  }

  // ==================== 4. 组合实盘 ====================
  function liveShell() {
    return '' +
      '<div class="t-card">' +
        '<div class="t-card-head"><span class="t-title">新建组合</span><span class="t-sub">模拟持仓 · 本机保存</span></div>' +
        '<div class="t-body"><div class="t-form" id="lvForm">' +
          '<div class="t-fields">' +
            '<div class="t-field"><label class="t-sub">组合名称</label><input class="t-input" id="lvName" autocomplete="off" placeholder="如 稳健组合"></div>' +
            '<div class="t-field"><label class="t-sub">初始资金 (¥)</label><input class="t-input" id="lvCapital" type="number" min="0" step="100" inputmode="decimal" value="100000"></div>' +
          '</div>' +
          weightEditorHTML() +
          '<div class="t-actions"><button class="t-btn t-btn-primary" id="lvCreate">创建组合</button><button class="t-btn t-btn-ghost" id="lvReset">重置</button></div>' +
          '<p class="t-note">创建时按当前最新净值（T-1）作为买入净值，份额 = 初始资金 × 权重 ÷ 买入净值。模拟组合，仅本机保存，不涉及真实交易。</p>' +
        '</div></div>' +
      '</div>' +
      '<div class="t-card">' +
        '<div class="t-card-head"><span class="t-title">我的组合</span><span class="t-sub">按最新净值估值（T-1）</span></div>' +
        '<div class="t-body"><div class="t-kpis" id="lvKpis"></div><div id="lvList"></div>' +
          '<p class="t-note" id="lvNote">模拟组合，仅本机保存，按最新净值估值（T-1）。</p>' +
          '<div class="t-actions"><button class="t-btn t-btn-ghost" id="lvRefresh">刷新净值</button></div></div>' +
      '</div>';
  }

  function mountLive(body) {
    if (!body) return;
    body.innerHTML = liveShell();
    var formEl = q('#lvForm', body);
    var editor = createWeightEditor(formEl, { min: 2, max: 5 });
    var listEl = q('#lvList', body);
    var kpisEl = q('#lvKpis', body);
    var noteEl = q('#lvNote', body);
    var nameEl = q('#lvName', body);
    var capitalEl = q('#lvCapital', body);
    var createBtn = q('#lvCreate', body);
    var resetBtn = q('#lvReset', body);
    var quotes = {};
    var liveSeq = 0;
    var armDelete = {};

    function loadPortfolios() {
      var arr = readLS(LS_PORTFOLIOS, []);
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (p) { return p && p.id && Array.isArray(p.funds); });
    }

    function paint(list, quoteMap) {
      if (!listEl) return;
      var sections = [];
      var totalCapital = 0;
      var totalValue = 0;
      list.forEach(function (portfolio) {
        var capital = num(portfolio.capital) || 0;
        totalCapital += capital;
        var funds = (Array.isArray(portfolio.funds) ? portfolio.funds : []).filter(function (f) {
          return f && f.code;
        });
        var rows = funds.map(function (f) {
          var quote = quoteMap[f.code];
          var nav = quote && num(quote.nav) !== null ? num(quote.nav) : num(f.buyNav);
          var shares = num(f.shares) || 0;
          return { fund: f, nav: nav, shares: shares, value: nav !== null ? shares * nav : shares * (num(f.buyNav) || 0) };
        });
        var portfolioValue = 0;
        rows.forEach(function (r) { portfolioValue += r.value; });
        totalValue += portfolioValue;
        var profit = portfolioValue - capital;
        var rate = capital > 0 ? (profit / capital) * 100 : null;
        var driftWarn = false;
        var rowsHTML = rows.map(function (r) {
          var curWeight = portfolioValue > 0 ? (r.value / portfolioValue) * 100 : null;
          var target = num(r.fund.weight);
          var drift = curWeight === null || target === null ? null : curWeight - target;
          if (drift !== null && Math.abs(drift) >= DRIFT_WARN) driftWarn = true;
          var badge = '';
          if (drift !== null && Math.abs(drift) >= DRIFT_WARN) {
            badge = '<span class="t-badge mid">' + (drift > 0 ? '建议减仓' : '建议加仓') + '</span>';
          }
          return JYXT.rowHTML({
            name: esc(r.fund.name || r.fund.code),
            code: r.fund.code,
            meta: '目标 ' + (target === null ? '—' : fmt(target, 2) + '%') +
              ' · 买入净值 ' + (num(r.fund.buyNav) === null ? '—' : fmt(r.fund.buyNav, 4)) +
              '<br>现价 ' + (r.nav === null ? '—' : fmt(r.nav, 4)) +
              ' · 市值 ' + money(r.value),
            side: '<span>当前 ' + (curWeight === null ? '—' : fmt(curWeight, 2) + '%') + '</span>' +
              '<span class="t-sub">漂移 ' + (drift === null ? '—' : signedPct(drift)) + '</span>' + badge,
            action: '<button class="t-btn t-btn-mini" data-open-fund="' + esc(r.fund.code) + '">详情</button>',
            attrs: 'data-code="' + esc(r.fund.code) + '" data-open-fund="' + esc(r.fund.code) + '"'
          });
        }).join('');
        sections.push('<div class="t-section">' +
          '<div class="t-section-title">' + esc(portfolio.name || '模拟组合') +
            '<span class="t-sub">创建于 ' + esc(fmtDate(portfolio.createdAt)) + ' · 初始资金 ' + money(capital) + '</span></div>' +
          JYXT.kpis([
            { label: '总市值', value: money(portfolioValue) },
            { label: '总成本', value: money(capital) },
            { label: '盈亏', value: signedMoney(profit), dir: pctDir(profit) },
            { label: '收益率', value: rate === null ? '—' : signedPct(rate), dir: pctDir(rate) }
          ]) +
          '<div class="t-list">' + rowsHTML + '</div>' +
          (driftWarn ? '<p class="t-note">部分基金权重漂移超过 ' + DRIFT_WARN + '%，可考虑再平衡。</p>' : '') +
          '<div class="t-actions"><button class="t-btn t-btn-ghost" data-del-portfolio="' + esc(portfolio.id) + '">删除组合</button></div>' +
        '</div>');
      });
      if (kpisEl) {
        var profitAll = totalValue - totalCapital;
        var rateAll = totalCapital > 0 ? (profitAll / totalCapital) * 100 : null;
        kpisEl.innerHTML = JYXT.kpis([
          { label: '组合数', value: String(list.length) },
          { label: '总投入', value: money(totalCapital) },
          { label: '总市值', value: money(totalValue) },
          { label: '总盈亏', value: signedMoney(profitAll), dir: pctDir(profitAll) },
          { label: '总收益率', value: rateAll === null ? '—' : signedPct(rateAll), dir: pctDir(rateAll) }
        ]);
      }
      listEl.innerHTML = sections.join('');
    }

    function renderPortfolios() {
      var list = loadPortfolios();
      if (!listEl) return;
      if (!list.length) {
        if (kpisEl) kpisEl.innerHTML = '';
        JYXT.empty(listEl, { icon: '💼', title: '还没有模拟组合', desc: '填写上方表单创建第一个模拟组合' });
        if (noteEl) noteEl.textContent = '模拟组合，仅本机保存，按最新净值估值（T-1）。';
        return;
      }
      var codes = [];
      list.forEach(function (p) {
        p.funds.forEach(function (f) {
          if (f && f.code && codes.indexOf(String(f.code)) < 0) codes.push(String(f.code));
        });
      });
      var seq = ++liveSeq;
      paint(list, quotes);
      fetchFundQuotes(codes).then(function (res) {
        if (seq !== liveSeq) return;
        quotes = res.map || {};
        paint(list, quotes);
        if (!noteEl) return;
        if (res.failed.length) noteEl.textContent = '部分基金最新净值获取失败（' + res.failed.join('、') + '），暂按买入净值估算。';
        else noteEl.textContent = '模拟组合，仅本机保存，按最新净值估值（T-1）。';
      }).catch(function () {
        if (seq !== liveSeq) return;
        paint(list, quotes);
        if (noteEl) noteEl.textContent = '最新净值获取失败，暂按买入净值估算。';
      });
    }

    function createPortfolio() {
      var funds = editor.getFunds();
      if (!funds || funds.length < 2) { toast('请至少添加 2 只基金'); return; }
      var capital = num(capitalEl && capitalEl.value);
      if (capital === null || !(capital > 0)) { toast('请填写有效的初始资金'); return; }
      var name = String((nameEl && nameEl.value) || '').trim() || ('模拟组合 ' + todayStr());
      var weights = editor.getWeights();
      if (createBtn) createBtn.disabled = true;
      fetchFundQuotes(funds.map(function (f) { return f.code; })).then(function (res) {
        if (createBtn) createBtn.disabled = false;
        var missing = [];
        var items = [];
        funds.forEach(function (f, i) {
          var quote = res.map[f.code];
          var nav = quote ? num(quote.nav) : null;
          if (nav === null || !(nav > 0)) { missing.push(f.name || f.code); return; }
          var weight = num(weights[i]);
          if (weight === null || weight < 0) weight = 0;
          items.push({
            code: f.code,
            name: fundNameOf(quote, f.name) || f.code,
            weight: round(weight, 2),
            buyNav: round(nav, 4),
            shares: round((capital * weight) / 100 / nav, 2)
          });
        });
        if (missing.length) {
          toast('以下基金未获取到最新净值，无法创建：' + missing.join('、'));
          return;
        }
        var list = loadPortfolios();
        list.push({
          id: uid(),
          name: name,
          createdAt: Date.now(),
          capital: round(capital, 2),
          funds: items
        });
        writeLS(LS_PORTFOLIOS, list);
        toast('组合已创建：' + name);
        editor.reset();
        if (nameEl) nameEl.value = '';
        if (capitalEl) capitalEl.value = '100000';
        renderPortfolios();
      }).catch(function (err) {
        if (createBtn) createBtn.disabled = false;
        toast('创建失败：' + ((err && err.message) || '网络异常'));
      });
    }

    if (createBtn) createBtn.addEventListener('click', createPortfolio);
    var refreshBtn = q('#lvRefresh', body);
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
      toast('正在刷新最新净值…', 1200);
      renderPortfolios();
    });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      editor.reset();
      if (nameEl) nameEl.value = '';
      if (capitalEl) capitalEl.value = '100000';
    });
    if (listEl) {
      listEl.addEventListener('click', function (e) {
        var open = e.target.closest('[data-open-fund]');
        if (open) {
          var code = open.getAttribute('data-open-fund');
          if (code && JYXT.openFundSheet) JYXT.openFundSheet(code);
          return;
        }
        var del = e.target.closest('[data-del-portfolio]');
        if (!del) return;
        var id = del.getAttribute('data-del-portfolio');
        if (!armDelete[id]) {
          armDelete[id] = true;
          del.textContent = '再点一次确认删除';
          setTimeout(function () {
            armDelete[id] = false;
            var again = null;
            qa('[data-del-portfolio]', listEl).forEach(function (b) {
              if (b.getAttribute('data-del-portfolio') === id) again = b;
            });
            if (again) again.textContent = '删除组合';
          }, 4000);
          return;
        }
        armDelete[id] = false;
        var left = loadPortfolios().filter(function (p) { return String(p.id) !== String(id); });
        writeLS(LS_PORTFOLIOS, left);
        toast('组合已删除');
        renderPortfolios();
      });
    }

    renderPortfolios();
  }

  // ==================== 注册 4 个工具 ====================
  JYXT.register('fund-ledger', {
    title: '基金账本',
    category: 'track',
    icon: '📒',
    order: 1,
    mount: mountLedger
  });
  JYXT.register('strategy-alerts', {
    title: '策略提醒',
    category: 'track',
    icon: '🔔',
    order: 2,
    mount: mountAlerts
  });
  JYXT.register('portfolio-backtest', {
    title: '组合回测',
    category: 'track',
    icon: '📈',
    order: 3,
    mount: mountBacktest
  });
  JYXT.register('portfolio-live', {
    title: '组合实盘',
    category: 'track',
    icon: '💼',
    order: 4,
    mount: mountLive
  });
})();
