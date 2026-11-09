/* 韭研 · 小程序工具箱 —— 35 个工具注册表
 * 与网页版（public/tools.js + tools-fund/strategy/track/other.js）的 JYXT.register 一一对应：
 *   挑选基金 8 / 制定策略 19 / 跟踪管理 4 / 其他工具 4 = 35
 * 通用工具页 pages/tool/tool 按本表渲染参数表单与结果（KPI/图表/表格/notes/custom）。
 *
 * 字段说明：
 *   api        请求路径（不拼接 query；fixed 里的 query 由页面合并）
 *   query      固定查询参数（用户不可见）
 *   params     表单参数：input / picker / search；name 即传给后端的参数名
 *   method     GET / POST（本项目 35 个工具均为 GET）
 *   render.kpis    [{label, path, type}]  type: num|int|pct|signed|percentile|yield|money|yi|text
 *   render.chart   {path, name, percent}   path 支持点路径；数组元素 {t,v}/{date,value}/数字/带 series 的对象
 *   render.table   {path, columns:[{label,path,type}], limit}
 *   render.notes   [string]
 *   custom     'fear' | 'gauge' | 'backtest' | 'dca' | 'ledger' | 'alerts' | 'live' | null
 */

var CATEGORIES = [
  { key: 'fund', title: '挑选基金', icon: '📈', desc: '排行 / 筛选 / 诊断 / PK / 相似' },
  { key: 'strategy', title: '制定策略', icon: '🧭', desc: '恐贪 / 估值 / 股债 / 板块情绪 / 比价' },
  { key: 'track', title: '跟踪管理', icon: '📌', desc: '账本 / 提醒 / 组合回测 / 组合实盘' },
  { key: 'other', title: '其他工具', icon: '🧩', desc: '经理评分 / 大佬PK / 选股 / 定投计算' }
];

var TYPE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'gp', label: '股票型' },
  { value: 'hh', label: '混合型' },
  { value: 'zq', label: '债券型' },
  { value: 'zs', label: '指数型' },
  { value: 'qdii', label: 'QDII' }
];

var SORT_OPTIONS = [
  { value: '1nzf', label: '近1年收益' },
  { value: '3yzf', label: '近3年收益' },
  { value: '6yzf', label: '近6月收益' },
  { value: '1yzf', label: '近1月收益' },
  { value: 'jnzf', label: '今年来收益' },
  { value: 'rzdf', label: '日涨幅' }
];

var REBALANCE_OPTIONS = [
  { value: 'quarterly', label: '按季度再平衡' },
  { value: 'monthly', label: '按月再平衡' },
  { value: 'none', label: '不再平衡' }
];

var YEARS_OPTIONS = [
  { value: '1', label: '1 年' },
  { value: '2', label: '2 年' },
  { value: '3', label: '3 年' },
  { value: '5', label: '5 年' }
];

var TOOLS = [
  // ==================== 挑选基金（8） ====================
  {
    key: 'etf',
    title: 'ETF',
    icon: '📊',
    category: 'fund',
    desc: '按涨幅 / 成交额 / 换手率浏览全市场 ETF',
    api: '/api/fund/etf',
    query: { page: 1, size: 20 },
    method: 'GET',
    params: [
      { name: 'sort', label: '榜单', type: 'picker', default: 'f3', options: [
        { value: 'f3', label: '涨幅榜' },
        { value: 'f6', label: '成交额榜' },
        { value: 'f8', label: '换手榜' }
      ] }
    ],
    render: {
      kpis: [],
      table: {
        path: 'items',
        limit: 20,
        columns: [
          { label: '名称', path: 'name' },
          { label: '代码', path: 'code' },
          { label: '现价', path: 'price', type: 'num' },
          { label: '涨跌幅', path: 'changePct', type: 'signed' },
          { label: '成交额', path: 'amount', type: 'money' },
          { label: '换手率', path: 'turnover', type: 'pct' }
        ]
      },
      notes: ['ETF 行情来自东方财富公开数据，红涨绿跌，仅供参考。']
    },
    custom: null
  },
  {
    key: 'insight-pool',
    title: '灵感基金池',
    icon: '💡',
    category: 'fund',
    desc: '按类型查看近 1 年收益居前的基金，寻找组合灵感',
    api: '/api/fund/rank',
    query: { sort: '1nzf', page: 1, size: 20 },
    method: 'GET',
    params: [
      { name: 'type', label: '基金池类型', type: 'picker', default: 'hh', options: [
        { value: 'hh', label: '稳健混合' },
        { value: 'zs', label: '指数型' },
        { value: 'gp', label: '股票成长' },
        { value: 'zq', label: '低波债券' }
      ] }
    ],
    render: {
      kpis: [],
      table: {
        path: 'items',
        limit: 20,
        columns: [
          { label: '名称', path: 'name' },
          { label: '代码', path: 'code' },
          { label: '近1年', path: 'y1', type: 'signed' },
          { label: '近3年', path: 'y3', type: 'signed' },
          { label: '今年来', path: 'ytd', type: 'signed' }
        ]
      },
      notes: ['按类型筛选近 1 年收益居前的基金作为灵感池，非投资建议。']
    },
    custom: null
  },
  {
    key: 'fund-screen',
    title: '基金筛选',
    icon: '🔎',
    category: 'fund',
    desc: '按类型与阶段收益下限筛选基金',
    api: '/api/fund/screen',
    query: { page: 1, size: 20 },
    method: 'GET',
    params: [
      { name: 'type', label: '基金类型', type: 'picker', default: 'all', options: TYPE_OPTIONS },
      { name: 'minY1', label: '近1年收益下限 (%)', type: 'input', default: '', inputType: 'digit', placeholder: '如 20' },
      { name: 'minY3', label: '近3年收益下限 (%)', type: 'input', default: '', inputType: 'digit', placeholder: '如 50' },
      { name: 'minYtd', label: '今年来收益下限 (%)', type: 'input', default: '', inputType: 'digit', placeholder: '如 10' },
      { name: 'sort', label: '排序', type: 'picker', default: '1nzf', options: SORT_OPTIONS }
    ],
    render: {
      kpis: [],
      table: {
        path: 'items',
        limit: 20,
        columns: [
          { label: '名称', path: 'name' },
          { label: '代码', path: 'code' },
          { label: '单位净值', path: 'nav', type: 'num' },
          { label: '近1年', path: 'y1', type: 'signed' },
          { label: '近3年', path: 'y3', type: 'signed' },
          { label: '今年来', path: 'ytd', type: 'signed' }
        ]
      },
      notes: ['筛选条件留空表示不限，结果按所选排序展示前 20 只。']
    },
    custom: null
  },
  {
    key: 'fund-rank',
    title: '基金排行',
    icon: '🏆',
    category: 'fund',
    desc: '按阶段收益查看基金排行榜',
    api: '/api/fund/rank',
    query: { page: 1, size: 20 },
    method: 'GET',
    params: [
      { name: 'type', label: '基金类型', type: 'picker', default: 'all', options: TYPE_OPTIONS },
      { name: 'sort', label: '排序', type: 'picker', default: '1nzf', options: SORT_OPTIONS }
    ],
    render: {
      kpis: [],
      table: {
        path: 'items',
        limit: 20,
        columns: [
          { label: '名称', path: 'name' },
          { label: '代码', path: 'code' },
          { label: '单位净值', path: 'nav', type: 'num' },
          { label: '日涨幅', path: 'dayPct', type: 'signed' },
          { label: '近1年', path: 'y1', type: 'signed' },
          { label: '近3年', path: 'y3', type: 'signed' }
        ]
      },
      notes: ['排行数据来自天天基金公开接口，首次加载可能较慢，可下拉刷新。']
    },
    custom: null
  },
  {
    key: 'manager-pick',
    title: '牛人选基',
    icon: '🎖️',
    category: 'fund',
    desc: '按基金经理星级与业绩筛选基金',
    api: '/api/fund/manager-pick',
    query: { limit: 8 },
    method: 'GET',
    params: [],
    render: {
      kpis: [],
      table: {
        path: 'items',
        limit: 8,
        columns: [
          { label: '基金', path: 'fund.name' },
          { label: '代码', path: 'fund.code' },
          { label: '经理', path: 'manager.name' },
          { label: '星级', path: 'manager.star' },
          { label: '任职', path: 'manager.workTime' },
          { label: '近1年', path: 'y1', type: 'signed' }
        ]
      },
      notes: ['按基金经理星级与业绩筛选，非投资建议。']
    },
    custom: null
  },
  {
    key: 'fund-diagnose',
    title: '基金诊断',
    icon: '🩺',
    category: 'fund',
    desc: '五维评分诊断单只基金',
    api: '/api/fund/diagnose',
    query: {},
    method: 'GET',
    params: [
      { name: 'code', label: '基金代码', type: 'search', searchType: 'fund', default: '110022', placeholder: '输入基金代码/名称搜索' }
    ],
    render: {
      kpis: [
        { label: '综合评分', path: 'score', type: 'num' },
        { label: '评级', path: 'grade', type: 'text' },
        { label: '近1年', path: 'stage.y1', type: 'signed' },
        { label: '近3年', path: 'stage.y3', type: 'signed' },
        { label: '最大回撤', path: 'risk.maxDrawdown', type: 'signed' }
      ],
      table: {
        path: 'dims',
        limit: 8,
        columns: [
          { label: '维度', path: 'label' },
          { label: '得分', path: 'score', type: 'num' },
          { label: '说明', path: 'desc' }
        ]
      },
      notes: ['评分基于收益、风险、经理、稳定性与规模适配五维计算，仅供参考。']
    },
    custom: null
  },
  {
    key: 'fund-pk',
    title: '基金PK',
    icon: '⚔️',
    category: 'fund',
    desc: '多只基金归一化走势与指标对比',
    api: '/api/fund/compare',
    query: {},
    method: 'GET',
    params: [
      { name: 'codes', label: '基金代码（2-4 只）', type: 'input', default: '110022,161725', placeholder: '多个代码用英文逗号分隔' }
    ],
    render: {
      kpis: [],
      chart: { path: 'items', name: '归一化净值走势', percent: true },
      table: {
        path: 'items',
        limit: 4,
        columns: [
          { label: '基金', path: 'name' },
          { label: '类型', path: 'type' },
          { label: '近1月', path: 'stage.m1', type: 'signed' },
          { label: '近1年', path: 'stage.y1', type: 'signed' },
          { label: '最大回撤', path: 'risk.maxDrawdown', type: 'signed' }
        ]
      },
      notes: ['走势以共同起点归一化为 0%，最多对比 4 只基金。']
    },
    custom: null
  },
  {
    key: 'fund-similar',
    title: '相似基金',
    icon: '🧬',
    category: 'fund',
    desc: '基于近 6 月 / 1 年 / 3 年收益向量找相似基金',
    api: '/api/fund/similar',
    query: {},
    method: 'GET',
    params: [
      { name: 'code', label: '基准基金', type: 'search', searchType: 'fund', default: '110022', placeholder: '输入基金代码/名称搜索' }
    ],
    render: {
      kpis: [
        { label: '基准基金', path: 'base.name', type: 'text' },
        { label: '类型', path: 'base.type', type: 'text' }
      ],
      table: {
        path: 'items',
        limit: 10,
        columns: [
          { label: '名称', path: 'name' },
          { label: '代码', path: 'code' },
          { label: '近6月', path: 'm6', type: 'signed' },
          { label: '近1年', path: 'y1', type: 'signed' },
          { label: '近3年', path: 'y3', type: 'signed' },
          { label: '相似度', path: 'score', type: 'num' }
        ]
      },
      notes: ['基于近 6 月 / 近 1 年 / 近 3 年收益向量的相似度排序，仅供参考。']
    },
    custom: null
  },

  // ==================== 制定策略（19） ====================
  {
    key: 'fear-greed',
    title: '恐贪指数',
    icon: '😱',
    category: 'strategy',
    desc: '三因子合成的市场情绪指数与等级',
    api: '/api/snapshot',
    query: {},
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '恐贪值', path: 'fearGreed.value', type: 'num' },
        { label: '恐贪等级', path: 'fearGreed.level', type: 'text' }
      ],
      notes: ['恐贪指数把市场情绪量化为 0-100：0-20 极度恐惧、20-40 恐惧、40-60 中性、60-80 贪婪、80-100 极度贪婪。']
    },
    custom: 'fear'
  },
  {
    key: 'emotion-panel',
    title: '情绪面板',
    icon: '🌡️',
    category: 'strategy',
    desc: '恐贪 + 估值 + 行业广度的综合情绪面板',
    api: '/api/emotion/panel',
    query: {},
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '恐贪值', path: 'fearGreed.value', type: 'num' },
        { label: '恐贪等级', path: 'fearGreed.level', type: 'text' },
        { label: '沪深300 PE', path: 'valuation.hs300.pe', type: 'num' },
        { label: 'PE 分位', path: 'valuation.hs300.pePercentile', type: 'percentile' },
        { label: '上涨家数', path: 'industries.up', type: 'int' },
        { label: '平均涨幅', path: 'industries.avgPct', type: 'signed' }
      ],
      chart: { path: 'fearHistory', name: '恐贪指数历史', percent: false },
      table: {
        path: 'indices',
        limit: 10,
        columns: [
          { label: '指数', path: 'name' },
          { label: '现价', path: 'price', type: 'num' },
          { label: '涨跌幅', path: 'changePct', type: 'signed' }
        ]
      },
      notes: ['综合信号由恐贪、估值分位与行业广度加权判断，仅供参考。']
    },
    custom: 'fear'
  },
  {
    key: 'index-valuation',
    title: '指数估值',
    icon: '📊',
    category: 'strategy',
    desc: '主要指数 PE / PB / 分位与股息率',
    api: '/api/index-valuation',
    query: {},
    method: 'GET',
    params: [],
    render: {
      kpis: [],
      table: {
        path: 'items',
        limit: 20,
        columns: [
          { label: '指数', path: 'name' },
          { label: 'PE', path: 'pe', type: 'num' },
          { label: 'PE分位', path: 'pePercentile', type: 'percentile' },
          { label: 'PB', path: 'pb', type: 'num' },
          { label: '股息率', path: 'yeild', type: 'yield' }
        ]
      },
      notes: ['指数估值来自蛋卷基金公开数据，分位越低越便宜，仅供参考。']
    },
    custom: null
  },
  {
    key: 'stock-bond',
    title: '股债性价比',
    icon: '⚖️',
    category: 'strategy',
    desc: '沪深300 盈利收益率与 10Y 国债的 ERP 差值',
    api: '/api/analytics/stock-bond',
    query: { bondYield: 2 },
    method: 'GET',
    params: [
      { name: 'bondYield', label: '10Y 国债收益率参考值 (%)', type: 'input', default: '2.0', inputType: 'digit', placeholder: '默认 2.0' }
    ],
    render: {
      kpis: [
        { label: '盈利收益率 EP', path: 'hs300.ep', type: 'pct' },
        { label: '国债参考值', path: 'bondYield', type: 'pct' },
        { label: 'ERP', path: 'erp', type: 'num' },
        { label: '性价比区间', path: 'zone.label', type: 'text' }
      ],
      notes: ['国债收益率为手动参考值（公开接口不可用），可修改后重新查询；ERP = 盈利收益率 - 国债收益率。']
    },
    custom: null
  },

  // ---- 板块恐贪 12 个 ----
  {
    key: 'fear-jingong',
    title: '军工恐贪',
    icon: '🛡️',
    category: 'strategy',
    desc: '以军工 ETF（sh512660）作为板块情绪代理',
    api: '/api/fear/asset',
    query: { key: 'jingong' },
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '标的现价', path: 'quote.price', type: 'num' },
        { label: '涨跌幅', path: 'quote.changePct', type: 'signed' }
      ],
      notes: ['以对应 ETF / 指数为代理，按 52 周区间位置、动量与回撤合成情绪，仅供参考。']
    },
    custom: 'gauge'
  },
  {
    key: 'fear-quanshang',
    title: '券商恐贪',
    icon: '💹',
    category: 'strategy',
    desc: '以券商 ETF（sh512000）作为板块情绪代理',
    api: '/api/fear/asset',
    query: { key: 'quanshang' },
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '标的现价', path: 'quote.price', type: 'num' },
        { label: '涨跌幅', path: 'quote.changePct', type: 'signed' }
      ],
      notes: ['以对应 ETF / 指数为代理，按 52 周区间位置、动量与回撤合成情绪，仅供参考。']
    },
    custom: 'gauge'
  },
  {
    key: 'fear-newenergy',
    title: '新能源车恐贪',
    icon: '🚗',
    category: 'strategy',
    desc: '以新能源车 ETF（sh515030）作为板块情绪代理',
    api: '/api/fear/asset',
    query: { key: 'newenergy' },
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '标的现价', path: 'quote.price', type: 'num' },
        { label: '涨跌幅', path: 'quote.changePct', type: 'signed' }
      ],
      notes: ['以对应 ETF / 指数为代理，按 52 周区间位置、动量与回撤合成情绪，仅供参考。']
    },
    custom: 'gauge'
  },
  {
    key: 'fear-guangfu',
    title: '光伏恐贪',
    icon: '☀️',
    category: 'strategy',
    desc: '以光伏 ETF（sh515790）作为板块情绪代理',
    api: '/api/fear/asset',
    query: { key: 'guangfu' },
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '标的现价', path: 'quote.price', type: 'num' },
        { label: '涨跌幅', path: 'quote.changePct', type: 'signed' }
      ],
      notes: ['以对应 ETF / 指数为代理，按 52 周区间位置、动量与回撤合成情绪，仅供参考。']
    },
    custom: 'gauge'
  },
  {
    key: 'fear-dianchi',
    title: '电池恐贪',
    icon: '🔋',
    category: 'strategy',
    desc: '以电池 ETF（sz159755）作为板块情绪代理',
    api: '/api/fear/asset',
    query: { key: 'dianchi' },
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '标的现价', path: 'quote.price', type: 'num' },
        { label: '涨跌幅', path: 'quote.changePct', type: 'signed' }
      ],
      notes: ['以对应 ETF / 指数为代理，按 52 周区间位置、动量与回撤合成情绪，仅供参考。']
    },
    custom: 'gauge'
  },
  {
    key: 'fear-hangye',
    title: '行业恐贪',
    icon: '🏭',
    category: 'strategy',
    desc: '以行业板块涨跌广度聚合计算行业情绪',
    api: '/api/fear/asset',
    query: { key: 'hangye' },
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '标的现价', path: 'quote.price', type: 'num' },
        { label: '涨跌幅', path: 'quote.changePct', type: 'signed' }
      ],
      notes: ['以东方财富行业板块上涨占比、平均涨幅与强势行业占比聚合计算，仅供参考。']
    },
    custom: 'gauge'
  },
  {
    key: 'fear-chuang50',
    title: '创50恐贪',
    icon: '🚀',
    category: 'strategy',
    desc: '以创业板 50 ETF（sz159949）作为板块情绪代理',
    api: '/api/fear/asset',
    query: { key: 'chuang50' },
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '标的现价', path: 'quote.price', type: 'num' },
        { label: '涨跌幅', path: 'quote.changePct', type: 'signed' }
      ],
      notes: ['以对应 ETF / 指数为代理，按 52 周区间位置、动量与回撤合成情绪，仅供参考。']
    },
    custom: 'gauge'
  },
  {
    key: 'fear-us',
    title: '美股恐贪',
    icon: '🇺🇸',
    category: 'strategy',
    desc: '以纳斯达克指数（usIXIC）作为美股情绪代理',
    api: '/api/fear/asset',
    query: { key: 'us' },
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '标的现价', path: 'quote.price', type: 'num' },
        { label: '涨跌幅', path: 'quote.changePct', type: 'signed' }
      ],
      notes: ['以纳斯达克指数为代理，按 52 周区间位置、动量与回撤合成情绪，仅供参考。']
    },
    custom: 'gauge'
  },
  {
    key: 'fear-a500',
    title: 'A500恐贪',
    icon: '📈',
    category: 'strategy',
    desc: '以中证 A500 ETF（sh512050）作为宽基情绪代理',
    api: '/api/fear/asset',
    query: { key: 'a500' },
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '标的现价', path: 'quote.price', type: 'num' },
        { label: '涨跌幅', path: 'quote.changePct', type: 'signed' }
      ],
      notes: ['以对应 ETF / 指数为代理，按 52 周区间位置、动量与回撤合成情绪，仅供参考。']
    },
    custom: 'gauge'
  },
  {
    key: 'fear-ai',
    title: 'AI恐贪',
    icon: '🤖',
    category: 'strategy',
    desc: '以人工智能 ETF（sh515070）作为板块情绪代理',
    api: '/api/fear/asset',
    query: { key: 'ai' },
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '标的现价', path: 'quote.price', type: 'num' },
        { label: '涨跌幅', path: 'quote.changePct', type: 'signed' }
      ],
      notes: ['以对应 ETF / 指数为代理，按 52 周区间位置、动量与回撤合成情绪，仅供参考。']
    },
    custom: 'gauge'
  },
  {
    key: 'fear-gold',
    title: '黄金恐贪',
    icon: '🥇',
    category: 'strategy',
    desc: '以黄金 ETF（sh518880）作为避险资产情绪代理',
    api: '/api/fear/asset',
    query: { key: 'gold' },
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '标的现价', path: 'quote.price', type: 'num' },
        { label: '涨跌幅', path: 'quote.changePct', type: 'signed' }
      ],
      notes: ['以对应 ETF / 指数为代理，按 52 周区间位置、动量与回撤合成情绪，仅供参考。']
    },
    custom: 'gauge'
  },
  {
    key: 'fear-gushou',
    title: '固收+恐贪',
    icon: '🏦',
    category: 'strategy',
    desc: '以国债 ETF（sh511010）作为固收类资产情绪代理',
    api: '/api/fear/asset',
    query: { key: 'gushou' },
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '标的现价', path: 'quote.price', type: 'num' },
        { label: '涨跌幅', path: 'quote.changePct', type: 'signed' }
      ],
      notes: ['以对应 ETF / 指数为代理，按 52 周区间位置、动量与回撤合成情绪，仅供参考。']
    },
    custom: 'gauge'
  },

  {
    key: 'copper-oil',
    title: '铜油比',
    icon: '🛢️',
    category: 'strategy',
    desc: '铜价 / 油价比值与历史走势',
    api: '/api/analytics/copper-oil',
    query: {},
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '铜油比', path: 'ratio', type: 'num' },
        { label: '铜（有色ETF）', path: 'copper.price', type: 'num' },
        { label: '油（原油LOF）', path: 'oil.price', type: 'num' }
      ],
      chart: { path: 'history', name: '铜油比历史', percent: false },
      notes: ['铜/油使用有色 ETF 与原油 LOF 作为代理；比值上升通常意味着铜强于油、经济预期偏强。']
    },
    custom: null
  },
  {
    key: 'ah-premium',
    title: 'AH溢价',
    icon: '🇭🇰',
    category: 'strategy',
    desc: 'AH 溢价指数与个股 A/H 溢价对比',
    api: '/api/analytics/ah-premium',
    query: {},
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '溢价指数', path: 'index.value', type: 'num' },
        { label: '涨跌幅', path: 'index.changePct', type: 'signed' },
        { label: '港币兑人民币', path: 'hkdCny', type: 'num' }
      ],
      table: {
        path: 'pairs',
        limit: 10,
        columns: [
          { label: '名称', path: 'name' },
          { label: 'A 价', path: 'aPrice', type: 'num' },
          { label: 'H 价', path: 'hPrice', type: 'num' },
          { label: '溢价率', path: 'premiumPct', type: 'signed' }
        ]
      },
      notes: ['AH 溢价指数越高，A 股相对 H 股越贵；个股溢价 = A 价 /（H 价 × 港币汇率）- 1。']
    },
    custom: null
  },
  {
    key: 'fx-stock',
    title: '汇股比',
    icon: '💱',
    category: 'strategy',
    desc: '上证指数 / 美元兑人民币的股汇比走势',
    api: '/api/analytics/fx-stock',
    query: {},
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '股汇比', path: 'ratio', type: 'num' },
        { label: '美元兑人民币', path: 'usdCny', type: 'num' },
        { label: '上证指数', path: 'index.price', type: 'num' }
      ],
      chart: { path: 'history', name: '股汇比历史', percent: false },
      notes: ['股汇比 = 上证指数 / 美元兑离岸人民币汇率；比值上升代表股市相对汇率走强。']
    },
    custom: null
  },

  // ==================== 跟踪管理（4） ====================
  {
    key: 'fund-ledger',
    title: '基金账本',
    icon: '📒',
    category: 'track',
    desc: '记录基金买入金额，查看最新净值',
    api: '/api/fund/quotes',
    query: { codes: '110022,161725' },
    method: 'GET',
    params: [],
    render: {
      kpis: [],
      table: {
        path: 'items',
        limit: 10,
        columns: [
          { label: '基金', path: 'name' },
          { label: '代码', path: 'code' },
          { label: '净值', path: 'nav', type: 'num' },
          { label: '日涨幅', path: 'dayPct', type: 'signed' }
        ]
      },
      notes: ['账本记录仅保存在本机小程序；查看最新净值需联网刷新。']
    },
    custom: 'ledger'
  },
  {
    key: 'strategy-alerts',
    title: '策略提醒',
    icon: '🔔',
    category: 'track',
    desc: '恐贪指数阈值提醒（本地检查）',
    api: '/api/snapshot',
    query: {},
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '当前恐贪', path: 'fearGreed.value', type: 'num' },
        { label: '情绪等级', path: 'fearGreed.level', type: 'text' }
      ],
      notes: ['提醒规则仅保存在本机，页面打开时本地检查；小程序端不发送系统通知。']
    },
    custom: 'alerts'
  },
  {
    key: 'portfolio-backtest',
    title: '组合回测',
    icon: '📈',
    category: 'track',
    desc: '多只基金按权重组合回测收益与回撤',
    api: '/api/portfolio/backtest',
    query: { codes: '110022,000001', weights: '50,50', years: 3, rebalance: 'quarterly' },
    method: 'GET',
    params: [
      { name: 'codes', label: '基金代码（英文逗号分隔）', type: 'input', default: '110022,000001', placeholder: '如 110022,000001' },
      { name: 'years', label: '回测年限', type: 'picker', default: '3', options: YEARS_OPTIONS },
      { name: 'rebalance', label: '再平衡方式', type: 'picker', default: 'quarterly', options: REBALANCE_OPTIONS }
    ],
    render: {
      kpis: [
        { label: '总收益', path: 'result.metrics.totalReturn', type: 'signed' },
        { label: '年化收益', path: 'result.metrics.annualized', type: 'signed' },
        { label: '最大回撤', path: 'result.metrics.maxDrawdown', type: 'signed' },
        { label: '夏普比率', path: 'result.metrics.sharpe', type: 'num' }
      ],
      chart: { path: 'result.curve', name: '组合净值走势', percent: false },
      table: {
        path: 'result.items',
        limit: 5,
        columns: [
          { label: '基金', path: 'name' },
          { label: '代码', path: 'code' },
          { label: '权重', path: 'weight', type: 'pct' },
          { label: '区间收益', path: 'ownReturn', type: 'signed' }
        ]
      },
      notes: ['回测基于历史净值模拟，不代表未来收益；曲线为组合净值倍数。']
    },
    custom: 'backtest'
  },
  {
    key: 'portfolio-live',
    title: '组合实盘',
    icon: '💼',
    category: 'track',
    desc: '模拟组合按最新净值估值',
    api: '/api/fund/quotes',
    query: { codes: '110022,161725' },
    method: 'GET',
    params: [],
    render: {
      kpis: [],
      table: {
        path: 'items',
        limit: 10,
        columns: [
          { label: '基金', path: 'name' },
          { label: '代码', path: 'code' },
          { label: '最新净值', path: 'nav', type: 'num' },
          { label: '日涨幅', path: 'dayPct', type: 'signed' }
        ]
      },
      notes: ['模拟组合仅保存在本机，按最新净值（T-1）估值，非真实持仓。']
    },
    custom: 'live'
  },

  // ==================== 其他工具（4） ====================
  {
    key: 'manager-score',
    title: '大佬评分',
    icon: '🏆',
    category: 'other',
    desc: '基金经理五维评分与评级结论',
    api: '/api/manager/score',
    query: {},
    method: 'GET',
    params: [
      { name: 'code', label: '基金代码', type: 'search', searchType: 'fund', default: '110022', placeholder: '输入基金代码/名称搜索' }
    ],
    render: {
      kpis: [
        { label: '综合评分', path: 'score', type: 'num' },
        { label: '评级', path: 'grade', type: 'text' },
        { label: '经理', path: 'manager.name', type: 'text' },
        { label: '任职年限', path: 'manager.workTime', type: 'text' },
        { label: '管理规模', path: 'manager.fundSize', type: 'text' }
      ],
      table: {
        path: 'dims',
        limit: 8,
        columns: [
          { label: '维度', path: 'label' },
          { label: '得分', path: 'score', type: 'num' },
          { label: '说明', path: 'desc' }
        ]
      },
      notes: ['评分基于基金历史业绩与经理公开信息，仅供参考，不构成投资建议。']
    },
    custom: null
  },
  {
    key: 'manager-pk',
    title: '大佬PK',
    icon: '⚔️',
    category: 'other',
    desc: '两只基金基金经理评分对比',
    api: '/api/manager/compare',
    query: {},
    method: 'GET',
    params: [
      { name: 'codes', label: '基金代码（2 只）', type: 'input', default: '110022,161725', placeholder: '如 110022,161725' }
    ],
    render: {
      kpis: [],
      table: {
        path: 'items',
        limit: 2,
        columns: [
          { label: '基金', path: 'name' },
          { label: '经理', path: 'manager.name' },
          { label: '总分', path: 'score', type: 'num' },
          { label: '等级', path: 'grade', type: 'text' },
          { label: '任职', path: 'manager.workTime', type: 'text' }
        ]
      },
      notes: ['评分基于基金历史业绩与经理公开信息，仅供参考。']
    },
    custom: null
  },
  {
    key: 'stock-pick',
    title: '牛人选股',
    icon: '🎯',
    category: 'other',
    desc: '按行业主力资金净流入筛选个股',
    api: '/api/stock/pick',
    query: { limit: 10 },
    method: 'GET',
    params: [],
    render: {
      kpis: [],
      table: {
        path: 'stocks',
        limit: 10,
        columns: [
          { label: '名称', path: 'name' },
          { label: '行业', path: 'industry' },
          { label: '现价', path: 'price', type: 'num' },
          { label: '涨跌幅', path: 'changePct', type: 'signed' },
          { label: '主力净流入', path: 'inflow', type: 'money' },
          { label: '市值', path: 'marketCap', type: 'yi' }
        ]
      },
      notes: ['按行业主力资金净流入选股（东方财富板块资金流口径），非投资建议。']
    },
    custom: null
  },
  {
    key: 'dca-calc',
    title: '定投计算',
    icon: '🧮',
    category: 'other',
    desc: '定投 / 一次性复利与赎回费估算',
    api: '/api/snapshot',
    query: {},
    method: 'GET',
    params: [],
    render: {
      kpis: [
        { label: '当前恐贪', path: 'fearGreed.value', type: 'num' },
        { label: '情绪等级', path: 'fearGreed.level', type: 'text' }
      ],
      notes: ['估算结果，不构成投资建议；输入值仅保存在本机。']
    },
    custom: 'dca'
  }
];

var TOOL_MAP = {};
TOOLS.forEach(function (t) { TOOL_MAP[t.key] = t; });

function findTool(key) {
  if (!key) return null;
  return TOOL_MAP[key] || null;
}

function byCategory(category) {
  return TOOLS.filter(function (t) { return t.category === category; });
}

module.exports = {
  CATEGORIES: CATEGORIES,
  TOOLS: TOOLS,
  findTool: findTool,
  byCategory: byCategory
};
