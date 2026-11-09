/* 韭研 · 小程序资产详情页（pages/asset/asset）
 * query: { code, type:'stock'|'fund', name? }
 * 股票：/api/quote 实时行情（后端暂无 K 线接口时仅展示行情 + 说明）
 * 基金：/api/fund/detail 名称/净值/阶段收益/风险/经理/规模 + 净值曲线
 */
var api = require('../../utils/api.js');
var format = require('../../utils/format.js');
var ui = require('../../utils/ui.js');

function starText(star) {
  var n = format.num(star);
  var count = n === null ? 0 : Math.max(0, Math.min(5, Math.round(n)));
  var text = '';
  for (var i = 0; i < count; i++) text += '★';
  return text;
}

function stageRows(stage) {
  var s = stage || {};
  var defs = [
    { label: '近1月', key: 'm1' },
    { label: '近3月', key: 'm3' },
    { label: '近6月', key: 'm6' },
    { label: '近1年', key: 'y1' },
    { label: '近3年', key: 'y3' },
    { label: '成立来', key: 'since' }
  ];
  return defs.map(function (d) {
    var v = format.num(s[d.key]);
    return { label: d.label, text: format.pct(v), dir: format.dir(v) };
  });
}

function riskRows(risk) {
  var r = risk || {};
  var defs = [
    { label: '最大回撤', key: 'maxDrawdown', suffix: '%' },
    { label: '年化波动', key: 'volatility', suffix: '%' },
    { label: '夏普比率', key: 'sharpe', suffix: '' },
    { label: '成立年化', key: 'annualized', suffix: '%' }
  ];
  return defs.map(function (d) {
    var v = format.num(r[d.key]);
    return { label: d.label, text: v === null ? '—' : format.fmt(v, d.suffix === '%' ? 2 : 2) + d.suffix };
  });
}

function pickNumber(v) {
  return format.num(v);
}

var registerPage = (typeof Page === 'function') ? Page : function () {};

registerPage({
  data: {
    code: '',
    type: 'stock',
    inputName: '',
    loading: true,
    error: '',
    stock: null,
    fund: null,
    chartSeries: [],
    chartMarkers: [],
    chartEmpty: true,
    chartPercent: false,
    note: ''
  },

  onLoad: function (options) {
    var opt = options || {};
    var code = String(opt.code || '').trim();
    var type = String(opt.type || 'stock') === 'fund' ? 'fund' : 'stock';
    var name = '';
    if (opt.name) {
      try {
        name = decodeURIComponent(String(opt.name));
      } catch (e) {
        name = String(opt.name);
      }
    }
    this.setData({ code: code, type: type, inputName: name });
    ui.navigationTitle(name || '资产详情');
    this._justLoaded = true;
    this.load();
  },

  onShow: function () {
    if (this._justLoaded) {
      this._justLoaded = false;
      return;
    }
    if (this.data.code) this.load();
  },

  onPullDownRefresh: function () {
    this.load().then(function () {
      if (typeof wx !== 'undefined' && wx.stopPullDownRefresh) wx.stopPullDownRefresh();
    });
  },

  onRetry: function () {
    this.load();
  },

  load: function () {
    var that = this;
    var code = this.data.code;
    if (!code) {
      this.setData({ loading: false, error: '缺少资产代码' });
      return Promise.resolve();
    }
    this.setData({ loading: true, error: '' });
    var job = this.data.type === 'fund' ? this.loadFund(code) : this.loadStock(code);
    return job
      .catch(function (err) {
        that.setData({
          loading: false,
          error: (err && err.message) || '加载失败，请稍后重试'
        });
      })
      .then(function () {
        if (that.data.loading) that.setData({ loading: false });
      });
  },

  loadStock: function (code) {
    var that = this;
    return api.request('/api/quote', { codes: code }).then(function (data) {
      var quotes = data && Array.isArray(data.quotes) ? data.quotes : [];
      var q = quotes && quotes[0];
      if (!q) throw new Error((data && data.error) || '未查询到该标的行情');
      var pct = format.num(q.changePct);
      var stock = {
        name: q.name || that.data.inputName || code,
        code: String(q.code || code),
        priceText: format.fmt(q.price, 2),
        unit: q.unit || '',
        changeText: format.fmt(q.change, 2),
        pctText: format.pct(pct),
        dir: format.dir(pct),
        openText: format.fmt(q.open, 2),
        prevCloseText: format.fmt(q.prevClose, 2),
        highText: format.fmt(q.high, 2),
        lowText: format.fmt(q.low, 2),
        high52Text: format.fmt(q.high52w, 2),
        low52Text: format.fmt(q.low52w, 2)
      };
      that.setData({
        stock: stock,
        fund: null,
        chartSeries: [],
        chartEmpty: true,
        note: '后端暂未提供股票 K 线接口，当前展示实时行情与关键价位。'
      });
      ui.navigationTitle(stock.name);
      // 若后端已提供 K 线接口则补画走势；失败静默降级
      return api.request('/api/stock/kline', { code: code, range: '1y' }).then(function (k) {
        var points = that.mapKline(k);
        if (points.length >= 2) {
          that.setData({
            chartSeries: [{
              name: stock.name,
              points: points,
              color: stock.dir === 'down' ? '#17a673' : '#e5433b',
              fill: true
            }],
            chartEmpty: false,
            chartPercent: false,
            note: ''
          });
        }
      }).catch(function () { /* 无 K 线接口，保持行情展示 */ });
    });
  },

  mapKline: function (k) {
    var points = [];
    if (!k) return points;
    var list = Array.isArray(k.items) ? k.items : (Array.isArray(k.points) ? k.points : (Array.isArray(k.klines) ? k.klines : null));
    if (!list && k.data && Array.isArray(k.data.items)) list = k.data.items;
    if (!Array.isArray(list)) return points;
    list.forEach(function (item) {
      if (!item) return;
      var t = item.t !== undefined ? format.num(item.t) : null;
      if (t === null && item.date) {
        var d = new Date(String(item.date).slice(0, 10) + 'T00:00:00');
        t = isNaN(d.getTime()) ? null : d.getTime();
      }
      var v = item.v !== undefined ? format.num(item.v) : (item.close !== undefined ? format.num(item.close) : format.num(item.price));
      if (t !== null && v !== null) points.push({ t: t, v: v });
    });
    return points;
  },

  loadFund: function (code) {
    var that = this;
    return api.request('/api/fund/detail', { code: code }).then(function (data) {
      var f = data && data.fund;
      if (!f) throw new Error((data && data.error) || '未获取到基金详情');

      var pct = format.num(f.dayPct);
      var nav = format.num(f.nav);
      var manager = f.manager || {};
      var scale = pickNumber(f.scale);
      var fund = {
        name: f.name || that.data.inputName || code,
        code: f.code || code,
        navText: nav === null ? '—' : format.fmt(nav, 4),
        navDate: f.navDate || '',
        pctText: format.pct(pct),
        dir: format.dir(pct),
        stageRows: stageRows(f.stage),
        riskRows: riskRows(f.risk),
        managerName: manager.name || '—',
        managerStar: starText(manager.star),
        managerMeta: [manager.workTime || '', manager.fundSize || ''].filter(Boolean).join(' · '),
        scaleText: scale === null ? '—' : format.fmt(scale, 2) + ' 亿元',
        holdings: Array.isArray(f.topHoldings) ? f.topHoldings.slice(0, 10).map(function (h) {
          return { name: (h && h.name) || '—', weightText: format.num(h && h.weight) === null ? '—' : format.fmt(h.weight, 2) + '%' };
        }) : []
      };

      var points = [];
      var series = Array.isArray(f.navSeries) ? f.navSeries : [];
      series.forEach(function (p) {
        var t = format.num(p && p.t);
        var v = format.num(p && p.nav);
        if (t !== null && v !== null) points.push({ t: t, v: v });
      });
      var y1 = format.num(f.stage && f.stage.y1);
      var chartSeries = [];
      if (points.length >= 2) {
        chartSeries = [{
          name: '单位净值',
          points: points,
          color: y1 !== null && y1 < 0 ? '#17a673' : '#e5433b',
          fill: true
        }];
      }

      that.setData({
        stock: null,
        fund: fund,
        chartSeries: chartSeries,
        chartEmpty: chartSeries.length === 0,
        chartPercent: false,
        note: chartSeries.length ? '' : '历史净值数据不足，暂无法绘制走势。'
      });
      ui.navigationTitle(fund.name);
    });
  }
});
