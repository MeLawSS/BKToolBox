# 应用预设合并模式 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将批量移仓面板的"应用预设"从替换选中改为合并选中。

**Architecture:** `applySavedList()` 一行改动：`=` → `Set` 并集。两条测试覆盖合并模式和无匹配回归。

**Tech Stack:** Vue 3 (Composition API), Vitest + @vue/test-utils

## Global Constraints

- 不改变 UI、i18n、按钮布局
- 精确加载预设的工作流：清空 → 应用
- `applySavedList` 匹配全量 `sourceGroups`（非仅可见）
- 无匹配时已有选中保持不变

---

### Task 1: 实现 + 测试

**Files:**
- Modify: `src/inject/StockMovePanel.vue` (line 387)
- Modify: `src/inject/StockMovePanel.test.js`

**Interfaces:**
- Consumes: `applySavedList()` (existing), `getSavedListItemCids()` (existing)
- Produces: `selectedItemCids` now = union of previous + saved list CIDs

- [ ] **Step 1: 写测试（预期失败 — merge behavior 尚未实现）**

在 `StockMovePanel.test.js` 的最后一个 `});`（describe 闭合）之前，插入两条测试：

```js
  it('applying a saved list merges into the current selection instead of replacing it', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') return { ok: true, value: snapshot };
      throw new Error(`unexpected command: ${command}`);
    });
    const listStockMoveLists = vi.fn(async () => ({
      ok: true,
      value: [
        {
          id: 'saved-1',
          name: 'Boots 列表',
          savedAt: '2026-06-05T03:04:05.000Z',
          itemCids: [1032006],
          items: [],
        },
      ],
    }));
    setupDesktop(runAutoOperationCommand, { listStockMoveLists, saveStockMoveList: vi.fn() });

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    // Manually check 1011001 (Data Cable) and 1083009 (Intake Manifold).
    await wrapper.find('[data-testid="stock-move-item-group-1011001"]').setValue(true);
    await wrapper.find('[data-testid="stock-move-item-group-1083009"]').setValue(true);
    await nextTick();
    expect(getCheckedCids(wrapper).sort((a, b) => a - b)).toEqual([1011001, 1083009].sort((a, b) => a - b));

    // Apply saved list containing 1032006 (Boots).
    await wrapper.find('[data-testid="stock-move-apply-list-saved-1"]').trigger('click');
    await nextTick();

    // Should now have all three: original 1011001 + 1083009, plus 1032006 from list.
    expect(getCheckedCids(wrapper).sort((a, b) => a - b)).toEqual([1011001, 1032006, 1083009].sort((a, b) => a - b));
  });

  it('preserves existing selection when applying a saved list with no matches', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') return { ok: true, value: snapshot };
      throw new Error(`unexpected command: ${command}`);
    });
    const listStockMoveLists = vi.fn(async () => ({
      ok: true,
      value: [
        {
          id: 'saved-1',
          name: '无匹配列表',
          savedAt: '2026-06-05T03:04:05.000Z',
          itemCids: [9999999],
          items: [],
        },
      ],
    }));
    setupDesktop(runAutoOperationCommand, { listStockMoveLists, saveStockMoveList: vi.fn() });

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    // Manually check 1032006.
    await wrapper.find('[data-testid="stock-move-item-group-1032006"]').setValue(true);
    await nextTick();
    expect(getCheckedCids(wrapper)).toEqual([1032006]);

    // Apply a saved list with only non-matching CIDs.
    await wrapper.find('[data-testid="stock-move-apply-list-saved-1"]').trigger('click');
    await nextTick();

    // Error message should appear.
    expect(wrapper.find('[data-testid="stock-move-saved-lists-error"]').text()).toContain('没有匹配');

    // Existing selection should be preserved.
    expect(getCheckedCids(wrapper)).toEqual([1032006]);
  });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/inject/StockMovePanel.test.js -t "merges into" -t "preserves existing"
```

预期：合并测试 FAIL（当前为替换行为），无匹配回归测试 PASS（当前已保护选中不变）。

- [ ] **Step 3: 改一行实现**

在 `src/inject/StockMovePanel.vue` 的 `applySavedList()` 函数中，将：

```js
  selectedItemCids.value = nextSelection;
```

改为：

```js
  selectedItemCids.value = [...new Set([...selectedItemCids.value, ...nextSelection])];
```

- [ ] **Step 4: 运行全部测试确认通过**

```bash
npx vitest run src/inject/StockMovePanel.test.js
```

预期：全部通过（23 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/inject/StockMovePanel.vue src/inject/StockMovePanel.test.js
git commit -m "feat(inject): change apply saved list from replace to merge"
```

---

### Task 2: 验证 & 文档

- [ ] **Step 1: 运行完整测试套件确认无回归**

```bash
npx vitest run
```

- [ ] **Step 2: 更新 spec 状态**

将 `docs/superpowers/specs/2026-06-22-stock-move-apply-list-merge-design.md` 第 3 行 `状态: 待审批` 改为 `状态: 已实现`。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-22-stock-move-apply-list-merge-design.md
git commit -m "docs(spec): mark apply-list merge spec as implemented"
```
