// BKPayload64.cpp — IL2CPP diagnostic injection DLL for BidKing
// Build: bash build.sh

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlobj.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <limits.h>

// ---------------------------------------------------------------------------
// il2cpp type stubs
// ---------------------------------------------------------------------------
typedef void Il2CppDomain;
typedef void Il2CppAssembly;
typedef void Il2CppImage;
typedef void Il2CppClass;
typedef void Il2CppMethod;
typedef void Il2CppFieldInfo;
typedef void Il2CppObject;

// IL2CPP FieldInfo layout on x64:
//   offset  0 : const char*        name
//   offset  8 : const Il2CppType*  type
//   offset 16 : Il2CppClass*       parent
//   offset 24 : int32_t            offset  <-- field byte-offset inside object
//   offset 28 : uint32_t           token
#define FIELDINFO_OBJECT_OFFSET(f) (*(int32_t*)((char*)(f) + 24))

// IL2CPP object header on x64: klass(8) + monitor(8) = 16 bytes
// Boxed value data starts at offset 16.
#define UNBOX_INT32(obj)  (*(int32_t *)((char*)(obj) + 16))
#define UNBOX_BOOL(obj)   (*(bool    *)((char*)(obj) + 16))

// ---------------------------------------------------------------------------
// il2cpp function pointer typedefs
// ---------------------------------------------------------------------------
typedef Il2CppDomain*         (*fn_domain_get)();
typedef const Il2CppAssembly**(*fn_domain_get_assemblies)(const Il2CppDomain*, size_t*);
typedef Il2CppImage*          (*fn_assembly_get_image)(const Il2CppAssembly*);
typedef const char*           (*fn_image_get_name)(const Il2CppImage*);
typedef size_t                (*fn_image_get_class_count)(const Il2CppImage*);
typedef Il2CppClass*          (*fn_image_get_class)(const Il2CppImage*, size_t);
typedef Il2CppClass*          (*fn_class_from_name)(Il2CppImage*, const char*, const char*);
typedef const char*           (*fn_class_get_name)(const Il2CppClass*);
typedef const char*           (*fn_class_get_namespace)(const Il2CppClass*);
typedef const Il2CppMethod*   (*fn_class_get_method_from_name)(Il2CppClass*, const char*, int);
typedef const Il2CppMethod*   (*fn_class_get_methods)(Il2CppClass*, void**);
typedef const char*           (*fn_method_get_name)(const Il2CppMethod*);
typedef uint32_t              (*fn_method_get_param_count)(const Il2CppMethod*);
typedef bool                  (*fn_method_is_static)(const Il2CppMethod*);
typedef Il2CppObject*         (*fn_runtime_invoke)(const Il2CppMethod*, void*, void**, Il2CppObject**);
typedef Il2CppFieldInfo*      (*fn_class_get_field_from_name)(Il2CppClass*, const char*);
typedef void                  (*fn_field_static_get_value)(Il2CppFieldInfo*, void*);
typedef Il2CppFieldInfo*      (*fn_class_get_fields)(Il2CppClass*, void**);
typedef const char*           (*fn_field_get_name)(const Il2CppFieldInfo*);
typedef Il2CppClass*          (*fn_object_get_class)(Il2CppObject*);
typedef void*                 (*fn_thread_attach)(Il2CppDomain*);
typedef void                  (*fn_thread_detach)(void*);
typedef int32_t               (*fn_string_length)(Il2CppObject*);
typedef uint16_t*             (*fn_string_chars)(Il2CppObject*);

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
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
static fn_class_get_methods          g_class_get_methods;
static fn_method_get_name            g_method_get_name;
static fn_method_get_param_count     g_method_get_param_count;
static fn_method_is_static           g_method_is_static;
static fn_runtime_invoke             g_runtime_invoke;
static fn_class_get_field_from_name  g_class_get_field_from_name;
static fn_field_static_get_value     g_field_static_get_value;
static fn_class_get_fields           g_class_get_fields;
static fn_field_get_name             g_field_get_name;
static fn_object_get_class           g_object_get_class;
static fn_thread_attach              g_thread_attach;
static fn_thread_detach              g_thread_detach;
static fn_string_length              g_string_length;
static fn_string_chars               g_string_chars;

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------
static FILE*     g_log     = NULL;
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

static void LogSection(const char* title) {
    if (!g_log) return;
    fprintf(g_log, "\n=== %s ===\n", title);
    fflush(g_log);
}

static bool BuildPriceHistoryPaths(char* rootPath, size_t rootSize, char* itemsPath, size_t itemsSize, char* laddersPath = NULL, size_t laddersSize = 0) {
    char docPath[MAX_PATH] = {};
    if (SHGetFolderPathA(NULL, CSIDL_PERSONAL, NULL, 0, docPath) != S_OK) return false;
    snprintf(rootPath, rootSize, "%s\\BKPriceHistory", docPath);
    snprintf(itemsPath, itemsSize, "%s\\items", rootPath);
    if (laddersPath && laddersSize > 0) {
        snprintf(laddersPath, laddersSize, "%s\\ladders", rootPath);
    }
    CreateDirectoryA(rootPath, NULL);
    CreateDirectoryA(itemsPath, NULL);
    if (laddersPath && laddersSize > 0) {
        CreateDirectoryA(laddersPath, NULL);
    }
    return true;
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

static bool ParseCsvRecord(const char* line, char* observedAt, size_t observedAtSize, int32_t* minPrice) {
    if (!line || !observedAt || !minPrice) return false;
    const char* comma = strchr(line, ',');
    if (!comma) return false;
    size_t dateLen = (size_t)(comma - line);
    if (dateLen == 0 || dateLen >= observedAtSize) return false;
    memcpy(observedAt, line, dateLen);
    observedAt[dateLen] = '\0';
    char* end = NULL;
    long parsed = strtol(comma + 1, &end, 10);
    if (end == comma + 1) return false;
    *minPrice = (int32_t)parsed;
    return true;
}

static bool ShouldAppendCsvRecord(const char* csvPath, const char* observedAt, int32_t minPrice) {
    FILE* f = fopen(csvPath, "r");
    if (!f) return true;

    char line[256] = {};
    char last[256] = {};
    while (fgets(line, sizeof(line), f)) {
        if (strncmp(line, "observedAt,", 11) == 0) continue;
        if (line[0] == '\0' || line[0] == '\r' || line[0] == '\n') continue;
        strncpy(last, line, sizeof(last) - 1);
        last[sizeof(last) - 1] = '\0';
    }
    fclose(f);

    char lastObservedAt[64] = {};
    int32_t lastMinPrice = 0;
    if (!ParseCsvRecord(last, lastObservedAt, sizeof(lastObservedAt), &lastMinPrice)) return true;

    // Match the JS store's dedupe granularity: observed second + min price.
    return !(strncmp(lastObservedAt, observedAt, 19) == 0 && lastMinPrice == minPrice);
}

static bool AppendPriceCsvRecord(int32_t cid, const char* observedAt, int32_t minPrice) {
    char rootPath[MAX_PATH] = {};
    char itemsPath[MAX_PATH] = {};
    if (!BuildPriceHistoryPaths(rootPath, sizeof(rootPath), itemsPath, sizeof(itemsPath))) return false;

    char csvPath[MAX_PATH] = {};
    snprintf(csvPath, sizeof(csvPath), "%s\\%d.csv", itemsPath, cid);
    WIN32_FILE_ATTRIBUTE_DATA attr = {};
    bool hasData = GetFileAttributesExA(csvPath, GetFileExInfoStandard, &attr) &&
        (attr.nFileSizeHigh != 0 || attr.nFileSizeLow != 0);
    if (!ShouldAppendCsvRecord(csvPath, observedAt, minPrice)) return true;

    FILE* f = fopen(csvPath, "a");
    if (!f) return false;
    if (!hasData) fprintf(f, "observedAt,minPrice\n");
    fprintf(f, "%s,%d\n", observedAt, minPrice);
    fclose(f);
    return true;
}

static bool AppendLadderJsonlRecord(int32_t cid, const char* observedAt, const int32_t* prices, const int32_t* counts, int32_t tierCount) {
    if (!observedAt || !prices || !counts || tierCount <= 0) return false;

    char rootPath[MAX_PATH] = {};
    char itemsPath[MAX_PATH] = {};
    char laddersPath[MAX_PATH] = {};
    if (!BuildPriceHistoryPaths(rootPath, sizeof(rootPath), itemsPath, sizeof(itemsPath), laddersPath, sizeof(laddersPath))) return false;

    char jsonlPath[MAX_PATH] = {};
    snprintf(jsonlPath, sizeof(jsonlPath), "%s\\%d.jsonl", laddersPath, cid);

    FILE* f = fopen(jsonlPath, "a");
    if (!f) return false;

    bool ok = true;
    if (fprintf(f, "{\"observedAt\":\"%s\",\"itemCid\":%d,\"tiers\":[", observedAt, cid) < 0) ok = false;
    for (int32_t i = 0; i < tierCount; i++) {
        if (i > 0 && fprintf(f, ",") < 0) ok = false;
        if (fprintf(f, "{\"price\":%d,\"count\":%d}", prices[i], counts[i]) < 0) ok = false;
    }
    if (fprintf(f, "]}\n") < 0) ok = false;
    if (ferror(f)) ok = false;
    if (fclose(f) != 0) ok = false;
    return ok;
}

static bool ReadLastCsvRecord(const char* csvPath, char* observedAt, size_t observedAtSize, int32_t* minPrice) {
    FILE* f = fopen(csvPath, "r");
    if (!f) return false;

    char line[256] = {};
    char last[256] = {};
    while (fgets(line, sizeof(line), f)) {
        if (strncmp(line, "observedAt,", 11) == 0) continue;
        if (line[0] == '\0' || line[0] == '\r' || line[0] == '\n') continue;
        strncpy(last, line, sizeof(last) - 1);
        last[sizeof(last) - 1] = '\0';
    }
    fclose(f);
    return ParseCsvRecord(last, observedAt, observedAtSize, minPrice);
}

static bool IsCsvFilenameForCid(const char* fileName, int32_t* cid) {
    if (!fileName || !cid) return false;
    const char* dot = strrchr(fileName, '.');
    if (!dot || strcmp(dot, ".csv") != 0) return false;
    char idText[32] = {};
    size_t len = (size_t)(dot - fileName);
    if (len == 0 || len >= sizeof(idText)) return false;
    memcpy(idText, fileName, len);
    idText[len] = '\0';
    for (size_t i = 0; i < len; i++) {
        if (idText[i] < '0' || idText[i] > '9') return false;
    }
    long parsed = strtol(idText, NULL, 10);
    if (parsed <= 0 || parsed > INT_MAX) return false;
    *cid = (int32_t)parsed;
    return true;
}

static bool RewriteLatestFromCsv() {
    char rootPath[MAX_PATH] = {};
    char itemsPath[MAX_PATH] = {};
    if (!BuildPriceHistoryPaths(rootPath, sizeof(rootPath), itemsPath, sizeof(itemsPath))) return false;

    char searchPath[MAX_PATH] = {};
    snprintf(searchPath, sizeof(searchPath), "%s\\*.csv", itemsPath);

    char latestPath[MAX_PATH] = {};
    char tempPath[MAX_PATH] = {};
    snprintf(latestPath, sizeof(latestPath), "%s\\latest.json", rootPath);
    snprintf(tempPath, sizeof(tempPath), "%s\\latest.%lu.%lu.tmp", rootPath, GetCurrentProcessId(), GetTickCount());

    FILE* out = fopen(tempPath, "w");
    if (!out) return false;

    fprintf(out, "{\n");
    bool first = true;
    WIN32_FIND_DATAA data = {};
    HANDLE hFind = FindFirstFileA(searchPath, &data);
    if (hFind != INVALID_HANDLE_VALUE) {
        do {
            if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) continue;
            int32_t cid = 0;
            if (!IsCsvFilenameForCid(data.cFileName, &cid)) continue;

            char csvPath[MAX_PATH] = {};
            snprintf(csvPath, sizeof(csvPath), "%s\\%s", itemsPath, data.cFileName);
            char observedAt[64] = {};
            int32_t minPrice = 0;
            if (!ReadLastCsvRecord(csvPath, observedAt, sizeof(observedAt), &minPrice)) continue;

            if (!first) fprintf(out, ",\n");
            fprintf(
                out,
                "  \"%d\": {\n"
                "    \"observedAt\": \"%s\",\n"
                "    \"itemCid\": %d,\n"
                "    \"minPrice\": %d\n"
                "  }",
                cid,
                observedAt,
                cid,
                minPrice
            );
            first = false;
        } while (FindNextFileA(hFind, &data));
        FindClose(hFind);
    }
    fprintf(out, "\n}\n");
    fclose(out);

    if (!MoveFileExA(tempPath, latestPath, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DeleteFileA(tempPath);
        return false;
    }
    return true;
}

static Il2CppObject* SafeInvoke(const Il2CppMethod* method, void* obj, void** args) {
    Il2CppObject* exc = NULL;
    Il2CppObject* result = g_runtime_invoke(method, obj, args, &exc);
    if (exc) {
        Il2CppClass* excClass = g_object_get_class ? g_object_get_class(exc) : NULL;
        const char* excName = (excClass && g_class_get_name) ? g_class_get_name(excClass) : "?";
        Log("  [EXC] %s", excName);
        return NULL;
    }
    return result;
}

// ---------------------------------------------------------------------------
// Resolve il2cpp functions
// ---------------------------------------------------------------------------
#define GETFN(mod, name, var) \
    var = (decltype(var))GetProcAddress(mod, #name); \
    if (!var) Log("  missing: " #name);

static bool ResolveFunctions(HMODULE hGame) {
    Log("Resolving il2cpp exports...");
    GETFN(hGame, il2cpp_domain_get,                g_domain_get)
    GETFN(hGame, il2cpp_domain_get_assemblies,     g_domain_get_assemblies)
    GETFN(hGame, il2cpp_assembly_get_image,        g_assembly_get_image)
    GETFN(hGame, il2cpp_image_get_name,            g_image_get_name)
    GETFN(hGame, il2cpp_image_get_class_count,     g_image_get_class_count)
    GETFN(hGame, il2cpp_image_get_class,           g_image_get_class)
    GETFN(hGame, il2cpp_class_from_name,           g_class_from_name)
    GETFN(hGame, il2cpp_class_get_name,            g_class_get_name)
    GETFN(hGame, il2cpp_class_get_namespace,       g_class_get_namespace)
    GETFN(hGame, il2cpp_class_get_method_from_name,g_class_get_method_from_name)
    GETFN(hGame, il2cpp_class_get_methods,         g_class_get_methods)
    GETFN(hGame, il2cpp_method_get_name,           g_method_get_name)
    GETFN(hGame, il2cpp_method_get_param_count,    g_method_get_param_count)
    GETFN(hGame, il2cpp_method_is_static,          g_method_is_static)
    GETFN(hGame, il2cpp_runtime_invoke,            g_runtime_invoke)
    GETFN(hGame, il2cpp_class_get_field_from_name, g_class_get_field_from_name)
    GETFN(hGame, il2cpp_field_static_get_value,    g_field_static_get_value)
    GETFN(hGame, il2cpp_class_get_fields,          g_class_get_fields)
    GETFN(hGame, il2cpp_field_get_name,            g_field_get_name)
    GETFN(hGame, il2cpp_object_get_class,          g_object_get_class)
    GETFN(hGame, il2cpp_thread_attach,             g_thread_attach)
    GETFN(hGame, il2cpp_thread_detach,             g_thread_detach)
    GETFN(hGame, il2cpp_string_length,             g_string_length)
    GETFN(hGame, il2cpp_string_chars,              g_string_chars)
    return g_domain_get && g_domain_get_assemblies && g_assembly_get_image
        && g_class_from_name && g_class_get_method_from_name && g_runtime_invoke;
}

// Forward declarations
static Il2CppObject* GetSingleton(Il2CppClass* klass);

// ---------------------------------------------------------------------------
// Generic class finder (scans all assemblies)
// ---------------------------------------------------------------------------
static Il2CppClass* FindClass(Il2CppDomain* domain, const char* className, bool quiet = false) {
    if (!domain) return NULL;
    size_t count = 0;
    const Il2CppAssembly** assemblies = g_domain_get_assemblies(domain, &count);
    const char* namespaces[] = { "", "BidKing", "Game", "Main", NULL };
    for (size_t i = 0; i < count; i++) {
        if (!assemblies[i]) continue;
        Il2CppImage* img = g_assembly_get_image(assemblies[i]);
        if (!img) continue;
        for (int ni = 0; namespaces[ni]; ni++) {
            Il2CppClass* k = g_class_from_name(img, namespaces[ni], className);
            if (k) {
                if (!quiet) {
                    const char* imgName = g_image_get_name ? g_image_get_name(img) : "?";
                    Log("Found %s in image='%s' ns='%s'", className, imgName, namespaces[ni]);
                }
                return k;
            }
        }
        if (g_image_get_class_count && g_image_get_class) {
            size_t cc = g_image_get_class_count(img);
            for (size_t ci = 0; ci < cc; ci++) {
                Il2CppClass* c = g_image_get_class(img, ci);
                if (!c) continue;
                const char* cn = g_class_get_name ? g_class_get_name(c) : NULL;
                if (cn && strcmp(cn, className) == 0) {
                    if (!quiet) {
                        const char* imgName = g_image_get_name ? g_image_get_name(img) : "?";
                        const char* ns = g_class_get_namespace ? g_class_get_namespace(c) : "";
                        Log("Found %s (scan) in image='%s' ns='%s'", className, imgName, ns ? ns : "");
                    }
                    return c;
                }
            }
        }
    }
    return NULL;
}

static Il2CppClass* FindPlayerManager(Il2CppDomain* domain) {
    size_t count = 0;
    g_domain_get_assemblies(domain, &count);
    Log("assemblies: %zu", count);
    return FindClass(domain, "PlayerManager");
}

// ---------------------------------------------------------------------------
// Inspect NetworkMgr — log connection state + send-queue depth
// ---------------------------------------------------------------------------
static int32_t ReadListCount(Il2CppObject* list) {
    if (!list) return -1;
    Il2CppClass* lc = g_object_get_class ? g_object_get_class(list) : NULL;
    if (!lc) return -1;
    const Il2CppMethod* getCount = g_class_get_method_from_name(lc, "get_Count", 0);
    if (!getCount) return -1;
    Il2CppObject* r = SafeInvoke(getCount, list, NULL);
    return r ? UNBOX_INT32(r) : -1;
}

static void InspectNetworkMgr(Il2CppDomain* domain, const char* label) {
    Il2CppClass* nmClass = FindClass(domain, "NetworkMgr", /*quiet=*/true);
    if (!nmClass) { Log("NetworkMgr [%s]: class not found", label); return; }

    Il2CppObject* nmInst = GetSingleton(nmClass);
    if (!nmInst) { Log("NetworkMgr [%s]: singleton null", label); return; }

    Log("NetworkMgr [%s]  inst=%p", label, nmInst);

    // Log all fields — focus on bool/int scalars and List<>/Queue<> objects
    if (g_class_get_fields && g_field_get_name) {
        void* fiter = NULL;
        Il2CppFieldInfo* f;
        while ((f = g_class_get_fields(nmClass, &fiter)) != NULL) {
            const char* fname = g_field_get_name(f);
            int32_t foff = FIELDINFO_OBJECT_OFFSET(f);
            if (foff < 0 || foff > 4096) continue;

            // Read 8 bytes at the field offset
            uint64_t raw = 0;
            memcpy(&raw, (char*)nmInst + foff, 8);

            // For pointer-sized fields pointing to objects, try to get the class name
            Il2CppObject* maybeObj = (Il2CppObject*)(uintptr_t)raw;
            const char* objClass = NULL;
            if (raw > 0x10000 && g_object_get_class) {
                Il2CppClass* oc = g_object_get_class(maybeObj);
                if (oc && g_class_get_name) objClass = g_class_get_name(oc);
            }

            if (objClass && (strstr(objClass, "List") || strstr(objClass, "Queue") || strstr(objClass, "Dict"))) {
                int32_t cnt = ReadListCount(maybeObj);
                Log("  %-30s  @%d  [%s count=%d]", fname ? fname : "?", foff, objClass, cnt);
            } else {
                Log("  %-30s  @%d  = %lld", fname ? fname : "?", foff, (long long)(int64_t)raw);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Log all methods on a class
// ---------------------------------------------------------------------------
static void LogMethods(Il2CppClass* klass) {
    void* iter = NULL;
    const Il2CppMethod* m;
    while ((m = g_class_get_methods(klass, &iter)) != NULL) {
        const char* name    = g_method_get_name ? g_method_get_name(m) : "?";
        uint32_t    nparams = g_method_get_param_count ? g_method_get_param_count(m) : 0;
        bool        isStatic= g_method_is_static ? g_method_is_static(m) : false;
        Log("  [%s] %s  params=%u", isStatic ? "static" : "inst ", name, nparams);
    }
}

// ---------------------------------------------------------------------------
// Log all fields on a class
// ---------------------------------------------------------------------------
static void LogFields(Il2CppClass* klass) {
    if (!g_class_get_fields || !g_field_get_name) return;
    void* iter = NULL;
    Il2CppFieldInfo* f;
    while ((f = g_class_get_fields(klass, &iter)) != NULL) {
        const char* name   = g_field_get_name(f);
        int32_t     offset = FIELDINFO_OBJECT_OFFSET(f);
        Log("  field '%s'  object_offset=%d", name ? name : "?", offset);
    }
}

// ---------------------------------------------------------------------------
// Get PlayerManager singleton
// ---------------------------------------------------------------------------
static Il2CppObject* GetSingleton(Il2CppClass* klass) {
    // Try static field "Instance"
    if (g_class_get_field_from_name && g_field_static_get_value) {
        Il2CppFieldInfo* f = g_class_get_field_from_name(klass, "Instance");
        if (f) {
            Il2CppObject* inst = NULL;
            g_field_static_get_value(f, &inst);
            Log("Instance field -> %p", inst);
            if (inst) return inst;
        }
    }
    // Try get_Instance property getter
    if (g_class_get_method_from_name) {
        const Il2CppMethod* getter = g_class_get_method_from_name(klass, "get_Instance", 0);
        if (getter) {
            Il2CppObject* inst = SafeInvoke(getter, NULL, NULL);
            Log("get_Instance -> %p", inst);
            if (inst) return inst;
        }
    }
    return NULL;
}

// ---------------------------------------------------------------------------
// Wait for Task completion (spin on get_IsCompleted or call Wait(int))
// ---------------------------------------------------------------------------
static bool WaitTask(Il2CppObject* task, int timeoutMs) {
    if (!task || !g_object_get_class || !g_class_get_method_from_name || !g_runtime_invoke)
        return false;

    Il2CppClass* tc = g_object_get_class(task);
    if (!tc) return false;
    Log("Task class: %s", g_class_get_name ? g_class_get_name(tc) : "?");

    // Prefer Wait(int) — blocks but doesn't spin
    const Il2CppMethod* waitFn = g_class_get_method_from_name(tc, "Wait", 1);
    if (waitFn) {
        Log("Calling Task.Wait(%d)...", timeoutMs);
        int32_t ms = (int32_t)timeoutMs;
        void* args[1] = { &ms };
        Il2CppObject* r = SafeInvoke(waitFn, task, args);
        Log("Wait returned %p", r);
        // r is boxed bool: true = completed within timeout
        if (r) { bool ok = UNBOX_BOOL(r); Log("Wait result (bool) = %d", ok); return ok; }
        return false;
    }

    // Fallback: spin on get_IsCompleted
    const Il2CppMethod* getCompleted = g_class_get_method_from_name(tc, "get_IsCompleted", 0);
    if (!getCompleted) { Log("Neither Wait nor get_IsCompleted found"); return false; }

    DWORD start = GetTickCount();
    for (int i = 0; ; i++) {
        Il2CppObject* r = SafeInvoke(getCompleted, task, NULL);
        if (r) {
            bool done = UNBOX_BOOL(r);
            if (done) {
                Log("IsCompleted=true after %u ms (%d polls)", GetTickCount()-start, i);
                return true;
            }
        }
        if ((int)(GetTickCount()-start) >= timeoutMs) break;
        if (i % 20 == 0) Log("  ... waiting %u ms", GetTickCount()-start);
        Sleep(50);
    }
    Log("Timed out after %d ms", timeoutMs);
    return false;
}

// ---------------------------------------------------------------------------
// Wait for Task<T> and return Task.Result, or NULL on timeout/error
// ---------------------------------------------------------------------------
static Il2CppObject* AwaitTask(Il2CppObject* task, int timeoutMs) {
    if (!task || !g_object_get_class || !g_class_get_method_from_name) return NULL;
    Il2CppClass* tc = g_object_get_class(task);
    if (!tc) return NULL;
    const Il2CppMethod* getCompleted = g_class_get_method_from_name(tc, "get_IsCompleted", 0);
    const Il2CppMethod* getResult    = g_class_get_method_from_name(tc, "get_Result",      0);
    if (!getCompleted || !getResult) return NULL;

    DWORD start = GetTickCount();
    while ((int)(GetTickCount() - start) < timeoutMs) {
        Il2CppObject* r = SafeInvoke(getCompleted, task, NULL);
        if (r && UNBOX_BOOL(r))
            return SafeInvoke(getResult, task, NULL);
        Sleep(100);
    }
    Log("# AwaitTask timeout after %d ms", timeoutMs);
    return NULL;
}

// ---------------------------------------------------------------------------
// Write one ExchangeItemTradeInfo list as TSV rows: cid\tprice\tcount
// Returns the source list count for compatibility with existing caller logs.
// ---------------------------------------------------------------------------
static int WriteTradeList(int32_t cid, Il2CppObject* list, int32_t* minPriceOut) {
    if (!list || !g_object_get_class || !g_class_get_method_from_name) return 0;
    Il2CppClass* lc = g_object_get_class(list);
    if (!lc) return 0;
    const Il2CppMethod* getCount = g_class_get_method_from_name(lc, "get_Count", 0);
    const Il2CppMethod* getItem  = g_class_get_method_from_name(lc, "get_Item",  1);
    if (!getCount || !getItem) return 0;
    Il2CppObject* cntObj = SafeInvoke(getCount, list, NULL);
    if (!cntObj) return 0;
    int32_t count = UNBOX_INT32(cntObj);
    int32_t minPrice = 0;
    int32_t* prices = NULL;
    int32_t* counts = NULL;
    if (count > 0) {
        prices = (int32_t*)malloc(sizeof(int32_t) * (size_t)count);
        counts = (int32_t*)malloc(sizeof(int32_t) * (size_t)count);
    }
    bool canWriteLadder = prices && counts;
    if (!canWriteLadder) {
        Log("WARN: unable to allocate ladder jsonl buffers for cid=%d count=%d", cid, count);
    }
    int32_t writtenTiers = 0;
    for (int32_t i = 0; i < count; i++) {
        void* args[1] = { &i };
        Il2CppObject* entry = SafeInvoke(getItem, list, args);
        if (!entry) continue;
        // ExchangeItemTradeInfo: price_ @24 (int32), peopleCount_ @28 (int32)
        int32_t price       = *(int32_t*)((char*)entry + 24);
        int32_t peopleCount = *(int32_t*)((char*)entry + 28);
        if (price <= 0 || peopleCount <= 0) continue;
        if (minPrice == 0 || price < minPrice) minPrice = price;
        Log("%d\t%d\t%d", cid, price, peopleCount);
        if (canWriteLadder) {
            prices[writtenTiers] = price;
            counts[writtenTiers] = peopleCount;
            writtenTiers++;
        }
    }
    if (minPriceOut) *minPriceOut = minPrice;
    if (canWriteLadder && writtenTiers > 0) {
        char observedAt[64] = {};
        FormatUtcIso(observedAt, sizeof(observedAt));
        if (!AppendLadderJsonlRecord(cid, observedAt, prices, counts, writtenTiers)) {
            Log("WARN: failed to append ladder jsonl for cid=%d", cid);
        }
    }
    if (prices) free(prices);
    if (counts) free(counts);
    return count;
}

// ---------------------------------------------------------------------------
// Worker thread
// ---------------------------------------------------------------------------
static DWORD WINAPI Worker(LPVOID) {
    void* thread = NULL; // declared early so goto can skip past later decls

    Sleep(3000); // wait for game + hot assemblies to finish loading

    g_log = fopen("C:\\Tools\\BidKing\\tmp\\bk-trade-info.txt", "w");
    if (!g_log) goto done;

    {
        SYSTEMTIME st; GetLocalTime(&st);
        Log("# BKPayload64  %04d-%02d-%02d %02d:%02d:%02d",
            st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);
    }

    {
        HMODULE hGame = GetModuleHandleA("GameAssembly.dll");
        Log("GameAssembly.dll: %p", hGame);
        if (!hGame) { Log("ERROR: GameAssembly.dll not loaded"); goto done; }

        if (!ResolveFunctions(hGame)) {
            Log("ERROR: essential il2cpp functions missing");
            goto done;
        }
    }

    // Attach this thread to the il2cpp GC — MUST happen before any il2cpp call.
    {
        Il2CppDomain* domain = g_domain_get();
        Log("domain: %p", domain);
        if (g_thread_attach && domain) {
            thread = g_thread_attach(domain);
            Log("thread_attach: %p", thread);
        } else {
            Log("WARNING: thread_attach not available or domain null");
        }

        // ---- Find PlayerManager ----
        Il2CppClass* pmClass = FindPlayerManager(domain);
        if (!pmClass) { Log("# ERROR: PlayerManager not found"); goto done; }

        Il2CppObject* pmInst = GetSingleton(pmClass);
        if (!pmInst) { Log("# ERROR: PlayerManager singleton null"); goto done; }

        // ---- Step 1: GetAllCollectionItems ----
        {
            const Il2CppMethod* getAllColl = g_class_get_method_from_name(pmClass, "GetAllCollectionItems", 0);
            if (!getAllColl) { Log("# ERROR: GetAllCollectionItems not found"); goto done; }

            Il2CppObject* collTask = SafeInvoke(getAllColl, pmInst, NULL);
            if (!collTask) { Log("# ERROR: GetAllCollectionItems returned null"); goto done; }

            Il2CppObject* collList = AwaitTask(collTask, 15000);
            if (!collList) { Log("# ERROR: GetAllCollectionItems timed out"); goto done; }

            Il2CppClass* lc = g_object_get_class(collList);
            const Il2CppMethod* getCount = lc ? g_class_get_method_from_name(lc, "get_Count", 0) : NULL;
            const Il2CppMethod* getItem  = lc ? g_class_get_method_from_name(lc, "get_Item",  1) : NULL;
            if (!getCount || !getItem) { Log("# ERROR: List methods missing"); goto done; }

            Il2CppObject* cntObj = SafeInvoke(getCount, collList, NULL);
            int32_t total = cntObj ? UNBOX_INT32(cntObj) : 0;
            Log("# collection items total: %d", total);
            if (total == 0) { Log("# no items in collection"); goto done; }

            // Collect unique item CIDs.
            // GetAllCollectionItems returns List<int> — each element is a boxed Int32,
            // so the CID is read directly with UNBOX_INT32 (value at offset 16).
            int32_t uniqueIds[2000];
            int uniqueCount = 0;
            for (int32_t i = 0; i < total && uniqueCount < 2000; i++) {
                void* ai[1] = { &i };
                Il2CppObject* item = SafeInvoke(getItem, collList, ai);
                if (!item) continue;
                int32_t cid = UNBOX_INT32(item);
                bool dup = false;
                for (int j = 0; j < uniqueCount; j++) if (uniqueIds[j] == cid) { dup = true; break; }
                if (!dup) uniqueIds[uniqueCount++] = cid;
            }
            Log("# unique item CIDs: %d", uniqueCount);

            // ---- Write CIDs to Documents\BKPriceHistory\Cids.json ----
            {
                char docPath[MAX_PATH] = {};
                if (SHGetFolderPathA(NULL, CSIDL_PERSONAL, NULL, 0, docPath) == S_OK) {
                    char dirPath[MAX_PATH], jsonPath[MAX_PATH];
                    snprintf(dirPath,  sizeof(dirPath),  "%s\\BKPriceHistory", docPath);
                    snprintf(jsonPath, sizeof(jsonPath), "%s\\Cids.json",       dirPath);
                    CreateDirectoryA(dirPath, NULL); // no-op if already exists
                    FILE* cj = fopen(jsonPath, "w");
                    if (cj) {
                        fputc('[', cj);
                        for (int i = 0; i < uniqueCount; i++) {
                            if (i > 0) fputc(',', cj);
                            fprintf(cj, "%d", uniqueIds[i]);
                        }
                        fputc(']', cj);
                        fclose(cj);
                        Log("# Cids.json written -> %s", jsonPath);
                    } else {
                        Log("# ERROR: cannot write Cids.json");
                    }
                }
            }

            // ---- Step 2: Query trade info for each CID ----
            const Il2CppMethod* getTradeInfo = g_class_get_method_from_name(pmClass, "GetItemTradeInfo", 1);
            if (!getTradeInfo) { Log("# ERROR: GetItemTradeInfo not found"); goto done; }

            // TSV header
            Log("item_cid\tprice\tcount");

            srand((unsigned int)GetTickCount());

            for (int i = 0; i < uniqueCount; i++) {
                int32_t cid = uniqueIds[i];
                void* ta[1] = { &cid };
                Il2CppObject* tradeTask = SafeInvoke(getTradeInfo, pmInst, ta);
                if (!tradeTask) {
                    Log("# [%d/%d] cid=%d  ERROR: invoke null", i+1, uniqueCount, cid);
                } else {
                    Il2CppObject* tradeList = AwaitTask(tradeTask, 30000);
                    if (!tradeList) {
                        Log("# [%d/%d] cid=%d  timeout", i+1, uniqueCount, cid);
                    } else {
                        int32_t minPrice = 0;
                        char observedAt[64] = {};
                        FormatUtcIso(observedAt, sizeof(observedAt));
                        int rows = WriteTradeList(cid, tradeList, &minPrice);
                        if (rows > 0 && minPrice > 0) {
                            if (AppendPriceCsvRecord(cid, observedAt, minPrice)) {
                                if (!RewriteLatestFromCsv()) {
                                    Log("# [%d/%d] cid=%d  ERROR: rewrite latest.json failed", i+1, uniqueCount, cid);
                                }
                            } else {
                                Log("# [%d/%d] cid=%d  ERROR: write price history failed", i+1, uniqueCount, cid);
                            }
                        }
                        Log("# [%d/%d] cid=%d  rows=%d", i+1, uniqueCount, cid, rows);
                    }
                }

                if (i + 1 < uniqueCount) {
                    int delayMs = 5000 + (rand() % 5001); // 5–10 s
                    Sleep(delayMs);
                }
            }

            {
                SYSTEMTIME st2; GetLocalTime(&st2);
                Log("# done  %02d:%02d:%02d  queried=%d", st2.wHour, st2.wMinute, st2.wSecond, uniqueCount);
            }
        }
    }

done:
    if (thread && g_thread_detach) g_thread_detach(thread);
    if (g_log) { fclose(g_log); g_log = NULL; }
    FreeLibraryAndExitThread(g_hModule, 0);
    return 0; // unreachable
}

// ---------------------------------------------------------------------------
BOOL WINAPI DllMain(HINSTANCE hInst, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hInst);
        g_hModule = hInst;
        HANDLE h = CreateThread(NULL, 0, Worker, NULL, 0, NULL);
        if (h) CloseHandle(h);
    }
    return TRUE;
}
