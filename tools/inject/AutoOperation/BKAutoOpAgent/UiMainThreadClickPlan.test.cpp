#include "UiMainThreadClickPlan.h"

#include <assert.h>
#include <string.h>

int main() {
    {
        UiMainThreadClickPlan plan = ResolveButtonMainThreadClickPlan(true);
        assert(plan.target == UI_MAIN_THREAD_ACTION_EVENT_OBJECT);
        assert(plan.methodName != nullptr);
        assert(strcmp(plan.methodName, "Invoke") == 0);
        assert(plan.fallbackMethodName == nullptr);
    }

    {
        UiMainThreadClickPlan plan = ResolveButtonMainThreadClickPlan(false);
        assert(plan.target == UI_MAIN_THREAD_ACTION_COMPONENT_OBJECT);
        assert(plan.methodName != nullptr);
        assert(strcmp(plan.methodName, "Press") == 0);
        assert(plan.fallbackMethodName != nullptr);
        assert(strcmp(plan.fallbackMethodName, "OnSubmit") == 0);
    }

    {
        UiMainThreadClickPlan plan = ResolveToggleMainThreadClickPlan();
        assert(plan.target == UI_MAIN_THREAD_ACTION_COMPONENT_OBJECT);
        assert(plan.methodName != nullptr);
        assert(strcmp(plan.methodName, "InternalToggle") == 0);
        assert(plan.fallbackMethodName == nullptr);
    }

    return 0;
}
