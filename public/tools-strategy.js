/* 韭研 · 投研工作台 —— 「制定策略」19 个工具（tools-strategy.js）
 * 工具：恐贪指数 / 情绪面板 / 指数估值 / 股债性价比 / 12 个板块恐贪 / 铜油比 / AH溢价 / 汇股比
 * 约定：单文件、原生 JS（var/function 风格）、零依赖、无外链；
 *       共享库 window.JYXT（public/tools.js）提供格式化 / 接口 / SVG 图表 / 仪表盘等能力。
 * 说明：12 个板块恐贪由统一工厂函数 assetFearTool(def) 生成，避免复制代码。
 */
(function () {
  'use strict';

  var JYXT = window.JYXT;
  if (!JYXT) return;

  // ==================== 基础工具 ====================
  var esc = JYXT.esc;

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function nfmt(v, d) {
    var n = num(v);
    return n == null ? '—' : JYXT.fmt(n, d == null ? 2 : d);
  }
  function npct(v) {
    var n = num(v);
    return n == null ? '—' : JYXT.fmtPct(n);
  }
  function dirOf(v) {
    var n = num(v);
    return n == null ? 'flat' : JYXT.pctDir(n);
  }
  /* 把 0-1 的小数百分数统一成 0-100（例如 0.0299 -> 2.99，69.36 保持不变） */
  function pctNorm(v) {
    var n = num(v);
    if (n == null) return null;
    if (n > 0 && n <= 1) return n * 100;
    return n;
  }
  function pctText(v) {
    var n = pctNorm(v);
    return n == null ? '—' : JYXT.fmt(n, 2) + '%';
  }
  function errMsg(e) {
    if (e && e.message) return e.message;
    if (e && e.error) return e.error;
    return '网络异常，请稍后重试';
  }
  function parseDay(d) {
    if (d === null || d === undefined || d === '') return null;
    if (typeof d === 'number') return isFinite(d) ? d : null;
    var s = String(d).trim();
    var t = Date.parse(s.length === 10 ? s + 'T00:00:00' : s);
    return isFinite(t) ? t : null;
  }

  /* 接口返回 {ok:false} 时，如果仍带回了可用数据（例如缓存），允许继续渲染 */
  function hasPayload(d) {
    if (!d) return false;
    return !!(d.items || d.value != null || d.ratio != null || d.hs300 || d.index ||
      d.pairs || d.copper || d.oil || d.fearGreed || d.indices);
  }

  /* 通用：加载 → 渲染 → 失败重试 */
  function loadSimple(box, path, render, loadingText) {
    JYXT.loading(box, loadingText || '加载中…');
    JYXT.api(path).then(function (d) {
      d = d || {};
      if (d.ok === false && !hasPayload(d)) throw new Error(d.error || '接口返回失败');
      render(d);
    }).catch(function (e) {
      JYXT.errorBox(box, errMsg(e), function () { loadSimple(box, path, render, loadingText); });
    });
  }

  // ==================== 共享渲染片段 ====================
  function weightsText(factors) {
    var list = arr(factors);
    if (!list.length) return '';
    return list.map(function (f) {
      var w = num(f && f.weight);
      var label = esc((f && (f.label || f.key)) || '因子');
      if (w == null) return label;
      return label + ' ' + JYXT.fmt(w <= 1 ? w * 100 : w, 0) + '%';
    }).join(' · ');
  }

  function factorBars(factors) {
    var list = arr(factors);
    if (!list.length) return '<p class="t-note">暂无因子明细。</p>';
    return '<div class="t-factors">' + list.map(function (f) {
      var raw = num(f && f.value);
      var v = clamp(raw == null ? 0 : raw, 0, 100);
      var w = num(f && f.weight);
      var wTxt = w == null ? '' : '权重 ' + JYXT.fmt(w <= 1 ? w * 100 : w, 0) + '%';
      return '<div class="t-factor">' +
        '<div class="t-factor-head">' +
          '<span class="t-name">' + esc((f && (f.label || f.key)) || '因子') + '</span>' +
          '<span class="t-row-side"><b style="color:' + JYXT.gaugeColor(v) + '">' + JYXT.fmt(v, 0) + '</b>' +
            (wTxt ? '<small class="muted sm"> ' + wTxt + '</small>' : '') +
          '</span>' +
        '</div>' +
        '<div class="t-progress t-factor-bar"><i style="width:' + v.toFixed(1) + '%"></i></div>' +
        (f && f.desc ? '<p class="t-note sm">' + esc(f.desc) + '</p>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  function range52HTML(quote) {
    var p = num(quote && quote.price);
    var hi = num(quote && quote.high52w);
    var lo = num(quote && quote.low52w);
    if (p == null || hi == null || lo == null || hi <= lo) return '<p class="t-note">暂无 52 周区间数据。</p>';
    var pos = clamp((p - lo) / (hi - lo) * 100, 0, 100);
    return '<div class="t-section"><div class="t-section-title">52 周区间定位 · ' + JYXT.fmt(pos, 1) + '%</div>' +
      '<div class="t-progress"><i style="width:' + pos.toFixed(1) + '%"></i></div>' +
      '<div class="t-actions" style="justify-content:space-between">' +
        '<span class="muted sm">52 周低 ' + nfmt(lo) + '</span>' +
        '<span class="muted sm">52 周高 ' + nfmt(hi) + '</span>' +
      '</div></div>';
  }

  function historyStats(items) {
    var pts = [];
    var vals = [];
    arr(items).forEach(function (it, i) {
      var v = num(it && it.value);
      if (v == null) return;
      var t = parseDay(it && it.date);
      pts.push({ t: t == null ? i * 86400000 : t, v: v });
      vals.push(v);
    });
    if (!pts.length) return { count: 0, points: [], last: null, max: null, min: null, avg: null };
    var max = vals[0], min = vals[0], sum = 0;
    vals.forEach(function (n) { if (n > max) max = n; if (n < min) min = n; sum += n; });
    return { count: pts.length, points: pts, last: vals[vals.length - 1], max: max, min: min, avg: sum / vals.length };
  }

  function ratioHistory(history, key) {
    var pts = [];
    arr(history).forEach(function (h, i) {
      var v = num(h && h[key]);
      if (v == null) return;
      var t = parseDay(h.date);
      pts.push({ t: t == null ? i * 86400000 : t, v: v });
    });
    return pts;
  }

  function historyChange(history) {
    var vals = [];
    arr(history).forEach(function (h) {
      var v = num(h && h.ratio);
      if (v != null) vals.push(v);
    });
    if (vals.length < 2) return null;
    var prev = vals[vals.length - 2], last = vals[vals.length - 1];
    if (prev === 0) return null;
    return (last - prev) / prev * 100;
  }

  function commodityRow(it, fallback) {
    if (!it) return '';
    var dir = dirOf(it.changePct);
    return JYXT.rowHTML({
      name: esc(it.name || fallback || '—'),
      code: it.code || '',
      meta: '现价 ' + nfmt(it.price),
      side: '<b class="' + dir + '">' + npct(it.changePct) + '</b>'
    });
  }

  /* 恐贪仪表盘卡片的公共头部 */
  function gaugeCard(title, sub, item, extraHTML) {
    var v = clamp(num(item && item.value) == null ? 0 : num(item.value), 0, 100);
    var color = (item && item.color) || JYXT.gaugeColor(v);
    return JYXT.card(title, sub,
      JYXT.gauge(v, { level: (item && item.level) || '', color: color }) +
      (extraHTML || ''));
  }

  // ==================== 1. 恐贪指数 ====================
  function fearGreedHTML(fg, histItems) {
    var v = clamp(num(fg.value) == null ? 0 : num(fg.value), 0, 100);
    var color = fg.color || JYXT.gaugeColor(v);
    var factors = arr(fg.factors);
    var wTxt = weightsText(factors);
    var stats = historyStats(histItems);
    var html = '';

    html += gaugeCard('当前恐贪指数', '更新 ' + JYXT.fmtDateTime(fg.updatedAt), fg,
      JYXT.kpis([
        { label: '恐贪分值', value: JYXT.fmt(v, 0), dir: v >= 60 ? 'up' : (v <= 40 ? 'down' : '') },
        { label: '情绪状态', value: fg.level || '—' },
        { label: '历史记录', value: stats.count ? stats.count + ' 天' : '—' }
      ]));

    html += JYXT.card('三因子构成', wTxt ? '权重 ' + wTxt : '股价强度 · 市场广度 · 动能',
      factorBars(factors));

    html += JYXT.card('近 60 日走势', stats.count ? '共 ' + stats.count + ' 个记录点' : '历史数据累积中',
      JYXT.sparkline(stats.points, {
        color: color,
        height: 88,
        refLines: [20, 80],
        emptyText: '历史数据从今天开始累积'
      }) +
      (stats.count ? JYXT.kpis([
        { label: '当前', value: JYXT.fmt(stats.last, 0) },
        { label: '最高', value: JYXT.fmt(stats.max, 0) },
        { label: '最低', value: JYXT.fmt(stats.min, 0) },
        { label: '均值', value: JYXT.fmt(stats.avg, 1) }
      ]) : '') +
      '<p class="t-note">虚线为 20 / 80 阈值：低于 20 为极度恐惧（关注逆向机会），高于 80 为极度贪婪（注意风险）。</p>');

    html += JYXT.card('方法论', '',
      '<p class="t-note">恐贪指数由三因子加权合成：' + (wTxt || '股价强度 · 市场广度 · 动能') +
      '。分值 0-100：<br>· 0-20 极度恐惧 · 20-40 恐惧 · 40-60 中性 · 60-80 贪婪 · 80-100 极度贪婪。<br>' +
      '因子权重取自后端返回数据，本页不写死；指数仅反映市场情绪，不构成投资建议。</p>');

    return html;
  }

  function loadFearGreed(box) {
    JYXT.loading(box, '正在合成恐贪指数…');
    Promise.all([
      JYXT.api('/api/snapshot'),
      JYXT.api('/api/fear-history?days=60').catch(function () { return null; })
    ]).then(function (res) {
      var snap = res[0] || {};
      var fg = snap.fearGreed || (snap.snapshot && snap.snapshot.fearGreed) || null;
      if (!fg || num(fg.value) == null) throw new Error('快照中暂无恐贪指数（数据可能尚未生成）');
      var hist = (res[1] && res[1].items) || [];
      box.innerHTML = fearGreedHTML(fg, hist);
    }).catch(function (e) {
      JYXT.errorBox(box, errMsg(e), function () { loadFearGreed(box); });
    });
  }

  JYXT.register('fear-greed', {
    title: '恐贪指数',
    category: 'strategy',
    icon: '😱',
    order: 1,
    mount: function (body) {
      body.innerHTML = '<div data-fg></div>';
      loadFearGreed(body.querySelector('[data-fg]'));
    }
  });

  // ==================== 2. 情绪面板 ====================
  function panelSignal(p) {
    var parts = [];
    var fg = p.fearGreed;
    if (fg && num(fg.value) != null) {
      parts.push({ label: '恐贪', score: clamp(num(fg.value), 0, 100), weight: 0.4 });
    }
    var hs = p.valuation && p.valuation.hs300;
    if (hs && num(hs.pePercentile) != null) {
      parts.push({ label: '估值分位', score: 100 - clamp(pctNorm(hs.pePercentile), 0, 100), weight: 0.3 });
    }
    var ind = p.industries;
    if (ind && num(ind.strongRatio) != null) {
      parts.push({ label: '行业广度', score: clamp(pctNorm(ind.strongRatio), 0, 100), weight: 0.3 });
    }
    if (!parts.length) return null;
    var tw = 0, sum = 0;
    parts.forEach(function (pt) { tw += pt.weight; sum += pt.score * pt.weight; });
    var score = tw > 0 ? sum / tw : 0;
    var label = '中性', dir = '';
    if (score >= 60) { label = '偏多'; dir = 'up'; }
    else if (score < 40) { label = '偏空'; dir = 'down'; }
    var desc = '综合评分 ' + JYXT.fmt(score, 0) + '/100：' + parts.map(function (pt) {
      return pt.label + ' ' + JYXT.fmt(pt.score, 0) + '（权重 ' + JYXT.fmt(pt.weight * 100, 0) + '%）';
    }).join('、') + '。';
    if (score >= 60) desc += '当前情绪偏积极，但需警惕过热。';
    else if (score < 40) desc += '当前情绪偏冷，可关注逆向布局机会。';
    else desc += '当前情绪中性，建议均衡配置。';
    return { score: score, label: label, dir: dir, parts: parts, desc: desc };
  }

  function signalCard(sig, updatedAt) {
    if (!sig) {
      return JYXT.card('综合信号灯', '', '<p class="t-note">数据不足，无法生成综合信号。</p>');
    }
    return JYXT.card('综合信号灯', '恐贪 40% + 估值分位 30% + 行业广度 30%',
      '<div class="t-kpis">' +
        '<div class="t-kpi"><span class="t-kpi-label">综合信号</span>' +
          '<b class="t-kpi-value ' + sig.dir + '" style="font-size:24px">' + esc(sig.label) + '</b></div>' +
        '<div class="t-kpi"><span class="t-kpi-label">综合评分</span>' +
          '<b class="t-kpi-value">' + JYXT.fmt(sig.score, 0) + '</b></div>' +
        '<div class="t-kpi"><span class="t-kpi-label">更新时间</span>' +
          '<b class="t-kpi-value" style="font-size:12px">' + esc(JYXT.fmtDateTime(updatedAt)) + '</b></div>' +
      '</div>' +
      '<p class="t-note">' + esc(sig.desc) + '</p>');
  }

  function panelBreadthHTML(ind) {
    if (!ind) return '<p class="t-note">行业广度数据暂不可用。</p>';
    var strong = pctNorm(ind.strongRatio);
    var up = num(ind.up), down = num(ind.down), avg = num(ind.avgPct);
    var html = JYXT.kpis([
      { label: '上涨行业', value: up == null ? '—' : JYXT.fmt(up, 0) + ' 家', dir: up == null ? '' : 'up' },
      { label: '下跌行业', value: down == null ? '—' : JYXT.fmt(down, 0) + ' 家', dir: down == null ? '' : 'down' },
      { label: '平均涨幅', value: npct(avg), dir: dirOf(avg) }
    ]);
    if (strong != null) {
      var pos = clamp(strong, 0, 100);
      html += '<div class="t-section"><div class="t-section-title">强势行业占比 · ' + JYXT.fmt(pos, 1) + '%</div>' +
        '<div class="t-progress"><i style="width:' + pos.toFixed(1) + '%"></i></div>' +
        '<div class="t-actions" style="justify-content:space-between">' +
          '<span class="muted sm">0%</span><span class="muted sm">100%</span>' +
        '</div></div>';
    }
    html += '<p class="t-note">行业广度统计东方财富行业板块的涨跌家数与强势行业占比，占比越高说明赚钱效应越强。</p>';
    return html;
  }

  function emotionPanelHTML(p) {
    var fg = p.fearGreed || null;
    var hs = (p.valuation && p.valuation.hs300) || null;
    var ind = p.industries || null;
    var indices = arr(p.indices);
    var hist = arr(p.fearHistory);
    var sig = panelSignal(p);
    if (!fg && !hs && !ind && !indices.length) return '';

    var html = '';
    html += signalCard(sig, p.updatedAt);

    if (fg && num(fg.value) != null) {
      var fgStats = historyStats(hist);
      var fgColor = fg.color || JYXT.gaugeColor(num(fg.value));
      html += gaugeCard('恐贪指数', '情绪温度计 · ' + esc(fg.level || ''), fg,
        (fgStats.count > 1 ? JYXT.sparkline(fgStats.points, { color: fgColor, height: 64, refLines: [20, 80] }) : '') +
        '<p class="t-note">' + esc(fg.level || '') + ' · ' + JYXT.fmt(num(fg.value), 1) + ' 分' +
        (fgStats.count ? ' · 近 ' + fgStats.count + ' 日' : '') + '</p>');
    } else {
      html += JYXT.card('恐贪指数', '情绪温度计', '<p class="t-note">恐贪数据暂不可用。</p>');
    }

    html += JYXT.card('沪深300 估值', hs ? '分位越低越便宜' : '暂无数据',
      hs ? JYXT.kpis([
        { label: 'PE', value: nfmt(hs.pe) },
        { label: 'PE 分位', value: pctText(hs.pePercentile) },
        { label: 'PB', value: nfmt(hs.pb) },
        { label: '股息率', value: pctText(hs.yeild) }
      ]) + '<p class="t-note">PE 分位为历史百分位（越高越贵）；股息率为近 12 个月口径。数据来自蛋卷基金指数估值。</p>'
        : '<p class="t-note">估值数据暂不可用。</p>');

    html += JYXT.card('行业广度', '东方财富行业板块口径', panelBreadthHTML(ind));

    html += JYXT.card('主要指数', indices.length ? indices.length + ' 个指数' : '暂无数据',
      indices.length
        ? '<div class="t-list">' + indices.map(function (it) {
            var dir = dirOf(it && it.changePct);
            return JYXT.rowHTML({
              name: esc((it && (it.name || it.code)) || '—'),
              code: (it && it.code) || '',
              meta: '现价 ' + nfmt(it && it.price),
              side: '<b class="' + dir + '">' + npct(it && it.changePct) + '</b>'
            });
          }).join('') + '</div>'
        : '<p class="t-note">指数行情暂不可用。</p>');

    html += JYXT.card('说明', '',
      '<p class="t-note">综合信号灯由三项加权（恐贪 40% + 估值分位 30%，分位越低越偏多 + 行业广度 30%），' +
      '可用数据不足时自动重新归一权重。信号仅反映当前市场情绪与估值，不构成投资建议。</p>');

    return html;
  }

  function loadEmotionPanel(box) {
    JYXT.loading(box, '正在汇总市场情绪…');
    JYXT.api('/api/emotion/panel').then(function (d) {
      d = d || {};
      if (d.ok === false && !hasPayload(d)) throw new Error(d.error || '情绪面板接口返回失败');
      var html = emotionPanelHTML(d);
      if (!html) {
        JYXT.empty(box, { icon: '🌡️', title: '暂无情绪数据', desc: '情绪面板接口未返回有效数据，请稍后重试' });
        return;
      }
      box.innerHTML = html;
    }).catch(function (e) {
      JYXT.errorBox(box, errMsg(e), function () { loadEmotionPanel(box); });
    });
  }

  JYXT.register('emotion-panel', {
    title: '情绪面板',
    category: 'strategy',
    icon: '🌡️',
    order: 2,
    mount: function (body) {
      body.innerHTML = '<div data-panel></div>';
      loadEmotionPanel(body.querySelector('[data-panel]'));
    }
  });

  // ==================== 3. 指数估值 ====================
  function valuationTableHTML(items, expanded) {
    var list = arr(items).slice().sort(function (a, b) {
      var pa = num(a && a.pePercentile), pb = num(b && b.pePercentile);
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb;
    });
    // 后端可能返回 0-100 百分数，也可能返回 0-1 小数：按整列最大值判断统一口径
    var maxPct = null;
    list.forEach(function (it) {
      var p = num(it && it.pePercentile);
      if (p != null && (maxPct == null || p > maxPct)) maxPct = p;
    });
    var pctScale = (maxPct != null && maxPct <= 1) ? 100 : 1;
    function scalePctText(v) {
      var n = num(v);
      return n == null ? '—' : JYXT.fmt(n * pctScale, 2) + '%';
    }
    var counts = { low: 0, mid: 0, high: 0 };
    var rows = list.map(function (it) {
      var t = String((it && it.evaType) || '').toLowerCase();
      var key = t === 'low' ? 'low' : (t === 'high' ? 'high' : 'mid');
      counts[key]++;
      var pe = num(it && it.pe), pb = num(it && it.pb);
      var txt = (it && it.evaTypeText) || (key === 'low' ? '低估' : (key === 'high' ? '高估' : '正常'));
      return '<tr>' +
        '<td>' + esc((it && it.name) || '—') + '<small class="t-code">' + esc((it && it.code) || '') + '</small></td>' +
        '<td><span class="t-badge ' + key + '">' + esc(txt) + '</span></td>' +
        '<td>' + (pe != null && pe > 0 ? JYXT.fmt(pe, 2) : '—') + '</td>' +
        '<td>' + scalePctText(it && it.pePercentile) + '</td>' +
        '<td>' + (pb != null && pb > 0 ? JYXT.fmt(pb, 2) : '—') + '</td>' +
        '<td>' + pctText(it && it.yeild) + '</td>' +
        '</tr>';
    });
    var show = expanded ? rows : rows.slice(0, 10);
    return {
      html: JYXT.kpis([
        { label: '低估', value: JYXT.fmt(counts.low, 0) + ' 个', dir: 'down' },
        { label: '正常', value: JYXT.fmt(counts.mid, 0) + ' 个' },
        { label: '高估', value: JYXT.fmt(counts.high, 0) + ' 个', dir: 'up' }
      ]) +
      '<table class="t-table"><thead><tr>' +
        '<th>指数</th><th>估值</th><th>PE</th><th>PE 分位</th><th>PB</th><th>股息率</th>' +
      '</tr></thead><tbody>' + show.join('') + '</tbody></table>' +
      (rows.length > 10
        ? '<div class="t-actions"><button class="t-btn t-btn-ghost" data-expand>' +
          (expanded ? '收起' : '展开全部（共 ' + rows.length + ' 条）') + '</button></div>'
        : '') +
      '<p class="t-note">按 PE 历史分位升序排列（分位越低越便宜）；PE / PB 为 0 或缺失显示 —。' +
      '数据来自蛋卷基金指数估值，低估值不代表立即上涨，仅供参考。</p>',
      total: rows.length
    };
  }

  JYXT.register('index-valuation', {
    title: '指数估值',
    category: 'strategy',
    icon: '📊',
    order: 3,
    mount: function (body) {
      body.innerHTML = '<div data-iv></div>';
      var box = body.querySelector('[data-iv]');
      var state = { expanded: false, items: null, updatedAt: null };

      function render() {
        if (!state.items) return;
        var t = valuationTableHTML(state.items, state.expanded);
        box.innerHTML = JYXT.card('指数估值', '蛋卷基金 · 数据日期 ' + JYXT.fmtDate(state.updatedAt), t.html);
        var b = box.querySelector('[data-expand]');
        if (b) {
          b.onclick = function () {
            state.expanded = !state.expanded;
            render();
          };
        }
      }

      function load() {
        JYXT.loading(box, '加载指数估值…');
        JYXT.api('/api/index-valuation').then(function (d) {
          d = d || {};
          if (d.ok === false && !hasPayload(d)) throw new Error(d.error || '指数估值接口返回失败');
          var items = d.items || [];
          if (!items.length) {
            JYXT.empty(box, { icon: '📊', title: '暂无估值数据', desc: '指数估值接口暂未返回数据，请稍后重试' });
            return;
          }
          state.items = items;
          state.updatedAt = d && d.updatedAt;
          render();
        }).catch(function (e) {
          JYXT.errorBox(box, errMsg(e), load);
        });
      }
      load();
    }
  });

  // ==================== 4. 股债性价比 ====================
  function stockBondHTML(d) {
    var hs = d.hs300 || {};
    var pe = num(hs.pe);
    var ep = num(hs.ep);
    if (ep == null && pe != null && pe > 0) ep = 100 / pe;
    var erp = num(d.erp);
    var zone = d.zone || {};
    var zoneCls = erp == null ? 'mid' : (erp >= 3 ? 'up' : (erp >= 1 ? 'mid' : 'down'));
    var html = '';

    html += JYXT.card('核心指标', '沪深300 · 盈利收益率 − 国债收益率',
      JYXT.kpis([
        { label: '盈利收益率 EP', value: ep == null ? '—' : JYXT.fmt(ep, 2) + '%' },
        { label: '10Y 国债参考', value: num(d.bondYield) == null ? '—' : JYXT.fmt(d.bondYield, 2) + '%' },
        { label: 'ERP 差值', value: erp == null ? '—' : (erp > 0 ? '+' : '') + JYXT.fmt(erp, 2) + '%', dir: erp == null ? '' : (erp >= 1 ? 'up' : 'down') },
        { label: '沪深300 PE', value: nfmt(pe) }
      ]) +
      '<p class="t-note">ERP（股权风险溢价）= 盈利收益率（1/PE）− 国债收益率，数值越高说明股票相对债券越有性价比。</p>');

    html += JYXT.card('区间判定', '',
      '<div class="t-actions"><span class="t-badge ' + zoneCls + '" style="font-size:14px">' +
        esc(zone.label || zone.key || '—') + '</span></div>' +
      '<p class="t-note">' + esc(zone.desc || '暂无区间说明。') + '</p>' +
      JYXT.kpis([
        { label: 'PE 历史分位', value: pctText(hs.pePercentile) },
        { label: '股息率', value: pctText(hs.yeild) },
        { label: 'PB', value: nfmt(hs.pb) }
      ]));

    html += JYXT.card('说明', '',
      '<p class="t-note">国债收益率为<b>手动参考值（公开接口不可用），可自行更新</b>；上方输入框修改后立即重新计算，参考值保存在本机浏览器。' +
      '沪深300 PE / PE 分位 / 股息率来自蛋卷基金指数估值，分位越高代表相对历史越贵。' +
      (d.source ? ' 数据来源：' + esc(d.source) + '。' : '') +
      '本页仅用于观察股债相对性价比，不构成投资建议。</p>');

    return html;
  }

  JYXT.register('stock-bond', {
    title: '股债性价比',
    category: 'strategy',
    icon: '⚖️',
    order: 4,
    mount: function (body) {
      var saved = num(JYXT.storage.get('jy_bond_yield', 2.0));
      var bond = (saved != null && saved > 0 && saved < 20) ? saved : 2.0;
      body.innerHTML = JYXT.card('股债性价比', '沪深300 盈利收益率 vs 10 年期国债',
        '<div class="t-form"><div class="t-field">' +
          '<label class="muted sm" for="sbBondInput">10 年期国债收益率参考值（%）</label>' +
          '<div class="t-fields">' +
            '<input class="t-input" id="sbBondInput" data-bond type="number" step="0.01" min="0.1" max="10" value="' + bond + '">' +
            '<button class="t-btn t-btn-primary" data-apply>更新</button>' +
          '</div>' +
        '</div></div>' +
        '<div data-sb-result></div>');

      var result = body.querySelector('[data-sb-result]');
      var input = body.querySelector('[data-bond]');
      var apply = body.querySelector('[data-apply]');

      var lastLoaded = null;

      function load(force) {
        var v = num(input.value);
        if (v == null || v <= 0 || v > 20) {
          JYXT.toast('请输入 0-20 之间的国债收益率');
          input.focus();
          return;
        }
        var key = String(v);
        if (!force && key === lastLoaded) return;
        lastLoaded = key;
        JYXT.storage.set('jy_bond_yield', v);
        loadSimple(result, '/api/analytics/stock-bond?bondYield=' + encodeURIComponent(v), function (d) {
          result.innerHTML = stockBondHTML(d);
        }, '计算股债性价比…');
      }

      if (apply) apply.onclick = function () { load(true); };
      if (input) {
        input.addEventListener('change', function () { load(false); });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); load(true); }
        });
      }
      load(true);
    }
  });

  // ==================== 5-16. 板块恐贪（统一工厂） ====================
  function assetFearHTML(d, def) {
    var v = clamp(num(d.value) == null ? 0 : num(d.value), 0, 100);
    var color = d.color || JYXT.gaugeColor(v);
    var factors = arr(d.factors);
    var quote = d.quote || null;
    var wTxt = weightsText(factors);
    var html = '';

    html += gaugeCard(def.title,
      (d.name ? esc(d.name) : '') + (d.updatedAt ? ' · 更新 ' + esc(JYXT.fmtDateTime(d.updatedAt)) : ''),
      { value: v, level: d.level, color: color },
      JYXT.kpis([
        { label: '恐贪分值', value: JYXT.fmt(v, 0), dir: v >= 60 ? 'up' : (v <= 40 ? 'down' : '') },
        { label: '情绪状态', value: d.level || '—' }
      ]));

    html += JYXT.card('三因子构成', wTxt ? '权重 ' + wTxt : '区间位置 · 动量 · 回撤',
      factorBars(factors));

    if (quote) {
      var dir = dirOf(quote.changePct);
      html += JYXT.card('标的行情',
        (quote.name ? esc(quote.name) : '') + (quote.code ? ' · ' + esc(quote.code) : ''),
        JYXT.kpis([
          { label: '现价', value: nfmt(quote.price), dir: dir },
          { label: '涨跌幅', value: npct(quote.changePct), dir: dir },
          { label: '52 周高', value: nfmt(quote.high52w) },
          { label: '52 周低', value: nfmt(quote.low52w) }
        ]) + range52HTML(quote));
    } else {
      html += JYXT.card('标的行情', '', '<p class="t-note">该板块以多标的聚合计算，暂无单一标的行情。</p>');
    }

    html += JYXT.card('说明', '',
      '<p class="t-note">' + esc(def.desc) + '。恐贪分值由' +
      (wTxt || '52 周区间位置 · 近期动量 · 距 52 周高点回撤') +
      '加权合成，仅反映对应标的的价格情绪，不构成投资建议。</p>');

    return html;
  }

  function assetFearTool(def) {
    return {
      title: def.title,
      category: 'strategy',
      icon: def.icon,
      order: def.order,
      mount: function (body) {
        body.innerHTML = '<div data-asset></div>';
        var box = body.querySelector('[data-asset]');
        loadSimple(box, '/api/fear/asset?key=' + encodeURIComponent(def.asset), function (d) {
          if (num(d.value) == null) throw new Error('暂无该板块的恐贪数据');
          box.innerHTML = assetFearHTML(d, def);
        }, '正在计算' + def.title + '…');
      }
    };
  }

  var ASSET_DEFS = [
    { key: 'fear-jingong', asset: 'jingong', title: '军工恐贪', icon: '🛡️', desc: '以军工 ETF（sh512660）作为板块情绪代理' },
    { key: 'fear-quanshang', asset: 'quanshang', title: '券商恐贪', icon: '💹', desc: '以券商 ETF（sh512000）作为板块情绪代理' },
    { key: 'fear-newenergy', asset: 'newenergy', title: '新能源车恐贪', icon: '🚗', desc: '以新能源车 ETF（sh515030）作为板块情绪代理' },
    { key: 'fear-guangfu', asset: 'guangfu', title: '光伏恐贪', icon: '☀️', desc: '以光伏 ETF（sh515790）作为板块情绪代理' },
    { key: 'fear-dianchi', asset: 'dianchi', title: '电池恐贪', icon: '🔋', desc: '以电池 ETF（sz159755）作为板块情绪代理' },
    { key: 'fear-hangye', asset: 'hangye', title: '行业恐贪', icon: '🏭', desc: '以东方财富行业板块涨跌广度聚合计算行业情绪' },
    { key: 'fear-chuang50', asset: 'chuang50', title: '创50恐贪', icon: '🚀', desc: '以创业板 50 ETF（sz159949）作为板块情绪代理' },
    { key: 'fear-us', asset: 'us', title: '美股恐贪', icon: '🇺🇸', desc: '以纳斯达克指数（usIXIC）作为美股情绪代理' },
    { key: 'fear-a500', asset: 'a500', title: 'A500恐贪', icon: '📈', desc: '以中证 A500 ETF（sh512050）作为宽基情绪代理' },
    { key: 'fear-ai', asset: 'ai', title: 'AI恐贪', icon: '🤖', desc: '以人工智能 ETF（sh515070）作为板块情绪代理' },
    { key: 'fear-gold', asset: 'gold', title: '黄金恐贪', icon: '🥇', desc: '以黄金 ETF（sh518880）作为避险资产情绪代理' },
    { key: 'fear-gushou', asset: 'gushou', title: '固收+恐贪', icon: '🏦', desc: '以国债 ETF（sh511010）作为固收类资产情绪代理' }
  ];

  ASSET_DEFS.forEach(function (def, i) {
    def.order = 5 + i;
    JYXT.register(def.key, assetFearTool(def));
  });

  // ==================== 17. 铜油比 ====================
  function ratioTrend(d) {
    var chg = historyChange(d && d.history);
    if (chg != null) return { pct: chg, label: '较上一记录', diff: false };
    var cu = num(d && d.copper && d.copper.changePct);
    var oi = num(d && d.oil && d.oil.changePct);
    if (cu != null && oi != null) return { pct: cu - oi, label: '今日铜相对油', diff: true };
    return null;
  }

  function copperOilHTML(d) {
    var ratio = num(d.ratio);
    var copper = d.copper || null;
    var oil = d.oil || null;
    var hist = ratioHistory(d.history, 'ratio');
    var trend = ratioTrend(d);
    var html = '';

    html += JYXT.card('铜油比', '铜价 / 油价 · 商品相对强弱',
      '<div style="text-align:center;padding:2px 0 0">' +
        '<b class="t-kpi-value" style="font-size:30px">' + (ratio == null ? '—' : JYXT.fmt(ratio, 2)) + '</b>' +
        '<div class="muted sm">' + (trend
          ? trend.label + ' ' + (trend.diff ? JYXT.fmtSigned(trend.pct, 2) + ' 个百分点' : npct(trend.pct))
          : '历史数据从今天开始累积') + '</div>' +
      '</div>');

    if (copper || oil) {
      html += JYXT.card('铜 / 油 行情', '商品代理标的',
        '<div class="t-list">' +
          (copper ? commodityRow(copper, '铜') : '') +
          (oil ? commodityRow(oil, '油') : '') +
        '</div>');
    }

    html += JYXT.card('历史走势', hist.length > 1 ? '最近 ' + hist.length + ' 个交易日' : '数据累积中',
      hist.length > 1
        ? JYXT.lineChart([{ name: '铜油比', points: hist, color: '#f0a020', fill: true }], { height: 150, percent: false })
        : '<p class="t-note">历史数据从今天开始累积（每日抓取后自动追加）。</p>');

    html += JYXT.card('解读', '',
      '<p class="t-note">铜油比 = 铜价 / 油价。比值上升通常意味着铜相对原油走强，常被视作工业需求与经济动能偏强的信号；比值下降则相反。' +
      '本页以「有色ETF（sh512400）」与「南方原油LOF（sh501018）」价格作为铜 / 油代理，并非商品期货直接比价，仅供参考，不构成投资建议。</p>');

    return html;
  }

  JYXT.register('copper-oil', {
    title: '铜油比',
    category: 'strategy',
    icon: '🛢️',
    order: 17,
    mount: function (body) {
      body.innerHTML = '<div data-co></div>';
      var box = body.querySelector('[data-co]');
      loadSimple(box, '/api/analytics/copper-oil', function (d) {
        if (num(d.ratio) == null && !d.copper && !d.oil) throw new Error('暂无铜油比数据');
        box.innerHTML = copperOilHTML(d);
      }, '加载铜油比…');
    }
  });

  // ==================== 18. AH 溢价 ====================
  function ahHTML(d) {
    var idx = d.index || {};
    var hkd = num(d.hkdCny);
    var pairs = arr(d.pairs);
    var html = '';

    html += JYXT.card('AH 溢价指数', '恒生沪深港通 AH 股溢价指数',
      JYXT.kpis([
        { label: '溢价指数', value: nfmt(idx.value), dir: dirOf(idx.changePct) },
        { label: '涨跌幅', value: npct(idx.changePct), dir: dirOf(idx.changePct) },
        { label: '港币兑人民币', value: hkd == null ? '—' : JYXT.fmt(hkd, 4) }
      ]) +
      '<p class="t-note">溢价指数越高说明 A 股相对 H 股越贵：高于 130 时通常港股相对便宜，低于 100 时 A 股相对便宜。</p>');

    if (pairs.length) {
      html += JYXT.card('A / H 对比', 'A 价 vs H 价（H 价已按汇率折算）',
        '<table class="t-table"><thead><tr>' +
          '<th>名称</th><th>A 股</th><th>H 股</th><th>溢价率</th>' +
        '</tr></thead><tbody>' + pairs.map(function (p) {
          var pr = num(p && p.premiumPct);
          var cls = pr == null ? '' : (pr > 0 ? 'up' : (pr < 0 ? 'down' : ''));
          return '<tr>' +
            '<td>' + esc((p && p.name) || '—') +
              '<small class="t-code">' + esc(((p && p.aCode) || '') + ' / ' + ((p && p.hCode) || '')) + '</small></td>' +
            '<td>' + nfmt(p && p.aPrice) + '</td>' +
            '<td>' + nfmt(p && p.hPrice) + '</td>' +
            '<td class="' + cls + '">' + (pr == null ? '—' : (pr > 0 ? '+' : '') + JYXT.fmt(pr, 2) + '%') + '</td>' +
          '</tr>';
        }).join('') + '</tbody></table>' +
        '<p class="t-note">溢价率 = A 股价 /（H 股价 × 港币兑人民币）− 1，正值表示 A 股溢价、负值表示折价。</p>');
    } else {
      html += JYXT.card('A / H 对比', '', '<p class="t-note">暂无可对比的 A/H 个股数据。</p>');
    }

    html += JYXT.card('说明', '',
      '<p class="t-note">数据来自腾讯行情（A / H 个股）与东方财富（AH 溢价指数、港币汇率）。' +
      'AH 溢价受两地投资者结构、资金流动性与汇率影响，仅作参考，不构成投资建议。</p>');

    return html;
  }

  JYXT.register('ah-premium', {
    title: 'AH溢价',
    category: 'strategy',
    icon: '🇭🇰',
    order: 18,
    mount: function (body) {
      body.innerHTML = '<div data-ah></div>';
      var box = body.querySelector('[data-ah]');
      loadSimple(box, '/api/analytics/ah-premium', function (d) {
        box.innerHTML = ahHTML(d);
      }, '加载 AH 溢价…');
    }
  });

  // ==================== 19. 汇股比 ====================
  function fxStockHTML(d) {
    var ratio = num(d.ratio);
    var usd = num(d.usdCny);
    var idx = d.index || {};
    var hist = ratioHistory(d.history, 'ratio');
    var chg = historyChange(d.history);
    var dir = dirOf(idx.changePct);
    var html = '';

    html += JYXT.card('汇股比', '上证指数 / 美元兑离岸人民币 · ' + esc(idx.name || '上证指数'),
      '<div style="text-align:center;padding:2px 0 0">' +
        '<b class="t-kpi-value" style="font-size:30px">' + (ratio == null ? '—' : JYXT.fmt(ratio, 2)) + '</b>' +
        '<div class="muted sm">' + (chg == null ? '历史数据从今天开始累积' : '较上一记录 ' + npct(chg)) + '</div>' +
      '</div>' +
      JYXT.kpis([
        { label: '美元兑离岸人民币', value: usd == null ? '—' : JYXT.fmt(usd, 4) },
        { label: '上证指数', value: nfmt(idx.price), dir: dir },
        { label: '上证涨跌', value: npct(idx.changePct), dir: dir }
      ]));

    html += JYXT.card('历史走势', hist.length > 1 ? '最近 ' + hist.length + ' 个交易日' : '数据累积中',
      hist.length > 1
        ? JYXT.lineChart([{ name: '汇股比', points: hist, color: '#2f7df6', fill: true }], { height: 150, percent: false })
        : '<p class="t-note">历史数据从今天开始累积（每日抓取后自动追加）。</p>');

    html += JYXT.card('解读', '',
      '<p class="t-note">汇股比 = 上证指数 / 美元兑离岸人民币汇率。比值上升表示股市相对汇率走强（人民币贬值或股指上涨），' +
      '比值下降表示汇率相对股市走强。该口径仅用于观察股汇联动，不构成投资建议。</p>');

    return html;
  }

  JYXT.register('fx-stock', {
    title: '汇股比',
    category: 'strategy',
    icon: '💱',
    order: 19,
    mount: function (body) {
      body.innerHTML = '<div data-fxs></div>';
      var box = body.querySelector('[data-fxs]');
      loadSimple(box, '/api/analytics/fx-stock', function (d) {
        if (num(d.ratio) == null && !d.index) throw new Error('暂无汇股比数据');
        box.innerHTML = fxStockHTML(d);
      }, '加载汇股比…');
    }
  });

})();
