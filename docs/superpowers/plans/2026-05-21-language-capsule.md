# Language Toggle Capsule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rectangular language toggle button in all 4 topbars with a bilingual capsule ("中文 | EN") where the active locale is highlighted green.

**Architecture:** Pure CSS + Vue template change across 4 independent pages (ethan, ahmed, elsa, home). Each page has its own CSS file and Vue component. No shared component extraction needed — the markup is trivial and each page already manages its own topbar. The `useI18n()` composable already exposes `isEnglish` (computed ref), so no logic changes are required.

**Tech Stack:** Vue 3 (Composition API), CSS custom properties, Vitest + Vue Test Utils

---

### Task 1: Update CSS in all 4 style files

Replace `.language-toggle` block (3 rules) with `.lang-capsule` in each CSS file. The new CSS is identical in all files.

**Files:**
- Modify: `public/ethan/ethan.css:113-133`
- Modify: `public/ahmed/ahmed.css:123-143`
- Modify: `src/elsa/elsa.css:105-125`
- Modify: `src/home/home.css:107-127`

- [ ] **Step 1: Replace language-toggle CSS in `public/ethan/ethan.css`**

Remove lines 113–133 (the `.language-toggle`, `.language-toggle:hover`, `.language-toggle:focus-visible` block) and replace with:

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

- [ ] **Step 2: Same replacement in `public/ahmed/ahmed.css`**

Remove lines 123–143 and insert the identical CSS block from Step 1.

- [ ] **Step 3: Same replacement in `src/elsa/elsa.css`**

Remove lines 105–125 and insert the identical CSS block from Step 1.

- [ ] **Step 4: Same replacement in `src/home/home.css`**

Remove lines 107–127 and insert the identical CSS block from Step 1.

- [ ] **Step 5: Commit CSS changes**

```bash
git add public/ethan/ethan.css public/ahmed/ahmed.css src/elsa/elsa.css src/home/home.css
git commit -m "style: replace language-toggle with lang-capsule styles"
```

---

### Task 2: Update tests to use new selector (failing first)

All 4 test files use `.language-toggle` to find the button and trigger click. One test in `home/App.test.js` also asserts text content (needs updated assertion). Update the selectors and assertions now so the tests fail — templates come next.

**Files:**
- Modify: `src/ethan/App.test.js:115`
- Modify: `src/ahmed/App.test.js:74`
- Modify: `src/elsa/App.test.js:294`
- Modify: `src/home/App.test.js:53, 66, 83`

- [ ] **Step 1: Update `src/ethan/App.test.js` line 115**

Change:
```js
await wrapper.find('.language-toggle').trigger('click');
```
To:
```js
await wrapper.find('.lang-capsule').trigger('click');
```

- [ ] **Step 2: Update `src/ahmed/App.test.js` line 74**

Change:
```js
await wrapper.find('.language-toggle').trigger('click');
```
To:
```js
await wrapper.find('.lang-capsule').trigger('click');
```

- [ ] **Step 3: Update `src/elsa/App.test.js` line 294**

Change:
```js
await wrapper.find('.language-toggle').trigger('click');
```
To:
```js
await wrapper.find('.lang-capsule').trigger('click');
```

- [ ] **Step 4: Update `src/home/App.test.js` — three locations**

Line 53: change `.language-toggle` → `.lang-capsule`  
Line 66: the old assertion checked that the button text contained "中文" (i.e., showing the switch-to label). With the capsule design both labels are always visible; instead assert that the active option is "EN" (because we restored EN locale):

Change:
```js
expect(restored.find('.language-toggle').text()).toContain('中文');
```
To:
```js
expect(restored.find('.lang-capsule-opt.active').text()).toBe('EN');
```

Line 83: change `.language-toggle` → `.lang-capsule`

- [ ] **Step 5: Run tests — expect failure**

```bash
npm test
```

Expected: tests fail with `Unable to find .lang-capsule` — this confirms the tests are now exercising the new selector.

---

### Task 3: Update Vue templates to make tests pass

Add `isEnglish` to the `useI18n()` destructure in each file, then replace the `<button class="language-toggle">` with the capsule markup.

**Files:**
- Modify: `src/ethan/App.vue:24` (destructure) and `src/ethan/App.vue:686-694` (template)
- Modify: `src/ahmed/App.vue:6` (destructure) and `src/ahmed/App.vue:148-156` (template)
- Modify: `src/elsa/App.vue:109` (destructure) and `src/elsa/App.vue:571-579` (template)
- Modify: `src/home/App.vue:10` (destructure) and `src/home/App.vue:86-94` (template)

- [ ] **Step 1: Update `src/ethan/App.vue` — destructure**

Line 24, change:
```js
const { t, toggleLocale } = useI18n();
```
To:
```js
const { t, isEnglish, toggleLocale } = useI18n();
```

- [ ] **Step 2: Update `src/ethan/App.vue` — template**

Find the block:
```html
<button
  class="language-toggle"
  type="button"
  :aria-label="t('common.languageAria')"
  @click="toggleLocale"
>
  {{ t('common.languageToggle') }}
</button>
```
Replace with:
```html
<button
  class="lang-capsule"
  type="button"
  :aria-label="t('common.languageAria')"
  @click="toggleLocale"
>
  <span class="lang-capsule-opt" :class="{ active: !isEnglish }" :aria-current="!isEnglish ? 'true' : undefined">中文</span>
  <span class="lang-capsule-opt" :class="{ active: isEnglish }" :aria-current="isEnglish ? 'true' : undefined">EN</span>
</button>
```

- [ ] **Step 3: Update `src/ahmed/App.vue` — same two changes**

Line 6 destructure:
```js
const { t, isEnglish, toggleLocale } = useI18n();
```

Template (find `.language-toggle` block, replace with same capsule markup as Step 2).

- [ ] **Step 4: Update `src/elsa/App.vue` — same two changes**

Line 109 destructure:
```js
const { t, isEnglish, toggleLocale } = useI18n();
```

Template (find `.language-toggle` block, replace with same capsule markup as Step 2).

- [ ] **Step 5: Update `src/home/App.vue` — same two changes**

Line 10 destructure:
```js
const { t, isEnglish, toggleLocale } = useI18n();
```

Template (find `.language-toggle` block, replace with same capsule markup as Step 2).

- [ ] **Step 6: Run tests — expect all pass**

```bash
npm test
```

Expected: all tests pass. If any fail, the error message will show which selector or assertion still references the old class.

- [ ] **Step 7: Commit template changes**

```bash
git add src/ethan/App.vue src/ahmed/App.vue src/elsa/App.vue src/home/App.vue
git add src/ethan/App.test.js src/ahmed/App.test.js src/elsa/App.test.js src/home/App.test.js
git commit -m "feat: replace language toggle with bilingual capsule"
```

---

### Task 4: Remove unused languageToggle messages key

The `common.languageToggle` key in `src/shared/messages.js` is no longer referenced anywhere.

**Files:**
- Modify: `src/shared/messages.js:10` and `src/shared/messages.js:273`

- [ ] **Step 1: Remove from zh-CN locale (line 10)**

Delete the line:
```js
      languageToggle: 'EN',
```

- [ ] **Step 2: Remove from en-US locale (line 273)**

Delete the line:
```js
      languageToggle: '中文',
```

- [ ] **Step 3: Run tests to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/shared/messages.js
git commit -m "chore: remove unused languageToggle message key"
```
