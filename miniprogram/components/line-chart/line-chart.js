/* 韭研 · 小程序折线图组件（canvas 2d）
 * properties：series(Array) / height(Number,px) / percent(Boolean) / markers(Array)
 * series 元素：{ name, points:[{t,v}], color, fill }
 * markers 元素：{ t, type:'buy'|'sell', price? }
 */
(function () {
  'use strict';

  var PALETTE = ['#ff5b3a', '#2f7df6', '#17a673', '#f0a020', '#8e6cf0', '#20b2c9'];

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /** 宽松数字转换：null/undefined/''/NaN 返回 null（避免 Number(null)===0 造成假数据） */
  function toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function dateLabel(t, span) {
    var d = new Date(t);
    if (isNaN(d.getTime())) return '';
    if (span > 3 * 365 * 86400000) return String(d.getFullYear());
    if (span > 90 * 86400000) return (d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  var chart = {
    properties: {
      series: { type: Array, value: [] },
      height: { type: Number, value: 220 },
      percent: { type: Boolean, value: true },
      markers: { type: Array, value: [] }
    },

    data: {},

    options: {
      styleIsolation: 'isolated'
    },

    lifetimes: {
      ready: function () {
        this.initCanvas();
      },
      detached: function () {
        if (this._drawTimer) {
          clearTimeout(this._drawTimer);
          this._drawTimer = null;
        }
        this._ctx = null;
        this._canvas = null;
      }
    },

    observers: {
      'series, markers, percent, height': function () {
        this.scheduleDraw();
      }
    },

    methods: {
      initCanvas: function () {
        var that = this;
        if (typeof wx === 'undefined' || !wx || typeof wx.createSelectorQuery !== 'function') return;
        var query = wx.createSelectorQuery().in(this);
        query.select('#chart').fields({ node: true, size: true }).exec(function (res) {
          if (!res || !res[0] || !res[0].node) return;
          var canvas = res[0].node;
          var ctx = canvas.getContext('2d');
          if (!ctx) return;
          var dpr = 2;
          try {
            if (typeof wx.getWindowInfo === 'function') {
              dpr = wx.getWindowInfo().pixelRatio || dpr;
            } else if (typeof wx.getSystemInfoSync === 'function') {
              dpr = wx.getSystemInfoSync().pixelRatio || dpr;
            }
          } catch (e) { /* 使用默认 dpr */ }
          var cssW = res[0].width || 320;
          var cssH = res[0].height || that.data.height || 220;
          canvas.width = Math.max(1, Math.round(cssW * dpr));
          canvas.height = Math.max(1, Math.round(cssH * dpr));
          if (ctx.scale) ctx.scale(dpr, dpr);
          that._canvas = canvas;
          that._ctx = ctx;
          that._w = cssW;
          that._h = cssH;
          that.draw();
        });
      },

      scheduleDraw: function () {
        var that = this;
        if (!this._ctx) return;
        if (this._drawTimer) clearTimeout(this._drawTimer);
        this._drawTimer = setTimeout(function () {
          that._drawTimer = null;
          that.draw();
        }, 16);
      },

      draw: function () {
        var ctx = this._ctx;
        if (!ctx) return;
        var W = this._w || 320;
        var H = this._h || this.data.height || 220;
        var percent = !!this.data.percent;
        ctx.clearRect(0, 0, W, H);

        var series = Array.isArray(this.data.series) ? this.data.series : [];
        var all = [];
        var si;
        for (si = 0; si < series.length; si++) {
          var pts = series[si] && Array.isArray(series[si].points) ? series[si].points : [];
          for (var pi = 0; pi < pts.length; pi++) {
            var p = pts[pi];
            var pt = toNum(p && p.t);
            var pv = toNum(p && p.v);
            if (pt !== null && pv !== null) all.push({ t: pt, v: pv });
          }
        }

        if (all.length < 2) {
          ctx.fillStyle = 'rgba(142,153,168,0.9)';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('暂无走势数据', W / 2, H / 2);
          return;
        }

        var xMin = all[0].t;
        var xMax = all[0].t;
        var yMin = all[0].v;
        var yMax = all[0].v;
        for (var i = 0; i < all.length; i++) {
          if (all[i].t < xMin) xMin = all[i].t;
          if (all[i].t > xMax) xMax = all[i].t;
          if (all[i].v < yMin) yMin = all[i].v;
          if (all[i].v > yMax) yMax = all[i].v;
        }
        if (xMax <= xMin) xMax = xMin + 86400000;
        if (yMax === yMin) { yMax += 1; yMin -= 1; }
        var padY = (yMax - yMin) * 0.08 || 1;
        yMin -= padY;
        yMax += padY;

        var PL = 46;
        var PR = 12;
        var PT = 14;
        var PB = 22;
        var iw = Math.max(10, W - PL - PR);
        var ih = Math.max(10, H - PT - PB);

        function sx(t) { return PL + ((t - xMin) / (xMax - xMin)) * iw; }
        function sy(v) { return PT + (1 - (v - yMin) / (yMax - yMin)) * ih; }

        // 网格 + Y 轴刻度
        ctx.lineWidth = 1;
        ctx.font = '10px sans-serif';
        for (var g = 0; g <= 4; g++) {
          var gy = PT + (ih * g) / 4;
          var gv = yMax - ((yMax - yMin) * g) / 4;
          ctx.strokeStyle = 'rgba(142,153,168,0.16)';
          ctx.beginPath();
          ctx.moveTo(PL, gy);
          ctx.lineTo(W - PR, gy);
          ctx.stroke();
          ctx.fillStyle = 'rgba(142,153,168,0.95)';
          ctx.textAlign = 'right';
          ctx.fillText(percent ? gv.toFixed(1) + '%' : gv.toFixed(1), PL - 6, gy + 3);
        }

        // 零轴（有正负时）
        if (yMin < 0 && yMax > 0) {
          var zy = sy(0);
          ctx.save && ctx.save();
          if (ctx.setLineDash) ctx.setLineDash([4, 4]);
          ctx.strokeStyle = 'rgba(142,153,168,0.4)';
          ctx.beginPath();
          ctx.moveTo(PL, zy);
          ctx.lineTo(W - PR, zy);
          ctx.stroke();
          if (ctx.setLineDash) ctx.setLineDash([]);
          ctx.restore && ctx.restore();
        }

        // X 轴日期
        var span = xMax - xMin;
        var ticks = [xMin, xMin + span / 2, xMax];
        ctx.fillStyle = 'rgba(142,153,168,0.95)';
        ctx.font = '10px sans-serif';
        for (var ti = 0; ti < ticks.length; ti++) {
          var tx = sx(ticks[ti]);
          ctx.textAlign = ti === 0 ? 'left' : (ti === ticks.length - 1 ? 'right' : 'center');
          ctx.fillText(dateLabel(ticks[ti], span), tx, H - 6);
        }

        // 折线
        for (si = 0; si < series.length; si++) {
          var item = series[si] || {};
          var points = Array.isArray(item.points) ? item.points : [];
          var valid = [];
          for (var qi = 0; qi < points.length; qi++) {
            var qp = points[qi];
            var qt = toNum(qp && qp.t);
            var qv = toNum(qp && qp.v);
            if (qt !== null && qv !== null) valid.push({ t: qt, v: qv });
          }
          if (valid.length < 2) continue;
          var color = item.color || PALETTE[si % PALETTE.length];
          ctx.beginPath();
          ctx.moveTo(sx(valid[0].t), sy(valid[0].v));
          for (var li = 1; li < valid.length; li++) {
            ctx.lineTo(sx(valid[li].t), sy(valid[li].v));
          }
          if (item.fill) {
            ctx.save && ctx.save();
            ctx.lineTo(sx(valid[valid.length - 1].t), H - PB);
            ctx.lineTo(sx(valid[0].t), H - PB);
            ctx.closePath();
            ctx.globalAlpha = 0.12;
            ctx.fillStyle = color;
            ctx.fill();
            if (ctx.restore) ctx.restore();
            ctx.beginPath();
            ctx.moveTo(sx(valid[0].t), sy(valid[0].v));
            for (var fi = 1; fi < valid.length; fi++) ctx.lineTo(sx(valid[fi].t), sy(valid[fi].v));
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.stroke();
          // 末端点
          var last = valid[valid.length - 1];
          ctx.beginPath();
          ctx.arc(sx(last.t), sy(last.v), 2.5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }

        // 买卖点标记
        var markers = Array.isArray(this.data.markers) ? this.data.markers : [];
        for (var mi = 0; mi < markers.length; mi++) {
          var m = markers[mi] || {};
          var mt = toNum(m.t);
          if (mt === null || mt < xMin || mt > xMax) continue;
          var buy = m.type === 'buy';
          var mx = sx(mt);
          var my = buy ? H - PB - 4 : PT + 10;
          ctx.beginPath();
          ctx.arc(mx, my, 3.2, 0, Math.PI * 2);
          ctx.fillStyle = buy ? '#e5484d' : '#17a673';
          ctx.fill();
          ctx.fillStyle = buy ? '#e5484d' : '#17a673';
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(buy ? '买' : '卖', mx, buy ? my - 7 : my + 13);
        }
      }
    }
  };

  if (typeof Component === 'function') {
    Component(chart);
  }
})();
