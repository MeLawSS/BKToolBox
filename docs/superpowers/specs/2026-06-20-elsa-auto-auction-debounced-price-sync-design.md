# Elsa Auto Auction Debounced Price Sync Design

> 日期: 2026-06-20 · 状态: implementation-ready spec

## Goal

把 Elsa 自动竞拍的“价格同步”和“开始出价时机”从当前的文件轮询 + `secs < 15` 门槛，改成：

- app 侧仍然立即写 `Documents/BidKing/Price`
- app 侧同时把价格通过 `SetExpectedPrice` 通知给 agent
- 这条通知加 4 秒防抖，不立即发送
- agent 在 `useExpectedPrice` 模式下不再等到剩余 15 秒，而是使用最近一次**已通知**的价格，在每轮满足条件时立即出价

本轮是对既有 Elsa AutoAuction 行为的增量设计，不重新设计整条竞拍脚本。

## Relationship To Existing Specs

本 spec 只覆盖“价格同步来源”和“首轮/各轮出价触发时机”。

它替换并收紧以下旧设计中的相关部分：

- `docs/superpowers/specs/2026-06-20-elsa-auto-auction-bidding-design.md`
  - app 侧 watcher 只写文件、不做 debounce 通知 的部分
  - native 侧 `StartPriceReaderThread()` / `StopPriceReaderThread()` 作为 AutoAuction 价格来源的部分
  - bid loop 中 `secs < 15` 才开始出价的部分

对手上一轮封顶逻辑、authcode 中断、结束页清理、循环运行等其他现有设计不在本轮改动范围内。

## Current Facts

### 1. app 侧当前只立即写文件，不推送价格命令

`src/elsa/useElsaAutoOperation.js` 当前对 `autoBidPrice` 做 `watch(..., { immediate: true })`，每次变化时只调用：

- `window.bidkingDesktop.writeDataFile('Price', String(price || 0))`

它不会同步调用 `SetExpectedPrice`，也没有 debounce。

### 2. agent 侧当前把文件内容和 SetExpectedPrice 写进同一个原子值

`tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp` 当前存在：

- `g_expectedPrice`
- `PriceReaderThreadProc()` 每 2 秒读取 `Documents/BidKing/Price`
- `CmdSetExpectedPrice()` 也直接覆盖 `g_expectedPrice`

因此如果 app 立即写文件，agent 很可能会在 debounce 通知之前就通过文件轮询看到新价格。

### 3. AutoAuction 当前仍以“剩余时间 < 15 秒”作为出价门槛

`CmdAutoAuction()` 当前 bid loop 的核心条件仍是：

- `round` 非空
- `round != lastBidRound`
- `secs < 15`

这意味着即使 price 已经算好，agent 也会默认拖到当前轮剩余 15 秒内才开始点击出价。

### 4. concurrent side-band command 已被现有行为证明可行

Elsa 自动竞拍运行期间，app 已经会在另一条命令通道上发送：

- `CancelAutoAuction`

这说明在 AutoAuction 长命令执行期间，再通过 `runAutoOperationCommand()` 发送额外小命令是当前 bridge 已支持的行为。`SetExpectedPrice` 可以沿用这条模式，不需要额外设计事件流。

## Non-Goals

- 不改 `SetExpectedPrice` 的命令名
- 不引入新的 preload API
- 不把 AutoAuction 改成 renderer 主导的逐步编排
- 不给每轮新增专门的“RoundStart”通知协议
- 不要求 app 在每一轮都必须重新发一次价格通知
- 不改变 `Documents/BidKing/Price` 的文件写入行为；它继续保留给现有工作流和人工观测使用

## Decision Summary

### 决策 1: `Price` 文件继续写，但不再作为 AutoAuction 的权威价格源

app 侧继续立即写 `Price` 文件，保持现有兼容性。

但是 native AutoAuction 在 `useExpectedPrice` 模式下，不再依赖文件轮询线程去决定何时和用什么价格出价。真正驱动 AutoAuction 的 expected price，改为只认 `SetExpectedPrice` 写入的那份内存状态。

### 决策 2: app 侧 expected price 同步改成 4 秒防抖

每次 `autoBidPrice` 变化时：

- 立即写 `Price` 文件
- 重置一个 4 秒 timer
- timer 到时后，如果 Elsa 自动竞拍仍启用，则发送 `SetExpectedPrice({ price })`

4 秒内如果价格再次变化，只保留最后一次发送。

### 决策 3: 本次 AutoAuction 在首次 debounced `SetExpectedPrice` 完成后才启动

为了避免新 session 一开场就误用上一个 session 残留在 agent 里的价格，本轮要求：

- `enable()` 后先跑首次 4 秒防抖 expected price 同步
- 只有首次 `SetExpectedPrice` 成功返回后，才真正发送 `AutoAuction`

后续运行期间的价格变化，仍然继续通过 side-band `SetExpectedPrice` 同步，不需要重启 `AutoAuction`。

### 决策 4: agent 去掉 `secs < 15` 门槛

在 `useExpectedPrice` 模式下，AutoAuction 不再把“当前轮剩余 15 秒”当作开拍条件。

改为：

- 只要当前在有效 round
- 当前 round 还没出价
- 本次会话已经在首次 `SetExpectedPrice` 成功后启动
- 当前能够按既有 expected-price 解析规则得到有效 `amount`

就允许立刻进入现有出价流程。

非 `useExpectedPrice` 的 legacy `bidAmount` 模式不在本轮改变（`secs < 15` 门槛），但两种模式均在第一轮受到 17000 硬下限约束。

### 决策 5: 同一轮仍然最多只出价一次

本轮不引入“同一轮收到更新价格后再次补拍”的行为。

一旦某轮已经完成一次出价并写入 `lastBidRound`，后续即使 app 再发送新的 `SetExpectedPrice`，也只影响后续轮次，不会触发当前轮二次点击。

这是为了保持当前 AutoAuction 的“每轮至多一次”契约，避免重复打开出价框和重复确认。

## Detailed Design

## Part 1: App Side

### 1.1 Keep immediate file write

`useElsaAutoOperation.js` 继续保留即时文件同步：

```js
window.bidkingDesktop.writeDataFile('Price', String(price || 0))
```

这个行为不做 debounce。

原因：

- 当前用户已经有依赖这个文件的观察/调试习惯
- 这条文件写入不再控制 AutoAuction 时机，因此不需要延迟

### 1.2 Add a debounced SetExpectedPrice notifier

在 `useElsaAutoOperation.js` 内新增一个本地 debounce 同步器：

- 维护 `pendingExpectedPriceTimer`
- 维护 `pendingExpectedPriceValue`

规则：

1. `autoBidPrice` 变化时，先立即写文件
2. 再把最新数值写进 `pendingExpectedPriceValue`
3. 清掉旧 timer
4. 新建一个 4000ms timer
5. timer 触发时，如果 `isEnabled.value === true`，则调用：

```js
await cmd('SetExpectedPrice', { price: latestPrice })
```

### 1.3 Initial sync on enable

当前 watcher 已经是 `{ immediate: true }`。

本轮保持这个特性，但它的语义改为：

- enable 后立刻执行一次“写文件 + 启动 4 秒防抖同步”
- `AutoAuction` 本体等待这次首次同步成功后再启动

也就是说：

- **不会**在 enable 的同一 tick 立刻发送 `SetExpectedPrice`
- **会**在 enable 后 4 秒，把当前稳定价格首次同步给 agent
- **会**在这次首次同步成功后，才调用 `AutoAuction`

推荐 app 侧抽象：

- `scheduleExpectedPriceSync(price, { isInitial })`
- `waitForInitialExpectedPriceSync(signal)`

其中首次同步既是价格同步，也是本次脚本启动屏障。

实现草图必须满足下面这个时序：

1. `enable()` 先把 `isEnabled.value = true`
2. `enable()` 创建本次 session 的 `AbortController`
3. `enable()` 创建本次 session 的 `initialExpectedPriceSync` Promise
4. 再注册 `watch(autoBidPrice, ..., { immediate: true })`
5. `immediate: true` 同步触发 watcher callback，启动首次 4 秒 timer
6. `enable()` 立即启动 `runScript(controller.signal)`，但**不在 `enable()` 自己内部 await 首次同步**
7. `runScript()` 顶部先 `await waitForInitialExpectedPriceSync(signal)`
8. 只有这个 Promise resolve 后，`runScript()` 才真正发送 `AutoAuction`

关键约束：

- `enable()` 启动 `runScript()` 后必须立即释放 `isBusy`
- 因此首次 4 秒等待期间，UI 的 stop / disable 仍然可用
- `disable()` 通过 abort `signal` 打断 `waitForInitialExpectedPriceSync(signal)`，从而阻止本次 `AutoAuction` 启动

推荐最小状态：

```js
let initialExpectedPriceSync = null;
let resolveInitialExpectedPriceSync = null;
let rejectInitialExpectedPriceSync = null;
let hasResolvedInitialExpectedPriceSync = false;
```

推荐流程：

```js
function createInitialExpectedPriceSyncPromise() {
  hasResolvedInitialExpectedPriceSync = false;
  initialExpectedPriceSync = new Promise((resolve, reject) => {
    resolveInitialExpectedPriceSync = resolve;
    rejectInitialExpectedPriceSync = reject;
  });
}

function settleInitialExpectedPriceSync(kind, value) {
  if (hasResolvedInitialExpectedPriceSync) return;
  hasResolvedInitialExpectedPriceSync = true;
  if (kind === 'resolve') resolveInitialExpectedPriceSync?.(value);
  else rejectInitialExpectedPriceSync?.(value);
}
```

在 debounced `SetExpectedPrice` timer 中：

- 首次同步成功：`settleInitialExpectedPriceSync('resolve')`
- 首次同步失败：`settleInitialExpectedPriceSync('reject', error)`

在 `waitForInitialExpectedPriceSync(signal)` 中：

- 先检查 `signal.aborted`
- 再注册一次性 `abort` listener
- `await initialExpectedPriceSync`
- 无论 resolve/reject/abort，最后都移除 listener

如果 `signal` 在 timer 触发前或请求途中被 abort：

- `waitForInitialExpectedPriceSync(signal)` 必须 reject 一个 abort error
- `runScript()` 必须把这条 abort 视为干净退出，不继续发送 `AutoAuction`
- `enable()` 自身不等待这条 Promise，因此不会把 `isBusy` 卡在 `true`

### 1.4 Disable/unmount must cancel pending sync

以下场景都必须清掉还没触发的 debounce timer：

- `disable()`
- `stopAutomation()`
- `onBeforeUnmount`
- 离开 tools 页面时

否则会出现 Elsa 已关闭、agent 已卸载，但旧 timer 仍尝试发送 `SetExpectedPrice` 的脏写问题。

### 1.5 Failure semantics: initial sync vs live sync

#### Initial sync failure

如果首次 debounced `SetExpectedPrice` 失败：

- 记一条 `error` 或高等级 `warn` log
- **不要**启动 `AutoAuction`
- 直接结束本次 enable 流程，并回到 disabled 状态

理由：

- 本轮设计已经明确 AutoAuction 不再以文件为权威价格源
- 如果首次同步没成功，再启动 `AutoAuction` 会重新引入“读取旧 session 价格”的风险

推荐日志格式：

- `初始化自动竞拍价格同步失败: <message>`

#### Live sync failure

如果 debounced `SetExpectedPrice` 发送失败：

- 只记一条 `warn` log
- 不自动关闭 Elsa 自动竞拍
- 不自动重试

理由：

- 失败原因通常是 agent 已断开、正在卸载、或桥接暂不可用
- 本轮不引入新的重试状态机
- 失败后如用户继续运行、后续价格再次变化，会自然触发下一次 debounce 同步

推荐日志格式：

- `同步自动竞拍价格失败: <message>`

### 1.6 No extra command-loading integration

Elsa composable 继续直接使用：

```js
window.bidkingDesktop.runAutoOperationCommand(name, args)
```

本轮不把 `SetExpectedPrice` 接入 Inject 页共享的 `commandLoading` 锁。

理由：

- Elsa 现有 `AutoAuction` / `CancelAutoAuction` 已经不依赖这套 UI 锁
- `SetExpectedPrice` 是短平快 side-band command，不应阻塞 Elsa 自己的运行状态

## Part 2: Native Side

### 2.1 Remove file-reader thread from AutoAuction price authority

`PriceReaderThreadProc()`、`StartPriceReaderThread()`、`StopPriceReaderThread()` 当前只为 AutoAuction 服务。

本轮要求：

- AutoAuction 不再启动 price reader thread
- `useExpectedPrice` 模式不再从 `Documents/BidKing/Price` 轮询读取价格

`Price` 文件继续由 app 写出，但 native AutoAuction 不再把它当成运行时出价来源。

### 2.2 Separate notified expected price state

在 `MetaOperations.cpp` 内，把 AutoAuction 使用的 expected price 状态收敛为只由 `SetExpectedPrice` 更新的一份字段：

```cpp
static std::atomic<int> g_notifiedExpectedPrice{0};
```

语义：

- `g_notifiedExpectedPrice`
  - 最近一次通过 `SetExpectedPrice` 明确通知给 agent 的价格

实现要求：

- 删除旧的 `g_expectedPrice`
- 删除 `PriceReaderThreadProc()`、`StartPriceReaderThread()`、`StopPriceReaderThread()`
- AutoAuction 运行时不允许同时保留“两份 expected price 状态源”

### 2.3 CmdSetExpectedPrice behavior

`CmdSetExpectedPrice()` 改为只写入上述 notified 状态：

- `price < 0` 时 clamp 到 0
- 存储 `g_notifiedExpectedPrice`
- 返回 `{ "price": <n> }`

这条命令不再和文件轮询线程共享同一个原子变量。

### 2.4 AutoAuction startup behavior

`CmdAutoAuction()` 开始时：

- 不启动 `StartPriceReaderThread()`
- 不创建当前 inline local guard struct `PriceReaderGuard`
- 不清空全局最新 notified price

原因：

- 本次脚本已经被 app 侧约束为“首次同步成功后才启动 AutoAuction”
- 因此 `CmdAutoAuction()` 可以直接把当前 `g_notifiedExpectedPrice` 视为本 session 的已初始化值
- 不需要再在 native 侧额外区分“这是不是旧 session 的价格”

### 2.5 Replace the `secs < 15` gate

当前：

```cpp
if (secs < 15 && !round.empty() && round != lastBidRound) {
    ...
}
```

改为把“轮次合法”和“价格已同步”分开判断。

推荐等价结构：

```cpp
if (round.empty() || round == lastBidRound) {
    continue;
}

if (useExpectedPrice) {
    static const int FLOOR_PRICE = 11119;
    int currentPrice = g_notifiedExpectedPrice.load();
    if (currentPrice <= 0) currentPrice = FLOOR_PRICE;
    amount = currentPrice;
    lastExpectedPrice = currentPrice;
} else {
    if (secs >= 15) continue;
    amount = bidAmount;
}

if (amount == 0) {
    continue;
}
```

然后直接进入现有：

- 出价按钮点击
- 输入框写入
- 确认按钮点击
- `ShouldCountAutoAuctionRound(...)`

并且**显式保留**当前 `MetaOperations.cpp:1165-1242` 的 opponent-cap 子系统：

```cpp
// useExpectedPrice 分支在算出 originalBid / amount 之后，
// 继续沿用现有 opponent-cap 逻辑，不在本轮改写：
// - TryReadVisiblePlayerName
// - TryResolveOpponentSlot
// - TryReadOpponentPreviousRoundBid
// - TryGetOpponentCapMultiplier
// - ComputeOpponentCappedBid
// - 相关 limiter skipped / cappedBid log
```

整合点要求：

- `originalBid` 仍然取进入 opponent-cap 逻辑前的 `amount`
- round 2..5 的封顶逻辑保持原样
- 本轮只改变“amount 从哪里来”和“什么时候允许进入这段逻辑”，不改变它本身

### 2.6 Round semantics after removing the time gate

去掉 `secs < 15` 之后，round 语义变成：

- **每轮第一次观察到可出价、且尚未写入 `lastBidRound` 时，就可以直接尝试出价**

这会带来以下明确行为：

- 如果进入某轮时 notified price 已经就绪，则该轮会尽早出价
- 如果 notified price 是 `0`，则按既有 `FLOOR_PRICE` 规则在该轮首次 eligible pass 上直接解析出 `amount`
- 不存在“price 还是 0，于是本轮先 continue，等下一次 loop 再吃到新价”的专门分支；因为在当前 spec 中，`0` 会直接走 `FLOOR_PRICE` fallback
- 如果该轮已经成功写入 `lastBidRound`，后续新通知不会触发二次出价

这正是本轮要的“由 app 侧 debounce 通知决定最早出价时机，而不是固定拖到 15 秒”。

### 2.7 Authcode / result reporting source

以下返回值中的 expected price 字段，应改为以 notified expected price 为准：

- early ended 回包
- auction ended 回包中的 `expectedPrice`

规则：

- 优先用 `lastExpectedPrice`
- 否则回退到 `g_notifiedExpectedPrice`

补充说明：

- authcode 中断路径当前已经有“`lastExpectedPrice` 优先，否则回退到全局价格”的正确结构；本轮只需要把它的全局价格来源从旧 `g_expectedPrice` 切换到 `g_notifiedExpectedPrice`
- early ended 路径需要同样遵守这套优先级，而不是直接读取旧文件轮询状态

## Part 3: Test Strategy

### 3.1 Elsa unit tests

修改 `src/elsa/useElsaAutoOperation.test.js`，新增以下覆盖：

1. `enable()` 后立即写 `Price` 文件，但不会立刻发 `SetExpectedPrice`
2. 首次 `SetExpectedPrice` 成功前，不会调用 `AutoAuction`
3. 4 秒后发送一次 `SetExpectedPrice`
4. 4 秒内连续两次价格变化，只发送最后一次价格
5. 首次 4 秒等待期间 `isBusy` 已释放，`disable()` 可用
6. `disable()` 发生在 timer 触发前时，不会再发送 `SetExpectedPrice`，也不会启动 `AutoAuction`
7. 首次 `SetExpectedPrice` 失败时，不会启动 `AutoAuction`，且 Elsa 会回到 disabled
8. AutoAuction 运行中的后续 `SetExpectedPrice` 发送失败时写一条 `warn` log，但 Elsa 不会自动停掉

实现要求：

- 用 fake timers 验证 debounce，而不是靠真实等待
- 断言 `writeDataFile('Price', ...)` 与 `runAutoOperationCommand('SetExpectedPrice', ...)` 的调用次序和次数

### 3.2 Native helper tests

不要直接把整段 `CmdAutoAuction()` 拉进单元测试。

本轮应新增一个可测的纯 helper，放在 `AggregateOperationSemantics.h` 或新的小 header 中，负责表达：

- 当前轮是否已经有资格进入自动出价尝试

推荐 helper：

```cpp
inline bool ShouldAttemptExpectedPriceAutoBid(
    int resolvedAmount,
    const std::string& round,
    const std::string& lastBidRound
);
```

最小测试矩阵：

- `round` 为空 -> false
- `round == lastBidRound` -> false
- `resolvedAmount <= 0` -> false
- `resolvedAmount > 0 && round != lastBidRound` -> true

另外在现有 native test 中补一条回归断言，锁住：

- 去掉 `secs < 15` 后，round counter 仍由 `round != lastRoundSeen` 驱动
- 不会因为出价更早而跳过 round 2/3/4/5 的 `roundsEncountered` 递增语义
- legacy `bidAmount` 模式仍然保留 `secs < 15` 门槛，不会因为本轮改动而提前在每次 loop 都尝试出价

### 3.3 Regression verification

实现完成后至少重跑：

- `npx vitest run src/elsa/useElsaAutoOperation.test.js`
- WSL 下的 native helper test
- `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`

如果实现过程中改动了 AutoAuction 其他分支，再补跑现有 Elsa auto-operation 相关测试集。

## Files Expected To Change

- `src/elsa/useElsaAutoOperation.js`
- `src/elsa/useElsaAutoOperation.test.js`
- `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
- `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`

## Explicit Non-Requirements

- 不要求 `SetExpectedPrice` 在 debounce 成功后回写文件
- 不要求新增 `SetExpectedPriceAck` 事件
- 不要求在 native 侧实现 debounce；debounce 只在 app 侧
- 不要求支持“同一轮多次修正出价”
- 不要求保留 `secs < 15` 作为 fallback

## Acceptance Criteria

- Elsa 启用后，`Price` 文件仍会立即更新
- Elsa 启用后，首次 `AutoAuction` 调用发生在首次 debounced `SetExpectedPrice` 成功之后
- Elsa 启用后，agent 至少在 4 秒防抖后收到一次 `SetExpectedPrice`
- `useExpectedPrice` 模式下，AutoAuction 不再硬编码等到当前轮剩余 15 秒才允许出价
- AutoAuction 使用的 expected price 只来自 `SetExpectedPrice`，而不是文件轮询
- 同一轮仍然最多只出价一次
- 关闭 Elsa 或离开页面后，不会再有延迟中的 `SetExpectedPrice` 脏写
