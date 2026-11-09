# 韭研 · 投研工作台 —— 微信小程序

原生微信小程序（WXML/WXSS/JS，无第三方依赖）。数据链路：

```
小程序页面 → utils/api.js
  ├─ 生产：wx.cloud.callFunction('api') → cloudfunctions/api（Node https 代理）→ https://jiuyan-workbench.onrender.com/api/*
  └─ 调试：wx.request 直连 http://localhost:8080（本地 Node 后端）
```

个人主体不能用 `web-view`、也不能直连未备案域名，所以生产走「云开发云函数代理」方案。

---

## 一、开发者工具导入

1. 打开「微信开发者工具」→「导入项目」。
2. 目录选择本仓库根目录（包含 `project.config.json` 的那一层，即 `L_space/`）。
3. AppID：`project.config.json` 里默认是占位 `touristappid`（游客模式），
   **请改成你自己的小程序 AppID**（个人主体也可以，云开发功能可用）。
4. 导入后若提示选择框架，选「不使用云服务」也可以（代码里会自行判断云开发能力），
   但要用云函数代理就必须开通「云开发」。
5. `setting.urlCheck` 已设为 `false`（开发阶段关闭域名校验）；
   如需手动确认：「详情 → 本地设置 → 不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」。
   注意：该设置只在开发者工具生效，体验版/正式版不受影响（生产走云开发，不需要配置 request 合法域名）。

目录说明：

```
project.config.json          # 工程配置（miniprogramRoot / cloudfunctionRoot / libVersion 3.7.12）
project.private.config.json  # 本地私有配置（IDE 自动生成，可忽略）
sitemap.json                 # 根目录副本，实际生效的是 miniprogram/sitemap.json
miniprogram/
  app.js                     # App()：globalData（useCloud / apiBase / envId / 版本）
  app.json                   # 9 个页面登记 + tabBar 5 项 + 全局组件
  app.wxss                   # 全局设计系统（由 UI 同学维护，勿删）
  sitemap.json
  utils/api.js               # 统一请求层（云函数优先，失败回退 wx.request）
  utils/format.js            # 数字 / 金额 / 百分比 / 日期格式化
  utils/storage.js           # 本地存储（jy_mp_* 前缀 + key 常量 + uid）
  utils/ui.js                # toast / confirm / 跳转 helper
  components/line-chart/     # canvas 2d 折线图（series/height/percent/markers）
  components/loading/        # 加载态
  components/empty/          # 空态
  pages/index/               # 首页（恐贪指数 + 市场 + 商品 + 快捷入口）
  pages/watch/               # 自选（股票/基金搜索 + 批量行情 + 长按删除）
  pages/mine/                # 我的（版本 / 数据源 / 主题 / 清空 / 关于）
  pages/asset/               # 资产详情（股票行情 / 基金详情 + 净值曲线）
  pages/strategy*/ pages/tools*/ pages/tool*/   # 由其他页面模块提供（app.json 已登记）
cloudfunctions/api/          # 云函数：HTTPS 代理（Node 内置 https，无第三方依赖）
```

---

## 二、开通云开发并填写 envId

1. 开发者工具顶部「云开发」→ 开通（按提示选择环境，个人主体可用）。
2. 创建环境后复制 **环境 ID**（形如 `cloud1-xxxxxxxx`）。
3. 打开 `miniprogram/app.js`，把 `globalData.envId` 填成该环境 ID：
   ```js
   globalData: {
     version: '1.6',
     useCloud: true,
     apiBase: 'http://localhost:8080', // 仅本地调试直连用
     envId: 'cloud1-xxxxxxxx',         // ← 改成你的云开发环境 ID
     webUrl: 'https://jiuyan-workbench.onrender.com'
   }
   ```
   `envId` 为空时 `wx.cloud.init({ env: undefined })` 会使用默认环境；只有一个环境时通常也能工作，
   但显式填写更稳。
4. 如果暂时不想用云开发（只想本地调试）：把 `useCloud` 设为 `false`，
   并保证本地后端 `node server.js` 跑在 `http://localhost:8080`；
   同时开发者工具中勾选「不校验合法域名」。

---

## 三、上传云函数（关键步骤）

1. 在开发者工具左侧目录树找到 `cloudfunctions/api`。
2. 右键 →「上传并部署：云端安装依赖」（本项目无第三方依赖，选「上传并部署：所有文件」也可）。
3. 打开「云开发控制台 → 云函数 → api → 配置」，设置：
   - **超时时间：60 秒**（代码内 https 超时 55s，给冷启动留余量；默认 3s 会经常超时）；
   - **内存：256 MB**；
   - Node 运行时 16 及以上。
4. 在「云开发控制台 → 设置 → 权限」中确认云函数可被当前小程序调用（默认可以）。
5. 修改云函数代码后必须重新上传部署，页面端才会生效。

> 为什么需要 60s：Render 免费实例 15 分钟无请求会休眠，冷启动 30-60s。
> 第一下打开页面可能较慢，失败时页面会提示重试，多试一次即可。

云函数代理规则（`cloudfunctions/api/index.js`）：

- 入参：`{ path, query, method, body }`，只允许 `path` 以 `/api/` 开头；
- 出参：`{ ok: true, data }` 或 `{ ok: false, error }`；
- 上游 Render 地址硬编码为 `https://jiuyan-workbench.onrender.com`，
  如后端域名变化，只改 `cloudfunctions/api/index.js` 顶部的 `TARGET_HOST`。

---

## 四、体验版发布与体验成员

1. 开发者工具右上角「上传」→ 填写版本号（如 `1.6.0`）与备注 → 上传。
2. 打开 [微信公众平台](https://mp.weixin.qq.com) → 管理 → 版本管理：
   - 在「开发版本」中把刚上传的版本设为「选为体验版」；
   - 在「成员管理 → 体验成员」里添加自己与朋友的微信号（最多 15 人/个人主体上限以平台为准）。
3. 体验成员扫描「体验版二维码」即可使用，无需发布正式版；体验版可随时替换。
4. 若后续配置了 request 合法域名（一般不需要，生产走云函数），可忽略；体验版默认与正式版同规则。
5. 提示：`appid` 必须是自己的 AppID；游客模式（touristappid）不能上传/发布体验版。

---

## 五、Render 休眠与常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 首次打开/很久没打开时加载 30-60s 或失败 | Render 免费实例休眠冷启动 | 页面重试一次；云函数超时已调 60s |
| 提示 `HTTP 502/503/504` | 后端冷启动未完成 | 稍等 30s 重试 |
| `云函数调用失败` / 一直回流到 localhost 请求失败 | 云函数未上传或 envId 未填 | 重新上传部署云函数、检查 envId |
| 提示 `request:fail url not in domain list` | 调试时直连且未关域名校验 | 详情→本地设置→勾选「不校验合法域名」 |
| 基金/排行数据首次较慢 | 后端需拉取天天基金数据（6-10s） | 等待或重试，后端有缓存 |
| 微信搜索不到小程序 | 未发布正式版/未配置 | 体验版用二维码；正式发布需提交审核 |

---

## 六、页面跳转速查（供其他页面模块参考）

| 页面 | 路径 | query |
| --- | --- | --- |
| 首页 | `/pages/index/index`（tab） | — |
| 自选 | `/pages/watch/watch`（tab） | — |
| 资产详情 | `/pages/asset/asset` | `code`、`type=stock/fund`、`name`（可选） |
| 策略 | `/pages/strategy/strategy`（tab） | — |
| 策略详情 | `/pages/strategy-detail/strategy-detail` | `mode=template/indicator/mine/portfolio`、`key`/`id` |
| 新建策略 | `/pages/strategy-create/strategy-create` | `id`（编辑时） |
| 工具箱 | `/pages/tools/tools`（tab） | — |
| 通用工具页 | `/pages/tool/tool` | `key=<工具 key>` |
| 我的 | `/pages/mine/mine`（tab） | — |

## 七、共享接口约定（其他页面模块必须遵守）

```js
const api = require('../../utils/api.js');
const format = require('../../utils/format.js');
const storage = require('../../utils/storage.js');
const ui = require('../../utils/ui.js');

api.request('/api/snapshot');                       // GET  -> data
api.request('/api/quote', { codes: 'sh000001' });   // GET + query 对象
api.post('/api/strategy/validate', { buy, sell });  // POST -> data（失败 reject）
```

- 所有 `api.*` 返回后端 `data`（即 `{ ok, ... }` 里的内容）；`ok===false` 或网络错误会 reject。
- 组件：`<line-chart series="{{series}}" height="{{220}}" percent="{{true}}" markers="{{markers}}" />`、
  `<loading text="加载中…" />`、`<empty icon="📭" title="" desc="" action-text="" bindaction="..." />`
  （已在 `app.json` 注册为全局组件，页面无需重复声明）。
- 本地存储 key：`jy_mp_watch_v1`（自选）、`jy_mp_strategies_v1`（策略）、`jy_mp_theme_v1`（主题）。
