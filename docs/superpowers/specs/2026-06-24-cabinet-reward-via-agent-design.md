# 柜子奖励改用 Agent 执行设计

**日期**：2026-06-24  
**分支**：`feat/cabinet-reward-via-agent`  
**Worktree**：独立 worktree，不在主仓库目录开发

---

## 目标

将 Inject 页面"柜子奖励"tab 的获取/领取奖励操作，从现有的独立 DLL 注入方式（`BKCabinetRewardPayload64.dll`）改为通过已注入的 Agent DLL（`BKAutoOpAgent`）执行 `CollectCabinetReward` 命令，废弃旧路径。

## 非目标

- 修改 C++ Agent DLL 代码
- 删除 `BKCabinetRewardPayload64.dll` 文件本身（留给后续清理）
- 改动其他面板或功能

## 现状

`InjectCabinetRewardPanel.vue` 有两个按钮：

| 按钮 | 调用链 |
|---|---|
| 获取奖励 | `queryCabinetReward()` → `runCabinetRewardCommand('CabinetReward')` → 注入 `BKCabinetRewardPayload64.dll` → 等待 JSON 文件 |
| 领取奖励 | `claimCabinetReward()` → `runCabinetRewardCommand('ClaimCabinetReward')` → 同上 |

旧方式每次调用都重新注入 DLL，需要等待文件输出，返回 `awardCount`、`observedAt`、`path`。

Agent 侧已有 `CmdCollectCabinetReward`（`MetaOperations.cpp:1253`），执行完整的导航+领取流程，返回 `{"collected":true}`，无奖励数量字段。

## 设计

### 1. Worktree

```bash
git worktree add ../BidKing-feat-cabinet-reward-via-agent feat/cabinet-reward-via-agent
```

所有改动在该 worktree 下进行。

### 2. Vue 面板（`src/inject/panels/InjectCabinetRewardPanel.vue`）

- 引入 `useAutoOperationAgentRuntimeState`（与 `InjectMetaOperationPanel` 相同）
- `canUseCabinetReward` 守卫改为 `transportReady`：需要 `isDesktop` + `agentBridgeAvailable` + `agentConnected` + `runAutoOperationCommand` 可用
- 添加 `commandLoading` prop（`String`，默认 `''`）和 `command-loading-change` emit，与 `InjectAgentPanel`/`InjectMetaOperationPanel` 保持一致
- 两个按钮合并为一个"领取柜子奖励"按钮，调用 `runAutoOperationCommand('CollectCabinetReward', {})`；在调用前后分别 emit `command-loading-change('CollectCabinetReward')` 和 `command-loading-change('')`
- `canRunCollect` 守卫同时检查 `transportReady` 和 `!effectiveCommandLoading`（其中 `effectiveCommandLoading = props.commandLoading || localLoading`）
- 移除 `awardCount`、`observedAt`、`path` 展示块
- 成功时显示持久性"领取成功"文字（保持到下次点击前清除），失败时显示 `errorMessage`

### 2a. App.vue 接线（`src/inject/App.vue`）

`InjectCabinetRewardPanel` 挂载点（当前 `App.vue:140`）补充共享锁接线：

```html
<InjectCabinetRewardPanel
  :command-loading="autoOperationCommandLoading"
  @command-loading-change="setAutoOperationCommandLoading"
/>
```

### 2b. i18n 变更（`src/shared/messages.js`，中英文两处）

| key | 动作 | 新内容 |
|---|---|---|
| `cabinetRewardSub` | 更新 | 改为描述 agent 执行流程，移除"写入 JSON 文件"说明 |
| `fetchCabinetReward` | 删除 | 旧"获取当前收益"按钮 |
| `fetchingCabinetReward` | 删除 | 旧加载状态 |
| `claimCabinetReward` | 更新 | 改为新按钮标签，如"领取柜子奖励" |
| `claimingCabinetReward` | 更新 | 保持"领取中" |
| `claimCabinetRewardSuccess`（新增） | 新增 | "领取成功" / "Reward claimed" |

### 3. Electron Service（`electron/services/inject-service.js`）

删除：
- `runCabinetRewardCommand` 函数
- `queryCabinetReward` 函数
- `claimCabinetReward` 函数
- `module.exports` 中的对应条目

### 4. IPC / Main（`electron/main.js`）

删除 `queryCabinetReward`、`claimCabinetReward` 对应的 IPC handler 注册。

### 5. Preload（`electron/preload.js` 或同类文件）

从 `bidkingDesktop` 对象中删除 `queryCabinetReward`、`claimCabinetReward` 字段暴露。

## 响应形状对比

| | 旧 | 新 |
|---|---|---|
| 成功 | `{ok:true, value:{awardCount,observedAt}, path}` | `{ok:true, value:{collected:true}}` |
| 失败 | `{ok:false, error}` | `{ok:false, error}` 或 throw |
| 可用性 | `queryCabinetReward`/`claimCabinetReward` 函数存在 | agent 连接（`transportReady`）|

## 其他决策

- `InjectMetaOperationPanel` 中的 `CollectCabinetReward` 原始命令按钮保留（开发调试工具，与用户端 cabinet tab 定位不同）

## Done When

- [ ] 点击"领取柜子奖励"按钮，在 agent 已注入时成功执行完整领取流程，完成后显示"领取成功"
- [ ] agent 未注入时按钮禁用，提示与其他 agent 面板一致
- [ ] `CollectCabinetReward` 参与共享 `autoOperationCommandLoading` 锁，不与其他 agent 命令并发
- [ ] `queryCabinetReward`、`claimCabinetReward` 从 preload/main/service 中全部删除
- [ ] 旧的 `BKCabinetRewardPayload64.dll` 注入路径不再被任何代码调用
- [ ] i18n 中旧 key 删除/更新，`claimCabinetRewardSuccess` 新增
- [ ] `App.test.js` 中旧 cabinet API 测试改写为新 agent 路径
- [ ] `inject-service.test.mjs` 中 `describe('inject-service cabinet reward')` 块（`queryCabinetReward`/`claimCabinetReward` 旧函数测试，约第 31 行起）删除；第 438 行起的 `runAutoOperationCommand('CollectCabinetReward')` 超时覆盖测试**保留**
- [ ] tests → lint → typecheck → build 全部通过
