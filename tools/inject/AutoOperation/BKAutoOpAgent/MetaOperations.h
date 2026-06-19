#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <vector>
#include <string>
#include <limits.h>
#include "../protocol.h"

// Minimal IL2CPP types needed by shared structs and function signatures
typedef void Il2CppObject;
typedef void Il2CppClass;
typedef void Il2CppMethod;
typedef const Il2CppMethod* (*fn_class_get_method_from_name)(Il2CppClass*, const char*, int);

// --------------------------------------------------------------------------
// UI component / node types (shared between BKAutoOpAgent and MetaOperations)
// --------------------------------------------------------------------------

struct UiComponentRefs {
    Il2CppObject* button       = nullptr;
    Il2CppObject* toggle       = nullptr;
    Il2CppObject* tmpInput     = nullptr;
    Il2CppObject* numericInput = nullptr;
    Il2CppObject* tmpText      = nullptr;
    Il2CppObject* legacyText   = nullptr;
};

struct UiNodeSnapshot {
    Il2CppObject* transform = nullptr;
    std::string   path;
    std::string   name;
    int           depth       = 0;
    bool          active      = false;
    bool          interactive = false;
    UiComponentRefs components;
};

enum UiPanelLookupResult {
    UI_PANEL_FOUND = 0,
    UI_PANEL_NOT_VISIBLE,
    UI_PANEL_INSTANCE_NOT_FOUND,
    UI_PANEL_LOOKUP_ERROR
};

enum UiPathMode {
    UI_PATH_EXACT = 0,
    UI_PATH_GLOB
};

// --------------------------------------------------------------------------
// Connection type
// --------------------------------------------------------------------------

struct AgentConn {
    HANDLE           pipe;
    CRITICAL_SECTION writeMutex;
    volatile bool    closing;
};

// --------------------------------------------------------------------------
// Globals and helpers defined in BKAutoOpAgent.cpp, used by MetaOperations
// --------------------------------------------------------------------------

extern bool                       g_il2cppReady;
extern fn_class_get_method_from_name g_class_get_method_from_name;
extern volatile LONG             g_shuttingDown;

Il2CppClass*        FindClass(const char* name);
Il2CppObject*       SafeInvoke(const Il2CppMethod* m, void* obj, void** args);
const char*         ObjClassName(Il2CppObject* obj);
void                Logf(const char* fmt, ...);

void                SendResponse(AgentConn* c, const char* id, bool ok, const char* result);
UiPanelLookupResult FindVisiblePanelTransform(const char* panelName,
                                               Il2CppObject** panelObj,
                                               Il2CppObject** panelTransform,
                                               char* error, int errorSize);
bool                CollectActiveDirectChildSnapshots(Il2CppObject* parent,
                                                      std::vector<UiNodeSnapshot>* children);
bool                ResolveUiNodeMatches(Il2CppObject* anchor, const char* path,
                                         UiPathMode pathMode, int maxMatches,
                                         std::vector<UiNodeSnapshot>* matches);
bool                PerformButtonClick(Il2CppObject* buttonComponent);
bool                PerformSetInputText(const UiNodeSnapshot& node, const char* text, bool submit, std::string* componentName);
bool                ReadNodeTextValue(const UiComponentRefs& refs, std::string* out);

// --------------------------------------------------------------------------
// Meta-operation commands (defined in MetaOperations.cpp)
// --------------------------------------------------------------------------

void CmdGoToBattlePrev(AgentConn* c, const char* id, const char* json);
void CmdEnterRoom(AgentConn* c, const char* id, const char* json);
void CmdOpenSkillConfig(AgentConn* c, const char* id, const char* json);
void CmdSelectRole(AgentConn* c, const char* id, const char* json);
void CmdStartAction(AgentConn* c, const char* id, const char* json);
void CmdGetBidState(AgentConn* c, const char* id, const char* json);
void CmdPlaceBid(AgentConn* c, const char* id, const char* json);
void CmdSetBidAmount(AgentConn* c, const char* id, const char* json);
void CmdConfirmBid(AgentConn* c, const char* id, const char* json);
void CmdDismissRewardsBox(AgentConn* c, const char* id, const char* json);
void CmdDismissCollectAward(AgentConn* c, const char* id, const char* json);
void CmdGetCurrentScreen(AgentConn* c, const char* id, const char* json);
void CmdCloseCurrentOverlay(AgentConn* c, const char* id, const char* json);
void CmdCollectCabinetReward(AgentConn* c, const char* id, const char* json);
void CmdAutoAuction(AgentConn* c, const char* id, const char* json);
void CmdCancelAutoAuction(AgentConn* c, const char* id, const char* json);
void CmdSetExpectedPrice(AgentConn* c, const char* id, const char* json);
