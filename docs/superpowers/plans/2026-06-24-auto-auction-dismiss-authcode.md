# AutoAuction Dismiss-Authcode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make native `AutoAuction` best-effort click the verification dialog close button when `authcode` is detected, then still return the unchanged `authcode_required` result.

**Architecture:** Keep the behavior in native code. Add one pure semantics helper in `AggregateOperationSemantics.h` for the authcode dismiss target, test it in `AggregateOperationSemantics.test.cpp`, then call it from a file-local best-effort helper inside `MetaOperations.cpp` and route all existing authcode exits through the unchanged `sendAuthCodeRequired()` contract.

**Tech Stack:** C++11, header-only semantics tests via `g++` under WSL, existing BKAutoOpAgent UI helpers (`FindVisiblePanelTransform`, `ClickNode`, `Logf`), repository markdown docs.

---

### Task 1: Add The Failing Native Semantics Test

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`
- Test: `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`

- [ ] **Step 1: Write the failing test**

Append these assertions near the existing authcode screen coverage in `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp`:

```cpp
    const char* verificationPanel = nullptr;
    const char* verificationPath = nullptr;
    assert(TryResolveAutoAuctionVerificationDismissTarget(
        "authcode",
        &verificationPanel,
        &verificationPath
    ));
    assert(strcmp(verificationPanel, "AuthCode_Main") == 0);
    assert(strcmp(verificationPath, "Main/m_BtnClose") == 0);
    verificationPanel = nullptr;
    verificationPath = nullptr;
    assert(!TryResolveAutoAuctionVerificationDismissTarget(
        "auction_lobby_room",
        &verificationPanel,
        &verificationPath
    ));
```

- [ ] **Step 2: Run the native test to verify it fails**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-dismiss-authcode && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/aggregate-operation-semantics-test && /tmp/aggregate-operation-semantics-test"
```

Expected: compile failure because `TryResolveAutoAuctionVerificationDismissTarget(...)` does not exist yet.

- [ ] **Step 3: Add the minimal semantics helper**

Add this helper next to `IsAutoAuctionVerificationScreen(...)` in `tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.h`:

```cpp
inline bool TryResolveAutoAuctionVerificationDismissTarget(
    const char* screen,
    const char** panelNameOut,
    const char** pathOut
) {
    if (panelNameOut) *panelNameOut = nullptr;
    if (pathOut) *pathOut = nullptr;
    if (!IsAutoAuctionVerificationScreen(screen)) {
        return false;
    }
    if (panelNameOut) *panelNameOut = "AuthCode_Main";
    if (pathOut) *pathOut = "Main/m_BtnClose";
    return true;
}
```

- [ ] **Step 4: Run the native test to verify it passes**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-dismiss-authcode && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/aggregate-operation-semantics-test && /tmp/aggregate-operation-semantics-test"
```

Expected: exit code `0` with no assertion failures.

### Task 2: Wire Best-Effort Dismiss Into AutoAuction

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- Test: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp`

- [ ] **Step 1: Keep the response contract fixed**

Do not change the existing response formatter in `tools/inject/AutoOperation/BKAutoOpAgent/AutoAuctionResponseFormatting.h`:

```cpp
inline std::string BuildAutoAuctionAuthCodeRequiredResult(int roundsPlayed, int expectedPrice) {
    char result[192];
    snprintf(
        result,
        sizeof(result),
        "{\"result\":\"authcode_required\",\"reason\":\"authcode_detected\",\"rounds\":%d,\"expectedPrice\":%d}",
        roundsPlayed,
        expectedPrice
    );
    return std::string(result);
}
```

The behavior change belongs only in the native orchestration path, not in the payload contract.

- [ ] **Step 2: Add the file-local best-effort dismiss helper**

In `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`, add a helper above `CmdAutoAuction(...)`:

```cpp
static void TryDismissAutoAuctionVerificationDialog(const char* screen) {
    const char* panelName = nullptr;
    const char* closePath = nullptr;
    if (!TryResolveAutoAuctionVerificationDismissTarget(screen, &panelName, &closePath)) {
        return;
    }

    Il2CppObject* panelTransform = nullptr;
    char error[128] = {};
    UiPanelLookupResult lookup = FindVisiblePanelTransform(
        panelName,
        nullptr,
        &panelTransform,
        error,
        sizeof(error)
    );
    if (lookup != UI_PANEL_FOUND || !panelTransform) {
        Logf(
            "AutoAuction authcode dismiss skipped: panel lookup failed panel=%s err=%s",
            panelName ? panelName : "null",
            error[0] ? error : "not found"
        );
        return;
    }

    std::string clickError;
    if (!ClickNode(panelTransform, closePath, 0, &clickError)) {
        Logf(
            "AutoAuction authcode dismiss failed: panel=%s path=%s error=%s",
            panelName,
            closePath ? closePath : "null",
            clickError.c_str()
        );
        return;
    }

    Logf("AutoAuction authcode dismiss clicked: panel=%s path=%s", panelName, closePath);
}
```

- [ ] **Step 3: Call the helper from the shared authcode response path**

Inside the existing `sendAuthCodeRequired` lambda in `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`, make it:

```cpp
    auto sendAuthCodeRequired = [&](const char* screen = "authcode") -> bool {
        const int reportedExpectedPrice = ResolveAutoAuctionReportedExpectedPrice(
            lastExpectedPrice,
            g_notifiedExpectedPrice.load()
        );
        TryDismissAutoAuctionVerificationDialog(screen);
        const std::string result = BuildAutoAuctionAuthCodeRequiredResult(roundsPlayed, reportedExpectedPrice);
        SendResponse(c, id, true, result.c_str());
        return true;
    };
```

Leave every existing authcode branch calling the shared lambda so one implementation covers all current detection sites.

- [ ] **Step 4: Run the native regression test executable**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-dismiss-authcode && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp -o /tmp/meta-operations-test && /tmp/meta-operations-test"
```

Expected: exit code `0`; the existing authcode response JSON assertions still pass unchanged.

### Task 3: Document The New Verified Behavior And Final Checks

**Files:**
- Modify: `docs/bkcli-auction-ui-exploration.md`
- Modify: `docs/Documentation.md`

- [ ] **Step 1: Record the verified authcode panel structure**

In `docs/bkcli-auction-ui-exploration.md`, add a short section describing the verified `AuthCode_Main` structure and actionable paths:

```md
## 七、滑动验证界面（AuthCode_Main）

- 当前 screen：`authcode`
- 关闭按钮：`Main/m_BtnClose`
- 滑块拖动按钮：`Main/Move`
- 遮罩按钮：`Mask`

已通过 `node tools/bkcli/bkcli.js click AuthCode_Main Main/m_BtnClose` 实测验证，点击后 `AuthCode_Main` 消失，screen 回到 `auction_lobby_room`。
```

- [ ] **Step 2: Record verification in the current-state log**

Append a `2026-06-24` bullet under `## 最新验证` in `docs/Documentation.md` covering:

```md
- 2026-06-24：`node tools/bkcli/bkcli.js get-current-screen` 返回 `authcode`，`node tools/bkcli/bkcli.js dump AuthCode_Main --all --depth 8 --limit 800` 确认滑动验证界面关闭按钮路径是 `Main/m_BtnClose`，随后 `node tools/bkcli/bkcli.js click AuthCode_Main Main/m_BtnClose` 成功关闭验证界面，screen 回到 `auction_lobby_room`。
```

- [ ] **Step 3: Run the final targeted verification**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-dismiss-authcode && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/AggregateOperationSemantics.test.cpp -o /tmp/aggregate-operation-semantics-test && /tmp/aggregate-operation-semantics-test"
wsl bash -lc "cd /mnt/a/BidKing/.worktrees/feat-auto-auction-dismiss-authcode && g++ -std=c++11 tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp -o /tmp/meta-operations-test && /tmp/meta-operations-test"
npx vitest run src/elsa/useElsaAutoOperation.test.js
```

Expected:

- both native test executables exit `0`
- `src/elsa/useElsaAutoOperation.test.js` stays green because no renderer contract changed
