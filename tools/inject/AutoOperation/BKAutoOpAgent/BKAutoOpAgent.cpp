#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include <stdlib.h>
#include <limits.h>
#include <algorithm>
#include <string>
#include <vector>
#include "../protocol.h"
#include "MoveStockItemResult.h"
#include "StockIdSemantics.h"
#include "TradeListSummary.h"
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
