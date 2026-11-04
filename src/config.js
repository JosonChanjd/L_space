'use strict';

/**
 * 全局配置：端口、标的池、定时抓取时间、恐贪指数权重等。
 * 全部为纯常量，不依赖任何第三方包。
 */

const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');

// ---------- 标的池（顺序即前端展示顺序） ----------

// A股四大指数（市场速览 chips 也用这四个）
const A_INDICES = ['sh000001', 'sz399001', 'sz399006', 'sh000300'];

// A股个股监控池（用于 52 周区间位置 / 上涨占比 / 平均涨跌幅 三因子）
const A_STOCKS = [
  'sh600519', // 贵州茅台
  'sz000001', // 平安银行
  'sz300750', // 宁德时代
  'sh601318', // 中国平安
  'sh600036', // 招商银行
  'sz002594', // 比亚迪
  'sz000858', // 五粮液
  'sh601899', // 紫金矿业
];

const US_CODES = ['usDJI', 'usIXIC', 'usINX', 'usAAPL', 'usNVDA', 'usTSLA'];
const HK_CODES = ['hkHSI', 'hk00700', 'hk09988', 'hk03690'];

const SECTIONS = [
  { id: 'a', title: 'A股市场', codes: [...A_INDICES, ...A_STOCKS] },
  { id: 'us', title: '美股市场', codes: US_CODES },
  { id: 'hk', title: '港股市场', codes: HK_CODES },
];

const PORT = Number.parseInt(process.env.PORT, 10);

module.exports = {
  ROOT_DIR,
  PUBLIC_DIR,
  DATA_DIR,
  INDEX_FILE: path.join(ROOT_DIR, 'index.html'),
  SNAPSHOT_FILE: path.join(DATA_DIR, 'snapshot.json'),

  PORT: Number.isFinite(PORT) && PORT > 0 ? PORT : 8080,
  HOST: process.env.HOST || '0.0.0.0',

  // 每日 19:00 自动抓取（本地时区）
  REFRESH_HOUR: 19,
  REFRESH_MINUTE: 0,

  HTTP_TIMEOUT: 8000,
  HTTP_RETRIES: 3,
  FETCH_CONCURRENCY: 4,
  MAX_QUOTE_CODES: 30,

  A_INDICES,
  A_STOCKS,
  US_CODES,
  HK_CODES,
  SECTIONS,
  CHIPS: A_INDICES,

  // 恐贪指数三因子权重（合计 1）
  FEAR_GREED_WEIGHTS: { trend: 0.4, breadth: 0.35, momentum: 0.25 },

  USER_AGENT:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};
