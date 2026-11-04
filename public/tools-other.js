/* 韭研 · 工具中心 —— 「其他工具」模块（tools-other.js）
 * 4 个工具：
 *   1) manager-score 大佬评分      GET /api/manager/score?code=
 *   2) manager-pk    大佬PK        GET /api/manager/compare?codes=a,b
 *   3) stock-pick    牛人选股      GET /api/stock/pick?limit=10
 *   4) dca-calc      定投计算     纯前端（定投复利 / 一次性复利 / 赎回费）
 * 依赖 public/tools.js 暴露的 window.JYXT；JYXT 不存在时直接返回。
 * 原生 JS、零依赖、无外链；mount 每次打开工具时调用。
 */
(function () {
  'use strict';

  var JYXT = window.JYXT;
  if (!JYXT) { return; }

  var esc = JYXT.esc, fmt = JYXT.fmt, fmtPct = JYXT.fmtPct, pctDir = JYXT.pctDir;
  var fmtDate = JYXT.fmtDate, fmtWan = JYXT.fmtWan;
  var api = JYXT.api, toast = JYXT.toast, storage = JYXT.storage;

  // ==================== 通用小工具 ====================
  // 注意：JYXT.num(null) 会得到 0（Number(null)===0），这里自行实现，null 一律视为缺失
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function fmtOr(v, digits) {
    return num(v) === null ? '—' : fmt(v, digits === null || digits === undefined ? 2 : digits);
  }

  function pctOr(v) {
    return num(v) === null ? '—' : fmtPct(v);
  }

  function wanOr(v) {
    return num(v) === null ? '—' : fmtWan(v);
  }

  function clampNum(v, min, max, fallback) {
    if (v === null || v === undefined) return fallback;
    if (typeof v === 'string' && v.trim() === '') return fallback;
    var n = num(v);
    if (n === null) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function kpiDir(v) {
    var n = num(v);
    if (n === null) return '';
    return n > 0 ? 'up' : (n < 0 ? 'down' : '');
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

  // 经理任职年限 / 管理规模等可能已是可读字符串（如「5年又123天」「123.45亿元」）
  function sizeText(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'string') return v;
    var n = num(v);
    if (n === null) return '—';
    return fmtWan(n);
  }

  function starText(v) {
    var n = num(v);
    if (n === null) return '—';
    var k = Math.max(0, Math.min(5, Math.round(n)));
    var s = '';
    for (var i = 0; i < 5; i++) s += i < k ? '★' : '☆';
    return s;
  }

  // 股票总市值：接口口径为「亿元」；若上游给的是「元」也能兼容
  function capText(v) {
    var n = num(v);
    if (n === null) return '—';
    if (Math.abs(n) >= 100000000) return fmtWan(n);
    return fmt(n, 2) + ' 亿';
  }

  function badgeCls(score) {
    var n = num(score);
    if (n === null) return '';
    if (n >= 70) return 'up';
    if (n >= 60) return 'mid';
    return 'down';
  }

  function gradeOf(score) {
    var n = num(score);
    if (n === null) return '—';
    if (n >= 80) return 'A';
    if (n >= 70) return 'B';
    if (n >= 60) return 'C';
    return 'D';
  }

  function adviceOf(score) {
    var n = num(score);
    if (n === null) return { grade: '—', text: '数据不足，暂时无法给出结论，请稍后再试。' };
    if (n >= 80) return { grade: '优秀', text: '经理经验、业绩与风控综合表现突出，可作为长期配置候选，仍需关注市场波动。' };
    if (n >= 70) return { grade: '良好', text: '综合表现较好，适合作为组合中的重要持仓，建议留意回撤控制。' };
    if (n >= 60) return { grade: '一般', text: '表现中规中矩，建议结合自身风险偏好与基金风格判断是否参与。' };
    return { grade: '谨慎', text: '综合评分偏低，建议谨慎参与，进一步了解经理风格与历史回撤情况。' };
  }

  // ==================== 1. 大佬评分 ====================
  function renderManagerScore(el, data) {
    var mgr = data.manager || {};
    var fund = data.fund || {};
    var dims = Array.isArray(data.dims) ? data.dims : [];
    var score = num(data.score);
    var grade = data.grade || gradeOf(score);

    var metaParts = [];
    if (fund.name) metaParts.push(fund.name);
    metaParts.push('任职 ' + sizeText(mgr.workTime));
    metaParts.push('管理规模 ' + sizeText(mgr.fundSize));

    var headHTML = '<div class="t-list">' +
      '<div class="t-row">' +
        '<div class="t-row-main">' +
          '<div class="t-name">' + esc(mgr.name || '—') + '<small class="t-code">' + esc(fund.code || '') + '</small></div>' +
          '<div class="t-meta muted sm">' + esc(metaParts.join(' · ')) + '</div>' +
        '</div>' +
        '<div class="t-row-side"><b>' + esc(starText(mgr.star)) + '</b></div>' +
      '</div>' +
    '</div>';

    var kpiHTML = JYXT.kpis([
      { label: '综合评分', value: score === null ? '—' : fmt(score, 2), dir: score === null ? '' : (score >= 70 ? 'up' : score < 60 ? 'down' : '') },
      { label: '评级', value: '<span class="t-badge ' + badgeCls(score) + '">' + esc(grade) + '</span>', raw: true },
      { label: '经理星级', value: starText(mgr.star) },
      { label: '任职年限', value: sizeText(mgr.workTime) },
      { label: '管理规模', value: sizeText(mgr.fundSize) }
    ]);

    var dimsHTML = '';
    if (dims.length) {
      dimsHTML = '<div class="t-section"><div class="t-section-title">五维评分</div>' + dims.map(function (d) {
        if (!d) return '';
        var s = clampNum(d.score, 0, 100, 0);
        return '<div class="t-row">' +
            '<div class="t-row-main">' +
              '<div class="t-name">' + esc(d.label || d.key || '—') + '</div>' +
              '<div class="t-meta muted sm">' + esc(d.desc || '') + '</div>' +
            '</div>' +
            '<div class="t-row-side"><b>' + fmtOr(d.score, 1) + '</b></div>' +
          '</div>' +
          '<div class="t-progress"><i style="width:' + s.toFixed(1) + '%"></i></div>';
      }).join('') + '</div>';
    }

    var adv = adviceOf(score);
    var noteHTML = '<div class="t-note"><b>结论：' + esc(adv.grade) + '</b><br>' + esc(adv.text) +
      '<br><span class="muted sm">' +
      (data.updatedAt ? '数据更新于 ' + esc(fmtDate(data.updatedAt)) + '；' : '') +
      '重新搜索可切换基金，评分仅供参考。</span></div>';

    el.innerHTML = headHTML + kpiHTML + dimsHTML + noteHTML;
  }

  function loadManagerScore(code, el) {
    JYXT.loading(el, '正在生成经理评分…');
    api('/api/manager/score?code=' + encodeURIComponent(code)).then(function (data) {
      if (!data || data.ok === false) {
        JYXT.errorBox(el, (data && data.error) || '经理评分获取失败', function () {
          loadManagerScore(code, el);
        });
        return;
      }
      if (!data.manager && !data.fund && num(data.score) === null) {
        JYXT.errorBox(el, '未获取到该基金的经理评分', function () {
          loadManagerScore(code, el);
        });
        return;
      }
      renderManagerScore(el, data);
    }).catch(function (err) {
      JYXT.errorBox(el, err && err.message ? err.message : '网络异常', function () {
        loadManagerScore(code, el);
      });
    });
  }

  function mountManagerScore(body) {
    body.innerHTML = JYXT.card('大佬评分', '搜索基金，查看基金经理五维评分',
      '<div class="t-form"><div class="t-field" style="position:relative">' +
        '<input class="t-input" data-ms-input placeholder="输入基金代码或名称，如 110022 / 易方达消费行业" autocomplete="off">' +
        '<div class="t-suggest hidden" data-ms-suggest></div>' +
      '</div></div>' +
      '<div data-ms-result></div>');
    var input = body.querySelector('[data-ms-input]');
    var suggest = body.querySelector('[data-ms-suggest]');
    var resultEl = body.querySelector('[data-ms-result]');
    if (!input || !suggest || !resultEl) return;

    JYXT.empty(resultEl, {
      icon: '🏆',
      title: '输入基金开始评分',
      desc: '支持代码或名称搜索，例如 110022、161725；评分基于经理经验/业绩/风控等五维'
    });

    JYXT.fundSearch(input, suggest, function (fund) {
      if (!fund || !fund.code) return;
      loadManagerScore(String(fund.code), resultEl);
    });
  }

  // ==================== 2. 大佬PK ====================
  function mountManagerPk(body) {
    var selected = [];
    body.innerHTML = JYXT.card('大佬PK', '选择 2 只基金，对比基金经理评分与维度',
      '<div class="t-form"><div class="t-field" style="position:relative">' +
        '<input class="t-input" data-pk-input placeholder="输入基金代码或名称搜索" autocomplete="off">' +
        '<div class="t-suggest hidden" data-pk-suggest></div>' +
      '</div></div>' +
      '<div class="t-chips" data-pk-tags></div>' +
      '<div class="t-actions">' +
        '<button class="t-btn t-btn-primary" type="button" data-pk-go>开始PK</button>' +
        '<button class="t-btn t-btn-ghost" type="button" data-pk-clear>清空</button>' +
      '</div>' +
      '<div data-pk-result></div>' +
      '<p class="t-note">评分基于基金历史业绩与经理公开信息，仅供参考。</p>');

    var input = body.querySelector('[data-pk-input]');
    var suggest = body.querySelector('[data-pk-suggest]');
    var tagsEl = body.querySelector('[data-pk-tags]');
    var resultEl = body.querySelector('[data-pk-result]');
    if (!input || !suggest || !tagsEl || !resultEl) return;

    function setHint() {
      JYXT.empty(resultEl, {
        icon: '⚔️',
        title: '添加 2 只基金后开始 PK',
        desc: '对比经理、星级、任职年限、管理规模、总分、等级与五维评分'
      });
    }

    function renderTags() {
      if (!selected.length) {
        tagsEl.innerHTML = '<span class="t-sub">尚未选择基金</span>';
        return;
      }
      tagsEl.innerHTML = selected.map(function (f) {
        return '<button class="t-chip" type="button" data-pk-remove="' + esc(f.code) + '">' +
          esc(f.name || f.code) + ' ✕</button>';
      }).join('');
    }

    function addFund(f) {
      if (!f || !f.code) return;
      if (selected.length >= 2) { toast('最多对比 2 只基金'); return; }
      var exists = selected.some(function (x) { return x.code === String(f.code); });
      if (exists) { toast('已添加该基金'); return; }
      selected.push({ code: String(f.code), name: f.name || String(f.code) });
      renderTags();
      setHint();
    }

    function dimRowsHTML(name, value, otherValue, color) {
      var s = clampNum(value, 0, 100, 0);
      var win = value !== null && otherValue !== null && value > otherValue;
      return '<div class="t-row">' +
          '<div class="t-row-main"><div class="t-name">' + esc(name || '—') + '</div></div>' +
          '<div class="t-row-side"><b class="' + (win ? 'up' : '') + '">' +
            (value === null ? '—' : fmt(value, 1)) + '</b></div>' +
        '</div>' +
        '<div class="t-progress"><i style="width:' + s.toFixed(1) + '%;background:' + color + '"></i></div>';
    }

    function renderPk(items) {
      var a = items[0] || {};
      var b = items[1] || {};
      var ma = a.manager || {};
      var mb = b.manager || {};
      var nameA = a.name || a.code || '基金A';
      var nameB = b.name || b.code || '基金B';
      var scoreA = num(a.score);
      var scoreB = num(b.score);
      var winA = scoreA !== null && scoreB !== null && scoreA > scoreB;
      var winB = scoreA !== null && scoreB !== null && scoreB > scoreA;

      var tableHTML = '<div class="t-section"><div class="t-section-title">经理对比</div>' +
        '<table class="t-table">' +
          '<thead><tr><th>指标</th><th>' + esc(nameA) + '</th><th>' + esc(nameB) + '</th></tr></thead>' +
          '<tbody>' +
            '<tr><td>基金经理</td><td>' + esc(ma.name || '—') + '</td><td>' + esc(mb.name || '—') + '</td></tr>' +
            '<tr><td>星级</td><td>' + esc(starText(ma.star)) + '</td><td>' + esc(starText(mb.star)) + '</td></tr>' +
            '<tr><td>任职年限</td><td>' + esc(sizeText(ma.workTime)) + '</td><td>' + esc(sizeText(mb.workTime)) + '</td></tr>' +
            '<tr><td>管理规模</td><td>' + esc(sizeText(ma.fundSize)) + '</td><td>' + esc(sizeText(mb.fundSize)) + '</td></tr>' +
            '<tr><td>总分</td>' +
              '<td><b class="' + (winA ? 'up' : '') + '">' + (scoreA === null ? '—' : fmt(scoreA, 2)) + '</b></td>' +
              '<td><b class="' + (winB ? 'up' : '') + '">' + (scoreB === null ? '—' : fmt(scoreB, 2)) + '</b></td>' +
            '</tr>' +
            '<tr><td>等级</td>' +
              '<td><span class="t-badge ' + badgeCls(scoreA) + '">' + esc(a.grade || gradeOf(scoreA)) + '</span></td>' +
              '<td><span class="t-badge ' + badgeCls(scoreB) + '">' + esc(b.grade || gradeOf(scoreB)) + '</span></td>' +
            '</tr>' +
          '</tbody>' +
        '</table></div>';

      var dimsA = Array.isArray(a.dims) ? a.dims : [];
      var dimsB = Array.isArray(b.dims) ? b.dims : [];
      var order = [], mapA = {}, mapB = {}, labels = {}, descs = {};
      function ingest(list, target) {
        list.forEach(function (d) {
          if (!d) return;
          var key = String(d.key || d.label || '');
          if (!key) return;
          if (order.indexOf(key) < 0) order.push(key);
          target[key] = d;
          if (!labels[key]) labels[key] = d.label || key;
          if (d.desc && !descs[key]) descs[key] = d.desc;
        });
      }
      ingest(dimsA, mapA);
      ingest(dimsB, mapB);

      var dimsHTML = '';
      var countA = 0, countB = 0;
      if (order.length) {
        dimsHTML = '<div class="t-section"><div class="t-section-title">逐维对比</div>' + order.map(function (key) {
          var va = num(mapA[key] && mapA[key].score);
          var vb = num(mapB[key] && mapB[key].score);
          if (va !== null && vb !== null) {
            if (va > vb) countA++;
            else if (vb > va) countB++;
          }
          return '<div class="t-section-title">' + esc(labels[key] || key) + '</div>' +
            (descs[key] ? '<div class="t-meta muted sm">' + esc(descs[key]) + '</div>' : '') +
            dimRowsHTML(nameA, va, vb, '#ff5b3a') +
            dimRowsHTML(nameB, vb, va, '#2f7df6');
        }).join('') + '</div>';
      }

      var concl;
      if (scoreA === null || scoreB === null) {
        concl = '总分数据不足，暂无法判定胜负。';
      } else if (Math.abs(scoreA - scoreB) < 0.5) {
        concl = '两只基金综合评分接近（' + fmt(scoreA, 2) + ' vs ' + fmt(scoreB, 2) + '），可结合维度偏好选择。';
      } else {
        var winner = scoreA > scoreB ? a : b;
        concl = '总分 <b class="up">' + esc(winner.name || winner.code) + '</b> 更高（' +
          fmt(scoreA, 2) + ' vs ' + fmt(scoreB, 2) + '）';
        if (order.length) {
          concl += '；逐维对比 <b>' + countA + ' : ' + countB + '</b>' +
            (countA === countB ? '' : '（' + esc(nameA) + ' 对 ' + esc(nameB) + '）');
        }
        concl += '，综合评分领先者胜出。';
      }

      resultEl.innerHTML = tableHTML + dimsHTML +
        '<div class="t-note"><b>胜负结论：</b>' + concl + '</div>';
    }

    function runPk() {
      if (selected.length !== 2) { toast('请先选择 2 只基金'); return; }
      JYXT.loading(resultEl, '正在对比经理评分…');
      var codes = selected.map(function (f) { return f.code; }).join(',');
      api('/api/manager/compare?codes=' + encodeURIComponent(codes)).then(function (data) {
        if (!data || data.ok === false) {
          JYXT.errorBox(resultEl, (data && data.error) || '经理对比数据获取失败', runPk);
          return;
        }
        var items = Array.isArray(data.items) ? data.items.filter(function (it) {
          return it && (it.code || it.name);
        }) : [];
        if (items.length < 2) { JYXT.errorBox(resultEl, '对比数据不完整，请稍后重试', runPk); return; }
        renderPk(items);
      }).catch(function (err) {
        JYXT.errorBox(resultEl, err && err.message ? err.message : '网络异常', runPk);
      });
    }

    JYXT.fundSearch(input, suggest, addFund);
    renderTags();
    setHint();

    body.addEventListener('click', function (e) {
      try {
        var t = e.target;
        if (!t || !t.closest) return;
        var go = t.closest('[data-pk-go]');
        if (go) { runPk(); return; }
        var clear = t.closest('[data-pk-clear]');
        if (clear) {
          selected = [];
          renderTags();
          setHint();
          return;
        }
        var rm = t.closest('[data-pk-remove]');
        if (rm) {
          var code = rm.getAttribute('data-pk-remove');
          selected = selected.filter(function (x) { return x.code !== code; });
          renderTags();
          setHint();
        }
      } catch (err) {
        console.error('[tools-other] 大佬PK 交互异常：', err);
      }
    });
  }

  // ==================== 3. 牛人选股 ====================
  function openStockSheet(s) {
    if (!s) return;
    var dir = pctDir(s.changePct);
    var html = '<div class="t-card">' +
      '<div class="t-card-head"><span class="t-title">' + esc(s.name || '—') + '</span>' +
        '<span class="t-sub">' + esc(s.code || '') + '</span></div>' +
      '<div class="t-body">' +
        JYXT.kpis([
          { label: '现价', value: fmtOr(s.price, 2), dir: dir },
          { label: '涨跌幅', value: pctOr(s.changePct), dir: dir },
          { label: '主力净流入', value: wanOr(s.inflow) },
          { label: '总市值', value: capText(s.marketCap) }
        ]) +
        '<div class="t-list"><div class="t-row">' +
          '<div class="t-row-main"><div class="t-name">所属行业</div></div>' +
          '<div class="t-row-side"><b>' + esc(s.industry || '—') + '</b></div>' +
        '</div></div>' +
        '<p class="t-note">股票暂无基金式详情接口，仅展示选股接口返回字段；数据来自东方财富板块资金流，非投资建议。</p>' +
      '</div></div>';
    JYXT.openSheet(html);
  }

  function mountStockPick(body) {
    body.innerHTML =
      '<div data-sp-industries></div>' +
      '<div data-sp-stocks></div>' +
      '<p class="t-note">按行业主力资金净流入选股（东方财富板块资金流口径），非投资建议。</p>';

    var indEl = body.querySelector('[data-sp-industries]');
    var listEl = body.querySelector('[data-sp-stocks]');
    if (!indEl || !listEl) return;
    var stockMap = {};
    var currentNote = '';

    function renderIndustries(industries) {
      if (!industries || !industries.length) {
        JYXT.empty(indEl, { icon: '🏭', title: '暂无行业资金流数据' });
        return;
      }
      var hasInflow = industries.some(function (it) { return it && it.mainInflow !== null && it.mainInflow !== undefined; });
      var chipsHTML = industries.map(function (it) {
        var name = (it && it.name) || '—';
        var dir = pctDir(it && it.pct);
        var title = name + ' 涨幅 ' + pctOr(it && it.pct) + (hasInflow ? ' 主力净流入 ' + wanOr(it && it.mainInflow) : '');
        return '<span class="t-chip" title="' + esc(title) + '">' +
          '<b>' + esc(name) + '</b>' +
          '<span class="' + dir + '">' + pctOr(it && it.pct) + '</span>' +
          (hasInflow ? '<small class="muted sm">主力 ' + wanOr(it && it.mainInflow) + '</small>' : '') +
          '</span>';
      }).join('');
      indEl.innerHTML = JYXT.card('热门行业', hasInflow ? '板块涨幅 · 主力净流入' : '板块涨幅（备用口径）',
        '<div class="t-chips">' + chipsHTML + '</div>');
    }

    function renderStocks(stocks) {
      stockMap = {};
      if (!stocks || !stocks.length) {
        JYXT.empty(listEl, { icon: '🎯', title: '暂无选股结果', desc: '上游资金流数据暂不可用，请稍后再试' });
        return;
      }
      var hasInflow = stocks.some(function (s) { return s && s.inflow !== null && s.inflow !== undefined; });
      var rowsHTML = stocks.map(function (s) {
        if (!s || !s.code) return '';
        stockMap[String(s.code)] = s;
        var dir = pctDir(s.changePct);
        return JYXT.rowHTML({
          name: esc(s.name || '—'),
          code: s.code,
          meta: '<span class="muted sm">' + esc(s.industry || '—') + '</span>' + ' · 市值 ' + esc(capText(s.marketCap)),
          side: '<b class="' + dir + '">' + fmtOr(s.price, 2) + '</b>' +
            '<span class="' + dir + '">' + pctOr(s.changePct) + '</span>' +
            (hasInflow ? '<small class="muted sm">主力 ' + wanOr(s.inflow) + '</small>' : ''),
          attrs: ' data-stock="' + esc(s.code) + '"'
        });
      }).join('');
      listEl.innerHTML = JYXT.card('牛人选股', hasInflow ? '按行业主力净流入筛选' : '按行业涨幅与成分股涨幅（备用口径）',
        '<div class="t-list">' + rowsHTML + '</div>' +
        (currentNote ? '<p class="t-note">' + esc(currentNote) + '</p>' : ''));
    }

    function load() {
      JYXT.loading(indEl, '热门行业加载中…');
      JYXT.loading(listEl, '选股数据加载中…');
      api('/api/stock/pick?limit=10').then(function (data) {
        if (!data || data.ok === false) {
          indEl.innerHTML = '';
          JYXT.errorBox(listEl, (data && data.error) || '选股数据获取失败', load);
          return;
        }
        currentNote = data.note || '';
        renderIndustries(Array.isArray(data.industries) ? data.industries : []);
        renderStocks(Array.isArray(data.stocks) ? data.stocks : []);
      }).catch(function (err) {
        indEl.innerHTML = '';
        JYXT.errorBox(listEl, err && err.message ? err.message : '网络异常', load);
      });
    }

    body.addEventListener('click', function (e) {
      try {
        var t = e.target;
        if (!t || !t.closest) return;
        var row = t.closest('[data-stock]');
        if (!row) return;
        var s = stockMap[row.getAttribute('data-stock')];
        if (s) openStockSheet(s);
      } catch (err) {
        console.error('[tools-other] 个股详情异常：', err);
      }
    });

    load();
  }

  // ==================== 4. 定投计算 ====================
  var DCA_KEY = 'jy_dca_inputs_v1';
  var DCA_TABS = [
    { key: 'dca', label: '定投复利' },
    { key: 'lump', label: '一次性复利' },
    { key: 'redeem', label: '赎回费' }
  ];
  var DCA_DEFAULTS = {
    dca: { amount: 2000, freq: 'monthly', rate: 8, years: 10 },
    lump: { principal: 100000, rate: 8, years: 10 },
    redeem: { days: 30, amount: 10000 }
  };

  function loadDcaState() {
    var saved = null;
    try { saved = storage.get(DCA_KEY, null); } catch (e) { saved = null; }
    var state = { tab: 'dca', inputs: {} };
    var tabs = ['dca', 'lump', 'redeem'];
    tabs.forEach(function (tab) {
      var defaults = DCA_DEFAULTS[tab];
      var src = (saved && saved.inputs && saved.inputs[tab]) ? saved.inputs[tab] : {};
      var out = {};
      Object.keys(defaults).forEach(function (key) {
        var v = src[key];
        if (v === null || v === undefined || v === '') v = defaults[key];
        out[key] = v;
      });
      state.inputs[tab] = out;
    });
    if (saved && (saved.tab === 'dca' || saved.tab === 'lump' || saved.tab === 'redeem')) {
      state.tab = saved.tab;
    }
    return state;
  }

  function saveDcaState(state) {
    try { storage.set(DCA_KEY, { tab: state.tab, inputs: state.inputs }); } catch (e) { /* 忽略 */ }
  }

  function dcaInput(label, key, value, step) {
    return '<label class="t-field"><span class="t-sub">' + label + '</span>' +
      '<input class="t-input" type="number" inputmode="decimal" min="0" step="' + step + '" value="' + esc(value) + '" data-dc-key="' + key + '"></label>';
  }

  function buildDcaForm(state) {
    var v = state.inputs[state.tab] || {};
    if (state.tab === 'dca') {
      return '<div class="t-form"><div class="t-fields">' +
        dcaInput('每期金额 (¥)', 'amount', v.amount, '100') +
        '<label class="t-field"><span class="t-sub">定投频率</span>' +
          '<select class="t-select" data-dc-key="freq">' +
            '<option value="monthly"' + (v.freq === 'weekly' ? '' : ' selected') + '>每月</option>' +
            '<option value="weekly"' + (v.freq === 'weekly' ? ' selected' : '') + '>每周</option>' +
          '</select></label>' +
        dcaInput('年化收益 (%)', 'rate', v.rate, '0.1') +
        dcaInput('投资年限 (年)', 'years', v.years, '1') +
        '</div></div>';
    }
    if (state.tab === 'lump') {
      return '<div class="t-form"><div class="t-fields">' +
        dcaInput('本金 (¥)', 'principal', v.principal, '100') +
        dcaInput('年化收益 (%)', 'rate', v.rate, '0.1') +
        dcaInput('投资年限 (年)', 'years', v.years, '1') +
        '</div></div>';
    }
    return '<div class="t-form"><div class="t-fields">' +
      dcaInput('持有天数', 'days', v.days, '1') +
      dcaInput('赎回金额 (¥)', 'amount', v.amount, '100') +
      '</div></div>';
  }

  function renderDcaAnnuity(state, el) {
    var v = state.inputs.dca;
    var amount = clampNum(v.amount, 0, 1e15, 0);
    var rate = clampNum(v.rate, -99, 1000, 0);
    var years = clampNum(v.years, 0, 100, 0);
    var ppy = v.freq === 'weekly' ? 52 : 12;
    var periods = Math.round(years * ppy);
    var i = (rate / 100) / ppy;
    var invested = amount * periods;
    var fv;
    if (periods <= 0) fv = 0;
    else if (Math.abs(i) < 1e-12) fv = invested;
    else if (i > -1) fv = amount * (Math.pow(1 + i, periods) - 1) / i;
    else fv = 0;
    var gain = fv - invested;
    var ret = invested > 0 ? (gain / invested) * 100 : null;
    el.innerHTML = JYXT.kpis([
      { label: '期数', value: periods + ' 期' },
      { label: '累计投入', value: money(invested) },
      { label: '期末总额', value: money(fv) },
      { label: '收益', value: signedMoney(gain), dir: kpiDir(gain) },
      { label: '收益率', value: ret === null ? '—' : fmtPct(ret), dir: kpiDir(ret) }
    ]) +
      '<p class="t-note">按' + (v.freq === 'weekly' ? '每周' : '每月') + '复利、年化 ' + fmt(rate, 2) +
      '%、共 ' + periods + ' 期测算（i = 年化 / ' + ppy + '）。</p>';
  }

  function renderDcaLump(state, el) {
    var v = state.inputs.lump;
    var principal = clampNum(v.principal, 0, 1e15, 0);
    var rate = clampNum(v.rate, -99, 1000, 0);
    var years = clampNum(v.years, 0, 100, 0);
    var factor = 1 + rate / 100;
    var total = years <= 0 ? principal : (factor > 0 ? principal * Math.pow(factor, years) : 0);
    var gain = total - principal;
    var mult = principal > 0 ? total / principal : null;
    var doubleYears = rate > 0 ? 72 / rate : null;
    el.innerHTML = JYXT.kpis([
      { label: '到期终值', value: money(total) },
      { label: '累计收益', value: signedMoney(gain), dir: kpiDir(gain) },
      { label: '收益倍数', value: mult === null ? '—' : fmt(mult, 2) + ' 倍' },
      { label: '翻倍年数（72法则）', value: doubleYears === null ? '—' : fmt(doubleYears, 2) + ' 年' }
    ]) +
      '<p class="t-note">按一次性投入 ' + money(principal) + '、年化 ' + fmt(rate, 2) +
      '%、持有 ' + fmt(years, 2) + ' 年复利测算；72 法则为近似估算。</p>';
  }

  function renderDcaRedeem(state, el) {
    var v = state.inputs.redeem;
    var days = Math.floor(clampNum(v.days, 0, 36500, 0));
    var amount = clampNum(v.amount, 0, 1e15, 0);
    var rate, tier;
    if (days < 7) {
      rate = 1.5;
      tier = '持有 < 7 天 · 惩罚性费率';
    } else if (days < 30) {
      rate = 0.75;
      tier = '7 - 30 天';
    } else if (days < 365) {
      rate = 0.5;
      tier = '30 天 - 1 年';
    } else if (days < 730) {
      rate = 0.25;
      tier = '1 - 2 年';
    } else {
      rate = 0;
      tier = '≥ 2 年 · 免赎回费';
    }
    var fee = amount * rate / 100;
    var net = amount - fee;
    el.innerHTML = JYXT.kpis([
      { label: '适用费率', value: fmt(rate, 2) + '%' },
      { label: '赎回费', value: money(fee), dir: fee > 0 ? 'down' : '' },
      { label: '到账金额', value: money(net) },
      { label: '费率档', value: tier }
    ]) +
      '<p class="t-note">' + (days < 7
        ? '持有不足 7 天，赎回费为惩罚性 1.5%，建议至少持有满 7 天。'
        : '多数基金持有满 2 年免赎回费；实际费率以基金公告为准。') + '</p>';
  }

  function renderDcaResult(state, el) {
    try {
      if (state.tab === 'dca') renderDcaAnnuity(state, el);
      else if (state.tab === 'lump') renderDcaLump(state, el);
      else renderDcaRedeem(state, el);
    } catch (err) {
      console.error('[tools-other] 定投计算异常：', err);
      el.innerHTML = '<div class="t-empty"><p>计算异常，请检查输入</p></div>';
    }
  }

  function mountDcaCalc(body) {
    var state = loadDcaState();
    body.innerHTML = JYXT.card('定投计算', '定投复利 / 一次性复利 / 赎回费',
      '<div class="t-chips" data-dc-tabs></div>' +
      '<div data-dc-form></div>' +
      '<div data-dc-result></div>' +
      '<p class="t-note">估算结果，不构成投资建议；输入值自动保存在本机浏览器。</p>');

    var tabsEl = body.querySelector('[data-dc-tabs]');
    var formEl = body.querySelector('[data-dc-form]');
    var resultEl = body.querySelector('[data-dc-result]');
    if (!tabsEl || !formEl || !resultEl) return;

    function renderTabs() {
      tabsEl.innerHTML = DCA_TABS.map(function (t) {
        return '<button class="t-chip' + (t.key === state.tab ? ' active' : '') + '" type="button" data-dc-tab="' +
          t.key + '">' + t.label + '</button>';
      }).join('');
    }

    function refresh() {
      renderTabs();
      formEl.innerHTML = buildDcaForm(state);
      renderDcaResult(state, resultEl);
    }

    body.addEventListener('click', function (e) {
      try {
        var t = e.target;
        if (!t || !t.closest) return;
        var btn = t.closest('[data-dc-tab]');
        if (!btn) return;
        var key = btn.getAttribute('data-dc-tab');
        if (key === state.tab) return;
        state.tab = key;
        saveDcaState(state);
        refresh();
      } catch (err) {
        console.error('[tools-other] 定投计算切换异常：', err);
      }
    });

    function onInput(e) {
      try {
        var el = e.target;
        if (!el || !el.getAttribute) return;
        var key = el.getAttribute('data-dc-key');
        if (!key) return;
        if (!state.inputs[state.tab]) return;
        state.inputs[state.tab][key] = el.value;
        saveDcaState(state);
        renderDcaResult(state, resultEl);
      } catch (err) {
        console.error('[tools-other] 定投计算输入异常：', err);
      }
    }
    body.addEventListener('input', onInput);
    body.addEventListener('change', onInput);

    refresh();
  }

  // ==================== 注册 4 个工具 ====================
  JYXT.register('manager-score', {
    title: '大佬评分',
    category: 'other',
    icon: '🏆',
    order: 1,
    mount: mountManagerScore
  });
  JYXT.register('manager-pk', {
    title: '大佬PK',
    category: 'other',
    icon: '⚔️',
    order: 2,
    mount: mountManagerPk
  });
  JYXT.register('stock-pick', {
    title: '牛人选股',
    category: 'other',
    icon: '🎯',
    order: 3,
    mount: mountStockPick
  });
  JYXT.register('dca-calc', {
    title: '定投计算',
    category: 'other',
    icon: '🧮',
    order: 4,
    mount: mountDcaCalc
  });
})();
