# BKToolBox Architecture

## 项目概览

BKToolBox 目前不是单一计算页，而是一个 `Electron + Express + Vue 3/Vite` 的混合应用：

- Electron 提供桌面运行、截图、AutoOperation 注入和嵌入式本地服务
- Express 提供页面路由、SSE 求解入口、实时监控 API、价格历史 API 和抓包驱动 API
- Vue 构建保留 `Home`、`Tools`、`Ahmed`、`Ethan`、`Monitor`、`Price`、`Inject` 七个入口 bundle；用户可见的 canonical 工作面是 `Home`、`Tools`、`Monitor`、`Price`、`Inject`
- 求解脚本、实时抓包、价格历史和自动化服务在 Node 侧独立维护

应用显示名和 Windows 打包产品名为 `BKToolBox`。为了兼容既有页面状态、主题和桌面桥接，`bidking-theme`、`bidking-page-state:*`、`window.bidkingDesktop` 等内部 key/API 继续沿用旧命名。

## 目录结构

```text
BKToolBox/
├── electron/
│   ├── main.js
│   ├── preload.js
│   ├── desktop-utils.js
│   ├── region-selector.*
│   └── services/
│       ├── inject-service.js
│       ├── inject-scheduler.js
│       └── collection-price-scan-controller.js
├── lib/
│   ├── solver.js
│   ├── solver-inputs.js
│   ├── bidking-live-monitor.js
│   ├── bidking-monitor-*.js
│   ├── bidking-market-*.js
│   ├── bidking-price-history-store.js
│   ├── capture-driver.js
│   ├── high-price-listing-advisor.js
│   ├── listing-fee-config-store.js
│   └── trade-info-history-recorder.js
├── src/
│   ├── home/
│   ├── elsa/
│   ├── ahmed/
│   ├── ethan/
│   ├── hero-estimator/
│   ├── monitor/
│   ├── price/
│   ├── inject/
│   │   └── panels/
│   └── shared/
├── public/
│   ├── data/
│   ├── home/
│   ├── ahmed/
│   ├── ethan/
│   ├── monitor/
│   ├── price/
│   ├── inject/
│   ├── elsa/
│   ├── index.html
│   ├── page-state.js
│   ├── theme.js
│   └── number-pad.js
├── scripts/
│   ├── prepare-dumpcap-runtime.mjs
│   ├── parse-bidking-tcp-pcap.mjs
│   ├── watch-bidking-game-log.mjs
│   ├── extract-bidking-collectibles.js
│   └── deploy-unpacked-app.mjs
├── solve-*.js
├── server.js
├── runtime-paths.js
├── collectibles.json
├── vitest.config.js
└── package.json
```

## 运行时结构

### Express 服务层

服务入口在 `server.js`，核心职责：

- 提供页面路由和静态资源
- 暴露求解、监控、价格历史和抓包驱动 API
- 根据 `runtime-paths.js` 决定运行时根目录、文档目录和日志目录
- 在 Electron 模式下与桌面层共享同一套后端逻辑

当前 canonical 页面路由：

- `/`
- `/Tools`
- `/Monitor`
- `/Price`
- `/Inject`

当前兼容重定向：

- `/elsa`、`/Elsa` -> `/Tools`
- `/ahmed`、`/Ahmed` -> `/Tools?tab=ahmed`
- `/ethan`、`/Ethan` -> `/Tools?tab=ethan`
- `/tools`、`/monitor`、`/price`、`/inject` -> 对应的大写 canonical 路由

当前主要 API：

- Solver
  - `GET /run`
- Live Monitor
  - `GET /api/bidking-monitor/status`
  - `POST /api/bidking-monitor/start`
  - `POST /api/bidking-monitor/stop`
  - `GET /api/bidking-monitor/schema`
  - `GET /api/bidking-monitor/events`
- Capture Driver
  - `GET /api/capture-driver/status`
  - `POST /api/capture-driver/install`
  - `POST /api/capture-driver/uninstall`
- Market / Price History
  - `GET /api/market-prices/latest`
  - `GET /api/market-prices/history`
  - `GET /api/price-history/latest`
  - `GET /api/price-history/collections`
  - `GET /api/price-history/item/:itemCid`
  - `GET /api/price-history/ladders/:itemCid`
  - `GET /api/exchange-listing-advice/:itemCid`
- Runtime data
  - `GET /data/collectibles.json`

### 运行时路径

`runtime-paths.js` 统一处理以下路径：

- `projectRoot`
- `BIDKING_RUNTIME_ROOT`
- `BIDKING_APP_ROOT`
- `BIDKING_DOCUMENTS_DIR`
- 应用日志目录 `log/`

关键事实：

- 页面和服务运行时读 `collectibles.json` 时优先走 runtime root
- `/data/collectibles.json` 不是直接读取 `public/data/collectibles.json`，而是返回 runtime root 下的 `collectibles.json`
- 浏览器页面读取藏品基础数据时统一请求 `/data/collectibles.json`
- `public/data/collectibles.json` 主要供测试和仓库内 fixture 直接读取
- `public/data/quality-size-average-prices.json` 通过静态资源路径 `/data/quality-size-average-prices.json` 提供给 Ahmed panel 与 Elsa/Ethan hero-estimator surfaces

## 求解链路

### 求解脚本

当前 `/run` 白名单脚本有 9 个：

- `solve-gold-combo.js`
- `solve-gold-total.js`
- `solve-gold-grid.js`
- `solve-purple-grid.js`
- `solve-red-grid.js`
- `solve-type-combo.js`
- `solve-average-price-combo.js`
- `solve-purple-combo.js`
- `solve-purple-total.js`

### 公共 solver 模块

- `lib/solver-inputs.js`
  - 藏品 -> solver item 映射
  - 平均价格 -> 整数总价容差换算
  - 按价格/格数推导合法件数
- `lib/solver.js`
  - Worker 调度
  - 按 `Count` 保序输出
  - 分组输出上限
  - worker 失败转退出码

### `/run` 的实际行为

- 通过 `child_process.spawn(process.execPath, [script, ...args])` 启动脚本
- 以 SSE 推送 `{ type: "out" | "err" | "done" }`
- 注入 `BIDKING_RUNTIME_ROOT`
- 若前端传 `limit`，会转成 `LIMIT`
- 当前服务端强制 `SOLVER_CONCURRENCY=1`
  - 这样 Tools 页在 SSE 交互里只跑单 worker，并保持更可控的输出和资源占用
  - CLI 直接跑求解脚本时，solver 仍会默认退回 `os.cpus().length`

## 页面结构

### Home

源码：`src/home/`

职责：

- 只做工作区入口页
- 提供 `Tools`、`Monitor`、`Price`、`Inject` 四个入口卡片
- 复用共享顶栏、主题切换和语言切换
- 不再在 `Home` 或 `TopBar` 暴露独立 `Ahmed` / `Ethan`

### Tools

源码：`src/elsa/`

职责：

- 作为 `Elsa / Ethan / Ahmed` 的 canonical hero workspace，统一承载 hero tabs 和 solver tabs
- solver tabs 用 `EventSource` 调 `/run`
- 维护各 tab 的输入、筛选词、运行态、输出和本地状态

当前 tab 组成是 `3` 个 hero tabs + `9` 个 solver tabs。

当前 hero tabs 共 3 个，顺序固定为：

- Elsa · 期望价值
- Ethan · 期望价值
- Ahmed · 组合计算器

当前 solver tabs 共 9 个：

- 金色 · 平均价格
- 金色 · 总价格
- 金色 · 平均格数
- 紫色 · 平均格数
- 紫色 · 平均价格
- 紫色 · 总价格
- 红色 · 平均格数
- 类目 · 平均价格
- X件 · 平均价格

当前关键行为：

- `9` 个 solver tabs 统一使用表格结果视图
- 数值列支持排序
- 过滤栏旁显示独立状态条
- “每组上限”会传到 `/run?limit=...`
- solver tabs 的 `/run` 输出派生在 `src/elsa/tools-run-output-worker.js` 内完成；renderer 只负责 `EventSource`、tab 状态和表格渲染
- 紫色平均价格去重时，前端会按 `TotalCells` 排序展示
- 页面状态保存在 `bidking-page-state:v2:elsa`；恢复时会把 legacy `bidking-page-state:v1:elsa` 的 index-based tab 状态迁移到新的 `tabId` keyed 结构
- Elsa/Ethan hero tabs 通过 `src/elsa/ElsaHeroPanel.vue` 与 `src/ethan/EthanHeroPanel.vue` 挂载共享 hero-estimator 面板，不走 `/run`
- Ahmed hero tab 通过 `src/ahmed/AhmedPanel.vue` 挂载 shared Ahmed panel + mountable controller，不走 `/run`
- `?tab=elsa|ethan|ahmed` 会驱动初始 hero tab，并在 hero tab 切换时同步到 URL

### Ahmed

源码：`src/ahmed/`

职责：

- `src/ahmed/App.vue` 作为 standalone shell 复用 shared `AhmedPanel`
- `src/ahmed/AhmedPanel.vue` 提供可嵌入的共享面板
- `public/ahmed/ahmed.js` 提供 mountable controller contract，负责输入解析、worker 生命周期、约束交互、结果和详情弹窗
- `src/ahmed/ahmed-worker.js` / `ahmed-worker-core.js` / `ahmed-compute-core.js` 负责 Ahmed 组合计算、可行件数推导、增量结果流和 detail 展开

当前边界：

- `src/ahmed/App.vue` 负责 standalone shell 和 shared topbar
- `src/ahmed/AhmedPanel.vue` 负责 DOM 结构
- `public/ahmed/ahmed.js` 负责可挂载/可卸载的行为层与 worker orchestration
- `public/ahmed/ahmed.js` 当前会把 `loadData()` 的结果延后到 mount 活跃校验通过后再应用，避免 `cleanup -> remount` 场景里旧异步结果覆盖新实例状态
- `public/ahmed/ahmed-core.js` 存放抽出的可测 helper
- Ahmed worker 当前支持 `start-run`、`cancel-run`、`release-run`、`open-detail` 协议；controller 在 worker runtime error 或同步 `postMessage` 失败时会丢弃实例并在下一次 submit 时重建
- 修改 Ahmed 页面时必须保留旧控制器依赖的 DOM id、class 和 `data-*` hook

### Ethan

源码：`src/ethan/`

职责：

- standalone `Ethan` 路由页只是 shared hero-estimator 的 thin wrapper
- `src/ethan/App.vue` 只负责把 `ethanProfile` 传给共享面板
- 纯估算逻辑继续复用 `src/ethan/estimator.js`
- monitor 网格基础仍在 `src/ethan/monitor-grid.js`

当前关键行为：

- 全局平均格数可推导 `<300` 的合法总格数候选
- 紫色和橙/金色支持平均格数候选、均价匹配 tag 和 price-only SSE 搜索
- monitor 自动回填优先作为 placeholder/fallback，而不是强写用户输入
- 输入、结果、monitor 事件接入和状态恢复由 `src/hero-estimator/` 共享层按 `ethanProfile` 驱动
- 状态保存在 `bidking-page-state:v1:ethan`

### Shared Hero Estimator

源码：`src/hero-estimator/`

职责：

- 为 standalone `/Ethan` shell 与 `Tools` 内 `Elsa / Ethan` hero tabs 提供同一套估算面板壳层
- 用 profile 区分 Ethan 与 Elsa 的分组、期望单格值、monitor 解释规则、price-only 搜索配置和 storage key
- 消费共享 monitor runtime，并保留英雄专属事件解释、自动回填和状态恢复逻辑

当前关键模块：

- `HeroEstimatorPanel.vue`
  - 共享入口组件，支持独立页面模式和嵌入式 panel 模式
- `useHeroEstimatorPanel.js`
  - 共享输入状态、worker orchestration、monitor 路由访问、自动回填与 localStorage 恢复
- `hero-profiles.js`
  - 定义 `ethanProfile` 与 `elsaProfile`
  - 当前 storage key 分别是 `bidking-page-state:v1:ethan` 和 `bidking-page-state:v1:elsa-hero`
- `monitor-profile-adapter.js`
  - 把同一条 monitor 事件流转换成 profile 对应的分组事实
- `result-row-builder.js`
  - 组装估算结果表格行和均价匹配标签
- `../ethan/estimation-worker.js`
  - 接管同步估算、price-only 搜索、总价候选流和增量 row 构建；renderer 只转发 `/run` chunk 和 monitor 事件

当前共享 monitor 路由：

- `GET /api/bidking-monitor/status`
- `POST /api/bidking-monitor/start`
- `POST /api/bidking-monitor/stop`
- `GET /api/bidking-monitor/events`

### Shared TopBar Runtime Controls

源码：`src/shared/`

职责：

- `TopBar.vue` 提供所有页面共用的导航壳和常驻 runtime controls
- `useMonitorSwitch.js` 持有 renderer 侧唯一一份 monitor runtime：状态拉取、start/stop 和唯一一条 monitor SSE
- `useAutoOperationAgentSwitch.js` 持有 renderer 侧唯一一份 AutoOperation Agent runtime：桌面能力探测、`Ping` 探活以及 `load/unload BKAutoOpAgent.dll`

当前关键行为：

- 顶栏只保留 `Home`、`Tools`、`Monitor`、`Price`、`Inject` 五个导航项
- `Monitor switch` 常驻显示；`Agent switch` 仅在桌面桥同时提供 `startAutoOperationAgent()` 与 `runAutoOperationCommand()` 时显示
- `/Monitor`、`/Inject` 和 `src/hero-estimator/useHeroEstimatorPanel.js` 都订阅这两份共享 runtime，而不再各自维护独立 owner

### Monitor

源码：`src/monitor/`

职责：

- 启动/停止实时抓包监控
- 查看抓包驱动状态
- 订阅 `/api/bidking-monitor/events` 的 SSE
- 展示 raw-compatible 事件、`facts` 和 canonical `state`
- 展示最新 market price 快照和所选 item 历史

页面关注点：

- `lib/bidking-live-monitor.js` 的状态和 recent events
- `lib/capture-driver.js` 的 dumpcap/Npcap 可用性
- `/data/collectibles.json` 做 itemCid -> 名称映射

### Price

源码：`src/price/`

职责：

- 查看长期最低价历史
- 浏览倍率大于等于 2x 的“高倍售价藏品”
- 浏览 Collections 藏品价格历史
- 在桌面模式下读取仓库藏品数量、显示单件占用格数并刷新单个藏品交易所价格
- 对仓库表的 `占用格数`、`仓库数量`、`本身价格`、`最新最低价` 做前端数值排序

页面数据源：

- `/data/collectibles.json`
- `/api/price-history/latest`
- `/api/price-history/collections`
- `/api/price-history/item/:itemCid`
- 桌面模式下还会调用 `window.bidkingDesktop.refreshItemTradeInfo()`，并通过 `runAutoOperationCommand('GetStockContainers' | 'GetItemTradeInfo' | 'ExchangeItem')` 读取持有快照与执行上架

页面关注点：

- 仓库表会复用 `GetStockContainers` 的主仓识别语义，只显示主仓 `stockId: 0` 中存在的交易所藏品，并把 `/data/collectibles.json` 中的 `size.width * size.height` 派生成单件占用格数；显示的 `仓库数量` 仍按所有仓库 / 物品箱中的同 `itemCid` 总数统计
- 默认仓库表顺序保持主仓内首次出现顺序；点击表头后切换为对应数值列的升序/降序排序
- 选中仓库持有藏品后，详情区可继续走 `ListingModal` 的桌面上架链路

### Inject

源码：`src/inject/`

职责：

- 管理展示柜收益查询/领取
- 启动 AutoOperation Agent 并调试命名管道命令
- 获取仓库藏品数量
- 从一个物品箱批量移动藏品到另一个物品箱
- 交易所上架单个藏品
- 启动/刷新/取消延迟价格查询
- 启动/停止收藏价格采集轮询
- 调用高价上架顾问确认上架

页面不是纯 Web 功能，核心能力依赖 preload 暴露的桌面 API。

当前关键实现：

- `src/inject/App.vue` 现在只是 workspace 壳层：维护左侧导航、当前激活 panel、已访问 panel 集合、共享 `collectibles` 加载和跨 panel 的 AutoOperation command lock。
- `InjectControllerPanel.vue` 当前通过 `src/shared/useAutoOperationAgentSwitch.js` 的无副作用只读视图消费共享 agent runtime，并作为 readiness cards + `InjectUiAutomationPanel.vue` + `InjectWarehouseBatchOpPanel.vue` + 泛型 command console 的外层壳；`src/inject/App.vue` 会按 `activePanelId === 'controller'` 显式传入 `isActive`，`InjectControllerPanel.vue` 再把该信号转交给 `InjectUiAutomationPanel.vue` + `useControllerUiAutomation.js`。后者继续负责 activation refresh、visible panel 切换、node 选择，以及 `ClickNode / SetInputText` 结构化动作；而 `InjectUiAutomationPanel.vue` 现在额外保留 view-local 的 search/filter、双击行点击、compact status line 和 1.5s transient row feedback，因此 UI 体验可以重做，但 bridge / refresh / shared lock 语义仍集中在 composable 里。`InjectWarehouseBatchOpPanel.vue` + `src/inject/useWarehouseBatchOp.js` 则承载当前仓库自动排序流程，通过 `GetCurrentScreen`、`CloseCurrentOverlay`、`GetStockContainers` 与 `ClickNode` 编排主仓库和物品箱排序。
- `InjectMetaOperationPanel.vue` 与 `InjectControllerPanel.vue` 的边界不同：前者是固定业务动作入口，后者仍是通用 Controller / UI automation 外壳。`InjectMetaOperationPanel.vue` 通过 `useAutoOperationAgentRuntimeState()` 读取桌面环境、bridge 可用性和 agent 连接状态，并通过 `src/inject/App.vue` 传入的共享 `commandLoading` relay 参与跨 panel AutoOperation 串行化；它不重新实现 agent 生命周期，也不直接消费 native UI tree。
- `src/inject/panels/InjectCabinetRewardPanel.vue`
- `src/inject/panels/InjectAgentPanel.vue`
- `src/inject/panels/InjectControllerPanel.vue`
- `src/inject/panels/InjectWarehouseBatchOpPanel.vue`
- `src/inject/panels/InjectMetaOperationPanel.vue`
- `src/inject/useWarehouseBatchOp.js`
- `src/inject/panels/InjectWarehousePanel.vue`
- `src/inject/panels/InjectListingPanel.vue`
- `src/inject/panels/InjectDelayedPricePanel.vue`
- `src/inject/panels/InjectCollectionScanPanel.vue`
- `src/inject/StockMovePanel.vue` 承载批量移仓 UI；只在桌面桥同时提供 `runAutoOperationCommand()` 时渲染。
- `StockMovePanel.vue` 继续作为一级 workspace panel 存在，没有并入 `src/inject/panels/`。
- Inject workspace 通过“首次访问 `v-if` 挂载 + 后续 `v-show` 隐藏”保留 panel 局部状态；收到 `src/shared/inject-page-lifecycle.js` 暴露的 `LEAVE_INJECT_EVENT` 后，会把工作台恢复为只保留默认 `cabinet` panel 的冷启动状态。
- 批量移仓的纯放置逻辑抽到 `src/inject/stock-move.js`，负责按 `boxCount DESC, pos ASC` 排序来源藏品，并在目标物品箱里按 row-major 顺序寻找第一处可放置空位。
- Agent 命令链路是：
  - `GetStockContainers`
  - `MoveStockItem`
- `GetStockContainers` 在当前实现里会优先走 `PlayerManager.GetWareHouseDatas()` 读取布局元数据；若该方法在运行时不可用，则退回 `PlayerGameData.wareHouses`，避免批量移仓面板直接报 `GetWareHouseDatas not found`。
- 对于 `wareHouses` 里的特殊仓库（例如缺少直接 `stockId` 的主仓库），agent 还会尝试 `WareHouseData.GetStockContainerData()`，并在 merge 原始 `GetAllStocks()` 返回时按 `stockCid/itemUid` 重新认领未解出的布局，避免主仓库从下拉框里消失。
- renderer 不自己维护长期仓库状态；每次 `MoveStockItem` 成功后，都会采用该命令返回的新 `containers` 快照，作为下一件藏品的摆放基线。Agent 端目前只会额外调用一次 `GetAllStocks()` 刷新库存缓存；它能更新 BKToolBox 后续命令看到的数据，但还不能稳定触发当前已打开的游戏内仓库 UI 重绘。

## 实时监控链路

### `lib/bidking-live-monitor.js`

职责：

- 管理监控状态机、recent events 和 canonical state
- 选择抓包后端
- 调用 `scripts/parse-bidking-tcp-pcap.mjs`
- 把 raw parser event 转换成 `facts` 和 `state`
- 同步写入 market price / price history store

### 抓包后端策略

当前默认后端是 `auto`：

1. 优先解析 bundled/system `dumpcap`
2. 若 `dumpcap` 缺失，则立即报错并提示准备 `tools/WiresharkPortable64/`，不再退回 `pktmon`

两个世界要区分开：

- `lib/bidking-live-monitor.js`
  - 桌面应用真正使用的抓包入口
  - 固定使用 `dumpcap` 持续 ring buffer 抓包

### 抓包驱动与打包

- `scripts/prepare-dumpcap-runtime.mjs`
  - 只接受 `tools/WiresharkPortable64/` 作为本地源目录
  - 每次构建前把 `dumpcap.exe`、顶层 DLL 和可选 `npcap-*.exe` 刷新到 `build/runtime-capture/{dumpcap,npcap}/`
- `lib/capture-driver.js`
  - 检测 bundled `dumpcap` 是否可用
  - 启动 Npcap 安装器或卸载器
- `/api/capture-driver/*`
  - 给 Monitor 页面读取/触发驱动状态

## Electron 桌面层

### 主进程

入口：`electron/main.js`

职责：

- 以随机 loopback 端口启动嵌入式 Express 服务
- 创建主窗口并加载 `serverUrl`
- 注册全屏截图和区域截图热键
- 维护最近一次内存截图
- 暴露 inject、collection scan、截图和运行时信息 IPC
- 退出前停止 monitor 相关子进程

### preload

入口：`electron/preload.js`

向前端暴露的主要能力：

- 运行时信息与截图
  - `getRuntimeInfo()`
  - `listCaptureSources()`
  - `captureScreenshot()`
  - `startRegionSelection()`
  - `getLatestScreenshot*()` / `getScreenshotStatus()` / `clearLatestScreenshot()`
- 注入调度与展示柜
  - `queryTradeInfo()`
  - `queryCabinetReward()` / `claimCabinetReward()`
  - `getScheduleState()` / `setScheduleEnabled()` / `resetInjectionTimer()` / `onScheduleState()`
- AutoOperation 与交易所
  - `startAutoOperationAgent()`
  - `runAutoOperationCommand()`
  - `refreshItemTradeInfo()`
  - `confirmHighPriceExchangeListing()`
- 收藏价格采集
  - `startCollectionPriceScan()`
  - `stopCollectionPriceScan()`
  - `getCollectionPriceScanStatus()`
  - `updateCollectionPriceScanConfig()`
  - `onCollectionPriceScanState()`

## 构建与测试

### 页面构建

- `vite.config.js` -> `src/home` -> `public/home`
- `vite.elsa.config.js` -> `src/elsa` -> `public` + `public/elsa`
- `vite.ahmed.config.js` -> `src/ahmed` -> `public/ahmed`
- `vite.ethan.config.js` -> `src/ethan` -> `public/ethan`
- `vite.monitor.config.js` -> `src/monitor` -> `public/monitor`
- `vite.price.config.js` -> `src/price` -> `public/price`
- `vite.inject.config.js` -> `src/inject` -> `public/inject`

### 测试

- `npm test`
- `npm run test:coverage`
- `npm run verify`

当前测试覆盖面包括：

- solver 公共逻辑
- server 路由与 `/run`
- live monitor、capture driver、price history store
- Electron desktop utils 与 inject services
- Ahmed core/controller
- Ethan estimator / monitor adapter / monitor grid
- Home / Tools / Ahmed / Ethan / Monitor / Price / Inject Vue 页面

## 文档边界

本文件描述“系统当前是怎么搭起来的”。

- 如果是任务边界和目标，写进 `docs/Prompt.md`
- 如果是里程碑和停止条件，写进 `docs/Plan.md`
- 如果是运行命令、事实清单和已知限制，写进 `docs/Documentation.md`
- 如果是带日期的设计/计划记录，放在 `docs/superpowers/*`，不要把历史记录当 current-state 架构图
