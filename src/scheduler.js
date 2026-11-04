'use strict';

/**
 * 定时器：每日 19:00（本地时区）自动抓取一次，并对外提供 nextRefreshAt。
 */

const config = require('./config');

let timer = null;
let nextRefreshAt = 0;
let running = false;

/** 计算 now 之后的下一次 19:00 时间戳（今天没过 19:00 就是今天，否则明天） */
function computeNextRefreshAt(from = Date.now()) {
  const base = new Date(from);
  const next = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    config.REFRESH_HOUR,
    config.REFRESH_MINUTE,
    0,
    0
  );
  if (next.getTime() <= base.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

/** 当前计划中的下次刷新时间；若已过期则重新计算 */
function getNextRefreshAt() {
  if (nextRefreshAt && nextRefreshAt > Date.now() + 500) return nextRefreshAt;
  return computeNextRefreshAt();
}

function formatTime(ms) {
  try {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false });
  } catch (err) {
    return new Date(ms).toISOString();
  }
}

function scheduleNext() {
  nextRefreshAt = computeNextRefreshAt();
  const delay = Math.max(1000, nextRefreshAt - Date.now());
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    run().catch((err) => console.error('[scheduler] 定时任务异常：', err && err.message));
  }, delay);
  console.log(
    '[scheduler] 下次自动抓取：' +
      formatTime(nextRefreshAt) +
      '（约 ' +
      Math.round(delay / 60000) +
      ' 分钟后）'
  );
}

async function run() {
  if (running) return;
  running = true;
  console.log('[scheduler] 触发每日自动抓取…');
  try {
    // 延迟 require，避免 collect ↔ scheduler 的循环依赖
    const { refresh } = require('./collect');
    const snapshot = await refresh();
    console.log(
      '[scheduler] 自动抓取完成：source=' +
        snapshot.source +
        '，updatedAt=' +
        formatTime(snapshot.updatedAt)
    );
  } catch (err) {
    console.error('[scheduler] 自动抓取失败：', err && err.message ? err.message : err);
  } finally {
    running = false;
    // 无论成功失败都排下一次，保证服务长时间运行不丢定时
    scheduleNext();
  }
}

function start() {
  if (timer) return;
  scheduleNext();
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function getStatus() {
  return {
    nextRefreshAt: getNextRefreshAt(),
    nextRefreshText: formatTime(getNextRefreshAt()),
    running,
    enabled: Boolean(timer),
    hour: config.REFRESH_HOUR,
    minute: config.REFRESH_MINUTE,
  };
}

module.exports = { computeNextRefreshAt, getNextRefreshAt, start, stop, getStatus, formatTime };
