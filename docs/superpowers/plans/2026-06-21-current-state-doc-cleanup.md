# Current-State Document Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the four high-confidence stale current-state docs from the 2026-06-21 audit and clarify `BKAutoOpClient` as a still-packaged legacy artifact without changing runtime behavior or deleting code.

**Architecture:** This is a documentation-only cleanup. Each task edits one current-state/manual surface at a time, verifies the old stale wording or omission first, then applies a narrow markdown patch, then re-runs targeted text checks before committing. `BKAutoOpClient` stays in place; the only allowed action is a factual current-state note that explains why it is not safe to delete in this pass.

**Tech Stack:** Markdown docs, PowerShell, `rg`, git

---

## File Map

| File | Responsibility in this cleanup |
| --- | --- |
| `docs/Documentation.md` | Current-state repo facts for Inject Controller composition, Inject MetaOperation exposure, and `BKAutoOpClient` packaged-artifact note |
| `docs/ARCHITECTURE.md` | Current architectural description of the Controller shell and its child surfaces |
| `docs/AUTO_OPERATION_MANUAL.md` | Current grouped dispatch-table inventory and current MetaOperation surface matrix |
| `docs/AUTO_OPERATION_COMMANDS.md` | Current flat dispatch-table inventory |
| `docs/superpowers/reports/2026-06-21-current-state-audit.md` | Audit source of truth for what this cleanup is resolving |
| `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp` | Current native dispatch-table order to mirror in the manuals |
| `package.json` | Current `extraResources` fact proving `BKAutoOpClient.dll` is still packaged |

## Guardrails

- This plan must not delete `tools/inject/AutoOperation/BKAutoOpClient/`.
- This plan must not edit `package.json`, `BKAutoOpAgent.cpp`, Electron files, CLI files, or Inject Vue code.
- This plan must not rewrite unrelated historical verification bullets in `docs/Documentation.md`.
- This plan must keep all changes documentation-only.

### Task 1: Correct `docs/Documentation.md`

**Files:**
- Modify: `docs/Documentation.md`
- Reference: `src/inject/panels/InjectMetaOperationPanel.vue`
- Reference: `src/inject/panels/InjectControllerPanel.vue`
- Reference: `src/inject/panels/InjectWarehouseBatchOpPanel.vue`
- Reference: `src/inject/useWarehouseBatchOp.js`
- Reference: `package.json`

- [ ] **Step 1: Confirm the stale current-state wording is still present**

Run:

```powershell
rg -n '暴露七个已存在的 BKAutoOpAgent MetaOperation|`Controller` panel 内部现在拆成 readiness cards \+ `UI 操作` 子面板 \+ 泛型 command console' docs/Documentation.md
```

Expected:

```text
Two matches:
1. the old Controller composition bullet without the warehouse auto-sort child surface
2. the old MetaOperation bullet that still says the panel exposes seven commands
```

- [ ] **Step 2: Replace the stale Inject current-state bullets with the corrected markdown**

Edit `docs/Documentation.md` so the relevant bullets read as follows:

```md
- `Inject` 页当前由 `src/inject/App.vue` 只负责 workspace 壳层、共享 `collectibles` 加载和跨 panel 的 AutoOperation command lock；展示柜收益 / Agent 状态 / 控制器 / 元操作 / 仓库统计 / 上架建议 / 延迟价格 / 收藏采集都已拆到 `src/inject/panels/*.vue`，只有 `StockMovePanel.vue` 继续保留为一级 panel。`Controller` panel 内部现在拆成 readiness cards + `UI 操作` 子面板 + `仓库自动排序` 子面板 + 泛型 command console；其中 `UI 操作`、`仓库自动排序` 与 command console 一样接入这把共享 command lock，因此不会和 `Agent 状态 / 上架建议 / 延迟价格` 等其他 AutoOperation 面板并发发 pipe 命令。
- `src/inject/panels/InjectMetaOperationPanel.vue` 是一个独立的 Inject 业务入口层：它消费共享 agent runtime 的只读状态，通过现有 `runAutoOperationCommand(command, args)` bridge 直接暴露 14 个当前原生命令入口，其中 12 个 zero-arg 动作是 `GoToBattlePrev`、`OpenSkillConfig`、`SelectRole`、`StartAction`、`GetBidState`、`PlaceBid`、`ConfirmBid`、`DismissRewardsBox`、`DismissCollectAward`、`GetCurrentScreen`、`CloseCurrentOverlay`、`CollectCabinetReward`，另外还提供参数化的 `EnterRoom` 与 `SetBidAmount`；它会把最近一次响应展示为格式化 JSON，但不承载泛型命令输入，也不根据当前游戏画面做前端按钮级 gating。
- `tools/inject/AutoOperation/BKAutoOpClient/` 当前在仓库内没有已知调用链，但仍会因 `package.json` 中 `extraResources` 对 `tools/inject/**/*.dll` 的打包过滤而随桌面产物分发；当前 `dist/*/resources/runtime/tools/inject/AutoOperation/BKAutoOpClient/BKAutoOpClient.dll` 也证明它仍是被分发的 legacy native client artifact，因此这轮不能把它按纯 dead code 直接删除。
```

- [ ] **Step 3: Re-run targeted text checks**

Run:

```powershell
rg -n "仓库自动排序|直接暴露 14 个当前原生命令入口|BKAutoOpClient.*legacy native client artifact" docs/Documentation.md
rg -n "暴露七个已存在的 BKAutoOpAgent MetaOperation" docs/Documentation.md
```

Expected:

```text
First command: three matches for the new wording.
Second command: no output.
```

- [ ] **Step 4: Commit the `Documentation.md` cleanup**

Run:

```bash
git add docs/Documentation.md
git commit -m "docs: refresh current-state inject documentation"
```

Expected:

```text
A commit is created that only updates docs/Documentation.md.
```

### Task 2: Correct `docs/ARCHITECTURE.md`

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Reference: `src/inject/panels/InjectControllerPanel.vue`
- Reference: `src/inject/panels/InjectUiAutomationPanel.vue`
- Reference: `src/inject/panels/InjectWarehouseBatchOpPanel.vue`
- Reference: `src/inject/useWarehouseBatchOp.js`

- [ ] **Step 1: Confirm the warehouse auto-sort child surface is currently omitted**

Run:

```powershell
rg -n "InjectControllerPanel\.vue 当前通过|InjectWarehouseBatchOpPanel|useWarehouseBatchOp" docs/ARCHITECTURE.md
```

Expected:

```text
One match for the existing InjectControllerPanel description.
No match for InjectWarehouseBatchOpPanel.
No match for useWarehouseBatchOp.
```

- [ ] **Step 2: Update the Controller-shell architecture description and file list**

Edit `docs/ARCHITECTURE.md` so the Inject implementation bullets read like this:

```md
- `InjectControllerPanel.vue` 当前通过 `src/shared/useAutoOperationAgentSwitch.js` 的无副作用只读视图消费共享 agent runtime，并作为 readiness cards + `InjectUiAutomationPanel.vue` + `InjectWarehouseBatchOpPanel.vue` + 泛型 command console 的外层壳；`src/inject/App.vue` 会按 `activePanelId === 'controller'` 显式传入 `isActive`，`InjectControllerPanel.vue` 再把该信号转交给 `InjectUiAutomationPanel.vue` + `useControllerUiAutomation.js`。后者继续负责 activation refresh、visible panel 切换、node 选择，以及 `ClickNode / SetInputText` 结构化动作；而 `InjectUiAutomationPanel.vue` 现在额外保留 view-local 的 search/filter、双击行点击、compact status line 和 1.5s transient row feedback，因此 UI 体验可以重做，但 bridge / refresh / shared lock 语义仍集中在 composable 里。`InjectWarehouseBatchOpPanel.vue` + `src/inject/useWarehouseBatchOp.js` 则承载当前仓库自动排序流程，通过 `GetCurrentScreen`、`CloseCurrentOverlay`、`GetStockContainers` 与 `ClickNode` 编排主仓库和物品箱排序。
- `src/inject/panels/InjectWarehouseBatchOpPanel.vue`
- `src/inject/useWarehouseBatchOp.js`
```

- [ ] **Step 3: Re-run targeted text checks**

Run:

```powershell
rg -n "InjectWarehouseBatchOpPanel|useWarehouseBatchOp|仓库自动排序流程" docs/ARCHITECTURE.md
```

Expected:

```text
Matches appear in the Inject architecture section and file list.
```

- [ ] **Step 4: Commit the `ARCHITECTURE.md` cleanup**

Run:

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: refresh controller architecture surface"
```

Expected:

```text
A commit is created that only updates docs/ARCHITECTURE.md.
```

### Task 3: Correct `docs/AUTO_OPERATION_MANUAL.md`

**Files:**
- Modify: `docs/AUTO_OPERATION_MANUAL.md`
- Reference: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- Reference: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`

- [ ] **Step 1: Confirm the omitted commands are currently absent from the manual inventory**

Run:

```powershell
rg -n "DescribeNodeComponents|DescribeNodeComponentMethods|DescribeNodeComponentMethodSignatures|DescribeNodeComponentFields|DescribeClassMethodSignatures|CallNodeComponentMethod|InvokeNodeComponentMethod|SetExpectedPrice|CancelAutoAuction" docs/AUTO_OPERATION_MANUAL.md
```

Expected:

```text
No output.
```

- [ ] **Step 2: Update the grouped dispatch-table inventory and MetaOperation set-difference matrix**

Edit `docs/AUTO_OPERATION_MANUAL.md` with these exact inventory changes:

```md
| UI automation selector commands | `DumpPanelTree`, `ClickNode`, `SetInputText`, `GetNodeState`, `DescribeNodeComponents`, `DescribeNodeComponentMethods`, `DescribeNodeComponentMethodSignatures`, `DescribeNodeComponentFields`, `DescribeClassMethodSignatures`, `CallNodeComponentMethod`, `InvokeNodeComponentMethod`, `WaitForVisiblePanel`, `WaitForNode` |
| Business / MetaOperation | `GoToBattlePrev`, `EnterRoom`, `OpenSkillConfig`, `SelectRole`, `StartAction`, `GetBidState`, `PlaceBid`, `SetBidAmount`, `ConfirmBid`, `DismissRewardsBox`, `DismissCollectAward`, `GetCurrentScreen`, `CloseCurrentOverlay`, `SetExpectedPrice`, `CancelAutoAuction` |
| AggregateOperation | `CollectCabinetReward`, `AutoAuction` |
```

Add these rows to the current command matrix:

```md
| `SetExpectedPrice` | yes | yes | no | helper command for renderer-driven expected-price sync; not exposed in Inject MetaOperation panel |
| `CancelAutoAuction` | yes | yes | no | stop/cancel companion to `AutoAuction`; not exposed in Inject MetaOperation panel |
```

Update the closing note under “Current Inject MetaOperation panel surface” to:

```md
It currently does not expose `AutoAuction`, `SetExpectedPrice`, or `CancelAutoAuction`.
```

- [ ] **Step 3: Re-run targeted text checks**

Run:

```powershell
rg -n "DescribeNodeComponents|DescribeNodeComponentMethods|DescribeNodeComponentMethodSignatures|DescribeNodeComponentFields|DescribeClassMethodSignatures|CallNodeComponentMethod|InvokeNodeComponentMethod|SetExpectedPrice|CancelAutoAuction" docs/AUTO_OPERATION_MANUAL.md
```

Expected:

```text
All nine omitted command names are now present in the manual.
```

- [ ] **Step 4: Commit the `AUTO_OPERATION_MANUAL.md` cleanup**

Run:

```bash
git add docs/AUTO_OPERATION_MANUAL.md
git commit -m "docs: refresh auto operation manual inventory"
```

Expected:

```text
A commit is created that only updates docs/AUTO_OPERATION_MANUAL.md.
```

### Task 4: Correct `docs/AUTO_OPERATION_COMMANDS.md`

**Files:**
- Modify: `docs/AUTO_OPERATION_COMMANDS.md`
- Reference: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`

- [ ] **Step 1: Confirm the flat dispatch-table list is still missing the omitted commands**

Run:

```powershell
rg -n "DescribeNodeComponents|DescribeNodeComponentMethods|DescribeNodeComponentMethodSignatures|DescribeNodeComponentFields|DescribeClassMethodSignatures|CallNodeComponentMethod|InvokeNodeComponentMethod|SetExpectedPrice|CancelAutoAuction" docs/AUTO_OPERATION_COMMANDS.md
```

Expected:

```text
No output.
```

- [ ] **Step 2: Replace the flat dispatch-table inventory block with the current native order**

Edit the `The current dispatch table contains:` block in `docs/AUTO_OPERATION_COMMANDS.md` so it reads:

```text
Ping
GetCurrentUI
GetVisiblePanels
OpenPanel
ClosePanel
DumpPanelTree
ClickNode
SetInputText
GetNodeState
DescribeNodeComponents
DescribeNodeComponentMethods
DescribeNodeComponentMethodSignatures
DescribeNodeComponentFields
DescribeClassMethodSignatures
CallNodeComponentMethod
InvokeNodeComponentMethod
WaitForVisiblePanel
WaitForNode
CollectionPrices
GetCollectionItemCids
GetWarehouseItemList
GetStockCollectibleCounts
GetStockContainers
MoveStockItem
GetItemTradeInfo
StartDelayedPriceQuery
GetDelayedPriceQueryStatus
CancelDelayedPriceQuery
ExchangeItem
InvokeMethod
LoadProbe
GoToBattlePrev
EnterRoom
OpenSkillConfig
SelectRole
StartAction
GetBidState
PlaceBid
SetBidAmount
ConfirmBid
DismissRewardsBox
DismissCollectAward
GetCurrentScreen
CloseCurrentOverlay
CollectCabinetReward
SetExpectedPrice
AutoAuction
CancelAutoAuction
UnloadAgent
```

- [ ] **Step 3: Re-run targeted text checks**

Run:

```powershell
rg -n "DescribeNodeComponents|DescribeNodeComponentMethods|DescribeNodeComponentMethodSignatures|DescribeNodeComponentFields|DescribeClassMethodSignatures|CallNodeComponentMethod|InvokeNodeComponentMethod|SetExpectedPrice|CancelAutoAuction" docs/AUTO_OPERATION_COMMANDS.md
```

Expected:

```text
All nine omitted command names are now present in the flat inventory.
```

- [ ] **Step 4: Commit the `AUTO_OPERATION_COMMANDS.md` cleanup**

Run:

```bash
git add docs/AUTO_OPERATION_COMMANDS.md
git commit -m "docs: refresh auto operation command inventory"
```

Expected:

```text
A commit is created that only updates docs/AUTO_OPERATION_COMMANDS.md.
```

### Task 5: Final documentation-only verification

**Files:**
- Verify: `docs/Documentation.md`
- Verify: `docs/ARCHITECTURE.md`
- Verify: `docs/AUTO_OPERATION_MANUAL.md`
- Verify: `docs/AUTO_OPERATION_COMMANDS.md`

- [ ] **Step 1: Re-run the cross-document audit-resolution checks**

Run:

```powershell
rg -n "暴露七个已存在的 BKAutoOpAgent MetaOperation" docs/Documentation.md
rg -n "仓库自动排序|InjectWarehouseBatchOpPanel|useWarehouseBatchOp" docs/Documentation.md docs/ARCHITECTURE.md
rg -n "DescribeNodeComponents|DescribeNodeComponentMethods|DescribeNodeComponentMethodSignatures|DescribeNodeComponentFields|DescribeClassMethodSignatures|CallNodeComponentMethod|InvokeNodeComponentMethod|SetExpectedPrice|CancelAutoAuction" docs/AUTO_OPERATION_MANUAL.md docs/AUTO_OPERATION_COMMANDS.md
```

Expected:

```text
1. First command: no output.
2. Second command: matches in Documentation.md and ARCHITECTURE.md.
3. Third command: matches in both AutoOperation docs.
```

- [ ] **Step 2: Run patch-format verification**

Run:

```bash
git diff --check
```

Expected:

```text
No output.
```

- [ ] **Step 3: Confirm the workspace only contains the intended documentation changes**

Run:

```bash
git status --short
```

Expected:

```text
Clean working tree, or only the four intended doc files staged/committed if this step is run before the final push/merge workflow.
```

- [ ] **Step 4: Create the final documentation cleanup commit if any post-verification wording fix was needed**

Run:

```bash
git add docs/Documentation.md docs/ARCHITECTURE.md docs/AUTO_OPERATION_MANUAL.md docs/AUTO_OPERATION_COMMANDS.md
git commit -m "docs: finalize current-state cleanup"
```

Expected:

```text
Either a final docs commit is created if Step 1 or Step 2 required a wording fix, or git reports there is nothing new to commit.
```

## Spec Coverage Check

- `docs/Documentation.md` stale MetaOperation surface: covered by Task 1.
- `docs/Documentation.md` missing Controller warehouse auto-sort child surface: covered by Task 1.
- `docs/ARCHITECTURE.md` missing Controller warehouse auto-sort child surface: covered by Task 2.
- `docs/AUTO_OPERATION_MANUAL.md` incomplete grouped dispatch-table inventory: covered by Task 3.
- `docs/AUTO_OPERATION_COMMANDS.md` incomplete flat dispatch-table inventory: covered by Task 4.
- `BKAutoOpClient` must not be deleted and should be clarified only as a still-packaged artifact: covered by Task 1 and guarded by the plan guardrails.

## Placeholder Scan

- No `TODO`, `TBD`, or “implement later” markers are allowed in the execution patch.
- Do not replace precise command lists with summary wording such as “and other introspection commands”.
- Do not broaden the scope into command-contract sections for `SetExpectedPrice` or `CancelAutoAuction`; this plan only fixes the stale inventories.

## Type And Naming Consistency

- Use the exact command names from `BKAutoOpAgent.cpp`.
- Keep `InjectWarehouseBatchOpPanel.vue` and `useWarehouseBatchOp.js` spelled exactly as they exist in the repo.
- Keep the current distinction between:
  - Inject `MetaOperation` panel exposure
  - native dispatch-table registration
  - packaged-but-not-in-repo-called `BKAutoOpClient`
