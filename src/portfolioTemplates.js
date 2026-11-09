'use strict';

/**
 * 组合策略模板（与网页版 public/strategy.js 的 5 套推荐组合一致）
 * 供 /api/portfolio/templates 与小程序「推荐组合策略」使用。
 */

const TEMPLATES = [
  {
    id: 'tpl-gold',
    name: '黄金恐贪1期',
    icon: '🥇',
    desc: '黄金 ETF 联接基金满仓跟踪金价，季度再平衡，用恐贪指数辅助判断节奏。',
    rebalance: 'quarterly',
    capital: 100000,
    baseYears: 3,
    holdings: [{ code: '004253', name: '国泰黄金ETF联接C', type: 'fund', weight: 100 }],
  },
  {
    id: 'tpl-dividend',
    name: '红利低波',
    icon: '🧧',
    desc: '红利 ETF + 红利低波 ETF + 低波固收资产，季度再平衡。',
    rebalance: 'quarterly',
    capital: 100000,
    baseYears: 5,
    holdings: [
      { code: '510880', name: '红利ETF', type: 'fund', weight: 30 },
      { code: '512890', name: '红利低波ETF', type: 'fund', weight: 30 },
      { code: '003096', name: '低波固收基金', type: 'fund', weight: 40 },
    ],
  },
  {
    id: 'tpl-global',
    name: '全球资产配置',
    icon: '🌍',
    desc: '沪深300 + 纳指 + 黄金 + 固收的多资产组合，季度再平衡。',
    rebalance: 'quarterly',
    capital: 100000,
    baseYears: 5,
    holdings: [
      { code: '510300', name: '沪深300ETF', type: 'fund', weight: 40 },
      { code: '513100', name: '纳指ETF', type: 'fund', weight: 30 },
      { code: '518880', name: '黄金ETF', type: 'fund', weight: 20 },
      { code: '003096', name: '低波固收基金', type: 'fund', weight: 10 },
    ],
  },
  {
    id: 'tpl-tech',
    name: '科技成长',
    icon: '🚀',
    desc: '纳指 + AI + 创业板50 三线成长，季度再平衡，波动较高。',
    rebalance: 'quarterly',
    capital: 100000,
    baseYears: 3,
    holdings: [
      { code: '513100', name: '纳指ETF', type: 'fund', weight: 50 },
      { code: '515070', name: 'AI ETF', type: 'fund', weight: 30 },
      { code: '159949', name: '创业板50ETF', type: 'fund', weight: 20 },
    ],
  },
  {
    id: 'tpl-balance',
    name: '股债平衡',
    icon: '⚖️',
    desc: '沪深300 与固收资产 5:5 经典平衡，季度再平衡。',
    rebalance: 'quarterly',
    capital: 100000,
    baseYears: 5,
    holdings: [
      { code: '510300', name: '沪深300ETF', type: 'fund', weight: 50 },
      { code: '003096', name: '低波固收基金', type: 'fund', weight: 50 },
    ],
  },
];

function getPortfolioTemplates() {
  return { ok: true, items: TEMPLATES, source: 'builtin' };
}

module.exports = { getPortfolioTemplates, TEMPLATES };
