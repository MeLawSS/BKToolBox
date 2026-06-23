# CmdAutoAuction 固定时间等待分析

> 文件：`tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
> 函数：`CmdAutoAuction`（L1469–L2087）
> 日期：2026-06-23

## 概述

`CmdAutoAuction` 共 8 个步骤，涉及 **31 处固定时间等待**。其中仅 `WaitForBidConfirmationSettled`（L1876）是检测页面状态的，其余全部是固定 `Sleep`。

代码库中已有正确的状态轮询范式（`CmdWaitForNode`、`WaitForBidConfirmationSettled`），但拍卖主流程未采用。

---

## 统计

| 等待值 | 次数 | 典型用途 |
|--------|------|----------|
| 300ms | 1 | 关闭 toggle 后 |
| 500ms | 1 | 输入出价金额后 |
| 1000ms | 12 | 各步骤轮询间隔 |
| 1500ms | 15 | 点击按钮后 / 等待场景切换 |
| 2000ms | 2 | 进入房间 / 开始战斗 |

---

## 各步骤详情

### Step 1 — 导航到 main_lobby（L1538–L1551）

| 行号 | 等待 | 条件 |
|------|------|------|
| L1550 | `SleepInterruptibly(1500)` | 每次点击关闭浮层后，无条件等待再重检 |

```cpp
if (ResolveCloseTarget(cur, &t, &p)) { ClickNode(t, p, 0, &e); }
if (!SleepInterruptibly(1500)) { stopIfRequested(); return; }  // 不管是否真关了都等
```

### Step 2 — 进入拍卖大厅（L1553–L1571）

| 行号 | 等待 | 条件 |
|------|------|------|
| L1554 | `clickOnPanel(..., 1500)` | 点击 GoToBattlePrev 后固定等待 |
| L1561 | `SleepInterruptibly(1000)` | 每次重检前先等（最多 15 次 × 1s） |

```cpp
clickOnPanel("UIMain", "MainPanel/mask/Button", 1500);

for (int i = 0; i < 15; i++) {
    SleepInterruptibly(1000);          // 先等
    state = DetectScreenState();       // 再检
    if (screen == "auction_lobby_map") break;
}
```

### Step 3 — 进入房间（L1573–L1595）

| 行号 | 等待 | 条件 |
|------|------|------|
| L1577 | `clickOnPanel(..., 2000)` | 点击房间入口后固定等待 |
| L1585 | `SleepInterruptibly(1000)` | 每次重检前先等（最多 15 次 × 1s） |

```cpp
clickOnPanel("BattlePrevPanel_Main", roomPath, 2000);

for (int i = 0; i < 15; i++) {
    SleepInterruptibly(1000);
    state = DetectScreenState();
    if (screen == "auction_lobby_room") break;
}
```

### Step 4 — 技能配置 → 选角色 → 开始战斗（L1631–L1645）

| 行号 | 等待 | 条件 |
|------|------|------|
| L1632 | `clickOnPanel(..., 1500)` | 点击技能配置按钮后 |
| L1638 | `clickOnPanel(..., 1500)` | 选择角色后 |
| L1642 | `clickOnPanel(..., 2000)` | 点击开始战斗后 |

```cpp
clickOnPanel("BattlePrevPanel_Main", "...Hero/Button",        1500);
clickOnPanel("BattlePrevPanel_Main", "...herochooseItem_103", 1500);
clickOnPanel("BattlePrevPanel_Main", "...MapPanel/Button",    2000);
```

### Step 5 — 等待进入拍卖（L1647–L1669）

| 行号 | 等待 | 条件 |
|------|------|------|
| L1651 | `SleepInterruptibly(1500)` | 每次重检前先等（最多 80 次 × 1.5s = 最长 120s） |

```cpp
for (int i = 0; i < 80; i++) {
    SleepInterruptibly(1500);
    state = DetectScreenState();
    if (screen == "auction_in_progress") break;
    if (screen == "auction_ended") return;  // 房间满，直接结束
}
```

### Step 6 — 出价循环（L1676–L1909）

| 行号 | 等待 | 条件 |
|------|------|------|
| L1677 | `SleepInterruptibly(1000)` | 每轮循环开始先等 1s |
| L1806 | `SleepInterruptibly(1500)` | 点击"出价"按钮后 |
| L1851 | `SleepInterruptibly(300)` | 关闭 priceUpperLimit toggle 后 |
| L1867 | `SleepInterruptibly(500)` | 设置出价金额文本后 |

```cpp
for (;;) {
    SleepInterruptibly(1000);            // 每轮先等
    s = DetectScreenState();
    // ... 计算本轮出价 ...

    ClickNode(s.battleMainTransform, "Gaming/chujia", 0, &err);
    SleepInterruptibly(1500);            // 点出价后等

    // 关闭价格上限 toggle
    ClickNode(..., "priceUpperLimit", 0, &err);
    SleepInterruptibly(300);             // 关 toggle 后等

    // 输入金额
    PerformSetInputText(inputM[0], amountStr, ...);
    SleepInterruptibly(500);             // 输入后等

    // 点确认
    ClickNode(..., "chujia", 0, &err);
    WaitForBidConfirmationSettled(...);  // ✅ 唯一检测状态的
}
```

### Step 7 — 结束画面：胜者检测 + 快捷回收（L1913–L1967）

| 行号 | 等待 | 条件 |
|------|------|------|
| L1945 | `SleepInterruptibly(1000)` | 还没读到胜者名字 |
| L1953 | `SleepInterruptibly(1000)` | 快捷回收按钮未出现 |
| L1962 | `SleepInterruptibly(1500)` | 点击快捷回收后 |
| L1965 | `SleepInterruptibly(1000)` | 按钮组件异常时重试 |

```cpp
for (int attempt = 0; attempt < 30; ++attempt) {
    if (!winnerResolved) {
        SleepInterruptibly(1000);        // 等胜者名字出现
        continue;
    }
    if (huishouM.empty() || !active) {
        SleepInterruptibly(1000);        // 等回收按钮出现
        continue;
    }
    if (PerformButtonClick(...)) {
        SleepInterruptibly(1500);        // 点完后等
        break;
    }
    SleepInterruptibly(1000);            // 异常重试
}
```

### Step 8 — 退出到 main_lobby（L1973–L2079）

| 行号 | 等待 | 条件 |
|------|------|------|
| L1992 | `SleepInterruptibly(1000)` | battleMainTransform 为空 |
| L2010 | `SleepInterruptibly(1000)` | EndPanel 按钮未就绪 |
| L2025 | `SleepInterruptibly(1000)` | 点击 EndPanel 按钮失败 |
| L2033 | `SleepInterruptibly(1500)` | 点击 continue/receive 成功后 |
| L2045 | `SleepInterruptibly(1000)` | battlePrevTransform 为空 |
| L2054 | `SleepInterruptibly(1500)` | 点击 Top/Close 成功后 |

```cpp
for (int attempt = 0; attempt < cleanupMaxAttempts; ++attempt) {
    // auction_ended 画面
    if (!se.battleMainTransform) {
        SleepInterruptibly(1000); continue;
    }
    if (!endedActionPath) {
        SleepInterruptibly(1000); continue;
    }
    ClickNode(..., endedActionPath, 0, &e);
    SleepInterruptibly(1500);            // 点完后等
    continue;

    // auction_lobby 画面
    if (!se.battlePrevTransform) {
        SleepInterruptibly(1000); continue;
    }
    ClickNode(..., "Top/Close", 0, &e);
    SleepInterruptibly(1500);            // 点完后等
}
```

---

## 核心问题

`clickOnPanel` 是问题的高度浓缩——这个辅助函数把"点击"和"固定等待"耦合在了一起：

```cpp
auto clickOnPanel = [&](const char* panelName, const char* nodePath, int delayMs) -> bool {
    Il2CppObject* t = nullptr;
    if (FindVisiblePanelTransform(panelName, nullptr, &t, ...) != UI_PANEL_FOUND || !t)
        return false;
    bool ok = ClickNode(t, nodePath, 0, &e);
    if (ok && delayMs > 0 && !SleepInterruptibly(delayMs)) return false;  // ← 问题所在
    return ok;
};
```

它检测面板是否存在（状态检测 ✅），但点击之后却不检测目标 UI 是否真的出现，而是直接睡一个固定毫秒数（❌）。

---

## 已有的正确范式（供参考）

### CmdWaitForNode（BKAutoOpAgent.cpp L3793）

```cpp
// 轮询直到目标节点满足状态条件，带超时
for (;;) {
    panelResult = FindVisiblePanelTransform(panel, ...);
    ResolveUiNodeMatches(anchorTransform, path, ...);
    if (IsNodeStateSatisfied(matches[0], waitState)) break;  // exists/active/interactive
    if (elapsed >= timeoutMs) break;
    Sleep(pollIntervalMs);  // 仅作为轮询间隔，非固定等待
}
```

### WaitForBidConfirmationSettled（MetaOperations.cpp L682）

```cpp
// 轮询检测 MessageBox 是否出现、出价对话框是否关闭
for (int waitedMs = 0; waitedMs <= timeoutMs; waitedMs += pollMs) {
    bool messageBoxVisible = (FindVisiblePanelTransform("MessageBox", ...) == UI_PANEL_FOUND);
    bool bidDialogClosed = !HasActiveBidInputDialog(battleMainTransform);
    // ... 按状态迁移做不同处理 ...
    if (completed) return result;
    SleepInterruptibly(pollMs);  // 轮询间隔
}
```

---

## 改进方向

将固定等待替换为状态检测轮询：

1. **点击后等待目标出现**：用 `CmdWaitForNode` 的轮询模式等待目标面板/节点变为 `active`，而非固定 `Sleep(1500)`
2. **等待屏幕切换**：轮询 `DetectScreenState()` 直到目标屏幕出现，而非"先睡再检"
3. **等待 UI 元素消失**：轮询检测当前元素是否已不可见，确认转换完成后再进入下一步
4. **保留超时上限**：每个轮询保留当前的最大循环次数作为超时兜底
