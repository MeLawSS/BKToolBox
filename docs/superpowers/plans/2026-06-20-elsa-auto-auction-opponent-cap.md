# Elsa AutoAuction Opponent-Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the round-2-through-5 opponent previous-bid limiter to native `AutoAuction` without changing the IPC surface or renderer flow.

**Architecture:** Keep the orchestration inside `CmdAutoAuction`, but move the pure parsing/cap helpers into a tiny header so they can be unit-tested independently. Expand the shared native surface just enough for `MetaOperations.cpp` to log and enumerate active history-row children, then wire the limiter into the existing bid loop with explicit fallback logging.

**Tech Stack:** C++11 native agent, MinGW cross-build via WSL, assert-style native tests

---

### Task 1: Add Pure Helper Coverage First

**Files:**
- Create: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp`
- Create: `tools/inject/AutoOperation/BKAutoOpAgent/AutoAuctionOpponentCap.h`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`

- [ ] **Step 1: Write the failing test**

```cpp
#include "AutoAuctionOpponentCap.h"

#include <assert.h>

int main() {
    int value = 0;
    assert(TryParseHistoryRoundNumber("第4轮", &value) && value == 4);
    assert(TryParseHistoryRoundNumber("Round 5", &value) && value == 5);
    assert(!TryParseHistoryRoundNumber("--", &value));

    assert(TryParsePriceText("17,986", &value) && value == 17986);
    assert(TryParsePriceText("17，986", &value) && value == 17986);
    assert(!TryParsePriceText("0", &value));

    double multiplier = 0.0;
    assert(TryGetOpponentCapMultiplier(2, &multiplier) && multiplier == 1.65);
    assert(TryGetOpponentCapMultiplier(5, &multiplier) && multiplier == 1.1);
    assert(!TryGetOpponentCapMultiplier(1, &multiplier));

    assert(ComputeOpponentCappedBid(50000, 44444, 1.4) == 50000);
    assert(ComputeOpponentCappedBid(90000, 44444, 1.4) == 62221);
    return 0;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o MetaOperations.test"
```

Expected: compile failure because `AutoAuctionOpponentCap.h` and its helper APIs do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```cpp
#pragma once

#include <string>

inline bool TryParseHistoryRoundNumber(const std::string& text, int* out);
inline bool TryParsePriceText(const std::string& text, int* out);
inline bool TryGetOpponentCapMultiplier(int round, double* out);
inline int ComputeOpponentCappedBid(int originalBid, int opponentPreviousBid, double multiplier);
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o MetaOperations.test && ./MetaOperations.test"
```

Expected: process exits `0`.

- [ ] **Step 5: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/AutoAuctionOpponentCap.h tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp
git commit -m "test: add auto auction opponent cap helper coverage"
```

### Task 2: Export The Minimal Native Surface

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h`
- Test: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp`

- [ ] **Step 1: Write the failing test**

```cpp
// Keep Task 1 green. Add one compile-only use site in MetaOperations.cpp:
// Logf("AutoAuction test hook");
// CollectActiveDirectChildSnapshots(nullptr, nullptr);
```

- [ ] **Step 2: Run build to verify it fails**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/tools/inject/AutoOperation/BKAutoOpAgent && x86_64-w64-mingw32-g++ -shared -o BKAutoOpAgent.buildcheck.dll BKAutoOpAgent.cpp MetaOperations.cpp -lkernel32 -O2 -std=c++11 -static-libgcc -static-libstdc++"
```

Expected: compile failure because `Logf` and `CollectActiveDirectChildSnapshots` are not exported through `MetaOperations.h`.

- [ ] **Step 3: Write minimal implementation**

```cpp
// MetaOperations.h
void Logf(const char* fmt, ...);
bool CollectActiveDirectChildSnapshots(Il2CppObject* parent, std::vector<UiNodeSnapshot>* children);
```

```cpp
// BKAutoOpAgent.cpp
void Logf(const char* fmt, ...);

bool CollectActiveDirectChildSnapshots(Il2CppObject* parent, std::vector<UiNodeSnapshot>* children) {
    // enumerate direct children, inspect snapshots, keep active only
}
```

- [ ] **Step 4: Run build to verify it passes**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/tools/inject/AutoOperation/BKAutoOpAgent && x86_64-w64-mingw32-g++ -shared -o BKAutoOpAgent.buildcheck.dll BKAutoOpAgent.cpp MetaOperations.cpp -lkernel32 -O2 -std=c++11 -static-libgcc -static-libstdc++"
```

Expected: temporary DLL link succeeds even if `BKAutoOpAgent.dll` is locked by a running app/game process.

- [ ] **Step 5: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h
git commit -m "refactor: export auto auction helper surface"
```

### Task 3: Wire The Limiter Into CmdAutoAuction

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp`
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h`
- Test: `tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp`

- [ ] **Step 1: Write the failing test**

```cpp
// Extend MetaOperations.test.cpp with the exact fallback semantics:
assert(!TryResolveOpponentSlot("melo", "", "", nullptr));
assert(!TryResolveOpponentSlot("melo", "melo", "melo", nullptr));
assert(TryResolveOpponentSlot("melo", "melo", "澈澈澈", &value) && value == 2);
```

```cpp
assert(DescribeOpponentCapDecision(3, 50000, 44444, 1.4, 50000).find("round=3") != std::string::npos);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o MetaOperations.test"
```

Expected: compile failure because the new helper behavior is not implemented yet.

- [ ] **Step 3: Write minimal implementation**

```cpp
const char* selfName = JsonGetStringOrDefault(json, "selfName", "melo");
int currentRoundNumber = roundsEncountered;

// read Player_1 / Player_2 nameTxt
// resolve opponent slot
// collect active RoundUnit children
// match row roundTxt == currentRoundNumber - 1
// parse priceTxt, compute min(originalBid, opponentCap)
// Logf(...) with explicit fallback reason when limiter is skipped
```

- [ ] **Step 4: Run tests and build to verify they pass**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/tools/inject/AutoOperation/BKAutoOpAgent && g++ -std=c++11 MetaOperations.test.cpp -o MetaOperations.test && ./MetaOperations.test && g++ -std=c++11 AggregateOperationSemantics.test.cpp -o AggregateOperationSemantics.test && ./AggregateOperationSemantics.test && x86_64-w64-mingw32-g++ -shared -o BKAutoOpAgent.buildcheck.dll BKAutoOpAgent.cpp MetaOperations.cpp -lkernel32 -O2 -std=c++11 -static-libgcc -static-libstdc++"
```

Expected: both test executables exit `0`, then the temporary DLL link succeeds.

- [ ] **Step 5: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.cpp tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.h tools/inject/AutoOperation/BKAutoOpAgent/MetaOperations.test.cpp tools/inject/AutoOperation/BKAutoOpAgent/AutoAuctionOpponentCap.h tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp
git commit -m "feat: cap auto auction bids by opponent history"
```

### Task 4: Runtime Verification And Handoff

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`
- Verify: live game process through `bkcli`

- [ ] **Step 1: Rebuild the final DLL**

Run:

```bash
wsl bash -lc "cd /mnt/a/BidKing/tools/inject/AutoOperation/BKAutoOpAgent && bash build.sh"
```

- [ ] **Step 2: Verify the live command shape stays compatible**

Run:

```bash
node tools/bkcli/bkcli.js exec-probe GetCurrentScreen
node tools/bkcli/bkcli.js exec-probe AutoAuction --useExpectedPrice true
```

Expected: `AutoAuction` still accepts existing callers, with optional `selfName` left unspecified.

- [ ] **Step 3: Inspect native log output for cap/fallback lines**

Run:

```bash
Get-Content "$env:USERPROFILE\\Documents\\BidKing\\BKAutoOpAgent.log" -Tail 50
```

Expected: lines include `round=<n>`, `originalBid=<n>`, and either `finalBid=<n>` with opponent data or `limiter skipped: <reason>`.

- [ ] **Step 4: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
git commit -m "build: refresh BKAutoOpAgent after opponent cap change"
```
