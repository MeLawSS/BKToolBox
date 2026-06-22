# Inject 批量移仓反选功能 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在批量移仓面板工具栏新增"反选"按钮，对可见分组执行反向选择。

**Architecture:** 在 `StockMovePanel.vue` 中新增纯函数 `invertSelection()`，在 i18n 中新增中英文条目，并在现有测试文件中补充覆盖。

**Tech Stack:** Vue 3 (Composition API), Vitest + @vue/test-utils

## Global Constraints

- 反选仅作用于当前搜索筛选后的可见分组
- 保留被搜索筛选隐藏的已选分组（不被反选影响）
- 与 `selectAllItems()` / `clearSelection()` 一致的重置行为（`submitError` + `summary`）
- 不主动清除 `savedListsError`（与全选/清空保持一致的先例）
- disabled 条件与全选一致：可见分组为空时禁用
- i18n key: `inject.stockMoveInvert`, zh-CN: `反选`, en: `Invert Selection`
- data-testid: `stock-move-invert`

---

### Task 1: i18n 条目

**Files:**
- Modify: `src/shared/messages.js`

**Interfaces:**
- Produces: `inject.stockMoveInvert` key available to all Vue templates via `t()` helper

- [ ] **Step 1: 添加 i18n key**

在 `src/shared/messages.js` 中找到 `stockMoveClear` 所在的 zh-CN 条目块（约第 182 行），在 `stockMoveClear` 后插入：

```js
stockMoveInvert: '反选',
```

在 en 条目块（约第 1035 行），在 `stockMoveClear` 后插入：

```js
stockMoveInvert: 'Invert Selection',
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/messages.js
git commit -m "feat(i18n): add inject.stockMoveInvert key (zh-CN: 反选, en: Invert Selection)"
```

---

### Task 2: 反选功能实现 + 按钮

**Files:**
- Modify: `src/inject/StockMovePanel.vue`

**Interfaces:**
- Consumes: `inject.stockMoveInvert` i18n key (from Task 1)
- Produces: `invertSelection()` function (internal, called by button click)

- [ ] **Step 1: 在 `clearSelection()` 下方添加 `invertSelection()` 函数**

打开 `src/inject/StockMovePanel.vue`，在 `clearSelection` 函数定义之后（约第 397 行之后）插入：

```js
function invertSelection() {
  const visibleCids = new Set(visibleSourceGroups.value.map((g) => g.itemCid));
  const currentSet = new Set(selectedItemCids.value);
  const hiddenSelected = selectedItemCids.value.filter((cid) => !visibleCids.has(cid));
  const visibleUnselected = [...new Set(
    visibleSourceGroups.value
      .filter((g) => !currentSet.has(g.itemCid))
      .map((g) => g.itemCid),
  )];
  selectedItemCids.value = [...hiddenSelected, ...visibleUnselected];
  submitError.value = '';
  resetSummary();
}
```

- [ ] **Step 2: 在清空按钮后插入反选按钮**

在 `stock-move-clear` 按钮之后（第 661 行 `</button>` 后），在 `</div>` 关闭标签之前（第 662 行），插入：

```html
        <button
          class="command-button stock-move-secondary-button stock-move-secondary-button--compact"
          type="button"
          data-testid="stock-move-invert"
          :disabled="!visibleSourceGroups.length"
          @click="invertSelection"
        >
          {{ t('inject.stockMoveInvert') }}
        </button>
```

- [ ] **Step 3: Commit**

```bash
git add src/inject/StockMovePanel.vue
git commit -m "feat(inject): add inverse selection button to stock move panel"
```

---

### Task 3: 测试

**Files:**
- Modify: `src/inject/StockMovePanel.test.js`

**Interfaces:**
- Consumes: `stock-move-invert` button (data-testid), `invertSelection` behavior (from Task 2)

- [ ] **Step 1: 添加辅助函数 `getCheckedCids`**

在测试文件中 `getVisibleGroupCids` 函数定义之后（约第 200 行），插入：

```js
function getCheckedCids(wrapper) {
  return wrapper
    .findAll('tbody input[type="checkbox"]')
    .filter((checkbox) => checkbox.element.checked)
    .map((checkbox) => Number(checkbox.element.value));
}
```

- [ ] **Step 2: 添加核心反选测试用例**

在测试文件的最后一个 `it(...)` 块之后、`});` (describe 闭合) 之前，插入以下测试：

```js
  it('invert selection toggles checked state for visible groups and preserves hidden selections', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') return { ok: true, value: snapshot };
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    // Initially nothing is checked.
    expect(getCheckedCids(wrapper)).toEqual([]);

    // Click "Select All" — all visible groups should be checked.
    await wrapper.find('[data-testid="stock-move-select-all"]').trigger('click');
    await nextTick();
    expect(getCheckedCids(wrapper).sort()).toEqual([1011001, 1032006, 1083009].sort());

    // Click "Invert" — all should become unchecked.
    await wrapper.find('[data-testid="stock-move-invert"]').trigger('click');
    await nextTick();
    expect(getCheckedCids(wrapper)).toEqual([]);

    // Click "Invert" again — all should become checked (empty → full).
    await wrapper.find('[data-testid="stock-move-invert"]').trigger('click');
    await nextTick();
    expect(getCheckedCids(wrapper).sort()).toEqual([1011001, 1032006, 1083009].sort());

    // Manually check only the first group.
    await wrapper.find('[data-testid="stock-move-item-group-1032006"]').setValue(false);
    await nextTick();
    expect(getCheckedCids(wrapper).sort()).toEqual([1011001, 1083009].sort());

    // Invert: 1011001 and 1083009 become unchecked; 1032006 becomes checked.
    await wrapper.find('[data-testid="stock-move-invert"]').trigger('click');
    await nextTick();
    expect(getCheckedCids(wrapper)).toEqual([1032006]);
  });

  it('invert selection with search filter preserves hidden selections', async () => {
    const snapshot = createSortableSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') return { ok: true, value: snapshot };
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    // Select all groups (1032006, 1083009, 1011001).
    await wrapper.find('[data-testid="stock-move-select-all"]').trigger('click');
    await nextTick();
    expect(getCheckedCids(wrapper).sort()).toEqual([1011001, 1032006, 1083009].sort());

    // Search to filter down to only 1032006 (Boots).
    await wrapper.find('[data-testid="stock-move-search"]').setValue('boot');
    await nextTick();
    expect(getVisibleGroupCids(wrapper)).toEqual(['1032006']);

    // Invert — 1032006 becomes unchecked, but hidden selections (1011001, 1083009) are preserved.
    await wrapper.find('[data-testid="stock-move-invert"]').trigger('click');
    await nextTick();
    expect(getCheckedCids(wrapper).sort()).toEqual([1011001, 1083009].sort());

    // Clear search filter.
    await wrapper.find('[data-testid="stock-move-search"]').setValue('');
    await nextTick();
    expect(getVisibleGroupCids(wrapper).sort()).toEqual([1032006, 1083009, 1011001].sort());
    // 1011001 and 1083009 are still checked (preserved), 1032006 is now unchecked.
    expect(getCheckedCids(wrapper).sort()).toEqual([1011001, 1083009].sort());
  });

  it('invert selection button is disabled when no visible groups', async () => {
    const snapshot = createSnapshot();
    const runAutoOperationCommand = vi.fn(async (command) => {
      if (command === 'GetStockContainers') return { ok: true, value: snapshot };
      throw new Error(`unexpected command: ${command}`);
    });
    setupDesktop(runAutoOperationCommand);

    const wrapper = await mountPanel();
    await wrapper.find('[data-testid="stock-move-load"]').trigger('click');
    await flushPromises();
    await nextTick();
    await wrapper.find('[data-testid="stock-move-source"]').setValue('1');
    await nextTick();

    // Filter to a non-existent item — no visible groups.
    await wrapper.find('[data-testid="stock-move-search"]').setValue('nonexistent');
    await nextTick();
    expect(getVisibleGroupCids(wrapper)).toEqual([]);

    const invertButton = wrapper.find('[data-testid="stock-move-invert"]');
    expect(invertButton.attributes('disabled')).toBeDefined();

    // Clear filter — button should be enabled again.
    await wrapper.find('[data-testid="stock-move-search"]').setValue('');
    await nextTick();
    expect(invertButton.attributes('disabled')).toBeUndefined();
  });
```

- [ ] **Step 3: 运行测试确认通过**

```bash
npx vitest run src/inject/StockMovePanel.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/inject/StockMovePanel.test.js
git commit -m "test(inject): add inverse selection coverage"
```

---

### Task 4: 验证 & 文档

**Files:**
- Modify: `docs/superpowers/specs/2026-06-22-stock-move-inverse-selection-design.md`

- [ ] **Step 1: 更新 spec 状态为已完成**

将 spec 文档第 3 行的 `状态: 待审批` 改为 `状态: 已实现`。

- [ ] **Step 2: 运行完整测试套件确认无回归**

```bash
npx vitest run
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-22-stock-move-inverse-selection-design.md
git commit -m "docs(spec): mark inverse selection spec as implemented"
```
