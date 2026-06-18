#pragma once

enum UiMainThreadActionTarget {
    UI_MAIN_THREAD_ACTION_NONE = 0,
    UI_MAIN_THREAD_ACTION_EVENT_OBJECT = 1,
    UI_MAIN_THREAD_ACTION_COMPONENT_OBJECT = 2,
};

struct UiMainThreadClickPlan {
    UiMainThreadActionTarget target;
    const char* methodName;
    const char* fallbackMethodName;

    UiMainThreadClickPlan(
        UiMainThreadActionTarget nextTarget = UI_MAIN_THREAD_ACTION_NONE,
        const char* nextMethodName = nullptr,
        const char* nextFallbackMethodName = nullptr
    )
        : target(nextTarget)
        , methodName(nextMethodName)
        , fallbackMethodName(nextFallbackMethodName) {}
};

inline UiMainThreadClickPlan ResolveButtonMainThreadClickPlan(bool hasOnClickEvent) {
    if (hasOnClickEvent) {
        return { UI_MAIN_THREAD_ACTION_EVENT_OBJECT, "Invoke", nullptr };
    }
    return { UI_MAIN_THREAD_ACTION_COMPONENT_OBJECT, "Press", "OnSubmit" };
}

inline UiMainThreadClickPlan ResolveToggleMainThreadClickPlan() {
    return { UI_MAIN_THREAD_ACTION_COMPONENT_OBJECT, "InternalToggle", nullptr };
}
