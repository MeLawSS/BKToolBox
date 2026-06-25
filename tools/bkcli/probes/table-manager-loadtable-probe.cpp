#include "probe_template.h"
#include <sstream>
#include <string>
#include <vector>
#include <cstring>

typedef void Il2CppType;
typedef void Il2CppException;
typedef void Il2CppArray;

typedef const char*        (*fn_class_get_name)(Il2CppClass*);
typedef const char*        (*fn_class_get_namespace)(Il2CppClass*);
typedef Il2CppClass*       (*fn_object_get_class)(Il2CppObject*);
typedef const Il2CppType*  (*fn_method_get_return_type)(const Il2CppMethod*);
typedef const Il2CppType*  (*fn_method_get_param)(const Il2CppMethod*, uint32_t);
typedef uint32_t           (*fn_method_get_param_count)(const Il2CppMethod*);
typedef const char*        (*fn_method_get_name)(const Il2CppMethod*);
typedef char*              (*fn_type_get_name)(const Il2CppType*);
typedef const char*        (*fn_field_get_name)(Il2CppFieldInfo*);
typedef const Il2CppType*  (*fn_field_get_type)(Il2CppFieldInfo*);
typedef Il2CppFieldInfo*   (*fn_class_get_fields)(Il2CppClass*, void**);
typedef size_t             (*fn_image_get_class_count)(const Il2CppImage*);
typedef Il2CppClass*       (*fn_image_get_class)(const Il2CppImage*, size_t);
typedef const char*        (*fn_image_get_name)(const Il2CppImage*);

struct ProbeApi {
    BkIl2Cpp il = {};
    fn_class_get_name class_get_name = nullptr;
    fn_class_get_namespace class_get_namespace = nullptr;
    fn_object_get_class object_get_class = nullptr;
    fn_method_get_return_type method_get_return_type = nullptr;
    fn_method_get_param method_get_param = nullptr;
    fn_method_get_param_count method_get_param_count = nullptr;
    fn_method_get_name method_get_name = nullptr;
    fn_type_get_name type_get_name = nullptr;
    fn_field_get_name field_get_name = nullptr;
    fn_field_get_type field_get_type = nullptr;
    fn_class_get_fields class_get_fields = nullptr;
    fn_image_get_class_count image_get_class_count = nullptr;
    fn_image_get_class image_get_class = nullptr;
    fn_image_get_name image_get_name = nullptr;
};

struct Il2CppString {
    void* klass;
    void* monitor;
    int32_t length;
    uint16_t chars[1];
};

static std::string Utf8FromUtf16(const uint16_t* chars, int32_t length) {
    std::string out;
    if (!chars || length <= 0) {
        return out;
    }
    out.reserve(static_cast<size_t>(length));
    for (int32_t i = 0; i < length; i++) {
        uint32_t ch = chars[i];
        if (ch <= 0x7F) {
            out.push_back(static_cast<char>(ch));
        } else if (ch <= 0x7FF) {
            out.push_back(static_cast<char>(0xC0 | (ch >> 6)));
            out.push_back(static_cast<char>(0x80 | (ch & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xE0 | (ch >> 12)));
            out.push_back(static_cast<char>(0x80 | ((ch >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (ch & 0x3F)));
        }
    }
    return out;
}

static std::string EscapeJson(const std::string& input) {
    std::string out;
    out.reserve(input.size() + 16);
    for (size_t i = 0; i < input.size(); i++) {
        const unsigned char ch = static_cast<unsigned char>(input[i]);
        switch (ch) {
            case '\\': out += "\\\\"; break;
            case '"': out += "\\\""; break;
            case '\r': out += "\\r"; break;
            case '\n': out += "\\n"; break;
            case '\t': out += "\\t"; break;
            default:
                if (ch < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned int>(ch));
                    out += buf;
                } else {
                    out.push_back(static_cast<char>(ch));
                }
                break;
        }
    }
    return out;
}

static bool ResolveProbeApi(ProbeApi* api) {
    if (!BKProbeResolveIl2cpp(&api->il)) {
        return false;
    }
    HMODULE h = GetModuleHandleA("GameAssembly.dll");
    if (!h) {
        return false;
    }
#define RESOLVE(name) \
    api->name = reinterpret_cast<fn_##name>(GetProcAddress(h, "il2cpp_" #name)); \
    if (!api->name) return false;
    RESOLVE(class_get_name)
    RESOLVE(class_get_namespace)
    RESOLVE(object_get_class)
    RESOLVE(method_get_return_type)
    RESOLVE(method_get_param)
    RESOLVE(method_get_param_count)
    RESOLVE(method_get_name)
    RESOLVE(type_get_name)
    RESOLVE(field_get_name)
    RESOLVE(field_get_type)
    RESOLVE(class_get_fields)
    RESOLVE(image_get_class_count)
    RESOLVE(image_get_class)
    RESOLVE(image_get_name)
#undef RESOLVE
    return true;
}

static Il2CppClass* FindClassByName(ProbeApi* api, const char* className, std::string* imageNameOut) {
    size_t assemblyCount = 0;
    const Il2CppAssembly** assemblies = api->il.domain_get_assemblies(api->il.domain, &assemblyCount);
    if (!assemblies) {
        return nullptr;
    }
    for (size_t i = 0; i < assemblyCount; i++) {
        Il2CppImage* image = api->il.assembly_get_image(assemblies[i]);
        if (!image) {
            continue;
        }
        const size_t classCount = api->image_get_class_count(image);
        for (size_t j = 0; j < classCount; j++) {
            Il2CppClass* klass = api->image_get_class(image, j);
            if (!klass) {
                continue;
            }
            const char* name = api->class_get_name(klass);
            if (name && strcmp(name, className) == 0) {
                if (imageNameOut) {
                    const char* imageName = api->image_get_name(image);
                    *imageNameOut = imageName ? imageName : "";
                }
                return klass;
            }
        }
    }
    return nullptr;
}

static std::string TypeName(ProbeApi* api, const Il2CppType* type) {
    if (!type) {
        return "";
    }
    char* raw = api->type_get_name(type);
    if (!raw) {
        return "";
    }
    std::string name(raw);
    // il2cpp_type_get_name currently returns memory the runtime owns.
    return name;
}

static std::string ClassFullName(ProbeApi* api, Il2CppClass* klass) {
    if (!klass) {
        return "";
    }
    const char* ns = api->class_get_namespace(klass);
    const char* name = api->class_get_name(klass);
    if (ns && ns[0]) {
        std::string full(ns);
        full += ".";
        full += name ? name : "";
        return full;
    }
    return name ? std::string(name) : "";
}

static std::string DescribeFields(ProbeApi* api, Il2CppClass* klass, size_t maxFields) {
    std::ostringstream out;
    out << "[";
    void* iter = nullptr;
    size_t count = 0;
    while (count < maxFields) {
        Il2CppFieldInfo* field = api->class_get_fields(klass, &iter);
        if (!field) {
            break;
        }
        if (count > 0) {
            out << ",";
        }
        out << "{\"name\":\"" << EscapeJson(api->field_get_name(field) ? api->field_get_name(field) : "")
            << "\",\"type\":\"" << EscapeJson(TypeName(api, api->field_get_type(field))) << "\"}";
        count++;
    }
    out << "]";
    return out.str();
}

static std::string DescribeMethod(ProbeApi* api, const Il2CppMethod* method) {
    std::ostringstream out;
    out << "{\"name\":\"" << EscapeJson(api->method_get_name(method) ? api->method_get_name(method) : "") << "\"";
    out << ",\"returnType\":\"" << EscapeJson(TypeName(api, api->method_get_return_type(method))) << "\"";
    out << ",\"params\":[";
    const uint32_t paramCount = api->method_get_param_count(method);
    for (uint32_t i = 0; i < paramCount; i++) {
        if (i > 0) {
            out << ",";
        }
        out << "\"" << EscapeJson(TypeName(api, api->method_get_param(method, i))) << "\"";
    }
    out << "]}";
    return out.str();
}

extern "C" __declspec(dllexport)
void BKProbeEntry(const char* argsJson, char* resultBuf, int resultSize) {
    g_probe_result_buf = resultBuf;
    g_probe_result_size = resultSize;
    ProbeApi api = {};
    if (!ResolveProbeApi(&api)) {
        PROBE_RESULT("{\"ok\":false,\"error\":\"resolve api failed\"}");
        return;
    }

    std::string imageName;
    Il2CppClass* tableManagerClass = FindClassByName(&api, "TableManager", &imageName);
    if (!tableManagerClass) {
        PROBE_RESULT("{\"ok\":false,\"error\":\"TableManager not found\"}");
        return;
    }

    const Il2CppMethod* getInstance = api.il.class_get_method_from_name(tableManagerClass, "get_Instance", 0);
    const Il2CppMethod* loadTable = api.il.class_get_method_from_name(tableManagerClass, "LoadTable", 1);
    if (!getInstance || !loadTable) {
        PROBE_RESULT("{\"ok\":false,\"error\":\"TableManager methods missing\"}");
        return;
    }

    Il2CppException* exception = nullptr;
    Il2CppObject* manager = api.il.runtime_invoke(getInstance, nullptr, nullptr, reinterpret_cast<Il2CppObject**>(&exception));
    if (exception || !manager) {
        PROBE_RESULT("{\"ok\":false,\"error\":\"get_Instance failed\"}");
        return;
    }

    const char* names[] = {
        "Item",
        "Item.txt",
        "Assets/Game/Bundle/Tables/Item.txt",
        "Item_Type",
        "Item_Type.txt",
        "Assets/Game/Bundle/Tables/Item_Type.txt"
    };

    std::ostringstream out;
    out << "{";
    out << "\"ok\":true";
    out << ",\"tableManagerImage\":\"" << EscapeJson(imageName) << "\"";
    out << ",\"tableManagerClass\":\"" << EscapeJson(ClassFullName(&api, tableManagerClass)) << "\"";
    out << ",\"getInstance\":" << DescribeMethod(&api, getInstance);
    out << ",\"loadTable\":" << DescribeMethod(&api, loadTable);
    out << ",\"tableManagerFields\":" << DescribeFields(&api, tableManagerClass, 32);
    out << ",\"loads\":[";

    for (size_t i = 0; i < sizeof(names) / sizeof(names[0]); i++) {
        if (i > 0) {
            out << ",";
        }
        Il2CppObject* argString = api.il.string_new(names[i]);
        void* args[1] = { argString };
        exception = nullptr;
        Il2CppObject* value = api.il.runtime_invoke(loadTable, manager, args, reinterpret_cast<Il2CppObject**>(&exception));
        out << "{";
        out << "\"name\":\"" << EscapeJson(names[i]) << "\"";
        out << ",\"success\":" << ((exception == nullptr && value != nullptr) ? "true" : "false");
        if (value) {
            Il2CppClass* valueClass = api.object_get_class(value);
            out << ",\"class\":\"" << EscapeJson(ClassFullName(&api, valueClass)) << "\"";
            out << ",\"fields\":" << DescribeFields(&api, valueClass, 32);
            if (strcmp(api.class_get_name(valueClass), "String") == 0) {
                Il2CppString* str = reinterpret_cast<Il2CppString*>(value);
                out << ",\"string\":\"" << EscapeJson(Utf8FromUtf16(str->chars, str->length)) << "\"";
            }
        }
        out << "}";
    }

    out << "]";
    out << ",\"argsEcho\":\"" << EscapeJson(argsJson ? argsJson : "") << "\"";
    out << "}";
    PROBE_RESULT("%s", out.str().c_str());
}
