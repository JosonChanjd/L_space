/* 韭研 · 小程序格式化工具（utils/format.js）
 * 所有页面共用：缺失值统一显示 “—”，金额/收益 2 位小数。
 */
'use strict';

var DASH = '—';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function groupThousands(intPart) {
  return String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 数字格式化：fmt(1234.5) -> '1,234.50'；缺失 -> '—' */
function fmt(v, digits) {
  var n = num(v);
  if (n === null) return DASH;
  var d = digits === null || digits === undefined ? 2 : digits;
  var fixed = Math.abs(n).toFixed(d);
  var parts = fixed.split('.');
  parts[0] = groupThousands(parts[0]);
  return (n < 0 ? '-' : '') + parts.join('.');
}

/** 带正负号的百分比：pct(1.23) -> '+1.23%' */
function pct(v) {
  var n = num(v);
  if (n === null) return DASH;
  return (n > 0 ? '+' : '') + fmt(n, 2) + '%';
}

/** 金额：大于 1 亿显示 亿，大于 1 万显示 万 */
function fmtMoney(v) {
  var n = num(v);
  if (n === null) return DASH;
  var sign = n < 0 ? '-' : '';
  var abs = Math.abs(n);
  if (abs >= 100000000) return sign + '¥' + fmt(abs / 100000000, 2) + '亿';
  if (abs >= 10000) return sign + '¥' + fmt(abs / 10000, 2) + '万';
  return sign + '¥' + fmt(abs, 2);
}

/** 红涨绿跌类名：dir(v) -> 'up' | 'down' | '' */
function dir(v) {
  var n = num(v);
  if (n === null || n === 0) return '';
  return n > 0 ? 'up' : 'down';
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var n = Number(v);
  if (isFinite(n) && String(v).trim() !== '') {
    var ms = n < 1e12 ? n * 1000 : n;
    var d1 = new Date(ms);
    return isNaN(d1.getTime()) ? null : d1;
  }
  var d2 = new Date(String(v));
  return isNaN(d2.getTime()) ? null : d2;
}

/** 时间戳/日期字符串 -> 'YYYY-MM-DD' */
function fmtDate(v) {
  var d = toDate(v);
  if (!d) return DASH;
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** 时间戳 -> 'HH:mm' */
function fmtTime(v) {
  var d = toDate(v);
  if (!d) return DASH;
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** 今天：'YYYY-MM-DD' */
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function clamp(v, min, max) {
  var n = num(v);
  if (n === null) return min;
  return Math.min(max, Math.max(min, n));
}

module.exports = {
  num: num,
  fmt: fmt,
  pct: pct,
  fmtPct: pct,
  fmtMoney: fmtMoney,
  dir: dir,
  fmtDate: fmtDate,
  fmtTime: fmtTime,
  todayStr: todayStr,
  clamp: clamp,
  pad2: pad2
};
