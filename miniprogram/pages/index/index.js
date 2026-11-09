/* 韭研 · 小程序首页（pages/index/index）
 * 数据：GET /api/snapshot -> { ok, updatedAt, nextRefreshAt, fearGreed, chips, sections, commodities, notes }
 * 结构：品牌头 + 恐贪指数卡 + 市场速览（A股/美股/港股）+ 商品市场 + 快捷入口 + 页脚
 */
var api = require('../../utils/api.js');
var format = require('../../utils/format.js');
var ui = require('../../utils/ui.js');

var QUICK_ENTRIES = [
  { icon: '📊', title: '策略', desc: '组合 / 指标策略回测', url: '/pages/strategy/strategy', tab: true },
  { icon: '🏆', title: '基金排行', desc: '近 1 年收益榜', url: '/pages/tool/tool?key=fund-rank', tab: false },
  { icon: '🌡️', title: '情绪面板', desc: '恐贪 · 估值 · 行业', url: '/pages/tool/tool?key=emotion-panel', tab: false },
  { icon: '🧰', title: '工具箱', desc: '全部投研工具', url: '/pages/tools/tools', tab: true }
];

var MARKET_TITLES = { a: 'A股', us: '美股', hk: '港股' };

function fgColor(value) {
  if (value < 20) return '#2f9e6f';
  if (value < 40) return '#4aa3a3';
  if (value < 60) return '#d8a533';
  if (value < 80) return '#e56b34';
  return '#e5433b';
}

function mapQuote(q) {
  var pct = format.num(q && q.changePct);
  return {
    name: (q && q.name) || '—',
    code: (q && q.code) || '',
    priceText: format.fmt(q && q.price, 2),
    pctText: format.pct(pct),
    changeText: format.fmt(q && q.change, 2),
    dir: format.dir(pct),
    unit: (q && q.unit) || ''
  };
}

var registerPage = (typeof Page === 'function') ? Page : function () {};

registerPage({
  data: {
    loading: true,
    error: '',
    fg: null,
    factors: [],
    markets: [],
    commodities: [],
    commodityNote: '',
    quick: QUICK_ENTRIES,
    notes: [],
    updatedText: '',
    nextText: ''
  },

  onLoad: function () {
    this._justLoaded = true;
    this.loadSnapshot();
  },

  onShow: function () {
    if (this._justLoaded) {
      this._justLoaded = false;
      return;
    }
    this.loadSnapshot(true);
  },

  onPullDownRefresh: function () {
    var that = this;
    this.loadSnapshot(true).then(function () {
      if (typeof wx !== 'undefined' && wx.stopPullDownRefresh) wx.stopPullDownRefresh();
    });
  },

  loadSnapshot: function (silent) {
    var that = this;
    if (!silent) this.setData({ loading: true, error: '' });
    return api.request('/api/snapshot')
      .then(function (raw) {
        var snap = raw && raw.snapshot ? raw.snapshot : (raw || {});
        that.applySnapshot(snap);
      })
      .catch(function (err) {
        that.setData({
          loading: false,
          error: (err && err.message) || '行情加载失败，请检查网络后重试'
        });
        if (silent && !that.data.fg) ui.toastErr(err);
      });
  },

  applySnapshot: function (snap) {
    var fgRaw = snap.fearGreed || {};
    var value = format.num(fgRaw.value);
    var fg = null;
    var factors = [];
    if (value !== null) {
      var v = Math.max(0, Math.min(100, value));
      fg = {
        valueText: String(Math.round(v)),
        level: fgRaw.level || '—',
        color: fgRaw.color || fgColor(v),
        percent: v
      };
      var rawFactors = Array.isArray(fgRaw.factors) ? fgRaw.factors : [];
      factors = rawFactors.map(function (f) {
        var fv = format.num(f && f.value);
        var width = fv === null ? 0 : Math.max(0, Math.min(100, fv));
        return {
          label: (f && f.label) || '因子',
          valueText: fv === null ? '—' : format.fmt(fv, 1),
          width: width,
          desc: (f && f.desc) || ''
        };
      });
    }

    var sections = Array.isArray(snap.sections) ? snap.sections : [];
    var markets = [];
    ['a', 'us', 'hk'].forEach(function (id) {
      var sec = null;
      for (var i = 0; i < sections.length; i++) {
        if (sections[i] && sections[i].id === id) { sec = sections[i]; break; }
      }
      if (!sec) return;
      var items = Array.isArray(sec.items) ? sec.items.slice(0, 4) : [];
      markets.push({
        id: id,
        title: sec.title || MARKET_TITLES[id] || id,
        items: items.map(mapQuote)
      });
    });

    var commodities = [];
    var commodityNote = '';
    var commoditySection = null;
    for (var ci = 0; ci < sections.length; ci++) {
      if (sections[ci] && sections[ci].id === 'commodity') { commoditySection = sections[ci]; break; }
    }
    var commRaw = snap.commodities && Array.isArray(snap.commodities.items) ? snap.commodities.items : [];
    if (commoditySection && Array.isArray(commoditySection.items) && commoditySection.items.length) {
      commodities = commoditySection.items.slice(0, 4).map(mapQuote);
    } else if (commRaw.length) {
      commodities = commRaw.slice(0, 4).map(mapQuote);
    } else {
      commodityNote = (snap.commodities && snap.commodities.note) || '商品行情暂不可用';
    }

    var notes = Array.isArray(snap.notes) ? snap.notes.slice(0, 3) : [];
    var updatedText = snap.updatedAt ? format.fmtDate(snap.updatedAt) + ' ' + format.fmtTime(snap.updatedAt) : '';
    var nextText = snap.nextRefreshAt ? format.fmtTime(snap.nextRefreshAt) : '';

    this._loadedAt = Date.now();
    this.setData({
      loading: false,
      error: '',
      fg: fg,
      factors: factors,
      markets: markets,
      commodities: commodities,
      commodityNote: commodityNote,
      notes: notes,
      updatedText: updatedText,
      nextText: nextText
    });
  },

  onRetry: function () {
    this.loadSnapshot();
  },

  onQuickTap: function (e) {
    var ds = e.currentTarget.dataset;
    if (!ds || !ds.url) return;
    if (ds.tab) ui.goTab(ds.url);
    else ui.go(ds.url);
  },

  onQuoteTap: function (e) {
    var ds = e.currentTarget.dataset;
    if (!ds || !ds.code) return;
    ui.go('/pages/asset/asset?code=' + encodeURIComponent(ds.code) +
      '&type=stock&name=' + encodeURIComponent(ds.name || ''));
  }
});
