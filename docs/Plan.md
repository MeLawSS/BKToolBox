# BKToolBox Plan

## 当前阶段

阶段 2：BKToolBox 已从早期的组合计算页扩展为一个包含 7 个前端入口 bundle、Express API、Electron 桌面层、实时抓包监控、价格历史分析和注入式自动化的混合应用。当前重点不是继续堆页面数量，而是保持 `Home / Tools / Monitor / Price / Inject` 五个 canonical 工作面稳定，并让 `Elsa / Ethan / Ahmed` 统一从 `Tools` 进入：

- 保持 current-state 文档与真实代码同步
- 稳定多页面构建链路和服务端路由
- 稳定求解、监控、价格、注入四条主要业务链路
- 保持验证链路可持续运行，不靠口头记忆维护项目事实

## 里程碑

### M1: Current-State 文档同步

目标：

- 让 `docs/Prompt.md`、`docs/Plan.md`、`docs/Implement.md`、`docs/Documentation.md`、`docs/ARCHITECTURE.md` 与真实仓库状态一致
- 明确哪些文档是 current-state，哪些是带日期的历史归档

验收：

- 文档覆盖 5 个 canonical 工作面、`Tools` 内 `Elsa / Ethan / Ahmed` hero tabs，以及 `ahmed / ethan` 兼容 shell 与重定向
- 文档覆盖当前服务端页面路由、API 路由、Electron preload 能力和抓包后端
- 不再把过期阶段描述写成当前事实

验证命令：

- `$docs = 'docs/Prompt.md','docs/Plan.md','docs/Implement.md','docs/Documentation.md','docs/ARCHITECTURE.md'; foreach ($doc in $docs) { "### $doc"; Get-Content $doc -TotalCount 260 }`
- `rg -n "Monitor|Price|Inject|/api/|dumpcap|pktmon|/run" docs`

停止并修复：

- 文档与代码、脚本、命令输出冲突
- current-state 文档和历史归档文档的职责边界混乱

### M2: 多页面构建与路由稳定

目标：

- 保持 7 个前端入口 bundle 的构建链路和服务端路由稳定
- 保持旧入口和大小写兼容重定向可用

验收：

- `server.js` 提供 canonical 页面路由 `/`、`/Tools`、`/Monitor`、`/Price`、`/Inject`
- `server.js` 兼容 `/Elsa -> /Tools`、`/Ahmed -> /Tools?tab=ahmed`、`/Ethan -> /Tools?tab=ethan`，以及其余 lowercase 到 canonical 的重定向
- Vite 构建入口覆盖 `src/home`、`src/elsa`、`src/ahmed`、`src/ethan`、`src/monitor`、`src/price`、`src/inject`
- 页面变更后，`npm run build:pages` 可在安全条件下通过

验证命令：

- `npm run build:pages`
- `Invoke-WebRequest -Method Head -Uri http://127.0.0.1:3000/Tools`
- `Invoke-WebRequest -Method Head -Uri http://127.0.0.1:3000/Ahmed`
- `Invoke-WebRequest -Method Head -Uri http://127.0.0.1:3000/Ethan`
- `Invoke-WebRequest -Method Head -Uri http://127.0.0.1:3000/Monitor`
- `Invoke-WebRequest -Method Head -Uri http://127.0.0.1:3000/Price`
- `Invoke-WebRequest -Method Head -Uri http://127.0.0.1:3000/Inject`

停止并修复：

- 页面资源丢失
- 路由重定向回归
- 构建命令会覆盖无关脏改动且本轮未明确需要重建

### M3: Solver 与 Tools 链路稳定

目标：

- 保持 `/run` -> `solve-*.js` -> `lib/solver*.js` -> Tools 表格输出链路稳定
- 保持求解脚本白名单、SSE 输出格式和前端状态展示一致

验收：

- `solve-gold-combo.js`、`solve-gold-total.js`、`solve-gold-grid.js`、`solve-purple-grid.js`、`solve-red-grid.js`、`solve-type-combo.js`、`solve-average-price-combo.js`、`solve-purple-combo.js`、`solve-purple-total.js` 均在文档中被正确记录
- Tools 的 `3` 个 hero tabs、`9` 个 solver tabs、表格排序、筛选和状态条行为在文档中描述准确

验证命令：

- `npm test`
- 需要时通过 PowerShell 先设置环境变量，再做 targeted smoke，例如：`$env:LIMIT='200'; node .\solve-gold-combo.js ...; Remove-Item Env:LIMIT`

停止并修复：

- `/run` 白名单和文档不一致
- Tools 模式数量、字段或输出行为与文档不一致

### M4: Ahmed 与 Ethan 计算链路稳定

目标：

- 保持 Ahmed 的 shared panel + mountable controller contract 在 standalone shell 与 `Tools` embedded mode 下都稳定
- 保持 Ethan 的 thin wrapper、共享 hero-estimator、监控适配器和价格预测链路稳定

验收：

- Ahmed 文档保留 DOM hook 约束、`src/ahmed/AhmedPanel.vue` 共享面板，以及 `public/ahmed/ahmed.js` / `public/ahmed/ahmed-core.js` 的分工
- Ethan 文档覆盖 standalone shell、`Tools` 内 hero tab、estimator、monitor adapter、monitor grid、price-only search 和 placeholder/fallback 逻辑

验证命令：

- `npm test`
- `npx vitest run src/ahmed/App.test.js public/ahmed/ahmed-controller.test.mjs`
- `npx vitest run src/ethan/App.test.js src/ethan/estimator.test.js src/ethan/monitor-grid.test.js`

停止并修复：

- Ahmed DOM contract 被破坏
- Ethan 估算或监控派生值行为回归

### M5: Monitor / Inject 业务链路稳定

目标：

- 保持实时抓包监控、价格历史分析和桌面自动化页面与后端接口一致
- 保持 `dumpcap` 实时抓包链路和 Npcap 安装/卸载状态检测可解释

验收：

- 文档覆盖 `lib/bidking-live-monitor.js`、`lib/capture-driver.js`、`electron/services/inject-service.js`
- 文档覆盖 `/api/bidking-monitor/*`、`/api/price-history/*`、`/api/market-prices/*`、`/api/capture-driver/*`、
- 文档说明桌面 monitor 默认只走 `dumpcap` 抓包链路，`tools/WiresharkPortable64/` 是唯一的本地抓包源目录

验证命令：

- `npm test`
- `npx vitest run lib/bidking-live-monitor.test.mjs lib/capture-driver.test.mjs electron/services/inject-service.test.mjs src/monitor/App.test.js src/inject/App.test.js server.test.mjs`

停止并修复：

- 抓包后端行为与文档不一致
- Inject 页面依赖的桌面接口或 API 描述错误

### M6: 持续验证与提交纪律

目标：

- 每轮改动都留下 fresh verification evidence 和独立 commit

验收：

- 本轮相关命令已重新执行
- `git diff --check` 通过
- commit 只包含本轮需要的文件

验证命令：

- `git diff --check`
- 根据改动范围选择 `npm test`、`npm run test:coverage`、`npm run build:pages`

停止并修复：

- 在没有 fresh evidence 的情况下声称完成
- commit 混入无关文件

## 决策记录

- `docs/Prompt.md`、`docs/Plan.md`、`docs/Implement.md`、`docs/Documentation.md`、`docs/ARCHITECTURE.md` 是 current-state 文档，必须跟真实代码同步
- `docs/superpowers/plans/*.md` 和 `docs/superpowers/specs/*.md` 是按日期归档的历史计划/设计记录，不承担 current-state 职责
- 页面构建产物可能存在用户未提交改动；验证应选择最小破坏面的命令，避免为 docs-only 轮次无意义覆盖产物
- 页面、路由、API、运行时路径、抓包后端、脚本参数和验证命令变化时，需要同轮更新文档
