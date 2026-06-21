#pragma once

enum UiClickComponentKind {
    UI_CLICK_COMPONENT_NONE = 0,
    UI_CLICK_COMPONENT_BUTTON = 1,
    UI_CLICK_COMPONENT_TOGGLE = 2,
};

inline UiClickComponentKind ResolveUiClickComponentKind(bool hasButton, bool hasToggle) {
    if (hasButton) return UI_CLICK_COMPONENT_BUTTON;
    if (hasToggle) return UI_CLICK_COMPONENT_TOGGLE;
    return UI_CLICK_COMPONENT_NONE;
}
