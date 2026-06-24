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
3. 使用 `listingDefaultPricePercent` 计算默认上架单价
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
  - `selectedDisplayItem` / `collectiblesByCid`
  - `listingDefaultPricePercent`
  - `refreshWarehouseItems`
  - `window.bidkingDesktop.runAutoOperationCommand`

### 5.2 Agent 模块边界

agent 新增命令：`RefreshExchangeSellSlots`

职责仅限于：

- 识别当前是否在交易所
- 必要时收敛回主界面
- 进入交易所
- 执行买入页 / 出售页切换
- 最终确认出售页 toggle 已处于激活状态

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
- `completed`：仓库可见藏品已空
- `failed`：控制器级异常

同时维护以下运行态字段：

- `currentItemCid`
- `currentItemName`
- `successCount`
- `skippedCount`
- `lastError`
- `stopRequested`
- `startedAt`

## 7. 数据流与执行流程

### 7.1 启动流程

1. 用户点击“开始自动售卖”
2. 控制器重置统计与错误状态
3. 若仓库列表尚未准备好，先执行一次 `refreshWarehouseItems`
4. 进入外层循环

### 7.2 外层循环

外层循环每次都基于最新仓库可见列表重新取下一件藏品，而不是基于启动时快照。

原因：

- `refreshWarehouseItems` 后仓库列表可能变化
- 当前页面已有 `warehouseSelectedIndex`、排序和过滤同步逻辑
- 基于实时列表更符合“直到仓库 tab 下藏品为空为止”的需求

当可见仓库列表为空时：

- 状态切换为 `completed`
- 记录结束原因“仓库已空”

### 7.3 单件处理流程

1. 读取当前件 `itemCid` 与拥有数量
2. 调用 `GetItemTradeInfo`
3. 计算默认上架价
4. 若上架价低于基础价：
   - `skippedCount + 1`
   - 记录错误或原因文本
   - 继续下一件
5. 调用 `ExchangeItem`
6. 根据结果进入成功链、可恢复错误链或跳过链

### 7.4 成功链

1. `ExchangeItem` 成功
2. `successCount + 1`
3. 调用 `refreshWarehouseItems`
4. 等待 1.5 秒
5. 进入下一件

### 7.5 可恢复错误链

仅当错误消息精确等于 `ExchangeItem returned false` 时触发：

1. 状态置为 `retry_wait`
2. 等待 10 秒
3. 若期间收到停止请求，立即退出
4. 状态置为 `refreshing_exchange`
5. 调用 `RefreshExchangeSellSlots`
6. 若刷新成功，重新尝试当前件
7. 若刷新失败，将其视为当前件不可恢复错误并跳过

这里的“重试当前件”必须是单件内层循环，而不是回到外层仓库循环重新取件。

### 7.6 不可恢复错误链

当出现以下情况时直接跳过当前件：

- `GetItemTradeInfo` 失败
- `minPrice` 无效
- 默认价格计算失败
- 上架价低于基础价
- `ExchangeItem` 返回除 `ExchangeItem returned false` 以外的错误
- `RefreshExchangeSellSlots` 失败

处理方式：

1. 记录 `lastError`
2. `skippedCount + 1`
3. 调用 `refreshWarehouseItems`
4. 继续下一件

## 8. 停止语义

### 8.1 立即停止定义

用户选择的是立即停止语义：

- 若正处于 10 秒等待中，停止应立刻生效
- 若正处于 1.5 秒成功间隔等待中，停止也应立刻生效

### 8.2 不可中断调用的处理

以下调用本质上不可由前端强制中断：

- `GetItemTradeInfo`
- `ExchangeItem`
- `RefreshExchangeSellSlots`
- `refreshWarehouseItems` 内部 bridge 调用

因此实现约束为：

- 收到停止请求后立刻设置 `stopRequested = true`
- 所有可取消等待立刻退出
- 对正在进行的原生命令，等待 Promise 返回后立即终止后续流程

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
- 前端收到失败后，将当前件计为跳过，而不是终止整个任务

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

### 9.6 等待策略

该命令不得依赖长时间固定 `Sleep` 作为完成依据。

允许的做法：

- 以短轮询间隔检测 `DetectScreenState()`
- 检测 `TradingPanel/Toggles/Toggle (1)` 与 `Toggle (2)` 的 `isOn` 状态
- 在有限超时内等待目标状态成立

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

- 当前状态：运行中 / 等待重试 / 刷新交易所 / 已停止 / 已完成 / 失败
- 当前藏品：名称 + `itemCid`
- 计数：成功数、跳过数
- 最近错误：只展示最后一条

### 10.3 交互约束

自动售卖运行中：

- 禁用“开始自动售卖”
- 显示“停止自动售卖”
- 禁用单件“快速上架”
- 禁用“刷新仓库”

自动售卖运行中切换 tab：

- 不自动停止任务
- 只要 `Price` 页面实例仍在，流程继续

## 11. 测试设计

### 11.1 前端测试

在 `src/price/App.test.js` 增补以下覆盖：

- 能启动自动售卖并在仓库空时自动结束
- 成功路径会在两次上架之间等待 1.5 秒
- 低于基础价时跳过当前件且不调用 `ExchangeItem`
- `ExchangeItem returned false` 会等待 10 秒、调用 `RefreshExchangeSellSlots`，然后重试当前件
- 非 `ExchangeItem returned false` 错误会跳过当前件
- 等待期间点击停止会立即终止流程
- 运行中按钮禁用状态正确
- 运行中状态文本和计数反馈正确

测试数据要求：

- 继续使用 `public/data/collectibles.json` 对齐的真实藏品数据形态
- 仅在纯异常路径需要时使用最小 fixture

### 11.2 Agent 测试

为新增命令补充单元或语义测试，覆盖：

- 已在 `exchange` 时的买入页 -> 出售页刷新路径
- 不在 `exchange` 时的回主界面 -> 进交易所 -> 出售页路径
- 节点不存在或状态不满足时的失败返回
- 超时返回明确错误，而不是无限等待

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
- 遇到其他错误时会跳过该件并继续。
- 仓库为空时自动结束。
- 手动停止在等待阶段立即生效，在不可中断命令阶段以最短尾延迟停止。
- 前端与 agent 对关键行为均有自动化测试覆盖。

## 14. 实施边界

本设计对应一个实现计划即可覆盖的范围：

- 前端新增自动售卖控制器
- `Price` 页接入按钮与状态展示
- agent 新增 `RefreshExchangeSellSlots`
- 前端与 agent 测试补齐

不包含额外重构、参数配置面板或持久化任务系统。
