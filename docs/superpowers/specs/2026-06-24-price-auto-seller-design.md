# Price 仓库 Tab 自动售卖设计

- 日期：2026-06-24
- 状态：已确认设计，待用户 review
- 关联页面：`src/price/App.vue`
- 关联 agent：`tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`、`tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`

## 1. 背景

`Price` 页面仓库 tab 已具备以下能力：

- 通过 `GetStockContainers` 刷新主仓库藏品列表
- 通过 `GetItemTradeInfo` 查询当前最低价
- 按页面现有默认百分比规则计算上架价
- 通过 `ExchangeItem` 对当前选中藏品执行单次快速上架

当前缺口是缺少一个可持续运行、可手动停止的批量自动售卖流程，用于循环快速上架仓库 tab 下的藏品，并在交易所上架位卡死时自动执行恢复动作。

## 2. 目标与非目标

### 2.1 目标

- 在 `Price` 页面仓库 tab 提供“开始自动售卖 / 停止自动售卖”能力。
- 自动售卖循环处理当前仓库 tab 可见藏品，直到列表为空为止。
- 每次成功上架后等待 1.5 秒，再处理下一件。
- 当 `ExchangeItem` 返回 `ExchangeItem returned false` 时：
  - 等待 10 秒
  - 执行交易所上架位刷新
  - 重试当前藏品
  - 若仍为相同错误，则继续相同重试链，直到成功或手动停止
- 当某件藏品返回其他错误时，直接跳过并继续下一件。
- 复用当前单件快速上架的定价规则。
- 手动停止在等待阶段立即生效，在不可中断命令阶段以最短尾延迟停止。

### 2.2 非目标

- 不把整个自动售卖流程迁移到 agent DLL。
- 不修改现有单件“快速上架”主流程的用户交互语义。
- 不在本次设计中引入新的后台任务持久化、任务恢复或跨页面继续执行能力。
- 不扩展为多仓库、分组价格策略或用户自定义重试参数。

## 3. 需求归纳

### 3.1 用户可见行为

- 用户在仓库 tab 启动自动售卖后，流程会持续处理当前页面可见仓库藏品。
- 自动售卖运行中可随时点击停止。
- 若仓库刷新后已无可见藏品，任务自动结束并显示完成状态。
- 页面应显示当前阶段、当前处理藏品、累计成功数、累计跳过数和最近一次错误。

### 3.2 定价规则

自动售卖必须与 `quickListSelectedItem` 保持一致：

1. 调用 `GetItemTradeInfo`
2. 读取 `minPrice`
3. 使用 `listingDefaultPricePercent` 计算默认上架单价，计算公式与 `quickListSelectedItem` 当前通过 `computeDefaultUnitPrice(...)` 使用的实现保持一致
4. 若计算后的上架价低于藏品基础价，则跳过该藏品

### 3.3 错误策略

- `ExchangeItem returned false`：视为可恢复错误，执行等待 + 刷新交易所出售页 + 重试当前件。
- 其他错误：视为不可恢复的单件错误，记录并跳过当前件。
- 控制器级异常：只在流程自身状态损坏时进入 `failed`；单件错误不能使整任务崩溃。

## 4. 推荐方案

采用“前端控制器编排 + agent 新增窄命令”的方案。

### 4.1 方案摘要

- `Price` 页前端负责循环、状态管理、立即停止、跳过策略和页面反馈。
- agent DLL 只负责一个新的 UI 恢复命令：`RefreshExchangeSellSlots`。
- 定价逻辑继续留在 `Price` 页，避免在 DLL 里重复实现价格规则和业务约束。

### 4.2 选择理由

- 与现有 `src/price/App.vue` 的单件快速上架路径高度一致，复用率高。
- 可最小化 DLL 变更面，降低 UI 路径和业务规则分散。
- 更容易实现用户可见进度、即时停止和页面测试。

## 5. 架构设计

### 5.1 前端模块边界

在 `Price` 页新增一个独立控制器模块，例如 `useWarehouseAutoSeller`。

`App.vue` 继续负责：

- 页面主数据源
- 仓库列表展示
- 现有刷新与选择逻辑
- 单件快速上架入口

`useWarehouseAutoSeller` 负责：

- 自动售卖状态机
- 循环调度
- 停止控制
- 错误统计与状态文本
- 调用现有依赖：
  - `warehouseItems`
  - `collectiblesByCid`
  - `buildDisplayItem(itemCid)` 或等价的“按 CID 取展示快照”函数
  - `listingDefaultPricePercent`
  - 一个 promise 化、带结果的仓库刷新 helper，例如 `refreshWarehouseSnapshot()`；它不能沿用当前 `refreshWarehouseItems()` 这种“失败只写入 `warehouseError` 且不显式返回成功/失败”的 contract
  - `window.bidkingDesktop.runAutoOperationCommand`

控制器不得依赖 `selectedDisplayItem` 这种绑定用户当前选中项的状态来读取自动售卖目标的名称、基础价或最低价展示信息。所有当前件信息都必须通过 `currentItemCid` 重新按 CID 解析，避免用户手动改选中项或刷新导致读取错对象。

### 5.2 Agent 模块边界

agent 新增命令：`RefreshExchangeSellSlots`

职责仅限于：

- 识别当前是否在交易所
- 必要时收敛回主界面
- 进入交易所
- 执行买入页 / 出售页切换
- 最终确认出售页 toggle 已处于激活状态

Electron bridge 还需要配套调整：

- `electron/services/inject-service.js` 的 auto-operation timeout 映射必须为 `RefreshExchangeSellSlots` 提供大于 agent 内部 15 秒预算的 transport timeout
- 建议采用“15 秒内部预算 + 显式 buffer”的方式，默认映射为 20 秒；至少要保留不小于 5 秒的 transport 余量，避免 IPC 调度与收发帧抖动把命令卡死在边界
- 不能让该命令落回当前 5 秒默认超时，否则 15 秒命令预算无法兑现

agent 不负责：

- 遍历仓库藏品
- 计算价格
- 判断是否低于基础价
- 管理自动售卖长任务生命周期

## 6. 前端状态机

定义以下状态：

- `idle`：未运行
- `running`：正在处理藏品
- `retry_wait`：等待 10 秒后重试当前件
- `refreshing_exchange`：正在执行 `RefreshExchangeSellSlots`
- `stopping`：已收到停止请求，等待当前不可中断调用返回
- `stopped`：任务已被用户停止
- `completed`：仓库可见藏品已空
- `failed`：控制器级异常

同时维护以下运行态字段：

- `currentItemCid`
- `currentItemName`
- `successCount`
- `skippedCount`
- `hasLoadedWarehouseOnce`
- `terminalSkipCids`
- `lastError`
- `stopRequested`
- `startedAt`

状态与控制 flag 的关系：

- `stopRequested` 是内部控制 flag，用于阻止当前调用返回后继续后续步骤。
- `stopping` 是用户可见状态，只在停止请求发生于不可中断调用期间时进入。
- 若停止请求发生于可取消等待阶段，则不进入 `stopping`，而是直接转入 `stopped`。
- 若停止请求发生于不可中断调用阶段，则流程为：设置 `stopRequested = true` -> 状态切到 `stopping` -> 当前调用返回后转为 `stopped`。
- `terminalSkipCids` 是当前自动售卖 run 内的“终态跳过集合”。凡是进入不可恢复错误链的 CID，都会加入该集合；同一次 run 的后续迭代必须排除这些 CID，避免在刷新后反复命中同一永久跳过项。

## 7. 数据流与执行流程

### 7.1 启动流程

1. 用户点击“开始自动售卖”
2. 控制器重置统计与错误状态，并清空 `terminalSkipCids`
3. 若当前已有单件快速上架进行中，或手动上架弹窗已打开，则阻止启动并提示当前存在进行中的仓库操作
4. 调用 promise 化的 `refreshWarehouseSnapshot()`：
   - 若已有仓库刷新进行中，必须复用该 in-flight promise，而不是并发再发起一次刷新
   - 该 helper 必须返回结构化结果，例如 `{ ok, rows, error }`
5. 若 `hasLoadedWarehouseOnce` 为 `false`，则必须至少完成一次成功的仓库快照加载；该 flag 或等价状态用于区分“仓库尚未加载”与“仓库已加载但当前为空”
6. 若仓库刷新结果为失败，则任务进入 `failed`，不得把失败当成空仓
7. 若首次成功准备完成后，可处理候选列表为空，则结束为 `completed`
8. 进入外层循环

### 7.2 外层循环

外层循环每次都基于最新仓库可见列表重新取下一件藏品，而不是基于启动时快照。

原因：

- 成功刷新仓库快照后，仓库列表可能变化
- 当前页面已有 `warehouseSelectedIndex`、排序和过滤同步逻辑
- 基于实时列表更符合“直到仓库 tab 下藏品为空为止”的需求

候选列表定义：

- 候选列表 = 当前仓库 tab 可见藏品列表 - `terminalSkipCids`
- 同一次 run 中，任何已进入不可恢复错误链的 CID 都不得再次成为候选项

当候选列表为空时：

- 状态切换为 `completed`
- 记录结束原因“仓库已空或本次 run 的可见项均已被终态跳过”

### 7.3 单件处理流程

1. 读取当前件 `itemCid` 与拥有数量；拥有数量作为本次 `ExchangeItem` 的 `count` 参数，保持与 `quickListSelectedItem` 当前“按该藏品现有拥有数量一次性上架”的语义一致
2. 通过 `currentItemCid` 按 CID 解析当前件的展示快照与基础价，不得依赖 `selectedDisplayItem`
3. 调用 `GetItemTradeInfo`
4. 计算默认上架价
5. 若上架价低于基础价：
   - `skippedCount + 1`
   - 将当前 `itemCid` 加入 `terminalSkipCids`
   - 记录错误或原因文本
   - 继续下一件
6. 调用 `ExchangeItem`
7. 根据结果进入成功链、可恢复错误链或跳过链

### 7.4 成功链

1. `ExchangeItem` 成功。该成功既包括首次尝试成功，也包括经过 `RefreshExchangeSellSlots` 后的重试成功
2. `successCount + 1`
3. 调用 `refreshWarehouseSnapshot()`
4. 若刷新失败，则任务进入 `failed`
5. 等待 1.5 秒
6. 进入下一件

### 7.5 可恢复错误链

仅当错误消息精确等于 `ExchangeItem returned false` 时触发：

1. 状态置为 `retry_wait`
2. 等待 10 秒
3. 若期间收到停止请求，立即退出
4. 状态置为 `refreshing_exchange`
5. 调用 `RefreshExchangeSellSlots`
6. 若刷新成功，重新尝试当前件；该重试若成功，必须回归 §7.4 的完整成功链，即执行 `successCount + 1` -> `refreshWarehouseSnapshot()` -> 等待 1.5 秒 -> 再进入下一件
7. 若刷新失败，任务进入 `failed`；`RefreshExchangeSellSlots` 负责的是全局交易所恢复，不是 CID 级恢复，失败意味着运行环境异常且需要用户介入，而不是当前件不可恢复

这里的“重试当前件”必须是单件内层循环，而不是回到外层仓库循环重新取件。

### 7.6 不可恢复错误链

当出现以下情况时直接跳过当前件：

- `GetItemTradeInfo` 失败
- `minPrice` 无效
- 默认价格计算失败
- 上架价低于基础价
- `ExchangeItem` 返回除 `ExchangeItem returned false` 以外的错误

处理方式：

1. 记录 `lastError`
2. `skippedCount + 1`
3. 将当前 `itemCid` 加入 `terminalSkipCids`
4. 调用 `refreshWarehouseSnapshot()`
5. 若刷新失败，则任务进入 `failed`
6. 否则继续下一件

终态跳过语义：

- “跳过当前件”在本设计里不是“本轮跳过、下轮可能再试”，而是“对当前 run 永久跳过该 CID”
- 用户若希望重新尝试这些被跳过的 CID，需要手动重新启动一次新的自动售卖 run；新 run 会清空 `terminalSkipCids`

## 8. 停止语义

### 8.1 立即停止定义

用户选择的是立即停止语义：

- 若正处于 10 秒等待中，停止应立刻生效
- 若正处于 1.5 秒成功间隔等待中，停止也应立刻生效
- 若正处于可取消等待中，停止后状态直接转为 `stopped`

### 8.2 不可中断调用的处理

以下调用本质上不可由前端强制中断：

- `GetItemTradeInfo`
- `ExchangeItem`
- `RefreshExchangeSellSlots`
- `refreshWarehouseSnapshot()` 内部 bridge 调用

因此实现约束为：

- 收到停止请求后立刻设置 `stopRequested = true`
- 所有可取消等待立刻退出
- 对正在进行的原生命令，状态切为 `stopping`，等待 Promise 返回后立即终止后续流程并转为 `stopped`

这意味着“立即停止”的技术定义是：

- 等待阶段真正立即中断
- 原生命令阶段以最短尾延迟停止

## 9. `RefreshExchangeSellSlots` 命令设计

### 9.1 命令名称

- `RefreshExchangeSellSlots`

### 9.2 输入

- 无参数

### 9.3 成功返回建议

返回 JSON，至少包含：

- `screenBefore`
- `screenAfter`
- `enteredExchange`
- `toggledBuyThenSell`
- `sellTabReady`

### 9.4 失败返回

- 返回明确错误文本
- 前端收到失败后，当前自动售卖 run 进入 `failed`，而不是把当前件计为跳过
- 若当前屏幕无法识别、无法在限定时间内收敛到 `main_lobby`、或无法在限定时间内确认出售页 ready，都属于运行环境失败返回

### 9.5 Agent 内部逻辑

#### 情况 A：当前不在交易所

1. 检测当前屏幕
2. 若不在 `exchange`，通过现有关闭逻辑逐步收敛到 `main_lobby`
3. 从 `main_lobby` 进入交易所
4. 切到出售页
5. 确认出售页 toggle 为激活状态

#### 情况 B：当前已在交易所

1. 点击购买页 toggle
2. 点击出售页 toggle
3. 确认出售页 toggle 为激活状态

#### 情况 C：未知屏幕或收敛失败

- 若 `DetectScreenState()` 返回未知状态，或当前界面在限定超时内无法通过关闭逻辑收敛到 `main_lobby`，命令直接失败返回
- 若进入交易所后在限定超时内仍无法确认出售页 toggle 激活，命令直接失败返回
- 返回值需带明确错误文本，前端收到后将整个自动售卖 run 置为 `failed`

### 9.6 等待策略

该命令不得依赖长时间固定 `Sleep` 作为完成依据。

允许的做法：

- 以短轮询间隔检测 `DetectScreenState()`
- 检测 `TradingPanel/Toggles/Toggle (1)` 与 `Toggle (2)` 的 `isOn` 状态
- 在有限超时内等待目标状态成立

具体约束：

- 命令整体超时上限为 15 秒，与当前 `ExchangeItem` 默认超时量级保持一致
- Electron transport timeout 默认映射为 20 秒，即 15 秒命令预算 + 5 秒 buffer
- 建议轮询间隔为 200ms 到 250ms，作为状态探测间隔而非业务完成依据

不允许的做法：

- 点击后直接固定等待若干秒并假定切页成功

## 10. UI 设计

### 10.1 控件位置

在仓库 tab 头部现有“刷新仓库”按钮附近新增自动售卖入口：

- `开始自动售卖`
- 运行中切换为 `停止自动售卖`

保留现有单件“快速上架”按钮，不改变其在详情区的职责。

### 10.2 运行中反馈

页面展示以下信息：

- 当前状态：运行中 / 等待重试 / 刷新交易所 / 正在停止 / 已停止 / 已完成 / 失败
- 当前藏品：名称 + `itemCid`
- 计数：成功数、跳过数
- 最近错误：只展示最后一条

### 10.3 交互约束

自动售卖运行中：

- 禁用“开始自动售卖”
- 显示“停止自动售卖”
- 禁用单件“快速上架”
- 禁用手动上架弹窗入口
- 禁用“刷新仓库”

自动售卖启动时：

- 若手动上架弹窗已打开，则不自动接管该弹窗，也不允许并发启动自动售卖
- 用户必须先关闭手动上架弹窗，再启动自动售卖

自动售卖启动前：

- 若单件“快速上架”仍在进行中，则开始自动售卖按钮保持禁用
- 若通过非 UI 方式触发启动，控制器应拒绝启动并返回“已有仓库操作进行中”之类的明确信息

自动售卖运行中切换 tab：

- 不自动停止任务
- 只要 `Price` 页面实例仍在，流程继续
- 本次设计不在其他 tab 或全局顶栏额外渲染停止按钮与进度条
- 用户若在其他 tab 期间需要查看状态或点击停止，应切回仓库 tab

## 11. 测试设计

### 11.1 前端测试

在 `src/price/App.test.js` 增补以下覆盖：

- 能启动自动售卖并在仓库空时自动结束
- 当最后剩余的可见项全部因为不可恢复原因被加入 `terminalSkipCids` 时，任务会结束为 `completed`，而不是反复命中同一 CID
- 成功路径会在两次上架之间等待 1.5 秒
- 低于基础价时跳过当前件且不调用 `ExchangeItem`
- `ExchangeItem returned false` 会等待 10 秒、调用 `RefreshExchangeSellSlots`，然后重试当前件
- `ExchangeItem returned false` 在一次刷新后若再次返回同样错误，会再次进入等待 + 刷新 + 重试链，直到成功或手动停止，而不是跳出当前件循环
- 非 `ExchangeItem returned false` 错误会跳过当前件
- 手动上架弹窗打开时不能启动自动售卖
- 等待期间点击停止会立即终止流程
- 单件“快速上架”进行中时不能启动自动售卖
- 运行中按钮禁用状态正确
- 运行中状态文本和计数反馈正确
- 仓库刷新失败不会被误判为空仓完成，而会进入失败态或明确错误态
- `RefreshExchangeSellSlots` 因未知屏幕、无法收敛或无法确认出售页而失败时，任务进入 `failed`，而不是把剩余可见 CID 逐个耗尽到 `terminalSkipCids`

测试数据要求：

- 继续使用 `public/data/collectibles.json` 对齐的真实藏品数据形态
- 仅在纯异常路径需要时使用最小 fixture

### 11.2 Agent 测试

为新增命令补充单元或语义测试，覆盖：

- 已在 `exchange` 时的买入页 -> 出售页刷新路径
- 不在 `exchange` 时的回主界面 -> 进交易所 -> 出售页路径
- 当前为未知屏幕或无法收敛回 `main_lobby` 时的失败返回
- 节点不存在或状态不满足时的失败返回
- 超时返回明确错误，而不是无限等待
- 15 秒整体超时约束的行为验证

为 Electron bridge 补充测试，覆盖：

- `RefreshExchangeSellSlots` 不会落回 5 秒默认 auto-operation timeout
- transport timeout 配置满足“15 秒命令预算 + 5 秒 buffer”的 20 秒默认映射

## 12. 风险与约束

- `src/price/App.vue` 已较大，自动售卖控制器必须拆出，避免继续膨胀主文件。
- 当前主仓库存在未提交的 agent 相关变更，实施时必须继续在独立 worktree 中进行，避免污染主工作区。
- 交易所 toggle 路径依赖 UI 结构，若游戏版本变更，`RefreshExchangeSellSlots` 可能需要同步更新。
- 前端无法真实取消 DLL 正在执行的调用，只能做最短尾延迟停止。

## 13. 验收标准

- 仓库 tab 可启动和停止自动售卖。
- 自动售卖沿用现有单件快速上架的定价规则。
- 成功上架后会刷新仓库并等待 1.5 秒再继续。
- 遇到 `ExchangeItem returned false` 时会等待 10 秒、刷新交易所出售页并重试当前件。
- 遇到 `ExchangeItem returned false` 时重试链可持续执行，直到成功或手动停止为止。
- 若交易所恢复命令因未知屏幕、收敛失败或出售页确认失败而失败，任务进入 `failed`，等待用户介入。
- 遇到其他错误时会将该 CID 作为本次 run 的终态跳过项，并继续处理其他候选项。
- 仓库为空，或本次 run 的剩余可见候选项均已被终态跳过时，自动结束。
- 手动停止在等待阶段立即生效，在不可中断命令阶段以最短尾延迟停止。
- 前端与 agent 对关键行为均有自动化测试覆盖。

## 14. 实施边界

本设计对应一个实现计划即可覆盖的范围：

- 前端新增自动售卖控制器
- `Price` 页接入按钮与状态展示
- agent 新增 `RefreshExchangeSellSlots`
- Electron timeout 映射补齐
- 前端与 agent / Electron 测试补齐

不包含额外重构、参数配置面板或持久化任务系统。
