/* 韭研 · 小程序自选页（pages/watch/watch）
 * 搜索：股票用 /api/stock/search，基金用 /api/fund/search（并发展示，点击加入自选）
 * 行情：股票 /api/quote?codes=...，基金 /api/fund/quotes?codes=...，本地存 jy_mp_watch_v1
 */
var api = require('../../utils/api.js');
var format = require('../../utils/format.js');
var storage = require('../../utils/storage.js');
var ui = require('../../utils/ui.js');

function normalizeWatch(list) {
  if (!Array.isArray(list)) return [];
  var out = [];
  var seen = {};
  list.forEach(function (item) {
    if (!item || !item.code) return;
    var type = item.type === 'fund' ? 'fund' : 'stock';
    var key = type + '|' + item.code;
    if (seen[key]) return;
    seen[key] = true;
    out.push({ code: String(item.code), name: item.name || String(item.code), type: type });
  });
  return out;
}

function pickQuote(list, code) {
  if (!Array.isArray(list) || !code) return null;
  var target = String(code).toLowerCase();
  var bare = target.replace(/^(sh|sz|hk|us)/, '');
  for (var i = 0; i < list.length; i++) {
    var q = list[i];
    if (!q || !q.code) continue;
    var qc = String(q.code).toLowerCase();
    if (qc === target || qc === bare || qc.replace(/^(sh|sz|hk|us)/, '') === bare) return q;
  }
  return null;
}

var registerPage = (typeof Page === 'function') ? Page : function () {};

registerPage({
  data: {
    watch: [],
    rows: [],
    loading: false,
    hasWatch: false,
    quoteError: '',
    searchKey: '',
    searching: false,
    searchResults: [],
    searchTip: ''
  },

  onLoad: function () {
    this._justLoaded = true;
    this.refresh();
  },

  onShow: function () {
    if (this._justLoaded) {
      this._justLoaded = false;
      return;
    }
    this.refresh();
  },

  onPullDownRefresh: function () {
    this.refresh().then(function () {
      if (typeof wx !== 'undefined' && wx.stopPullDownRefresh) wx.stopPullDownRefresh();
    });
  },

  /** 拉取自选列表 + 批量行情 */
  refresh: function () {
    var that = this;
    var watch = normalizeWatch(storage.read(storage.WATCH_KEY, []));
    var stockCodes = [];
    var fundCodes = [];
    watch.forEach(function (w) {
      if (w.type === 'fund') fundCodes.push(w.code);
      else stockCodes.push(w.code);
    });

    this.setData({
      watch: watch,
      hasWatch: watch.length > 0,
      loading: watch.length > 0,
      quoteError: ''
    });

    if (!watch.length) {
      this.setData({ rows: [], loading: false });
      return Promise.resolve();
    }

    var stockQuotes = [];
    var fundQuotes = [];
    var errors = [];
    var jobs = [];

    if (stockCodes.length) {
      jobs.push(
        api.request('/api/quote', { codes: stockCodes.join(',') }).then(function (data) {
          stockQuotes = data && Array.isArray(data.quotes) ? data.quotes : [];
        }).catch(function (err) {
          errors.push('股票行情：' + ((err && err.message) || '请求失败'));
        })
      );
    }
    if (fundCodes.length) {
      jobs.push(
        api.request('/api/fund/quotes', { codes: fundCodes.join(',') }).then(function (data) {
          fundQuotes = data && Array.isArray(data.items) ? data.items : [];
        }).catch(function (err) {
          errors.push('基金净值：' + ((err && err.message) || '请求失败'));
        })
      );
    }

    return Promise.all(jobs).then(function () {
      var rows = watch.map(function (w) {
        var q = w.type === 'fund' ? pickQuote(fundQuotes, w.code) : pickQuote(stockQuotes, w.code);
        var priceText = '—';
        var pctText = '—';
        var dir = '';
        var dateText = '';
        if (q) {
          if (w.type === 'fund') {
            var nav = format.num(q.nav);
            priceText = nav === null ? '—' : format.fmt(nav, 4);
            pctText = format.pct(q.dayPct);
            dir = format.dir(q.dayPct);
            dateText = q.navDate || '';
          } else {
            priceText = format.fmt(q.price, 2);
            pctText = format.pct(q.changePct);
            dir = format.dir(q.changePct);
          }
        }
        return {
          key: w.type + '|' + w.code,
          code: w.code,
          name: (q && q.name) || w.name || w.code,
          type: w.type,
          typeText: w.type === 'fund' ? '基金' : '股票',
          tagClass: w.type === 'fund' ? 'badge-portfolio' : 'badge-indicator',
          priceText: priceText,
          pctText: pctText,
          dir: dir,
          dateText: dateText
        };
      });
      that.setData({
        rows: rows,
        loading: false,
        quoteError: errors.length ? errors.join('；') + '（下拉刷新重试）' : ''
      });
    }).catch(function (err) {
      that.setData({
        loading: false,
        quoteError: (err && err.message) || '行情刷新失败'
      });
    });
  },

  onSearchInput: function (e) {
    var value = e && e.detail ? e.detail.value : '';
    var keyword = String(value || '').trim();
    this.setData({ searchKey: value });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    if (!keyword) {
      this.setData({ searchResults: [], searching: false, searchTip: '' });
      return;
    }
    var that = this;
    this.setData({ searching: true, searchTip: '搜索中…' });
    this._searchTimer = setTimeout(function () {
      that.doSearch(keyword);
    }, 300);
  },

  doSearch: function (keyword) {
    var that = this;
    var stockJob = api.request('/api/stock/search', { key: keyword, limit: 8 })
      .catch(function () { return { items: [] }; });
    var fundJob = api.request('/api/fund/search', { key: keyword, limit: 8 })
      .catch(function () { return { items: [] }; });

    return Promise.all([stockJob, fundJob]).then(function (res) {
      var list = [];
      var seen = {};
      function append(items, type) {
        if (!Array.isArray(items)) return;
        items.forEach(function (item) {
          if (!item || !item.code) return;
          if (list.length >= 12) return;
          var key = type + '|' + item.code;
          if (seen[key]) return;
          seen[key] = true;
          list.push({
            key: key,
            code: String(item.code),
            name: item.name || String(item.code),
            type: type,
            tagText: type === 'fund' ? (item.type || '基金') : (item.market || '股票')
          });
        });
      }
      append(res[0] && res[0].items, 'stock');
      append(res[1] && res[1].items, 'fund');
      that.setData({
        searching: false,
        searchResults: list,
        searchTip: list.length ? '' : '没有匹配的股票或基金'
      });
    }).catch(function (err) {
      that.setData({
        searching: false,
        searchResults: [],
        searchTip: (err && err.message) || '搜索失败，请重试'
      });
    });
  },

  onClearSearch: function () {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.setData({ searchKey: '', searching: false, searchResults: [], searchTip: '' });
  },

  onAddTap: function (e) {
    var ds = e.currentTarget.dataset || {};
    if (!ds.code) return;
    var type = ds.type === 'fund' ? 'fund' : 'stock';
    var watch = normalizeWatch(storage.read(storage.WATCH_KEY, []));
    var exists = watch.some(function (w) { return w.code === String(ds.code) && w.type === type; });
    if (exists) {
      ui.toast('已经在自选里了');
      return;
    }
    watch.push({ code: String(ds.code), name: ds.name || String(ds.code), type: type });
    storage.write(storage.WATCH_KEY, watch);
    this.onClearSearch();
    ui.toast('已加入自选');
    this.refresh();
  },

  onRowTap: function (e) {
    var ds = e.currentTarget.dataset || {};
    if (!ds.code) return;
    ui.go('/pages/asset/asset?code=' + encodeURIComponent(ds.code) +
      '&type=' + encodeURIComponent(ds.type === 'fund' ? 'fund' : 'stock') +
      '&name=' + encodeURIComponent(ds.name || ''));
  },

  onRowLongPress: function (e) {
    var ds = e.currentTarget.dataset || {};
    if (!ds.code) return;
    var that = this;
    if (typeof wx === 'undefined' || !wx.showActionSheet) return;
    wx.showActionSheet({
      itemList: ['删除自选'],
      success: function (res) {
        if (res && res.tapIndex === 0) that.removeWatch(ds.code, ds.type);
      }
    });
  },

  removeWatch: function (code, type) {
    var watch = normalizeWatch(storage.read(storage.WATCH_KEY, []));
    var next = watch.filter(function (w) {
      return !(w.code === String(code) && w.type === (type === 'fund' ? 'fund' : 'stock'));
    });
    storage.write(storage.WATCH_KEY, next);
    ui.toast('已删除');
    this.refresh();
  },

  onGoHome: function () {
    ui.goTab('/pages/index/index');
  }
});
