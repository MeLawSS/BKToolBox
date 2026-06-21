# Bilingual UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Chinese and English UI language switching across Home, Tools, Ahmed, and Ethan while keeping collectible data and solver arguments in Chinese.

**Architecture:** Add a small shared Vue i18n module with persisted locale state and a common language toggle. Page configs keep stable internal values for solver/data behavior and expose translated labels through `t()`.

**Tech Stack:** Vue 3, Vite, Vitest, localStorage.

---

### Task 1: Shared Language Layer

**Files:**
- Create: `src/shared/i18n.js`
- Create: `src/shared/messages.js`
- Test: `src/home/App.test.js`

- [ ] Write a failing Home test that switches to English and reloads persisted locale.
- [ ] Implement shared locale state, `t()`, and `LanguageToggle`.
- [ ] Verify `npx vitest run src/home/App.test.js`.

### Task 2: Tools UI Translation

**Files:**
- Modify: `src/elsa/App.vue`
- Modify: `src/elsa/App.test.js`

- [ ] Write failing Tools tests for English tab labels, status text, table columns, and Chinese category solver args.
- [ ] Replace visible Tools UI strings with i18n keys while preserving solver values.
- [ ] Verify `npx vitest run src/elsa/App.test.js`.

### Task 3: Ahmed and Ethan UI Translation

**Files:**
- Modify: `src/ahmed/App.vue`
- Modify: `src/ahmed/App.test.js`
- Modify: `src/ethan/App.vue`
- Modify: `src/ethan/App.test.js`

- [ ] Write failing render tests for English headings/table headers on Ahmed and Ethan.
- [ ] Replace visible page strings with i18n keys where they are Vue-rendered.
- [ ] Keep estimator error messages and collectible names unchanged.
- [ ] Verify `npx vitest run src/ahmed/App.test.js src/ethan/App.test.js`.

### Task 4: Docs, Build, Commit

**Files:**
- Modify: `docs/Documentation.md`
- Build output: `public/**`

- [ ] Document bilingual UI scope.
- [ ] Run `npm test`.
- [ ] Run `npm run build:pages`.
- [ ] Run `git diff --check`.
- [ ] Commit the round.
