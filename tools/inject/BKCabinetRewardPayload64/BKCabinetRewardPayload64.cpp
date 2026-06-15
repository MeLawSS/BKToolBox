// BKCabinetRewardPayload64.cpp -- BidKing cabinet reward reader payload
// Build: bash build.sh

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlobj.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef void Il2CppDomain;
typedef void Il2CppAssembly;
typedef void Il2CppImage;
typedef void Il2CppClass;
typedef void Il2CppMethod;
typedef void Il2CppFieldInfo;
typedef void Il2CppObject;

#define FIELDINFO_OBJECT_OFFSET(f) (*(int32_t*)((char*)(f) + 24))
#define UNBOX_INT32(obj) (*(int32_t*)((char*)(obj) + 16))
#define UNBOX_BOOL(obj) (*(bool*)((char*)(obj) + 16))

typedef Il2CppDomain*          (*fn_domain_get)();
typedef const Il2CppAssembly** (*fn_domain_get_assemblies)(const Il2CppDomain*, size_t*);
typedef Il2CppImage*           (*fn_assembly_get_image)(const Il2CppAssembly*);
typedef const char*            (*fn_image_get_name)(const Il2CppImage*);
typedef size_t                 (*fn_image_get_class_count)(const Il2CppImage*);
typedef Il2CppClass*           (*fn_image_get_class)(const Il2CppImage*, size_t);
typedef Il2CppClass*           (*fn_class_from_name)(Il2CppImage*, const char*, const char*);
typedef const char*            (*fn_class_get_name)(const Il2CppClass*);
typedef const char*            (*fn_class_get_namespace)(const Il2CppClass*);
typedef const Il2CppMethod*    (*fn_class_get_method_from_name)(Il2CppClass*, const char*, int);
typedef Il2CppObject*          (*fn_runtime_invoke)(const Il2CppMethod*, void*, void**, Il2CppObject**);
typedef Il2CppFieldInfo*       (*fn_class_get_field_from_name)(Il2CppClass*, const char*);
typedef void                   (*fn_field_static_get_value)(Il2CppFieldInfo*, void*);
typedef Il2CppClass*           (*fn_object_get_class)(Il2CppObject*);
typedef void*                  (*fn_thread_attach)(Il2CppDomain*);
typedef void                   (*fn_thread_detach)(void*);

static fn_domain_get                 g_domain_get;
static fn_domain_get_assemblies      g_domain_get_assemblies;
static fn_assembly_get_image         g_assembly_get_image;
static fn_image_get_name             g_image_get_name;
static fn_image_get_class_count      g_image_get_class_count;
static fn_image_get_class            g_image_get_class;
static fn_class_from_name            g_class_from_name;
static fn_class_get_name             g_class_get_name;
static fn_class_get_namespace        g_class_get_namespace;
static fn_class_get_method_from_name g_class_get_method_from_name;
static fn_runtime_invoke             g_runtime_invoke;
static fn_class_get_field_from_name  g_class_get_field_from_name;
static fn_field_static_get_value     g_field_static_get_value;
static fn_object_get_class           g_object_get_class;
static fn_thread_attach              g_thread_attach;
static fn_thread_detach              g_thread_detach;

static FILE* g_log = NULL;
static HINSTANCE g_hModule = NULL;

static void Log(const char* fmt, ...) {
    if (!g_log) return;
    va_list va;
    va_start(va, fmt);
    vfprintf(g_log, fmt, va);
    va_end(va);
    fputc('\n', g_log);
    fflush(g_log);
}

static bool BuildBidKingDocumentsPath(char* rootPath, size_t rootSize) {
    char docPath[MAX_PATH] = {};
    if (SHGetFolderPathA(NULL, CSIDL_PERSONAL, NULL, 0, docPath) != S_OK) return false;
    snprintf(rootPath, rootSize, "%s\\BidKing", docPath);
    CreateDirectoryA(rootPath, NULL);
    return true;
}

static void ReadInjectCommand(char* command, size_t commandSize) {
    if (!command || commandSize == 0) return;
    strncpy(command, "CabinetReward", commandSize - 1);
    command[commandSize - 1] = '\0';

    char rootPath[MAX_PATH] = {};
    if (!BuildBidKingDocumentsPath(rootPath, sizeof(rootPath))) return;

    char commandPath[MAX_PATH] = {};
    snprintf(commandPath, sizeof(commandPath), "%s\\inject-command.txt", rootPath);

    FILE* f = fopen(commandPath, "r");
    if (!f) return;

    char line[128] = {};
    if (fgets(line, sizeof(line), f)) {
        size_t len = strcspn(line, "\r\n");
        line[len] = '\0';
        if (line[0]) {
            snprintf(command, commandSize, "%s", line);
        }
    }
    fclose(f);
}

static void FormatUtcIso(char* out, size_t outSize) {
    SYSTEMTIME st = {};
    GetSystemTime(&st);
    snprintf(
        out,
        outSize,
        "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
        st.wYear,
        st.wMonth,
        st.wDay,
        st.wHour,
        st.wMinute,
        st.wSecond,
        st.wMilliseconds
    );
}

static bool WriteResultJson(bool ok, const char* error, int32_t awardCount, int32_t cabinetCount, const char* source) {
    char rootPath[MAX_PATH] = {};
    if (!BuildBidKingDocumentsPath(rootPath, sizeof(rootPath))) return false;

    char observedAt[64] = {};
    FormatUtcIso(observedAt, sizeof(observedAt));

    char outputPath[MAX_PATH] = {};
    char tempPath[MAX_PATH] = {};
    snprintf(outputPath, sizeof(outputPath), "%s\\cabinet-reward.json", rootPath);
    snprintf(tempPath, sizeof(tempPath), "%s\\cabinet-reward.%lu.%lu.tmp", rootPath, GetCurrentProcessId(), GetTickCount());

    FILE* out = fopen(tempPath, "w");
    if (!out) return false;

    if (ok) {
        fprintf(
            out,
            "{\n"
            "  \"ok\": true,\n"
            "  \"observedAt\": \"%s\",\n"
            "  \"awardCount\": %d,\n"
            "  \"cabinetCount\": %d,\n"
            "  \"source\": \"%s\"\n"
            "}\n",
            observedAt,
            awardCount,
            cabinetCount,
            source ? source : "unknown"
        );
    } else {
        fprintf(
            out,
            "{\n"
            "  \"ok\": false,\n"
            "  \"observedAt\": \"%s\",\n"
            "  \"error\": \"%s\"\n"
            "}\n",
            observedAt,
            error ? error : "unknown error"
        );
    }
    fclose(out);

    if (!MoveFileExA(tempPath, outputPath, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DeleteFileA(tempPath);
        return false;
    }
    Log("result written -> %s", outputPath);
    return true;
}

#define GETFN(mod, name, var) \
    var = (decltype(var))GetProcAddress(mod, #name); \
    if (!var) Log("missing: " #name);

static bool ResolveFunctions(HMODULE hGame) {
    GETFN(hGame, il2cpp_domain_get, g_domain_get)
    GETFN(hGame, il2cpp_domain_get_assemblies, g_domain_get_assemblies)
    GETFN(hGame, il2cpp_assembly_get_image, g_assembly_get_image)
    GETFN(hGame, il2cpp_image_get_name, g_image_get_name)
    GETFN(hGame, il2cpp_image_get_class_count, g_image_get_class_count)
    GETFN(hGame, il2cpp_image_get_class, g_image_get_class)
    GETFN(hGame, il2cpp_class_from_name, g_class_from_name)
    GETFN(hGame, il2cpp_class_get_name, g_class_get_name)
    GETFN(hGame, il2cpp_class_get_namespace, g_class_get_namespace)
    GETFN(hGame, il2cpp_class_get_method_from_name, g_class_get_method_from_name)
    GETFN(hGame, il2cpp_runtime_invoke, g_runtime_invoke)
    GETFN(hGame, il2cpp_class_get_field_from_name, g_class_get_field_from_name)
    GETFN(hGame, il2cpp_field_static_get_value, g_field_static_get_value)
    GETFN(hGame, il2cpp_object_get_class, g_object_get_class)
    GETFN(hGame, il2cpp_thread_attach, g_thread_attach)
    GETFN(hGame, il2cpp_thread_detach, g_thread_detach)

    return g_domain_get && g_domain_get_assemblies && g_assembly_get_image &&
        g_class_from_name && g_class_get_method_from_name && g_runtime_invoke;
}

static Il2CppObject* SafeInvoke(const Il2CppMethod* method, void* obj, void** args) {
    Il2CppObject* exc = NULL;
    Il2CppObject* result = g_runtime_invoke(method, obj, args, &exc);
    if (exc) {
        Il2CppClass* excClass = g_object_get_class ? g_object_get_class(exc) : NULL;
        const char* excName = (excClass && g_class_get_name) ? g_class_get_name(excClass) : "?";
        Log("EXCEPTION: %s", excName);
        return NULL;
    }
    return result;
}

static Il2CppClass* FindClass(Il2CppDomain* domain, const char* className) {
    if (!domain) return NULL;
    size_t count = 0;
    const Il2CppAssembly** assemblies = g_domain_get_assemblies(domain, &count);
    const char* namespaces[] = { "", "BidKing", "Game", "Main", NULL };

    for (size_t i = 0; i < count; i++) {
        Il2CppImage* img = g_assembly_get_image(assemblies[i]);
        if (!img) continue;
        for (int ni = 0; namespaces[ni]; ni++) {
            Il2CppClass* k = g_class_from_name(img, namespaces[ni], className);
            if (k) return k;
        }
        if (!g_image_get_class_count || !g_image_get_class) continue;
        size_t classCount = g_image_get_class_count(img);
        for (size_t ci = 0; ci < classCount; ci++) {
            Il2CppClass* k = g_image_get_class(img, ci);
            const char* name = (k && g_class_get_name) ? g_class_get_name(k) : NULL;
            if (name && strcmp(name, className) == 0) return k;
        }
    }
    return NULL;
}

static Il2CppObject* GetSingleton(Il2CppClass* klass) {
    if (!klass) return NULL;

    if (g_class_get_field_from_name && g_field_static_get_value) {
        Il2CppFieldInfo* f = g_class_get_field_from_name(klass, "Instance");
        if (f) {
            Il2CppObject* inst = NULL;
            g_field_static_get_value(f, &inst);
            if (inst) return inst;
        }
    }

    const Il2CppMethod* getter = g_class_get_method_from_name(klass, "get_Instance", 0);
    return getter ? SafeInvoke(getter, NULL, NULL) : NULL;
}

static bool IsTaskCompleted(Il2CppObject* task) {
    if (!task || !g_object_get_class) return false;
    Il2CppClass* taskClass = g_object_get_class(task);
    const Il2CppMethod* isCompleted = taskClass ? g_class_get_method_from_name(taskClass, "get_IsCompleted", 0) : NULL;
    Il2CppObject* done = isCompleted ? SafeInvoke(isCompleted, task, NULL) : NULL;
    return done && UNBOX_BOOL(done);
}

static Il2CppObject* AwaitTaskResult(Il2CppObject* task, int timeoutMs) {
    if (!task || !g_object_get_class) return NULL;
    Il2CppClass* taskClass = g_object_get_class(task);
    const Il2CppMethod* getResult = taskClass ? g_class_get_method_from_name(taskClass, "get_Result", 0) : NULL;
    if (!getResult) return NULL;

    DWORD start = GetTickCount();
    while ((int)(GetTickCount() - start) < timeoutMs) {
        if (IsTaskCompleted(task)) return SafeInvoke(getResult, task, NULL);
        Sleep(50);
    }
    return NULL;
}

static int32_t ReadIntProperty(Il2CppObject* obj, const char* methodName) {
    if (!obj || !methodName || !g_object_get_class) return 0;
    Il2CppClass* klass = g_object_get_class(obj);
    const Il2CppMethod* method = klass ? g_class_get_method_from_name(klass, methodName, 0) : NULL;
    Il2CppObject* value = method ? SafeInvoke(method, obj, NULL) : NULL;
    return value ? UNBOX_INT32(value) : 0;
}

static bool SumRewardsFromStockList(Il2CppObject* stockList, int32_t* awardCountOut, int32_t* cabinetCountOut) {
    if (!stockList || !awardCountOut || !cabinetCountOut || !g_object_get_class) return false;

    Il2CppClass* listClass = g_object_get_class(stockList);
    const Il2CppMethod* getCount = listClass ? g_class_get_method_from_name(listClass, "get_Count", 0) : NULL;
    const Il2CppMethod* getItem = listClass ? g_class_get_method_from_name(listClass, "get_Item", 1) : NULL;
    if (!getCount || !getItem) return false;

    Il2CppObject* countObj = SafeInvoke(getCount, stockList, NULL);
    int32_t cabinetCount = countObj ? UNBOX_INT32(countObj) : 0;
    int32_t awardCount = 0;

    for (int32_t i = 0; i < cabinetCount; i++) {
        void* args[1] = { &i };
        Il2CppObject* stock = SafeInvoke(getItem, stockList, args);
        if (!stock) continue;

        int32_t cumulative = ReadIntProperty(stock, "get_CabinetCumulativeReward");
        int32_t reward = ReadIntProperty(stock, "get_CabinetReward");
        int32_t value = cumulative + reward;
        if (value > 0) awardCount += value;
        Log("stock[%d] cumulative=%d reward=%d value=%d", i, cumulative, reward, value);
    }

    *awardCountOut = awardCount;
    *cabinetCountOut = cabinetCount;
    return true;
}

static bool RunCabinetReward(Il2CppDomain* domain, const char* source) {
    Il2CppClass* pmClass = FindClass(domain, "PlayerManager");
    if (!pmClass) return WriteResultJson(false, "PlayerManager not found", 0, 0, NULL);

    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) return WriteResultJson(false, "PlayerManager singleton null", 0, 0, NULL);

    const Il2CppMethod* getCabinetList = g_class_get_method_from_name(pmClass, "GetCabinetList", 0);
    if (!getCabinetList) return WriteResultJson(false, "PlayerManager.GetCabinetList not found", 0, 0, NULL);

    Il2CppObject* listTask = SafeInvoke(getCabinetList, pmInst, NULL);
    if (!listTask) return WriteResultJson(false, "GetCabinetList returned null", 0, 0, NULL);

    Il2CppObject* stockList = AwaitTaskResult(listTask, 30000);
    if (!stockList) return WriteResultJson(false, "GetCabinetList did not complete", 0, 0, NULL);

    int32_t awardCount = 0;
    int32_t cabinetCount = 0;
    if (!SumRewardsFromStockList(stockList, &awardCount, &cabinetCount)) {
        return WriteResultJson(false, "GetCabinetList result methods missing", 0, 0, NULL);
    }

    Log("awardCount=%d cabinetCount=%d", awardCount, cabinetCount);
    return WriteResultJson(true, NULL, awardCount, cabinetCount, source ? source : "PlayerManager.GetCabinetList");
}

static bool RunClaimCabinetReward(Il2CppDomain* domain) {
    Il2CppClass* pmClass = FindClass(domain, "PlayerManager");
    if (!pmClass) return WriteResultJson(false, "PlayerManager not found", 0, 0, NULL);

    Il2CppObject* pmInst = GetSingleton(pmClass);
    if (!pmInst) return WriteResultJson(false, "PlayerManager singleton null", 0, 0, NULL);

    const Il2CppMethod* getCabinetReward = g_class_get_method_from_name(pmClass, "GetCabinetReward", 0);
    if (!getCabinetReward) return WriteResultJson(false, "PlayerManager.GetCabinetReward not found", 0, 0, NULL);

    Il2CppObject* claimTask = SafeInvoke(getCabinetReward, pmInst, NULL);
    if (!claimTask) return WriteResultJson(false, "GetCabinetReward returned null", 0, 0, NULL);

    Il2CppObject* claimResult = AwaitTaskResult(claimTask, 30000);
    if (!claimResult) return WriteResultJson(false, "GetCabinetReward did not complete", 0, 0, NULL);
    if (!UNBOX_BOOL(claimResult)) return WriteResultJson(false, "GetCabinetReward returned false", 0, 0, NULL);

    Log("GetCabinetReward returned true");
    return RunCabinetReward(domain, "PlayerManager.GetCabinetReward");
}

static DWORD WINAPI Worker(LPVOID) {
    Sleep(3000);

    char rootPath[MAX_PATH] = {};
    if (BuildBidKingDocumentsPath(rootPath, sizeof(rootPath))) {
        char logPath[MAX_PATH] = {};
        snprintf(logPath, sizeof(logPath), "%s\\cabinet-reward.log", rootPath);
        g_log = fopen(logPath, "w");
    }

    HMODULE hGame = GetModuleHandleA("GameAssembly.dll");
    if (!hGame || !ResolveFunctions(hGame)) {
        WriteResultJson(false, "GameAssembly or IL2CPP exports unavailable", 0, 0, NULL);
        goto done;
    }

    {
        Il2CppDomain* domain = g_domain_get();
        void* thread = (g_thread_attach && domain) ? g_thread_attach(domain) : NULL;
        char command[64] = {};
        ReadInjectCommand(command, sizeof(command));
        Log("command=%s", command);
        if (strcmp(command, "ClaimCabinetReward") == 0) {
            RunClaimCabinetReward(domain);
        } else {
            RunCabinetReward(domain, "PlayerManager.GetCabinetList");
        }
        if (thread && g_thread_detach) g_thread_detach(thread);
    }

done:
    if (g_log) {
        fclose(g_log);
        g_log = NULL;
    }
    FreeLibraryAndExitThread(g_hModule, 0);
    return 0;
}

BOOL WINAPI DllMain(HINSTANCE hInst, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hInst);
        g_hModule = hInst;
        HANDLE h = CreateThread(NULL, 0, Worker, NULL, 0, NULL);
        if (h) CloseHandle(h);
    }
    return TRUE;
}
