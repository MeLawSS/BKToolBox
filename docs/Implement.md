# BKToolBox Implement

## 工作规则

- `docs/Plan.md` 负责描述当前任务顺序、里程碑和停止条件
- `docs/Documentation.md` 记录 current-state 事实、命令和运行时约束
- `docs/ARCHITECTURE.md` 负责解释结构和模块分工
- 每轮修改都要控制范围，不回滚或覆盖无关用户改动
- 页面、路由、API、脚本参数、运行时路径或验证命令变动时，同轮同步更新文档
- 完成一轮修改后，先做 fresh verification，再更新文档，再 `git commit`

## 推荐流程

1. 读取 `docs/Prompt.md`、`docs/Plan.md`、`docs/Documentation.md`
2. 用代码和命令确认当前任务涉及的真实路径、真实接口和真实行为
3. 做最小改动
4. 运行与改动范围匹配的验证命令
5. 修复失败
6. 更新相关文档
7. 检查 diff 边界
8. `git commit`

## 验证顺序

- 如果改动的是纯逻辑、路由、Electron helper、监控 store 或页面行为：优先跑相关 `npm test` / `npx vitest run ...`
- 如果改动会影响多页面静态资源，并且不会覆盖无关脏改动：再跑 `npm run build:pages`
- 如果改动是 docs-only：至少运行文档相关 sanity check 和 `git diff --check`；如需支撑文档事实，可补跑 `npm test`
- 只有在 fresh verification evidence 可读可解释时，才能声称完成

## 当前仓库约定

### 页面源码与构建

- 首页源码在 `src/home/`，产物输出到 `public/home/`
- Tools 源码在 `src/elsa/`，产物输出到 `public/index.html` 和 `public/elsa/`，同时作为 `Elsa / Ethan / Ahmed` 的 canonical 入口
- Ahmed 源码在 `src/ahmed/`，产物输出到 `public/ahmed/`，该入口是 shared `AhmedPanel` 的 standalone shell
- Ethan 源码在 `src/ethan/`，产物输出到 `public/ethan/`，该入口是 shared hero-estimator 的 standalone shell
- Monitor 源码在 `src/monitor/`，产物输出到 `public/monitor/`
- Price 源码在 `src/price/`，产物输出到 `public/price/`
- Inject 源码在 `src/inject/`，产物输出到 `public/inject/`
- 全页面构建命令是 `npm run build:pages`

### 服务端与运行时

- Express 入口在 `server.js`
- 运行时路径 helper 在 `runtime-paths.js`
- Electron 主进程在 `electron/main.js`
- preload bridge 在 `electron/preload.js`
- `/data/collectibles.json` 实际从运行时根目录 `collectibles.json` 提供
- 浏览器页面读取藏品基础数据时走 `/data/collectibles.json`
- `public/data/collectibles.json` 主要给测试和仓库内 fixture 直接读取
- `public/data/quality-size-average-prices.json` 通过 `/data/quality-size-average-prices.json` 提供给 Ahmed panel、Elsa/Ethan hero-estimator surfaces 与相关测试

### 业务模块

- Solver 公共逻辑在 `lib/solver.js`、`lib/solver-inputs.js`
- 实时监控在 `lib/bidking-live-monitor.js` 及相关 store/facts 模块
- 抓包驱动检测和安装/卸载在 `lib/capture-driver.js`
- 价格历史和交易所分析在 `lib/bidking-market-price-store.js`、`lib/bidking-price-history-store.js`、`lib/bidking-market-ladder-store.js`、
- 桌面自动化能力集中在 `electron/services/inject-service.js`
- Ahmed controller 逻辑位于 `public/ahmed/ahmed.js`，并通过可挂载/可卸载 contract 由 `src/ahmed/AhmedPanel.vue` 在 standalone 与 embedded 模式复用；可测试 helper 在 `public/ahmed/ahmed-core.js`
- Ethan 纯估算逻辑在 `src/ethan/estimator.js`；共享 monitor 适配在 `src/hero-estimator/monitor-profile-adapter.js`，网格推理在 `src/ethan/monitor-grid.js`

### 测试与验证

- 单元测试入口为 `npm test`
- 覆盖率命令为 `npm run test:coverage`
- 本地总验证命令为 `npm run verify`
- `git diff --check` 是每轮收尾必须跑的格式/空白 sanity check
- 涉及真实藏品数据的测试，优先读取 `public/data/collectibles.json`

## 变更边界

- 改某个页面，不顺手改所有页面
- 改某条 API，不顺手改所有 store
- 改 current-state 文档，不顺手重写 dated `docs/superpowers/*` 历史归档
- 改 tracked 生成产物前，先确认不是用户正在进行中的无关改动

## 记录要求

- 当前状态变化写入 `docs/Documentation.md`
- 结构变化写入 `docs/ARCHITECTURE.md`
- 目标/边界变化写入 `docs/Prompt.md`
- 工作方式或里程碑变化写入 `docs/Plan.md` / `docs/Implement.md`
- 如果只是推断，必须明确写成“推断”而不是“事实”
