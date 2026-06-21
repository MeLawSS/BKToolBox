# Language Toggle Capsule — Design Spec

Date: 2026-05-21

## Problem

The current language toggle is a rectangular text button with a visible border and background fill. Placed next to the pill-shaped theme toggle, it looks visually inconsistent and out of place in the topbar.

## Solution

Replace the single-label text button with a **bilingual capsule** that always shows both "中文" and "EN", with the current locale's option highlighted in green. This makes the control self-explanatory and visually cohesive with the rest of the topbar.

## Visual Design

```
┌─────────────────────┐
│ 中文 │ EN           │  ← dark mode, Chinese active
└─────────────────────┘
 ↑ green bg + green text for active option
 ↑ muted text for inactive option
```

Active state: `background: rgba(47,143,131,0.22)` + `color: #4dc4ad` (dark) / `color: #1f8a74` (light)  
Inactive state: muted color, no background  
Capsule border: `rgba(255,255,255,0.10)` dark / `rgba(0,0,0,0.10)` light  
Capsule background: `rgba(255,255,255,0.04)` dark / `rgba(0,0,0,0.04)` light  

Light theme adapts automatically via `[data-theme="light"]` selector.

## Interaction

The capsule is a single `<button>` that calls `toggleLocale()` on click — preserves existing toggle behavior. Active state is derived from `isEnglish` (exposed by `useI18n()`).

Clicking the active option still triggers the toggle (acceptable for a simple two-state control).

## Accessibility

- `aria-label` on the button: `t('common.languageAria')` (existing key, unchanged)
- Active option gets `aria-current="true"` for screen reader context

## Affected Files

### Templates (4 files — same change in each)
- `src/ethan/App.vue`
- `src/ahmed/App.vue`
- `src/elsa/App.vue`
- `src/home/App.vue`

Replace:
```html
<button class="language-toggle" type="button" :aria-label="t('common.languageAria')" @click="toggleLocale">
  {{ t('common.languageToggle') }}
</button>
```

With:
```html
<button class="lang-capsule" type="button" :aria-label="t('common.languageAria')" @click="toggleLocale">
  <span class="lang-capsule-opt" :class="{ active: !isEnglish }" :aria-current="!isEnglish ? 'true' : undefined">中文</span>
  <span class="lang-capsule-opt" :class="{ active: isEnglish }" :aria-current="isEnglish ? 'true' : undefined">EN</span>
</button>
```

Each page's `<script setup>` already imports `useI18n` — add `isEnglish` to the destructure.

### CSS (4 files)
- `public/ethan/ethan.css`
- `public/ahmed/ahmed.css`
- `src/elsa/elsa.css`
- `src/home/home.css`

In each file: remove `.language-toggle`, `.language-toggle:hover`, `.language-toggle:focus-visible` and add:

```css
.lang-capsule {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  padding: 2px;
  cursor: pointer;
  font: inherit;
}

.lang-capsule:focus-visible {
  outline: 2px solid rgba(57, 168, 149, 0.42);
  outline-offset: 3px;
}

.lang-capsule-opt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  border-radius: 999px;
  font-size: 12px;
  padding: 0 9px;
  color: var(--muted);
  transition: 0.16s ease;
  pointer-events: none;
}

.lang-capsule-opt.active {
  background: rgba(47, 143, 131, 0.22);
  color: #4dc4ad;
}

:root[data-theme="light"] .lang-capsule {
  border-color: rgba(0, 0, 0, 0.10);
  background: rgba(0, 0, 0, 0.04);
}

:root[data-theme="light"] .lang-capsule-opt.active {
  background: rgba(47, 143, 131, 0.18);
  color: #1f8a74;
}
```

### messages.js
`common.languageToggle` key becomes unused. Can be removed or left as dead code — removal preferred for cleanliness.

## Out of Scope

- No changes to `useI18n`, `toggleLocale`, or locale storage logic
- No changes to any test files (behavior is unchanged)
