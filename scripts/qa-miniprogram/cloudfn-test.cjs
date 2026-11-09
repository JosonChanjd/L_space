'use strict';
/** 云函数 api 协议测试：GET / 查询参数 / POST / 非法路径 / 不存在接口 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const fn = require(path.join(ROOT, 'cloudfunctions', 'api', 'index.js'));

(async () => {
  const cases = [
    ['GET snapshot', { path: '/api/snapshot' }, true],
    ['GET fund/detail', { path: '/api/fund/detail', query: { code: '110022' } }, true],
    ['GET strategy/templates', { path: '/api/strategy/templates' }, true],
    ['POST strategy/validate', { path: '/api/strategy/validate', method: 'POST', body: { buy: 'CROSS(MA(CLOSE,5),MA(CLOSE,20))', sell: 'CLOSE<MA(CLOSE,20)', assetType: 'stock' } }, true],
    ['拒绝非 /api', { path: '/admin' }, false],
    ['不存在接口', { path: '/api/not-exist' }, false],
    ['空 path', {}, false],
  ];
  let failed = 0;
  for (const [name, event, expectOk] of cases) {
    const t0 = Date.now();
    try {
      const res = await fn.main(event, {});
      const pass = res && typeof res.ok === 'boolean' && res.ok === expectOk;
      if (!pass) failed += 1;
      console.log((pass ? 'PASS ' : 'FAIL ') + name + ' :: ' + (Date.now() - t0) + 'ms ok=' + (res && res.ok) + ' ' + String((res && (res.error || '')) || (res.data ? Object.keys(res.data).slice(0, 4).join(',') : '')).slice(0, 120));
    } catch (e) { failed += 1; console.log('FAIL ' + name + ' :: ' + e.message); }
  }
  console.log(`\n云函数协议：${cases.length - failed}/${cases.length} 通过`);
  process.exit(failed ? 1 : 0);
})();
