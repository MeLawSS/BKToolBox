#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include <stdlib.h>
#include <limits.h>
#include <algorithm>
#include <map>
#include <string>
#include <vector>
#include "../protocol.h"
#include "MoveStockItemResult.h"
#include "StockIdSemantics.h"
#include "TradeListSummary.h"
#include "UiMainThreadClickPlan.h"
#include "UiNodePathAddressing.h"
#include "WarehouseIdentity.h"
#include "WarehouseLayoutMatch.h"
#include "WarehouseLayoutSource.h"

// ==========================================================================
// IL2CPP types and globals (filled in Task 5)
// ==========================================================================
typedef void Il2CppDomain;
typedef void Il2CppAssembly;
typedef void Il2CppImage;
typedef void Il2CppClass;
typedef void Il2CppMethod;
typedef void Il2CppFieldInfo;
typedef void Il2CppObject;
typedef void Il2CppType;

#define FIELDINFO_OBJECT_OFFSET(f) (*(int32_t*)((char*)(f) + 24))
#define UNBOX_INT32(obj)  (*(int32_t*)((char*)(obj) + 16))
#define UNBOX_BOOL(obj)   (*(uint8_t*)((char*)(obj) + 16) != 0)

typedef Il2CppDomain*         (*fn_domain_get)();
typedef const Il2CppAssembly**(*fn_domain_get_assemblies)(const Il2CppDomain*, size_t*);
typedef Il2CppImage*          (*fn_assembly_get_image)(const Il2CppAssembly*);
typedef Il2CppClass*          (*fn_class_from_name)(Il2CppImage*, const char*, const char*);
typedef const char*           (*fn_class_get_name)(const Il2CppClass*);
typedef const Il2CppMethod*   (*fn_class_get_method_from_name)(Il2CppClass*, const char*, int);
typedef Il2CppObject*         (*fn_runtime_invoke)(const Il2CppMethod*, void*, void**, Il2CppObject**);
typedef Il2CppFieldInfo*      (*fn_class_get_field_from_name)(Il2CppClass*, const char*);
typedef void                  (*fn_field_static_get_value)(Il2CppFieldInfo*, void*);
typedef Il2CppClass*          (*fn_object_get_class)(Il2CppObject*);
typedef void*                 (*fn_thread_attach)(Il2CppDomain*);
typedef Il2CppObject*         (*fn_string_new)(const char*);
typedef Il2CppClass*          (*fn_class_get_parent)(Il2CppClass*);
typedef const Il2CppMethod*   (*fn_class_get_methods)(Il2CppClass*, void**);
typedef const char*           (*fn_method_get_name)(const Il2CppMethod*);
typedef uint32_t              (*fn_method_get_param_count)(const Il2CppMethod*);
typedef const Il2CppType*     (*fn_method_get_param)(const Il2CppMethod*, uint32_t);
typedef char*                 (*fn_type_get_name)(const Il2CppType*);
typedef const Il2CppType*     (*fn_class_get_type)(Il2CppClass*);
typedef Il2CppObject*         (*fn_type_get_object)(const Il2CppType*);
typedef void                  (*fn_free)(void*);

static fn_domain_get                 g_domain_get;
static fn_domain_get_assemblies      g_domain_get_assemblies;
static fn_assembly_get_image         g_assembly_get_image;
static fn_class_from_name            g_class_from_name;
static fn_class_get_name             g_class_get_name;
static fn_class_get_method_from_name g_class_get_method_from_name;
static fn_runtime_invoke             g_runtime_invoke;
static fn_class_get_field_from_name  g_class_get_field_from_name;
static fn_field_static_get_value     g_field_static_get_value;
static fn_object_get_class           g_object_get_class;
static fn_thread_attach              g_thread_attach;
static fn_string_new                 g_string_new;
static fn_class_get_parent           g_class_get_parent;
static fn_class_get_methods          g_class_get_methods;
static fn_method_get_name            g_method_get_name;
static fn_method_get_param_count     g_method_get_param_count;
static fn_method_get_param           g_method_get_param;
static fn_type_get_name              g_type_get_name;
static fn_class_get_type             g_class_get_type;
static fn_type_get_object            g_type_get_object;
static fn_free                       g_il2cpp_free;

static Il2CppDomain* g_domain    = nullptr;
static bool          g_il2cppReady = false;
static HINSTANCE     g_hModule = NULL;
static HANDLE        g_agentThread = NULL;
static HANDLE        g_heartbeatThread = NULL;
static volatile LONG g_shuttingDown = 0;
static volatile LONG g_unloadScheduled = 0;
static volatile LONG g_activeConnectionHandlers = 0;
static char          g_logPath[MAX_PATH] = {};
static CRITICAL_SECTION g_logCs;
static bool          g_logCsReady = false;
static bool          g_connsCsReady = false;
static bool          g_delayedTaskCsReady = false;

enum DelayedTaskState {
    DTS_IDLE = 0,
    DTS_SCHEDULED,
    DTS_RUNNING,
    DTS_COMPLETED,
    DTS_CANCELED,
    DTS_FAILED
};

struct DelayedPriceTask {
    char taskId[64];
    int itemCid;
    int delaySeconds;
    int jitterSeconds;
    int actualDelaySeconds;
    DWORD startedTick;
    DWORD dueTick;
    DelayedTaskState state;
    char error[256];
    char result[2048];
    HANDLE cancelEvent;
    HANDLE workerThread;
};

static CRITICAL_SECTION g_delayedTaskCs;
static DelayedPriceTask g_delayedTask = {};
static LONG             g_delayedTaskSeq = 0;

static DWORD WINAPI AgentMain(LPVOID);

#define GETFN(mod, name, var) \
    var = (decltype(var))GetProcAddress(mod, #name); \
    if (!var) return false;

// --- IL2CPP helpers ---

static Il2CppClass* FindClass(const char* name) {
    if (!g_domain) return nullptr;
    size_t count;
    const Il2CppAssembly** asms = g_domain_get_assemblies(g_domain, &count);
    const char* ns[] = { "", "BidKing", "Game", "Main", nullptr };
    for (size_t ai = 0; ai < count; ai++) {
        Il2CppImage* img = g_assembly_get_image(asms[ai]);
        if (!img) continue;
        for (int ni = 0; ns[ni]; ni++) {
            Il2CppClass* k = g_class_from_name(img, ns[ni], name);
            if (k) return k;
        }
    }
    return nullptr;
}

static Il2CppObject* GetSingleton(Il2CppClass* klass) {
    if (!klass) return nullptr;
    Il2CppFieldInfo* f = g_class_get_field_from_name(klass, "Instance");
    if (f) {
        Il2CppObject* inst = nullptr;
        g_field_static_get_value(f, &inst);
        if (inst) return inst;
    }
    const Il2CppMethod* m = g_class_get_method_from_name(klass, "get_Instance", 0);
    if (m) return (Il2CppObject*)g_runtime_invoke(m, nullptr, nullptr, nullptr);
    return nullptr;
}

static Il2CppObject* SafeInvoke(const Il2CppMethod* m, void* obj, void** args) {
    if (!m) return nullptr;
    Il2CppObject* exc = nullptr;
    Il2CppObject* res = g_runtime_invoke(m, obj, args, &exc);
    return exc ? nullptr : res;
}

static void InitLogPath() {
    if (g_logPath[0]) return;
    char userProfile[MAX_PATH] = {};
    DWORD n = GetEnvironmentVariableA("USERPROFILE", userProfile, MAX_PATH);
    if (n > 0 && n < MAX_PATH) {
        snprintf(g_logPath, sizeof(g_logPath), "%s\\Documents\\BidKing\\BKAutoOpAgent.log", userProfile);
        char dir[MAX_PATH] = {};
        snprintf(dir, sizeof(dir), "%s\\Documents\\BidKing", userProfile);
        CreateDirectoryA(dir, NULL);
    } else {
        snprintf(g_logPath, sizeof(g_logPath), "C:\\BKAutoOpAgent.log");
    }
}

static void Logf(const char* fmt, ...) {
    InitLogPath();
    if (g_logCsReady) EnterCriticalSection(&g_logCs);

    HANDLE h = CreateFileA(g_logPath, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
                           NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h != INVALID_HANDLE_VALUE) {
        SYSTEMTIME st;
        GetLocalTime(&st);
        char prefix[64];
        int prefixLen = snprintf(prefix, sizeof(prefix),
            "%04u-%02u-%02u %02u:%02u:%02u.%03u [tid=%lu] ",
            st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond,
            st.wMilliseconds, GetCurrentThreadId());
        DWORD written = 0;
        WriteFile(h, prefix, (DWORD)prefixLen, &written, NULL);

        char msg[2048];
        va_list ap;
        va_start(ap, fmt);
        int msgLen = vsnprintf(msg, sizeof(msg), fmt, ap);
        va_end(ap);
        if (msgLen < 0) msgLen = 0;
        if (msgLen >= (int)sizeof(msg)) msgLen = (int)sizeof(msg) - 1;
        WriteFile(h, msg, (DWORD)msgLen, &written, NULL);
        WriteFile(h, "\r\n", 2, &written, NULL);
        CloseHandle(h);
    }

    if (g_logCsReady) LeaveCriticalSection(&g_logCs);
}

static int ReadListCount(Il2CppObject* list) {
    if (!list) return 0;
    Il2CppClass* klass = g_object_get_class(list);
    const Il2CppMethod* m = g_class_get_method_from_name(klass, "get_Count", 0);
    if (!m) return 0;
    Il2CppObject* res = SafeInvoke(m, list, nullptr);
    return res ? UNBOX_INT32(res) : 0;
}

// List<T> internal layout: [klass 8][monitor 8][_items ptr 8][_size 4]...
// Array layout:            [klass 8][monitor 8][bounds 8][max_length 4][pad 4][data...]
static Il2CppObject* ReadListItem(Il2CppObject* list, int index) {
    if (!list) return nullptr;
    Il2CppObject* arr = *(Il2CppObject**)((char*)list + 16);
    if (!arr) return nullptr;
    return ((Il2CppObject**)((char*)arr + 32))[index];
}

static bool ReadIntFieldByNames(Il2CppObject* obj, const char* const* names, int32_t* out) {
    if (!obj || !names || !out) return false;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return false;
    for (int i = 0; names[i]; i++) {
        Il2CppFieldInfo* field = g_class_get_field_from_name(klass, names[i]);
        if (!field) continue;
        *out = *(int32_t*)((char*)obj + FIELDINFO_OBJECT_OFFSET(field));
        return true;
    }
    return false;
}

static bool ReadObjectFieldByNames(Il2CppObject* obj, const char* const* names, Il2CppObject** out) {
    if (!obj || !names || !out) return false;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return false;
    for (int i = 0; names[i]; i++) {
        Il2CppFieldInfo* field = g_class_get_field_from_name(klass, names[i]);
        if (!field) continue;
        *out = *(Il2CppObject**)((char*)obj + FIELDINFO_OBJECT_OFFSET(field));
        return true;
    }
    return false;
}

static bool ReadInt64FieldByNames(Il2CppObject* obj, const char* const* names, int64_t* out) {
    if (!obj || !names || !out) return false;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return false;
    for (int i = 0; names[i]; i++) {
        Il2CppFieldInfo* field = g_class_get_field_from_name(klass, names[i]);
        if (!field) continue;
        *out = *(int64_t*)((char*)obj + FIELDINFO_OBJECT_OFFSET(field));
        return true;
    }
    return false;
}

static bool ReadBoolFieldByNames(Il2CppObject* obj, const char* const* names, bool* out) {
    if (!obj || !names || !out) return false;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return false;
    for (int i = 0; names[i]; i++) {
        Il2CppFieldInfo* field = g_class_get_field_from_name(klass, names[i]);
        if (!field) continue;
        *out = *(uint8_t*)((char*)obj + FIELDINFO_OBJECT_OFFSET(field)) != 0;
        return true;
    }
    return false;
}

static const char* ObjClassName(Il2CppObject* obj) {
    if (!obj || !g_object_get_class) return "null";
    Il2CppClass* k = g_object_get_class(obj);
    return k ? g_class_get_name(k) : "unknown";
}

struct StockItemSnapshot {
    int64_t itemUid = 0;
    int itemId = 0;
    int itemCid = 0;
    int count = 0;
    int pos = -1;
    int stockId = 0;
    bool rotate = false;
    bool canTrade = false;
    bool canSale = false;
    bool isLock = false;
    std::vector<int> boxIds;
};

struct StockContainerSnapshot {
    int stockId = 0;
    int stockCid = 0;
    int width = 0;
    int height = 0;
    bool identityConfirmed = false;
    std::vector<StockItemSnapshot> items;
};

static StockContainerSnapshot* FindContainerSnapshot(std::vector<StockContainerSnapshot>& containers, int stockId) {
    for (size_t i = 0; i < containers.size(); i++) {
        if (containers[i].stockId == stockId) return &containers[i];
    }
    return nullptr;
}

static StockItemSnapshot* FindItemSnapshotByUid(std::vector<StockItemSnapshot>& items, int64_t itemUid) {
    for (size_t i = 0; i < items.size(); i++) {
        if (items[i].itemUid == itemUid) return &items[i];
    }
    return nullptr;
}

static const StockItemSnapshot* FindItemSnapshotByUid(const std::vector<StockItemSnapshot>& items, int64_t itemUid) {
    for (size_t i = 0; i < items.size(); i++) {
        if (items[i].itemUid == itemUid) return &items[i];
    }
    return nullptr;
}

static int CollectLayoutItemUidSample(const StockContainerSnapshot& container, int64_t* sample, int maxSample) {
    if (!sample || maxSample <= 0) return 0;
    int count = 0;
    for (size_t i = 0; i < container.items.size() && count < maxSample; i++) {
        if (container.items[i].itemUid > 0) sample[count++] = container.items[i].itemUid;
    }
    return count;
}

static void FormatItemUidSample(const int64_t* sample, int sampleCount, char* out, int outSize) {
    if (!out || outSize <= 0) return;
    out[0] = '\0';
    if (!sample || sampleCount <= 0) {
        snprintf(out, outSize, "-");
        return;
    }

    int offset = 0;
    for (int i = 0; i < sampleCount && offset < outSize; i++) {
        int written = snprintf(
            out + offset,
            outSize - offset,
            i == 0 ? "%lld" : ",%lld",
            (long long)sample[i]
        );
        if (written <= 0 || written >= outSize - offset) break;
        offset += written;
    }
}

static bool ReadWarehouseDimensions(Il2CppObject* warehouse, int* width, int* height) {
    const char* widthFields[] = { "width_", "width", nullptr };
    const char* heightFields[] = { "height_", "height", nullptr };
    return ReadIntFieldByNames(warehouse, widthFields, width) &&
        ReadIntFieldByNames(warehouse, heightFields, height);
}

static const Il2CppMethod* FindMethodByNames(Il2CppClass* klass, const char* const* names, int argCount);
static const Il2CppMethod* FindMethodBySignature(Il2CppClass* klass, const char* const* names, const char* const* paramTypes, int paramCount);

static bool ReadWarehouseStockData(Il2CppObject* warehouse, Il2CppObject** stockDataOut) {
    if (!warehouse || !stockDataOut) return false;
    *stockDataOut = nullptr;

    Il2CppClass* warehouseClass = g_object_get_class(warehouse);
    if (!warehouseClass) return false;

    const char* stockDataMethodNames[] = { "GetStockContainerData", nullptr };
    const Il2CppMethod* getStockContainerData = FindMethodByNames(warehouseClass, stockDataMethodNames, 0);
    if (!getStockContainerData) return false;

    *stockDataOut = (Il2CppObject*)SafeInvoke(getStockContainerData, warehouse, nullptr);
    return *stockDataOut != nullptr;
}

static const Il2CppMethod* FindMethodByNames(Il2CppClass* klass, const char* const* names, int argCount) {
    if (!klass || !names) return nullptr;
    for (int i = 0; names[i]; i++) {
        const Il2CppMethod* method = g_class_get_method_from_name(klass, names[i], argCount);
        if (method) return method;
    }
    return nullptr;
}

static bool TryGetWarehousesViaPlayerManager(Il2CppObject** warehouses, char* error, int errorSize) {
    if (!warehouses) return false;
    *warehouses = nullptr;

    Il2CppClass* pmClass = FindClass("PlayerManager");
    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) {
        snprintf(error, errorSize, "PlayerManager singleton null");
        return false;
    }

    const char* methodNames[] = { "GetWareHouseDatas", nullptr };
    const Il2CppMethod* getWareHouseDatas = FindMethodByNames(pmClass, methodNames, 0);
    if (!getWareHouseDatas) {
        snprintf(error, errorSize, "GetWareHouseDatas not found");
        return false;
    }

    *warehouses = (Il2CppObject*)SafeInvoke(getWareHouseDatas, pmInst, nullptr);
    if (!*warehouses) {
        snprintf(error, errorSize, "GetWareHouseDatas returned null");
        return false;
    }

    return true;
}

static bool TryGetWarehousesViaPlayerGameData(Il2CppObject** warehouses, char* error, int errorSize) {
    if (!warehouses) return false;
    *warehouses = nullptr;

    Il2CppClass* pgdClass = FindClass("PlayerGameData");
    if (!pgdClass) {
        snprintf(error, errorSize, "PlayerGameData class not found");
        return false;
    }

    Il2CppObject* pgdInst = GetSingleton(pgdClass);
    if (!pgdInst) {
        const char* instanceMethodNames[] = { "GetInstance", nullptr };
        const Il2CppMethod* getInstance = FindMethodByNames(pgdClass, instanceMethodNames, 0);
        pgdInst = getInstance ? (Il2CppObject*)SafeInvoke(getInstance, nullptr, nullptr) : nullptr;
    }
    if (!pgdInst) {
        snprintf(error, errorSize, "PlayerGameData instance unavailable");
        return false;
    }

    const char* wareHouseFields[] = { "wareHouses", "wareHouses_", nullptr };
    if (!ReadObjectFieldByNames(pgdInst, wareHouseFields, warehouses) || !*warehouses) {
        snprintf(error, errorSize, "PlayerGameData.wareHouses unavailable");
        return false;
    }

    return true;
}

static bool CollectWarehouseLayoutsFromList(Il2CppObject* warehouses, std::vector<StockContainerSnapshot>& out, char* error, int errorSize) {
    if (!warehouses) {
        snprintf(error, errorSize, "warehouse list null");
        return false;
    }

    const char* gridItemFields[] = { "gridItemDatas_", "gridItemDatas", nullptr };
    const char* stockIdFields[] = { "stockId_", "stockId", nullptr };
    const char* stockCidFields[] = { "stockCid_", "stockCid", nullptr };
    const char* warehouseUuidFields[] = { "uuid_", "uuid", nullptr };
    const char* warehouseCidFields[] = { "cid_", "cid", nullptr };
    const char* itemUidFields[] = { "uuid_", "uuid", nullptr };
    const char* itemIdFields[] = { "itemId_", "itemId", "cid_", "cid", nullptr };
    const char* posFields[] = { "pos_", "pos", nullptr };
    const char* rotateFields[] = { "rotate_", "rotate", nullptr };
    const char* gridStockIdFields[] = { "stockId_", "stockId", nullptr };
    const char* countFields[] = { "count_", "count", "itemCount_", "itemCount", nullptr };
    const char* canSaleFields[] = { "canSale_", "canSale", nullptr };
    const char* isLockFields[] = { "isLock_", "isLock", nullptr };

    int warehouseCount = ReadListCount(warehouses);
    for (int i = 0; i < warehouseCount; i++) {
        Il2CppObject* warehouse = ReadListItem(warehouses, i);
        if (!warehouse) continue;

        StockContainerSnapshot container = {};
        if (!ReadWarehouseDimensions(warehouse, &container.width, &container.height) ||
            container.width <= 0 || container.height <= 0) {
            Logf("GetStockContainers missing warehouse dimensions class=%s", ObjClassName(warehouse));
            continue;
        }

        int warehouseUuid = 0;
        int warehouseCid = 0;
        int fieldStockId = 0;
        int fieldStockCid = 0;
        int methodStockId = 0;
        int methodStockCid = 0;
        Il2CppObject* stockData = nullptr;
        if (ReadIntFieldByNames(warehouse, warehouseUuidFields, &warehouseUuid)) {
            container.stockId = warehouseUuid;
        }
        if (ReadIntFieldByNames(warehouse, warehouseCidFields, &warehouseCid)) {
            container.stockCid = warehouseCid;
        }

        const char* stockDataFields[] = { "stockData_", "stockData", nullptr };
        if (ReadObjectFieldByNames(warehouse, stockDataFields, &stockData) && stockData) {
            ReadIntFieldByNames(stockData, stockIdFields, &fieldStockId);
            ReadIntFieldByNames(stockData, stockCidFields, &fieldStockCid);
        }

        Il2CppObject* methodStockData = nullptr;
        if (ReadWarehouseStockData(warehouse, &methodStockData) && methodStockData) {
            ReadIntFieldByNames(methodStockData, stockIdFields, &methodStockId);
            ReadIntFieldByNames(methodStockData, stockCidFields, &methodStockCid);
        }

        WarehouseIdentity identity = ResolveWarehouseIdentity(
            fieldStockId,
            fieldStockCid,
            methodStockId,
            methodStockCid,
            warehouseUuid,
            warehouseCid
        );
        container.stockId = identity.stockId;
        container.stockCid = identity.stockCid;
        container.identityConfirmed = container.stockId > 0;

        Il2CppObject* gridItems = nullptr;
        if (ReadObjectFieldByNames(warehouse, gridItemFields, &gridItems) && gridItems) {
            int gridItemCount = ReadListCount(gridItems);
            for (int gi = 0; gi < gridItemCount; gi++) {
                Il2CppObject* gridItem = ReadListItem(gridItems, gi);
                if (!gridItem) continue;

                StockItemSnapshot item = {};
                ReadInt64FieldByNames(gridItem, itemUidFields, &item.itemUid);
                ReadIntFieldByNames(gridItem, itemIdFields, &item.itemId);
                ReadIntFieldByNames(gridItem, posFields, &item.pos);
                ReadBoolFieldByNames(gridItem, rotateFields, &item.rotate);
                ReadIntFieldByNames(gridItem, gridStockIdFields, &item.stockId);
                ReadIntFieldByNames(gridItem, countFields, &item.count);
                ReadBoolFieldByNames(gridItem, canSaleFields, &item.canSale);
                ReadBoolFieldByNames(gridItem, isLockFields, &item.isLock);
                if (item.count <= 0) item.count = 1;
                if (item.stockId <= 0) item.stockId = container.stockId;
                if (item.itemUid <= 0) continue;
                container.items.push_back(item);
            }
        }

        if (!container.identityConfirmed) {
            int64_t sample[3] = {};
            int sampleCount = CollectLayoutItemUidSample(container, sample, 3);
            char sampleText[96] = {};
            FormatItemUidSample(sample, sampleCount, sampleText, sizeof(sampleText));
            Logf(
                "GetStockContainers unresolved warehouse stockId class=%s uuid=%d cid=%d fieldStockId=%d methodStockId=%d size=%dx%d itemCount=%d sampleItemUids=%s",
                ObjClassName(warehouse),
                warehouseUuid,
                warehouseCid,
                fieldStockId,
                methodStockId,
                container.width,
                container.height,
                (int)container.items.size(),
                sampleText
            );
        }

        out.push_back(container);
    }

    if (out.empty()) {
        snprintf(error, errorSize, "no WareHouseData entries found");
        return false;
    }

    return true;
}

static bool CollectWarehouseLayouts(std::vector<StockContainerSnapshot>& out, char* error, int errorSize) {
    Il2CppObject* warehouses = nullptr;
    char primaryError[256] = {};
    char fallbackError[256] = {};

    WarehouseLayoutSource source = ResolveWarehouseLayoutSource(
        [&]() { return TryGetWarehousesViaPlayerManager(&warehouses, primaryError, sizeof(primaryError)); },
        [&]() { return TryGetWarehousesViaPlayerGameData(&warehouses, fallbackError, sizeof(fallbackError)); }
    );

    if (source == WAREHOUSE_LAYOUT_SOURCE_NONE) {
        snprintf(
            error,
            errorSize,
            "%s; %s",
            primaryError[0] ? primaryError : "GetWareHouseDatas unavailable",
            fallbackError[0] ? fallbackError : "PlayerGameData.wareHouses unavailable"
        );
        return false;
    }

    if (source == WAREHOUSE_LAYOUT_SOURCE_PLAYER_GAME_DATA_FIELD) {
        Logf("GetStockContainers fallback to PlayerGameData.wareHouses because %s", primaryError[0] ? primaryError : "GetWareHouseDatas unavailable");
    }

    return CollectWarehouseLayoutsFromList(warehouses, out, error, errorSize);
}

static bool MergeRawStockItemsIntoLayouts(Il2CppObject* containers, std::vector<StockContainerSnapshot>& layouts, char* error, int errorSize) {
    const char* stockIdFields[] = { "stockId_", "stockId", nullptr };
    const char* stockCidFields[] = { "stockCid_", "stockCid", nullptr };
    const char* stockBoxesFields[] = { "stockBoxes_", "stockBoxes", nullptr };
    const char* boxIdFields[] = { "boxId_", "boxId", nullptr };
    const char* itemFields[] = { "item_", "item", nullptr };
    const char* itemUidFields[] = { "uid_", "uid", nullptr };
    const char* itemCidFields[] = { "cid_", "cid", "itemCid_", "itemCid", nullptr };
    const char* countFields[] = { "count_", "count", "itemCount_", "itemCount", nullptr };
    const char* rotateFields[] = { "rotate_", "rotate", nullptr };
    const char* canTradeFields[] = { "canTrade_", "canTrade", nullptr };
    const char* isLockFields[] = { "isLock_", "isLock", nullptr };

    auto FormatLayoutItemUidSamples = [](const StockContainerSnapshot& layout, char* buffer, int bufferSize) {
        if (!buffer || bufferSize <= 0) return;
        buffer[0] = '\0';

        int offset = 0;
        int sampleCount = 0;
        for (size_t ii = 0; ii < layout.items.size() && sampleCount < 3; ii++) {
            if (layout.items[ii].itemUid <= 0) continue;
            int written = snprintf(
                buffer + offset,
                bufferSize - offset,
                "%s%lld",
                sampleCount > 0 ? "," : "",
                (long long)layout.items[ii].itemUid
            );
            if (written <= 0 || written >= bufferSize - offset) break;
            offset += written;
            sampleCount += 1;
        }

        if (sampleCount == 0) snprintf(buffer, bufferSize, "none");
    };

    auto FormatRawItemUidSamples = [&](Il2CppObject* stockBoxes, char* buffer, int bufferSize) {
        if (!buffer || bufferSize <= 0) return;
        buffer[0] = '\0';

        int64_t sampleUids[3] = {};
        int sampleCount = 0;
        int rawBoxCount = ReadListCount(stockBoxes);
        for (int bi = 0; bi < rawBoxCount && sampleCount < 3; bi++) {
            Il2CppObject* box = ReadListItem(stockBoxes, bi);
            if (!box) continue;

            Il2CppObject* item = nullptr;
            if (!ReadObjectFieldByNames(box, itemFields, &item) || !item) continue;

            int64_t itemUid = 0;
            if (!ReadInt64FieldByNames(item, itemUidFields, &itemUid) || itemUid <= 0) continue;

            bool seen = false;
            for (int si = 0; si < sampleCount; si++) {
                if (sampleUids[si] == itemUid) {
                    seen = true;
                    break;
                }
            }
            if (seen) continue;
            sampleUids[sampleCount++] = itemUid;
        }

        int offset = 0;
        for (int si = 0; si < sampleCount; si++) {
            int written = snprintf(
                buffer + offset,
                bufferSize - offset,
                "%s%lld",
                si > 0 ? "," : "",
                (long long)sampleUids[si]
            );
            if (written <= 0 || written >= bufferSize - offset) break;
            offset += written;
        }

        if (sampleCount == 0) snprintf(buffer, bufferSize, "none");
    };

    for (size_t li = 0; li < layouts.size(); li++) {
        if (layouts[li].identityConfirmed) continue;
        char layoutSamples[96] = {};
        FormatLayoutItemUidSamples(layouts[li], layoutSamples, sizeof(layoutSamples));
        Logf(
            "GetStockContainers unresolved layout candidate stockCid=%d size=%dx%d itemCount=%d sampleItemUids=%s",
            layouts[li].stockCid,
            layouts[li].width,
            layouts[li].height,
            (int)layouts[li].items.size(),
            layoutSamples
        );
    }

    int containerCount = ReadListCount(containers);
    for (int ci = 0; ci < containerCount; ci++) {
        Il2CppObject* container = ReadListItem(containers, ci);
        if (!container) continue;

        int rawStockId = 0;
        int rawStockCid = 0;
        ReadIntFieldByNames(container, stockIdFields, &rawStockId);
        ReadIntFieldByNames(container, stockCidFields, &rawStockCid);

        Il2CppObject* stockBoxes = nullptr;
        if (!ReadObjectFieldByNames(container, stockBoxesFields, &stockBoxes) || !stockBoxes) continue;

        int rawBoxCount = ReadListCount(stockBoxes);
        char rawSamples[96] = {};
        FormatRawItemUidSamples(stockBoxes, rawSamples, sizeof(rawSamples));
        if (ShouldSkipRawStockContainer(rawStockId)) {
            Logf(
                "GetStockContainers raw stock skipped rawIndex=%d rawStockId=%d rawStockCid=%d boxCount=%d sampleItemUids=%s",
                ci,
                rawStockId,
                rawStockCid,
                rawBoxCount,
                rawSamples
            );
            continue;
        }

        std::vector<WarehouseLayoutMatchCandidate> candidates;
        candidates.reserve(layouts.size());
        for (size_t li = 0; li < layouts.size(); li++) {
            WarehouseLayoutMatchCandidate candidate;
            candidate.stockId = layouts[li].stockId;
            candidate.stockCid = layouts[li].stockCid;
            for (size_t ii = 0; ii < layouts[li].items.size(); ii++) {
                if (layouts[li].items[ii].itemUid > 0) candidate.itemUids.push_back(layouts[li].items[ii].itemUid);
            }
            candidates.push_back(candidate);
        }

        int layoutIndex = FindWarehouseLayoutMatchIndex(candidates, rawStockId, rawStockCid, 0);
        if (layoutIndex < 0) {
            for (int bi = 0; bi < rawBoxCount && layoutIndex < 0; bi++) {
                Il2CppObject* box = ReadListItem(stockBoxes, bi);
                if (!box) continue;
                Il2CppObject* item = nullptr;
                if (!ReadObjectFieldByNames(box, itemFields, &item) || !item) continue;
                int64_t itemUid = 0;
                if (!ReadInt64FieldByNames(item, itemUidFields, &itemUid) || itemUid <= 0) continue;
                layoutIndex = FindWarehouseLayoutMatchIndex(candidates, rawStockId, 0, itemUid);
            }
        }
        if (layoutIndex < 0) {
            Logf(
                "GetStockContainers raw stock unmatched rawIndex=%d rawStockId=%d rawStockCid=%d boxCount=%d layoutCount=%d sampleItemUids=%s",
                ci,
                rawStockId,
                rawStockCid,
                rawBoxCount,
                (int)layouts.size(),
                rawSamples
            );
            continue;
        }

        StockContainerSnapshot* layout = &layouts[(size_t)layoutIndex];
        Logf(
            "GetStockContainers raw stock matched rawIndex=%d rawStockId=%d rawStockCid=%d boxCount=%d layoutIndex=%d layoutStockId=%d layoutStockCid=%d layoutItemCount=%d sampleItemUids=%s",
            ci,
            rawStockId,
            rawStockCid,
            rawBoxCount,
            layoutIndex,
            layout->stockId,
            layout->stockCid,
            (int)layout->items.size(),
            rawSamples
        );
        if (!layout->identityConfirmed && layout->stockId != rawStockId) {
            Logf(
                "GetStockContainers adopted raw stock identity rawStockId=%d rawStockCid=%d for unresolved warehouse layout stockCid=%d",
                rawStockId,
                rawStockCid,
                layout->stockCid
            );
        }
        if (!layout->identityConfirmed) {
            layout->stockId = rawStockId;
            for (size_t ii = 0; ii < layout->items.size(); ii++) {
                if (layout->items[ii].stockId <= 0) layout->items[ii].stockId = rawStockId;
            }
        }
        layout->identityConfirmed = true;
        if (layout->stockCid <= 0) layout->stockCid = rawStockCid;

        int boxCount = ReadListCount(stockBoxes);
        for (int bi = 0; bi < boxCount; bi++) {
            Il2CppObject* box = ReadListItem(stockBoxes, bi);
            if (!box) continue;

            Il2CppObject* item = nullptr;
            if (!ReadObjectFieldByNames(box, itemFields, &item) || !item) continue;

            int boxId = 0;
            int64_t itemUid = 0;
            if (!ReadIntFieldByNames(box, boxIdFields, &boxId) ||
                !ReadInt64FieldByNames(item, itemUidFields, &itemUid) ||
                itemUid <= 0) {
                continue;
            }

            StockItemSnapshot* snapshot = FindItemSnapshotByUid(layout->items, itemUid);
            if (!snapshot) {
                StockItemSnapshot created = {};
                created.itemUid = itemUid;
                created.stockId = rawStockId;
                layout->items.push_back(created);
                snapshot = &layout->items.back();
            }

            if (snapshot->itemCid <= 0) {
                ReadIntFieldByNames(item, itemCidFields, &snapshot->itemCid);
            }
            if (snapshot->count <= 0) {
                ReadIntFieldByNames(item, countFields, &snapshot->count);
                if (snapshot->count <= 0) snapshot->count = 1;
            }
            if (!snapshot->rotate) {
                ReadBoolFieldByNames(item, rotateFields, &snapshot->rotate);
            }
            if (!snapshot->canTrade) {
                ReadBoolFieldByNames(item, canTradeFields, &snapshot->canTrade);
            }
            if (!snapshot->isLock) {
                ReadBoolFieldByNames(item, isLockFields, &snapshot->isLock);
            }

            snapshot->boxIds.push_back(boxId);
            if (snapshot->pos < 0 || boxId < snapshot->pos) {
                snapshot->pos = boxId;
            }
        }
    }

    for (size_t ci = 0; ci < layouts.size(); ci++) {
        std::vector<StockItemSnapshot>& items = layouts[ci].items;
        for (size_t ii = 0; ii < items.size(); ii++) {
            std::sort(items[ii].boxIds.begin(), items[ii].boxIds.end());
            if (items[ii].count <= 0) items[ii].count = 1;
            if (items[ii].itemId <= 0) items[ii].itemId = items[ii].itemCid;
            if (items[ii].pos < 0 && !items[ii].boxIds.empty()) items[ii].pos = items[ii].boxIds.front();
        }
        std::sort(items.begin(), items.end(), [](const StockItemSnapshot& left, const StockItemSnapshot& right) {
            if (left.pos != right.pos) return left.pos < right.pos;
            return left.itemUid < right.itemUid;
        });
    }

    layouts.erase(
        std::remove_if(
            layouts.begin(),
            layouts.end(),
            [](const StockContainerSnapshot& layout) {
                if (ShouldKeepStockLayout(layout.stockId, layout.identityConfirmed)) return false;
                int64_t sample[3] = {};
                int sampleCount = CollectLayoutItemUidSample(layout, sample, 3);
                char sampleText[96] = {};
                FormatItemUidSample(sample, sampleCount, sampleText, sizeof(sampleText));
                Logf(
                    "GetStockContainers dropping unresolved layout stockCid=%d size=%dx%d itemCount=%d sampleItemUids=%s",
                    layout.stockCid,
                    layout.width,
                    layout.height,
                    (int)layout.items.size(),
                    sampleText
                );
                return true;
            }
        ),
        layouts.end()
    );

    (void)error;
    (void)errorSize;
    return true;
}

static bool BuildStockContainerJson(const std::vector<StockContainerSnapshot>& containers, const char* source, char* out, int outSize, char* error, int errorSize) {
    std::string json = "{\"containers\":[";
    for (size_t ci = 0; ci < containers.size(); ci++) {
        const StockContainerSnapshot& container = containers[ci];
        if (ci > 0) json += ",";
        json += "{";
        json += "\"stockId\":" + std::to_string(container.stockId);
        json += ",\"stockCid\":" + std::to_string(container.stockCid);
        json += ",\"width\":" + std::to_string(container.width);
        json += ",\"height\":" + std::to_string(container.height);
        json += ",\"boxCount\":" + std::to_string(container.width * container.height);
        json += ",\"items\":[";
        for (size_t ii = 0; ii < container.items.size(); ii++) {
            const StockItemSnapshot& item = container.items[ii];
            if (ii > 0) json += ",";
            json += "{";
            json += "\"itemUid\":\"" + std::to_string((long long)item.itemUid) + "\"";
            json += ",\"itemId\":" + std::to_string(item.itemId);
            json += ",\"itemCid\":" + std::to_string(item.itemCid);
            json += ",\"count\":" + std::to_string(item.count);
            json += ",\"pos\":" + std::to_string(item.pos);
            json += ",\"rotate\":";
            json += item.rotate ? "true" : "false";
            json += ",\"stockId\":" + std::to_string(item.stockId);
            json += ",\"boxCount\":" + std::to_string((int)item.boxIds.size());
            json += ",\"boxIds\":[";
            for (size_t bi = 0; bi < item.boxIds.size(); bi++) {
                if (bi > 0) json += ",";
                json += std::to_string(item.boxIds[bi]);
            }
            json += "]";
            json += ",\"canTrade\":";
            json += item.canTrade ? "true" : "false";
            json += ",\"canSale\":";
            json += item.canSale ? "true" : "false";
            json += ",\"isLock\":";
            json += item.isLock ? "true" : "false";
            json += "}";
        }
        json += "]}";
    }
    json += "],\"count\":" + std::to_string((int)containers.size());
    json += ",\"source\":\"";
    json += source ? source : "PlayerManager.GetAllStocks";
    json += "\"}";

    if ((int)json.size() >= outSize) {
        snprintf(error, errorSize, "stock container response too large");
        return false;
    }

    snprintf(out, outSize, "%s", json.c_str());
    return true;
}

static bool SerializeStockContainers(Il2CppObject* containers, const char* source, char* out, int outSize, char* error, int errorSize) {
    std::vector<StockContainerSnapshot> layouts;
    if (!CollectWarehouseLayouts(layouts, error, errorSize)) return false;
    if (!MergeRawStockItemsIntoLayouts(containers, layouts, error, errorSize)) return false;
    return BuildStockContainerJson(layouts, source, out, outSize, error, errorSize);
}

static bool BuildIl2CppTradeListSummaryJson(
    int itemCid,
    Il2CppObject* tradeList,
    int maxJsonTiers,
    char* out,
    int outSize,
    TradeListSummary* summaryOut
) {
    if (!tradeList) {
        if (out && outSize > 0) {
            snprintf(out, outSize,
                "{\"itemCid\":%d,\"resultClass\":\"null\",\"minPrice\":0,"
                "\"tierCount\":0,\"totalCount\":0,\"tiers\":[]}",
                itemCid
            );
        }
        if (summaryOut) *summaryOut = TradeListSummary{};
        return true;
    }

    int count = ReadListCount(tradeList);
    int* prices = NULL;
    int* counts = NULL;
    if (count > 0) {
        prices = (int*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(int) * (size_t)count);
        counts = (int*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(int) * (size_t)count);
        if (!prices || !counts) {
            if (prices) HeapFree(GetProcessHeap(), 0, prices);
            if (counts) HeapFree(GetProcessHeap(), 0, counts);
            return false;
        }
    }

    for (int i = 0; i < count; i++) {
        Il2CppObject* entry = ReadListItem(tradeList, i);
        if (!entry) continue;
        // ExchangeItemTradeInfo: price_ @24 (int32), peopleCount_ @28 (int32).
        prices[i] = *(int*)((char*)entry + 24);
        counts[i] = *(int*)((char*)entry + 28);
    }

    bool ok = BuildTradeListSummaryJson(
        itemCid,
        ObjClassName(tradeList),
        prices,
        counts,
        count,
        maxJsonTiers,
        out,
        outSize,
        summaryOut
    );

    if (prices) HeapFree(GetProcessHeap(), 0, prices);
    if (counts) HeapFree(GetProcessHeap(), 0, counts);
    return ok;
}

static bool InvokeBoolGetter(Il2CppObject* obj, const char* name, bool* out) {
    if (!obj || !out) return false;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return false;
    const Il2CppMethod* m = g_class_get_method_from_name(klass, name, 0);
    if (!m) return false;
    Il2CppObject* value = SafeInvoke(m, obj, nullptr);
    if (!value) return false;
    *out = UNBOX_BOOL(value);
    return true;
}

static bool InvokeIntGetter(Il2CppObject* obj, const char* name, int* out) {
    if (!obj || !out) return false;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return false;
    const Il2CppMethod* m = g_class_get_method_from_name(klass, name, 0);
    if (!m) return false;
    Il2CppObject* value = SafeInvoke(m, obj, nullptr);
    if (!value) return false;
    *out = UNBOX_INT32(value);
    return true;
}

struct UiComponentRefs {
    Il2CppObject* button = nullptr;
    Il2CppObject* toggle = nullptr;
    Il2CppObject* tmpInput = nullptr;
    Il2CppObject* numericInput = nullptr;
    Il2CppObject* tmpText = nullptr;
    Il2CppObject* legacyText = nullptr;
};

struct UiNodeSnapshot {
    Il2CppObject* transform = nullptr;
    std::string path;
    std::string name;
    int depth = 0;
    bool active = false;
    bool interactive = false;
    UiComponentRefs components;
};

struct UiNamedChild {
    Il2CppObject* transform = nullptr;
    std::string name;
    int occurrenceIndex = 0;
    int siblingCount = 1;
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

enum UiWaitState {
    UI_WAIT_EXISTS = 0,
    UI_WAIT_ACTIVE,
    UI_WAIT_INTERACTIVE
};

enum UiClickComponent {
    UI_CLICK_AUTO = 0,
    UI_CLICK_BUTTON,
    UI_CLICK_TOGGLE
};

struct UiTypeCache {
    bool initialized = false;
    Il2CppClass* buttonClass = nullptr;
    Il2CppClass* toggleClass = nullptr;
    Il2CppClass* tmpInputClass = nullptr;
    Il2CppClass* numericInputClass = nullptr;
    Il2CppClass* tmpTextClass = nullptr;
    Il2CppClass* legacyTextClass = nullptr;
    Il2CppObject* buttonType = nullptr;
    Il2CppObject* toggleType = nullptr;
    Il2CppObject* tmpInputType = nullptr;
    Il2CppObject* numericInputType = nullptr;
    Il2CppObject* tmpTextType = nullptr;
    Il2CppObject* legacyTextType = nullptr;
};

static UiTypeCache g_uiTypeCache = {};

struct UiMainThreadDispatcherCache {
    bool initialized = false;
    Il2CppClass* actionClass = nullptr;
    Il2CppClass* delegateClass = nullptr;
    Il2CppClass* dispatcherClass = nullptr;
    Il2CppObject* actionType = nullptr;
    const Il2CppMethod* createDelegateMethod = nullptr;
    const Il2CppMethod* initializeMethod = nullptr;
    const Il2CppMethod* runOnMainThreadMethod = nullptr;
};

static UiMainThreadDispatcherCache g_uiMainThreadDispatcherCache = {};

static bool JsonFieldExists(const char* json, const char* field) {
    if (!json || !field) return false;
    char needle[64];
    snprintf(needle, sizeof(needle), "\"%s\":", field);
    return strstr(json, needle) != nullptr;
}

static bool JsonGetStringBounded(const char* json, const char* field, char* out, int outSize, bool* present = nullptr) {
    if (present) *present = false;
    if (!json || !field || !out || outSize <= 0) return false;
    out[0] = '\0';
    char needle[64];
    snprintf(needle, sizeof(needle), "\"%s\":\"", field);
    const char* p = strstr(json, needle);
    if (!p) return false;
    if (present) *present = true;
    p += (int)strlen(needle);
    const char* e = strchr(p, '"');
    if (!e) return false;
    int len = (int)(e - p);
    if (len >= outSize) return false;
    memcpy(out, p, len);
    out[len] = '\0';
    return true;
}

static Il2CppClass* FindClassInNamespaces(const char* name, const char* const* namespaces) {
    if (!g_domain || !name || !namespaces) return nullptr;
    size_t count = 0;
    const Il2CppAssembly** asms = g_domain_get_assemblies(g_domain, &count);
    for (size_t ai = 0; ai < count; ai++) {
        Il2CppImage* img = g_assembly_get_image(asms[ai]);
        if (!img) continue;
        for (int ni = 0; namespaces[ni]; ni++) {
            Il2CppClass* klass = g_class_from_name(img, namespaces[ni], name);
            if (klass) return klass;
        }
    }
    return nullptr;
}

static Il2CppObject* GetTypeObjectForClass(Il2CppClass* klass) {
    if (!klass || !g_class_get_type || !g_type_get_object) return nullptr;
    const Il2CppType* type = g_class_get_type(klass);
    if (!type) return nullptr;
    return g_type_get_object(type);
}

static bool TryInvoke(const Il2CppMethod* method, void* obj, void** args, Il2CppObject** outResult = nullptr) {
    if (!method || !g_runtime_invoke) return false;
    Il2CppObject* exc = nullptr;
    Il2CppObject* result = g_runtime_invoke(method, obj, args, &exc);
    if (outResult) {
        *outResult = exc ? nullptr : result;
    }
    return exc == nullptr;
}

static void EnsureUiTypeCache() {
    if (g_uiTypeCache.initialized) return;

    const char* const buttonNamespaces[] = { "UnityEngine.UI", nullptr };
    const char* const toggleNamespaces[] = { "UnityEngine.UI", nullptr };
    const char* const tmpInputNamespaces[] = { "TMPro", nullptr };
    const char* const numericInputNamespaces[] = { "", "UI.Common", "Game", "Main", nullptr };
    const char* const tmpTextNamespaces[] = { "TMPro", nullptr };
    const char* const legacyTextNamespaces[] = { "UnityEngine.UI", nullptr };

    g_uiTypeCache.buttonClass = FindClassInNamespaces("Button", buttonNamespaces);
    g_uiTypeCache.toggleClass = FindClassInNamespaces("Toggle", toggleNamespaces);
    g_uiTypeCache.tmpInputClass = FindClassInNamespaces("TMP_InputField", tmpInputNamespaces);
    g_uiTypeCache.numericInputClass = FindClassInNamespaces("NumericInputField", numericInputNamespaces);
    g_uiTypeCache.tmpTextClass = FindClassInNamespaces("TMP_Text", tmpTextNamespaces);
    g_uiTypeCache.legacyTextClass = FindClassInNamespaces("Text", legacyTextNamespaces);

    g_uiTypeCache.buttonType = GetTypeObjectForClass(g_uiTypeCache.buttonClass);
    g_uiTypeCache.toggleType = GetTypeObjectForClass(g_uiTypeCache.toggleClass);
    g_uiTypeCache.tmpInputType = GetTypeObjectForClass(g_uiTypeCache.tmpInputClass);
    g_uiTypeCache.numericInputType = GetTypeObjectForClass(g_uiTypeCache.numericInputClass);
    g_uiTypeCache.tmpTextType = GetTypeObjectForClass(g_uiTypeCache.tmpTextClass);
    g_uiTypeCache.legacyTextType = GetTypeObjectForClass(g_uiTypeCache.legacyTextClass);
    g_uiTypeCache.initialized = true;
}

static void EnsureUiMainThreadDispatcherCache() {
    if (g_uiMainThreadDispatcherCache.initialized) return;

    const char* const systemNamespaces[] = { "System", nullptr };
    const char* const dispatcherNamespaces[] = { "", nullptr };
    const char* const createDelegateNames[] = { "CreateDelegate", nullptr };
    const char* const createDelegateParamTypes[] = { "System.Type", "System.Object", "System.String", nullptr };
    const char* const runOnMainThreadNames[] = { "RunOnMainThread", nullptr };
    const char* const runOnMainThreadParamTypes[] = { "System.Action", nullptr };
    const char* const initializeNames[] = { "Initialize", nullptr };

    g_uiMainThreadDispatcherCache.actionClass = FindClassInNamespaces("Action", systemNamespaces);
    g_uiMainThreadDispatcherCache.delegateClass = FindClassInNamespaces("Delegate", systemNamespaces);
    g_uiMainThreadDispatcherCache.dispatcherClass = FindClassInNamespaces("UnityMainThreadDispatcher", dispatcherNamespaces);
    g_uiMainThreadDispatcherCache.actionType = GetTypeObjectForClass(g_uiMainThreadDispatcherCache.actionClass);
    g_uiMainThreadDispatcherCache.createDelegateMethod = FindMethodBySignature(
        g_uiMainThreadDispatcherCache.delegateClass,
        createDelegateNames,
        createDelegateParamTypes,
        3
    );
    g_uiMainThreadDispatcherCache.initializeMethod = FindMethodByNames(
        g_uiMainThreadDispatcherCache.dispatcherClass,
        initializeNames,
        0
    );
    g_uiMainThreadDispatcherCache.runOnMainThreadMethod = FindMethodBySignature(
        g_uiMainThreadDispatcherCache.dispatcherClass,
        runOnMainThreadNames,
        runOnMainThreadParamTypes,
        1
    );
    g_uiMainThreadDispatcherCache.initialized = true;
}

static const Il2CppMethod* FindMethodBySignature(Il2CppClass* klass, const char* const* names, const char* const* paramTypes, int paramCount) {
    if (!klass || !names) return nullptr;
    if (!g_class_get_methods || !g_method_get_name || !g_method_get_param_count || !g_method_get_param || !g_type_get_name) {
        return FindMethodByNames(klass, names, paramCount);
    }

    for (Il2CppClass* current = klass; current; current = g_class_get_parent ? g_class_get_parent(current) : nullptr) {
        void* iter = nullptr;
        const Il2CppMethod* method = nullptr;
        while ((method = g_class_get_methods(current, &iter)) != nullptr) {
            const char* methodName = g_method_get_name(method);
            if (!methodName) continue;

            bool nameMatched = false;
            for (int i = 0; names[i]; i++) {
                if (strcmp(names[i], methodName) == 0) {
                    nameMatched = true;
                    break;
                }
            }
            if (!nameMatched) continue;
            if ((int)g_method_get_param_count(method) != paramCount) continue;

            bool signatureMatched = true;
            for (int pi = 0; pi < paramCount; pi++) {
                const Il2CppType* paramType = g_method_get_param(method, (uint32_t)pi);
                char* paramTypeName = paramType ? g_type_get_name(paramType) : nullptr;
                bool same = paramTypeName && paramTypes && paramTypes[pi] && strcmp(paramTypeName, paramTypes[pi]) == 0;
                if (g_il2cpp_free && paramTypeName) g_il2cpp_free(paramTypeName);
                if (!same) {
                    signatureMatched = false;
                    break;
                }
            }
            if (signatureMatched) return method;
        }
        if (!g_class_get_parent) break;
    }

    return nullptr;
}

static bool Il2CppStringToUtf8(Il2CppObject* obj, std::string* out) {
    if (!out) return false;
    out->clear();
    if (!obj) return false;
    int32_t length = *(int32_t*)((char*)obj + 16);
    if (length < 0) return false;
    const wchar_t* wide = (const wchar_t*)((char*)obj + 20);
    if (length == 0) return true;
    int utf8Bytes = WideCharToMultiByte(CP_UTF8, 0, wide, length, nullptr, 0, nullptr, nullptr);
    if (utf8Bytes <= 0) return false;
    out->resize((size_t)utf8Bytes);
    int written = WideCharToMultiByte(CP_UTF8, 0, wide, length, &(*out)[0], utf8Bytes, nullptr, nullptr);
    if (written != utf8Bytes) return false;
    return true;
}

static std::string EscapeJsonString(const std::string& value) {
    std::string out;
    out.reserve(value.size() + 16);
    for (size_t i = 0; i < value.size(); i++) {
        unsigned char ch = (unsigned char)value[i];
        switch (ch) {
            case '\\': out += "\\\\"; break;
            case '"': out += "\\\""; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (ch < 0x20) {
                    char escaped[8];
                    snprintf(escaped, sizeof(escaped), "\\u%04x", (unsigned int)ch);
                    out += escaped;
                } else {
                    out.push_back((char)ch);
                }
                break;
        }
    }
    return out;
}

static std::string JoinUiPath(const std::string& parent, const std::string& child) {
    if (parent.empty()) return child;
    if (child.empty()) return parent;
    return parent + "/" + child;
}

static void SplitUiPath(const char* path, std::vector<std::string>* segments) {
    if (!segments) return;
    segments->clear();
    if (!path || !path[0]) return;
    const char* start = path;
    const char* cursor = path;
    while (true) {
        if (*cursor == '/' || *cursor == '\0') {
            segments->push_back(std::string(start, (size_t)(cursor - start)));
            if (*cursor == '\0') break;
            start = cursor + 1;
        }
        cursor++;
    }
}

static bool GlobMatchRecursive(const char* pattern, const char* text) {
    if (!pattern || !text) return false;
    while (*pattern) {
        if (*pattern == '*') {
            pattern++;
            if (!*pattern) return true;
            while (*text) {
                if (GlobMatchRecursive(pattern, text)) return true;
                text++;
            }
            return GlobMatchRecursive(pattern, text);
        }
        if (*text == '\0' || *pattern != *text) return false;
        pattern++;
        text++;
    }
    return *text == '\0';
}

static bool InvokeBoolGetterByNames(Il2CppObject* obj, const char* const* names, bool* out) {
    if (!obj || !names || !out) return false;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return false;
    const Il2CppMethod* method = FindMethodByNames(klass, names, 0);
    if (!method) return false;
    Il2CppObject* value = SafeInvoke(method, obj, nullptr);
    if (!value) return false;
    *out = UNBOX_BOOL(value);
    return true;
}

static bool InvokeIntGetterByNames(Il2CppObject* obj, const char* const* names, int* out) {
    if (!obj || !names || !out) return false;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return false;
    const Il2CppMethod* method = FindMethodByNames(klass, names, 0);
    if (!method) return false;
    Il2CppObject* value = SafeInvoke(method, obj, nullptr);
    if (!value) return false;
    *out = UNBOX_INT32(value);
    return true;
}

static Il2CppObject* InvokeObjectGetterByNames(Il2CppObject* obj, const char* const* names) {
    if (!obj || !names) return nullptr;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return nullptr;
    const Il2CppMethod* method = FindMethodByNames(klass, names, 0);
    if (!method) return nullptr;
    return SafeInvoke(method, obj, nullptr);
}

static bool InvokeNoArgMethodByNames(Il2CppObject* obj, const char* const* names) {
    if (!obj || !names) return false;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return false;
    const Il2CppMethod* method = FindMethodByNames(klass, names, 0);
    if (!method) return false;
    SafeInvoke(method, obj, nullptr);
    return true;
}

static bool InvokeStringGetterByNames(Il2CppObject* obj, const char* const* names, std::string* out) {
    if (!obj || !names || !out) return false;
    Il2CppObject* value = InvokeObjectGetterByNames(obj, names);
    return Il2CppStringToUtf8(value, out);
}

static bool InvokeStringSetterByNames(Il2CppObject* obj, const char* const* names, const char* value) {
    if (!obj || !names || !value || !g_string_new) return false;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return false;
    const char* const paramTypes[] = { "System.String", nullptr };
    const Il2CppMethod* method = FindMethodBySignature(klass, names, paramTypes, 1);
    if (!method) return false;
    Il2CppObject* valueStr = g_string_new(value);
    void* args[] = { valueStr };
    SafeInvoke(method, obj, args);
    return true;
}

static Il2CppObject* CreateManagedActionDelegate(Il2CppObject* targetObj, const char* methodName) {
    if (!targetObj || !methodName || !g_string_new) return nullptr;
    EnsureUiMainThreadDispatcherCache();
    if (!g_uiMainThreadDispatcherCache.actionType || !g_uiMainThreadDispatcherCache.createDelegateMethod) {
        return nullptr;
    }

    Il2CppObject* methodNameObj = g_string_new(methodName);
    if (!methodNameObj) return nullptr;

    void* args[] = {
        g_uiMainThreadDispatcherCache.actionType,
        targetObj,
        methodNameObj,
    };
    Il2CppObject* delegateObj = nullptr;
    if (!TryInvoke(g_uiMainThreadDispatcherCache.createDelegateMethod, nullptr, args, &delegateObj)) {
        return nullptr;
    }
    return delegateObj;
}

static bool QueueManagedActionOnMainThread(Il2CppObject* actionObj) {
    if (!actionObj) return false;
    EnsureUiMainThreadDispatcherCache();
    if (!g_uiMainThreadDispatcherCache.runOnMainThreadMethod) return false;

    if (g_uiMainThreadDispatcherCache.initializeMethod) {
        TryInvoke(g_uiMainThreadDispatcherCache.initializeMethod, nullptr, nullptr, nullptr);
    }

    void* args[] = { actionObj };
    return TryInvoke(g_uiMainThreadDispatcherCache.runOnMainThreadMethod, nullptr, args, nullptr);
}

static bool QueueManagedNoArgActionOnMainThread(Il2CppObject* targetObj, const char* methodName, const char* fallbackMethodName = nullptr) {
    Il2CppObject* actionObj = CreateManagedActionDelegate(targetObj, methodName);
    if (!actionObj && fallbackMethodName) {
        actionObj = CreateManagedActionDelegate(targetObj, fallbackMethodName);
    }
    if (!actionObj) return false;
    return QueueManagedActionOnMainThread(actionObj);
}

static bool InvokeBoolSetterByNames(Il2CppObject* obj, const char* const* names, bool value) {
    if (!obj || !names) return false;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return false;
    const char* const paramTypes[] = { "System.Boolean", nullptr };
    const Il2CppMethod* method = FindMethodBySignature(klass, names, paramTypes, 1);
    if (!method) return false;
    bool argValue = value;
    void* args[] = { &argValue };
    SafeInvoke(method, obj, args);
    return true;
}

static Il2CppObject* InvokeTypeArgObjectMethodByNames(Il2CppObject* obj, const char* const* names, Il2CppObject* typeObj) {
    if (!obj || !names || !typeObj) return nullptr;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return nullptr;
    const char* const paramTypes[] = { "System.Type", nullptr };
    const Il2CppMethod* method = FindMethodBySignature(klass, names, paramTypes, 1);
    if (!method) return nullptr;
    void* args[] = { typeObj };
    return SafeInvoke(method, obj, args);
}

static Il2CppObject* InvokeStringArgObjectMethodByNames(Il2CppObject* obj, const char* const* names, const char* value) {
    if (!obj || !names || !value || !g_string_new) return nullptr;
    Il2CppClass* klass = g_object_get_class(obj);
    if (!klass) return nullptr;
    const char* const paramTypes[] = { "System.String", nullptr };
    const Il2CppMethod* method = FindMethodBySignature(klass, names, paramTypes, 1);
    if (!method) return nullptr;
    Il2CppObject* valueStr = g_string_new(value);
    void* args[] = { valueStr };
    return SafeInvoke(method, obj, args);
}

static bool InvokeStringEventByGetterNames(Il2CppObject* obj, const char* const* getterNames, const char* value) {
    if (!obj || !getterNames || !value || !g_string_new) return false;
    Il2CppObject* eventObj = InvokeObjectGetterByNames(obj, getterNames);
    if (!eventObj) return false;
    Il2CppClass* eventClass = g_object_get_class(eventObj);
    if (!eventClass) return false;
    const char* const paramTypes[] = { "System.String", nullptr };
    const char* const invokeNames[] = { "Invoke", nullptr };
    const Il2CppMethod* invoke = FindMethodBySignature(eventClass, invokeNames, paramTypes, 1);
    if (!invoke) return false;
    Il2CppObject* valueStr = g_string_new(value);
    void* args[] = { valueStr };
    SafeInvoke(invoke, eventObj, args);
    return true;
}

static Il2CppObject* GetTransformObject(Il2CppObject* obj) {
    const char* const names[] = { "get_transform", nullptr };
    return InvokeObjectGetterByNames(obj, names);
}

static Il2CppObject* GetGameObjectObject(Il2CppObject* obj) {
    const char* const names[] = { "get_gameObject", nullptr };
    return InvokeObjectGetterByNames(obj, names);
}

static bool GetObjectNameUtf8(Il2CppObject* obj, std::string* out) {
    const char* const names[] = { "get_name", nullptr };
    return InvokeStringGetterByNames(obj, names, out);
}

static int GetTransformChildCount(Il2CppObject* transform) {
    const char* const names[] = { "get_childCount", "get_ChildCount", nullptr };
    int value = 0;
    return InvokeIntGetterByNames(transform, names, &value) ? value : 0;
}

static Il2CppObject* GetTransformChild(Il2CppObject* transform, int index) {
    if (!transform) return nullptr;
    Il2CppClass* klass = g_object_get_class(transform);
    if (!klass) return nullptr;
    const char* const methodNames[] = { "GetChild", nullptr };
    const char* const paramTypes[] = { "System.Int32", nullptr };
    const Il2CppMethod* method = FindMethodBySignature(klass, methodNames, paramTypes, 1);
    if (!method) return nullptr;
    int argIndex = index;
    void* args[] = { &argIndex };
    return SafeInvoke(method, transform, args);
}

static bool GetNodeActiveInHierarchy(Il2CppObject* transform) {
    Il2CppObject* gameObject = GetGameObjectObject(transform);
    if (!gameObject) return false;
    const char* const activeInHierarchyNames[] = { "get_activeInHierarchy", nullptr };
    bool active = false;
    if (InvokeBoolGetterByNames(gameObject, activeInHierarchyNames, &active)) return active;
    const char* const activeSelfNames[] = { "get_activeSelf", nullptr };
    if (InvokeBoolGetterByNames(gameObject, activeSelfNames, &active)) return active;
    return false;
}

static Il2CppObject* GetComponentByTypeOrName(Il2CppObject* target, Il2CppObject* typeObj, const char* className) {
    if (!target) return nullptr;
    const char* const getComponentNames[] = { "GetComponent", nullptr };
    if (typeObj) {
        Il2CppObject* component = InvokeTypeArgObjectMethodByNames(target, getComponentNames, typeObj);
        if (component) return component;
    }
    if (className) {
        Il2CppObject* component = InvokeStringArgObjectMethodByNames(target, getComponentNames, className);
        if (component) return component;
    }
    return nullptr;
}

static void InspectUiNodeComponents(Il2CppObject* transform, UiComponentRefs* refs) {
    if (!transform || !refs) return;
    EnsureUiTypeCache();
    Il2CppObject* gameObject = GetGameObjectObject(transform);

    refs->button = GetComponentByTypeOrName(transform, g_uiTypeCache.buttonType, "Button");
    if (!refs->button && gameObject) refs->button = GetComponentByTypeOrName(gameObject, g_uiTypeCache.buttonType, "Button");

    refs->toggle = GetComponentByTypeOrName(transform, g_uiTypeCache.toggleType, "Toggle");
    if (!refs->toggle && gameObject) refs->toggle = GetComponentByTypeOrName(gameObject, g_uiTypeCache.toggleType, "Toggle");

    refs->tmpInput = GetComponentByTypeOrName(transform, g_uiTypeCache.tmpInputType, "TMP_InputField");
    if (!refs->tmpInput && gameObject) refs->tmpInput = GetComponentByTypeOrName(gameObject, g_uiTypeCache.tmpInputType, "TMP_InputField");

    refs->numericInput = GetComponentByTypeOrName(transform, g_uiTypeCache.numericInputType, "NumericInputField");
    if (!refs->numericInput && gameObject) refs->numericInput = GetComponentByTypeOrName(gameObject, g_uiTypeCache.numericInputType, "NumericInputField");

    refs->tmpText = GetComponentByTypeOrName(transform, g_uiTypeCache.tmpTextType, "TMP_Text");
    if (!refs->tmpText && gameObject) refs->tmpText = GetComponentByTypeOrName(gameObject, g_uiTypeCache.tmpTextType, "TMP_Text");

    refs->legacyText = GetComponentByTypeOrName(transform, g_uiTypeCache.legacyTextType, "Text");
    if (!refs->legacyText && gameObject) refs->legacyText = GetComponentByTypeOrName(gameObject, g_uiTypeCache.legacyTextType, "Text");
}

static bool ReadComponentInteractable(Il2CppObject* component, bool* out) {
    if (!component || !out) return false;
    const char* const isInteractableNames[] = { "IsInteractable", "get_interactable", nullptr };
    return InvokeBoolGetterByNames(component, isInteractableNames, out);
}

static bool DetermineUiNodeInteractive(const UiComponentRefs& refs, bool active) {
    if (!active) return false;
    bool interactive = false;
    bool value = false;
    if (refs.button) interactive |= ReadComponentInteractable(refs.button, &value) ? value : true;
    if (refs.toggle) interactive |= ReadComponentInteractable(refs.toggle, &value) ? value : true;
    if (refs.tmpInput) interactive |= ReadComponentInteractable(refs.tmpInput, &value) ? value : true;
    if (refs.numericInput && !refs.tmpInput) interactive |= ReadComponentInteractable(refs.numericInput, &value) ? value : true;
    return interactive;
}

static bool ReadNodeTextValue(const UiComponentRefs& refs, std::string* out) {
    if (!out) return false;
    out->clear();
    const char* const textGetterNames[] = { "get_text", nullptr };
    if (refs.tmpInput && InvokeStringGetterByNames(refs.tmpInput, textGetterNames, out)) return true;
    if (refs.numericInput && InvokeStringGetterByNames(refs.numericInput, textGetterNames, out)) return true;
    if (refs.tmpText && InvokeStringGetterByNames(refs.tmpText, textGetterNames, out)) return true;
    if (refs.legacyText && InvokeStringGetterByNames(refs.legacyText, textGetterNames, out)) return true;
    return false;
}

static bool ReadToggleValue(const UiComponentRefs& refs, bool* out) {
    if (!refs.toggle || !out) return false;
    const char* const names[] = { "get_isOn", nullptr };
    return InvokeBoolGetterByNames(refs.toggle, names, out);
}

static void InspectUiNode(Il2CppObject* transform, const std::string& relativePath, int depth, UiNodeSnapshot* out) {
    if (!transform || !out) return;
    out->transform = transform;
    out->path = relativePath;
    out->depth = depth;
    out->active = GetNodeActiveInHierarchy(transform);
    out->name.clear();
    if (!GetObjectNameUtf8(transform, &out->name)) {
        size_t slash = relativePath.find_last_of('/');
        out->name = slash == std::string::npos ? relativePath : relativePath.substr(slash + 1);
    }
    out->components = UiComponentRefs();
    InspectUiNodeComponents(transform, &out->components);
    out->interactive = DetermineUiNodeInteractive(out->components, out->active);
}

static void CollectNormalizedComponentTypes(const UiComponentRefs& refs, std::vector<std::string>* out) {
    if (!out) return;
    out->clear();
    if (refs.button) out->push_back("Button");
    if (refs.toggle) out->push_back("Toggle");
    if (refs.tmpInput) out->push_back("TMP_InputField");
    if (refs.numericInput) out->push_back("NumericInputField");
}

static std::string BuildComponentTypesJson(const UiComponentRefs& refs) {
    std::vector<std::string> types;
    CollectNormalizedComponentTypes(refs, &types);
    std::string json = "[";
    for (size_t i = 0; i < types.size(); i++) {
        if (i) json += ",";
        json += "\"";
        json += EscapeJsonString(types[i]);
        json += "\"";
    }
    json += "]";
    return json;
}

static void CollectNamedChildTransforms(Il2CppObject* parent, std::vector<UiNamedChild>* out) {
    if (!out) return;
    out->clear();
    if (!parent) return;

    std::vector<std::pair<Il2CppObject*, std::string> > rawChildren;
    std::map<std::string, int> siblingCounts;
    int childCount = GetTransformChildCount(parent);
    for (int i = 0; i < childCount; i++) {
        Il2CppObject* child = GetTransformChild(parent, i);
        if (!child) continue;
        std::string childName;
        if (!GetObjectNameUtf8(child, &childName)) continue;
        if (childName.empty()) continue;
        rawChildren.push_back(std::make_pair(child, childName));
        siblingCounts[childName] += 1;
    }

    std::map<std::string, int> occurrenceCounts;
    for (size_t i = 0; i < rawChildren.size(); i++) {
        UiNamedChild child;
        child.transform = rawChildren[i].first;
        child.name = rawChildren[i].second;
        child.occurrenceIndex = occurrenceCounts[child.name];
        child.siblingCount = siblingCounts[child.name];
        occurrenceCounts[child.name] += 1;
        out->push_back(child);
    }
}

static bool ResolveChildTransformBySegment(
    Il2CppObject* parent,
    const std::string& segment,
    Il2CppObject** outChild,
    std::string* outNormalizedSegment
) {
    if (outChild) *outChild = nullptr;
    if (outNormalizedSegment) outNormalizedSegment->clear();
    if (!parent || segment.empty()) return false;

    std::vector<UiNamedChild> children;
    CollectNamedChildTransforms(parent, &children);
    if (children.empty()) return false;

    std::vector<std::string> childNames;
    childNames.reserve(children.size());
    for (size_t i = 0; i < children.size(); i++) {
        childNames.push_back(children[i].name);
    }

    int childIndex = -1;
    std::string normalizedSegment;
    if (!ResolveUiChildAddress(childNames, segment, &childIndex, &normalizedSegment)) {
        return false;
    }
    if (childIndex < 0 || childIndex >= (int)children.size()) {
        return false;
    }

    if (outChild) *outChild = children[(size_t)childIndex].transform;
    if (outNormalizedSegment) *outNormalizedSegment = normalizedSegment;
    return true;
}

static bool ResolveExactRelativePath(Il2CppObject* anchor, const char* path, Il2CppObject** outTransform, std::string* outPath) {
    if (outTransform) *outTransform = nullptr;
    if (outPath) outPath->clear();
    if (!anchor || !path || !path[0]) return false;
    std::vector<std::string> segments;
    SplitUiPath(path, &segments);
    if (segments.empty()) return false;

    Il2CppObject* current = anchor;
    std::string resolvedPath;
    for (size_t i = 0; i < segments.size(); i++) {
        if (segments[i].empty()) return false;
        std::string normalizedSegment;
        if (!ResolveChildTransformBySegment(current, segments[i], &current, &normalizedSegment) || !current) {
            return false;
        }
        resolvedPath = JoinUiPath(resolvedPath, normalizedSegment);
    }

    if (outTransform) *outTransform = current;
    if (outPath) *outPath = resolvedPath;
    return true;
}

static UiPanelLookupResult FindVisiblePanelTransform(const char* panelName, Il2CppObject** panelObj, Il2CppObject** panelTransform, char* error, int errorSize) {
    if (panelObj) *panelObj = nullptr;
    if (panelTransform) *panelTransform = nullptr;
    if (error && errorSize > 0) error[0] = '\0';
    if (!panelName || !panelName[0]) {
        if (error && errorSize > 0) snprintf(error, errorSize, "missing panel");
        return UI_PANEL_LOOKUP_ERROR;
    }
    if (!g_il2cppReady) {
        if (error && errorSize > 0) snprintf(error, errorSize, "il2cpp not ready");
        return UI_PANEL_LOOKUP_ERROR;
    }

    Il2CppClass* uiBehaviorClass = FindClass("UIBehavior");
    if (!uiBehaviorClass) {
        if (error && errorSize > 0) snprintf(error, errorSize, "UIBehavior class not found");
        return UI_PANEL_LOOKUP_ERROR;
    }
    const Il2CppMethod* getAllShowed = g_class_get_method_from_name(uiBehaviorClass, "GetAllShowedBhvr", 0);
    if (!getAllShowed) {
        if (error && errorSize > 0) snprintf(error, errorSize, "UIBehavior.GetAllShowedBhvr not found");
        return UI_PANEL_LOOKUP_ERROR;
    }
    Il2CppObject* panelList = (Il2CppObject*)SafeInvoke(getAllShowed, nullptr, nullptr);
    if (!panelList) {
        if (error && errorSize > 0) snprintf(error, errorSize, "GetAllShowedBhvr returned null");
        return UI_PANEL_LOOKUP_ERROR;
    }

    int count = ReadListCount(panelList);
    for (int i = 0; i < count; i++) {
        Il2CppObject* candidate = ReadListItem(panelList, i);
        if (!candidate) continue;
        const char* className = ObjClassName(candidate);
        if (!className || strcmp(className, panelName) != 0) continue;
        Il2CppObject* transform = GetTransformObject(candidate);
        if (!transform) {
            if (panelObj) *panelObj = candidate;
            return UI_PANEL_INSTANCE_NOT_FOUND;
        }
        if (panelObj) *panelObj = candidate;
        if (panelTransform) *panelTransform = transform;
        return UI_PANEL_FOUND;
    }

    return UI_PANEL_NOT_VISIBLE;
}

static void CollectDumpNodesRecursive(
    Il2CppObject* parent,
    const std::string& parentPath,
    int depth,
    int maxDepth,
    bool interactiveOnly,
    bool includeInactive,
    int nodeLimit,
    std::vector<UiNodeSnapshot>* nodes,
    bool* truncated
) {
    if (!parent || !nodes || !truncated) return;
    if (*truncated || depth > maxDepth) return;

    std::vector<UiNamedChild> children;
    CollectNamedChildTransforms(parent, &children);
    for (size_t i = 0; i < children.size(); i++) {
        if (*truncated) return;
        Il2CppObject* child = children[i].transform;
        if (!child) continue;
        std::string childPath = JoinUiPath(
            parentPath,
            BuildUiAddressedSegment(children[i].name, children[i].occurrenceIndex, children[i].siblingCount)
        );

        UiNodeSnapshot snapshot;
        InspectUiNode(child, childPath, depth, &snapshot);

        if (!includeInactive && !snapshot.active) continue;

        if (!interactiveOnly || snapshot.interactive) {
            if ((int)nodes->size() >= nodeLimit) {
                *truncated = true;
                return;
            }
            nodes->push_back(snapshot);
        }

        if (depth < maxDepth) {
            CollectDumpNodesRecursive(
                child,
                childPath,
                depth + 1,
                maxDepth,
                interactiveOnly,
                includeInactive,
                nodeLimit,
                nodes,
                truncated
            );
        }
    }
}

static void CollectGlobMatchesRecursive(
    Il2CppObject* parent,
    const std::string& parentPath,
    const char* pattern,
    int maxMatches,
    std::vector<UiNodeSnapshot>* matches
) {
    if (!parent || !pattern || !matches) return;
    if (maxMatches > 0 && (int)matches->size() >= maxMatches) return;

    std::vector<UiNamedChild> children;
    CollectNamedChildTransforms(parent, &children);
    for (size_t i = 0; i < children.size(); i++) {
        if (maxMatches > 0 && (int)matches->size() >= maxMatches) return;
        Il2CppObject* child = children[i].transform;
        if (!child) continue;
        std::string childPath = JoinUiPath(
            parentPath,
            BuildUiAddressedSegment(children[i].name, children[i].occurrenceIndex, children[i].siblingCount)
        );
        if (GlobMatchRecursive(pattern, childPath.c_str())) {
            UiNodeSnapshot snapshot;
            int depth = 1;
            for (size_t pi = 0; pi < childPath.size(); pi++) {
                if (childPath[pi] == '/') depth++;
            }
            InspectUiNode(child, childPath, depth, &snapshot);
            matches->push_back(snapshot);
            if (maxMatches > 0 && (int)matches->size() >= maxMatches) return;
        }

        CollectGlobMatchesRecursive(child, childPath, pattern, maxMatches, matches);
    }
}

static bool ResolveUiNodeMatches(Il2CppObject* anchor, const char* path, UiPathMode pathMode, int maxMatches, std::vector<UiNodeSnapshot>* matches) {
    if (!matches) return false;
    matches->clear();
    if (!anchor || !path || !path[0]) return false;

    if (pathMode == UI_PATH_EXACT) {
        Il2CppObject* target = nullptr;
        std::string resolvedPath;
        if (!ResolveExactRelativePath(anchor, path, &target, &resolvedPath) || !target) return true;
        UiNodeSnapshot snapshot;
        int depth = 1;
        for (size_t i = 0; i < resolvedPath.size(); i++) {
            if (resolvedPath[i] == '/') depth++;
        }
        InspectUiNode(target, resolvedPath, depth, &snapshot);
        matches->push_back(snapshot);
        return true;
    }

    CollectGlobMatchesRecursive(anchor, "", path, maxMatches, matches);
    return true;
}

static bool ParseUiPathMode(const char* raw, UiPathMode* out) {
    if (!out || !raw || !raw[0]) return false;
    if (strcmp(raw, "exact") == 0) {
        *out = UI_PATH_EXACT;
        return true;
    }
    if (strcmp(raw, "glob") == 0) {
        *out = UI_PATH_GLOB;
        return true;
    }
    return false;
}

static bool ParseUiWaitState(const char* raw, UiWaitState* out) {
    if (!out || !raw || !raw[0]) return false;
    if (strcmp(raw, "exists") == 0) {
        *out = UI_WAIT_EXISTS;
        return true;
    }
    if (strcmp(raw, "active") == 0) {
        *out = UI_WAIT_ACTIVE;
        return true;
    }
    if (strcmp(raw, "interactive") == 0) {
        *out = UI_WAIT_INTERACTIVE;
        return true;
    }
    return false;
}

static bool ParseUiClickComponent(const char* raw, UiClickComponent* out) {
    if (!out || !raw || !raw[0]) return false;
    if (strcmp(raw, "auto") == 0) {
        *out = UI_CLICK_AUTO;
        return true;
    }
    if (strcmp(raw, "button") == 0) {
        *out = UI_CLICK_BUTTON;
        return true;
    }
    if (strcmp(raw, "toggle") == 0) {
        *out = UI_CLICK_TOGGLE;
        return true;
    }
    return false;
}

static bool IsNodeStateSatisfied(const UiNodeSnapshot& node, UiWaitState state) {
    switch (state) {
        case UI_WAIT_EXISTS:
            return true;
        case UI_WAIT_ACTIVE:
            return node.active;
        case UI_WAIT_INTERACTIVE:
            return node.interactive;
        default:
            return false;
    }
}

static bool PerformButtonClick(Il2CppObject* buttonComponent) {
    if (!buttonComponent) return false;
    const char* const onClickGetterNames[] = { "get_onClick", nullptr };
    Il2CppObject* eventObj = InvokeObjectGetterByNames(buttonComponent, onClickGetterNames);
    if (eventObj) {
        UiMainThreadClickPlan eventPlan = ResolveButtonMainThreadClickPlan(true);
        if (QueueManagedNoArgActionOnMainThread(eventObj, eventPlan.methodName, eventPlan.fallbackMethodName)) {
            return true;
        }
    }

    UiMainThreadClickPlan componentPlan = ResolveButtonMainThreadClickPlan(false);
    return QueueManagedNoArgActionOnMainThread(
        buttonComponent,
        componentPlan.methodName,
        componentPlan.fallbackMethodName
    );
}

static bool PerformToggleClick(Il2CppObject* toggleComponent) {
    if (!toggleComponent) return false;
    UiMainThreadClickPlan plan = ResolveToggleMainThreadClickPlan();
    if (QueueManagedNoArgActionOnMainThread(toggleComponent, plan.methodName, plan.fallbackMethodName)) {
        return true;
    }
    const char* const internalToggleNames[] = { "InternalToggle", nullptr };
    if (InvokeNoArgMethodByNames(toggleComponent, internalToggleNames)) return true;

    const char* const getNames[] = { "get_isOn", nullptr };
    const char* const setNames[] = { "set_isOn", nullptr };
    bool isOn = false;
    if (!InvokeBoolGetterByNames(toggleComponent, getNames, &isOn)) return false;
    return InvokeBoolSetterByNames(toggleComponent, setNames, !isOn);
}

static bool PerformSetInputText(const UiNodeSnapshot& node, const char* text, bool submit, std::string* componentName) {
    if (!text || !componentName) return false;
    componentName->clear();

    const char* const setTextNames[] = { "set_text", "SetTextWithoutNotify", nullptr };
    const char* const submitGetterNames[] = { "get_onSubmit", nullptr };
    const char* const endEditGetterNames[] = { "get_onEndEdit", nullptr };
    const char* const submitNoArgNames[] = { "SendOnSubmit", "SendOnEndEdit", nullptr };

    Il2CppObject* target = nullptr;
    if (node.components.tmpInput) target = node.components.tmpInput;
    if (!target && node.components.numericInput) target = node.components.numericInput;
    if (!target) return false;

    bool wrote = InvokeStringSetterByNames(target, setTextNames, text);
    if (!wrote && node.components.numericInput && node.components.numericInput != target) {
        wrote = InvokeStringSetterByNames(node.components.numericInput, setTextNames, text);
        if (wrote) target = node.components.numericInput;
    }
    if (!wrote) return false;

    if (submit) {
        if (!InvokeStringEventByGetterNames(target, submitGetterNames, text) &&
            !InvokeStringEventByGetterNames(target, endEditGetterNames, text)) {
            InvokeNoArgMethodByNames(target, submitNoArgNames);
        }
    }

    if (node.components.numericInput) {
        *componentName = "numeric-input";
    } else {
        *componentName = "tmp-input";
    }
    return true;
}

static bool BuildDumpPanelTreeResultJson(
    const char* panel,
    const char* rootPath,
    bool truncated,
    const std::vector<UiNodeSnapshot>& nodes,
    std::string* out
) {
    if (!panel || !rootPath || !out) return false;
    out->clear();
    out->reserve(256 + nodes.size() * 128);
    *out += "{\"panel\":\"";
    *out += EscapeJsonString(panel);
    *out += "\",\"rootPath\":\"";
    *out += EscapeJsonString(rootPath);
    *out += "\",\"truncated\":";
    *out += truncated ? "true" : "false";
    *out += ",\"nodes\":[";
    for (size_t i = 0; i < nodes.size(); i++) {
        if (i) *out += ",";
        *out += "{\"path\":\"";
        *out += EscapeJsonString(nodes[i].path);
        *out += "\",\"name\":\"";
        *out += EscapeJsonString(nodes[i].name);
        *out += "\",\"depth\":";
        char depthBuf[16];
        snprintf(depthBuf, sizeof(depthBuf), "%d", nodes[i].depth);
        *out += depthBuf;
        *out += ",\"active\":";
        *out += nodes[i].active ? "true" : "false";
        *out += ",\"interactive\":";
        *out += nodes[i].interactive ? "true" : "false";
        *out += ",\"componentTypes\":";
        *out += BuildComponentTypesJson(nodes[i].components);
        *out += "}";
    }
    *out += "]}";
    return out->size() < BK_BUF_SIZE;
}

static bool ReadRequiredStringArg(
    const char* json,
    const char* field,
    char* out,
    int outSize,
    const char* missingError,
    const char* overflowError,
    char* error,
    int errorSize
) {
    bool present = false;
    if (JsonGetStringBounded(json, field, out, outSize, &present)) {
        if (out[0]) return true;
    }
    if (error && errorSize > 0) {
        snprintf(error, errorSize, "%s", present ? overflowError : missingError);
    }
    return false;
}

static bool ReadOptionalStringArg(const char* json, const char* field, char* out, int outSize, const char* defaultValue, char* error, int errorSize) {
    bool present = false;
    if (JsonGetStringBounded(json, field, out, outSize, &present)) return true;
    if (present) {
        if (error && errorSize > 0) snprintf(error, errorSize, "invalid %s", field);
        return false;
    }
    if (defaultValue) {
        snprintf(out, outSize, "%s", defaultValue);
    } else if (outSize > 0) {
        out[0] = '\0';
    }
    return true;
}

static bool ReadBoundedIntArg(
    const char* json,
    const char* field,
    int defaultValue,
    int minValue,
    int maxValue,
    int* out,
    const char* invalidError
) {
    if (!out) return false;
    if (!JsonFieldExists(json, field)) {
        *out = defaultValue;
        return true;
    }
    int value = JsonGetInt(json, field);
    if (value == INT_MIN || value < minValue || value > maxValue) return false;
    *out = value;
    return true;
}

static bool ReadWaitTimingArgs(const char* json, int* timeoutMs, int* pollIntervalMs, const char** errorOut) {
    if (!timeoutMs || !pollIntervalMs) return false;
    if (!ReadBoundedIntArg(json, "timeoutMs", 3000, 100, 30000, timeoutMs, "invalid timeoutMs")) {
        if (errorOut) *errorOut = "invalid timeoutMs";
        return false;
    }
    if (!ReadBoundedIntArg(json, "pollIntervalMs", 50, 16, 1000, pollIntervalMs, "invalid pollIntervalMs")) {
        if (errorOut) *errorOut = "invalid pollIntervalMs";
        return false;
    }
    if (*pollIntervalMs > *timeoutMs) {
        if (errorOut) *errorOut = "invalid pollIntervalMs";
        return false;
    }
    return true;
}

static void LogTaskState(const char* phase, Il2CppObject* task) {
    if (!task) {
        Logf("%s task=null", phase);
        return;
    }
    bool isCanceled = false;
    bool isFaulted = false;
    int status = -1;
    bool gotStatus = InvokeIntGetter(task, "get_Status", &status);
    bool gotCanceled = InvokeBoolGetter(task, "get_IsCanceled", &isCanceled);
    bool gotFaulted = InvokeBoolGetter(task, "get_IsFaulted", &isFaulted);
    Logf("%s taskClass=%s status=%s%d isCanceled=%s%s isFaulted=%s%s",
         phase,
         ObjClassName(task),
         gotStatus ? "" : "?", status,
         gotCanceled ? "" : "?", isCanceled ? "true" : "false",
         gotFaulted ? "" : "?", isFaulted ? "true" : "false");
}

static bool AwaitTaskBool(Il2CppObject* task, int timeoutMs, bool* result, char* error, int errorSize) {
    if (!task || !result) {
        snprintf(error, errorSize, "ExchangeItem did not return a Task");
        return false;
    }

    Il2CppClass* taskClass = g_object_get_class(task);
    if (!taskClass) {
        snprintf(error, errorSize, "Task class not found");
        return false;
    }

    const Il2CppMethod* getCompleted = g_class_get_method_from_name(taskClass, "get_IsCompleted", 0);
    if (!getCompleted) {
        snprintf(error, errorSize, "Task.IsCompleted not found");
        return false;
    }

    DWORD start = GetTickCount();
    while ((int)(GetTickCount() - start) < timeoutMs) {
        Il2CppObject* completed = SafeInvoke(getCompleted, task, nullptr);
        if (completed && UNBOX_BOOL(completed)) break;
        Sleep(50);
    }

    Il2CppObject* completed = SafeInvoke(getCompleted, task, nullptr);
    if (!completed || !UNBOX_BOOL(completed)) {
        snprintf(error, errorSize, "ExchangeItem task timeout");
        return false;
    }

    bool flag = false;
    if (InvokeBoolGetter(task, "get_IsCanceled", &flag) && flag) {
        snprintf(error, errorSize, "ExchangeItem task canceled");
        return false;
    }
    if (InvokeBoolGetter(task, "get_IsFaulted", &flag) && flag) {
        snprintf(error, errorSize, "ExchangeItem task faulted");
        return false;
    }

    const Il2CppMethod* getResult = g_class_get_method_from_name(taskClass, "get_Result", 0);
    if (!getResult) {
        snprintf(error, errorSize, "Task.Result not found");
        return false;
    }
    Il2CppObject* resultObj = SafeInvoke(getResult, task, nullptr);
    if (!resultObj) {
        snprintf(error, errorSize, "Task.Result returned null");
        return false;
    }
    *result = UNBOX_BOOL(resultObj);
    return true;
}

static bool AwaitTaskDone(Il2CppObject* task, int timeoutMs, const char* opName) {
    if (!task) {
        Logf("%s did not return a Task", opName);
        return false;
    }
    Il2CppClass* taskClass = g_object_get_class(task);
    if (!taskClass) {
        Logf("%s task class not found", opName);
        return false;
    }
    const Il2CppMethod* getCompleted = g_class_get_method_from_name(taskClass, "get_IsCompleted", 0);
    if (!getCompleted) {
        Logf("%s Task.IsCompleted not found", opName);
        return false;
    }

    DWORD start = GetTickCount();
    while ((int)(GetTickCount() - start) < timeoutMs) {
        Il2CppObject* completed = SafeInvoke(getCompleted, task, nullptr);
        if (completed && UNBOX_BOOL(completed)) {
            bool flag = false;
            if (InvokeBoolGetter(task, "get_IsCanceled", &flag) && flag) {
                Logf("%s task canceled", opName);
                return false;
            }
            if (InvokeBoolGetter(task, "get_IsFaulted", &flag) && flag) {
                Logf("%s task faulted", opName);
                return false;
            }
            Logf("%s task completed", opName);
            return true;
        }
        Sleep(50);
    }

    Logf("%s task timeout", opName);
    return false;
}

static Il2CppObject* AwaitTaskResultObject(Il2CppObject* task, int timeoutMs, const char* opName, char* error, int errorSize) {
    if (!task) {
        snprintf(error, errorSize, "%s did not return a Task", opName);
        return nullptr;
    }
    Il2CppClass* taskClass = g_object_get_class(task);
    if (!taskClass) {
        snprintf(error, errorSize, "%s task class not found", opName);
        return nullptr;
    }
    const Il2CppMethod* getCompleted = g_class_get_method_from_name(taskClass, "get_IsCompleted", 0);
    const Il2CppMethod* getResult = g_class_get_method_from_name(taskClass, "get_Result", 0);
    if (!getCompleted || !getResult) {
        return task;
    }

    DWORD start = GetTickCount();
    while ((int)(GetTickCount() - start) < timeoutMs) {
        Il2CppObject* completed = SafeInvoke(getCompleted, task, nullptr);
        if (completed && UNBOX_BOOL(completed)) {
            bool flag = false;
            if (InvokeBoolGetter(task, "get_IsCanceled", &flag) && flag) {
                snprintf(error, errorSize, "%s task canceled", opName);
                return nullptr;
            }
            if (InvokeBoolGetter(task, "get_IsFaulted", &flag) && flag) {
                snprintf(error, errorSize, "%s task faulted", opName);
                return nullptr;
            }
            Il2CppObject* result = SafeInvoke(getResult, task, nullptr);
            if (!result) {
                snprintf(error, errorSize, "%s Task.Result returned null", opName);
                return nullptr;
            }
            return result;
        }
        Sleep(50);
    }

    snprintf(error, errorSize, "%s task timeout", opName);
    return nullptr;
}

static bool InvokeAndAwaitNoArgTask(Il2CppClass* klass, Il2CppObject* inst,
                                    const char* methodName, int timeoutMs) {
    const Il2CppMethod* method = g_class_get_method_from_name(klass, methodName, 0);
    if (!method) {
        Logf("%s not found", methodName);
        return false;
    }
    Il2CppObject* task = (Il2CppObject*)SafeInvoke(method, inst, nullptr);
    Logf("%s invoke returned task=%p class=%s", methodName, task, ObjClassName(task));
    return AwaitTaskDone(task, timeoutMs, methodName);
}

// --- InitIl2cpp ---

static bool InitIl2cpp() {
    HMODULE hGame = GetModuleHandleA("GameAssembly.dll");
    if (!hGame) return false;
    GETFN(hGame, il2cpp_domain_get,               g_domain_get)
    GETFN(hGame, il2cpp_domain_get_assemblies,     g_domain_get_assemblies)
    GETFN(hGame, il2cpp_assembly_get_image,        g_assembly_get_image)
    GETFN(hGame, il2cpp_class_from_name,           g_class_from_name)
    GETFN(hGame, il2cpp_class_get_name,            g_class_get_name)
    GETFN(hGame, il2cpp_class_get_method_from_name,g_class_get_method_from_name)
    GETFN(hGame, il2cpp_runtime_invoke,            g_runtime_invoke)
    GETFN(hGame, il2cpp_class_get_field_from_name, g_class_get_field_from_name)
    GETFN(hGame, il2cpp_field_static_get_value,    g_field_static_get_value)
    GETFN(hGame, il2cpp_object_get_class,          g_object_get_class)
    GETFN(hGame, il2cpp_thread_attach,             g_thread_attach)
    GETFN(hGame, il2cpp_string_new,                g_string_new)
    g_class_get_parent = (fn_class_get_parent)GetProcAddress(hGame, "il2cpp_class_get_parent");
    g_class_get_methods = (fn_class_get_methods)GetProcAddress(hGame, "il2cpp_class_get_methods");
    g_method_get_name = (fn_method_get_name)GetProcAddress(hGame, "il2cpp_method_get_name");
    g_method_get_param_count = (fn_method_get_param_count)GetProcAddress(hGame, "il2cpp_method_get_param_count");
    g_method_get_param = (fn_method_get_param)GetProcAddress(hGame, "il2cpp_method_get_param");
    g_type_get_name = (fn_type_get_name)GetProcAddress(hGame, "il2cpp_type_get_name");
    g_class_get_type = (fn_class_get_type)GetProcAddress(hGame, "il2cpp_class_get_type");
    g_type_get_object = (fn_type_get_object)GetProcAddress(hGame, "il2cpp_type_get_object");
    g_il2cpp_free = (fn_free)GetProcAddress(hGame, "il2cpp_free");
    g_domain = g_domain_get();
    g_il2cppReady = (g_domain != nullptr);
    return g_il2cppReady;
}

static void AttachCurrentThread() {
    if (g_il2cppReady && g_thread_attach && g_domain)
        g_thread_attach(g_domain);
}

// ==========================================================================
// Connection state
// ==========================================================================
struct AgentConn {
    HANDLE           pipe;
    CRITICAL_SECTION writeMutex;
    volatile bool    closing;
};

#define MAX_CONNS 16
static AgentConn*    g_conns[MAX_CONNS];
static int           g_connCount;
static CRITICAL_SECTION g_connsCs;

static void WakePipeServer() {
    HANDLE h = CreateFileA(BKPIPE_NAME, GENERIC_READ | GENERIC_WRITE,
                           0, NULL, OPEN_EXISTING, 0, NULL);
    if (h != INVALID_HANDLE_VALUE) CloseHandle(h);
}

static void RequestCloseAllConnections() {
    EnterCriticalSection(&g_connsCs);
    for (int i = 0; i < g_connCount; i++) {
        if (!g_conns[i]) continue;
        g_conns[i]->closing = true;
        CancelIoEx(g_conns[i]->pipe, NULL);
        DisconnectNamedPipe(g_conns[i]->pipe);
    }
    LeaveCriticalSection(&g_connsCs);
}

// ==========================================================================
// Write helpers — thread-safe, any thread may call
// ==========================================================================
static void SendResponse(AgentConn* c, const char* id, bool ok, const char* result) {
    char buf[BK_BUF_SIZE];
    BuildResponse(buf, BK_BUF_SIZE, id, ok, result);
    EnterCriticalSection(&c->writeMutex);
    WriteFrame(c->pipe, buf);
    LeaveCriticalSection(&c->writeMutex);
}

static void PushEvent(AgentConn* c, const char* event, const char* data) {
    char buf[BK_BUF_SIZE];
    BuildEvent(buf, BK_BUF_SIZE, event, data);
    EnterCriticalSection(&c->writeMutex);
    WriteFrame(c->pipe, buf);
    LeaveCriticalSection(&c->writeMutex);
}

static void PushEventToAll(const char* event, const char* data) {
    EnterCriticalSection(&g_connsCs);
    for (int i = 0; i < g_connCount; i++) {
        if (g_conns[i] && !g_conns[i]->closing)
            PushEvent(g_conns[i], event, data);
    }
    LeaveCriticalSection(&g_connsCs);
}

static const char* DelayedTaskStateName(DelayedTaskState state) {
    switch (state) {
        case DTS_SCHEDULED: return "scheduled";
        case DTS_RUNNING: return "running";
        case DTS_COMPLETED: return "completed";
        case DTS_CANCELED: return "canceled";
        case DTS_FAILED: return "failed";
        case DTS_IDLE:
        default: return "idle";
    }
}

static bool IsDelayedTaskActive(DelayedTaskState state) {
    return state == DTS_SCHEDULED || state == DTS_RUNNING;
}

static void BuildDelayedTaskStatusJson(const DelayedPriceTask* task, char* out, int outSize) {
    if (!task || task->state == DTS_IDLE || !task->taskId[0]) {
        snprintf(out, outSize, "{\"state\":\"idle\"}");
        return;
    }

    DWORD now = GetTickCount();
    int remainingSeconds = 0;
    if (task->state == DTS_SCHEDULED && (LONG)(task->dueTick - now) > 0) {
        remainingSeconds = (int)((task->dueTick - now + 999) / 1000);
    }

    const char* result = task->result[0] ? task->result : "{}";
    snprintf(
        out,
        outSize,
        "{\"taskId\":\"%s\",\"state\":\"%s\",\"itemCid\":%d,"
        "\"delaySeconds\":%d,\"jitterSeconds\":%d,\"actualDelaySeconds\":%d,"
        "\"remainingSeconds\":%d,\"result\":%s,\"error\":\"%s\"}",
        task->taskId,
        DelayedTaskStateName(task->state),
        task->itemCid,
        task->delaySeconds,
        task->jitterSeconds,
        task->actualDelaySeconds,
        remainingSeconds,
        result,
        task->error
    );
}

static void SnapshotDelayedTask(DelayedPriceTask* out) {
    if (!out) return;
    EnterCriticalSection(&g_delayedTaskCs);
    *out = g_delayedTask;
    LeaveCriticalSection(&g_delayedTaskCs);
}

static void PublishDelayedTaskStatus() {
    DelayedPriceTask snapshot = {};
    SnapshotDelayedTask(&snapshot);
    char json[4096];
    BuildDelayedTaskStatusJson(&snapshot, json, sizeof(json));
    PushEventToAll("DelayedPriceQueryUpdated", json);
}

static void SetDelayedTaskState(DelayedTaskState state, const char* error = NULL, const char* result = NULL) {
    EnterCriticalSection(&g_delayedTaskCs);
    g_delayedTask.state = state;
    if (error) {
        snprintf(g_delayedTask.error, sizeof(g_delayedTask.error), "%s", error);
    }
    if (result) {
        snprintf(g_delayedTask.result, sizeof(g_delayedTask.result), "%s", result);
    }
    LeaveCriticalSection(&g_delayedTaskCs);
    PublishDelayedTaskStatus();
}

static bool QueryItemTradeInfoJson(int itemCid, char* result, int resultSize, char* error, int errorSize) {
    if (!g_il2cppReady) {
        snprintf(error, errorSize, "il2cpp not ready");
        return false;
    }

    AttachCurrentThread();
    Il2CppClass* pmClass = FindClass("PlayerManager");
    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) {
        snprintf(error, errorSize, "PlayerManager singleton null");
        return false;
    }

    const Il2CppMethod* getTradeInfo = g_class_get_method_from_name(pmClass, "GetItemTradeInfo", 1);
    if (!getTradeInfo) {
        snprintf(error, errorSize, "GetItemTradeInfo not found");
        return false;
    }

    int32_t argItemCid = (int32_t)itemCid;
    void* args[] = { &argItemCid };
    Il2CppObject* tradeInfoTask = (Il2CppObject*)SafeInvoke(getTradeInfo, pmInst, args);
    if (!tradeInfoTask) {
        snprintf(error, errorSize, "GetItemTradeInfo returned null");
        return false;
    }
    Logf("GetItemTradeInfo returned class=%s", ObjClassName(tradeInfoTask));
    Il2CppObject* tradeInfo = AwaitTaskResultObject(tradeInfoTask, 30000, "GetItemTradeInfo", error, errorSize);
    if (!tradeInfo) return false;

    TradeListSummary summary = {};
    if (!BuildIl2CppTradeListSummaryJson(itemCid, tradeInfo, 32, result, resultSize, &summary)) {
        snprintf(error, errorSize, "failed to build trade list summary");
        return false;
    }
    Logf("GetItemTradeInfo trade list class=%s minPrice=%d tierCount=%d totalCount=%d",
         ObjClassName(tradeInfo), summary.minPrice, summary.tierCount, summary.totalCount);
    return true;
}

static bool ExecutePriceQuery(int itemCid, char* result, int resultSize, char* error, int errorSize) {
    return QueryItemTradeInfoJson(itemCid, result, resultSize, error, errorSize);
}

static DWORD WINAPI DelayedPriceQueryThread(LPVOID) {
    DelayedPriceTask snapshot = {};
    SnapshotDelayedTask(&snapshot);
    Logf("DelayedPriceQuery worker start taskId=%s itemCid=%d actualDelaySeconds=%d",
         snapshot.taskId, snapshot.itemCid, snapshot.actualDelaySeconds);

    DWORD waitMs = (DWORD)snapshot.actualDelaySeconds * 1000UL;
    DWORD waitResult = WaitForSingleObject(snapshot.cancelEvent, waitMs);
    if (waitResult == WAIT_OBJECT_0) {
        Logf("DelayedPriceQuery canceled before run taskId=%s", snapshot.taskId);
        SetDelayedTaskState(DTS_CANCELED);
        return 0;
    }

    SetDelayedTaskState(DTS_RUNNING);
    char result[2048] = {};
    char error[256] = {};
    if (ExecutePriceQuery(snapshot.itemCid, result, sizeof(result), error, sizeof(error))) {
        Logf("DelayedPriceQuery completed taskId=%s result=%s", snapshot.taskId, result);
        SetDelayedTaskState(DTS_COMPLETED, NULL, result);
    } else {
        Logf("DelayedPriceQuery failed taskId=%s error=%s", snapshot.taskId, error);
        SetDelayedTaskState(DTS_FAILED, error);
    }
    return 0;
}

static void RemoveConn(AgentConn* c) {
    EnterCriticalSection(&g_connsCs);
    for (int i = 0; i < g_connCount; i++) {
        if (g_conns[i] == c) {
            g_conns[i] = g_conns[--g_connCount];
            break;
        }
    }
    LeaveCriticalSection(&g_connsCs);
}

// ==========================================================================
// Command implementations
// ==========================================================================

static void CmdPing(AgentConn* c, const char* id, const char*) {
    SendResponse(c, id, true, "{\"pong\":true}");
}

static void CmdGetCurrentUI(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    Il2CppClass* cls = FindClass("UIBehavior");
    if (!cls) { SendResponse(c, id, false, "UIBehavior class not found"); return; }
    const Il2CppMethod* m = g_class_get_method_from_name(cls, "GetCurShowMainUI", 0);
    if (!m) { SendResponse(c, id, false, "UIBehavior.GetCurShowMainUI not found"); return; }
    Il2CppObject* cur = (Il2CppObject*)SafeInvoke(m, nullptr, nullptr);
    char result[256];
    snprintf(result, sizeof(result), "{\"panel\":\"%s\"}", ObjClassName(cur));
    SendResponse(c, id, true, result);
}

static void CmdGetVisiblePanels(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    Il2CppClass* cls = FindClass("UIBehavior");
    if (!cls) { SendResponse(c, id, false, "UIBehavior class not found"); return; }
    const Il2CppMethod* m = g_class_get_method_from_name(cls, "GetAllShowedBhvr", 0);
    if (!m) { SendResponse(c, id, false, "UIBehavior.GetAllShowedBhvr not found"); return; }
    Il2CppObject* list = (Il2CppObject*)SafeInvoke(m, nullptr, nullptr);
    int count = ReadListCount(list);
    char arr[4096]; int pos = 0;
    pos += snprintf(arr + pos, sizeof(arr) - pos, "[");
    for (int i = 0; i < count && pos < (int)sizeof(arr) - 64; i++) {
        Il2CppObject* item = ReadListItem(list, i);
        pos += snprintf(arr + pos, sizeof(arr) - pos,
                        "%s\"%s\"", i ? "," : "", ObjClassName(item));
    }
    snprintf(arr + pos, sizeof(arr) - pos, "]");
    char result[4200];
    snprintf(result, sizeof(result), "{\"panels\":%s}", arr);
    SendResponse(c, id, true, result);
}

static void CmdOpenPanel(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    char name[64] = {};
    JsonGetString(json, "name", name, sizeof(name));
    if (!name[0]) { SendResponse(c, id, false, "missing name"); return; }
    Il2CppClass* cls = FindClass("UIManager");
    Il2CppObject* mgr = GetSingleton(cls);
    if (!mgr) { SendResponse(c, id, false, "UIManager singleton null"); return; }
    const Il2CppMethod* m = g_class_get_method_from_name(cls, "ShowUIByName", 1);
    if (!m) { SendResponse(c, id, false, "ShowUIByName not found"); return; }
    Il2CppObject* nameStr = g_string_new(name);
    void* args[] = { nameStr };
    SafeInvoke(m, mgr, args);
    SendResponse(c, id, true, "{\"opened\":true}");
}

static void CmdClosePanel(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    Il2CppClass* cls = FindClass("UIManager");
    Il2CppObject* mgr = GetSingleton(cls);
    if (!mgr) { SendResponse(c, id, false, "UIManager singleton null"); return; }
    const Il2CppMethod* m = g_class_get_method_from_name(cls, "AsyncClosePanel", 0);
    if (!m) { SendResponse(c, id, false, "AsyncClosePanel not found"); return; }
    SafeInvoke(m, mgr, nullptr);
    SendResponse(c, id, true, "{}");
}

static void CmdDumpPanelTree(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    char panel[96] = {};
    char rootPath[512] = {};
    char error[128] = {};
    if (!ReadRequiredStringArg(json, "panel", panel, sizeof(panel), "missing panel", "invalid panel", error, sizeof(error))) {
        SendResponse(c, id, false, error);
        return;
    }
    if (!ReadOptionalStringArg(json, "rootPath", rootPath, sizeof(rootPath), "", error, sizeof(error))) {
        SendResponse(c, id, false, error);
        return;
    }

    int maxDepth = 4;
    int nodeLimit = 200;
    if (!ReadBoundedIntArg(json, "maxDepth", 4, 0, 8, &maxDepth, "invalid maxDepth")) {
        SendResponse(c, id, false, "invalid maxDepth");
        return;
    }
    if (!ReadBoundedIntArg(json, "nodeLimit", 200, 1, 1000, &nodeLimit, "invalid nodeLimit")) {
        SendResponse(c, id, false, "invalid nodeLimit");
        return;
    }

    bool interactiveOnly = true;
    bool includeInactive = false;
    JsonGetBool(json, "interactiveOnly", &interactiveOnly);
    JsonGetBool(json, "includeInactive", &includeInactive);

    Il2CppObject* panelObj = nullptr;
    Il2CppObject* panelTransform = nullptr;
    UiPanelLookupResult panelResult = FindVisiblePanelTransform(panel, &panelObj, &panelTransform, error, sizeof(error));
    if (panelResult == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, error); return; }
    if (panelResult == UI_PANEL_NOT_VISIBLE) { SendResponse(c, id, false, "panel not visible"); return; }
    if (panelResult == UI_PANEL_INSTANCE_NOT_FOUND) { SendResponse(c, id, false, "panel instance not found"); return; }

    Il2CppObject* anchorTransform = panelTransform;
    if (rootPath[0]) {
        std::string ignoredResolvedPath;
        if (!ResolveExactRelativePath(panelTransform, rootPath, &anchorTransform, &ignoredResolvedPath) || !anchorTransform) {
            SendResponse(c, id, false, "root path not found");
            return;
        }
    }

    std::vector<UiNodeSnapshot> nodes;
    bool truncated = false;
    CollectDumpNodesRecursive(
        anchorTransform,
        "",
        1,
        maxDepth,
        interactiveOnly,
        includeInactive,
        nodeLimit,
        &nodes,
        &truncated
    );

    std::string result;
    if (!BuildDumpPanelTreeResultJson(panel, rootPath, truncated, nodes, &result)) {
        SendResponse(c, id, false, "dump result too large");
        return;
    }
    SendResponse(c, id, true, result.c_str());
}

static void CmdClickNode(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    char panel[96] = {};
    char rootPath[512] = {};
    char path[512] = {};
    char pathModeRaw[16] = "exact";
    char componentRaw[16] = "auto";
    char error[128] = {};

    if (!ReadRequiredStringArg(json, "panel", panel, sizeof(panel), "missing panel", "invalid panel", error, sizeof(error)) ||
        !ReadOptionalStringArg(json, "rootPath", rootPath, sizeof(rootPath), "", error, sizeof(error)) ||
        !ReadRequiredStringArg(json, "path", path, sizeof(path), "missing path", "invalid path", error, sizeof(error)) ||
        !ReadOptionalStringArg(json, "pathMode", pathModeRaw, sizeof(pathModeRaw), "exact", error, sizeof(error)) ||
        !ReadOptionalStringArg(json, "component", componentRaw, sizeof(componentRaw), "auto", error, sizeof(error))) {
        SendResponse(c, id, false, error);
        return;
    }

    UiPathMode pathMode = UI_PATH_EXACT;
    if (!ParseUiPathMode(pathModeRaw, &pathMode)) {
        SendResponse(c, id, false, "invalid pathMode");
        return;
    }
    UiClickComponent requestedComponent = UI_CLICK_AUTO;
    if (!ParseUiClickComponent(componentRaw, &requestedComponent)) {
        SendResponse(c, id, false, "invalid component");
        return;
    }

    Il2CppObject* panelTransform = nullptr;
    UiPanelLookupResult panelResult = FindVisiblePanelTransform(panel, nullptr, &panelTransform, error, sizeof(error));
    if (panelResult == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, error); return; }
    if (panelResult != UI_PANEL_FOUND) { SendResponse(c, id, false, "panel not visible"); return; }

    Il2CppObject* anchorTransform = panelTransform;
    if (rootPath[0]) {
        std::string ignoredResolvedPath;
        if (!ResolveExactRelativePath(panelTransform, rootPath, &anchorTransform, &ignoredResolvedPath) || !anchorTransform) {
            SendResponse(c, id, false, "root path not found");
            return;
        }
    }

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(anchorTransform, path, pathMode, 2, &matches);
    if (matches.empty()) { SendResponse(c, id, false, "node not found"); return; }
    if (matches.size() > 1) { SendResponse(c, id, false, "multiple nodes matched"); return; }

    UiNodeSnapshot& node = matches[0];
    if (!node.active) { SendResponse(c, id, false, "node inactive"); return; }

    Il2CppObject* clickComponent = nullptr;
    const char* normalizedComponent = nullptr;
    if (requestedComponent == UI_CLICK_BUTTON) {
        if (!node.components.button) { SendResponse(c, id, false, "component mismatch"); return; }
        clickComponent = node.components.button;
        normalizedComponent = "button";
    } else if (requestedComponent == UI_CLICK_TOGGLE) {
        if (!node.components.toggle) { SendResponse(c, id, false, "component mismatch"); return; }
        clickComponent = node.components.toggle;
        normalizedComponent = "toggle";
    } else if (node.components.button) {
        clickComponent = node.components.button;
        normalizedComponent = "button";
    } else if (node.components.toggle) {
        clickComponent = node.components.toggle;
        normalizedComponent = "toggle";
    }

    if (!clickComponent || !normalizedComponent) {
        SendResponse(c, id, false, "node not clickable");
        return;
    }

    bool interactable = false;
    if (ReadComponentInteractable(clickComponent, &interactable) && !interactable) {
        SendResponse(c, id, false, "node not clickable");
        return;
    }

    bool clicked = false;
    if (strcmp(normalizedComponent, "button") == 0) {
        clicked = PerformButtonClick(clickComponent);
    } else if (strcmp(normalizedComponent, "toggle") == 0) {
        clicked = PerformToggleClick(clickComponent);
    }
    if (!clicked) {
        SendResponse(c, id, false, "node not clickable");
        return;
    }

    std::string result = "{\"clicked\":true,\"resolvedPath\":\"";
    result += EscapeJsonString(node.path);
    result += "\",\"component\":\"";
    result += normalizedComponent;
    result += "\"}";
    SendResponse(c, id, true, result.c_str());
}

static void CmdSetInputText(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    char panel[96] = {};
    char rootPath[512] = {};
    char path[512] = {};
    char pathModeRaw[16] = "exact";
    char text[512] = {};
    char error[128] = {};

    if (!ReadRequiredStringArg(json, "panel", panel, sizeof(panel), "missing panel", "invalid panel", error, sizeof(error)) ||
        !ReadOptionalStringArg(json, "rootPath", rootPath, sizeof(rootPath), "", error, sizeof(error)) ||
        !ReadRequiredStringArg(json, "path", path, sizeof(path), "missing path", "invalid path", error, sizeof(error)) ||
        !ReadOptionalStringArg(json, "pathMode", pathModeRaw, sizeof(pathModeRaw), "exact", error, sizeof(error))) {
        SendResponse(c, id, false, error);
        return;
    }

    bool textPresent = false;
    if (!JsonGetStringBounded(json, "text", text, sizeof(text), &textPresent)) {
        SendResponse(c, id, false, textPresent ? "text too long" : "missing text");
        return;
    }
    for (int i = 0; text[i]; i++) {
        if (text[i] == '\r' || text[i] == '\n' || text[i] == '"') {
            SendResponse(c, id, false, "text too long");
            return;
        }
    }

    UiPathMode pathMode = UI_PATH_EXACT;
    if (!ParseUiPathMode(pathModeRaw, &pathMode)) {
        SendResponse(c, id, false, "invalid pathMode");
        return;
    }

    bool submit = false;
    JsonGetBool(json, "submit", &submit);

    Il2CppObject* panelTransform = nullptr;
    UiPanelLookupResult panelResult = FindVisiblePanelTransform(panel, nullptr, &panelTransform, error, sizeof(error));
    if (panelResult == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, error); return; }
    if (panelResult != UI_PANEL_FOUND) { SendResponse(c, id, false, "panel not visible"); return; }

    Il2CppObject* anchorTransform = panelTransform;
    if (rootPath[0]) {
        std::string ignoredResolvedPath;
        if (!ResolveExactRelativePath(panelTransform, rootPath, &anchorTransform, &ignoredResolvedPath) || !anchorTransform) {
            SendResponse(c, id, false, "root path not found");
            return;
        }
    }

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(anchorTransform, path, pathMode, 2, &matches);
    if (matches.empty()) { SendResponse(c, id, false, "node not found"); return; }
    if (matches.size() > 1) { SendResponse(c, id, false, "multiple nodes matched"); return; }

    UiNodeSnapshot& node = matches[0];
    if (!node.active) { SendResponse(c, id, false, "node inactive"); return; }
    if (!node.components.tmpInput && !node.components.numericInput) {
        SendResponse(c, id, false, "node not input");
        return;
    }

    std::string componentName;
    if (!PerformSetInputText(node, text, submit, &componentName)) {
        SendResponse(c, id, false, "node not input");
        return;
    }

    std::string result = "{\"updated\":true,\"resolvedPath\":\"";
    result += EscapeJsonString(node.path);
    result += "\",\"component\":\"";
    result += componentName;
    result += "\",\"text\":\"";
    result += EscapeJsonString(text);
    result += "\"}";
    SendResponse(c, id, true, result.c_str());
}

static void CmdGetNodeState(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    char panel[96] = {};
    char rootPath[512] = {};
    char path[512] = {};
    char pathModeRaw[16] = "exact";
    char error[128] = {};

    if (!ReadRequiredStringArg(json, "panel", panel, sizeof(panel), "missing panel", "invalid panel", error, sizeof(error)) ||
        !ReadOptionalStringArg(json, "rootPath", rootPath, sizeof(rootPath), "", error, sizeof(error)) ||
        !ReadRequiredStringArg(json, "path", path, sizeof(path), "missing path", "invalid path", error, sizeof(error)) ||
        !ReadOptionalStringArg(json, "pathMode", pathModeRaw, sizeof(pathModeRaw), "exact", error, sizeof(error))) {
        SendResponse(c, id, false, error);
        return;
    }

    UiPathMode pathMode = UI_PATH_EXACT;
    if (!ParseUiPathMode(pathModeRaw, &pathMode)) {
        SendResponse(c, id, false, "invalid pathMode");
        return;
    }

    Il2CppObject* panelTransform = nullptr;
    UiPanelLookupResult panelResult = FindVisiblePanelTransform(panel, nullptr, &panelTransform, error, sizeof(error));
    if (panelResult == UI_PANEL_LOOKUP_ERROR) { SendResponse(c, id, false, error); return; }
    if (panelResult != UI_PANEL_FOUND) { SendResponse(c, id, false, "panel not visible"); return; }

    Il2CppObject* anchorTransform = panelTransform;
    if (rootPath[0]) {
        std::string ignoredResolvedPath;
        if (!ResolveExactRelativePath(panelTransform, rootPath, &anchorTransform, &ignoredResolvedPath) || !anchorTransform) {
            SendResponse(c, id, false, "root path not found");
            return;
        }
    }

    std::vector<UiNodeSnapshot> matches;
    ResolveUiNodeMatches(anchorTransform, path, pathMode, 2, &matches);
    if (matches.empty()) { SendResponse(c, id, false, "node not found"); return; }
    if (matches.size() > 1) { SendResponse(c, id, false, "multiple nodes matched"); return; }

    UiNodeSnapshot& node = matches[0];
    std::string text;
    ReadNodeTextValue(node.components, &text);
    bool toggleOn = false;
    ReadToggleValue(node.components, &toggleOn);

    std::string result = "{\"resolvedPath\":\"";
    result += EscapeJsonString(node.path);
    result += "\",\"active\":";
    result += node.active ? "true" : "false";
    result += ",\"interactive\":";
    result += node.interactive ? "true" : "false";
    result += ",\"text\":\"";
    result += EscapeJsonString(text);
    result += "\",\"toggleOn\":";
    result += toggleOn ? "true" : "false";
    result += "}";
    SendResponse(c, id, true, result.c_str());
}

static void CmdWaitForVisiblePanel(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    char panel[96] = {};
    char error[128] = {};
    if (!ReadRequiredStringArg(json, "panel", panel, sizeof(panel), "missing panel", "invalid panel", error, sizeof(error))) {
        SendResponse(c, id, false, error);
        return;
    }

    bool visible = true;
    JsonGetBool(json, "visible", &visible);

    int timeoutMs = 3000;
    int pollIntervalMs = 50;
    const char* timingError = nullptr;
    if (!ReadWaitTimingArgs(json, &timeoutMs, &pollIntervalMs, &timingError)) {
        SendResponse(c, id, false, timingError ? timingError : "invalid timeoutMs");
        return;
    }

    DWORD startedAt = GetTickCount();
    for (;;) {
        UiPanelLookupResult panelResult = FindVisiblePanelTransform(panel, nullptr, nullptr, error, sizeof(error));
        if (panelResult == UI_PANEL_LOOKUP_ERROR) {
            SendResponse(c, id, false, error);
            return;
        }

        bool isVisible = panelResult == UI_PANEL_FOUND || panelResult == UI_PANEL_INSTANCE_NOT_FOUND;
        if (isVisible == visible) {
            DWORD waitMs = GetTickCount() - startedAt;
            char result[160];
            snprintf(result, sizeof(result), "{\"panel\":\"%s\",\"visible\":%s,\"waitMs\":%lu}",
                panel,
                visible ? "true" : "false",
                (unsigned long)waitMs);
            SendResponse(c, id, true, result);
            return;
        }

        DWORD elapsed = GetTickCount() - startedAt;
        if ((int)elapsed >= timeoutMs) break;
        Sleep((DWORD)pollIntervalMs);
    }

    SendResponse(c, id, false, "wait panel timeout");
}

static void CmdWaitForNode(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    char panel[96] = {};
    char rootPath[512] = {};
    char path[512] = {};
    char pathModeRaw[16] = "exact";
    char stateRaw[16] = {};
    char error[128] = {};

    if (!ReadRequiredStringArg(json, "panel", panel, sizeof(panel), "missing panel", "invalid panel", error, sizeof(error)) ||
        !ReadOptionalStringArg(json, "rootPath", rootPath, sizeof(rootPath), "", error, sizeof(error)) ||
        !ReadRequiredStringArg(json, "path", path, sizeof(path), "missing path", "invalid path", error, sizeof(error)) ||
        !ReadOptionalStringArg(json, "pathMode", pathModeRaw, sizeof(pathModeRaw), "exact", error, sizeof(error)) ||
        !ReadRequiredStringArg(json, "state", stateRaw, sizeof(stateRaw), "missing state", "invalid state", error, sizeof(error))) {
        SendResponse(c, id, false, error);
        return;
    }

    UiPathMode pathMode = UI_PATH_EXACT;
    if (!ParseUiPathMode(pathModeRaw, &pathMode)) {
        SendResponse(c, id, false, "invalid pathMode");
        return;
    }
    UiWaitState waitState = UI_WAIT_EXISTS;
    if (!ParseUiWaitState(stateRaw, &waitState)) {
        SendResponse(c, id, false, "invalid state");
        return;
    }

    int timeoutMs = 3000;
    int pollIntervalMs = 50;
    const char* timingError = nullptr;
    if (!ReadWaitTimingArgs(json, &timeoutMs, &pollIntervalMs, &timingError)) {
        SendResponse(c, id, false, timingError ? timingError : "invalid timeoutMs");
        return;
    }

    DWORD startedAt = GetTickCount();
    for (;;) {
        Il2CppObject* panelTransform = nullptr;
        UiPanelLookupResult panelResult = FindVisiblePanelTransform(panel, nullptr, &panelTransform, error, sizeof(error));
        if (panelResult == UI_PANEL_LOOKUP_ERROR) {
            SendResponse(c, id, false, error);
            return;
        }

        if (panelResult == UI_PANEL_FOUND && panelTransform) {
            Il2CppObject* anchorTransform = panelTransform;
            bool rootReady = true;
            if (rootPath[0]) {
                std::string ignoredResolvedPath;
                rootReady = ResolveExactRelativePath(panelTransform, rootPath, &anchorTransform, &ignoredResolvedPath) && anchorTransform;
            }

            if (rootReady) {
                std::vector<UiNodeSnapshot> matches;
                ResolveUiNodeMatches(anchorTransform, path, pathMode, 2, &matches);
                if (matches.size() > 1) {
                    SendResponse(c, id, false, "multiple nodes matched");
                    return;
                }
                if (matches.size() == 1 && IsNodeStateSatisfied(matches[0], waitState)) {
                    DWORD waitMs = GetTickCount() - startedAt;
                    std::string result = "{\"resolvedPath\":\"";
                    result += EscapeJsonString(matches[0].path);
                    result += "\",\"state\":\"";
                    result += stateRaw;
                    result += "\",\"waitMs\":";
                    char waitBuf[32];
                    snprintf(waitBuf, sizeof(waitBuf), "%lu", (unsigned long)waitMs);
                    result += waitBuf;
                    result += "}";
                    SendResponse(c, id, true, result.c_str());
                    return;
                }
            }
        }

        DWORD elapsed = GetTickCount() - startedAt;
        if ((int)elapsed >= timeoutMs) break;
        Sleep((DWORD)pollIntervalMs);
    }

    SendResponse(c, id, false, "wait node timeout");
}

static void CmdCollectionPrices(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    Il2CppClass* pmClass = FindClass("PlayerManager");
    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) { SendResponse(c, id, false, "PlayerManager singleton null"); return; }
    const Il2CppMethod* getAllItems =
        g_class_get_method_from_name(pmClass, "GetAllCollectionItems", 0);
    Il2CppObject* itemList = (Il2CppObject*)SafeInvoke(getAllItems, pmInst, nullptr);
    int itemCount = ReadListCount(itemList);
    const Il2CppMethod* getTradeInfo =
        g_class_get_method_from_name(pmClass, "GetItemTradeInfo", 1);
    if (!getTradeInfo) { SendResponse(c, id, false, "GetItemTradeInfo not found"); return; }

    int bufSize = itemCount * 128 + 64;
    char* arr = (char*)HeapAlloc(GetProcessHeap(), 0, bufSize);
    int pos = 0;
    int writtenItems = 0;
    pos += snprintf(arr + pos, bufSize - pos, "[");

    for (int i = 0; i < itemCount && pos < bufSize - 128; i++) {
        Il2CppObject* item = ReadListItem(itemList, i);
        if (!item) continue;
        Il2CppClass* itemClass = g_object_get_class(item);
        Il2CppFieldInfo* cidField = g_class_get_field_from_name(itemClass, "itemCid");
        if (!cidField) continue;
        int32_t cid = *(int32_t*)((char*)item + FIELDINFO_OBJECT_OFFSET(cidField));
        int32_t argCid = cid;
        void* args[] = { &argCid };
        Il2CppObject* tradeInfoTask = (Il2CppObject*)SafeInvoke(getTradeInfo, pmInst, args);
        if (!tradeInfoTask) continue;
        char error[128] = {};
        Il2CppObject* tradeInfo = AwaitTaskResultObject(tradeInfoTask, 30000, "GetItemTradeInfo", error, sizeof(error));
        if (!tradeInfo) {
            Logf("CollectionPrices GetItemTradeInfo failed cid=%d error=%s", cid, error);
            continue;
        }
        TradeListSummary summary = {};
        char ignoredJson[256] = {};
        if (!BuildIl2CppTradeListSummaryJson(cid, tradeInfo, 0, ignoredJson, sizeof(ignoredJson), &summary)) {
            Logf("CollectionPrices failed to parse trade list cid=%d", cid);
            continue;
        }
        pos += snprintf(arr + pos, bufSize - pos,
            "%s{\"cid\":%d,\"minPrice\":%d,\"tierCount\":%d,\"totalCount\":%d}",
            writtenItems ? "," : "",
            cid,
            summary.minPrice,
            summary.tierCount,
            summary.totalCount);
        writtenItems++;
        Sleep(500 + rand() % 500);
    }
    snprintf(arr + pos, bufSize - pos, "]");

    char* result = (char*)HeapAlloc(GetProcessHeap(), 0, bufSize + 16);
    snprintf(result, bufSize + 16, "{\"items\":%s}", arr);
    SendResponse(c, id, true, result);
    HeapFree(GetProcessHeap(), 0, arr);
    HeapFree(GetProcessHeap(), 0, result);
}

static void CmdGetCollectionItemCids(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    AttachCurrentThread();
    Il2CppClass* pmClass = FindClass("PlayerManager");
    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) { SendResponse(c, id, false, "PlayerManager singleton null"); return; }
    const Il2CppMethod* getAllItems = g_class_get_method_from_name(pmClass, "GetAllCollectionItems", 0);
    if (!getAllItems) { SendResponse(c, id, false, "GetAllCollectionItems not found"); return; }
    Il2CppObject* itemListResult = (Il2CppObject*)SafeInvoke(getAllItems, pmInst, nullptr);
    if (!itemListResult) { SendResponse(c, id, false, "GetAllCollectionItems returned null"); return; }
    char error[256] = {};
    Il2CppObject* itemList = AwaitTaskResultObject(
        itemListResult,
        30000,
        "GetAllCollectionItems",
        error,
        sizeof(error)
    );
    if (!itemList) { SendResponse(c, id, false, error); return; }

    int count = ReadListCount(itemList);
    Il2CppClass* listClass = g_object_get_class(itemList);
    if (!listClass) { SendResponse(c, id, false, "GetAllCollectionItems list class not found"); return; }
    const Il2CppMethod* getItem = g_class_get_method_from_name(listClass, "get_Item", 1);
    if (!getItem) { SendResponse(c, id, false, "GetAllCollectionItems get_Item not found"); return; }

    int* cids = nullptr;
    if (count > 0) {
        cids = (int*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(int) * (size_t)count);
        if (!cids) { SendResponse(c, id, false, "GetCollectionItemCids allocation failed"); return; }
    }

    int uniqueCount = 0;
    for (int i = 0; i < count; i++) {
        int32_t argIndex = (int32_t)i;
        void* args[] = { &argIndex };
        Il2CppObject* item = SafeInvoke(getItem, itemList, args);
        if (!item) {
            if (cids) HeapFree(GetProcessHeap(), 0, cids);
            SendResponse(c, id, false, "GetAllCollectionItems get_Item returned null");
            return;
        }
        int cid = UNBOX_INT32(item);
        if (cid <= 0) continue;
        bool seen = false;
        for (int j = 0; j < uniqueCount; j++) {
            if (cids[j] == cid) {
                seen = true;
                break;
            }
        }
        if (!seen) cids[uniqueCount++] = cid;
    }

    const int resultSize = BK_BUF_SIZE - 128;
    char* result = (char*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, resultSize);
    if (!result) {
        if (cids) HeapFree(GetProcessHeap(), 0, cids);
        SendResponse(c, id, false, "GetCollectionItemCids allocation failed");
        return;
    }

    int pos = snprintf(result, resultSize, "{\"cids\":[");
    for (int i = 0; i < uniqueCount; i++) {
        int wrote = snprintf(result + pos, resultSize - pos, "%s%d", i ? "," : "", cids[i]);
        if (wrote < 0 || wrote >= resultSize - pos) {
            HeapFree(GetProcessHeap(), 0, result);
            if (cids) HeapFree(GetProcessHeap(), 0, cids);
            SendResponse(c, id, false, "collection cid response too large");
            return;
        }
        pos += wrote;
    }
    int wrote = snprintf(result + pos, resultSize - pos, "],\"count\":%d}", uniqueCount);
    if (wrote < 0 || wrote >= resultSize - pos) {
        HeapFree(GetProcessHeap(), 0, result);
        if (cids) HeapFree(GetProcessHeap(), 0, cids);
        SendResponse(c, id, false, "collection cid response too large");
        return;
    }
    SendResponse(c, id, true, result);
    HeapFree(GetProcessHeap(), 0, result);
    if (cids) HeapFree(GetProcessHeap(), 0, cids);
}

static void CmdGetWarehouseItemList(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    AttachCurrentThread();
    Il2CppClass* pmClass = FindClass("PlayerManager");
    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) { SendResponse(c, id, false, "PlayerManager singleton null"); return; }

    const Il2CppMethod* getItems = g_class_get_method_from_name(pmClass, "GetWareHouseItemList", 0);
    if (!getItems) { SendResponse(c, id, false, "GetWareHouseItemList not found"); return; }

    Il2CppObject* task = (Il2CppObject*)SafeInvoke(getItems, pmInst, nullptr);
    if (!task) { SendResponse(c, id, false, "GetWareHouseItemList returned null"); return; }

    char error[256] = {};
    Il2CppObject* itemList = AwaitTaskResultObject(task, 30000, "GetWareHouseItemList", error, sizeof(error));
    if (!itemList) { SendResponse(c, id, false, error); return; }

    int count = ReadListCount(itemList);
    Il2CppClass* listClass = g_object_get_class(itemList);
    const Il2CppMethod* getItem = listClass ? g_class_get_method_from_name(listClass, "get_Item", 1) : nullptr;
    if (!getItem) { SendResponse(c, id, false, "GetWareHouseItemList get_Item not found"); return; }

    const int resultSize = BK_BUF_SIZE - 128;
    char* result = (char*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, resultSize);
    if (!result) { SendResponse(c, id, false, "GetWarehouseItemList allocation failed"); return; }

    const char* cidFields[] = { "itemCid_", "itemCid", "cid_", "cid", "itemId_", "itemId", nullptr };
    const char* countFields[] = { "itemCount_", "itemCount", "count_", "count", nullptr };
    int writtenItems = 0;
    int missingItems = 0;
    int pos = snprintf(result, resultSize, "{\"items\":[");

    for (int i = 0; i < count; i++) {
        int32_t argIndex = (int32_t)i;
        void* args[] = { &argIndex };
        Il2CppObject* item = SafeInvoke(getItem, itemList, args);
        if (!item) item = ReadListItem(itemList, i);
        if (!item) {
            missingItems++;
            continue;
        }

        int32_t itemCid = 0;
        int32_t itemCount = 0;
        if (!ReadIntFieldByNames(item, cidFields, &itemCid) ||
            !ReadIntFieldByNames(item, countFields, &itemCount)) {
            Logf("GetWarehouseItemList missing fields class=%s", ObjClassName(item));
            missingItems++;
            continue;
        }
        if (itemCid <= 0) continue;

        int wrote = snprintf(
            result + pos,
            resultSize - pos,
            "%s{\"itemCid\":%d,\"count\":%d}",
            writtenItems ? "," : "",
            itemCid,
            itemCount
        );
        if (wrote < 0 || wrote >= resultSize - pos) {
            HeapFree(GetProcessHeap(), 0, result);
            SendResponse(c, id, false, "warehouse item response too large");
            return;
        }
        pos += wrote;
        writtenItems++;
    }

    int wrote = snprintf(
        result + pos,
        resultSize - pos,
        "],\"count\":%d,\"source\":\"PlayerManager.GetWareHouseItemList\",\"missingCount\":%d}",
        writtenItems,
        missingItems
    );
    if (wrote < 0 || wrote >= resultSize - pos) {
        HeapFree(GetProcessHeap(), 0, result);
        SendResponse(c, id, false, "warehouse item response too large");
        return;
    }

    SendResponse(c, id, true, result);
    HeapFree(GetProcessHeap(), 0, result);
}

struct StockCountRow {
    int32_t cid;
    int32_t count;
};

static void AddStockCount(StockCountRow* rows, int maxRows, int* rowCount, int32_t cid, int32_t count) {
    if (!rows || !rowCount || cid <= 0 || count <= 0) return;
    for (int i = 0; i < *rowCount; i++) {
        if (rows[i].cid == cid) {
            rows[i].count += count;
            return;
        }
    }
    if (*rowCount >= maxRows) return;
    rows[*rowCount].cid = cid;
    rows[*rowCount].count = count;
    (*rowCount)++;
}

static void CmdGetStockCollectibleCounts(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    AttachCurrentThread();
    Il2CppClass* pmClass = FindClass("PlayerManager");
    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) { SendResponse(c, id, false, "PlayerManager singleton null"); return; }

    const Il2CppMethod* getStocks = g_class_get_method_from_name(pmClass, "GetAllStocks", 0);
    if (!getStocks) { SendResponse(c, id, false, "GetAllStocks not found"); return; }

    Il2CppObject* task = (Il2CppObject*)SafeInvoke(getStocks, pmInst, nullptr);
    if (!task) { SendResponse(c, id, false, "GetAllStocks returned null"); return; }

    char error[256] = {};
    Il2CppObject* containers = AwaitTaskResultObject(task, 30000, "GetAllStocks", error, sizeof(error));
    if (!containers) { SendResponse(c, id, false, error); return; }

    const int maxRows = 2048;
    StockCountRow* rows = (StockCountRow*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(StockCountRow) * maxRows);
    if (!rows) { SendResponse(c, id, false, "stock count allocation failed"); return; }

    const char* stockBoxesFields[] = { "stockBoxes_", "stockBoxes", nullptr };
    const char* itemFields[] = { "item_", "item", nullptr };
    const char* cidFields[] = { "cid_", "cid", "itemCid_", "itemCid", nullptr };
    const char* countFields[] = { "count_", "count", "itemCount_", "itemCount", nullptr };

    int containerCount = ReadListCount(containers);
    int boxCount = 0;
    int itemCount = 0;
    int emptyItemCount = 0;
    int missingCount = 0;
    int rowCount = 0;

    for (int ci = 0; ci < containerCount; ci++) {
        Il2CppObject* container = ReadListItem(containers, ci);
        if (!container) {
            missingCount++;
            continue;
        }

        Il2CppObject* stockBoxes = nullptr;
        if (!ReadObjectFieldByNames(container, stockBoxesFields, &stockBoxes) || !stockBoxes) {
            missingCount++;
            Logf("GetStockCollectibleCounts missing stockBoxes class=%s", ObjClassName(container));
            continue;
        }

        int boxes = ReadListCount(stockBoxes);
        boxCount += boxes;
        for (int bi = 0; bi < boxes; bi++) {
            Il2CppObject* box = ReadListItem(stockBoxes, bi);
            if (!box) {
                missingCount++;
                continue;
            }

            Il2CppObject* item = nullptr;
            if (!ReadObjectFieldByNames(box, itemFields, &item) || !item) {
                emptyItemCount++;
                continue;
            }

            int32_t cid = 0;
            int32_t count = 0;
            if (!ReadIntFieldByNames(item, cidFields, &cid)) {
                missingCount++;
                Logf("GetStockCollectibleCounts missing cid itemClass=%s boxClass=%s", ObjClassName(item), ObjClassName(box));
                continue;
            }
            if (!ReadIntFieldByNames(item, countFields, &count) || count <= 0) {
                count = 1;
            }
            itemCount++;
            AddStockCount(rows, maxRows, &rowCount, cid, count);
        }
    }

    const int resultSize = BK_BUF_SIZE - 128;
    char* result = (char*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, resultSize);
    if (!result) {
        HeapFree(GetProcessHeap(), 0, rows);
        SendResponse(c, id, false, "stock response allocation failed");
        return;
    }

    int pos = snprintf(result, resultSize, "{\"items\":[");
    for (int i = 0; i < rowCount; i++) {
        int wrote = snprintf(
            result + pos,
            resultSize - pos,
            "%s{\"itemCid\":%d,\"count\":%d}",
            i ? "," : "",
            rows[i].cid,
            rows[i].count
        );
        if (wrote < 0 || wrote >= resultSize - pos) {
            HeapFree(GetProcessHeap(), 0, rows);
            HeapFree(GetProcessHeap(), 0, result);
            SendResponse(c, id, false, "stock response too large");
            return;
        }
        pos += wrote;
    }

    int wrote = snprintf(
        result + pos,
        resultSize - pos,
        "],\"count\":%d,\"containerCount\":%d,\"boxCount\":%d,\"itemCount\":%d,"
        "\"emptyItemCount\":%d,\"missingCount\":%d,\"source\":\"PlayerManager.GetAllStocks\"}",
        rowCount,
        containerCount,
        boxCount,
        itemCount,
        emptyItemCount,
        missingCount
    );
    if (wrote < 0 || wrote >= resultSize - pos) {
        HeapFree(GetProcessHeap(), 0, rows);
        HeapFree(GetProcessHeap(), 0, result);
        SendResponse(c, id, false, "stock response too large");
        return;
    }

    SendResponse(c, id, true, result);
    HeapFree(GetProcessHeap(), 0, rows);
    HeapFree(GetProcessHeap(), 0, result);
}

static void CmdGetStockContainers(AgentConn* c, const char* id, const char*) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    AttachCurrentThread();
    Il2CppClass* pmClass = FindClass("PlayerManager");
    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) { SendResponse(c, id, false, "PlayerManager singleton null"); return; }

    const Il2CppMethod* getStocks = g_class_get_method_from_name(pmClass, "GetAllStocks", 0);
    if (!getStocks) { SendResponse(c, id, false, "GetAllStocks not found"); return; }

    Il2CppObject* task = (Il2CppObject*)SafeInvoke(getStocks, pmInst, nullptr);
    if (!task) { SendResponse(c, id, false, "GetAllStocks returned null"); return; }

    char error[256] = {};
    Il2CppObject* containers = AwaitTaskResultObject(task, 30000, "GetAllStocks", error, sizeof(error));
    if (!containers) { SendResponse(c, id, false, error); return; }

    char* result = (char*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, BK_BUF_SIZE);
    if (!result) { SendResponse(c, id, false, "GetStockContainers allocation failed"); return; }

    if (!SerializeStockContainers(containers, "PlayerManager.GetAllStocks", result, BK_BUF_SIZE, error, sizeof(error))) {
        HeapFree(GetProcessHeap(), 0, result);
        SendResponse(c, id, false, error);
        return;
    }

    SendResponse(c, id, true, result);
    HeapFree(GetProcessHeap(), 0, result);
}

static void CmdMoveStockItem(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    int oldStockId = JsonGetInt(json, "oldStockId");
    int oldSlot = JsonGetInt(json, "oldSlot");
    int newStockId = JsonGetInt(json, "newStockId");
    int newSlot = JsonGetInt(json, "newSlot");
    bool isRotate = false;
    if (!JsonGetBool(json, "isRotate", &isRotate)) {
        int rotateInt = JsonGetInt(json, "isRotate");
        if (rotateInt != INT_MIN) isRotate = rotateInt != 0;
    }

    if (!IsValidMoveStockId(oldStockId)) { SendResponse(c, id, false, "invalid oldStockId"); return; }
    if (oldSlot < 0) { SendResponse(c, id, false, "invalid oldSlot"); return; }
    if (!IsValidMoveStockId(newStockId)) { SendResponse(c, id, false, "invalid newStockId"); return; }
    if (newSlot < 0) { SendResponse(c, id, false, "invalid newSlot"); return; }

    AttachCurrentThread();
    Il2CppClass* pmClass = FindClass("PlayerManager");
    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) { SendResponse(c, id, false, "PlayerManager singleton null"); return; }

    const Il2CppMethod* moveItem = g_class_get_method_from_name(pmClass, "MoveItem", 5);
    if (!moveItem) { SendResponse(c, id, false, "MoveItem not found"); return; }

    int32_t argOldStockId = (int32_t)oldStockId;
    int32_t argOldSlot = (int32_t)oldSlot;
    int32_t argNewStockId = (int32_t)newStockId;
    int32_t argNewSlot = (int32_t)newSlot;
    uint8_t argRotate = isRotate ? 1 : 0;
    void* args[] = { &argOldStockId, &argOldSlot, &argNewStockId, &argNewSlot, &argRotate };

    Il2CppObject* task = (Il2CppObject*)SafeInvoke(moveItem, pmInst, args);
    if (!task) { SendResponse(c, id, false, "MoveItem returned null"); return; }

    char error[256] = {};
    Il2CppObject* containers = AwaitTaskResultObject(task, 30000, "MoveItem", error, sizeof(error));
    if (!containers) { SendResponse(c, id, false, error); return; }

    char* snapshotJson = (char*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, BK_BUF_SIZE);
    if (!snapshotJson) { SendResponse(c, id, false, "MoveStockItem allocation failed"); return; }

    if (!SerializeStockContainers(containers, "PlayerManager.MoveItem", snapshotJson, BK_BUF_SIZE, error, sizeof(error))) {
        HeapFree(GetProcessHeap(), 0, snapshotJson);
        SendResponse(c, id, false, error);
        return;
    }

    bool stocksRefreshed = InvokeAndAwaitNoArgTask(pmClass, pmInst, "GetAllStocks", 30000);
    if (!stocksRefreshed) {
        Logf("MoveStockItem warehouse refresh did not complete oldStockId=%d newStockId=%d", oldStockId, newStockId);
    }

    const char* containersJson = strstr(snapshotJson, "\"containers\":");
    char result[BK_BUF_SIZE] = {};
    if (!BuildMoveStockItemResultJson(
            oldStockId,
            oldSlot,
            newStockId,
            newSlot,
            isRotate,
            stocksRefreshed,
            containersJson,
            result,
            BK_BUF_SIZE)) {
        HeapFree(GetProcessHeap(), 0, snapshotJson);
        SendResponse(c, id, false, "MoveStockItem response too large");
        return;
    }

    SendResponse(c, id, true, result);
    HeapFree(GetProcessHeap(), 0, snapshotJson);
}

static void CmdGetItemTradeInfo(AgentConn* c, const char* id, const char* json) {
    int itemCid = JsonGetInt(json, "itemCid");
    if (itemCid == INT_MIN) itemCid = JsonGetInt(json, "cid");
    if (itemCid <= 0) {
        SendResponse(c, id, false, "invalid itemCid");
        return;
    }

    char result[4096] = {};
    char error[256] = {};
    if (!QueryItemTradeInfoJson(itemCid, result, sizeof(result), error, sizeof(error))) {
        SendResponse(c, id, false, error);
        return;
    }
    SendResponse(c, id, true, result);
}

static void CmdStartDelayedPriceQuery(AgentConn* c, const char* id, const char* json) {
    int itemCid = JsonGetInt(json, "itemCid");
    int delaySeconds = JsonGetInt(json, "delaySeconds");
    int jitterSeconds = JsonGetInt(json, "jitterSeconds");

    if (itemCid <= 0) { SendResponse(c, id, false, "invalid itemCid"); return; }
    if (delaySeconds == INT_MIN) delaySeconds = 600;
    if (jitterSeconds == INT_MIN) jitterSeconds = 90;
    if (delaySeconds < 1 || delaySeconds > 86400) {
        SendResponse(c, id, false, "invalid delaySeconds");
        return;
    }
    if (jitterSeconds < 0 || jitterSeconds > delaySeconds) {
        SendResponse(c, id, false, "invalid jitterSeconds");
        return;
    }

    EnterCriticalSection(&g_delayedTaskCs);
    if (IsDelayedTaskActive(g_delayedTask.state)) {
        LeaveCriticalSection(&g_delayedTaskCs);
        SendResponse(c, id, false, "delayed price query already active");
        return;
    }

    if (g_delayedTask.workerThread) {
        CloseHandle(g_delayedTask.workerThread);
        g_delayedTask.workerThread = NULL;
    }
    if (g_delayedTask.cancelEvent) {
        CloseHandle(g_delayedTask.cancelEvent);
        g_delayedTask.cancelEvent = NULL;
    }

    ZeroMemory(&g_delayedTask, sizeof(g_delayedTask));
    LONG seq = InterlockedIncrement(&g_delayedTaskSeq);
    snprintf(g_delayedTask.taskId, sizeof(g_delayedTask.taskId), "delayed-price-%ld", seq);
    g_delayedTask.itemCid = itemCid;
    g_delayedTask.delaySeconds = delaySeconds;
    g_delayedTask.jitterSeconds = jitterSeconds;
    int span = jitterSeconds * 2 + 1;
    int offset = span > 1 ? (rand() % span) - jitterSeconds : 0;
    g_delayedTask.actualDelaySeconds = delaySeconds + offset;
    g_delayedTask.startedTick = GetTickCount();
    g_delayedTask.dueTick = g_delayedTask.startedTick + (DWORD)g_delayedTask.actualDelaySeconds * 1000UL;
    g_delayedTask.state = DTS_SCHEDULED;
    g_delayedTask.cancelEvent = CreateEventA(NULL, TRUE, FALSE, NULL);
    if (!g_delayedTask.cancelEvent) {
        g_delayedTask.state = DTS_FAILED;
        snprintf(g_delayedTask.error, sizeof(g_delayedTask.error), "CreateEvent failed");
        LeaveCriticalSection(&g_delayedTaskCs);
        SendResponse(c, id, false, "CreateEvent failed");
        return;
    }

    g_delayedTask.workerThread = CreateThread(NULL, 0, DelayedPriceQueryThread, NULL, 0, NULL);
    if (!g_delayedTask.workerThread) {
        CloseHandle(g_delayedTask.cancelEvent);
        g_delayedTask.cancelEvent = NULL;
        g_delayedTask.state = DTS_FAILED;
        snprintf(g_delayedTask.error, sizeof(g_delayedTask.error), "CreateThread failed");
        LeaveCriticalSection(&g_delayedTaskCs);
        SendResponse(c, id, false, "CreateThread failed");
        return;
    }

    DelayedPriceTask snapshot = g_delayedTask;
    LeaveCriticalSection(&g_delayedTaskCs);

    Logf("DelayedPriceQuery scheduled taskId=%s itemCid=%d delay=%d jitter=%d actual=%d",
         snapshot.taskId, itemCid, delaySeconds, jitterSeconds, snapshot.actualDelaySeconds);
    char status[4096];
    BuildDelayedTaskStatusJson(&snapshot, status, sizeof(status));
    PushEventToAll("DelayedPriceQueryUpdated", status);
    SendResponse(c, id, true, status);
}

static void CmdGetDelayedPriceQueryStatus(AgentConn* c, const char* id, const char*) {
    DelayedPriceTask snapshot = {};
    SnapshotDelayedTask(&snapshot);
    char status[4096];
    BuildDelayedTaskStatusJson(&snapshot, status, sizeof(status));
    SendResponse(c, id, true, status);
}

static void CmdCancelDelayedPriceQuery(AgentConn* c, const char* id, const char* json) {
    char taskId[64] = {};
    JsonGetString(json, "taskId", taskId, sizeof(taskId));

    EnterCriticalSection(&g_delayedTaskCs);
    if (!IsDelayedTaskActive(g_delayedTask.state)) {
        DelayedPriceTask snapshot = g_delayedTask;
        LeaveCriticalSection(&g_delayedTaskCs);
        char status[4096];
        BuildDelayedTaskStatusJson(&snapshot, status, sizeof(status));
        SendResponse(c, id, true, status);
        return;
    }
    if (taskId[0] && strcmp(taskId, g_delayedTask.taskId) != 0) {
        LeaveCriticalSection(&g_delayedTaskCs);
        SendResponse(c, id, false, "taskId mismatch");
        return;
    }
    if (g_delayedTask.cancelEvent) SetEvent(g_delayedTask.cancelEvent);
    DelayedPriceTask snapshot = g_delayedTask;
    LeaveCriticalSection(&g_delayedTaskCs);

    char status[4096];
    BuildDelayedTaskStatusJson(&snapshot, status, sizeof(status));
    SendResponse(c, id, true, status);
}

static void CmdExchangeItem(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }

    int itemCid = JsonGetInt(json, "itemCid");
    if (itemCid == INT_MIN) itemCid = JsonGetInt(json, "itemId");
    int count = JsonGetInt(json, "count");
    int unitPrice = JsonGetInt(json, "unitPrice");
    int timeoutMs = JsonGetInt(json, "timeoutMs");
    if (timeoutMs == INT_MIN) timeoutMs = 15000;
    if (timeoutMs < 1000) timeoutMs = 1000;
    if (timeoutMs > 60000) timeoutMs = 60000;

    if (itemCid <= 0) { SendResponse(c, id, false, "invalid itemCid"); return; }
    if (count <= 0) { SendResponse(c, id, false, "invalid count"); return; }
    if (unitPrice <= 0) { SendResponse(c, id, false, "invalid unitPrice"); return; }
    int64_t total64 = (int64_t)count * (int64_t)unitPrice;
    if (total64 > INT_MAX) { SendResponse(c, id, false, "totalPrice overflow"); return; }
    int totalPrice = (int)total64;
    Logf("ExchangeItem begin id=%s itemCid=%d count=%d unitPrice=%d totalPrice=%d timeoutMs=%d raw=%s",
         id ? id : "", itemCid, count, unitPrice, totalPrice, timeoutMs, json ? json : "");

    Il2CppClass* pmClass = FindClass("PlayerManager");
    Logf("ExchangeItem PlayerManager class=%p", pmClass);
    Il2CppObject* pmInst = GetSingleton(pmClass);
    Logf("ExchangeItem PlayerManager instance=%p", pmInst);
    if (!pmInst) { SendResponse(c, id, false, "PlayerManager singleton null"); return; }
    const Il2CppMethod* exchangeItem = g_class_get_method_from_name(pmClass, "ExchangeItem", 3);
    Logf("ExchangeItem method=%p", exchangeItem);
    if (!exchangeItem) { SendResponse(c, id, false, "ExchangeItem not found"); return; }

    int32_t argItemCid = (int32_t)itemCid;
    int32_t argCount = (int32_t)count;
    int32_t argTotalPrice = (int32_t)totalPrice;
    void* args[] = { &argItemCid, &argCount, &argTotalPrice };
    Logf("ExchangeItem invoking PlayerManager.ExchangeItem");
    Il2CppObject* task = (Il2CppObject*)SafeInvoke(exchangeItem, pmInst, args);
    Logf("ExchangeItem invoke returned task=%p class=%s", task, ObjClassName(task));
    LogTaskState("ExchangeItem after invoke", task);

    bool ok = false;
    char error[128] = {};
    if (!AwaitTaskBool(task, timeoutMs, &ok, error, sizeof(error))) {
        LogTaskState("ExchangeItem after wait failure", task);
        Logf("ExchangeItem failed: %s", error);
        SendResponse(c, id, false, error);
        return;
    }
    LogTaskState("ExchangeItem after wait success", task);
    bool stocksRefreshed = false;
    bool exchangeItemsRefreshed = false;
    if (ok) {
        // A direct ExchangeItem call completes server-side, but the open warehouse
        // UI can keep stale local stock data until another stock request refreshes it.
        stocksRefreshed = InvokeAndAwaitNoArgTask(pmClass, pmInst, "GetAllStocks", timeoutMs);
        exchangeItemsRefreshed = InvokeAndAwaitNoArgTask(pmClass, pmInst, "GetExchangeItems", timeoutMs);
    }

    char result[320];
    snprintf(result, sizeof(result),
        "{\"itemCid\":%d,\"count\":%d,\"unitPrice\":%d,\"totalPrice\":%d,\"result\":%s,"
        "\"stocksRefreshed\":%s,\"exchangeItemsRefreshed\":%s}",
        itemCid, count, unitPrice, totalPrice, ok ? "true" : "false",
        stocksRefreshed ? "true" : "false",
        exchangeItemsRefreshed ? "true" : "false");
    Logf("ExchangeItem completed result=%s stocksRefreshed=%s exchangeItemsRefreshed=%s",
         ok ? "true" : "false",
         stocksRefreshed ? "true" : "false",
         exchangeItemsRefreshed ? "true" : "false");
    SendResponse(c, id, ok, ok ? result : "ExchangeItem returned false");
}

static void CmdInvokeMethod(AgentConn* c, const char* id, const char* json) {
    if (!g_il2cppReady) { SendResponse(c, id, false, "il2cpp not ready"); return; }
    char cls[64] = {}, meth[64] = {};
    JsonGetString(json, "class",  cls,  sizeof(cls));
    JsonGetString(json, "method", meth, sizeof(meth));
    if (!cls[0] || !meth[0]) { SendResponse(c, id, false, "missing class or method"); return; }
    Il2CppClass* klass = FindClass(cls);
    if (!klass) { SendResponse(c, id, false, "class not found"); return; }
    Il2CppObject* inst = GetSingleton(klass);
    const Il2CppMethod* m = g_class_get_method_from_name(klass, meth, 0);
    Il2CppObject* result = nullptr;
    if (m) {
        result = (Il2CppObject*)SafeInvoke(m, inst, nullptr);
    } else {
        m = g_class_get_method_from_name(klass, meth, 1);
        if (!m) { SendResponse(c, id, false, "method not found"); return; }
        int argVal = JsonGetInt(json, "arg0");
        if (argVal == INT_MIN) { SendResponse(c, id, false, "missing arg0"); return; }
        void* args[] = { (void*)(intptr_t)argVal };
        result = (Il2CppObject*)SafeInvoke(m, inst, args);
    }
    char res[256];
    snprintf(res, sizeof(res), "{\"resultClass\":\"%s\"}", ObjClassName(result));
    SendResponse(c, id, true, res);
}

static DWORD WINAPI UnloadThread(LPVOID param) {
    int delayMs = (int)(intptr_t)param;
    if (delayMs < 0) delayMs = 0;
    Sleep((DWORD)delayMs);

    InterlockedExchange(&g_shuttingDown, 1);
    RequestCloseAllConnections();
    WakePipeServer();

    if (g_agentThread) WaitForSingleObject(g_agentThread, 5000);
    if (g_heartbeatThread) WaitForSingleObject(g_heartbeatThread, 5000);

    DWORD deadline = GetTickCount() + 10000;
    while (InterlockedCompareExchange(&g_activeConnectionHandlers, 0, 0) > 0 &&
           GetTickCount() < deadline) {
        Sleep(50);
    }
    LONG activeHandlers = InterlockedCompareExchange(&g_activeConnectionHandlers, 0, 0);
    if (activeHandlers > 0) {
        Logf("Unload canceled: %ld connection handler(s) still active", activeHandlers);
        InterlockedExchange(&g_shuttingDown, 0);
        InterlockedExchange(&g_unloadScheduled, 0);
        if (g_heartbeatThread && WaitForSingleObject(g_heartbeatThread, 0) == WAIT_OBJECT_0) {
            CloseHandle(g_heartbeatThread);
            g_heartbeatThread = NULL;
        }
        if (!g_agentThread || WaitForSingleObject(g_agentThread, 0) == WAIT_OBJECT_0) {
            if (g_agentThread) {
                CloseHandle(g_agentThread);
                g_agentThread = NULL;
            }
            g_agentThread = CreateThread(NULL, 0, AgentMain, NULL, 0, NULL);
            if (!g_agentThread) {
                Logf("Unload cancel: failed to restart AgentMain (error=%lu)", GetLastError());
            }
        }
        return 0;
    }

    Logf("Unload now");
    FreeLibraryAndExitThread(g_hModule, 0);
    return 0;
}

static void CmdUnloadAgent(AgentConn* c, const char* id, const char* json) {
    if (InterlockedExchange(&g_unloadScheduled, 1) != 0) {
        SendResponse(c, id, false, "unload already scheduled");
        return;
    }

    int delayMs = JsonGetInt(json, "delayMs");
    if (delayMs == INT_MIN) delayMs = 200;
    if (delayMs < 0) delayMs = 0;
    if (delayMs > 5000) delayMs = 5000;

    char eventData[64];
    snprintf(eventData, sizeof(eventData), "{\"reason\":\"command\",\"delayMs\":%d}", delayMs);
    PushEventToAll("AgentUnloading", eventData);
    EnterCriticalSection(&g_delayedTaskCs);
    if (IsDelayedTaskActive(g_delayedTask.state) && g_delayedTask.cancelEvent) {
        SetEvent(g_delayedTask.cancelEvent);
    }
    LeaveCriticalSection(&g_delayedTaskCs);

    char result[64];
    snprintf(result, sizeof(result), "{\"unloading\":true,\"delayMs\":%d}", delayMs);
    SendResponse(c, id, true, result);

    HANDLE h = CreateThread(NULL, 0, UnloadThread, (LPVOID)(intptr_t)delayMs, 0, NULL);
    if (h) CloseHandle(h);
}

// ==========================================================================
// LoadProbe: load a probe DLL and call its BKProbeEntry export
// ==========================================================================
typedef void (*ProbeEntryFn)(const char*, char*, int);

static void CmdLoadProbe(AgentConn* c, const char* id, const char* json) {
    char dllPath[MAX_PATH] = {};
    char argsJson[BK_BUF_SIZE] = {};
    strncpy(argsJson, "{}", sizeof(argsJson) - 1);

    if (!JsonGetString(json, "dllPath", dllPath, sizeof(dllPath))) {
        SendResponse(c, id, false, "dllPath is required");
        return;
    }
    JsonGetString(json, "argsJson", argsJson, sizeof(argsJson));

    HMODULE h = LoadLibraryA(dllPath);
    if (!h) {
        char err[128];
        snprintf(err, sizeof(err), "LoadLibrary failed: 0x%08X", (unsigned)GetLastError());
        SendResponse(c, id, false, err);
        return;
    }

    ProbeEntryFn fn = (ProbeEntryFn)GetProcAddress(h, "BKProbeEntry");
    if (!fn) {
        FreeLibrary(h);
        SendResponse(c, id, false, "BKProbeEntry not exported");
        return;
    }

    static char resultBuf[65536];
    memset(resultBuf, 0, sizeof(resultBuf));
    fn(argsJson, resultBuf, (int)sizeof(resultBuf));
    FreeLibrary(h);

    // JSON-escape resultBuf into output field
    char escaped[131072];
    int ei = 0;
    for (int i = 0; resultBuf[i] && ei < (int)sizeof(escaped) - 4; i++) {
        unsigned char ch = (unsigned char)resultBuf[i];
        if (ch == '"' || ch == '\\') { escaped[ei++] = '\\'; escaped[ei++] = ch; }
        else if (ch == '\n')         { escaped[ei++] = '\\'; escaped[ei++] = 'n'; }
        else if (ch == '\r')         { escaped[ei++] = '\\'; escaped[ei++] = 'r'; }
        else                         { escaped[ei++] = (char)ch; }
    }
    escaped[ei] = '\0';

    char result[BK_BUF_SIZE];
    snprintf(result, sizeof(result), "{\"output\":\"%s\"}", escaped);
    SendResponse(c, id, true, result);
}

// ==========================================================================
// Dispatch table
// ==========================================================================
typedef void (*CmdFn)(AgentConn*, const char*, const char*);
struct CmdEntry { const char* name; CmdFn fn; };
static const CmdEntry kCommands[] = {
    { "Ping",             CmdPing             },
    { "GetCurrentUI",     CmdGetCurrentUI     },
    { "GetVisiblePanels", CmdGetVisiblePanels },
    { "OpenPanel",        CmdOpenPanel        },
    { "ClosePanel",       CmdClosePanel       },
    { "DumpPanelTree",    CmdDumpPanelTree    },
    { "ClickNode",        CmdClickNode        },
    { "SetInputText",     CmdSetInputText     },
    { "GetNodeState",     CmdGetNodeState     },
    { "WaitForVisiblePanel", CmdWaitForVisiblePanel },
    { "WaitForNode",      CmdWaitForNode      },
    { "CollectionPrices", CmdCollectionPrices },
    { "GetCollectionItemCids", CmdGetCollectionItemCids },
    { "GetWarehouseItemList", CmdGetWarehouseItemList },
    { "GetStockCollectibleCounts", CmdGetStockCollectibleCounts },
    { "GetStockContainers", CmdGetStockContainers },
    { "MoveStockItem", CmdMoveStockItem },
    { "GetItemTradeInfo",      CmdGetItemTradeInfo      },
    { "StartDelayedPriceQuery",     CmdStartDelayedPriceQuery     },
    { "GetDelayedPriceQueryStatus", CmdGetDelayedPriceQueryStatus },
    { "CancelDelayedPriceQuery",    CmdCancelDelayedPriceQuery    },
    { "ExchangeItem",     CmdExchangeItem     },
    { "InvokeMethod",     CmdInvokeMethod     },
    { "LoadProbe",        CmdLoadProbe        },
    { "UnloadAgent",      CmdUnloadAgent      },
    { nullptr,            nullptr             },
};

static void DispatchCommand(AgentConn* c, const char* id, const char* cmd,
                             const char* json) {
    for (int i = 0; kCommands[i].name; i++) {
        if (strcmp(kCommands[i].name, cmd) == 0) {
            kCommands[i].fn(c, id, json);
            return;
        }
    }
    char err[128];
    snprintf(err, sizeof(err), "unknown command: %s", cmd);
    SendResponse(c, id, false, err);
}

// ==========================================================================
// Connection handler thread — one per client
// ==========================================================================
static DWORD WINAPI ConnectionHandler(LPVOID param) {
    InterlockedIncrement(&g_activeConnectionHandlers);
    Logf("ConnectionHandler start");
    AttachCurrentThread();
    Logf("ConnectionHandler attached");

    AgentConn* c = (AgentConn*)param;
    char buf[BK_BUF_SIZE];
    while (!c->closing && !g_shuttingDown) {
        if (!ReadFrame(c->pipe, buf, BK_BUF_SIZE)) {
            Logf("ConnectionHandler ReadFrame failed");
            break;
        }
        char id[32] = {}, cmd[64] = {};
        JsonGetString(buf, "id",  id,  sizeof(id));
        JsonGetString(buf, "cmd", cmd, sizeof(cmd));
        Logf("ConnectionHandler dispatch id=%s cmd=%s", id, cmd);
        DispatchCommand(c, id, cmd, buf);
    }
    c->closing = true;
    RemoveConn(c);
    DisconnectNamedPipe(c->pipe);
    CloseHandle(c->pipe);
    DeleteCriticalSection(&c->writeMutex);
    HeapFree(GetProcessHeap(), 0, c);
    Logf("ConnectionHandler exit");
    InterlockedDecrement(&g_activeConnectionHandlers);
    return 0;
}

// ==========================================================================
// Heartbeat thread — pushes uptime every 30s to all connected clients
// ==========================================================================
static DWORD WINAPI HeartbeatThread(LPVOID) {
    DWORD uptime = 0;
    while (!g_shuttingDown) {
        for (int i = 0; i < 60 && !g_shuttingDown; i++) Sleep(500);
        if (g_shuttingDown) break;
        uptime += 30;
        char data[64];
        snprintf(data, sizeof(data), "{\"uptime\":%lu}", uptime);
        PushEventToAll("Heartbeat", data);
    }
    return 0;
}

// ==========================================================================
// AgentMain — pipe server loop
// ==========================================================================
static DWORD WINAPI AgentMain(LPVOID) {
    if (!g_logCsReady) {
        InitializeCriticalSection(&g_logCs);
        g_logCsReady = true;
    }
    Logf("AgentMain start");
    if (!g_connsCsReady) {
        InitializeCriticalSection(&g_connsCs);
        g_connsCsReady = true;
    }
    if (!g_delayedTaskCsReady) {
        InitializeCriticalSection(&g_delayedTaskCs);
        g_delayedTaskCsReady = true;
    }
    srand((unsigned int)(GetTickCount() ^ GetCurrentProcessId()));

    InitIl2cpp();
    Logf("InitIl2cpp ready=%s domain=%p", g_il2cppReady ? "true" : "false", g_domain);
    if (g_il2cppReady && g_thread_attach)
        g_thread_attach(g_domain);

    g_heartbeatThread = CreateThread(NULL, 0, HeartbeatThread, NULL, 0, NULL);

    while (!g_shuttingDown) {
        HANDLE pipe = CreateNamedPipeA(
            BKPIPE_NAME,
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            PIPE_UNLIMITED_INSTANCES,
            BK_BUF_SIZE, BK_BUF_SIZE, 0, NULL);

        if (pipe == INVALID_HANDLE_VALUE) { Sleep(1000); continue; }

        if (!ConnectNamedPipe(pipe, NULL) &&
            GetLastError() != ERROR_PIPE_CONNECTED) {
            CloseHandle(pipe); continue;
        }

        if (g_shuttingDown) { CloseHandle(pipe); break; }

        if (g_connCount >= MAX_CONNS) { CloseHandle(pipe); continue; }

        AgentConn* c = (AgentConn*)HeapAlloc(
            GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(AgentConn));
        c->pipe = pipe;
        InitializeCriticalSection(&c->writeMutex);

        EnterCriticalSection(&g_connsCs);
        g_conns[g_connCount++] = c;
        LeaveCriticalSection(&g_connsCs);

        CreateThread(NULL, 0, ConnectionHandler, c, 0, NULL);
    }
    Logf("AgentMain exit");
    return 0;
}

// ==========================================================================
// DllMain
// ==========================================================================
BOOL WINAPI DllMain(HINSTANCE hInst, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hInst);
        g_hModule = hInst;
        g_agentThread = CreateThread(NULL, 0, AgentMain, NULL, 0, NULL);
    }
    return TRUE;
}
