# README

# 韭研 · 投研工作台

面向个人投资者的**投研工作台**：恐贪指数仪表盘 + A股/美股/港股实时行情 + 商品行情 + 基金数据 + 策略组合 + 工具箱 + 每日定时抓取。

零依赖（仅用 Node.js 内置模块），无需 `npm install`。

## 运行

```bash
cd C:\Users\user\Desktop\L_space
node server.js
# 浏览器打开 http://localhost:8080
```

Windows 下也可以直接双击 `启动网页.bat`（等价于在项目目录执行 `node server.js`）。

自定义端口：`PORT=9000 node server.js`（PowerShell：`$env:PORT=9000; node server.js`）

## 功能

- **恐贪指数**：基于真实市场数据合成（多因子情绪方法论）
  - 股价强度（当前价在 52 周高低区间的位置）、市场广度（A股上涨占比）、动能（平均涨跌幅）
  - 首页仪表盘 + 因子明细；工具页含迷你仪表盘与方法论说明
- **实时行情**：A股 / 美股 / 港股 指数，来自腾讯财经 `qt.gtimg.cn`（红涨绿跌，符合 A股习惯）
- **商品行情**：纽约黄金 / 纽约白银 / WTI 原油 / COMEX 铜，来自腾讯财经外盘期货（东方财富备用），首页「商品市场」板块展示
- **搜索**：输入代码即查，支持智能归一化 —— `600519` / `AAPL` / `700` 都能查到对应标的
- **自选**：点击行情卡片 ☆ 或详情页一键加/移自选，localStorage 持久化，空态引导
- **标的详情抽屉**：点击任意行情/搜索结果，弹出底部抽屉，含今开/昨收/最高/最低 + 日内区间 / 52 周区间定位条
- **策略**（组合策略页，可点进详情）
  - **推荐策略**：5 套模板（黄金恐贪1期 / 红利低波 / 全球资产配置 / 科技成长 / 股债平衡），按真实历史净值回测
  - **策略详情**：本期收益率大字 + 7 个区间切换（今年以来/近1月/3月/6月/1年/3年/成立来）+ 组合金额/累计盈亏/记账天数 + 时间加权收益 vs 沪深300 基准 + 4 个 Tab（业绩走势 / 组合回撤 / 盈亏金额 / 实时估值）+ 持仓环形图与明细表
  - **自建策略**：自定义名称/初始资金/起始日期/再平衡（每月/季/半年/年/不再平衡）+ 基金与股票混合持仓与权重，保存到本机并可编辑、删除、查看
- **自选搜索添加**：自选页可直接搜索股票/ETF（代码或名称，如 600519 / AAPL / 00700）并一键加入自选，代码自动归一化去重
- **工具（工具箱，共 35 项，磁贴入口 + 工具详情页）**：
  - **挑选基金（8）**：ETF 行情榜（涨幅/成交额/换手，1375 只）、灵感基金池（5 组精选池）、基金筛选（类型 + 近1/3年/今年来收益下限 + 排序）、基金排行（6 类型 × 6 排序 + 分页 + 自选）、牛人选基（经理星级 ≥4 的基金榜）、基金诊断（收益/风险/经理/稳定性/规模 五维评分 + A/B/C/D 等级 + 结论）、基金PK（2-4 只归一化走势 + 指标表）、相似基金（收益向量相似度 Top5）
  - **制定策略（19）**：恐贪指数（仪表盘 + 三因子 + 60 日历史）、情绪面板（恐贪+估值+行业广度综合信号灯）、指数估值（蛋卷 63 只指数，PE/PB/分位/股息率 + 低估/正常/高估）、股债性价比（沪深300 盈利收益率 vs 10Y 国债参考值 → ERP 与区间判定）、**12 个板块恐贪**（军工/券商/新能源车/光伏/电池/行业/创50/美股/A500/AI/黄金/固收+）、铜油比、AH溢价（溢价指数 + A/H 个股对比）、汇股比
  - **跟踪管理（4）**：基金账本（买卖流水 + 移动加权成本 + 浮盈/已实现盈亏）、策略提醒（恐贪/基金收益阈值 + 页面内检查提醒）、组合回测（基金与 A股/港股/美股 混合、最长 20 年、再平衡 每月/季度/半年/年/不再平衡，对比沪深300 基准 + 回撤曲线）、组合实盘（模拟组合 + 最新净值估值 + 权重漂移）
  - **其他工具（4）**：大佬评分（基金经理五维评分）、大佬PK（两位经理逐维对比）、牛人选股（行业主力净流入 → 个股榜）、定投计算（定投复利/一次性复利/赎回费）
- **每日 19:00 自动抓取**快照；页面每 60 秒轮询自动同步；支持刷新倒计时与相对时间
- **手动刷新**：右上角 ⟳ 按钮，或首页下拉刷新
- **深色模式**：跟随系统或手动切换，记忆偏好
- **深链**：`#home` `#watch` `#strategy` `#tools` `#mine` `#detail=sh600519` 可直接定位视图/标的

## 数据来源与说明

| 模块 | 来源 | 状态 |
| --- | --- | --- |
| A股/美股/港股行情 | 腾讯财经 `qt.gtimg.cn` | ✅ 实时、真实 |
| 恐贪指数 | 腾讯实时行情内含的 52 周高低 + 当日涨跌 合成 | ✅ 真实 |
| 基金排行 / 搜索 / 净值 / 回测 / 对比 | 天天基金 `fund.eastmoney.com`（公开接口） | ✅ 真实（T-1 净值，服务端 5-10 分钟缓存） |
| 指数估值 | 蛋卷基金 `danjuanfunds.com` 指数估值 | ✅ 真实（30 分钟缓存） |
| 股票/ETF 日线（回测） | 东方财富 `push2his.eastmoney.com` **后复权**日线 | ✅ 最长 20 年（fqt=2） |
| 股票搜索 / AH 溢价 / 汇率 | 东方财富 suggest / 行情接口 | ✅ 真实（5 分钟缓存） |
| ETF 行情 / 行业板块 / 主力资金流 | 东方财富 `push2.eastmoney.com` | ✅ 真实（60 秒缓存） |
| AH 溢价 / 港币、美元汇率 | 东方财富行情 + 腾讯财经 | ✅ 真实 |
| 恐贪历史 / 股汇比 / 铜油比历史 | 本地 `data/fear-history.json`、`data/analytics-history.json` 每日累积 | ✅ 本地累积 |
| 国债收益率（股债性价比） | 无公开接口，页面可编辑参考值（默认 2.0%，`data/analytics-config.json`） | ⚠️ 手动参考值 |
| 商品（黄金/白银/原油/铜） | 腾讯财经外盘期货 `qt.gtimg.cn`（东财 `101.GC00Y` 等备用） | ✅ 实时（60 秒缓存） |

> 行情、基金、商品、估值等均为公开接口的**真实数据**，未接入任何私有或需鉴权的接口。
> 恐贪指数采用多因子情绪合成方法：52 周区间位置（股价强度）+ 市场广度 + 动能。

## 商品数据源

商品行情已在 `src/commodities.js` 中接入：

- 主源：腾讯财经外盘期货 `qt.gtimg.cn`（`hf_GC` 纽约黄金、`hf_SI` 纽约白银、`hf_CL` WTI 原油、`hf_HG` COMEX 铜）
- 备用：东方财富行情（`101.GC00Y` / `101.SI00Y` / `101.HG00Y`）
- 失败时优雅降级（`available:false`），不影响股票/基金行情；服务端缓存 60 秒

若需接入其他商品或数据源，保持返回结构即可：

```js
{ available: true, items: [{ name, code, price, change, changePct, unit }], note }
```

## 目录结构

```
server.js            # 零依赖 HTTP 服务（托管 UI + JSON API）
src/
  config.js          # 行情标的、定时时间、端口
  http.js            # HTTPS GET 工具
  tencent.js         # 腾讯行情解析 + 安全抓取（逐码重试）
  fearGreed.js       # 恐贪指数合成
  fund.js            # 基金数据层：搜索/排行/详情/净值/回测/对比（TTL 缓存）
  stocks.js          # 股票/指数搜索、code→secid、东财后复权日线、实时报价
  indexValuation.js  # 蛋卷指数估值
  fearHistory.js     # 恐贪历史每日快照
  sectors.js         # 12 个板块恐贪（ETF/指数代理 + 行业聚合）
  market.js          # 行业板块 / ETF / AH溢价 / 汇股比 / 铜油比 / 股债性价比 / 牛人选股 / 情绪面板
  analytics.js       # 相似基金 / 诊断 / 牛人选基 / 大佬评分 / 大佬PK / 基金筛选
  portfolio.js       # 组合回测（基金+股票 / 20年 / 再平衡 / 沪深300基准）
  commodities.js     # 商品数据源（可插拔）
  collect.js         # 数据编排
  snapshot.js        # 快照落盘 data/snapshot.json
  scheduler.js       # 每日 19:00 定时
public/
  index.html / app.css / app.js   # Web UI（SPA）
  tools.js                        # 工具中心：分类磁贴、工具路由、共享库 JYXT
  tools-fund.js                   # 挑选基金 8 工具
  tools-strategy.js               # 制定策略 19 工具
  tools-track.js                  # 跟踪管理 4 工具
  tools-other.js                  # 其他工具 4 工具
  strategy.js                     # 策略页：模板 / 详情四 Tab / 自建策略
data/snapshot.json      # 抓取快照（运行时生成）
data/fear-history.json  # 恐贪历史（运行时累积）
data/analytics-history.json # 股汇比 / 铜油比历史（运行时累积）
data/analytics-config.json  # 10Y 国债收益率参考值
```

## API

行情 / 恐贪：

- `GET  /api/snapshot`  返回最新快照（含下次自动刷新时间）
- `POST /api/refresh`   立即重新抓取并刷新快照
- `GET  /api/quote?codes=600519,AAPL,700`  查询任意代码实时行情（支持智能归一化）

基金 / 工具：

- `GET  /api/fund/search?key=消费`  基金搜索
- `GET  /api/fund/rank?type=hh&sort=1nzf&page=1&size=20`  基金排行
- `GET  /api/fund/detail?code=110022`  基金详情（阶段收益、风险指标、净值序列）
- `GET  /api/fund/nav?code=110022&range=1y`  历史净值
- `GET  /api/fund/quotes?codes=110022,000001`  基金最新净值
- `GET  /api/fund/backtest?code=110022&amount=1000&freq=monthly&years=3&targetProfit=20&stopLoss=-15`  定投/止盈止损回测
- `GET  /api/fund/compare?codes=110022,000001`  基金对比
- `GET  /api/fund/etf?sort=f3&page=1&size=20`  ETF 行情榜
- `GET  /api/fund/screen?type=hh&minY1=20&sort=1nzf`  基金筛选
- `GET  /api/fund/similar?code=110022`  相似基金
- `GET  /api/fund/diagnose?code=110022`  基金诊断评分
- `GET  /api/fund/manager-pick?limit=8`  牛人选基（高星级经理）
- `GET  /api/manager/score?code=110022`、`/api/manager/compare?codes=a,b`  大佬评分 / PK
- `GET  /api/portfolio/backtest?codes=110022,600519,AAPL&types=fund,stock,stock&weights=40,30,30&years=20&rebalance=halfyearly&capital=100000`  组合回测（基金+股票、最长 20 年、月/季/半年/年再平衡、沪深300 基准、回撤/盈亏曲线、今日估值）；也支持 `start=YYYY-MM-DD`
- `GET  /api/stock/search?key=茅台`  股票/指数搜索（A股/港股/美股，返回 secid）
- `GET  /api/stock/pick?limit=10`  牛人选股（行业主力净流入）
- `GET  /api/fear/asset?key=jingong`  板块恐贪（jingong/quanshang/newenergy/guangfu/dianchi/hangye/chuang50/us/a500/ai/gold/gushou）
- `GET  /api/market/industries?limit=30`  行业板块行情
- `GET  /api/analytics/ah-premium | /api/analytics/fx-stock | /api/analytics/copper-oil | /api/analytics/stock-bond?bondYield=2.0`  AH溢价 / 汇股比 / 铜油比 / 股债性价比
- `GET  /api/emotion/panel`  情绪面板聚合数据
- `GET  /api/index-valuation`  指数估值表
- `GET  /api/fear-history?days=60`  恐贪历史

## 微信小程序版（个人自用）

`miniprogram/` 目录是配套的小程序前端，复用同一套后端 API。

- 导入微信开发者工具、连接本地服务、真机预览 / 正式发布的完整步骤见
[miniprogram/小程序部署指南.md](miniprogram/小程序部署指南.md)。
- 功能与原网页版一致：恐贪仪表盘、A股/美股/港股行情、搜索、自选、策略、工具、刷新。
- 小程序通过 `utils/store.js` 中可配置的服务器地址访问本地后端；"我的"页可随时修改并持久化。

---

*仅供学习研究，不构成任何投资建议。*
