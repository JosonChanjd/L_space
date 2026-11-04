'use strict';

/**
 * 恐贪指数历史（data/fear-history.json）
 *
 * - collect.js 每次成功/缓存快照后调用 recordSnapshot(snapshot) 追加当日记录
 * - 同一天覆盖（按本地日期 'YYYY-MM-DD'）
 * - 最多保留 365 条，原子写入（.tmp + rename）
 * - 演示数据（source='demo'）不写入，避免污染历史
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const HISTORY_FILE = path.join(config.DATA_DIR, 'fear-history.json');
const MAX_RECORDS = 365;

function pad2(num) {
  return String(num).padStart(2, '0');
}

function localDate(ts) {
  const date = new Date(Number(ts) || Date.now());
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function isValidRecord(item) {
  return Boolean(
    item &&
      typeof item.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
      Number.isFinite(Number(item.value))
  );
}

function sortByDate(items) {
  return items.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 读取全部历史（按日期升序）；文件不存在/损坏返回 [] */
function readAll() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    if (!raw || !raw.trim()) return [];
    const data = JSON.parse(raw);
    const items = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : [];
    return sortByDate(items.filter(isValidRecord));
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('[fearHistory] 读取历史失败：', err && err.message);
    }
    return [];
  }
}

function writeAll(items) {
  try {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    const tmpFile = HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify({ updatedAt: Date.now(), items: items }, null, 2), 'utf8');
    fs.renameSync(tmpFile, HISTORY_FILE);
    return true;
  } catch (err) {
    console.warn('[fearHistory] 写入历史失败：', err && err.message);
    return false;
  }
}

/**
 * 用当前快照记录当日恐贪值（同一天覆盖）。
 * @param {object} snapshot collect.js 的快照对象
 * @returns {{date:string,value:number,level:string}|null}
 */
function recordSnapshot(snapshot) {
  try {
    if (!snapshot || !snapshot.fearGreed) return null;
    if (snapshot.source === 'demo') return null;

    const value = Number(snapshot.fearGreed.value);
    if (!Number.isFinite(value)) return null;

    const date = localDate(snapshot.updatedAt || Date.now());
    const level = typeof snapshot.fearGreed.level === 'string' ? snapshot.fearGreed.level : '';
    const record = { date, value: Math.round(value * 10) / 10, level };

    const items = readAll();
    const existing = items.find((item) => item.date === date);
    if (existing) {
      // 同日值没变化就不写盘，减少 IO（前端每 60s 轮询快照）
      if (existing.value === record.value && existing.level === record.level) {
        return { date: existing.date, value: existing.value, level: existing.level };
      }
      existing.value = record.value;
      existing.level = record.level;
    } else {
      items.push(record);
    }

    const trimmed = sortByDate(items).slice(-MAX_RECORDS);
    writeAll(trimmed);
    return record;
  } catch (err) {
    console.warn('[fearHistory] 记录恐贪历史失败：', err && err.message);
    return null;
  }
}

/**
 * 近 N 个自然日（含今天）的恐贪历史，按日期升序。
 * @param {number} days 1-365，默认 30
 */
function getHistory(days) {
  const count = Math.min(MAX_RECORDS, Math.max(1, Number.parseInt(days, 10) || 30));
  const items = readAll();
  if (!items.length) return [];
  const cutoff = localDate(Date.now() - (count - 1) * 86400000);
  return items.filter((item) => item.date >= cutoff);
}

/** 历史记录条数（健康检查/调试用） */
function count() {
  return readAll().length;
}

module.exports = {
  HISTORY_FILE,
  recordSnapshot,
  getHistory,
  readAll,
  count,
  MAX_RECORDS,
  _localDate: localDate,
};
