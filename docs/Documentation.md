# BKToolBox Documentation

## 文档定位

- 本文件记录 current-state 事实、命令、路径和约束
- `docs/Prompt.md`、`docs/Plan.md`、`docs/Implement.md`、`docs/ARCHITECTURE.md` 与本文件一起构成当前项目记忆
- `docs/BIDKING_COLLECTIBLES_EXTRACTION.md` 是当前从游戏本体提取 `collectibles.json` 的权威流程
- `docs/superpowers/plans/*.md` 和 `docs/superpowers/specs/*.md` 是带日期的历史归档，不承担 current-state 职责

## 当前状态

- 项目是一个 `Electron + Express + Vue 3/Vite` 混合应用
- 当前构建保留 7 个页面入口 bundle：`Home`、`Tools`、`Ahmed`、`Ethan`、`Monitor`、`Price`、`Inject`
- 当前用户可见的 canonical 工作面共有 5 个：`Home`、`Tools`、`Monitor`、`Price`、`Inject`
- `Tools` 是 `Elsa / Ethan / Ahmed` 的 canonical 入口
- 兼容旧入口：
  - `/elsa`、`/Elsa` -> `/Tools`
  - `/ahmed`、`/Ahmed` -> `/Tools?tab=ahmed`
  - `/ethan`、`/Ethan` -> `/Tools?tab=ethan`
  - `/tools`、`/monitor`、`/price`、`/inject` -> 对应的大写 canonical 路径
- Electron 主进程入口是 `electron/main.js`
- Express 入口是 `server.js`
- 运行时路径 helper 是 `runtime-paths.js`
- 当前打包产品名是 `BKToolBox`
- 为兼容旧状态和 preload API，`bidking-theme`、`bidking-page-state:*`、`window.bidkingDesktop` 等 key/API 继续沿用旧命名

## 页面职责

- `Home`
  - 仅做导航工作台，不直接承载截图或求解逻辑
  - 只暴露 `Tools`、`Monitor`、`Price`、`Inject` 四个入口卡片
- `Tools`
  - 由 `3` 个 hero tabs 和 `9` 个 solver tabs 组成
  - hero tabs 顺序固定为 `Elsa · 期望价值`、`Ethan · 期望价值`、`Ahmed · 组合计算器`
  - `9` 个 solver tabs 统一走 `/run` + SSE，并展示为可排序表格
  - solver 输出解析、过滤和排序不再在 renderer 同步重算，而是走 dedicated output worker
  - `Elsa` / `Ethan` hero tabs 不走 `/run`，而是挂载 `src/hero-estimator/` 共享估算面板
  - `Ahmed` hero tab 不走 `/run`，而是挂载 shared `AhmedPanel` + mountable controller
- `Ahmed`
  - 兼容 standalone shell，复用 shared `AhmedPanel`
  - 行为仍主要由 `public/ahmed/ahmed.js` 的 mountable controller 驱动，但组合计算和 detail 展开已经迁到 Ahmed worker
- `Ethan`
  - 兼容 standalone shell，页面外壳是对共享 hero-estimator 面板的 thin wrapper
  - 纯估算逻辑在 `src/ethan/estimator.js`
  - 输入、结果、monitor 适配和状态恢复由 `src/hero-estimator/` 共享层按 `ethanProfile` 驱动
- `Monitor`
  - 管理 live monitor、SSE 事件和 capture driver 状态
  - 展示 raw-compatible 事件、`facts` 和 canonical `state`
- `Price`
  - 展示长期最低价历史、`>= 2x` opportunities、Collections 藏品价格历史和仓库价格视图
  - 在桌面模式下支持刷新单个藏品交易所价格、读取主仓持有快照，并通过 `useWarehouseAutoSeller` 按序自动批量上架仓库藏品
- `Inject`
  - 已改为 workspace shell：左侧按 `基础 / 交易` 分组切换 panel，右侧只显示一个激活 panel
  - 基础 panel 为 `展示柜收益 / Agent 状态 / 控制器 / 元操作`，交易 panel 为 `仓库统计 / 批量移仓 / 延迟价格查询 / 收藏价格采集`
  - `src/inject/panels/*.vue` 现在承载除 `StockMovePanel` 外的各个 panel；`StockMovePanel` 继续作为一级 workspace panel 保留
  - `src/inject/panels/InjectControllerPanel.vue` 现在同时承载 `UI 操作` 和泛型 command console：它先只读显示桌面环境、共享 agent runtime 的桥接可用性/连接状态；`UI 操作` 会通过 `GetCurrentUI -> GetVisiblePanels -> DumpPanelTree` 刷新当前 UI，并以“搜索 + 紧凑节点列表 + 双击按钮行直接点击 + 按需展开详情区”的 operator-first 形态提供结构化操作；command console 在 `desktop + bridge + connected` 时仍可直接发送任意 `runAutoOperationCommand(command, args)`；两者都复用页级 AutoOperation command lock，且 Controller 首次挂载时仍不会额外触发新的 `Ping`
  - 页内切换 panel 时保留各 panel 的局部输入和结果；收到 `bidking:leave-inject` 后会把 Inject 工作台恢复到冷启动状态
  - 批量移仓当前支持主仓库；来源列表按 `itemCid` 合并同类藏品，支持按 `名称 / CID / 品质 / 类型` 搜索，`全选` 仅作用于当前可见分组；在当前游戏构建里，主仓库可能以 `stockId: 0` 出现在 `GetStockContainers` / `MoveStockItem` 流程中

## 服务端事实

### 页面路由

- `GET /`
- `GET /Tools`
- `GET /Monitor`
- `GET /Price`
- `GET /Inject`

### 兼容路由

- `GET /elsa`
- `GET /Elsa`
- `GET /ahmed`
- `GET /Ahmed`
- `GET /ethan`
- `GET /Ethan`
- `GET /tools`
- `GET /monitor`
- `GET /price`
- `GET /inject`

### 数据和业务 API

- `GET /data/collectibles.json`
- `GET /run`
- `GET /api/bidking-monitor/status`
- `POST /api/bidking-monitor/start`
- `POST /api/bidking-monitor/stop`
- `GET /api/bidking-monitor/schema`
- `GET /api/bidking-monitor/events`
- `GET /api/capture-driver/status`
- `POST /api/capture-driver/install`
- `POST /api/capture-driver/uninstall`
- `GET /api/market-prices/latest`
- `GET /api/market-prices/history`
- `GET /api/price-history/latest`
- `GET /api/price-history/collections`
- `GET /api/price-history/item/:itemCid`
- `GET /api/price-history/ladders/:itemCid`


## 求解链路事实

- `/run` 当前白名单脚本共有 9 个：
  - `solve-gold-combo.js`
  - `solve-gold-total.js`
  - `solve-gold-grid.js`
  - `solve-purple-grid.js`
  - `solve-red-grid.js`
  - `solve-type-combo.js`
  - `solve-average-price-combo.js`
  - `solve-purple-combo.js`
  - `solve-purple-total.js`
- `server.js` 通过 SSE 向前端发送 `{ type, text, code }`
- `server.js` 会为 `/run` 子进程设置 `BIDKING_RUNTIME_ROOT`
- `server.js` 当前会把 `/run` 的 `SOLVER_CONCURRENCY` 固定为 `1`
- `lib/solver-inputs.js` 负责平均值/总值与合法件数推导
- `lib/solver.js` 负责 worker 调度、输出保序和分组上限
- `Tools` 当前是混合 tab 页面：
  - `9` 个 solver tabs 继续调用 `/run`
  - `3` 个 hero tabs 直接渲染共享 panel：
    - `src/elsa/ElsaHeroPanel.vue`
    - `src/ethan/EthanHeroPanel.vue`
    - `src/ahmed/AhmedPanel.vue`

## Worker 通道事实

- `Tools` 页 solver tabs 的 `/run` 输出派生当前由 `src/elsa/tools-run-output-worker.js` + `src/elsa/tools-run-output-worker-core.js` 处理；worker 负责 chunk 解析、表格行增量生成、过滤和排序，renderer 只保留 `EventSource`、tab/page state 和渲染。
- `src/hero-estimator/useHeroEstimatorPanel.js` 当前把同步估算、price-only/total-price 流式候选解析和结果行增量生成统一委托给 `src/ethan/estimation-worker.js`；renderer 只转发 `/run` chunk、monitor 事件和表单状态。
- Ahmed 当前通过 `src/ahmed/ahmed-worker.js` + `src/ahmed/ahmed-compute-core.js` + `src/ahmed/ahmed-worker-core.js` 在 worker 内完成可行件数推导、组合枚举、progress/row-batch 增量回写和 detail 展开；`public/ahmed/ahmed.js` 只负责输入解析、worker 生命周期、page state 和 DOM 更新。
- Ahmed worker 当前支持 `start-run`、`cancel-run`、`release-run`、`open-detail` 四类消息；controller 在同步 `postMessage` 失败或 worker runtime error 时会丢弃实例并在下一次 submit 时重建。为避免 detail stale UI，刷新中的详情请求会先清空并隐藏旧 modal 内容。

## Hero Estimator 共享层事实

- `src/hero-estimator/` 是 standalone `Ethan` shell 与 `Tools` 内 `Elsa / Ethan` hero tabs 共用的估算层
- 共享层入口组件是 `src/hero-estimator/HeroEstimatorPanel.vue`
- 共享层状态/求值逻辑在 `src/hero-estimator/useHeroEstimatorPanel.js`
- profile 定义在 `src/hero-estimator/hero-profiles.js`
- monitor 事件按 profile 走 `src/hero-estimator/monitor-profile-adapter.js`
- 结果行拼装由 `src/hero-estimator/result-row-builder.js` 负责
- 共享层当前在 `Worker` 可用时会让 `Ethan` 与 `Elsa` 都走同一份 `src/ethan/estimation-worker.js`；worker core 通过传入的 `groups/profile/predictionGroupKeys` 保持英雄语义，并同时接管同步估算、price-only 搜索、总价候选流和增量 row 生成，而不再把这些分支留在主线程
- `Elsa` profile 当前额外支持 `orange` 组 `总价格` 输入：当金色总格数未知时，共享层会经 `/run?script=solve-gold-total.js` 枚举可行 `{count, totalCells}` 候选，再把候选回灌进主估算链；如果同时填写金色平均格数、总格数或平均价格，则会做交集过滤，无交集时显示明确冲突提示；如果金色总格数已明确，则共享层直接把总价格作为该组价值覆盖，不再额外依赖流式搜索
- 共享层当前直接请求这些 monitor 路由：
  - `GET /api/bidking-monitor/status`
  - `POST /api/bidking-monitor/start`
  - `POST /api/bidking-monitor/stop`
  - `GET /api/bidking-monitor/events`
- profile 驱动的当前本地存储 key：
  - `bidking-page-state:v1:ethan`
  - `bidking-page-state:v1:elsa-hero`
- `Tools` 页面自身现在保存 tab/筛选/solver 输出状态到 `bidking-page-state:v2:elsa`；恢复时会按旧 tab 顺序把 legacy `bidking-page-state:v1:elsa` 数组状态迁移到新的 `tabId` keyed 结构，避免 hero tabs 插入后把老用户状态错位恢复到错误工具
- `Tools` 通过 `?tab=elsa|ethan|ahmed` 驱动初始 hero tab 选择，并在切换 hero tab 时同步更新 URL
- 当 monitor 聚合事件能确定 `purple` 组且只给出 `hitItemIndex: 0`、未给 `totalHitBoxIndex` 时，`lib/bidking-monitor-facts.js` 会补发 `group.totalCellsKnown = 0`；`src/hero-estimator/useHeroEstimatorPanel.js` 因此会把 `#cells-purple` 的 placeholder 显示为 `0`，但不会替用户写入显式 input value。

## 监控与抓包事实

- live monitor 核心在 `lib/bidking-live-monitor.js`
- 当前默认抓包后端是 `auto`
- `auto` 的行为是：
  - 优先使用 bundled/system `dumpcap`
  - 若运行时找不到 `dumpcap`，则直接报错，不再回退到 `pktmon`
- `scripts/prepare-dumpcap-runtime.mjs` 现在只接受本地 `tools/WiresharkPortable64/` 作为输入源，并把 `dumpcap.exe`、顶层 DLL 与可选 `npcap-*.exe` 刷新到 `build/runtime-capture/{dumpcap,npcap}/`
- Electron 打包时会从 `build/runtime-capture/{dumpcap,npcap}/` 打进 `runtime/tools/{dumpcap,npcap}/`
- `lib/capture-driver.js` 负责检测 `dumpcap -D` 可用性，并启动 Npcap 安装器/卸载器

## 价格与自动化事实

- `Tools` 内 `Elsa / Ethan / Ahmed` panels，以及 `Monitor`、`Inject` 页面会请求 `/data/collectibles.json`
- 其中 `/data/collectibles.json` 由服务端映射到 runtime root 下的 `collectibles.json`
  - `/api/price-history/latest`
  - `/api/price-history/collections`
  - `/api/price-history/item/:itemCid`
  - 桌面模式下 `refreshItemTradeInfo()`、`GetItemTradeInfo`、`ExchangeItem` 和 `GetStockContainers`

- `Inject` 页依赖 preload 暴露的桌面 API，不是纯浏览器页面
- preload 当前还暴露注入调度控制、截图状态和收藏价格采集订阅等桌面能力
- AutoOperation 命名管道协议说明在 `docs/AUTO_OPERATION_COMMANDS.md`
- 面向 `Inject -> Controller` 页的可直接复制命令示例在 `docs/CONTROLLER_PAGE_COMMAND_EXAMPLES.md`
- 当前桌面端 `startAutoOperationAgent()` 会先尝试 ping 已存在的 `BKAutoOp` 命名管道；只有 pipe 不可达时才重新注入 `BKAutoOpAgent.dll`，避免同一游戏进程里重复 `LoadLibrary` 同一路径的 agent DLL。
- 当前桌面端执行 `UnloadAgent` 时，会等待 `BKAutoOp` pipe 消失并额外留出短暂释放缓冲后再返回，降低退出应用后立刻重打包时命中旧 DLL 文件锁的概率。
- `Inject` 页当前由 `src/inject/App.vue` 只负责 workspace 壳层、共享 `collectibles` 加载和跨 panel 的 AutoOperation command lock；展示柜收益 / Agent 状态 / 控制器 / 元操作 / 仓库统计 / 延迟价格 / 收藏采集都已拆到 `src/inject/panels/*.vue`，只有 `StockMovePanel.vue` 继续保留为一级 panel。`Controller` panel 内部现在拆成 readiness cards + `UI 操作` 子面板 + `仓库自动排序` 子面板 + 泛型 command console；其中 `UI 操作` 与 command console 继续复用这把共享 command lock，而 `仓库自动排序` 当前是由 `InjectWarehouseBatchOpPanel.vue` + `useWarehouseBatchOp.js` 承载的独立 workflow surface。
- `src/inject/panels/InjectMetaOperationPanel.vue` 是一个独立的 Inject 业务入口层：它消费共享 agent runtime 的只读状态，通过现有 `runAutoOperationCommand(command, args)` bridge 暴露 16 个当前原生命令入口，其中 13 个 zero-arg 动作是 `GoToBattlePrev`、`OpenSkillConfig`、`SelectRole`、`StartAction`、`GetBidState`、`PlaceBid`、`ConfirmBid`、`DismissRewardsBox`、`DismissCollectAward`、`GetCurrentScreen`、`CloseCurrentOverlay`、`CollectCabinetReward`、`GetAutoCollectCabinetRewardState`，另外还提供参数化的 `EnterRoom`、`SetBidAmount` 与 `SetAutoCollectCabinetRewardEnabled`（展柜收益自动调度开关）；它会把最近一次响应展示为格式化 JSON，但不承载泛型命令输入，也不根据当前游戏画面做前端按钮级 gating。
- 当前 `AutoAuction` 第一回合最低价仍默认按 `17000` 起拍，但当 `roomId = 102`（`废弃仓库`）时，native agent 会改用 `30000` 作为首回合 floor；该规则由 `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h` 统一解析，并由 `MetaOperations.cpp` 在出价循环里消费。
- `tools/inject/AutoOperation/BKAutoOpClient/` 当前在仓库内没有已知调用链，但仓库仍保留 `tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.dll`，且 `package.json` 中 `extraResources` 仍会按 `tools/inject/**/*.dll` 过滤把它纳入桌面产物；基于当前 worktree 可验证事实，这轮不能把它按纯 dead code 直接删除。
- `Inject` 页当前新增 `批量移仓` 面板：先调用 `runAutoOperationCommand('GetStockContainers')` 拉取物品箱快照，再由 `src/inject/stock-move.js` 在 renderer 侧按 row-major 空位扫描目标落点，最后顺序执行 `MoveStockItem`；来源表按 `itemCid` 聚合同类实例，并支持对 `名称 / 品质 / 类型 / CID / 尺寸 / 数量 / 占格` 7 列做单列升序/降序排序，默认顺序仍为 `boxCount` 降序、藏品名称升序、`itemCid` 升序；勾选一行会展开成该 `itemCid` 的全部实例参与移动；若实际要发出多条 `MoveStockItem`，两条真实移动命令之间固定等待 `1s`，并且每次跳过/成功/失败后都会实时刷新 `已处理 / 总数 / 成功 / 跳过 / 失败 / 当前藏品` 进度，成功移动仍以前一条命令返回的新快照作为下一次摆放依据。当前 agent 会在每次 `MoveStockItem` 成功后额外调用一次 `PlayerManager.GetAllStocks()` 刷新库存缓存；若这一步未完成，pipe 响应会把 `stocksRefreshed` 标成 `false`，但不会把已成功的移动误报为失败。面板当前还支持把 Saved List 保存到 `Documents/BidKing/stock-move-lists/`：每个列表一个 JSON 文件，包含 `itemCids` 和展示快照 `items`；新建列表入口已经改成独立 modal，可从全量 `collectibles.json` 搜索任意藏品追加到草稿，也可以把当前源仓勾选的 `itemCid` 快速导入草稿；页面挂载、成功加载物品箱和 modal 保存成功后都会刷新列表；应用列表时只选中当前源仓实际存在的 `itemCid`，并显示保存种类数、保存时间、当前匹配数；如果刷新请求乱序返回，renderer 会丢弃过期响应，避免旧列表结果覆盖新状态。当前游戏构建里，这一步仍不能稳定触发已打开的仓库 / 物品箱页面即时重绘。
- `GetStockContainers` 当前会把主仓库作为合法容器返回；如果游戏原始 `GetAllStocks()` 把主仓库标成 `stockId: 0`，renderer 和 agent 都会按“非负整数 stockId”处理，而不会再把它当作非法容器过滤掉。
- AutoOperation 命名管道当前接受到 `256KB` 的单帧 JSON 响应；这是为了让 `GetStockContainers` 在包含主仓库完整 `boxIds` 时不再命中旧的 `64KB` 响应上限。

## TopBar Runtime Controls

- `src/shared/useMonitorSwitch.js` 现在是 renderer 侧唯一的 monitor runtime owner：集中负责 `/api/bidking-monitor/status`、`start/stop` 和唯一一条 `/api/bidking-monitor/events` SSE 连接。
- `src/shared/useAutoOperationAgentSwitch.js` 现在是 renderer 侧唯一的 AutoOperation Agent runtime owner：集中负责桌面能力探测、`Ping` 探活以及 `load/unload BKAutoOpAgent.dll` 的并发保护。
- `src/shared/TopBar.vue` 只保留 `Home`、`Tools`、`Monitor`、`Price`、`Inject` 五个导航项，并常驻渲染 `Monitor switch`；`Agent switch` 仅在桌面桥同时提供 `startAutoOperationAgent()` 与 `runAutoOperationCommand()` 时显示。
- `Ethan` / `Elsa` 共用的 `src/hero-estimator/useHeroEstimatorPanel.js` 不再自己管理 monitor 开关或 SSE，只订阅共享 runtime 并保留英雄专属事件解释逻辑。
- `/Monitor` 页面现在与 TopBar 共用同一份 monitor status / SSE；当页面已打开时，点击顶栏 Monitor switch 会沿用当前表单里的 `remoteAddress / port / batchSeconds / gameRoot / outputDir` 配置，并同步更新页面状态和事件列表。
- `/Inject` 页面现在与 TopBar 共用同一份 agent status；无论点击页内按钮还是顶栏 Agent switch，`AutoOperation Agent` 状态文案都会同步。
- `TopBar` 离开 `Inject` 前会先派发 `bidking:leave-inject`；`src/inject/App.vue` 监听该事件并重置 active panel、已访问 panel 集合、共享 `collectibles` 和共享 command lock，因此重新进入 `Inject` 时按冷启动处理。

## 运行时路径与数据源

- runtime root 默认是项目根目录；Electron 打包后会切到 `resources/runtime`
- `/data/collectibles.json` 实际返回 runtime root 下的 `collectibles.json`
- `public/data/collectibles.json` 主要作为测试和仓库内公开数据副本使用
- `public/data/quality-size-average-prices.json` 通过静态资源路径 `/data/quality-size-average-prices.json` 提供，Ahmed panel 与共享 hero-estimator surfaces 会直接请求它
- `getDocumentsDir()` 会优先使用 `BIDKING_DOCUMENTS_DIR`，否则回退到用户 `Documents`
- live monitor 默认日志目录是应用根目录下的 `log/`
- 本地抓包源目录固定为 `tools/WiresharkPortable64/`；该目录当前作为本机依赖存在，不需要纳入仓库跟踪

## 当前仓库约束

- Ahmed 改 UI 时必须保留旧控制器依赖的 DOM id、class 和 `data-*` hook，并保持 controller attach/detach contract 可在 standalone shell 与 `Tools` embedded mode 复用
- Ethan 新增估算逻辑时，优先改 `src/ethan/estimator.js` 并补对应 UT
- 页面、路由、API、脚本参数、运行时路径或验证命令变化时，同轮更新文档
- 验证命令要尽量避免覆盖无关脏改动，尤其是 tracked 页面构建产物
- `npm run pack` 现在默认输出到 `dist/<YYYYMMDDHHMMSS>`；如需固定目录名，继续显式传 `--app-dir-name <name>`
- `npm run pack` 在构建前会先做 preflight，`resolvePackProfile()` 只会返回 `windows-native` 或 `linux-native`
- `npm run pack` 的 `assertSupportedPackHost()` 现在显式约束当前的 `x64 GNU Linux` 依赖契约；不满足时会在任何 build stage 之前失败
- `npm run pack` 现在不会再在 Linux / WSL 下桥接到 Windows 侧工具
- `scripts/clean-page-builds.mjs` 只清理各页面的 `assets/` 目录，不会删除 `public/index.html` 这个 Tools 入口页
- `scripts/pack-win-dir.mjs` 现在在 Windows 上直接调用 `.cmd` 包装器，不再依赖 `shell: true`，从而避免 `DEP0190` warning
- native Windows 仍会执行 `patch-win-icons.js`
- `npm run deploy:game-pc` 为了保持默认部署路径稳定，内部仍显式执行 `npm run pack -- --app-dir-name win-unpacked`

## 常用命令

### 开发与构建

- `npm test`
- `npm run test:coverage`
- `npm run build:pages`
- `npm run verify`
- `npm run desktop`
- `npm run pack`
- `npm run pack -- --app-dir-name $(Get-Date -Format 'yyyyMMddHHmmss')`
- `npm run pack -- --app-dir-name BKToolBox-dev`
- `npm run dist:win`

### 数据与监控

- `npm run extract:collectibles`
- 最新游戏本体藏品提取流程：`docs/BIDKING_COLLECTIBLES_EXTRACTION.md`
- `npm run prepare:dumpcap`
- `npm run watch:game-log -- --game-root "<path>"`

### 收尾

- `git diff --check`

## 本轮文档刷新覆盖的 current-state 变化

- current-state 文档现在统一把 `Price` 记录为第 5 个 canonical 工作面，并把 `src/price/ -> public/price/` 记为第 7 个页面入口 bundle
- `Monitor` 与 `Price` 的页面职责已重新拆分：实时抓包 / driver 状态保留在 `Monitor`，价格历史 / Collections / 仓库价格视图保留在 `Price`
- M1 / M2 文档校验命令与常用 `pack` 时间戳示例已改成当前 PowerShell 环境可直接执行的写法
- `Tools` 现在是 `3` 个 hero tabs 加 `9` 个 solver tabs，而不是纯 solver 页面
- `src/hero-estimator/` 现在是 standalone `Ethan` shell 与 `Tools` 内 `Elsa / Ethan` hero tabs 共用的 profile 驱动估算层
- `Ahmed` 现在通过 `src/ahmed/AhmedPanel.vue` + `public/ahmed/ahmed.js` mountable controller 同时服务 standalone shell 与 `Tools` 内 hero tab
- `/Ahmed` 与 `/Ethan` 现在是兼容重定向入口，canonical 目标分别为 `/Tools?tab=ahmed` 与 `/Tools?tab=ethan`
- `Tools` solver 输出、shared Hero Estimator 流式估算和 Ahmed 组合计算现在各自走独立 worker 通道，避免长时间计算阻塞 UI 线程

## 最新验证

- 2026-06-26：`rg -n 'build:price|/Price|active-page="price"|href="/Price"' package.json server.js src/shared/TopBar.vue src/home/App.vue src/price/App.vue` 返回命中 `build:price`、`app.get(['/price', '/Price'])`、TopBar `'/Price'` 导航项、Home `/Price` 入口卡片，以及 `src/price/App.vue` 的 `TopBar active-page="price"`；说明 `Price` 仍是独立的一等构建入口、服务端路由和页面壳层。
- 2026-06-26：`$docs = 'docs/Prompt.md','docs/Plan.md','docs/Implement.md','docs/Documentation.md','docs/ARCHITECTURE.md'; foreach ($doc in $docs) { Write-Output ('### ' + $doc); Get-Content $doc -TotalCount 40 | Out-Null }`、`rg -n 'Invoke-WebRequest|Get-Date -Format ''yyyyMMddHHmmss''|Price|/Price' docs/Plan.md docs/Implement.md docs/Documentation.md docs/ARCHITECTURE.md` 与 `git diff --check` 均通过；说明这轮 current-state 文档修正后的 `Price` 事实、PowerShell 校验命令和 `pack` 时间戳命令没有留下格式或 shell 兼容性问题。
- 2026-06-24：`node tools/bkcli/bkcli.js get-current-screen` 返回 `authcode`，`node tools/bkcli/bkcli.js get-visible-panels` 返回 `UIMain`、`BattlePrevPanel_Main`、`AuthCode_Main`、`ItemDetail_Main`、`InvitePanel`，`node tools/bkcli/bkcli.js dump AuthCode_Main --all --depth 8 --limit 800` 确认滑动验证界面的关闭按钮路径是 `Main/m_BtnClose`、滑块路径是 `Main/Move`。
- 2026-06-24：`node tools/bkcli/bkcli.js click AuthCode_Main Main/m_BtnClose` 成功关闭验证界面；随后 `node tools/bkcli/bkcli.js get-current-screen` 返回 `auction_lobby_room`，`AuthCode_Main` 不再可见。
- 2026-06-24：`wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-dismiss-authcode && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/aggregate-operation-semantics-test && /tmp/aggregate-operation-semantics-test"`、`wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-dismiss-authcode && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp -o /tmp/meta-operations-test && /tmp/meta-operations-test"`、`wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-dismiss-authcode/tools/inject/AutoOperation/BKAutoOpAgent && ./build.sh"` 均通过；说明新增的 authcode 关闭目标语义、既有 AutoAuction JSON 契约，以及 `BKAutoOpAgent.dll` 原生构建链路都保持正常。
- 2026-06-24：`npx vitest run src/elsa/useElsaAutoOperation.test.js` 通过，`1` 个测试文件、`29` 个用例全绿；说明这轮 native `AutoAuction` authcode 关闭补点没有改变 renderer 侧现有停止/通知/focus 合约。
- 2026-06-19：`npx vitest run src/inject/App.test.js src/inject/panels/InjectMetaOperationPanel.test.js` 通过；覆盖 Inject 基础分组新增 MetaOperation tab、英文文案路径、MetaOperation 入口渲染、EnterRoom 中文房间下拉、正确命令分发、共享 command lock gating，以及最近一次结果 JSON 展示。
- 2026-06-19：`npm run build:inject` 通过；说明新增 InjectMetaOperationPanel.vue、i18n 和样式改动可正常构建到 `public/inject/`。
- 2026-06-19：`git diff --check` 无输出，说明这轮 MetaOperation panel 改动和文档同步未引入补丁格式问题。
- 2026-06-18：`npx vitest run src/inject/panels/useControllerUiAutomation.test.js src/inject/panels/InjectUiAutomationPanel.test.js src/inject/panels/InjectControllerPanel.test.js src/inject/App.test.js` 通过，`4` 个测试文件、`56` 个用例全绿；覆盖 `Controller` 新增 `UI 操作` 子面板的 activation refresh、shared command lock 释放后的自动补刷新、visible panel 切换、node 选择、切换节点时清空旧 action result，以及已实际落测的 `Button` `ClickNode` 与 `TMP_InputField` `SetInputText` 路径，并确认它继续接入页面级 shared AutoOperation command lock。
- 2026-06-18：`npx vitest run src/shared/useAutoOperationAgentSwitch.test.js` 通过，`1` 个测试文件、`12` 个用例全绿；结合上面的 `InjectControllerPanel` / `App` 测试链路，shared AutoOperation runtime 仍是唯一 `Ping` owner，因此 `Controller` 继续被动订阅 shared runtime，在首次挂载时不会额外触发新的 `Ping`。
- 2026-06-18：`npm run build:inject` 通过；Vite 成功把 Inject 页面产物写入 `public/inject/`（包含 `index.html` 和 `assets/` 下的构建输出），说明包含 `Controller UI 操作`、泛型 command console 和相关 i18n 的 Inject 页面可成功构建。
- 2026-06-18：`git diff --check` 无输出，说明本轮 current-state 文档同步未引入空白或补丁格式问题。
- 2026-06-18：Windows native 构建链路修复。`package.json` 新增 `@rolldown/binding-win32-x64-msvc` 到 `optionalDependencies`，与已有的 `@rolldown/binding-linux-x64-gnu` 并列；`ELECTRON_MIRROR` 从 `.npmrc` 静态配置改为运行时环境变量（`pack-win-dir.mjs` 启动时设入 `process.env`，`dist:win` 通过 `node -e` 包装 `electron-builder` 调用），消除 npm 11 对未知 `.npmrc` 键的 warning；`scripts/pack-win-dir.test.mjs` 中 3 个测试改为跨平台写法。
- 2026-06-18：`npm run build:pages` 在 Windows native (Node.js v24.16.0, Windows 11 Pro 10.0.26200) 通过，6 个页面入口（`home / elsa / ahmed / ethan / monitor / inject`）全部构建成功。
- 2026-06-18：`npm run pack -- --app-dir-name BKToolBox-dev` 在 Windows native 通过，完整链路 `build:pages → prepare:dumpcap (79 files) → electron-builder → patch-win-icons` 全部成功；electron-builder 报告 `@rolldown/binding-linux-x64-gnu` 为 missing optional dependency（Windows 上预期行为）。
- 2026-06-18：`npx vitest run scripts/pack-win-dir.test.mjs package-config.test.mjs scripts/windows-build-metadata.test.mjs scripts/clean-page-builds.test.mjs scripts/prepare-dumpcap-runtime.test.mjs scripts/icon-asset.test.mjs` 通过，`35` 个构建相关测试全绿，跨平台兼容。
- 2026-06-18：`git diff --check` 无输出，改动范围仅限 `.npmrc`、`package.json`、`package-lock.json`、`scripts/pack-win-dir.test.mjs` 四个文件。
- 2026-06-06：`npx vitest run src/ahmed/App.test.js src/ahmed/AhmedPanel.test.js public/ahmed/ahmed-controller.test.mjs public/ahmed/ahmed-core.test.mjs` 通过，`56` 个测试全绿；新增覆盖 Ahmed worker submit progress、rerun stale-drop、clear 时 `cancel-run/release-run`、同步 `postMessage` 失败后的重建重试、streaming 期间 detail 与 `run-complete` 竞态、刷新 detail 失败时清空 stale modal，以及 standalone controller 与 embedded panel 的兼容行为。
- 2026-06-06：`npm run build:pages` 通过；当前构建实际产出了 `public/ahmed/assets/ahmed-worker-*.js` 与 `public/elsa/assets/ahmed-worker-*.js`，说明 standalone Ahmed 与 Tools 内 Ahmed panel 都能拿到独立 worker bundle，而不是退回主线程。
- 2026-06-06：`git diff --check` 无输出，说明本轮 Ahmed worker 化与 current-state 文档补录未引入空白或补丁格式问题。
- 2026-06-06：`npx vitest run src/ethan/estimator.test.js src/elsa/ElsaHeroPanel.test.js src/hero-estimator/HeroEstimatorPanel.test.js` 通过，`62` 个测试全绿；新增覆盖 Elsa 金色总价格输入渲染、`solve-gold-total.js` 候选搜索、与金色平均格数/总格数/均价的交叉过滤、无 `EventSource` 时的已知格数同步回退，以及 cells+totalPrice 的本地精确组合校验 helper。
- 2026-06-06：`npm run build:pages` 通过，说明 Elsa 金色总价格字段与共享 `HeroEstimator` 估算链改动可正常构建到各页面 bundle。
- 2026-06-06：`git diff --check` 无输出，说明本轮 Elsa 金色总价格约束功能与文档补录未引入空白或补丁格式问题。
- 2026-06-05：`npx vitest run src/inject/stock-move-saved-list-draft.test.js src/inject/StockMoveListEditorModal.test.js src/inject/StockMovePanel.test.js` 通过，`31` 个测试全绿；覆盖全量藏品 Saved List modal、导入当前勾选项、失败路径、主面板 modal 打开/关闭和保存后列表刷新。
- 2026-06-05：`npm run build:inject` 通过，说明本轮 Batch Stock Move Saved List modal 与主面板集成可以正常构建到 `public/inject/`。
- 2026-06-05：`git diff --check` 无输出，说明本轮 full-collectibles Saved List editor 改动和 current-state 文档更新未引入空白或补丁格式问题。
- 2026-06-12：`git diff --check` 无输出，说明本轮 Documentation.md 更新未引入空白或补丁格式问题。
- 2026-06-19：`npx vitest run src/inject/panels/InjectUiAutomationPanel.test.js src/inject/panels/useControllerUiAutomation.test.js src/inject/panels/InjectControllerPanel.test.js src/inject/App.test.js` 通过；覆盖 `Controller -> UI 操作` 的紧凑搜索列表、mapped label/path fallback、single-click 只选中、double-click 触发 `ClickNode`、non-clickable 行反馈、shared command lock busy gating，以及既有 activation refresh / panel reopen / structured action 链路未回归。
- 2026-06-19：`npm run build:inject` 通过；说明 compact redesign 后的 `UI 操作` 子面板、i18n 与样式改动可正常构建到 `public/inject/`。
- 2026-06-19：`git diff --check` 无输出，说明本轮 `Controller UI 操作` 紧凑化改动与文档同步未引入空白或补丁格式问题。
- 2026-06-12：`npx vitest run scripts/pack-win-dir.test.mjs` 通过，`22` 个测试全绿；`scripts/patch-win-icons.js` 的目标解析现在按宿主文件系统路径处理，Linux 下 `patch-win-icons target resolution` 的 4 个基线失败已修复，`rcedit` 入口仍保留 Windows / WSL 转换。
- 2026-06-05：`npx vitest run scripts/pack-win-dir.test.mjs scripts/deploy-unpacked-app.test.mjs package-config.test.mjs` 通过，`12` 个测试全绿；覆盖 `npm run pack` 默认时间戳目录名、显式 `--app-dir-name` 覆盖、`deploy:game-pc` 显式固定 `win-unpacked` 构建路径，以及 `package.json` 仍通过自定义 `pack` wrapper 入口打包。
- 2026-06-11：`npx vitest run scripts/pack-win-dir.test.mjs scripts/deploy-unpacked-app.test.mjs package-config.test.mjs` 通过；覆盖 WSL helper 合约、`.cmd` 包装、`build:pages` 原生/桥接分派、`electron-builder` Windows 桥接、`prepare:dumpcap` / `patch-win-icons` 原生分派，以及非 WSL Linux 的前置失败分支。
- 2026-06-05：`npx vitest run src/elsa/App.test.js src/ahmed/App.test.js public/ahmed/ahmed-controller.test.mjs` 通过，`47` 个测试全绿；新增覆盖 `Tools` 页 `tabId` keyed page state、legacy `v1` tab-order 迁移、standalone `/Ahmed` shell 上 `Tools` 链接仍可导航，以及 Ahmed controller 在 `cleanup -> remount` 后忽略旧 `loadData()` 成功回写的回归场景。
- 2026-06-05：`git diff --check` 无输出；说明本轮 current-state 文档刷新没有引入空白或补丁格式问题。
- 2026-06-05：对 `docs/Plan.md`、`docs/Implement.md`、`docs/Documentation.md`、`docs/ARCHITECTURE.md` 执行旧口径 `rg` 扫描无命中；说明 current-state 文档已清掉这批与当前项目状态冲突的旧口径。
- 2026-06-05：`npx vitest run src/elsa/App.test.js src/ahmed/App.test.js public/ahmed/ahmed-controller.test.mjs src/home/App.test.js src/shared/TopBar.test.js server.test.mjs` 通过，`76` 个测试全绿；覆盖 `Tools` hero tabs、`/Ahmed` / `/Ethan` 兼容重定向、shared `AhmedPanel` standalone shell、mountable Ahmed controller，以及移除独立 `Ahmed / Ethan` 导航后的 `Home` / `TopBar` 行为。
- 2026-06-04：`g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/MoveStockItemResult.test.cpp -o /tmp/bk_move_stock_item_result_test && /tmp/bk_move_stock_item_result_test` 通过，覆盖 `MoveStockItem` 成功响应里 `stocksRefreshed: true/false` 的 JSON 契约。
- 2026-06-05：`npx vitest run electron/services/inject-service.test.mjs src/inject/StockMovePanel.test.js` 通过，`2` 个测试文件、`46` 个测试全部为绿色；新增覆盖 Saved Lists 的持久化、坏文件跳过与告警、Atomic write、挂载/加载/保存后的列表刷新、保存种类数/保存时间展示，以及刷新请求乱序返回时的 stale-response 保护。
- 2026-06-05：`npm run build:inject` 通过，说明本轮 Inject Saved Lists 的 Vue / i18n / renderer 改动可正常构建到 `public/inject/`。
- 2026-06-05：`git diff --check` 无输出，说明本轮 Saved Lists 集成与文档补录未引入空白或补丁格式问题。
- 2026-06-04：`bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh` 通过；为避免后台线程直接驱动 `PlayerGameData.RefreshStockData()` 造成游戏崩溃，当前 `BKAutoOpAgent.dll` 已回退到 `MoveStockItem` 成功后只额外调用一次 `PlayerManager.GetAllStocks()`。这能刷新库存缓存，但仍不能稳定触发已打开的游戏内仓库 / 物品箱页面即时重绘。
- 2026-06-04：`npx vitest run src/inject/App.test.js src/inject/stock-move.test.js src/inject/StockMovePanel.test.js electron/services/inject-service.test.mjs` 通过，`58` 个测试全绿；新增覆盖 `MoveStockItem` 的 `stocksRefreshed` 元数据透传，以及 renderer 侧忽略新增字段但仍继续使用 `containers` 快照。
- 2026-06-04：`npx vitest run electron/services/inject-service.test.mjs` 通过，新增覆盖 `sendAutoOperationCommand()` 解析大于 `64KB` 的 AutoOperation 响应帧；当前 service 侧已接受到 `256KB` 的单帧结果。
- 2026-06-04：`x86_64-w64-mingw32-g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/ProtocolFrameSize.test.cpp -o /tmp/bk_protocol_frame_size_test.exe && /tmp/bk_protocol_frame_size_test.exe` 通过，覆盖 native 协议常量：`BK_BUF_SIZE >= 262144`。
- 2026-06-04：`npx vitest run src/inject/App.test.js src/inject/stock-move.test.js src/inject/StockMovePanel.test.js electron/services/inject-service.test.mjs` 通过，`55` 个用例全部为绿色，说明把 AutoOperation 帧上限提升到 `256KB` 后没有破坏 Inject 页面现有命令链路。
- 2026-06-04：`bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh` 再次通过；当前 `BKAutoOpAgent.dll` 已能在包含主仓库完整布局时返回更大的 `GetStockContainers` / `MoveStockItem` 快照，而不会再报 `stock container response too large`。
- 2026-06-04：`npx vitest run src/inject/StockMovePanel.test.js` 通过，新增覆盖主仓库 `stockId: 0` 场景：Inject 批量移仓面板会显示主仓库条目，并能向 `MoveStockItem` 透传 `oldStockId: 0`。
- 2026-06-04：`npx vitest run src/inject/StockMovePanel.test.js` 通过，新增覆盖批量移仓来源表按 `itemCid` 分组、搜索过滤、仅对可见分组 `全选`，两次真实 `MoveStockItem` 之间 `1s` 间隔，以及执行中实时显示 `processed / total / success / skipped / failed / current item` 进度。
- 2026-06-04：`npx vitest run src/inject/App.test.js src/inject/stock-move.test.js src/inject/StockMovePanel.test.js electron/services/inject-service.test.mjs` 通过，`54` 个测试全绿；说明主仓库 `stockId: 0` 支持没有破坏 Inject 页批量移仓面板、落点扫描 helper 和桌面 service 命令链路。
- 2026-06-04：`npx vitest run src/inject/App.test.js src/inject/stock-move.test.js src/inject/StockMovePanel.test.js electron/services/inject-service.test.mjs` 通过，`56` 个测试全绿；说明批量移仓分组/搜索/节奏控制没有破坏 Inject 页批量移仓面板、落点扫描 helper 和桌面 service 命令链路。
- 2026-06-04：`g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/MoveStockItemResult.test.cpp -o /tmp/bk_move_stock_item_result_test && /tmp/bk_move_stock_item_result_test` 通过，覆盖 `MoveStockItem` 成功响应 JSON 现在会携带 `stocksRefreshed: true/false`，并保持 `containers / count / source` 快照字段不变。
- 2026-06-04：`npx vitest run src/inject/App.test.js src/inject/stock-move.test.js src/inject/StockMovePanel.test.js electron/services/inject-service.test.mjs` 通过，`58` 个测试全绿；说明 `MoveStockItem` 新增 `stocksRefreshed` 元数据没有破坏 Inject 页批量移仓面板、renderer 对 `containers` 快照的消费，以及桌面 service 对 Agent pipe 结果的透传。
- 2026-06-04：`bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh` 通过；当前 `BKAutoOpAgent.dll` 会在每次 `MoveStockItem` 成功后额外调用一次 `GetAllStocks()`，把刷新结果写回 `stocksRefreshed`，但游戏内仓库 / 物品箱页面仍可能需要手动自动排序才能立刻重绘。
- 2026-06-04：`g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/StockIdSemantics.test.cpp -o /tmp/bk_stock_id_semantics_test && /tmp/bk_stock_id_semantics_test` 通过，覆盖 Agent 当前 `stockId` 语义：`0` 合法、负数非法、未被 raw 容器确认的 `stockId: 0` layout 仍会被丢弃。
- 2026-06-04：`bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh` 再次通过；当前 `BKAutoOpAgent.dll` 已支持把主仓库 `stockId: 0` 作为合法容器参与 `GetStockContainers` / `MoveStockItem`。
- 2026-06-04：`bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh` 再次通过；当前 `BKAutoOpAgent.dll` 已额外输出 `GetStockContainers` 的 unresolved layout、raw stock skipped/matched/unmatched 和 drop 日志，用于继续定位“主仓库未出现在批量移仓下拉框”问题。
- 2026-06-04：`g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/WarehouseLayoutSource.test.cpp -o /tmp/bk_warehouse_layout_source_test && /tmp/bk_warehouse_layout_source_test`、`g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/WarehouseIdentity.test.cpp -o /tmp/bk_warehouse_identity_test && /tmp/bk_warehouse_identity_test`、`g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/WarehouseLayoutMatch.test.cpp -o /tmp/bk_warehouse_layout_match_test && /tmp/bk_warehouse_layout_match_test` 均通过，说明这轮 agent 诊断日志补点没有破坏仓库布局来源、identity 解析和 layout match 纯逻辑。
- 2026-06-04：`git diff --check` 无输出，说明本轮 agent 诊断补丁与文档补录未引入空白或补丁格式问题。
- 2026-06-04：`g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/WarehouseIdentity.test.cpp -o /tmp/bk_warehouse_identity_test && /tmp/bk_warehouse_identity_test` 通过，覆盖仓库 identity 解析优先级：`stockData field -> GetStockContainerData() -> uuid/cid`。
- 2026-06-04：`g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/WarehouseLayoutMatch.test.cpp -o /tmp/bk_warehouse_layout_match_test && /tmp/bk_warehouse_layout_match_test` 通过，覆盖原始 `GetAllStocks` 容器对未解出 `stockId` 的仓库布局认领逻辑。
- 2026-06-04：`bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh` 通过，说明本轮主仓库 stock layout 识别修复后的 agent DLL 可正常重编译。
- 2026-06-04：`g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/WarehouseLayoutSource.test.cpp -o /tmp/bk_warehouse_layout_source_test && /tmp/bk_warehouse_layout_source_test` 通过，覆盖 `GetStockContainers` 的仓库布局来源选择：优先 `PlayerManager.GetWareHouseDatas()`，缺失时回退到 `PlayerGameData.wareHouses`。
- 2026-06-04：`npx vitest run src/inject/App.test.js src/inject/stock-move.test.js src/inject/StockMovePanel.test.js electron/services/inject-service.test.mjs` 通过，覆盖 Inject 批量移仓面板集成、放置扫描 helper、批量移动摘要统计，以及 `GetStockContainers` / `MoveStockItem` 的 service timeout。
- 2026-06-03：`npx vitest run electron/services/inject-service.test.mjs` 通过，覆盖了 AutoOperation Agent 的“复用现有 pipe 而不是重复注入”、`UnloadAgent` 等待 agent 真正停止响应，以及超时失败分支。
- 2026-06-03：`npx vitest run src/shared/useMonitorSwitch.test.js src/shared/useAutoOperationAgentSwitch.test.js src/shared/TopBar.test.js src/hero-estimator/HeroEstimatorPanel.test.js src/monitor/App.test.js src/inject/App.test.js` 通过，覆盖了共享 monitor runtime、共享 agent runtime、顶栏开关、Hero Estimator、`/Monitor`、`/Inject` 的同步行为。
- 2026-06-03：`npm run build:pages` 通过，`home / elsa / ahmed / ethan / monitor / inject` 六个入口均完成重建，说明本轮 TopBar runtime 改动没有破坏页面构建。
- 2026-06-03：`npm run pack` 在当前机器仍失败，失败点仍是 `dist/win-unpacked/resources/runtime/tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`。额外用 `cmd.exe /c del ...BKAutoOpAgent.dll` 验证时，Windows 返回“拒绝访问”；同时 `BidKing.exe` 仍在运行，说明这次失败是旧打包目录里的 agent DLL 仍被游戏进程持有，不是 electron-builder 配置本身的新错误。
- 2026-06-03：`git diff --check` 无输出，说明本轮文档补录未引入空白或补丁格式问题。
- 2026-06-03：人工核对 `src/elsa/App.vue`、`src/elsa/ElsaHeroPanel.vue`、`src/ethan/App.vue`、`src/ahmed/AhmedPanel.vue`、`src/hero-estimator/hero-profiles.js`、`src/hero-estimator/useHeroEstimatorPanel.js`，确认当时 current-state 为 `Tools = 3 hero tabs + 9 solver tabs`，且 `src/hero-estimator/` 与 shared `AhmedPanel` 已分别作为 `Ethan/Elsa` 与 `Ahmed` 的共用层落地。
- 2026-06-02：使用 Node route dump 脚本枚举 `server.js` 路由，确认当前页面路由和 API 路由与文档一致，实际包含 `/Monitor`、、`/Inject` 及相关 `/api/*` 接口，以及各页面的小写兼容重定向。
- 2026-06-02：`git diff --check` 无输出，说明本轮文档修改未引入空白/补丁格式问题。
- 2026-06-02：`npm test` 在当前环境失败。
  - Vitest 汇总：`45` 个测试文件中 `41` 个通过、`4` 个失败；`511` 个测试中 `488` 个通过、`23` 个失败，另有 `18` 个未处理错误。
  - `server.test.mjs` 相关失败的直接错误是 `listen EPERM: operation not permitted 0.0.0.0`，表现为当前沙箱环境不允许测试里临时监听 `0.0.0.0`。
  - `solve-gold-combo.test.mjs`、`solve-purple-combo.test.mjs`、`solve-average-price-combo.test.mjs` 当前都出现“预期组合结果为空”的失败，这些是现有代码/数据基线问题，不是本轮文档改动引入的变化。
- 2026-06-02：本轮没有执行 `npm run build:pages`，原因是工作区原本就存在无关的 `public/inject/*` 脏改动；重建页面产物会覆盖这些无关变更，不符合最小破坏面验证原则。

## 已知限制

- `build:pages` 会写入页面构建产物；如果工作区已有无关脏改动，本轮需要先判断是否适合重建
- 部分 Inject 功能依赖桌面环境，纯浏览器访问时只能看到降级状态
- 当前 `MoveStockItem` 成功后的 `GetAllStocks()` 只能刷新库存缓存，仍不能稳定触发已打开的游戏内仓库 / 物品箱页面即时重绘；手动点击游戏内自动排序仍会强制刷新该 UI。直接在 agent pipe 线程调用 `PlayerGameData.RefreshStockData()` 会导致游戏崩溃，因此这条链路当前被禁用。
