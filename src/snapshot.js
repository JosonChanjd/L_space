'use strict';

/**
 * 快照落盘 / 读取：data/snapshot.json
 * 抓取成功后写入，整体抓取失败时作为缓存回退。
 */

const fs = require('fs');
const config = require('./config');

/** 读取磁盘缓存；不存在或损坏返回 null（不抛异常） */
function readSnapshot() {
  try {
    const raw = fs.readFileSync(config.SNAPSHOT_FILE, 'utf8');
    if (!raw || !raw.trim()) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.fearGreed || !Array.isArray(data.sections)) {
      return null;
    }
    return data;
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('[snapshot] 读取缓存失败：', err && err.message);
    }
    return null;
  }
}

/** 原子写入（先写 .tmp 再 rename），失败只告警不影响接口 */
function writeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  try {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    const tmpFile = config.SNAPSHOT_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(snapshot, null, 2), 'utf8');
    fs.renameSync(tmpFile, config.SNAPSHOT_FILE);
    return true;
  } catch (err) {
    console.warn('[snapshot] 写入缓存失败：', err && err.message);
    return false;
  }
}

function snapshotExists() {
  try {
    return fs.statSync(config.SNAPSHOT_FILE).isFile();
  } catch (err) {
    return false;
  }
}

module.exports = { readSnapshot, writeSnapshot, snapshotExists };
