#include "MetaOperations.h"
#include "AggregateOperationSemantics.h"
#include <atomic>

static std::atomic<int> g_expectedPrice{0};

// ==========================================================================
// Internal helpers
// ==========================================================================

static bool GetBattleMainPanel(AgentConn* c, const char* id, Il2CppObject** out);

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
                           FindVisiblePanelTransform("UIMain",               nullptr, &s.uiMainTransform,        err, sizeof(err));

    if (hasBattleMain && s.battleMainTransform) {
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
    if (m.empty() || !m[0].active || !m[0].components.button) {
        if (errOut) *errOut = std::string("node not ready: ") + path;
        return false;
    }
    if (!PerformButtonClick(m[0].components.button)) {
        if (errOut) *errOut = std::string("click failed: ") + path;
        return false;
    }
    if (delayMs > 0) Sleep(delayMs);
    return true;
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

// CollectCabinetReward: collect showcase cabinet rewards from anywhere.
// Steps:
//   1. Close overlays until screen is main_lobby or warehouse  [up to 10 attempts, 1.5s each]
//   2. If on main_lobby, open the warehouse panel               [1.5s]
//   3. Click UIMain/WareHousePanel/leftDown/Button[0] (查看)    [1.5s]
//   4. Verify cabinet_reward_list appeared
//   5. Click CollectAward_Main/Panel/down/Button (领取)         [1.5s]
//   6. If cabinet_reward_popup: click RewardsBox/bg             [1.5s]
//   7. Click CollectAward_Main/bg (close reward list)           [1.5s]
// Returns {"collected":true} or {"ok":false,"error":"..."}
void CmdCollectCabinetReward(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    // Step 1: close overlays until the cabinet reward entry is reachable.
    ScreenState stable = {};
    for (int attempt = 0; ; attempt++) {
        ScreenState cur = DetectScreenState();
        if (IsStableCabinetRewardEntryScreen(cur.screen)) {
            stable = cur;
            break;
        }
        if (attempt >= 10) {
            SendResponse(c, id, false, "could not reach cabinet reward entry after 10 close attempts");
            return;
        }
        Il2CppObject* t = nullptr; const char* p = nullptr;
        if (ResolveCloseTarget(cur, &t, &p)) {
            std::string err;
            ClickNode(t, p, 0, &err); // ignore individual click errors; retry loop handles it
        }
        Sleep(1500);
    }

    // Step 2: open warehouse if we are still on the main lobby.
    std::string err;
    if (ShouldOpenWarehouseForCabinetReward(stable.screen)) {
        if (!stable.uiMainTransform) { SendResponse(c, id, false, "UIMain not found"); return; }
        if (!ClickNode(stable.uiMainTransform, "MainPanel/Btns2/Button_1", 1500, &err)) {
            SendResponse(c, id, false, err.c_str()); return;
        }
        stable = DetectScreenState();
        if (strcmp(stable.screen, "warehouse") != 0) {
            char msg[128];
            snprintf(msg, sizeof(msg), "expected warehouse after opening it, got %s", stable.screen);
            SendResponse(c, id, false, msg); return;
        }
    }

    // Step 3: click 查看 (open cabinet reward list)
    if (!stable.uiMainTransform) { SendResponse(c, id, false, "UIMain not found"); return; }
    if (!ClickNode(stable.uiMainTransform, "WareHousePanel/leftDown/Button[0]", 1500, &err)) {
        SendResponse(c, id, false, err.c_str()); return;
    }

    // Step 4: verify cabinet_reward_list
    ScreenState s3 = DetectScreenState();
    if (strcmp(s3.screen, "cabinet_reward_list") != 0) {
        char msg[128];
        snprintf(msg, sizeof(msg), "expected cabinet_reward_list after 查看, got %s", s3.screen);
        SendResponse(c, id, false, msg); return;
    }

    // Step 5: click 领取
    if (!s3.collectAwardTransform) { SendResponse(c, id, false, "CollectAward_Main transform missing"); return; }
    if (!ClickNode(s3.collectAwardTransform, "Panel/down/Button", 1500, &err)) {
        SendResponse(c, id, false, err.c_str()); return;
    }

    // Step 6: dismiss RewardsBox popup if it appeared
    ScreenState s5 = DetectScreenState();
    if (strcmp(s5.screen, "cabinet_reward_popup") == 0 && s5.rewardsBoxTransform) {
        if (!ClickNode(s5.rewardsBoxTransform, "bg", 1500, &err)) {
            SendResponse(c, id, false, err.c_str()); return;
        }
    }

    // Step 7: close CollectAward_Main
    ScreenState s6 = DetectScreenState();
    if (s6.collectAwardTransform) {
        if (!ClickNode(s6.collectAwardTransform, "bg", 1500, &err)) {
            SendResponse(c, id, false, err.c_str()); return;
        }
    }

    SendResponse(c, id, true, "{\"collected\":true}");
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
    g_expectedPrice.store(price);
    char buf[64];
    snprintf(buf, sizeof(buf), "{\"price\":%d}", price);
    SendResponse(c, id, true, buf);
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

// AutoAuction: full automated auction sequence from main_lobby.
// Params: {"roomId":<int>, "bidAmount":<int>}  (defaults: roomId=101, bidAmount=25000)
// Steps:
//   1. Ensure main_lobby (close overlays if needed)
//   2. GoToBattlePrev → wait for auction_lobby_map                      [poll 1s, max 15s]
//   3. EnterRoom → wait for auction_lobby_room                          [poll 1s, max 15s]
//   4. OpenSkillConfig → SelectRole → StartAction                       [1.5s each]
//   5. Wait for auction_in_progress                                     [poll 1.5s, max 120s]
//   6. Bid loop: when secs < 30 in a new round → PlaceBid +
//               SetBidAmount + ConfirmBid; repeat until auction_ended
//   7. 快捷回收 (PanelBattleHuiShouTran/huishou, if active)
//   8. Exit: continueBtn → auction_lobby_map → BattlePrevPanel_Main/Top/Close → main_lobby
// Returns {"result":"auction_ended","rounds":<n>}
void CmdAutoAuction(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    int roomId    = JsonGetInt(json, "roomId");    if (roomId    == INT_MIN) roomId    = 101;
    int bidAmount = JsonGetInt(json, "bidAmount"); if (bidAmount == INT_MIN) bidAmount = 25000;

    bool useExpectedPrice = false;
    JsonGetBool(json, "useExpectedPrice", &useExpectedPrice);

    char errBuf[256] = {};

    auto clickOnPanel = [&](const char* panelName, const char* nodePath, int delayMs) -> bool {
        Il2CppObject* t = nullptr;
        if (FindVisiblePanelTransform(panelName, nullptr, &t, errBuf, sizeof(errBuf)) != UI_PANEL_FOUND || !t)
            return false;
        std::string e;
        bool ok = ClickNode(t, nodePath, delayMs, &e);
        if (!ok) snprintf(errBuf, sizeof(errBuf), "%s", e.c_str());
        return ok;
    };

    // Step 1: navigate to main_lobby
    for (int attempt = 0; ; attempt++) {
        ScreenState cur = DetectScreenState();
        if (strcmp(cur.screen, "main_lobby") == 0) break;
        if (attempt >= 10) { SendResponse(c, id, false, "could not reach main_lobby"); return; }
        Il2CppObject* t = nullptr; const char* p = nullptr;
        if (ResolveCloseTarget(cur, &t, &p)) { std::string e; ClickNode(t, p, 0, &e); }
        Sleep(1500);
    }

    // Step 2: GoToBattlePrev + wait for auction_lobby_map
    if (!clickOnPanel("UIMain", "MainPanel/mask/Button", 1500)) {
        SendResponse(c, id, false, errBuf[0] ? errBuf : "GoToBattlePrev failed"); return;
    }
    {
        bool found = false;
        for (int i = 0; i < 15; i++) {
            Sleep(1000);
            if (strcmp(DetectScreenState().screen, "auction_lobby_map") == 0) { found = true; break; }
        }
        if (!found) { SendResponse(c, id, false, "timeout waiting for auction_lobby_map"); return; }
    }

    // Step 3: EnterRoom + wait for auction_lobby_room
    {
        char roomPath[128];
        snprintf(roomPath, sizeof(roomPath), "Panel_1/bg/MapContainer/MapItem_%d/Image (1)", roomId);
        if (!clickOnPanel("BattlePrevPanel_Main", roomPath, 2000)) {
            SendResponse(c, id, false, errBuf[0] ? errBuf : "EnterRoom failed"); return;
        }
    }
    {
        bool found = false;
        for (int i = 0; i < 15; i++) {
            Sleep(1000);
            if (strcmp(DetectScreenState().screen, "auction_lobby_room") == 0) { found = true; break; }
        }
        if (!found) { SendResponse(c, id, false, "timeout waiting for auction_lobby_room"); return; }
    }

    // Step 4: OpenSkillConfig → SelectRole → StartAction
    if (!clickOnPanel("BattlePrevPanel_Main", "Panel_1/MapPanel/battleSet/Hero/Button", 1500)) {
        SendResponse(c, id, false, errBuf[0] ? errBuf : "OpenSkillConfig failed"); return;
    }
    if (!clickOnPanel("BattlePrevPanel_Main",
            "Panel_1/MapPanel/battleSet/HeroChoose/ScrollView/Viewport/Content/herochooseItem_103/button",
            1500)) {
        SendResponse(c, id, false, errBuf[0] ? errBuf : "SelectRole failed"); return;
    }
    if (!clickOnPanel("BattlePrevPanel_Main", "Panel_1/MapPanel/Button", 2000)) {
        SendResponse(c, id, false, errBuf[0] ? errBuf : "StartAction failed"); return;
    }

    // Step 5: wait for auction_in_progress
    {
        bool found = false;
        for (int i = 0; i < 80; i++) {
            Sleep(1500);
            const char* sc = DetectScreenState().screen;
            if (strcmp(sc, "auction_in_progress") == 0) { found = true; break; }
            if (strcmp(sc, "auction_ended") == 0) {
                char earlyResult[128];
                snprintf(earlyResult, sizeof(earlyResult),
                    "{\"result\":\"auction_ended\",\"rounds\":0,\"expectedPrice\":%d}",
                    g_expectedPrice.load());
                SendResponse(c, id, true, earlyResult); return;
            }
        }
        if (!found) { SendResponse(c, id, false, "timeout waiting for auction_in_progress"); return; }
    }

    // Step 6: bid loop
    std::string lastBidRound;
    std::string lastRoundSeen;
    int roundsEncountered = 0;
    int roundsPlayed = 0;
    int lastExpectedPrice = 0;

    for (;;) {
        Sleep(1000);
        ScreenState s = DetectScreenState();

        if (strcmp(s.screen, "auction_ended") == 0) break;
        if (strcmp(s.screen, "auction_in_progress") != 0 || !s.battleMainTransform) continue;

        std::string round;
        int secs = 9999;
        ReadBidState(s.battleMainTransform, &round, &secs);

        // Advance round counter on every new distinct in-game round
        if (!round.empty() && round != lastRoundSeen) {
            lastRoundSeen = round;
            roundsEncountered++;
        }

        if (secs < 30 && !round.empty() && round != lastBidRound) {
            int currentPrice = g_expectedPrice.load();
            int amount = useExpectedPrice
                ? ComputeBidAmount(currentPrice, roundsEncountered)
                : bidAmount;
            lastExpectedPrice = useExpectedPrice ? currentPrice : 0;

            if (amount == 0) continue; // skip — price not set yet

            std::string clickErr;
            bool placeBidClicked = ClickNode(s.battleMainTransform, "Gaming/chujia", 1500, &clickErr);
            bool hasBattleMainAfterClick = false;
            bool hasActiveBidInput = false;
            bool setBidAmountSucceeded = false;
            bool confirmBidClicked = false;

            if (placeBidClicked) {
                ScreenState s2 = DetectScreenState();
                hasBattleMainAfterClick = s2.battleMainTransform != nullptr;
                if (s2.battleMainTransform) {
                    std::vector<UiNodeSnapshot> inputM;
                    ResolveUiNodeMatches(s2.battleMainTransform,
                        "InputDevice/Panel1/InputField (TMP)", UI_PATH_EXACT, 1, &inputM);
                    hasActiveBidInput = !inputM.empty() && inputM[0].active;
                    if (hasActiveBidInput) {
                        char amountStr[32];
                        snprintf(amountStr, sizeof(amountStr), "%d", amount);
                        std::string compName;
                        setBidAmountSucceeded = PerformSetInputText(inputM[0], amountStr, false, &compName);
                        if (setBidAmountSucceeded) {
                            Sleep(500);
                            confirmBidClicked = ClickNode(s2.battleMainTransform, "InputDevice/Panel1/chujia", 1500, &clickErr);
                        }
                    }
                }
            }

            if (ShouldCountAutoAuctionRound(
                placeBidClicked,
                hasBattleMainAfterClick,
                hasActiveBidInput,
                setBidAmountSucceeded,
                confirmBidClicked
            )) {
                lastBidRound = round;
                roundsPlayed++;
            }
        }
    }

    // Step 7: 快捷回收 (if available)
    {
        ScreenState se = DetectScreenState();
        if (se.battleMainTransform) {
            std::vector<UiNodeSnapshot> huishouM;
            ResolveUiNodeMatches(se.battleMainTransform,
                "PanelBattleHuiShouTran/huishou", UI_PATH_EXACT, 1, &huishouM);
            if (!huishouM.empty() && huishouM[0].active && huishouM[0].components.button) {
                PerformButtonClick(huishouM[0].components.button);
                Sleep(1500);
            }
        }
    }

    // Step 8: exit to main_lobby — continueBtn → auction_lobby_map → Top/Close
    {
        ScreenState se = DetectScreenState();
        if (se.battleMainTransform) {
            std::string e;
            ClickNode(se.battleMainTransform, "EndPanel/tuichu/continueBtn", 1500, &e);
        }
    }
    {
        Il2CppObject* bpTransform = nullptr;
        char bpErr[128] = {};
        if (FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &bpTransform, bpErr, sizeof(bpErr)) == UI_PANEL_FOUND && bpTransform) {
            std::string e;
            ClickNode(bpTransform, "Top/Close", 1500, &e);
        }
    }

    char result[128];
    snprintf(result, sizeof(result),
        "{\"result\":\"auction_ended\",\"rounds\":%d,\"expectedPrice\":%d}",
        roundsPlayed, lastExpectedPrice);
    SendResponse(c, id, true, result);
}
