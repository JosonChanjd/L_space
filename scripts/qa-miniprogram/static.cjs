'use strict';
/**
 * 小程序静态检查：JSON / JS 语法 / WXML 标签与表达式 / WXSS 括号 / app.json / 35 工具 / API 契约
 * 运行：node scripts/qa-miniprogram/static.cjs
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const MP = path.join(ROOT, 'miniprogram');
const NODE = process.execPath;
const issues = [];
const ok = (m) => console.log('OK  ' + m);
const bad = (m) => { issues.push(m); console.log('ERR ' + m); };

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const files = [...walk(MP), ...walk(path.join(ROOT, 'cloudfunctions'))];
for (const f of files.filter((x) => x.endsWith('.json')).concat(['project.config.json', 'project.private.config.json', 'sitemap.json'].map((x) => path.join(ROOT, x)))) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { bad('JSON 解析失败 ' + path.relative(ROOT, f) + ' :: ' + e.message); }
}
ok('JSON 全部可解析');
for (const f of files.filter((x) => x.endsWith('.js'))) {
  try { execFileSync(NODE, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad('JS 语法错误 ' + path.relative(ROOT, f)); }
}
ok('JS 语法检查完成');
const app = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
for (const page of app.pages) for (const ext of ['js', 'wxml', 'json', 'wxss']) if (!fs.existsSync(path.join(MP, page + '.' + ext))) bad(`缺页面文件 ${page}.${ext}`);
for (const item of (app.tabBar && app.tabBar.list) || []) for (const k of ['iconPath', 'selectedIconPath']) if (item[k] && !fs.existsSync(path.join(MP, item[k]))) bad(`tabBar 图标缺失 ${item[k]}`);
for (const [name, rel] of Object.entries(app.usingComponents || {})) for (const ext of ['js', 'json', 'wxml', 'wxss']) if (!fs.existsSync(path.join(MP, rel.replace(/^\//, '') + '.' + ext))) bad(`组件缺文件 ${name}.${ext}`);
ok(`app.json：${app.pages.length} 页 / tabBar ${((app.tabBar || {}).list || []).length} 项 / 组件 ${Object.keys(app.usingComponents || {}).length} 个`);

const voidTags = new Set(['image', 'input', 'icon', 'progress', 'slider', 'switch', 'checkbox', 'radio', 'import', 'include']);
for (const f of files.filter((x) => x.endsWith('.wxml'))) {
  const rel = path.relative(ROOT, f);
  const src = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of src.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const expr = m[1];
    if (/\.(toFixed|toUpperCase|toLowerCase|replace|slice|map|filter|join)\s*\(/.test(expr)) bad(`WXML mustache 调用 JS 方法 ${rel}: {{${expr.trim().slice(0, 60)}}}`);
  }
  const stack = [];
  for (const m of src.matchAll(/<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const full = m[0], name = m[1];
    if (full.startsWith('</')) {
      const top = stack.pop();
      if (top !== name) { bad(`WXML 标签不匹配 ${rel}: <${top}> vs </${name}>`); break; }
    } else if (!full.endsWith('/>') && !voidTags.has(name)) stack.push(name);
  }
  if (stack.length) bad(`WXML 未闭合 ${rel}: ${stack.join('>')}`);
  if ((src.match(/wx:for=/g) || []).length > (src.match(/wx:key=/g) || []).length) bad(`WXML wx:for 缺 wx:key ${rel}`);
}
ok('WXML 标签/表达式检查完成');
for (const f of files.filter((x) => x.endsWith('.wxss'))) {
  const src = fs.readFileSync(f, 'utf8');
  if ((src.match(/\{/g) || []).length !== (src.match(/\}/g) || []).length) bad('WXSS 花括号不平衡 ' + path.relative(ROOT, f));
}
ok('WXSS 检查完成');

const toolsCfg = require(path.join(MP, 'config', 'tools.js'));
const tools = toolsCfg.TOOLS || [];
const cats = {};
for (const t of tools) cats[t.category] = (cats[t.category] || 0) + 1;
if (tools.length !== 35) bad('工具数量不是 35：' + tools.length);
ok('TOOLS 总数=' + tools.length + ' 分类=' + JSON.stringify(cats));

const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const routes = new Set([...server.matchAll(/pathname === '(\/api\/[^']+)'/g)].map((m) => m[1]));
const apis = new Set();
for (const f of files.filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of src.matchAll(/['"](\/api\/[a-z0-9\/-]+)/g)) apis.add(m[1]);
}
for (const a of apis) if (a !== '/api/xxx' && !routes.has(a)) bad('不存在的后端接口：' + a);
ok('API 契约检查完成（' + apis.size + ' 个）');

console.log(issues.length ? `\n=== ${issues.length} 个问题 ===\n` + issues.join('\n') : '\n=== 静态检查全部通过 ===');
process.exit(issues.length ? 1 : 0);
