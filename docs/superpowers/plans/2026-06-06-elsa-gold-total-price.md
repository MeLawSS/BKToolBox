# Elsa 金色总价格约束 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Elsa panel 的金色组新增“总价格”输入，并把它作为正式约束并入期望价值计算；若同时填写金色平均格数或总格数，则用交集做交叉验证。

**Architecture:** 复用现有共享 `HeroEstimatorPanel`。UI 仅在 Elsa 的金色组多一个字段；估算核心继续以共享 `collectEstimationInputs()` / `runEstimation()` 为主，新增一条 “gold-total candidates” 旁路，把 `solve-gold-total.js` 输出解析成 `{ cells, count, totalPrice }` 候选，再回灌成 `orange` 组的硬约束候选。平均格数/总格数校验通过过滤候选完成，不重写总估算器。

**Tech Stack:** Vue 3 `<script setup>`、共享 `src/hero-estimator/` 组合式逻辑、现有 `/run` EventSource 流式 solver、Vitest + @vue/test-utils + happy-dom。

---

## File Structure

- **Modify** `src/hero-estimator/hero-profiles.js` — 给 Elsa profile 标记金色总价格支持能力，仅 Elsa 开启。
- **Modify** `src/hero-estimator/HeroEstimatorPanelBody.vue` — 在质量输入网格里按 profile 条件渲染金色“总价格”字段。
- **Modify** `src/hero-estimator/useHeroEstimatorPanel.js` — 新增 `totalPrice` 输入/placeholder/持久化；在提交链中把金色总价格转成候选格数并接入现有预测流程。
- **Modify** `src/ethan/estimator.js` — 复用现有 `parseComboOutputLine()`；必要时只补最小纯函数辅助，不改 Ethan 行为。
- **Modify** `src/shared/messages.js` — 增加金色总价格字段和新 meta/status 文案，中英各一份。
- **Modify** `src/elsa/ElsaHeroPanel.test.js` — Elsa 包装层验证新输入已出现且 Ethan 不受影响。
- **Modify** `src/hero-estimator/HeroEstimatorPanel.test.js` — 新增红绿集成测试：总价格单独求解、与平均格数/总格数交叉验证、冲突提示。
- **Modify** `docs/Documentation.md` — 记录 Elsa 金色总价格约束的当前行为。

---

## Task 1: Elsa 金色总价格 UI 与状态接线

**Files:**
- Modify: `src/hero-estimator/hero-profiles.js`
- Modify: `src/hero-estimator/HeroEstimatorPanelBody.vue`
- Modify: `src/shared/messages.js`
- Test: `src/elsa/ElsaHeroPanel.test.js`

- [x] 写失败测试：Elsa 显示 `#elsa-total-price-orange`，Ethan 不显示对应字段。
- [x] 跑 `npx vitest run src/elsa/ElsaHeroPanel.test.js -t "gold total price"` 确认失败。
- [x] 在 Elsa profile 上声明金色总价格字段能力；`HeroEstimatorPanelBody.vue` 仅在该能力开启且组为 `orange` 时渲染该输入。
- [x] 补中英文案：字段名、冲突/搜索/匹配状态文案。
- [x] 重跑同一测试确认通过。

---

## Task 2: 金色总价格候选并入估算链

**Files:**
- Modify: `src/hero-estimator/useHeroEstimatorPanel.js`
- Modify: `src/hero-estimator/HeroEstimatorPanel.test.js`

- [x] 写失败测试：仅填 Elsa 金色总价格时，面板进入候选结果列表而不是按默认单格金价直接估算。
- [x] 写失败测试：若同时填金色平均格数，则结果只保留满足平均格数的候选。
- [x] 写失败测试：若金色总价格与手填金色总格数/平均格数无交集，则显示明确冲突提示。
- [x] 跑 `npx vitest run src/hero-estimator/HeroEstimatorPanel.test.js -t "Elsa gold total price"` 确认失败。
- [x] 在 `useHeroEstimatorPanel.js` 中新增 `totalPrice` 状态、持久化、清空、effective input 读取。
- [x] 新增金色总价格搜索流程：调用现有 `solve-gold-total.js`，用 `parseComboOutputLine()` 解析 `cells/count/totalPrice`。
- [x] 将候选过滤为与 `orange.avg`、`orange.cells` 相容的交集；把保留下来的候选回灌成 `orange` 组硬约束后复用现有 `estimateTotalByStage()` / `buildPredictionRow()` 渲染。
- [x] 对 0 个候选输出冲突/无结果状态；对 1 个或多个候选输出结果表与摘要。
- [x] 重跑同一组测试确认通过。

---

## Task 3: 回归验证与文档

**Files:**
- Modify: `docs/Documentation.md`
- Verify: `src/hero-estimator/HeroEstimatorPanel.test.js`
- Verify: `src/elsa/ElsaHeroPanel.test.js`

- [x] 更新 `docs/Documentation.md`，说明 Elsa 金色总价格会推导金色可能格数并与平均格数/总格数交叉验证。
- [x] 跑 `npx vitest run src/elsa/ElsaHeroPanel.test.js src/hero-estimator/HeroEstimatorPanel.test.js`。
- [x] 跑 `git diff --check`。
- [x] 如改动未破坏页面构建，再跑 `npm run build:pages` 或至少 `npm run build:home` 所依赖的共享构建链；当前优先 `npm run build:pages`。
- [ ] 提交本轮：`git commit -m "Add Elsa gold total price constraint"`。
