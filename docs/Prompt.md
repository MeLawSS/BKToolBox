# BKToolBox Prompt

## 目标

维护一个可持续迭代的 BKToolBox 桌面/网页混合工具，当前核心目标是：

- 保持 `Home`、`Tools`、`Monitor`、`Price`、`Inject` 五个 canonical 工作面可用，并保持 `Elsa`、`Ethan`、`Ahmed` 通过 `Tools` hero tabs 可用
- 保持 Express 服务、Electron 桌面层和各页面之间的协作正常
- 保持 `/run` 求解脚本、价格历史接口、实时监控接口和自动化注入接口稳定
- 保持基于 `dumpcap` 的实时抓包链路、交易所价格历史链路和 AutoOperation 链路可回归验证
- 保持核心业务文档与真实代码、真实命令和真实路由一致
- 继续为核心纯逻辑、路由、Electron helper、监控链路和页面交互补齐 UT

## 非目标

- 不重写整个前端或桌面架构
- 不把 Ahmed 共享面板 / 挂载式控制器契约、Ethan 估算逻辑、Monitor 抓包链路和 Inject 自动化链路在同一轮里一起重写
- 不把 dated `docs/superpowers/plans/*.md`、`docs/superpowers/specs/*.md` 这类历史记录当作 current-state 文档强行改写
- 不为了“顺手整理”扩大 diff 范围
- 不回滚或覆盖与当前任务无关的用户改动
- 不把未验证的推断写成项目事实

## 硬性约束

- 每轮改动都遵循：`规划 -> 修改 -> 验证 -> 修失败 -> 更新文档 -> git commit`
- 每次只改当前任务需要的文件，保留清晰回退点
- 当前态文档必须基于真实代码、真实命令输出和真实仓库结构更新
- 页面、路由、API、运行时路径、脚本参数或验证命令变化时，同轮同步更新相关文档
- 涉及真实藏品数据的测试优先读取 `public/data/collectibles.json`
- 如果本轮会触碰会生成 tracked 页面产物的命令，要先确认不会覆盖无关脏改动；验证应优先选择最小破坏面
- 可单元测试的逻辑优先抽成纯函数或独立模块，用 `npm test` 证明行为

## 交付物

- `docs/Prompt.md`：当前目标、边界和约束
- `docs/Plan.md`：当前维护里程碑、停止条件和决策
- `docs/Implement.md`：执行规则、验证顺序和仓库约定
- `docs/Documentation.md`：current-state 事实、运行命令、运行时路径和已知限制
- `docs/ARCHITECTURE.md`：结构化架构说明，覆盖页面、服务、API 和桌面层
- `docs/BIDKING_GAME_LOG_REVERSE_ENGINEERING.md` / `docs/BIDKING_REALTIME_PROTOCOL_SCHEMA.md` / `docs/AUTO_OPERATION_COMMANDS.md`：需要时更新的专题技术文档

## Done when

- 当前态文档能准确反映 canonical 工作面、`Tools` hero tabs、兼容重定向、服务端 API、Electron preload 能力、求解脚本和实时监控链路
- 后续代理只看 `docs/Prompt.md`、`docs/Plan.md`、`docs/Implement.md`、`docs/Documentation.md`、`docs/ARCHITECTURE.md` 就能理解任务边界和真实系统结构
- 文档里不再残留“只有四个页面”“只有 `/run` 一个接口”“Monitor 只靠 pktmon 批处理”“实时监控仍会回退到 pktmon”这类过期描述
- 本轮相关验证命令已重新执行，并把结果如实记录到文档或交付说明中
