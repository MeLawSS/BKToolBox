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
- 两个按钮合并为一个"领取柜子奖励"按钮，调用 `runAutoOperationCommand('CollectCabinetReward', {})`
- 移除 `awardCount`、`observedAt`、`path` 展示块
- 成功时显示成功提示，失败时显示 `errorMessage`（与其他面板一致）

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

## Done When

- [ ] 点击"领取柜子奖励"按钮，在 agent 已注入时成功执行完整领取流程
- [ ] agent 未注入时按钮禁用，提示与其他 agent 面板一致
- [ ] `queryCabinetReward`、`claimCabinetReward` 从 preload/main/service 中全部删除
- [ ] 旧的 `BKCabinetRewardPayload64.dll` 注入路径不再被任何代码调用
- [ ] 无 lint/typecheck/build 错误
