'use strict';
/**
 * 小程序页面逻辑桩测试（Node 模拟 wx/Page）
 * 覆盖：首页 / 自选 / 我的 / 资产详情 / 策略三页 / 工具箱 + 35 个通用工具页
 * 前置：本地后端运行在 http://localhost:8080（node server.js）
 * 运行：node scripts/qa-miniprogram/harness.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const MP = path.join(ROOT, 'miniprogram');
const BASE = 'http://localhost:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const storage = new Map();
let captured = null;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + String(detail).slice(0, 200) : ''));
}
const clone = (o) => JSON.parse(JSON.stringify(o == null ? o : o));
function buildUrl(p, q) {
  let url = BASE + p;
  if (q && Object.keys(q).length) {
    const qs = Object.keys(q).filter((k) => q[k] !== undefined && q[k] !== null && q[k] !== '')
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(q[k]))).join('&');
    if (qs) url += '?' + qs;
  }
  return url;
}

global.wx = {
  cloud: {
    init() {},
    callFunction(opts) {
      const d = opts.data || {};
      const init = { method: (d.method || 'GET').toUpperCase(), headers: { 'Content-Type': 'application/json' } };
      if (init.method !== 'GET' && d.body !== undefined) init.body = JSON.stringify(d.body);
      fetch(buildUrl(d.path, d.query), init)
        .then((r) => r.text())
        .then((t) => {
          let json; try { json = JSON.parse(t); } catch (e) { json = { ok: false, error: '非 JSON' }; }
          const result = json && json.ok === false ? { ok: false, error: json.error || '接口失败' } : { ok: true, data: json };
          if (opts.success) opts.success({ result }); else if (opts.complete) opts.complete({ result });
        })
        .catch((e) => opts.fail && opts.fail({ errMsg: e.message }));
    },
  },
  request(opts) {
    const init = { method: (opts.method || 'GET').toUpperCase(), headers: { 'Content-Type': 'application/json' } };
    if (init.method !== 'GET' && opts.data !== undefined) init.body = JSON.stringify(opts.data);
    fetch(opts.url, init).then((r) => r.text()).then((t) => {
      let json; try { json = JSON.parse(t); } catch (e) { json = { ok: false, error: '非 JSON' }; }
      opts.success && opts.success({ statusCode: 200, data: json });
    }).catch((e) => opts.fail && opts.fail({ errMsg: e.message }));
    return { abort() {} };
  },
  getStorageSync: (k) => (storage.has(k) ? clone(storage.get(k)) : ''),
  setStorageSync: (k, v) => storage.set(k, clone(v)),
  removeStorageSync: (k) => storage.delete(k),
  clearStorageSync: () => storage.clear(),
  showToast() {}, showLoading() {}, hideLoading() {},
  showModal: (o) => o && o.success && o.success({ confirm: true }),
  showActionSheet: (o) => o && o.success && o.success({ tapIndex: 0 }),
  navigateTo() {}, redirectTo() {}, switchTab() {}, navigateBack() {},
  setNavigationBarTitle() {}, setNavigationBarColor() {}, stopPullDownRefresh() {},
  setClipboardData: (o) => o && o.success && o.success({}),
  getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844, platform: 'devtools' }),
  nextTick: (fn) => setTimeout(fn, 0),
  createSelectorQuery: () => ({ in() { return this; }, select() { return this; }, fields() { return this; }, exec(cb) { cb([]); } }),
};
global.getApp = () => ({ globalData: { version: '1.6', useCloud: true, apiBase: BASE, envId: '', webUrl: 'https://jiuyan-workbench.onrender.com' } });
global.App = () => {};
global.Page = (cfg) => { captured = cfg; };
global.Component = (cfg) => { captured = cfg; };
global.getCurrentPages = () => [];

function loadPage(rel) {
  captured = null;
  const p = path.join(MP, rel);
  delete require.cache[require.resolve(p)];
  require(p);
  if (!captured) throw new Error('页面未注册 Page：' + rel);
  return captured;
}
function instantiate(cfg) {
  const page = {};
  Object.keys(cfg).forEach((k) => { if (k !== 'data') page[k] = cfg[k]; });
  page.data = clone(cfg.data || {});
  page.setData = function (patch) { Object.assign(this.data, clone(patch)); };
  return page;
}
async function settle(page, ms) {
  const limit = ms || 30000, t0 = Date.now();
  while (Date.now() - t0 < limit) {
    if (page && page.data && page.data.loading === false) { await sleep(120); return true; }
    await sleep(200);
  }
  return false;
}
async function runPage(name, rel, options, checks) {
  try {
    const page = instantiate(loadPage(rel));
    if (page.onLoad) await page.onLoad(options || {});
    await settle(page, 30000);
    if (page.onShow) await page.onShow();
    await sleep(250);
    const bad = [];
    await checks(page, bad);
    record(name, bad.length === 0, bad.join(' | '));
    return page;
  } catch (e) {
    record(name, false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e);
    return null;
  }
}

(async () => {
  await runPage('index 首页', 'pages/index/index.js', {}, (p, bad) => {
    if (p.data.loading) bad.push('loading 未结束');
    if (p.data.error) bad.push(p.data.error);
    if (!p.data.fg || !p.data.fg.valueText) bad.push('无恐贪数据');
    if ((p.data.markets || []).length < 3) bad.push('市场数=' + (p.data.markets || []).length);
  });
  await runPage('watch 自选(空)', 'pages/watch/watch.js', {}, (p, bad) => {
    if (p.data.loading) bad.push('loading 未结束');
    if (p.data.error) bad.push(p.data.error);
  });
  storage.set('jy_mp_watch_v1', [{ code: '600519', name: '贵州茅台', type: 'stock' }, { code: '110022', name: '易方达消费行业股票', type: 'fund' }]);
  await runPage('watch 自选(有数据)', 'pages/watch/watch.js', {}, (p, bad) => {
    if (p.data.loading) bad.push('loading 未结束');
    if ((p.data.rows || []).length < 2) bad.push('rows=' + (p.data.rows || []).length);
    if (p.data.quoteError) bad.push(p.data.quoteError);
  });
  await runPage('mine 我的', 'pages/mine/mine.js', {}, () => {});
  await runPage('asset 基金 110022', 'pages/asset/asset.js', { code: '110022', type: 'fund' }, (p, bad) => {
    if (p.data.loading) bad.push('loading 未结束');
    if (p.data.error) bad.push(p.data.error);
    if (!p.data.fund && !p.data.name) bad.push('无基金数据');
  });
  await runPage('asset 股票 600519', 'pages/asset/asset.js', { code: '600519', type: 'stock' }, (p, bad) => {
    if (p.data.loading) bad.push('loading 未结束');
    if (p.data.error) bad.push(p.data.error);
    if (!p.data.stock || !p.data.stock.priceText || p.data.stock.priceText === '—') bad.push('无行情');
    const pts = p.data.chartSeries && p.data.chartSeries[0] && p.data.chartSeries[0].points;
    if (!pts || pts.length < 50) bad.push('K线点=' + (pts || []).length);
  });

  await runPage('strategy 策略首页', 'pages/strategy/strategy.js', {}, (p, bad) => {
    if ((p.data.indicatorTemplates || []).length !== 7) bad.push('指标模板=' + (p.data.indicatorTemplates || []).length);
    if ((p.data.portfolioTemplates || []).length !== 5) bad.push('组合模板=' + (p.data.portfolioTemplates || []).length);
    if (p.data.tplError) bad.push(p.data.tplError);
  });
  const createPage = await runPage('strategy-create 新建', 'pages/strategy-create/strategy-create.js', {}, (p, bad) => {
    if (!p.data.asset || !p.data.asset.code) bad.push('默认标的缺失');
    if (!p.data.buy || !p.data.sell) bad.push('默认公式缺失');
    if ((p.data.helpers || []).length < 8) bad.push('助手=' + (p.data.helpers || []).length);
  });
  if (createPage) {
    try { await createPage.onValidate(); } catch (e) { record('strategy-create 校验异常', false, e.message); }
    const vs = createPage.data.validateState || {};
    record('strategy-create 校验公式', !!(vs.text && vs.cls), 'state=' + JSON.stringify(vs).slice(0, 120));
    try { await createPage.onBacktest(); } catch (e) { record('strategy-create 回测异常', false, e.message); }
    const t0 = Date.now();
    while (Date.now() - t0 < 60000 && (!createPage.data.preview || createPage.data.preview.loading !== false)) await sleep(250);
    const pv = createPage.data.preview || {};
    record('strategy-create 回测预览', !!(pv.kpis && pv.kpis.length >= 5), 'kpis=' + (pv.kpis || []).length + ' err=' + (pv.error || ''));
    createPage.data.name = '小程序测试指标策略';
    try { createPage.onSave(); } catch (e) { record('strategy-create 保存异常', false, e.message); }
    await sleep(400);
    const list = storage.get('jy_mp_strategies_v1') || [];
    record('strategy-create 保存 storage', list.some((s) => s.type === 'indicator' && s.name === '小程序测试指标策略'), 'count=' + list.length);
  }
  const savedId = ((storage.get('jy_mp_strategies_v1') || [])[0] || {}).id;
  await runPage('strategy-detail 模板', 'pages/strategy-detail/strategy-detail.js', { mode: 'template', key: 'td-nine' }, (p, bad) => {
    if (p.data.error) bad.push(p.data.error);
    if (!p.data.hero || !p.data.hero.retText) bad.push('hero 缺失');
    if ((p.data.trades || []).length === 0) bad.push('无交易明细');
    if (!(p.data.chartSeries || []).length) bad.push('无图表');
  });
  await runPage('strategy-detail 我的', 'pages/strategy-detail/strategy-detail.js', { mode: 'indicator', id: savedId }, (p, bad) => {
    if (p.data.error) bad.push(p.data.error);
    if (!p.data.hero || !p.data.hero.retText) bad.push('hero 缺失');
  });
  await runPage('strategy-detail 组合模板', 'pages/strategy-detail/strategy-detail.js', { mode: 'portfolio', id: 'tpl-balance' }, (p, bad) => {
    if (p.data.error) bad.push(p.data.error);
    if (!p.data.hero || !p.data.hero.retText) bad.push('hero 缺失');
  });

  const tools = require(path.join(MP, 'config', 'tools.js')).TOOLS || [];
  await runPage('tools 工具箱 Hub', 'pages/tools/tools.js', {}, (p, bad) => {
    const total = (p.data.groups || []).reduce((n, g) => n + (g.items || []).length, 0);
    if (total !== 35) bad.push('总工具=' + total);
  });
  const toolPageCfg = loadPage('pages/tool/tool.js');
  for (const t of tools) {
    const page = instantiate(toolPageCfg);
    try {
      await page.onLoad({ key: t.key });
      await settle(page, 30000);
      const d = page.data || {};
      const bad = [];
      if (d.loading) bad.push('loading 未结束');
      if (d.error) bad.push('error=' + String(d.error).slice(0, 100));
      if (d.hasData === false) bad.push('hasData=false');
      const rows = d.table && Array.isArray(d.table.rows) ? d.table.rows.length : 0;
      const custom = d.showGauge || d.showDca || d.showLedger || d.showAlerts || d.showLive || d.showBacktest;
      if (!(d.kpis && d.kpis.length) && !rows && !(d.chartSeries && d.chartSeries.length) && !custom) bad.push('无渲染内容');
      record('tool:' + t.key, bad.length === 0, bad.join(' | '));
    } catch (e) {
      record('tool:' + t.key, false, e && e.message ? e.message : e);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== 汇总：${results.length - failed.length}/${results.length} 通过 ===`);
  if (failed.length) failed.forEach((f) => console.log(' - ' + f.name + ' :: ' + f.detail));
  process.exit(failed.length ? 1 : 0);
})();
