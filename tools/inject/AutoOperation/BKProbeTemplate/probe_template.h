#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

// ==========================================================================
// IL2CPP type stubs
// ==========================================================================
typedef void Il2CppDomain;
typedef void Il2CppAssembly;
typedef void Il2CppImage;
typedef void Il2CppClass;
typedef void Il2CppMethod;
typedef void Il2CppObject;
typedef void Il2CppFieldInfo;

typedef Il2CppDomain*          (*fn_domain_get)();
typedef const Il2CppAssembly** (*fn_domain_get_assemblies)(const Il2CppDomain*, size_t*);
typedef Il2CppImage*           (*fn_assembly_get_image)(const Il2CppAssembly*);
typedef Il2CppClass*           (*fn_class_from_name)(Il2CppImage*, const char*, const char*);
typedef Il2CppObject*          (*fn_runtime_invoke)(const Il2CppMethod*, void*, void**, Il2CppObject**);
typedef const Il2CppMethod*    (*fn_class_get_method_from_name)(Il2CppClass*, const char*, int);
typedef void*                  (*fn_thread_attach)(Il2CppDomain*);
typedef Il2CppObject*          (*fn_string_new)(const char*);
typedef Il2CppFieldInfo*       (*fn_class_get_field_from_name)(Il2CppClass*, const char*);
typedef void                   (*fn_field_static_get_value)(Il2CppFieldInfo*, void*);

struct BkIl2Cpp {
    fn_domain_get                domain_get;
    fn_domain_get_assemblies     domain_get_assemblies;
    fn_assembly_get_image        assembly_get_image;
    fn_class_from_name           class_from_name;
    fn_runtime_invoke            runtime_invoke;
    fn_class_get_method_from_name class_get_method_from_name;
    fn_thread_attach             thread_attach;
    fn_string_new                string_new;
    fn_class_get_field_from_name class_get_field_from_name;
    fn_field_static_get_value    field_static_get_value;
    Il2CppDomain*                domain;
};

// ==========================================================================
// Result output — writes into the resultBuf provided by LoadProbe
// ==========================================================================
static char*  g_probe_result_buf  = nullptr;
static int    g_probe_result_size = 0;

#define PROBE_RESULT(fmt, ...) \
    do { if (g_probe_result_buf) snprintf(g_probe_result_buf, g_probe_result_size, fmt, ##__VA_ARGS__); } while(0)

// ==========================================================================
// Resolve IL2CPP function pointers from GameAssembly.dll
// ==========================================================================
static bool BKProbeResolveIl2cpp(BkIl2Cpp* il) {
    HMODULE h = GetModuleHandleA("GameAssembly.dll");
    if (!h) return false;

#define RES(field, sym) \
    il->field = (decltype(il->field))GetProcAddress(h, "il2cpp_" #sym); \
    if (!il->field) return false;

    RES(domain_get,              domain_get)
    RES(domain_get_assemblies,   domain_get_assemblies)
    RES(assembly_get_image,      assembly_get_image)
    RES(class_from_name,         class_from_name)
    RES(runtime_invoke,          runtime_invoke)
    RES(class_get_method_from_name, class_get_method_from_name)
    RES(thread_attach,           thread_attach)
    RES(string_new,              string_new)
    RES(class_get_field_from_name,  class_get_field_from_name)
    RES(field_static_get_value,  field_static_get_value)
#undef RES

    il->domain = il->domain_get();
    if (!il->domain) return false;
    il->thread_attach(il->domain);
    return true;
}

// ==========================================================================
// Entry point every probe DLL must export
// ==========================================================================
// extern "C" __declspec(dllexport)
// void BKProbeEntry(const char* argsJson, char* resultBuf, int resultSize);
//
// On entry: set g_probe_result_buf/g_probe_result_size then call PROBE_RESULT.
// Standard pattern:
//
//   extern "C" __declspec(dllexport)
//   void BKProbeEntry(const char* argsJson, char* resultBuf, int resultSize) {
//       g_probe_result_buf  = resultBuf;
//       g_probe_result_size = resultSize;
//       BkIl2Cpp il = {};
//       if (!BKProbeResolveIl2cpp(&il)) { PROBE_RESULT("il2cpp not ready"); return; }
//       // ... do work ...
//       PROBE_RESULT("{\"ok\":true}");
//   }
