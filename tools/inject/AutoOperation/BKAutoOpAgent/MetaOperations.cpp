#include "MetaOperations.h"

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
// Only 开始竞拍 inside the room causes DLL unload.
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

// StartAction: click the 开始行动 button (ui_main_startbattle) in room detail view.
// Precondition: BattlePrevPanel_Main visible and in room detail view (MapPanel active).
// WARNING: clicking this button triggers a scene transition that unloads the DLL.
//          Response is sent BEFORE the click so it is delivered before the pipe drops.
// Returns {"clicked":true} — pipe will disconnect immediately after.
//         {"clicked":false,"reason":"..."} as no-op when preconditions unmet.
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

    // Send response before click — DLL unloads on scene transition
    SendResponse(c, id, true, "{\"clicked\":true}");
    PerformButtonClick(node.components.button);
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

// GetCurrentScreen: determine which UI screen is currently shown.
// Returns {"screen":"<name>"} where screen is one of:
//   "auction_in_progress"  — Battle_Main visible, Gaming active
//   "auction_ended"        — Battle_Main visible, EndPanel active
//   "auction_lobby_room"   — BattlePrevPanel_Main visible, in room detail (Panel_1/MapPanel active)
//   "auction_lobby_map"    — BattlePrevPanel_Main visible, in map view
//   "cabinet_reward_popup" — CollectAward_Main + RewardsBox both visible
//   "cabinet_reward_list"  — CollectAward_Main visible, no RewardsBox
//   "mailbox"              — Mail_Main visible
//   "exchange"             — TradingPanel visible
//   "battlepass"           — BattlePass_Main visible
//   "main_lobby"           — UIMain only, MainPanel active
//   "warehouse"            — UIMain only, MainPanel inactive
//   "unknown"              — none of the above
void CmdGetCurrentScreen(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    Il2CppObject* battleMainTransform = nullptr;
    Il2CppObject* battlePrevTransform = nullptr;
    Il2CppObject* uiMainTransform     = nullptr;
    char err[128] = {};

    bool hasBattleMain   = FindVisiblePanelTransform("Battle_Main",          nullptr, &battleMainTransform, err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasBattlePrev   = FindVisiblePanelTransform("BattlePrevPanel_Main", nullptr, &battlePrevTransform, err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasCollectAward = FindVisiblePanelTransform("CollectAward_Main",    nullptr, nullptr,               err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasRewardsBox   = FindVisiblePanelTransform("RewardsBox",           nullptr, nullptr,               err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasMailMain     = FindVisiblePanelTransform("Mail_Main",            nullptr, nullptr,               err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasTradingPanel = FindVisiblePanelTransform("TradingPanel",         nullptr, nullptr,               err, sizeof(err)) == UI_PANEL_FOUND;
    bool hasBattlePass   = FindVisiblePanelTransform("BattlePass_Main",      nullptr, nullptr,               err, sizeof(err)) == UI_PANEL_FOUND;
                           FindVisiblePanelTransform("UIMain",               nullptr, &uiMainTransform,      err, sizeof(err));

    const char* screen = "unknown";

    if (hasBattleMain && battleMainTransform) {
        std::vector<UiNodeSnapshot> endMatches, gamingMatches;
        ResolveUiNodeMatches(battleMainTransform, "EndPanel", UI_PATH_EXACT, 1, &endMatches);
        ResolveUiNodeMatches(battleMainTransform, "Gaming",   UI_PATH_EXACT, 1, &gamingMatches);
        bool endActive    = !endMatches.empty()    && endMatches[0].active;
        bool gamingActive = !gamingMatches.empty() && gamingMatches[0].active;
        if      (endActive)    screen = "auction_ended";
        else if (gamingActive) screen = "auction_in_progress";
        else                   screen = "auction_in_progress";
    } else if (hasBattlePrev && battlePrevTransform) {
        std::vector<UiNodeSnapshot> mapPanelMatches;
        ResolveUiNodeMatches(battlePrevTransform, "Panel_1/MapPanel", UI_PATH_EXACT, 1, &mapPanelMatches);
        bool mapPanelActive = !mapPanelMatches.empty() && mapPanelMatches[0].active;
        screen = mapPanelActive ? "auction_lobby_room" : "auction_lobby_map";
    } else if (hasCollectAward) {
        screen = hasRewardsBox ? "cabinet_reward_popup" : "cabinet_reward_list";
    } else if (hasMailMain) {
        screen = "mailbox";
    } else if (hasTradingPanel) {
        screen = "exchange";
    } else if (hasBattlePass) {
        screen = "battlepass";
    } else if (uiMainTransform) {
        std::vector<UiNodeSnapshot> mainPanelMatches;
        ResolveUiNodeMatches(uiMainTransform, "MainPanel", UI_PATH_EXACT, 1, &mainPanelMatches);
        bool mainPanelActive = !mainPanelMatches.empty() && mainPanelMatches[0].active;
        screen = mainPanelActive ? "main_lobby" : "warehouse";
    }

    char result[64];
    snprintf(result, sizeof(result), "{\"screen\":\"%s\"}", screen);
    SendResponse(c, id, true, result);
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
