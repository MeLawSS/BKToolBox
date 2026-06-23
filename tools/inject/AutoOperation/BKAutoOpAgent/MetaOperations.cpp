#include "MetaOperations.h"
#include "AggregateOperationSemantics.h"
#include "AutoAuctionOpponentCap.h"
#include "AutoAuctionResponseFormatting.h"
#include "AutoCollectCabinetRewardSchedulerSemantics.h"
#include "AutoCollectCabinetRewardStateFormatting.h"
#include <atomic>

static const uint64_t kAutoCollectCabinetRewardIntervalMs = 10800000ULL;
static std::atomic<int> g_notifiedExpectedPrice{0};
static std::atomic<bool> g_autoAuctionRunning{false};
static std::atomic<bool> g_autoAuctionCancelRequested{false};
static std::atomic<bool> g_autoCollectCabinetRewardEnabled{true};
static std::atomic<bool> g_autoCollectCabinetRewardRunning{false};
static std::atomic<unsigned long long> g_autoCollectCabinetRewardNextDueTick{0ULL};
static std::atomic<unsigned long long> g_autoCollectCabinetRewardControlVersion{1ULL};
static CRITICAL_SECTION g_autoCollectCabinetRewardStateCs;
static volatile LONG g_autoCollectCabinetRewardStateCsInit = 0;
static uint64_t g_autoCollectCabinetRewardLastCheckAtUnixMs = 0;
static std::string g_autoCollectCabinetRewardLastResultCode = "never_run";
static std::string g_autoCollectCabinetRewardLastResultMessage;
static std::string g_autoCollectCabinetRewardLastObservedScreen;

static bool IsAgentShuttingDown() {
    return InterlockedCompareExchange(&g_shuttingDown, 0, 0) != 0;
}

static void EnsureAutoCollectCabinetRewardStateCsInitialized() {
    LONG state = InterlockedCompareExchange(&g_autoCollectCabinetRewardStateCsInit, 0, 0);
    if (state == 2) return;
    if (state == 0 &&
        InterlockedCompareExchange(&g_autoCollectCabinetRewardStateCsInit, 1, 0) == 0) {
        InitializeCriticalSection(&g_autoCollectCabinetRewardStateCs);
        InterlockedExchange(&g_autoCollectCabinetRewardStateCsInit, 2);
        return;
    }
    while (InterlockedCompareExchange(&g_autoCollectCabinetRewardStateCsInit, 0, 0) != 2) {
        Sleep(1);
    }
}

static void UpdateAutoCollectCabinetRewardCycleState(
    uint64_t lastCheckAtUnixMs,
    const char* lastResultCode,
    const char* lastResultMessage,
    const char* lastObservedScreen
) {
    EnsureAutoCollectCabinetRewardStateCsInitialized();
    EnterCriticalSection(&g_autoCollectCabinetRewardStateCs);
    if (lastCheckAtUnixMs != UINT64_MAX) {
        g_autoCollectCabinetRewardLastCheckAtUnixMs = lastCheckAtUnixMs;
    }
    if (lastResultCode) {
        g_autoCollectCabinetRewardLastResultCode = lastResultCode;
    }
    if (lastResultMessage) {
        g_autoCollectCabinetRewardLastResultMessage = lastResultMessage;
    }
    if (lastObservedScreen) {
        g_autoCollectCabinetRewardLastObservedScreen = lastObservedScreen;
    }
    LeaveCriticalSection(&g_autoCollectCabinetRewardStateCs);
}

static void ScheduleNextAutoCollectCabinetRewardCycleFromNow() {
    g_autoCollectCabinetRewardNextDueTick.store(
        ResolveAutoCollectCabinetRewardDueTick(
            true,
            GetTickCount64(),
            kAutoCollectCabinetRewardIntervalMs
        ),
        std::memory_order_relaxed
    );
}

static unsigned long long AdvanceAutoCollectCabinetRewardControlVersion() {
    return g_autoCollectCabinetRewardControlVersion.fetch_add(1ULL, std::memory_order_relaxed) + 1ULL;
}

static void SetAutoCollectCabinetRewardEnabledState(bool enabled) {
    AdvanceAutoCollectCabinetRewardControlVersion();
    g_autoCollectCabinetRewardEnabled.store(enabled, std::memory_order_relaxed);
    g_autoCollectCabinetRewardNextDueTick.store(
        ResolveAutoCollectCabinetRewardDueTick(
            enabled,
            GetTickCount64(),
            kAutoCollectCabinetRewardIntervalMs
        ),
        std::memory_order_relaxed
    );
}

static unsigned long long EnsureAutoCollectCabinetRewardNextDueTickSeeded() {
    const unsigned long long currentDueTick =
        g_autoCollectCabinetRewardNextDueTick.load(std::memory_order_relaxed);
    if (currentDueTick != 0ULL) return currentDueTick;

    const unsigned long long nextDueTick =
        GetTickCount64() + kAutoCollectCabinetRewardIntervalMs;
    unsigned long long expected = 0ULL;
    if (g_autoCollectCabinetRewardNextDueTick.compare_exchange_strong(
            expected,
            nextDueTick,
            std::memory_order_relaxed)) {
        return nextDueTick;
    }
    return expected;
}

static bool SleepForAutoCollectCabinetRewardDelayInterruptibly(int totalMs, int sliceMs = 100) {
    if (totalMs <= 0) return !IsAgentShuttingDown();
    int remaining = totalMs;
    while (remaining > 0) {
        if (IsAgentShuttingDown()) return false;
        const int chunk = remaining < sliceMs ? remaining : sliceMs;
        Sleep((DWORD)chunk);
        remaining -= chunk;
    }
    return !IsAgentShuttingDown();
}

struct ScopedAutoCollectCabinetRewardRunGuard {
    explicit ScopedAutoCollectCabinetRewardRunGuard(std::atomic<bool>* runningFlag)
        : flag(runningFlag), acquired(false) {
        bool expected = false;
        acquired = flag &&
            flag->compare_exchange_strong(expected, true, std::memory_order_relaxed);
    }

    ~ScopedAutoCollectCabinetRewardRunGuard() {
        if (acquired && flag) {
            flag->store(false, std::memory_order_relaxed);
        }
    }

    bool IsAcquired() const { return acquired; }

    std::atomic<bool>* flag;
    bool acquired;
};

static bool IsAutoAuctionStopRequested() {
    return ShouldAbortAutoAuction(
        g_autoAuctionCancelRequested.load(std::memory_order_relaxed),
        IsAgentShuttingDown()
    );
}

static bool SleepInterruptibly(int totalMs, int sliceMs = 50) {
    if (totalMs <= 0) return !IsAutoAuctionStopRequested();
    int remaining = totalMs;
    while (remaining > 0) {
        if (IsAutoAuctionStopRequested()) return false;
        const int chunk = remaining < sliceMs ? remaining : sliceMs;
        Sleep((DWORD)chunk);
        remaining -= chunk;
    }
    return !IsAutoAuctionStopRequested();
}

// ==========================================================================
// Internal helpers
// ==========================================================================

static bool GetBattleMainPanel(AgentConn* c, const char* id, Il2CppObject** out);
static bool ExecuteCollectCabinetRewardFlow(
    const char* sourceTag,
    std::string* errorMessage,
    const unsigned long long* expectedControlVersion = nullptr
);

// ==========================================================================
// Meta-operations
// ==========================================================================

// GoToBattlePrev: if the current main UI is UIMain, click the 竞拍 entry button.
// Returns {"clicked":true,"panel":"UIMain"} on success,
//         {"clicked":false,"reason":"not on main UI","current":"<name>"} when on a different UI.
void CmdGoToBattlePrev(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    Il2CppClass* uiBhvrCls = FindClass("UIBehavior");
    if (!uiBhvrCls) { SendResponse(c, id, false, "UIBehavior not found"); return; }
    const Il2CppMethod* getCurM = g_class_get_method_from_name(uiBhvrCls, "GetCurShowMainUI", 0);
    if (!getCurM) { SendResponse(c, id, false, "GetCurShowMainUI not found"); return; }

    Il2CppObject* curUI = (Il2CppObject*)SafeInvoke(getCurM, nullptr, nullptr);
    const char* curName = ObjClassName(curUI);

    if (strcmp(curName, "UIMain") != 0) {
        char result[256];
        snprintf(result, sizeof(result),
                 "{\"clicked\":false,\"reason\":\"not on main UI\",\"current\":\"%s\"}",
                 curName);
        SendResponse(c, id, true, result);
        return;
    }

    // GetCurShowMainUI returns "UIMain" even while BattlePrevPanel_Main is overlaid.
    // Check the visible panel list to confirm the auction hall is not already open.
    {
        Il2CppObject* bpTransform = nullptr;
        char bpErr[128] = {};
        UiPanelLookupResult bpResult = FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &bpTransform, bpErr, sizeof(bpErr));
        if (bpResult == UI_PANEL_FOUND) {
            SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"already in BattlePrevPanel_Main\"}");
            return;
        }
        if (bpResult == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, bpErr); return; }
    }

    Il2CppObject* panelTransform = nullptr;
    char error[128] = {};
    UiPanelLookupResult panelResult = FindVisiblePanelTransform("UIMain", nullptr, &panelTransform, error, sizeof(error));
    if (panelResult == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, error); return; }
    if (panelResult != UI_PANEL_FOUND) { SendResponse(c, id, false, "UIMain panel not visible"); return; }

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(panelTransform, "MainPanel/mask/Button", UI_PATH_EXACT, 2, &matches);
    if (matches.empty()) { SendResponse(c, id, false, "battle button not found"); return; }

    UiNodeSnapshot& node = matches[0];
    if (!node.active) { SendResponse(c, id, false, "battle button inactive"); return; }
    if (!node.components.button) { SendResponse(c, id, false, "battle button: no Button component"); return; }

    if (!PerformButtonClick(node.components.button)) {
        SendResponse(c, id, false, "click failed");
        return;
    }

    SendResponse(c, id, true, "{\"clicked\":true,\"panel\":\"UIMain\"}");
}

// EnterRoom: if BattlePrevPanel_Main is open in map view, click the specified room.
// Param: {"roomId": <int>}
//   Valid roomId values (101=快递盲盒堆 102=废弃仓库 103=航运集装箱 104=空置别墅
//                        105=沉船密封仓 106=隐秘拍卖会 304=幽静别墅 305=深海沉船)
// Returns {"clicked":true,"room":<id>} on success,
//         {"clicked":false,"reason":"..."} as no-op when preconditions unmet.
// Entering a room stays within BattlePrevPanel_Main (no scene transition).
// The later StartAction transition is handled as a separate command boundary.
void CmdEnterRoom(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    int roomId = JsonGetInt(json, "roomId");
    if (roomId == INT_MIN) { SendResponse(c, id, false, "missing roomId"); return; }

    static const int kValidRoomIds[] = {101, 102, 103, 104, 105, 106, 304, 305, 0};
    bool valid = false;
    for (int i = 0; kValidRoomIds[i]; i++) {
        if (kValidRoomIds[i] == roomId) { valid = true; break; }
    }
    if (!valid) {
        SendResponse(c, id, false, "invalid roomId: must be one of 101,102,103,104,105,106,304,305");
        return;
    }

    Il2CppObject* panelTransform = nullptr;
    char error[128] = {};
    UiPanelLookupResult panelResult = FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &panelTransform, error, sizeof(error));
    if (panelResult == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, error); return; }
    if (panelResult != UI_PANEL_FOUND) {
        SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"BattlePrevPanel_Main not visible\"}");
        return;
    }

    char nodePath[128];
    snprintf(nodePath, sizeof(nodePath), "Panel_1/bg/MapContainer/MapItem_%d/Image (1)", roomId);

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(panelTransform, nodePath, UI_PATH_EXACT, 2, &matches);
    if (matches.empty()) {
        char reason[256];
        snprintf(reason, sizeof(reason),
                 "{\"clicked\":false,\"reason\":\"MapItem_%d not found — not in map view or room unavailable\"}",
                 roomId);
        SendResponse(c, id, true, reason);
        return;
    }

    UiNodeSnapshot& node = matches[0];
    if (!node.active) {
        char reason[128];
        snprintf(reason, sizeof(reason), "{\"clicked\":false,\"reason\":\"MapItem_%d inactive\"}", roomId);
        SendResponse(c, id, true, reason);
        return;
    }
    if (!node.components.button) { SendResponse(c, id, false, "no Button component"); return; }

    if (!PerformButtonClick(node.components.button)) {
        SendResponse(c, id, false, "click failed");
        return;
    }

    char result[64];
    snprintf(result, sizeof(result), "{\"clicked\":true,\"room\":%d}", roomId);
    SendResponse(c, id, true, result);
}

// OpenSkillConfig: click the 配置技能 button inside a BattlePrevPanel_Main room detail view.
// Precondition: BattlePrevPanel_Main must be visible AND in room detail view
//               (Panel_1/MapPanel/battleSet/Hero/Button must exist).
// Returns {"clicked":true} on success,
//         {"clicked":false,"reason":"..."} as no-op when not in room detail view.
void CmdOpenSkillConfig(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    Il2CppObject* panelTransform = nullptr;
    char error[128] = {};
    UiPanelLookupResult panelResult = FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &panelTransform, error, sizeof(error));
    if (panelResult == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, error); return; }
    if (panelResult != UI_PANEL_FOUND) {
        SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"BattlePrevPanel_Main not visible\"}");
        return;
    }

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(panelTransform, "Panel_1/MapPanel/battleSet/Hero/Button", UI_PATH_EXACT, 2, &matches);
    if (matches.empty()) {
        SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"skill config button not found — not in room detail view\"}");
        return;
    }

    UiNodeSnapshot& node = matches[0];
    if (!node.active) { SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"skill config button inactive\"}"); return; }
    if (!node.components.button) { SendResponse(c, id, false, "skill config button: no Button component"); return; }

    if (!PerformButtonClick(node.components.button)) {
        SendResponse(c, id, false, "click failed");
        return;
    }

    SendResponse(c, id, true, "{\"clicked\":true}");
}

// SelectRole: click 艾莎's entry in the HeroChoose character list.
// herochooseItem_103 = 艾莎 (confirmed from heroname text node).
// The HeroChoose list is always present in room detail view; no prerequisite click needed.
// Precondition: BattlePrevPanel_Main visible and in room detail view.
// Returns {"clicked":true,"selected":"艾莎"} on success,
//         {"clicked":false,"reason":"..."} as no-op when preconditions unmet.
void CmdSelectRole(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    Il2CppObject* panelTransform = nullptr;
    char error[128] = {};
    UiPanelLookupResult panelResult = FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &panelTransform, error, sizeof(error));
    if (panelResult == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, error); return; }
    if (panelResult != UI_PANEL_FOUND) {
        SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"BattlePrevPanel_Main not visible\"}");
        return;
    }

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(panelTransform,
        "Panel_1/MapPanel/battleSet/HeroChoose/ScrollView/Viewport/Content/herochooseItem_103/button",
        UI_PATH_EXACT, 2, &matches);
    if (matches.empty()) {
        SendResponse(c, id, true, u8"{\"clicked\":false,\"reason\":\"艾莎 not found — not in room detail view\"}");
        return;
    }

    UiNodeSnapshot& node = matches[0];
    if (!node.active) { SendResponse(c, id, true, u8"{\"clicked\":false,\"reason\":\"艾莎 button inactive\"}"); return; }
    if (!node.components.button) { SendResponse(c, id, false, u8"艾莎 button: no Button component"); return; }

    if (!PerformButtonClick(node.components.button)) {
        SendResponse(c, id, false, "click failed");
        return;
    }

    SendResponse(c, id, true, u8"{\"clicked\":true,\"selected\":\"艾莎\"}");
}

// StartAction: click the 开始行动 button in room detail view.
// Precondition: BattlePrevPanel_Main visible and in room detail view (MapPanel active).
// Returns {"clicked":true} once the command passes precondition validation and
// has been accepted for best-effort execution.
// This response is sent before the actual click because the ensuing scene
// transition can sever the transport before a post-click reply is written.
// Precondition failures still return {"clicked":false,"reason":"..."}.
void CmdStartAction(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    Il2CppObject* panelTransform = nullptr;
    char error[128] = {};
    UiPanelLookupResult panelResult = FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &panelTransform, error, sizeof(error));
    if (panelResult == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, error); return; }
    if (panelResult != UI_PANEL_FOUND) {
        SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"BattlePrevPanel_Main not visible\"}");
        return;
    }

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(panelTransform, "Panel_1/MapPanel/Button", UI_PATH_EXACT, 2, &matches);
    if (matches.empty()) {
        SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"start action button not found — not in room detail view\"}");
        return;
    }

    UiNodeSnapshot& node = matches[0];
    if (!node.active) { SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"start action button inactive\"}"); return; }
    if (!node.components.button) { SendResponse(c, id, false, "start action button: no Button component"); return; }

    SendResponse(c, id, true, "{\"clicked\":true}");
    if (!PerformButtonClick(node.components.button)) {
        return;
    }
}

// GetBidState: read current round and remaining time from Battle_Main.
// Precondition: Battle_Main must be visible (in-game auction screen).
// Returns {"round":"<text>","timeRemaining":"<text>"} on success,
//         {"clicked":false,"reason":"..."} as no-op when preconditions unmet.
void CmdGetBidState(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    Il2CppObject* panelTransform = nullptr;
    if (!GetBattleMainPanel(c, id, &panelTransform)) return;

    std::string round, timeRemaining;

    {
        std::vector<UiNodeSnapshot> m;
        ResolveUiNodeMatches(panelTransform, "Gaming/Center/RoundBg/roundTxt", UI_PATH_EXACT, 2, &m);
        if (!m.empty()) ReadNodeTextValue(m[0].components, &round);
    }
    {
        std::vector<UiNodeSnapshot> m;
        ResolveUiNodeMatches(panelTransform, "Gaming/remainBg/remainTxt", UI_PATH_EXACT, 2, &m);
        if (!m.empty()) ReadNodeTextValue(m[0].components, &timeRemaining);
    }

    std::string result = "{\"round\":\"";
    result += round;
    result += "\",\"timeRemaining\":\"";
    result += timeRemaining;
    result += "\"}";
    SendResponse(c, id, true, result.c_str());
}

// Helper: look up Battle_Main panel; on failure sends error and returns false.
static bool GetBattleMainPanel(AgentConn* c, const char* id, Il2CppObject** out) {
    char error[128] = {};
    UiPanelLookupResult r = FindVisiblePanelTransform("Battle_Main", nullptr, out, error, sizeof(error));
    if (r == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, error); return false; }
    if (r != UI_PANEL_FOUND) { SendResponse(c, id, true, "{\"ok\":false,\"reason\":\"Battle_Main not visible\"}"); return false; }
    return true;
}

// PlaceBid: click the 出价 (chujia) button in Battle_Main to place the current bid.
// Precondition: Battle_Main must be visible and the chujia button active.
// Returns {"clicked":true} on success, {"clicked":false,"reason":"..."} otherwise.
void CmdPlaceBid(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    Il2CppObject* panelTransform = nullptr;
    if (!GetBattleMainPanel(c, id, &panelTransform)) return;

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(panelTransform, "Gaming/chujia", UI_PATH_EXACT, 2, &matches);
    if (matches.empty()) {
        SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"chujia button not found\"}");
        return;
    }

    UiNodeSnapshot& node = matches[0];
    if (!node.active) { SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"chujia button inactive\"}"); return; }
    if (!node.components.button) { SendResponse(c, id, false, "chujia button: no Button component"); return; }

    if (!PerformButtonClick(node.components.button)) {
        SendResponse(c, id, false, "click failed");
        return;
    }

    SendResponse(c, id, true, "{\"clicked\":true}");
}

// SetBidAmount: set the price in the bid input dialog (InputDevice/Panel1/InputField (TMP)).
// Must be called after PlaceBid has opened the InputDevice dialog.
// Param: {"amount": <int>}  — the bid price as a non-negative integer.
// Returns {"set":true,"amount":<n>} on success, {"set":false,"reason":"..."} otherwise.
void CmdSetBidAmount(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    int amount = JsonGetInt(json, "amount");
    if (amount == INT_MIN) { SendResponse(c, id, false, "missing amount"); return; }
    if (amount < 0) { SendResponse(c, id, false, "amount must be non-negative"); return; }

    Il2CppObject* panelTransform = nullptr;
    if (!GetBattleMainPanel(c, id, &panelTransform)) return;

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(panelTransform, "InputDevice/Panel1/InputField (TMP)", UI_PATH_EXACT, 2, &matches);
    if (matches.empty()) {
        SendResponse(c, id, true, "{\"set\":false,\"reason\":\"InputField not found — bid dialog not open\"}");
        return;
    }

    UiNodeSnapshot& node = matches[0];
    if (!node.active) { SendResponse(c, id, true, "{\"set\":false,\"reason\":\"InputField inactive\"}"); return; }
    if (!node.components.tmpInput && !node.components.numericInput) {
        SendResponse(c, id, false, "InputField: no input component");
        return;
    }

    char amountStr[32];
    snprintf(amountStr, sizeof(amountStr), "%d", amount);

    std::string componentName;
    if (!PerformSetInputText(node, amountStr, false, &componentName)) {
        SendResponse(c, id, false, "set text failed");
        return;
    }

    char result[64];
    snprintf(result, sizeof(result), "{\"set\":true,\"amount\":%d}", amount);
    SendResponse(c, id, true, result);
}

// --------------------------------------------------------------------------
// Screen detection helper (shared by GetCurrentScreen + CloseCurrentOverlay)
// --------------------------------------------------------------------------

struct ScreenState {
    const char*   screen;
    Il2CppObject* battleMainTransform;
    Il2CppObject* battlePrevTransform;
    Il2CppObject* collectAwardTransform;
    Il2CppObject* rewardsBoxTransform;
    Il2CppObject* mailMainTransform;
    Il2CppObject* tradingPanelTransform;
    Il2CppObject* battlePassTransform;
    Il2CppObject* uiMainTransform;
};

static ScreenState DetectScreenState() {
    ScreenState s = {};
    s.screen = "unknown";
    char err[128] = {};

    bool hasBattleMain   = FindVisiblePanelTransform("Battle_Main",          nullptr, &s.battleMainTransform,    err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasBattlePrev   = FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &s.battlePrevTransform,    err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasCollectAward = FindVisiblePanelTransform("CollectAward_Main",    nullptr, &s.collectAwardTransform,  err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasRewardsBox   = FindVisiblePanelTransform("RewardsBox",           nullptr, &s.rewardsBoxTransform,    err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasMailMain     = FindVisiblePanelTransform("Mail_Main",            nullptr, &s.mailMainTransform,      err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasTradingPanel = FindVisiblePanelTransform("TradingPanel",         nullptr, &s.tradingPanelTransform,  err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasBattlePass   = FindVisiblePanelTransform("BattlePass_Main",      nullptr, &s.battlePassTransform,    err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasAuthCode     = FindVisiblePanelTransform("AuthCode_Main",        nullptr, nullptr,                   err, sizeof(err)) == UI_PANEL_FOUND;
                           FindVisiblePanelTransform("UIMain",               nullptr, &s.uiMainTransform,        err, sizeof(err));

    if (hasAuthCode) {
        s.screen = "authcode";
    } else if (hasBattleMain && s.battleMainTransform) {
        std::vector<UiNodeSnapshot> endM, gamingM;
        ResolveUiNodeMatches(s.battleMainTransform, "EndPanel", UI_PATH_EXACT, 1, &endM);
        ResolveUiNodeMatches(s.battleMainTransform, "Gaming",   UI_PATH_EXACT, 1, &gamingM);
        s.screen = (!endM.empty() && endM[0].active) ? "auction_ended" : "auction_in_progress";
    } else if (hasBattlePrev && s.battlePrevTransform) {
        std::vector<UiNodeSnapshot> mapM;
        ResolveUiNodeMatches(s.battlePrevTransform, "Panel_1/MapPanel", UI_PATH_EXACT, 1, &mapM);
        s.screen = (!mapM.empty() && mapM[0].active) ? "auction_lobby_room" : "auction_lobby_map";
    } else if (hasCollectAward) {
        s.screen = hasRewardsBox ? "cabinet_reward_popup" : "cabinet_reward_list";
    } else if (hasMailMain) {
        s.screen = "mailbox";
    } else if (hasTradingPanel) {
        s.screen = "exchange";
    } else if (hasBattlePass) {
        s.screen = "battlepass";
    } else if (s.uiMainTransform) {
        std::vector<UiNodeSnapshot> mainM;
        ResolveUiNodeMatches(s.uiMainTransform, "MainPanel", UI_PATH_EXACT, 1, &mainM);
        s.screen = (!mainM.empty() && mainM[0].active) ? "main_lobby" : "warehouse";
    }

    return s;
}

// --------------------------------------------------------------------------
// GetCurrentScreen / CloseCurrentOverlay / aggregate helpers
// --------------------------------------------------------------------------

// Map current screen → (panelTransform, clickPath) for closing.
// Returns false if there is nothing to close (main_lobby, auction_in_progress, unknown).
static bool ResolveCloseTarget(const ScreenState& s,
                                Il2CppObject** transformOut,
                                const char**   pathOut) {
    if (strcmp(s.screen, "auction_ended") == 0 && s.battleMainTransform) {
        *transformOut = s.battleMainTransform; *pathOut = "EndPanel/bg";
    } else if ((strcmp(s.screen, "auction_lobby_map") == 0 || strcmp(s.screen, "auction_lobby_room") == 0) && s.battlePrevTransform) {
        *transformOut = s.battlePrevTransform; *pathOut = "Top/Close";
    } else if (strcmp(s.screen, "cabinet_reward_popup") == 0 && s.rewardsBoxTransform) {
        *transformOut = s.rewardsBoxTransform; *pathOut = "bg";
    } else if (strcmp(s.screen, "cabinet_reward_list") == 0 && s.collectAwardTransform) {
        *transformOut = s.collectAwardTransform; *pathOut = "bg";
    } else if (strcmp(s.screen, "mailbox") == 0 && s.mailMainTransform) {
        *transformOut = s.mailMainTransform; *pathOut = "Top/Close";
    } else if (strcmp(s.screen, "exchange") == 0 && s.tradingPanelTransform) {
        *transformOut = s.tradingPanelTransform; *pathOut = "Top/Close";
    } else if (strcmp(s.screen, "battlepass") == 0 && s.battlePassTransform) {
        *transformOut = s.battlePassTransform; *pathOut = "Top/Close";
    } else if (strcmp(s.screen, "warehouse") == 0 && s.uiMainTransform) {
        *transformOut = s.uiMainTransform; *pathOut = "WareHousePanel/Top/Close";
    } else {
        return false;
    }
    return true;
}

// Click a node by path on an anchor transform; Sleep(delayMs) after success.
static bool ClickNode(Il2CppObject* anchor, const char* path,
                      int delayMs, std::string* errOut) {
    std::vector<UiNodeSnapshot> m;
    ResolveUiNodeMatches(anchor, path, UI_PATH_EXACT, 1, &m);
    if (m.empty() || !m[0].active) {
        if (errOut) *errOut = std::string("node not ready: ") + path;
        return false;
    }
    const UiClickComponentKind clickKind = ResolveUiClickComponentKind(
        m[0].components.button != nullptr,
        m[0].components.toggle != nullptr
    );
    bool clicked = false;
    if (clickKind == UI_CLICK_COMPONENT_BUTTON) {
        clicked = PerformButtonClick(m[0].components.button);
    } else if (clickKind == UI_CLICK_COMPONENT_TOGGLE) {
        clicked = PerformToggleClick(m[0].components.toggle);
    } else {
        if (errOut) *errOut = std::string("node not clickable: ") + path;
        return false;
    }
    if (!clicked) {
        if (errOut) *errOut = std::string("click failed: ") + path;
        return false;
    }
    if (delayMs > 0) Sleep(delayMs);
    return true;
}

static bool IsButtonNodeReady(Il2CppObject* anchor, const char* path) {
    std::vector<UiNodeSnapshot> m;
    ResolveUiNodeMatches(anchor, path, UI_PATH_EXACT, 1, &m);
    return !m.empty() && m[0].active && m[0].components.button;
}

// ==========================================================================
// AutoAuction polling types and helpers — replace fixed SleepInterruptibly
// with state-driven polling. Every cycle checks stop and authcode.
// ==========================================================================

enum PollResult {
    POLL_OK = 0,
    POLL_TIMEOUT = 1,
    POLL_AUTHCODE = 2,
    POLL_INTERRUPTED = 3
};

struct PollWaitResult {
    PollResult result;
    int waitedMs;
};

// ==========================================================================

// Poll until DetectScreenState().screen matches targetScreen.
// Returns POLL_AUTHCODE if an authcode screen is detected mid-poll.
static PollWaitResult WaitForScreen(
    const char* targetScreen,
    int timeoutMs,
    int pollIntervalMs)
{
    DWORD startedAt = GetTickCount();
    for (;;) {
        if (IsAutoAuctionStopRequested()) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
        ScreenState state = DetectScreenState();
        if (IsAutoAuctionVerificationScreen(state.screen)) {
            PollWaitResult r = { POLL_AUTHCODE, (int)(GetTickCount() - startedAt) };
            return r;
        }
        if (strcmp(state.screen, targetScreen) == 0) {
            PollWaitResult r = { POLL_OK, (int)(GetTickCount() - startedAt) };
            return r;
        }
        DWORD elapsed = GetTickCount() - startedAt;
        if ((int)elapsed >= timeoutMs) {
            PollWaitResult r = { POLL_TIMEOUT, (int)(GetTickCount() - startedAt) };
            return r;
        }
        if (!SleepInterruptibly(pollIntervalMs)) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
    }
}

// Poll until the current screen is NOT equal to leavingScreen.
// Used after clicking a close/transition button to confirm the transition started.
static PollWaitResult WaitForScreenTransition(
    const char* leavingScreen,
    int timeoutMs,
    int pollIntervalMs)
{
    DWORD startedAt = GetTickCount();
    for (;;) {
        if (IsAutoAuctionStopRequested()) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
        ScreenState state = DetectScreenState();
        if (IsAutoAuctionVerificationScreen(state.screen)) {
            PollWaitResult r = { POLL_AUTHCODE, (int)(GetTickCount() - startedAt) };
            return r;
        }
        if (strcmp(state.screen, leavingScreen) != 0) {
            PollWaitResult r = { POLL_OK, (int)(GetTickCount() - startedAt) };
            return r;
        }
        DWORD elapsed = GetTickCount() - startedAt;
        if ((int)elapsed >= timeoutMs) {
            PollWaitResult r = { POLL_TIMEOUT, (int)(GetTickCount() - startedAt) };
            return r;
        }
        if (!SleepInterruptibly(pollIntervalMs)) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
    }
}

// Poll until a node under the given panel reaches active+interactive state.
// panelName and nodePath follow the same conventions as clickOnPanel.
static PollWaitResult WaitForNodeReady(
    const char* panelName,
    const char* nodePath,
    int timeoutMs,
    int pollIntervalMs)
{
    DWORD startedAt = GetTickCount();
    for (;;) {
        if (IsAutoAuctionStopRequested()) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
        // authcode check via screen detection
        ScreenState state = DetectScreenState();
        if (IsAutoAuctionVerificationScreen(state.screen)) {
            PollWaitResult r = { POLL_AUTHCODE, (int)(GetTickCount() - startedAt) };
            return r;
        }

        char err[128] = {};
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform(panelName, nullptr, &t, err, sizeof(err)) == UI_PANEL_FOUND && t) {
            std::vector<UiNodeSnapshot> matches;
            ResolveUiNodeMatches(t, nodePath, UI_PATH_EXACT, 1, &matches);
            if (!matches.empty() && matches[0].active && matches[0].interactive) {
                PollWaitResult r = { POLL_OK, (int)(GetTickCount() - startedAt) };
                return r;
            }
        }
        DWORD elapsed = GetTickCount() - startedAt;
        if ((int)elapsed >= timeoutMs) {
            PollWaitResult r = { POLL_TIMEOUT, (int)(GetTickCount() - startedAt) };
            return r;
        }
        if (!SleepInterruptibly(pollIntervalMs)) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
    }
}

// Poll until a toggle reaches the expected on/off state.
// transform: the root transform to resolve nodePath against.
static PollWaitResult WaitForToggleState(
    Il2CppObject* transform,
    const char* nodePath,
    bool expectedOn,
    int timeoutMs,
    int pollIntervalMs)
{
    DWORD startedAt = GetTickCount();
    for (;;) {
        if (IsAutoAuctionStopRequested()) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
        // authcode check
        ScreenState state = DetectScreenState();
        if (IsAutoAuctionVerificationScreen(state.screen)) {
            PollWaitResult r = { POLL_AUTHCODE, (int)(GetTickCount() - startedAt) };
            return r;
        }

        std::vector<UiNodeSnapshot> matches;
        ResolveUiNodeMatches(transform, nodePath, UI_PATH_EXACT, 1, &matches);
        if (!matches.empty()) {
            bool toggleOn = false;
            if (ReadToggleValue(matches[0].components, &toggleOn) && toggleOn == expectedOn) {
                PollWaitResult r = { POLL_OK, (int)(GetTickCount() - startedAt) };
                return r;
            }
        }
        DWORD elapsed = GetTickCount() - startedAt;
        if ((int)elapsed >= timeoutMs) {
            PollWaitResult r = { POLL_TIMEOUT, (int)(GetTickCount() - startedAt) };
            return r;
        }
        if (!SleepInterruptibly(pollIntervalMs)) {
            PollWaitResult r = { POLL_INTERRUPTED, (int)(GetTickCount() - startedAt) };
            return r;
        }
    }
}

struct BidConfirmFlowResult {
    bool completed = false;
    bool hardError = false;
    bool interrupted = false;
    bool secondaryConfirmRequired = false;
    bool secondaryConfirmClicked = false;
    bool bidDialogClosed = false;
    bool secondaryDialogClosed = false;
    std::string reason;
};

static bool HasActiveBidInputDialog(Il2CppObject* battleMainTransform) {
    if (!battleMainTransform) return false;

    std::vector<UiNodeSnapshot> inputMatches;
    ResolveUiNodeMatches(
        battleMainTransform,
        "InputDevice/Panel1/InputField (TMP)",
        UI_PATH_EXACT,
        1,
        &inputMatches
    );
    if (!inputMatches.empty() && inputMatches[0].active) return true;

    std::vector<UiNodeSnapshot> confirmMatches;
    ResolveUiNodeMatches(
        battleMainTransform,
        "InputDevice/Panel1/chujia",
        UI_PATH_EXACT,
        1,
        &confirmMatches
    );
    return !confirmMatches.empty() && confirmMatches[0].active;
}

static BidConfirmFlowResult WaitForBidConfirmationSettled(Il2CppObject* battleMainTransform) {
    static const int kObserveSecondaryConfirmMs = 1500;
    static const int kConfirmSettleTimeoutMs = 3000;
    static const int kPollMs = 100;

    BidConfirmFlowResult result;
    if (!battleMainTransform) {
        result.hardError = true;
        result.reason = "Battle_Main not visible after confirm click";
        return result;
    }

    for (int waitedMs = 0; waitedMs <= kConfirmSettleTimeoutMs; waitedMs += kPollMs) {
        bool messageBoxVisible = false;

        char msgBoxError[128] = {};
        Il2CppObject* msgBoxTransform = nullptr;
        UiPanelLookupResult msgBoxResult = FindVisiblePanelTransform(
            "MessageBox",
            nullptr,
            &msgBoxTransform,
            msgBoxError,
            sizeof(msgBoxError)
        );
        if (msgBoxResult == UI_PANEL_LOOKUP_ERROR) {
            result.hardError = true;
            result.reason = msgBoxError;
            return result;
        }
        if (msgBoxResult == UI_PANEL_FOUND) {
            messageBoxVisible = true;
            result.secondaryConfirmRequired = true;

            if (!result.secondaryConfirmClicked) {
                std::vector<UiNodeSnapshot> msgBoxMatches;
                ResolveUiNodeMatches(
                    msgBoxTransform,
                    "Panel/Bottom/Confirm",
                    UI_PATH_EXACT,
                    1,
                    &msgBoxMatches
                );
                if (!msgBoxMatches.empty()) {
                    UiNodeSnapshot& confirmNode = msgBoxMatches[0];
                    if (confirmNode.active && confirmNode.components.button) {
                        if (!PerformButtonClick(confirmNode.components.button)) {
                            result.hardError = true;
                            result.reason = "secondary confirm click failed";
                            return result;
                        }
                        result.secondaryConfirmClicked = true;
                    }
                }
            }
        }

        result.bidDialogClosed = !HasActiveBidInputDialog(battleMainTransform);
        result.secondaryDialogClosed =
            !result.secondaryConfirmRequired || !messageBoxVisible;

        if (result.secondaryConfirmRequired) {
            if (DidCompleteBidConfirmation(
                    true,
                    true,
                    result.secondaryConfirmClicked,
                    result.bidDialogClosed) &&
                result.secondaryDialogClosed) {
                result.completed = true;
                return result;
            }
        } else if (waitedMs >= kObserveSecondaryConfirmMs &&
                   DidCompleteBidConfirmation(true, false, false, result.bidDialogClosed)) {
            result.completed = true;
            return result;
        }

        if (waitedMs >= kConfirmSettleTimeoutMs) break;
        if (!SleepInterruptibly(kPollMs)) {
            result.interrupted = true;
            result.reason = "interrupted";
            return result;
        }
    }

    if (result.secondaryConfirmRequired && !result.secondaryConfirmClicked) {
        result.reason = "secondary confirm not completed";
    } else if (result.secondaryConfirmRequired && !result.secondaryDialogClosed) {
        result.reason = "secondary confirm dialog did not close";
    } else if (!result.bidDialogClosed) {
        result.reason = "confirm bid dialog did not close";
    } else {
        result.reason = "confirm bid did not settle";
    }
    return result;
}

// Authcode-aware wrapper: same confirmation logic as WaitForBidConfirmationSettled
// but injects DetectScreenState + authcode check at every poll cycle so the
// confirmation stage is never an authcode blind spot.
// Returns an extra field: authcodeDetected.
struct AuthCodeAwareBidConfirmResult {
    BidConfirmFlowResult confirm;
    bool authcodeDetected = false;
};

static AuthCodeAwareBidConfirmResult WaitForBidConfirmationSettledWithAuthCode(
    Il2CppObject* battleMainTransform)
{
    static const int kObserveSecondaryConfirmMs = 1500;
    static const int kConfirmSettleTimeoutMs = 3000;
    static const int kPollMs = 100;

    AuthCodeAwareBidConfirmResult wrapper;
    BidConfirmFlowResult& result = wrapper.confirm;

    if (!battleMainTransform) {
        result.hardError = true;
        result.reason = "Battle_Main not visible after confirm click";
        return wrapper;
    }

    for (int waitedMs = 0; waitedMs <= kConfirmSettleTimeoutMs; waitedMs += kPollMs) {
        // --- authcode check every cycle ---
        {
            ScreenState sc = DetectScreenState();
            if (IsAutoAuctionVerificationScreen(sc.screen)) {
                wrapper.authcodeDetected = true;
                return wrapper;
            }
        }

        bool messageBoxVisible = false;

        char msgBoxError[128] = {};
        Il2CppObject* msgBoxTransform = nullptr;
        UiPanelLookupResult msgBoxResult = FindVisiblePanelTransform(
            "MessageBox",
            nullptr,
            &msgBoxTransform,
            msgBoxError,
            sizeof(msgBoxError)
        );
        if (msgBoxResult == UI_PANEL_LOOKUP_ERROR) {
            result.hardError = true;
            result.reason = msgBoxError;
            return wrapper;
        }
        if (msgBoxResult == UI_PANEL_FOUND) {
            messageBoxVisible = true;
            result.secondaryConfirmRequired = true;

            if (!result.secondaryConfirmClicked) {
                std::vector<UiNodeSnapshot> msgBoxMatches;
                ResolveUiNodeMatches(
                    msgBoxTransform,
                    "Panel/Bottom/Confirm",
                    UI_PATH_EXACT,
                    1,
                    &msgBoxMatches
                );
                if (!msgBoxMatches.empty()) {
                    UiNodeSnapshot& confirmNode = msgBoxMatches[0];
                    if (confirmNode.active && confirmNode.components.button) {
                        if (!PerformButtonClick(confirmNode.components.button)) {
                            result.hardError = true;
                            result.reason = "secondary confirm click failed";
                            return wrapper;
                        }
                        result.secondaryConfirmClicked = true;
                    }
                }
            }
        }

        result.bidDialogClosed = !HasActiveBidInputDialog(battleMainTransform);
        result.secondaryDialogClosed =
            !result.secondaryConfirmRequired || !messageBoxVisible;

        if (result.secondaryConfirmRequired) {
            if (DidCompleteBidConfirmation(
                    true,
                    true,
                    result.secondaryConfirmClicked,
                    result.bidDialogClosed) &&
                result.secondaryDialogClosed) {
                result.completed = true;
                return wrapper;
            }
        } else if (waitedMs >= kObserveSecondaryConfirmMs &&
                   DidCompleteBidConfirmation(true, false, false, result.bidDialogClosed)) {
            result.completed = true;
            return wrapper;
        }

        if (waitedMs >= kConfirmSettleTimeoutMs) break;
        if (!SleepInterruptibly(kPollMs)) {
            result.interrupted = true;
            result.reason = "interrupted";
            return wrapper;
        }
    }

    if (result.secondaryConfirmRequired && !result.secondaryConfirmClicked) {
        result.reason = "secondary confirm not completed";
    } else if (result.secondaryConfirmRequired && !result.secondaryDialogClosed) {
        result.reason = "secondary confirm dialog did not close";
    } else if (!result.bidDialogClosed) {
        result.reason = "confirm bid dialog did not close";
    } else {
        result.reason = "confirm bid did not settle";
    }
    return wrapper;
}

// GetCurrentScreen: determine which UI screen is currently shown.
// Returns {"screen":"<name>"} — see DetectScreenState for values.
void CmdGetCurrentScreen(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    ScreenState s = DetectScreenState();
    char result[64];
    snprintf(result, sizeof(result), "{\"screen\":\"%s\"}", s.screen);
    SendResponse(c, id, true, result);
}

// CloseCurrentOverlay: close whatever overlay is currently open.
// Returns {"clicked":true,"screen":"<name>"} or {"clicked":false,"reason":"..."}
void CmdCloseCurrentOverlay(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    ScreenState s = DetectScreenState();
    Il2CppObject* targetTransform = nullptr;
    const char*   clickPath       = nullptr;

    if (!ResolveCloseTarget(s, &targetTransform, &clickPath)) {
        char result[128];
        snprintf(result, sizeof(result), "{\"clicked\":false,\"screen\":\"%s\",\"reason\":\"no closeable overlay\"}", s.screen);
        SendResponse(c, id, true, result);
        return;
    }

    std::string err;
    if (!ClickNode(targetTransform, clickPath, 0, &err)) {
        char result[192];
        snprintf(result, sizeof(result), "{\"clicked\":false,\"screen\":\"%s\",\"reason\":\"%s\"}", s.screen, err.c_str());
        SendResponse(c, id, true, result);
        return;
    }

    char result[128];
    snprintf(result, sizeof(result), "{\"clicked\":true,\"screen\":\"%s\"}", s.screen);
    SendResponse(c, id, true, result);
}

// ==========================================================================
// Aggregate Operations
// ==========================================================================

static bool ExecuteCollectCabinetRewardFlow(
    const char* sourceTag,
    std::string* errorMessage,
    const unsigned long long* expectedControlVersion
) {
    if (errorMessage) errorMessage->clear();
    if (IsAgentShuttingDown()) {
        if (errorMessage) *errorMessage = "shutting down";
        return false;
    }

    ScopedAutoCollectCabinetRewardRunGuard runGuard(&g_autoCollectCabinetRewardRunning);
    if (!runGuard.IsAcquired()) {
        if (errorMessage) *errorMessage = "collect cabinet reward already running";
        return false;
    }
    if (expectedControlVersion &&
        !CanAutoCollectCabinetRewardCycleStart(
            g_autoCollectCabinetRewardEnabled.load(std::memory_order_relaxed),
            *expectedControlVersion,
            g_autoCollectCabinetRewardControlVersion.load(std::memory_order_relaxed))) {
        if (errorMessage) *errorMessage = "scheduler control changed";
        return false;
    }

    ScreenState stable = {};
    for (int attempt = 0; ; attempt++) {
        if (IsAgentShuttingDown()) {
            if (errorMessage) *errorMessage = "shutting down";
            return false;
        }

        ScreenState cur = DetectScreenState();
        if (IsStableCabinetRewardEntryScreen(cur.screen)) {
            stable = cur;
            break;
        }
        if (attempt >= 10) {
            if (errorMessage) *errorMessage = "could not reach cabinet reward entry after 10 close attempts";
            return false;
        }

        Il2CppObject* targetTransform = nullptr;
        const char* clickPath = nullptr;
        if (ResolveCloseTarget(cur, &targetTransform, &clickPath)) {
            std::string ignoredError;
            ClickNode(targetTransform, clickPath, 0, &ignoredError);
        }
        if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(1500)) {
            if (errorMessage) *errorMessage = "shutting down";
            return false;
        }
    }

    std::string err;
    if (ShouldOpenWarehouseForCabinetReward(stable.screen)) {
        if (!stable.uiMainTransform) {
            if (errorMessage) *errorMessage = "UIMain not found";
            return false;
        }
        if (!ClickNode(stable.uiMainTransform, "MainPanel/Btns2/Button_1", 0, &err)) {
            if (errorMessage) *errorMessage = err;
            return false;
        }
        if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(1500)) {
            if (errorMessage) *errorMessage = "shutting down";
            return false;
        }
        stable = DetectScreenState();
        if (strcmp(stable.screen, "warehouse") != 0) {
            char msg[128];
            snprintf(msg, sizeof(msg), "expected warehouse after opening it, got %s", stable.screen);
            if (errorMessage) *errorMessage = msg;
            return false;
        }
    }

    if (!stable.uiMainTransform) {
        if (errorMessage) *errorMessage = "UIMain not found";
        return false;
    }
    if (!ClickNode(stable.uiMainTransform, "WareHousePanel/leftDown/Button[0]", 0, &err)) {
        if (errorMessage) *errorMessage = err;
        return false;
    }
    if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(1500)) {
        if (errorMessage) *errorMessage = "shutting down";
        return false;
    }

    ScreenState s3 = DetectScreenState();
    if (strcmp(s3.screen, "cabinet_reward_list") != 0) {
        char msg[128];
        snprintf(msg, sizeof(msg), "expected cabinet_reward_list after 查看, got %s", s3.screen);
        if (errorMessage) *errorMessage = msg;
        return false;
    }

    if (!s3.collectAwardTransform) {
        if (errorMessage) *errorMessage = "CollectAward_Main transform missing";
        return false;
    }
    if (!ClickNode(s3.collectAwardTransform, "Panel/down/Button", 0, &err)) {
        if (errorMessage) *errorMessage = err;
        return false;
    }
    if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(1500)) {
        if (errorMessage) *errorMessage = "shutting down";
        return false;
    }

    ScreenState s5 = DetectScreenState();
    if (strcmp(s5.screen, "cabinet_reward_popup") == 0 && s5.rewardsBoxTransform) {
        if (!ClickNode(s5.rewardsBoxTransform, "bg", 0, &err)) {
            if (errorMessage) *errorMessage = err;
            return false;
        }
        if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(1500)) {
            if (errorMessage) *errorMessage = "shutting down";
            return false;
        }
    }

    ScreenState s6 = DetectScreenState();
    if (s6.collectAwardTransform) {
        if (!ClickNode(s6.collectAwardTransform, "bg", 0, &err)) {
            if (errorMessage) *errorMessage = err;
            return false;
        }
        if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(1500)) {
            if (errorMessage) *errorMessage = "shutting down";
            return false;
        }
    }

    Logf("AutoCollectCabinetReward success source=%s", sourceTag ? sourceTag : "unknown");
    return true;
}

// CollectCabinetReward: collect showcase cabinet rewards from anywhere.
// Returns {"collected":true} or {"ok":false,"error":"..."}
void CmdCollectCabinetReward(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    std::string errorMessage;
    if (!ExecuteCollectCabinetRewardFlow("manual", &errorMessage)) {
        SendResponse(
            c,
            id,
            false,
            errorMessage.empty() ? "collect cabinet reward failed" : errorMessage.c_str()
        );
        return;
    }

    SendResponse(c, id, true, "{\"collected\":true}");
}

static uint64_t ReadUnixTimeMs() {
    FILETIME fileTime = {};
    GetSystemTimeAsFileTime(&fileTime);
    ULARGE_INTEGER ticks = {};
    ticks.LowPart = fileTime.dwLowDateTime;
    ticks.HighPart = fileTime.dwHighDateTime;
    return ConvertWindowsFileTime100nsToUnixMs(ticks.QuadPart);
}

static AutoCollectCabinetRewardStateSnapshot SnapshotAutoCollectCabinetRewardState() {
    AutoCollectCabinetRewardStateSnapshot snapshot = {};
    snapshot.enabled = g_autoCollectCabinetRewardEnabled.load(std::memory_order_relaxed);
    snapshot.running = g_autoCollectCabinetRewardRunning.load(std::memory_order_relaxed);
    snapshot.intervalMs = (int)kAutoCollectCabinetRewardIntervalMs;

    const unsigned long long dueTick = snapshot.enabled
        ? EnsureAutoCollectCabinetRewardNextDueTickSeeded()
        : g_autoCollectCabinetRewardNextDueTick.load(std::memory_order_relaxed);
    if (snapshot.enabled && dueTick > 0ULL) {
        const long long delta = (long long)dueTick - (long long)GetTickCount64();
        snapshot.nextCheckInMs = delta > 0 ? delta : 0;
    } else {
        snapshot.nextCheckInMs = -1;
    }

    EnsureAutoCollectCabinetRewardStateCsInitialized();
    static thread_local std::string lastResultCodeCopy;
    static thread_local std::string lastResultMessageCopy;
    static thread_local std::string lastObservedScreenCopy;

    EnterCriticalSection(&g_autoCollectCabinetRewardStateCs);
    snapshot.lastCheckAtUnixMs = g_autoCollectCabinetRewardLastCheckAtUnixMs;
    lastResultCodeCopy = g_autoCollectCabinetRewardLastResultCode;
    lastResultMessageCopy = g_autoCollectCabinetRewardLastResultMessage;
    lastObservedScreenCopy = g_autoCollectCabinetRewardLastObservedScreen;
    LeaveCriticalSection(&g_autoCollectCabinetRewardStateCs);

    snapshot.lastResultCode = lastResultCodeCopy.c_str();
    snapshot.lastResultMessage = lastResultMessageCopy.c_str();
    snapshot.lastObservedScreen = lastObservedScreenCopy.c_str();
    return snapshot;
}

void CmdGetAutoCollectCabinetRewardState(AgentConn* c, const char* id, const char*) {
    const std::string json = BuildAutoCollectCabinetRewardStateJson(
        SnapshotAutoCollectCabinetRewardState()
    );
    SendResponse(c, id, true, json.c_str());
}

void CmdSetAutoCollectCabinetRewardEnabled(AgentConn* c, const char* id, const char* json) {
    bool enabled = false;
    if (!TryParseStrictJsonBoolField(json, "enabled", &enabled)) {
        SendResponse(c, id, false, "enabled must be boolean");
        return;
    }

    SetAutoCollectCabinetRewardEnabledState(enabled);
    if (enabled) {
        Logf("AutoCollectCabinetReward enabled by UI");
    } else {
        Logf("AutoCollectCabinetReward disabled by UI");
    }

    const std::string resultJson = BuildAutoCollectCabinetRewardStateJson(
        SnapshotAutoCollectCabinetRewardState()
    );
    SendResponse(c, id, true, resultJson.c_str());
}

DWORD WINAPI AutoCollectCabinetRewardThread(LPVOID) {
    AttachCurrentThread();
    EnsureAutoCollectCabinetRewardStateCsInitialized();
    EnsureAutoCollectCabinetRewardNextDueTickSeeded();
    Logf("AutoCollectCabinetReward scheduler started intervalMs=%llu",
         (unsigned long long)kAutoCollectCabinetRewardIntervalMs);

    while (!IsAgentShuttingDown()) {
        if (!g_autoCollectCabinetRewardEnabled.load(std::memory_order_relaxed)) {
            if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(250)) break;
            continue;
        }

        const unsigned long long nowTick = GetTickCount64();
        const unsigned long long dueTick = EnsureAutoCollectCabinetRewardNextDueTickSeeded();
        if (dueTick == 0ULL) {
            if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(250)) break;
            continue;
        }
        if (nowTick < dueTick) {
            const unsigned long long remaining = dueTick - nowTick;
            const int waitMs = remaining > 250ULL ? 250 : (int)remaining;
            if (!SleepForAutoCollectCabinetRewardDelayInterruptibly(waitMs)) break;
            continue;
        }

        if (IsAgentShuttingDown()) break;

        const unsigned long long cycleControlVersion =
            g_autoCollectCabinetRewardControlVersion.load(std::memory_order_relaxed);
        if (!CanAutoCollectCabinetRewardCycleStart(
                g_autoCollectCabinetRewardEnabled.load(std::memory_order_relaxed),
                cycleControlVersion,
                g_autoCollectCabinetRewardControlVersion.load(std::memory_order_relaxed))) {
            continue;
        }

        auto shouldReschedule = [&]() {
            return ShouldAutoCollectCabinetRewardWorkerReschedule(
                cycleControlVersion,
                g_autoCollectCabinetRewardControlVersion.load(std::memory_order_relaxed)
            );
        };
        auto scheduleIfUnchanged = [&]() {
            if (shouldReschedule()) {
                ScheduleNextAutoCollectCabinetRewardCycleFromNow();
            }
        };

        UpdateAutoCollectCabinetRewardCycleState(ReadUnixTimeMs(), nullptr, nullptr, nullptr);

        if (ShouldSkipAutoCollectCabinetRewardForAutoAuction(
                g_autoAuctionRunning.load(std::memory_order_relaxed))) {
            UpdateAutoCollectCabinetRewardCycleState(
                UINT64_MAX,
                "skipped_auto_auction_running",
                "auto auction running",
                nullptr
            );
            scheduleIfUnchanged();
            Logf("AutoCollectCabinetReward skipped: auto auction running");
            continue;
        }

        if (ShouldSkipAutoCollectCabinetRewardForBusyFlow(
                g_autoCollectCabinetRewardRunning.load(std::memory_order_relaxed))) {
            UpdateAutoCollectCabinetRewardCycleState(
                UINT64_MAX,
                "skipped_collect_running",
                "collect cabinet reward already running",
                nullptr
            );
            scheduleIfUnchanged();
            Logf("AutoCollectCabinetReward skipped: collect already running");
            continue;
        }

        ScreenState state = DetectScreenState();
        UpdateAutoCollectCabinetRewardCycleState(UINT64_MAX, nullptr, nullptr, state.screen);
        if (!IsEligibleAutoCollectCabinetRewardScreen(state.screen)) {
            UpdateAutoCollectCabinetRewardCycleState(
                UINT64_MAX,
                "skipped_not_main_lobby",
                state.screen ? state.screen : "",
                nullptr
            );
            scheduleIfUnchanged();
            Logf("AutoCollectCabinetReward skipped: screen=%s", state.screen ? state.screen : "");
            continue;
        }

        std::string errorMessage;
        const bool ok = ExecuteCollectCabinetRewardFlow(
            "scheduler",
            &errorMessage,
            &cycleControlVersion
        );
        if (ok) {
            UpdateAutoCollectCabinetRewardCycleState(UINT64_MAX, "success", "", nullptr);
        } else if (errorMessage == "collect cabinet reward already running") {
            UpdateAutoCollectCabinetRewardCycleState(
                UINT64_MAX,
                "skipped_collect_running",
                "collect cabinet reward already running",
                nullptr
            );
            Logf("AutoCollectCabinetReward skipped: collect already running");
        } else if (errorMessage == "scheduler control changed") {
            continue;
        } else {
            UpdateAutoCollectCabinetRewardCycleState(
                UINT64_MAX,
                "failed",
                errorMessage.c_str(),
                nullptr
            );
            if (!errorMessage.empty()) {
                Logf("AutoCollectCabinetReward failed source=scheduler error=%s",
                     errorMessage.c_str());
            }
        }

        scheduleIfUnchanged();
        if (!ok && errorMessage == "shutting down") break;
    }

    return 0;
}

// DismissRewardsBox: click the background of the RewardsBox popup ("点击屏幕继续").
// Precondition: RewardsBox must be visible.
// Returns {"clicked":true} on success, {"clicked":false,"reason":"..."} otherwise.
void CmdDismissRewardsBox(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    Il2CppObject* panelTransform = nullptr;
    char error[128] = {};
    UiPanelLookupResult r = FindVisiblePanelTransform("RewardsBox", nullptr, &panelTransform, error, sizeof(error));
    if (r == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, error); return; }
    if (r != UI_PANEL_FOUND) {
        SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"RewardsBox not visible\"}");
        return;
    }

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(panelTransform, "bg", UI_PATH_EXACT, 1, &matches);
    if (matches.empty()) { SendResponse(c, id, false, "bg not found"); return; }

    UiNodeSnapshot& node = matches[0];
    if (!node.active)           { SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"bg inactive\"}"); return; }
    if (!node.components.button) { SendResponse(c, id, false, "bg: no Button component"); return; }

    if (!PerformButtonClick(node.components.button)) { SendResponse(c, id, false, "click failed"); return; }
    SendResponse(c, id, true, "{\"clicked\":true}");
}

// DismissCollectAward: click the background of CollectAward_Main to close the cabinet reward list.
// Precondition: CollectAward_Main must be visible.
// Returns {"clicked":true} on success, {"clicked":false,"reason":"..."} otherwise.
void CmdDismissCollectAward(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    Il2CppObject* panelTransform = nullptr;
    char error[128] = {};
    UiPanelLookupResult r = FindVisiblePanelTransform("CollectAward_Main", nullptr, &panelTransform, error, sizeof(error));
    if (r == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, error); return; }
    if (r != UI_PANEL_FOUND) {
        SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"CollectAward_Main not visible\"}");
        return;
    }

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(panelTransform, "bg", UI_PATH_EXACT, 1, &matches);
    if (matches.empty()) { SendResponse(c, id, false, "bg not found"); return; }

    UiNodeSnapshot& node = matches[0];
    if (!node.active)           { SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"bg inactive\"}"); return; }
    if (!node.components.button) { SendResponse(c, id, false, "bg: no Button component"); return; }

    if (!PerformButtonClick(node.components.button)) { SendResponse(c, id, false, "click failed"); return; }
    SendResponse(c, id, true, "{\"clicked\":true}");
}

// ConfirmBid: click the confirm (chujia) button inside the InputDevice bid dialog.
// Must be called after SetBidAmount has set the desired price.
// Returns {"clicked":true} on success, {"clicked":false,"reason":"..."} otherwise.
void CmdConfirmBid(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    Il2CppObject* panelTransform = nullptr;
    if (!GetBattleMainPanel(c, id, &panelTransform)) return;

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(panelTransform, "InputDevice/Panel1/chujia", UI_PATH_EXACT, 2, &matches);
    if (matches.empty()) {
        SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"confirm button not found — bid dialog not open\"}");
        return;
    }

    UiNodeSnapshot& node = matches[0];
    if (!node.active) { SendResponse(c, id, true, "{\"clicked\":false,\"reason\":\"confirm button inactive\"}"); return; }
    if (!node.components.button) { SendResponse(c, id, false, "confirm button: no Button component"); return; }

    if (!PerformButtonClick(node.components.button)) {
        SendResponse(c, id, false, "click failed");
        return;
    }

    BidConfirmFlowResult confirmResult = WaitForBidConfirmationSettled(panelTransform);
    if (!confirmResult.completed) {
        if (confirmResult.hardError) {
            SendResponse(c, id, false, confirmResult.reason.c_str());
            return;
        }
        char result[256];
        snprintf(
            result,
            sizeof(result),
            "{\"clicked\":false,\"reason\":\"%s\"}",
            confirmResult.reason.c_str()
        );
        SendResponse(c, id, true, result);
        return;
    }

    SendResponse(c, id, true, "{\"clicked\":true}");
}

// --------------------------------------------------------------------------
// SetExpectedPrice: store expected price for use by AutoAuction
// --------------------------------------------------------------------------
// Params:  { "price": <int> }
// Returns: { "ok": true, "price": <n> }
void CmdSetExpectedPrice(AgentConn* c, const char* id, const char* json) {
    int price = JsonGetInt(json, "price");
    if (price == INT_MIN) price = 0;
    if (price < 0) price = 0;
    g_notifiedExpectedPrice.store(price);
    char buf[64];
    snprintf(buf, sizeof(buf), "{\"price\":%d}", price);
    SendResponse(c, id, true, buf);
}

void CmdCancelAutoAuction(AgentConn* c, const char* id, const char*) {
    const bool running = g_autoAuctionRunning.load(std::memory_order_relaxed);
    if (running) {
        g_autoAuctionCancelRequested.store(true, std::memory_order_relaxed);
    }
    char result[96];
    snprintf(
        result,
        sizeof(result),
        "{\"cancelRequested\":%s,\"running\":%s}",
        running ? "true" : "false",
        running ? "true" : "false"
    );
    SendResponse(c, id, true, result);
}

// --------------------------------------------------------------------------
// AutoAuction aggregate operation
// --------------------------------------------------------------------------

// Parse "M:SS" or "SS" time string into total seconds. Returns 9999 on error.
static int ParseTimeSeconds(const std::string& s) {
    if (s.empty()) return 9999;
    size_t colon = s.find(':');
    if (colon != std::string::npos) {
        int mins = atoi(s.substr(0, colon).c_str());
        int secs = atoi(s.substr(colon + 1).c_str());
        return mins * 60 + secs;
    }
    int n = atoi(s.c_str());
    return n > 0 ? n : 9999;
}

// Read round text and time-remaining seconds from Battle_Main panel.
static void ReadBidState(Il2CppObject* battleTransform,
                         std::string* roundOut, int* secsOut) {
    {
        std::vector<UiNodeSnapshot> m;
        ResolveUiNodeMatches(battleTransform, "Gaming/Center/RoundBg/roundTxt", UI_PATH_EXACT, 1, &m);
        if (!m.empty()) ReadNodeTextValue(m[0].components, roundOut);
    }
    {
        std::vector<UiNodeSnapshot> m;
        std::string timeStr;
        ResolveUiNodeMatches(battleTransform, "Gaming/remainBg/remainTxt", UI_PATH_EXACT, 1, &m);
        if (!m.empty()) ReadNodeTextValue(m[0].components, &timeStr);
        *secsOut = ParseTimeSeconds(timeStr);
    }
}

static bool ReadExactNodeText(Il2CppObject* anchor, const char* path, std::string* out) {
    if (!out) return false;
    out->clear();
    if (!anchor || !path || !path[0]) return false;
    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(anchor, path, UI_PATH_EXACT, 1, &matches);
    if (matches.empty()) return false;
    return ReadNodeTextValue(matches[0].components, out);
}

static bool ReadExactNodeTransform(Il2CppObject* anchor, const char* path, Il2CppObject** out) {
    if (out) *out = nullptr;
    if (!anchor || !path || !path[0]) return false;
    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(anchor, path, UI_PATH_EXACT, 1, &matches);
    if (matches.empty() || !matches[0].transform) return false;
    if (out) *out = matches[0].transform;
    return true;
}

static bool IsRoundUnitRowName(const std::string& name) {
    return name == "RoundUnit" || name.compare(0, strlen("RoundUnit("), "RoundUnit(") == 0;
}

static bool TryReadVisiblePlayerName(Il2CppObject* battleTransform, int slot, std::string* out) {
    if (!out) return false;
    char path[128];
    snprintf(
        path,
        sizeof(path),
        "Gaming/PlayerContainer/Player_%d/NameUnit/NameLayout/nameTxt",
        slot
    );
    return ReadExactNodeText(battleTransform, path, out);
}

static bool TryReadAutoAuctionEndedWinnerName(Il2CppObject* battleTransform, std::string* out) {
    return ReadExactNodeText(
        battleTransform,
        "EndPanel/Player/NameUnit/Root/TxtName",
        out
    );
}

static bool TryReadOpponentPreviousRoundBid(
    Il2CppObject* battleTransform,
    int opponentSlot,
    int currentRoundNumber,
    int* outBid,
    std::string* outReason
) {
    if (outBid) *outBid = 0;
    if (outReason) outReason->clear();
    if (!battleTransform || !outBid || !outReason || currentRoundNumber <= 1) return false;

    char containerPath[128];
    snprintf(
        containerPath,
        sizeof(containerPath),
        "Gaming/PlayerContainer/Player_%d/containers",
        opponentSlot
    );
    Il2CppObject* containerTransform = nullptr;
    if (!ReadExactNodeTransform(battleTransform, containerPath, &containerTransform) || !containerTransform) {
        *outReason = "history_container_missing";
        return false;
    }

    std::vector<UiNodeSnapshot> rowSnapshots;
    if (!CollectActiveDirectChildSnapshots(containerTransform, &rowSnapshots) || rowSnapshots.empty()) {
        *outReason = "history_row_missing";
        return false;
    }

    Il2CppObject* matchedRowTransform = nullptr;
    const int previousRoundNumber = currentRoundNumber - 1;
    for (size_t i = 0; i < rowSnapshots.size(); ++i) {
        const UiNodeSnapshot& snapshot = rowSnapshots[i];
        if (!snapshot.transform || !IsRoundUnitRowName(snapshot.name)) continue;

        std::string rowRoundText;
        if (!ReadExactNodeText(snapshot.transform, "roundTxt", &rowRoundText)) continue;

        int rowRoundNumber = 0;
        if (!TryParseHistoryRoundNumber(rowRoundText, &rowRoundNumber)) continue;
        if (rowRoundNumber != previousRoundNumber) continue;

        if (matchedRowTransform) {
            *outReason = "history_row_ambiguous";
            return false;
        }
        matchedRowTransform = snapshot.transform;
    }

    if (!matchedRowTransform) {
        *outReason = "history_row_missing";
        return false;
    }

    std::string priceText;
    if (!ReadExactNodeText(matchedRowTransform, "priceTxt", &priceText) || priceText.empty()) {
        *outReason = "previous_price_missing";
        return false;
    }

    if (!TryParsePriceText(priceText, outBid)) {
        *outReason = "previous_price_invalid";
        return false;
    }
    return true;
}

// AutoAuction: full automated auction sequence from main_lobby.
// Params: {"roomId":<int>, "bidAmount":<int>}  (defaults: roomId=101, bidAmount=25000)
// Steps:
//   1. Ensure main_lobby (close overlays if needed)
//   2. GoToBattlePrev → wait for auction_lobby_map                      [poll 1s, max 15s]
//   3. EnterRoom → wait for auction_lobby_room                          [poll 1s, max 15s]
//   4. OpenSkillConfig → SelectRole → StartAction                       [1.5s each]
//   5. Wait for auction_in_progress                                     [poll 1.5s, max 120s]
//   6. Bid loop:
//      - useExpectedPrice: bid on each new round using the latest notified expected price
//      - legacy bidAmount path: bid on each new round only when secs < 15
//      Both paths then PlaceBid + SetBidAmount + ConfirmBid until auction_ended.
//   7. 快捷回收 (PanelBattleHuiShouTran/huishou, if active)
//   8. Exit: continueBtn → auction_lobby_map → BattlePrevPanel_Main/Top/Close → main_lobby
// Returns {"result":"auction_ended","rounds":<n>}
void CmdAutoAuction(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    int roomId    = JsonGetInt(json, "roomId");    if (roomId    == INT_MIN) roomId    = 101;
    int bidAmount = JsonGetInt(json, "bidAmount"); if (bidAmount == INT_MIN) bidAmount = 25000;

    bool useExpectedPrice = false;
    JsonGetBool(json, "useExpectedPrice", &useExpectedPrice);
    char selfNameBuf[128] = "melo";
    char requestedSelfName[128] = {};
    if (JsonGetString(json, "selfName", requestedSelfName, sizeof(requestedSelfName)) &&
        requestedSelfName[0]) {
        snprintf(selfNameBuf, sizeof(selfNameBuf), "%s", requestedSelfName);
    }
    const std::string selfName(selfNameBuf);

    g_autoAuctionCancelRequested.store(false, std::memory_order_relaxed);
    g_autoAuctionRunning.store(true, std::memory_order_relaxed);
    struct AutoAuctionStateGuard {
        ~AutoAuctionStateGuard() {
            g_autoAuctionRunning.store(false, std::memory_order_relaxed);
            g_autoAuctionCancelRequested.store(false, std::memory_order_relaxed);
        }
    } _autoAuctionStateGuard;

    char errBuf[256] = {};
    int roundsPlayed = 0;
    int lastExpectedPrice = 0;

    auto stopIfRequested = [&]() -> bool {
        if (!IsAutoAuctionStopRequested()) return false;
        const char* reason = g_autoAuctionCancelRequested.load(std::memory_order_relaxed)
            ? "cancel_requested"
            : "agent_unloading";
        char result[160];
        snprintf(
            result,
            sizeof(result),
            "{\"result\":\"canceled\",\"reason\":\"%s\",\"rounds\":%d,\"expectedPrice\":%d}",
            reason,
            roundsPlayed,
            lastExpectedPrice
        );
        SendResponse(c, id, true, result);
        return true;
    };

    auto sendAuthCodeRequired = [&]() -> bool {
        const int reportedExpectedPrice = ResolveAutoAuctionReportedExpectedPrice(
            lastExpectedPrice,
            g_notifiedExpectedPrice.load()
        );
        const std::string result = BuildAutoAuctionAuthCodeRequiredResult(roundsPlayed, reportedExpectedPrice);
        SendResponse(c, id, true, result.c_str());
        return true;
    };

    // Step 1: navigate to main_lobby (polling-based)
    for (int attempt = 0; attempt < 10; attempt++) {
        if (stopIfRequested()) return;
        ScreenState cur = DetectScreenState();
        if (IsAutoAuctionVerificationScreen(cur.screen)) {
            Logf("AutoAuction interrupted: AuthCode_Main detected while navigating to main_lobby");
            sendAuthCodeRequired();
            return;
        }
        if (strcmp(cur.screen, "main_lobby") == 0) break;
        Il2CppObject* t = nullptr; const char* p = nullptr;
        if (ResolveCloseTarget(cur, &t, &p)) {
            std::string e;
            ClickNode(t, p, 0, &e);
            // Poll until the current screen changes — up to 1500ms at 100ms intervals
            PollWaitResult wr = WaitForScreenTransition(cur.screen, 1500, 100);
            if (wr.result == POLL_AUTHCODE) {
                Logf("AutoAuction interrupted: AuthCode_Main detected while navigating to main_lobby");
                sendAuthCodeRequired();
                return;
            }
            if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
            // POLL_OK or POLL_TIMEOUT: loop back and re-detect screen
        } else {
            // No close target found — short poll then re-detect
            if (!SleepInterruptibly(200)) { stopIfRequested(); return; }
        }
        if (attempt == 9) {
            SendResponse(c, id, false, "auto_auction_timeout:wait_main_lobby");
            return;
        }
    }

    // Step 2: GoToBattlePrev + wait for auction_lobby_map (polling-based)
    {
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform("UIMain", nullptr, &t, errBuf, sizeof(errBuf)) != UI_PANEL_FOUND || !t) {
            if (stopIfRequested()) return;
            Logf("AutoAuction GoToBattlePrev panel lookup failed: %s", errBuf[0] ? errBuf : "UIMain not found");
            SendResponse(c, id, false, "auto_auction_ui_error:wait_lobby_map"); return;
        }
        std::string clickErr;
        if (!ClickNode(t, "MainPanel/mask/Button", 0, &clickErr)) {
            if (stopIfRequested()) return;
            Logf("AutoAuction GoToBattlePrev click failed: %s", clickErr.c_str());
            SendResponse(c, id, false, "auto_auction_ui_error:wait_lobby_map_click_failed"); return;
        }
        PollWaitResult wr = WaitForScreen("auction_lobby_map", 15000, 100);
        if (wr.result == POLL_AUTHCODE) {
            Logf("AutoAuction interrupted: AuthCode_Main detected while waiting for auction_lobby_map");
            sendAuthCodeRequired();
            return;
        }
        if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
        if (wr.result == POLL_TIMEOUT) {
            SendResponse(c, id, false, "auto_auction_timeout:wait_lobby_map");
            return;
        }
    }

    // Step 3: EnterRoom + wait for auction_lobby_room (polling-based)
    {
        char roomPath[128];
        snprintf(roomPath, sizeof(roomPath), "Panel_1/bg/MapContainer/MapItem_%d/Image (1)", roomId);
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &t, errBuf, sizeof(errBuf)) != UI_PANEL_FOUND || !t) {
            if (stopIfRequested()) return;
            Logf("AutoAuction EnterRoom panel lookup failed: %s", errBuf[0] ? errBuf : "BattlePrevPanel_Main not found");
            SendResponse(c, id, false, "auto_auction_ui_error:wait_lobby_room"); return;
        }
        std::string clickErr;
        if (!ClickNode(t, roomPath, 0, &clickErr)) {
            if (stopIfRequested()) return;
            Logf("AutoAuction EnterRoom click failed: %s", clickErr.c_str());
            SendResponse(c, id, false, "auto_auction_ui_error:wait_lobby_room_click_failed"); return;
        }
        PollWaitResult wr = WaitForScreen("auction_lobby_room", 15000, 100);
        if (wr.result == POLL_AUTHCODE) {
            Logf("AutoAuction interrupted: AuthCode_Main detected while waiting for auction_lobby_room");
            sendAuthCodeRequired();
            return;
        }
        if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
        if (wr.result == POLL_TIMEOUT) {
            SendResponse(c, id, false, "auto_auction_timeout:wait_lobby_room");
            return;
        }
    }

    {
        Il2CppObject* battlePrevTransform = nullptr;
        char lookupError[128] = {};
        UiPanelLookupResult panelResult = FindVisiblePanelTransform(
            "BattlePrevPanel_Main",
            nullptr,
            &battlePrevTransform,
            lookupError,
            sizeof(lookupError)
        );
        if (panelResult == UI_PANEL_FOUND && battlePrevTransform) {
            std::string countText;
            std::string roomEntryLimitResult;
            const int reportedExpectedPrice = ResolveAutoAuctionReportedExpectedPrice(
                lastExpectedPrice,
                g_notifiedExpectedPrice.load()
            );
            // countTxt may render late after screen transition — short polling
            // window to avoid skipping room_entry_limit_reached on late text.
            bool countTextResolved = false;
            for (int settleAttempt = 0; settleAttempt < 10; settleAttempt++) {
                if (ReadExactNodeText(battlePrevTransform, "Panel_1/MapPanel/countTxt", &countText)) {
                    countTextResolved = true;
                    break;
                }
                if (!SleepInterruptibly(50)) { stopIfRequested(); return; }
            }
            if (countTextResolved &&
                TryBuildAutoAuctionRoomEntryLimitReachedResultFromCountText(
                    countText,
                    roundsPlayed,
                    reportedExpectedPrice,
                    &roomEntryLimitResult
                )) {
                Logf(
                    "AutoAuction stopped: lobby room daily entry limit reached countTxt=%s",
                    countText.c_str()
                );
                SendResponse(c, id, true, roomEntryLimitResult.c_str());
                return;
            }
        }
    }

    // Step 4: OpenSkillConfig → SelectRole → StartAction (polling-based)
    // 4a: Click skill config, wait for hero button to be ready
    {
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &t, errBuf, sizeof(errBuf)) != UI_PANEL_FOUND || !t) {
            if (stopIfRequested()) return;
            SendResponse(c, id, false, "auto_auction_ui_error:wait_skill_config"); return;
        }
        std::string clickErr;
        if (!ClickNode(t, "Panel_1/MapPanel/battleSet/Hero/Button", 0, &clickErr)) {
            if (stopIfRequested()) return;
            Logf("AutoAuction skill config click failed: %s", clickErr.c_str());
            SendResponse(c, id, false, "auto_auction_ui_error:wait_skill_config_click_failed"); return;
        }
        PollWaitResult wr = WaitForNodeReady("BattlePrevPanel_Main",
            "Panel_1/MapPanel/battleSet/HeroChoose/ScrollView/Viewport/Content/herochooseItem_103/button",
            3000, 100);
        if (wr.result == POLL_AUTHCODE) {
            Logf("AutoAuction interrupted: AuthCode_Main detected during skill config");
            sendAuthCodeRequired();
            return;
        }
        if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
        if (wr.result == POLL_TIMEOUT) {
            SendResponse(c, id, false, "auto_auction_timeout:wait_skill_config"); return;
        }
    }
    // 4b: Click hero, wait for start button to be ready
    {
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &t, errBuf, sizeof(errBuf)) != UI_PANEL_FOUND || !t) {
            if (stopIfRequested()) return;
            SendResponse(c, id, false, "auto_auction_ui_error:wait_skill_config"); return;
        }
        std::string clickErr;
        if (!ClickNode(t, "Panel_1/MapPanel/battleSet/HeroChoose/ScrollView/Viewport/Content/herochooseItem_103/button", 0, &clickErr)) {
            if (stopIfRequested()) return;
            Logf("AutoAuction skill config click failed: %s", clickErr.c_str());
            SendResponse(c, id, false, "auto_auction_ui_error:wait_skill_config_click_failed"); return;
        }
        PollWaitResult wr = WaitForNodeReady("BattlePrevPanel_Main",
            "Panel_1/MapPanel/Button",
            3000, 100);
        if (wr.result == POLL_AUTHCODE) {
            Logf("AutoAuction interrupted: AuthCode_Main detected during hero select");
            sendAuthCodeRequired();
            return;
        }
        if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
        if (wr.result == POLL_TIMEOUT) {
            SendResponse(c, id, false, "auto_auction_timeout:wait_skill_config"); return;
        }
    }
    // 4c: Click start action — no fixed wait. The long wait for auction_in_progress
    //     is entirely handled by Step 5 below. A short poll (200ms × 5 = 1000ms) avoids
    //     immediately reading stale state without creating an independent failure boundary.
    {
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &t, errBuf, sizeof(errBuf)) != UI_PANEL_FOUND || !t) {
            if (stopIfRequested()) return;
            SendResponse(c, id, false, "auto_auction_ui_error:wait_skill_config"); return;
        }
        std::string clickErr;
        if (!ClickNode(t, "Panel_1/MapPanel/Button", 0, &clickErr)) {
            if (stopIfRequested()) return;
            Logf("AutoAuction skill config click failed: %s", clickErr.c_str());
            SendResponse(c, id, false, "auto_auction_ui_error:wait_skill_config_click_failed"); return;
        }
        // Short post-click settle: poll briefly to avoid reading stale BattlePrevPanel_Main
        for (int i = 0; i < 5; i++) {
            if (!SleepInterruptibly(200)) { stopIfRequested(); return; }
            ScreenState settleCheck = DetectScreenState();
            if (IsAutoAuctionVerificationScreen(settleCheck.screen)) {
                Logf("AutoAuction interrupted: AuthCode_Main detected after start action");
                sendAuthCodeRequired();
                return;
            }
            // If screen has already changed, stop settling early
            if (strcmp(settleCheck.screen, "auction_lobby_room") != 0) break;
        }
    }

    // Step 5: wait for auction_in_progress (staged-backoff polling)
    // Total budget: 120s. Staged polling: fast (100ms) → medium (500ms) → slow (1500ms).
    {
        static const int kFastWindowMs   = GetWaitForAuctionInProgressFastWindowMs();    // 3000ms
        static const int kMediumWindowMs = GetWaitForAuctionInProgressMediumWindowMs();  // 15000ms
        static const int kTotalTimeoutMs = 120000;
        static const int kPollFastMs     = GetWaitForAuctionInProgressPollFastMs();      // 100ms
        static const int kPollMediumMs   = GetWaitForAuctionInProgressPollMediumMs();    // 500ms
        static const int kPollSlowMs     = GetWaitForAuctionInProgressPollSlowMs();      // 1500ms

        bool found = false;
        DWORD startedAt = GetTickCount();
        for (;;) {
            if (stopIfRequested()) return;
            DWORD elapsed = GetTickCount() - startedAt;
            if ((int)elapsed >= kTotalTimeoutMs) break;

            ScreenState state = DetectScreenState();
            const char* sc = state.screen;
            if (IsAutoAuctionVerificationScreen(sc)) {
                Logf("AutoAuction interrupted: AuthCode_Main detected while waiting for auction_in_progress");
                sendAuthCodeRequired();
                return;
            }
            if (strcmp(sc, "auction_in_progress") == 0) { found = true; break; }
            if (strcmp(sc, "auction_ended") == 0) {
                char earlyResult[128];
                snprintf(earlyResult, sizeof(earlyResult),
                    "{\"result\":\"auction_ended\",\"rounds\":0,\"expectedPrice\":%d}",
                    ResolveAutoAuctionReportedExpectedPrice(lastExpectedPrice, g_notifiedExpectedPrice.load()));
                SendResponse(c, id, true, earlyResult); return;
            }

            // Staged poll interval selection
            int pollMs = kPollSlowMs;
            if ((int)elapsed < kFastWindowMs) {
                pollMs = kPollFastMs;
            } else if ((int)elapsed < kMediumWindowMs) {
                pollMs = kPollMediumMs;
            }
            if (!SleepInterruptibly(pollMs)) { stopIfRequested(); return; }
        }
        if (!found) {
            SendResponse(c, id, false, "auto_auction_timeout:wait_auction_in_progress");
            return;
        }
    }

    // Step 6: bid loop (polling-based with throttle separation)
    std::string lastBidRound;
    std::string lastRoundSeen;
    std::string lastBidAttemptRound;
    DWORD lastBidAttemptMs = 0;
    DWORD newRoundFirstSeenMs = 0;
    int roundsEncountered = 0;

    for (;;) {
        // Short observation poll — replaces the old SleepInterruptibly(1000)
        if (!SleepInterruptibly(100)) { stopIfRequested(); return; }
        ScreenState s = DetectScreenState();

        if (stopIfRequested()) return;
        if (IsAutoAuctionVerificationScreen(s.screen)) {
            Logf("AutoAuction interrupted: AuthCode_Main detected during bid loop");
            sendAuthCodeRequired();
            return;
        }
        if (strcmp(s.screen, "auction_ended") == 0) break;
        if (strcmp(s.screen, "auction_in_progress") != 0 || !s.battleMainTransform) continue;

        std::string round;
        int secs = 9999;
        ReadBidState(s.battleMainTransform, &round, &secs);

        // Advance round counter on every new distinct in-game round
        if (ShouldRecordAutoAuctionRoundSeen(round, lastRoundSeen)) {
            lastRoundSeen = round;
            roundsEncountered++;
            newRoundFirstSeenMs = GetTickCount();
        }

        int amount = 0;
        int currentPrice = 0;
        if (useExpectedPrice) {
            static const int FLOOR_PRICE = 11119;
            currentPrice = g_notifiedExpectedPrice.load();
            if (currentPrice <= 0) currentPrice = FLOOR_PRICE;
            amount = currentPrice;
            lastExpectedPrice = currentPrice;
            if (!ShouldAttemptExpectedPriceAutoBid(amount, round, lastBidRound)) {
                continue;
            }
        } else {
            if (!ShouldAttemptLegacyAutoBid(secs, round, lastBidRound)) {
                continue;
            }
            amount = bidAmount;
        }

        if (amount == 0) {
            continue;
        }

        // --- Same-round retry throttle (gate only — timestamp written at click time) ---
        {
            DWORD nowMs = GetTickCount();
            if (!ShouldAttemptAutoBidRetry(round, lastBidAttemptRound, lastBidAttemptMs, nowMs)) {
                // Throttled: observation loop continues but we skip the click this iteration
                continue;
            }
        }

        amount = ClampAutoAuctionFirstRoundBid(amount, roundsEncountered, 17000);

        const int originalBid = amount;

        if (useExpectedPrice && roundsEncountered >= 2 && roundsEncountered <= 5) {
                std::string fallbackReason;
                std::string opponentName;

                // Bounded settle window for opponent-cap UI on new rounds.
                // On a fresh round the player-name and previous-bid widgets may
                // still be rendering. Give them a short window (up to 500ms at
                // 100ms polls) before giving up and falling back to uncapped bid.
                {
                    DWORD roundAgeMs = GetTickCount() - newRoundFirstSeenMs;
                    if (roundAgeMs < (DWORD)GetAutoAuctionOpponentCapSettleWindowMs()) {
                        // Skip this iteration — let the UI settle before first read
                        continue;
                    }
                }

                std::string player1Name;
                std::string player2Name;
                const bool hasPlayer1Name = TryReadVisiblePlayerName(s.battleMainTransform, 1, &player1Name) &&
                    !player1Name.empty();
                const bool hasPlayer2Name = TryReadVisiblePlayerName(s.battleMainTransform, 2, &player2Name) &&
                    !player2Name.empty();

                if (!hasPlayer1Name && !hasPlayer2Name) {
                    fallbackReason = "player_names_missing";
                } else {
                    int opponentSlot = 0;
                    if (!TryResolveOpponentSlot(
                        selfName,
                        hasPlayer1Name ? player1Name : std::string(),
                        hasPlayer2Name ? player2Name : std::string(),
                        &opponentSlot
                    )) {
                        fallbackReason = "opponent_slot_ambiguous";
                    } else {
                        opponentName = opponentSlot == 1 ? player1Name : player2Name;
                        int opponentPreviousBid = 0;
                        if (!TryReadOpponentPreviousRoundBid(
                            s.battleMainTransform,
                            opponentSlot,
                            roundsEncountered,
                            &opponentPreviousBid,
                            &fallbackReason
                        )) {
                            // fallbackReason already set by helper
                        } else {
                            double multiplier = 0.0;
                            if (!TryGetOpponentCapMultiplier(roundsEncountered, &multiplier)) {
                                fallbackReason = "current_round_out_of_scope";
                            } else {
                                const int opponentCap = (int)floor(opponentPreviousBid * multiplier);
                                if (opponentCap <= 0) {
                                    fallbackReason = "opponent_cap_non_positive";
                                } else {
                                    amount = ComputeOpponentCappedBid(originalBid, opponentPreviousBid, multiplier);
                                    Logf(
                                        "AutoAuction round=%d opponent=%s prevBid=%d multiplier=%.2f originalBid=%d cappedBid=%d finalBid=%d",
                                        roundsEncountered,
                                        opponentName.c_str(),
                                        opponentPreviousBid,
                                        multiplier,
                                        originalBid,
                                        opponentCap,
                                        amount
                                    );
                                }
                            }
                        }
                    }
                }

                if (!fallbackReason.empty()) {
                    if (!opponentName.empty()) {
                        Logf(
                            "AutoAuction round=%d limiter skipped: %s; originalBid=%d; opponent=%s",
                            roundsEncountered,
                            fallbackReason.c_str(),
                            originalBid,
                            opponentName.c_str()
                        );
                    } else {
                        Logf(
                            "AutoAuction round=%d limiter skipped: %s; originalBid=%d",
                            roundsEncountered,
                            fallbackReason.c_str(),
                            originalBid
                        );
                    }
                }
        }

        // --- Click "Gaming/chujia" then wait for bid input dialog ---
        // Record throttle timestamp only now — after settle gate and opponent-cap
        // logic have passed, so the 1000ms cooldown starts from the actual click.
        lastBidAttemptRound = round;
        lastBidAttemptMs = GetTickCount();
        std::string clickErr;
        bool placeBidClicked = ClickNode(s.battleMainTransform, "Gaming/chujia", 0, &clickErr);
        bool hasBattleMainAfterClick = false;
        bool hasActiveBidInput = false;
        bool setBidAmountSucceeded = false;
        bool confirmBidCompleted = false;

        if (placeBidClicked) {
            // Poll for bid input dialog to appear (replaces SleepInterruptibly(1500))
            PollWaitResult wr = WaitForNodeReady(
                "Battle_Main",
                "InputDevice/Panel1/InputField (TMP)",
                1500, 100);
            if (wr.result == POLL_AUTHCODE) {
                Logf("AutoAuction interrupted: AuthCode_Main detected during bid input wait");
                sendAuthCodeRequired();
                return;
            }
            if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }

            ScreenState s2 = DetectScreenState();
            hasBattleMainAfterClick = s2.battleMainTransform != nullptr;
            if (s2.battleMainTransform) {
                std::vector<UiNodeSnapshot> inputM;
                ResolveUiNodeMatches(s2.battleMainTransform,
                    "InputDevice/Panel1/InputField (TMP)", UI_PATH_EXACT, 1, &inputM);
                hasActiveBidInput = !inputM.empty() && inputM[0].active;
                if (hasActiveBidInput) {
                    bool canContinueBidDialog = true;
                    std::vector<UiNodeSnapshot> priceUpperLimitM;
                    ResolveUiNodeMatches(
                        s2.battleMainTransform,
                        "InputDevice/Panel1/priceUpperLimit",
                        UI_PATH_EXACT,
                        1,
                        &priceUpperLimitM
                    );
                    if (!priceUpperLimitM.empty()) {
                        bool toggleOn = false;
                        if (!ReadToggleValue(priceUpperLimitM[0].components, &toggleOn)) {
                            Logf("AutoAuction round=%d failed to read priceUpperLimit toggle state", roundsEncountered);
                            canContinueBidDialog = false;
                        } else if (ShouldDisableAutoAuctionPriceUpperLimit(
                            true,
                            priceUpperLimitM[0].active,
                            priceUpperLimitM[0].interactive,
                            toggleOn
                        )) {
                            std::string toggleErr;
                            if (!ClickNode(s2.battleMainTransform, "InputDevice/Panel1/priceUpperLimit", 0, &toggleErr)) {
                                Logf(
                                    "AutoAuction round=%d failed to disable priceUpperLimit: %s",
                                    roundsEncountered,
                                    toggleErr.c_str()
                                );
                                canContinueBidDialog = false;
                            } else {
                                Logf("AutoAuction round=%d disabled priceUpperLimit", roundsEncountered);
                                // Poll for toggle to reach OFF state (replaces SleepInterruptibly(300))
                                PollWaitResult twr = WaitForToggleState(
                                    s2.battleMainTransform,
                                    "InputDevice/Panel1/priceUpperLimit",
                                    false,  // expected OFF
                                    600, 100);
                                if (twr.result == POLL_AUTHCODE) {
                                    Logf("AutoAuction interrupted: AuthCode_Main detected during toggle wait");
                                    sendAuthCodeRequired();
                                    return;
                                }
                                if (twr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
                                // POLL_TIMEOUT is non-fatal — proceed anyway
                            }
                        }
                    }
                    if (!canContinueBidDialog) {
                        continue;
                    }
                    const int finalAmount = ClampAutoAuctionBidAmount(amount, 150000);
                    if (finalAmount != amount) {
                        Logf("AutoAuction amount capped: %d -> %d", amount, finalAmount);
                    }
                    char amountStr[32];
                    snprintf(amountStr, sizeof(amountStr), "%d", finalAmount);
                    std::string compName;
                    setBidAmountSucceeded = PerformSetInputText(inputM[0], amountStr, false, &compName);
                    if (setBidAmountSucceeded) {
                        // Short settle poll after input (replaces SleepInterruptibly(500))
                        {
                            DWORD inputSettleStart = GetTickCount();
                            for (;;) {
                                if (!SleepInterruptibly(50)) { stopIfRequested(); return; }
                                DWORD inputElapsed = GetTickCount() - inputSettleStart;
                                if ((int)inputElapsed >= 600) break;
                                ScreenState settleSc = DetectScreenState();
                                if (IsAutoAuctionVerificationScreen(settleSc.screen)) {
                                    Logf("AutoAuction interrupted: AuthCode_Main detected during input settle");
                                    sendAuthCodeRequired();
                                    return;
                                }
                            }
                        }
                        bool primaryConfirmClicked = ClickNode(
                            s2.battleMainTransform,
                            "InputDevice/Panel1/chujia",
                            0,
                            &clickErr
                        );
                        if (primaryConfirmClicked) {
                            // Authcode-aware confirmation: polls authcode every 100ms cycle
                            AuthCodeAwareBidConfirmResult wrapper =
                                WaitForBidConfirmationSettledWithAuthCode(s2.battleMainTransform);
                            if (wrapper.authcodeDetected) {
                                Logf("AutoAuction interrupted: AuthCode_Main detected during bid confirmation settle");
                                sendAuthCodeRequired();
                                return;
                            }
                            BidConfirmFlowResult& confirmResult = wrapper.confirm;
                            if (confirmResult.interrupted) { stopIfRequested(); return; }
                            if (!confirmResult.completed) {
                                Logf(
                                    "AutoAuction round=%d confirm flow incomplete: %s",
                                    roundsEncountered,
                                    confirmResult.reason.c_str()
                                );
                            } else {
                                confirmBidCompleted = true;
                            }
                        } else {
                            Logf(
                                "AutoAuction round=%d primary confirm click failed: %s",
                                roundsEncountered,
                                clickErr.c_str()
                            );
                        }
                    }
                }
            }
        }

        if (ShouldCountAutoAuctionRound(
            placeBidClicked,
            hasBattleMainAfterClick,
            hasActiveBidInput,
            setBidAmountSucceeded,
            confirmBidCompleted
        )) {
            lastBidRound = round;
            roundsPlayed++;
        }
    }

    // Step 7: on the visible end screen, detect the winner and wait for
    // 快捷回收 only when self won the item.
    {
        bool shouldWaitForQuickRecycle = false;
        bool winnerResolved = false;
        std::string resolvedWinnerName;
        for (int attempt = 0; attempt < 150; ++attempt) {  // ~30s budget at 200ms poll
            if (stopIfRequested()) return;
            ScreenState se = DetectScreenState();
            if (IsAutoAuctionVerificationScreen(se.screen)) {
                Logf("AutoAuction interrupted: AuthCode_Main detected during cleanup winner detection");
                sendAuthCodeRequired();
                return;
            }
            if (!IsAutoAuctionCleanupEndedScreen(se.screen) || !se.battleMainTransform) break;

            std::string winnerName;
            if (TryReadAutoAuctionEndedWinnerName(se.battleMainTransform, &winnerName) &&
                !winnerName.empty()) {
                const bool winnerChanged = !winnerResolved || winnerName != resolvedWinnerName;
                winnerResolved = true;
                resolvedWinnerName = winnerName;
                shouldWaitForQuickRecycle = ShouldWaitForQuickRecycle(selfName, winnerName);
                if (winnerChanged) {
                    Logf(
                        "AutoAuction cleanup winner=%s selfWin=%s",
                        winnerName.c_str(),
                        shouldWaitForQuickRecycle ? "true" : "false"
                    );
                }
                if (!shouldWaitForQuickRecycle) break;
            }

            if (!winnerResolved) {
                if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
                continue;
            }

            std::vector<UiNodeSnapshot> huishouM;
            ResolveUiNodeMatches(se.battleMainTransform,
                "PanelBattleHuiShouTran/huishou", UI_PATH_EXACT, 1, &huishouM);
            if (huishouM.empty() || !huishouM[0].active) {
                if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
                continue;
            }
            if (!huishouM[0].components.button) {
                SendResponse(c, id, false, "auto_auction_ui_error:winner_recycle");
                return;
            }
            if (PerformButtonClick(huishouM[0].components.button)) {
                Logf("AutoAuction cleanup clicked quick recycle");
                // Poll for the huishou button to disappear (replaces SleepInterruptibly(1500))
                for (int settleAttempt = 0; settleAttempt < 15; settleAttempt++) {
                    if (!SleepInterruptibly(100)) { stopIfRequested(); return; }
                    ScreenState recycleSc = DetectScreenState();
                    if (IsAutoAuctionVerificationScreen(recycleSc.screen)) {
                        Logf("AutoAuction interrupted: AuthCode_Main detected after quick recycle");
                        sendAuthCodeRequired();
                        return;
                    }
                    if (!IsAutoAuctionCleanupEndedScreen(recycleSc.screen)) break;
                    std::vector<UiNodeSnapshot> huishouRecheck;
                    ResolveUiNodeMatches(se.battleMainTransform,
                        "PanelBattleHuiShouTran/huishou", UI_PATH_EXACT, 1, &huishouRecheck);
                    if (huishouRecheck.empty() || !huishouRecheck[0].active) break;
                }
                break;
            }
            if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
        }
    }

    // Step 8: exit to main_lobby (polling-based).
    {
        bool cleanupComplete = false;
        const int cleanupMaxAttempts = GetAutoAuctionCleanupMaxAttempts();
        for (int attempt = 0; attempt < cleanupMaxAttempts; ++attempt) {
            const int attemptNumber = attempt + 1;
            if (stopIfRequested()) return;
            ScreenState se = DetectScreenState();
            if (IsAutoAuctionVerificationScreen(se.screen)) {
                Logf("AutoAuction interrupted: AuthCode_Main detected during cleanup exit flow");
                sendAuthCodeRequired();
                return;
            }
            if (IsAutoAuctionCleanupCompleteScreen(se.screen)) {
                cleanupComplete = true;
                break;
            }

            if (IsAutoAuctionCleanupEndedScreen(se.screen)) {
                if (!se.battleMainTransform) {
                    if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
                    continue;
                }
                std::string e;
                const char* endedActionPath = PickAutoAuctionEndedPrimaryActionPath(
                    IsButtonNodeReady(se.battleMainTransform, "EndPanel/tuichu/receiveBtn"),
                    IsButtonNodeReady(se.battleMainTransform, "EndPanel/tuichu/continueBtn")
                );
                if (!endedActionPath) {
                    Logf(
                        "AutoAuction cleanup continue attempt=%d no ended-screen action button ready",
                        attemptNumber
                    );
                    if (attempt == cleanupMaxAttempts - 1) {
                        if (stopIfRequested()) return;
                        SendResponse(c, id, false, "auto_auction_timeout:wait_cleanup_transition");
                        return;
                    }
                    if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
                    continue;
                }
                if (!ClickNode(se.battleMainTransform, endedActionPath, 0, &e)) {
                    Logf(
                        "AutoAuction cleanup continue attempt=%d click failed path=%s: %s",
                        attemptNumber,
                        endedActionPath,
                        e.c_str()
                    );
                    if (attempt == cleanupMaxAttempts - 1) {
                        if (stopIfRequested()) return;
                        SendResponse(c, id, false, "auto_auction_ui_error:wait_cleanup_transition");
                        return;
                    }
                    if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
                    continue;
                }
                Logf(
                    "AutoAuction cleanup continue attempt=%d clicked path=%s",
                    attemptNumber,
                    endedActionPath
                );
                // Poll for screen transition away from auction_ended (replaces SleepInterruptibly(1500))
                {
                    PollWaitResult wr = WaitForScreenTransition("auction_ended", 3000, 150);
                    if (wr.result == POLL_AUTHCODE) {
                        Logf("AutoAuction interrupted: AuthCode_Main detected during cleanup transition");
                        sendAuthCodeRequired();
                        return;
                    }
                    if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
                }
                ScreenState afterContinue = DetectScreenState();
                Logf(
                    "AutoAuction cleanup continue attempt=%d post-screen=%s",
                    attemptNumber,
                    afterContinue.screen ? afterContinue.screen : "null"
                );
                continue;
            }

            if (IsAutoAuctionCleanupBattlePrevScreen(se.screen)) {
                if (!se.battlePrevTransform) {
                    if (!SleepInterruptibly(200)) { stopIfRequested(); return; }  // was 1000ms
                    continue;
                }
                std::string e;
                if (!ClickNode(se.battlePrevTransform, "Top/Close", 0, &e)) {
                    if (stopIfRequested()) return;
                    SendResponse(c, id, false, "auto_auction_ui_error:wait_cleanup_transition");
                    return;
                }
                // Poll for screen transition (replaces SleepInterruptibly(1500))
                {
                    const char* leavingSc = se.screen;
                    PollWaitResult wr = WaitForScreenTransition(leavingSc, 3000, 150);
                    if (wr.result == POLL_AUTHCODE) {
                        Logf("AutoAuction interrupted: AuthCode_Main detected during cleanup close");
                        sendAuthCodeRequired();
                        return;
                    }
                    if (wr.result == POLL_INTERRUPTED) { stopIfRequested(); return; }
                }
                continue;
            }

            if (!IsAutoAuctionCleanupRecoverableScreen(se.screen)) {
                if (stopIfRequested()) return;
                char msg[160];
                snprintf(msg, sizeof(msg),
                    "auto_auction_unexpected_screen:%s",
                    se.screen ? se.screen : "null");
                SendResponse(c, id, false, msg);
                return;
            }
        }

        if (!cleanupComplete) {
            if (stopIfRequested()) return;
            SendResponse(c, id, false, "auto_auction_timeout:wait_cleanup_transition");
            return;
        }
    }

    char result[128];
    snprintf(result, sizeof(result),
        "{\"result\":\"auction_ended\",\"rounds\":%d,\"expectedPrice\":%d}",
        roundsPlayed,
        ResolveAutoAuctionReportedExpectedPrice(lastExpectedPrice, g_notifiedExpectedPrice.load()));
    SendResponse(c, id, true, result);
}
