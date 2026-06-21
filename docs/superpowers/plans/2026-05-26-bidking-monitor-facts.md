# BidKing Monitor Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a low-coupling monitor facts layer so Ethan, Ahmed, and Monitor pages consume stable facts/state instead of raw BidKing protocol fields.

**Architecture:** Keep `scripts/parse-bidking-tcp-pcap.mjs` raw and lossless. Add CommonJS shared modules under `lib/` so both the Electron/Node monitor service and Vite renderer pages can reuse the same facts, grid, and store logic. Preserve the old SSE raw event shape during migration by adding `rawEvent`, `facts`, and `state` fields to the existing event payload.

**Tech Stack:** Node CommonJS modules, Vue 3 renderer pages bundled by Vite, Vitest, Express SSE, Electron packaged app.

---

## File Structure

- Create `lib/bidking-monitor-grid.js`
  - CommonJS owner of monitor board constants and grid reduction helpers currently living in `src/ethan/monitor-grid.js`.
  - Exports `MONITOR_GRID_ROWS`, `MONITOR_GRID_COLUMNS`, `MONITOR_OUTLINE_SKILL_CID`, `createMonitorCells`, `createEmptyMonitorGridState`, `parseSlotType`, `applyMonitorEventToGridState`, and `inferMinimumOccupiedCells`.
- Modify `src/ethan/monitor-grid.js`
  - Replace implementation with an ESM wrapper around `../../lib/bidking-monitor-grid.js`.
  - Keeps current Ethan imports and tests stable.
- Create `lib/bidking-monitor-facts.js`
  - Converts one raw monitor event into stable facts.
  - Owns skill ID, item ID, skill name, quality, aggregate, outline, exact item, and type reveal mappings.
- Create `lib/bidking-monitor-facts.test.mjs`
  - Unit tests for raw event to facts conversion.
- Create `lib/bidking-monitor-store.js`
  - Reducer-style canonical monitor state.
  - Applies facts, resets on new game, de-duplicates facts, merges outline/quality facts, computes group aggregates, revealed types, exact items, and `minimumOccupied`.
- Create `lib/bidking-monitor-store.test.mjs`
  - Unit tests for state transitions and event-order independence.
- Modify `lib/bidking-live-monitor.js`
  - Enrich emitted events with `{ rawEvent, facts, state }` while preserving top-level raw event fields.
  - Maintain one canonical state in the monitor service.
- Modify `lib/bidking-live-monitor.test.mjs`
  - Assert emitted/recent events include facts and state.
- Create `src/ethan/monitor-adapter.js`
  - Maps monitor facts/state into Ethan auto-fill values.
  - Keeps user overwrite rules in Ethan, not in the shared facts/store layer.
- Create `src/ethan/monitor-adapter.test.js`
  - Unit tests for Ethan page-specific auto-fill mapping.
- Modify `src/ethan/App.vue`
  - Remove raw skill ID aggregate mapping from the component.
  - Consume `payload.state` and adapter results; keep fallback for raw-only payloads during migration.
- Modify `src/ethan/App.test.js`
  - Replace raw skill-field expectations with facts/state payload expectations where relevant.
- Modify `src/monitor/App.vue`
  - Display facts/state if present while retaining raw event debug output.
- Modify `src/monitor/App.test.js`
  - Assert Monitor page accepts enriched payloads.
- Modify docs:
  - `docs/Documentation.md`
  - `docs/BIDKING_SKILL_PARSE_SUPPORT.md`
  - `docs/BIDKING_REALTIME_PROTOCOL_SCHEMA.md`
  - `docs/bidking-realtime-protocol-schema.json`

## Task 1: Extract Monitor Grid To Shared CommonJS

**Files:**
- Create: `lib/bidking-monitor-grid.js`
- Modify: `src/ethan/monitor-grid.js`
- Test: `src/ethan/monitor-grid.test.js`

- [ ] **Step 1: Copy current grid implementation into `lib/bidking-monitor-grid.js`**

Move the full current contents of `src/ethan/monitor-grid.js` into `lib/bidking-monitor-grid.js`, then convert the exports to CommonJS. The final export block must be:

```js
module.exports = {
  MONITOR_GRID_ROWS,
  MONITOR_GRID_COLUMNS,
  MONITOR_OUTLINE_SKILL_CID,
  createMonitorCells,
  createEmptyMonitorGridState,
  parseSlotType,
  applyMonitorEventToGridState,
  inferMinimumOccupiedCells,
};
```

- [ ] **Step 2: Replace `src/ethan/monitor-grid.js` with an ESM wrapper**

Use this complete wrapper:

```js
import gridModule from '../../lib/bidking-monitor-grid.js';

export const {
  MONITOR_GRID_ROWS,
  MONITOR_GRID_COLUMNS,
  MONITOR_OUTLINE_SKILL_CID,
  createMonitorCells,
  createEmptyMonitorGridState,
  parseSlotType,
  applyMonitorEventToGridState,
  inferMinimumOccupiedCells,
} = gridModule;
```

- [ ] **Step 3: Run the focused grid tests**

Run:

```bash
npx vitest run src/ethan/monitor-grid.test.js
```

Expected: all tests in `src/ethan/monitor-grid.test.js` pass with the same assertions as before extraction.

- [ ] **Step 4: Commit**

```bash
git add lib/bidking-monitor-grid.js src/ethan/monitor-grid.js
git commit -m "refactor: share bidking monitor grid helpers"
```

## Task 2: Add Raw Event To Facts Conversion

**Files:**
- Create: `lib/bidking-monitor-facts.js`
- Create: `lib/bidking-monitor-facts.test.mjs`

- [ ] **Step 1: Write failing facts tests**

Create `lib/bidking-monitor-facts.test.mjs` with these test cases:

```js
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildBidKingMonitorFacts,
  getQualityGroupFromName,
} = require('./bidking-monitor-facts.js');

describe('buildBidKingMonitorFacts', () => {
  it('converts outline, type, and quality payloads into domain facts', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:outline',
      gameUid: 'game-1',
      round: 2,
      skill: {
        uid: 'outline-skill',
        skillCid: 1002081,
        hitItemTypeNames: ['家居日用', '数码电子'],
        hitBoxList: [
          { boxId: 25, itemSlotType: 22, itemQuility: 3, itemQuilityName: '蓝' },
        ],
      },
    });

    expect(facts).toEqual([
      expect.objectContaining({ type: 'game.changed', gameUid: 'game-1', round: 2 }),
      expect.objectContaining({ type: 'type.revealed', gameUid: 'game-1', itemTypes: ['家居日用', '数码电子'] }),
      expect.objectContaining({
        type: 'item.qualityCellsRevealed',
        gameUid: 'game-1',
        cells: [26],
        quality: { id: 3, name: '蓝', group: 'blue' },
      }),
      expect.objectContaining({
        type: 'item.outlineRevealed',
        gameUid: 'game-1',
        cells: [26, 27, 36, 37],
        width: 2,
        height: 2,
        quality: { id: 3, name: '蓝', group: 'blue' },
      }),
    ]);
  });

  it('converts exact item payloads into exact item facts', () => {
    const facts = buildBidKingMonitorFacts({
      key: 'skill:exact',
      gameUid: 'game-1',
      skill: {
        uid: 'exact-skill',
        skillCid: 200022,
        hitBoxList: [{
          boxId: 0,
          itemCid: 1033001,
          itemName: '测试藏品',
          itemSlotType: 11,
          itemQuility: 4,
          itemQuilityName: '紫',
          itemPrice: 12345,
        }],
      },
    });

    expect(facts).toContainEqual(expect.objectContaining({
      type: 'item.exactRevealed',
      itemCid: 1033001,
      itemName: '测试藏品',
      itemPrice: 12345,
      cells: [1],
      quality: { id: 4, name: '紫', group: 'purple' },
    }));
  });

  it('converts known map aggregate skills into group facts', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:purple-cells',
      gameUid: 'game-1',
      skill: { uid: 'purple-cells', skillCid: 200010, totalHitBoxIndex: 12 },
    })).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'purple',
      value: 12,
    }));

    expect(buildBidKingMonitorFacts({
      key: 'skill:orange-price',
      gameUid: 'game-1',
      skill: { uid: 'orange-price', itemCid: 200037, skillCid: 999999, allHitItemAvgPrice: 30472 },
    })).toContainEqual(expect.objectContaining({
      type: 'group.averagePriceKnown',
      group: 'orange',
      value: 30472,
    }));
  });

  it('converts named scan and average-cell skills into group facts', () => {
    expect(buildBidKingMonitorFacts({
      key: 'skill:blue-scan',
      gameUid: 'game-1',
      skill: { uid: 'blue-scan', itemName: '良品扫描', totalHitBoxIndex: 29 },
    })).toContainEqual(expect.objectContaining({
      type: 'group.totalCellsKnown',
      group: 'blue',
      value: 29,
    }));

    expect(buildBidKingMonitorFacts({
      key: 'skill:purple-avg',
      gameUid: 'game-1',
      skill: { uid: 'purple-avg', itemName: '优品均格', allHitItemAvgBoxIndex: 2.8 },
    })).toContainEqual(expect.objectContaining({
      type: 'group.averageCellsKnown',
      group: 'purple',
      value: 2.8,
    }));
  });

  it('maps quality names to stable quality groups', () => {
    expect(getQualityGroupFromName('白')).toBe('wg');
    expect(getQualityGroupFromName('绿')).toBe('wg');
    expect(getQualityGroupFromName('蓝')).toBe('blue');
    expect(getQualityGroupFromName('紫')).toBe('purple');
    expect(getQualityGroupFromName('金')).toBe('orange');
    expect(getQualityGroupFromName('红')).toBe('red');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run lib/bidking-monitor-facts.test.mjs
```

Expected: FAIL because `lib/bidking-monitor-facts.js` does not exist.

- [ ] **Step 3: Implement `lib/bidking-monitor-facts.js`**

Create a CommonJS module with these exports:

```js
const { parseSlotType, MONITOR_GRID_COLUMNS } = require('./bidking-monitor-grid.js');

const KNOWN_AGGREGATE_SKILLS = new Map([
  [200010, { group: 'purple', factType: 'group.totalCellsKnown', valueKey: 'totalHitBoxIndex' }],
  [200011, { group: 'orange', factType: 'group.totalCellsKnown', valueKey: 'totalHitBoxIndex' }],
  [200012, { group: 'red', factType: 'group.totalCellsKnown', valueKey: 'totalHitBoxIndex' }],
  [200013, { group: 'purple', factType: 'group.averageCellsKnown', valueKey: 'allHitItemAvgBoxIndex' }],
  [200015, { group: 'orange', factType: 'group.averageCellsKnown', valueKey: 'allHitItemAvgBoxIndex' }],
  [200016, { group: 'red', factType: 'group.averageCellsKnown', valueKey: 'allHitItemAvgBoxIndex' }],
  [200036, { group: 'purple', factType: 'group.averagePriceKnown', valueKey: 'allHitItemAvgPrice' }],
  [200037, { group: 'orange', factType: 'group.averagePriceKnown', valueKey: 'allHitItemAvgPrice' }],
  [200038, { group: 'red', factType: 'group.averagePriceKnown', valueKey: 'allHitItemAvgPrice' }],
]);

function buildBidKingMonitorFacts(rawEvent) {
  const event = rawEvent?.rawEvent ?? rawEvent;
  if (!event?.skill) return [];
  const skill = event.skill;
  const facts = [];
  const source = buildFactSource(event);

  if (event.gameUid) {
    facts.push({ type: 'game.changed', key: `${source.key}:game`, gameUid: String(event.gameUid), round: event.round ?? null, source });
  }

  const itemTypes = getRevealedTypes(skill);
  if (itemTypes.length) {
    facts.push({ type: 'type.revealed', key: `${source.key}:types`, gameUid: event.gameUid ?? null, itemTypes, source });
  }

  const aggregateFact = buildAggregateFact(event, skill, source);
  if (aggregateFact) facts.push(aggregateFact);

  for (const box of skill.hitBoxList ?? []) {
    const quality = getBoxQuality(box);
    const protocolBoxId = normalizeProtocolBoxId(box?.boxId);
    if (quality && protocolBoxId !== null) {
      facts.push({
        type: 'item.qualityCellsRevealed',
        key: `${source.key}:quality:${protocolBoxId}`,
        gameUid: event.gameUid ?? null,
        cells: [protocolBoxId + 1],
        quality,
        source,
      });
    }

    const outline = buildOutlineFact(event, box, quality, source);
    if (outline) facts.push(outline);

    const exactItem = buildExactItemFact(event, box, quality, source);
    if (exactItem) facts.push(exactItem);
  }

  return facts;
}

function buildAggregateFact(event, skill, source) {
  const name = String(skill.itemName ?? skill.skillName ?? skill.name ?? '').trim();
  const sourceIds = [skill.itemCid, skill.skillCid].map(Number).filter(Number.isFinite);
  for (const id of sourceIds) {
    const config = KNOWN_AGGREGATE_SKILLS.get(id);
    if (!config || skill[config.valueKey] === undefined) continue;
    return {
      type: config.factType,
      key: `${source.key}:aggregate:${config.group}:${config.factType}`,
      gameUid: event.gameUid ?? null,
      group: config.group,
      value: Number(skill[config.valueKey]),
      source,
    };
  }

  const group = getAggregateGroup(name, sourceIds, skill);
  if (!group) return null;
  if (name.includes('扫描') || sourceIds.some((id) => id >= 201 && id <= 205) || sourceIds.some((id) => id >= 100104 && id <= 100108)) {
    if (skill.totalHitBoxIndex === undefined) return null;
    return { type: 'group.totalCellsKnown', key: `${source.key}:aggregate:${group}:cells`, gameUid: event.gameUid ?? null, group, value: Number(skill.totalHitBoxIndex), source };
  }
  if (name.includes('均格') || sourceIds.some((id) => id >= 301 && id <= 305) || sourceIds.some((id) => id >= 100110 && id <= 100114)) {
    if (skill.allHitItemAvgBoxIndex === undefined) return null;
    return { type: 'group.averageCellsKnown', key: `${source.key}:aggregate:${group}:avg`, gameUid: event.gameUid ?? null, group, value: Number(skill.allHitItemAvgBoxIndex), source };
  }
  return null;
}

function buildOutlineFact(event, box, directQuality, source) {
  const size = parseSlotType(box?.itemSlotType);
  const protocolBoxId = normalizeProtocolBoxId(box?.boxId);
  if (!size || protocolBoxId === null) return null;
  const cells = getFootprintCells(protocolBoxId + 1, size.width, size.height);
  return {
    type: 'item.outlineRevealed',
    key: `${source.key}:outline:${protocolBoxId}:${size.label}`,
    gameUid: event.gameUid ?? null,
    boxId: protocolBoxId + 1,
    protocolBoxId,
    cells,
    width: size.width,
    height: size.height,
    label: size.label,
    quality: directQuality,
    itemCid: box.itemCid ?? null,
    itemName: box.itemName ?? null,
    itemPrice: box.itemPrice ?? box.price ?? null,
    source,
  };
}

function buildExactItemFact(event, box, directQuality, source) {
  if (box?.itemCid === undefined && !box?.itemName && box?.itemPrice === undefined && box?.price === undefined) return null;
  const outline = buildOutlineFact(event, box, directQuality, source);
  return {
    type: 'item.exactRevealed',
    key: `${source.key}:exact:${box.itemCid ?? box.itemName ?? 'unknown'}:${box.boxId ?? 'no-box'}`,
    gameUid: event.gameUid ?? null,
    itemCid: box.itemCid ?? null,
    itemName: box.itemName ?? null,
    itemPrice: box.itemPrice ?? box.price ?? null,
    cells: outline?.cells ?? [],
    width: outline?.width ?? null,
    height: outline?.height ?? null,
    quality: directQuality,
    source,
  };
}

function buildFactSource(event) {
  return {
    key: event.key ?? `${event.msgId ?? 'unknown'}:${event.gameUid ?? 'no-game'}`,
    eventKey: event.key ?? null,
    msgId: event.msgId ?? null,
    group: event.group ?? null,
    skillUid: event.skill?.uid ?? null,
    skillCid: event.skill?.skillCid ?? null,
    itemCid: event.skill?.itemCid ?? null,
  };
}

function getRevealedTypes(skill) {
  if (Array.isArray(skill?.hitItemTypeNames) && skill.hitItemTypeNames.length) return skill.hitItemTypeNames.map(String);
  if (Array.isArray(skill?.hitItemTypeList) && skill.hitItemTypeList.length) return skill.hitItemTypeList.map(String);
  return [];
}

function getAggregateGroup(name, sourceIds, skill) {
  if (name.includes('普品')) return 'wg';
  if (name.includes('良品')) return 'blue';
  if (name.includes('优品')) return 'purple';
  if (name.includes('极品')) return 'orange';
  if (name.includes('珍品')) return 'red';
  for (const id of sourceIds) {
    if (id === 201 || id === 301 || id === 100104 || id === 100110) return 'wg';
    if (id === 202 || id === 302 || id === 100105 || id === 100111) return 'blue';
    if (id === 203 || id === 303 || id === 100106 || id === 100112) return 'purple';
    if (id === 204 || id === 304 || id === 100107 || id === 100113) return 'orange';
    if (id === 205 || id === 305 || id === 100108 || id === 100114) return 'red';
  }
  const qualities = Array.isArray(skill?.hitItemQuilityList) ? skill.hitItemQuilityList.map(Number) : [];
  if (qualities.length === 1) return getQualityGroupFromId(qualities[0]);
  if (qualities.length === 2 && qualities.includes(1) && qualities.includes(2)) return 'wg';
  return '';
}

function getBoxQuality(box) {
  const id = box?.itemQuility ?? box?.itemQuality ?? box?.qualityId;
  const name = box?.itemQuilityName ?? box?.itemQualityName ?? box?.quality;
  if (id === undefined && !name) return null;
  const group = getQualityGroupFromId(Number(id)) || getQualityGroupFromName(name);
  return { id, name: name ? String(name) : String(id), group };
}

function getQualityGroupFromId(id) {
  if (id === 1 || id === 2) return 'wg';
  if (id === 3) return 'blue';
  if (id === 4) return 'purple';
  if (id === 5) return 'orange';
  if (id === 6) return 'red';
  return '';
}

function getQualityGroupFromName(name) {
  const value = String(name ?? '');
  if (value.includes('白') || value.includes('绿') || value.includes('普')) return 'wg';
  if (value.includes('蓝') || value.includes('良')) return 'blue';
  if (value.includes('紫') || value.includes('优')) return 'purple';
  if (value.includes('金') || value.includes('橙') || value.includes('极')) return 'orange';
  if (value.includes('红') || value.includes('珍')) return 'red';
  return '';
}

function normalizeProtocolBoxId(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return null;
  return number;
}

function getFootprintCells(startCell, width, height) {
  const cells = [];
  const startIndex = startCell - 1;
  const row = Math.floor(startIndex / MONITOR_GRID_COLUMNS);
  const column = startIndex % MONITOR_GRID_COLUMNS;
  for (let rowOffset = 0; rowOffset < height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < width; columnOffset += 1) {
      cells.push((row + rowOffset) * MONITOR_GRID_COLUMNS + column + columnOffset + 1);
    }
  }
  return cells;
}

module.exports = {
  buildBidKingMonitorFacts,
  getQualityGroupFromName,
  getQualityGroupFromId,
};
```

- [ ] **Step 4: Run facts tests**

Run:

```bash
npx vitest run lib/bidking-monitor-facts.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bidking-monitor-facts.js lib/bidking-monitor-facts.test.mjs
git commit -m "feat: normalize bidking monitor facts"
```

## Task 3: Add Canonical Monitor Store

**Files:**
- Create: `lib/bidking-monitor-store.js`
- Create: `lib/bidking-monitor-store.test.mjs`

- [ ] **Step 1: Write failing store tests**

Create `lib/bidking-monitor-store.test.mjs`:

```js
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  applyBidKingMonitorFacts,
  createEmptyBidKingMonitorState,
} = require('./bidking-monitor-store.js');

describe('BidKing monitor store', () => {
  it('resets all match state when a new game fact arrives', () => {
    const first = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'game.changed', key: 'game-1', gameUid: 'game-1' },
      { type: 'group.totalCellsKnown', key: 'blue-cells', gameUid: 'game-1', group: 'blue', value: 29 },
    ]);
    const second = applyBidKingMonitorFacts(first, [
      { type: 'game.changed', key: 'game-2', gameUid: 'game-2' },
    ]);

    expect(first.groups.blue.totalCells).toBe(29);
    expect(second.gameUid).toBe('game-2');
    expect(second.groups.blue.totalCells).toBeNull();
    expect(second.outlines).toEqual([]);
  });

  it('applies aggregate group facts', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'game.changed', key: 'game-1', gameUid: 'game-1' },
      { type: 'group.totalCellsKnown', key: 'blue-cells', gameUid: 'game-1', group: 'blue', value: 29 },
      { type: 'group.averageCellsKnown', key: 'purple-avg', gameUid: 'game-1', group: 'purple', value: 2.8 },
      { type: 'group.averagePriceKnown', key: 'orange-price', gameUid: 'game-1', group: 'orange', value: 30472 },
    ]);

    expect(state.groups.blue.totalCells).toBe(29);
    expect(state.groups.purple.averageCells).toBe(2.8);
    expect(state.groups.orange.averagePrice).toBe(30472);
  });

  it('merges quality and outline facts regardless of arrival order', () => {
    const qualityFirst = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'game.changed', key: 'game-1', gameUid: 'game-1' },
      { type: 'item.qualityCellsRevealed', key: 'quality-2', gameUid: 'game-1', cells: [2], quality: { id: 4, name: '紫', group: 'purple' } },
      { type: 'item.outlineRevealed', key: 'outline-1', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, cells: [1, 2, 11, 12], width: 2, height: 2, label: '2x2', quality: null },
    ]);

    const outlineFirst = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'game.changed', key: 'game-1', gameUid: 'game-1' },
      { type: 'item.outlineRevealed', key: 'outline-1', gameUid: 'game-1', boxId: 1, protocolBoxId: 0, cells: [1, 2, 11, 12], width: 2, height: 2, label: '2x2', quality: null },
      { type: 'item.qualityCellsRevealed', key: 'quality-2', gameUid: 'game-1', cells: [2], quality: { id: 4, name: '紫', group: 'purple' } },
    ]);

    expect(qualityFirst.outlines[0]).toMatchObject({ qualityName: '紫', qualityGroup: 'purple', qualityStatus: 'confirmed' });
    expect(outlineFirst.outlines[0]).toMatchObject({ qualityName: '紫', qualityGroup: 'purple', qualityStatus: 'confirmed' });
  });

  it('dedupes facts by fact key', () => {
    const state = applyBidKingMonitorFacts(createEmptyBidKingMonitorState(), [
      { type: 'group.totalCellsKnown', key: 'blue-cells', gameUid: 'game-1', group: 'blue', value: 29 },
      { type: 'group.totalCellsKnown', key: 'blue-cells', gameUid: 'game-1', group: 'blue', value: 30 },
    ]);

    expect(state.groups.blue.totalCells).toBe(29);
    expect(state.seenFactKeys).toEqual(['blue-cells']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run lib/bidking-monitor-store.test.mjs
```

Expected: FAIL because `lib/bidking-monitor-store.js` does not exist.

- [ ] **Step 3: Implement `lib/bidking-monitor-store.js`**

Create a reducer module with these public functions and state shape:

```js
const { inferMinimumOccupiedCells } = require('./bidking-monitor-grid.js');

const GROUP_KEYS = ['wg', 'blue', 'purple', 'orange', 'red'];

function createEmptyBidKingMonitorState(gameUid = null) {
  return {
    gameUid,
    round: null,
    groups: Object.fromEntries(GROUP_KEYS.map((group) => [group, {
      totalCells: null,
      averageCells: null,
      averagePrice: null,
    }])),
    outlines: [],
    exactItems: [],
    qualityCells: [],
    revealedTypes: [],
    minimumOccupied: null,
    warnings: [],
    seenFactKeys: [],
  };
}

function applyBidKingMonitorFacts(currentState = createEmptyBidKingMonitorState(), facts = []) {
  let state = currentState;
  for (const fact of facts) {
    if (!fact?.type) continue;
    if (fact.type === 'game.changed') {
      const nextGameUid = fact.gameUid ? String(fact.gameUid) : null;
      if (nextGameUid && nextGameUid !== state.gameUid) {
        state = createEmptyBidKingMonitorState(nextGameUid);
      }
      if (fact.round !== undefined) state = { ...state, round: fact.round };
      continue;
    }

    const factKey = fact.key || `${fact.type}:${JSON.stringify(fact)}`;
    if (state.seenFactKeys.includes(factKey)) continue;
    state = { ...state, seenFactKeys: [...state.seenFactKeys, factKey] };

    if (fact.gameUid && fact.gameUid !== state.gameUid) {
      state = { ...createEmptyBidKingMonitorState(String(fact.gameUid)), seenFactKeys: [factKey] };
    }

    if (fact.type === 'group.totalCellsKnown') {
      state = setGroupValue(state, fact.group, 'totalCells', fact.value);
    } else if (fact.type === 'group.averageCellsKnown') {
      state = setGroupValue(state, fact.group, 'averageCells', fact.value);
    } else if (fact.type === 'group.averagePriceKnown') {
      state = setGroupValue(state, fact.group, 'averagePrice', fact.value);
    } else if (fact.type === 'type.revealed') {
      state = { ...state, revealedTypes: mergeStrings(state.revealedTypes, fact.itemTypes ?? []) };
    } else if (fact.type === 'item.qualityCellsRevealed') {
      state = { ...state, qualityCells: mergeQualityCells(state.qualityCells, fact) };
    } else if (fact.type === 'item.outlineRevealed') {
      state = { ...state, outlines: mergeOutlines(state.outlines, [factToOutline(fact)]) };
    } else if (fact.type === 'item.exactRevealed') {
      state = { ...state, exactItems: mergeExactItems(state.exactItems, fact) };
    }

    state = finalizeDerivedState(state);
  }
  return state;
}

function setGroupValue(state, group, field, value) {
  if (!GROUP_KEYS.includes(group)) return state;
  return {
    ...state,
    groups: {
      ...state.groups,
      [group]: {
        ...state.groups[group],
        [field]: Number(value),
      },
    },
  };
}

function mergeStrings(current, next) {
  return [...new Set([...(current ?? []), ...(next ?? []).map(String)])];
}

function mergeQualityCells(current, fact) {
  const byCell = new Map((current ?? []).map((entry) => [entry.cell, entry]));
  for (const cell of fact.cells ?? []) {
    byCell.set(cell, {
      cell,
      qualityId: fact.quality?.id,
      qualityName: fact.quality?.name,
      qualityGroup: fact.quality?.group,
    });
  }
  return [...byCell.values()].sort((left, right) => left.cell - right.cell);
}

function factToOutline(fact) {
  return {
    boxId: fact.boxId,
    protocolBoxId: fact.protocolBoxId,
    row: Math.floor((fact.boxId - 1) / 10) + 1,
    column: ((fact.boxId - 1) % 10) + 1,
    width: fact.width,
    height: fact.height,
    label: fact.label,
    cells: fact.cells,
    qualityId: fact.quality?.id,
    qualityName: fact.quality?.name,
    qualityGroup: fact.quality?.group,
    qualityStatus: fact.quality?.group ? 'confirmed' : undefined,
    itemCid: fact.itemCid,
    itemName: fact.itemName,
    price: fact.itemPrice,
  };
}

function mergeOutlines(current, next) {
  const byKey = new Map((current ?? []).map((outline) => [`${outline.boxId}:${outline.label}`, outline]));
  for (const outline of next) {
    byKey.set(`${outline.boxId}:${outline.label}`, { ...byKey.get(`${outline.boxId}:${outline.label}`), ...outline });
  }
  return [...byKey.values()].sort((left, right) => left.boxId - right.boxId);
}

function mergeExactItems(current, fact) {
  const key = `${fact.itemCid ?? fact.itemName}:${(fact.cells ?? []).join(',')}`;
  const byKey = new Map((current ?? []).map((item) => [item.key, item]));
  byKey.set(key, { key, ...fact });
  return [...byKey.values()];
}

function finalizeDerivedState(state) {
  const outlines = state.outlines.map((outline) => applyOutlineQuality(outline, state.qualityCells));
  return {
    ...state,
    outlines,
    minimumOccupied: inferMinimumOccupiedCells({ outlines }),
  };
}

function applyOutlineQuality(outline, qualityCells) {
  if (outline.qualityGroup) return outline;
  const hits = (qualityCells ?? []).filter((entry) => outline.cells.includes(entry.cell));
  const groups = [...new Set(hits.map((hit) => hit.qualityGroup).filter(Boolean))];
  if (groups.length === 1) {
    const hit = hits.find((entry) => entry.qualityGroup === groups[0]);
    return {
      ...outline,
      qualityId: hit.qualityId,
      qualityName: hit.qualityName,
      qualityGroup: hit.qualityGroup,
      qualityStatus: 'confirmed',
    };
  }
  if (groups.length > 1) return { ...outline, qualityStatus: 'conflict' };
  return outline;
}

module.exports = {
  GROUP_KEYS,
  createEmptyBidKingMonitorState,
  applyBidKingMonitorFacts,
};
```

- [ ] **Step 4: Run store tests**

Run:

```bash
npx vitest run lib/bidking-monitor-store.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bidking-monitor-store.js lib/bidking-monitor-store.test.mjs
git commit -m "feat: add canonical bidking monitor state"
```

## Task 4: Enrich Live Monitor Events With Facts And State

**Files:**
- Modify: `lib/bidking-live-monitor.js`
- Modify: `lib/bidking-live-monitor.test.mjs`
- Modify: `server.test.mjs`

- [ ] **Step 1: Add failing live monitor test assertions**

In `lib/bidking-live-monitor.test.mjs`, extend the first run-batch test so the parser writes an outline event:

```js
{
  key: 'skill:1',
  gameUid: 'game-1',
  type: 'skill',
  msgId: 39,
  sourceKind: 'game_use_item',
  skill: { uid: 'skill-1', skillCid: 1002081, hitBoxList: [{ boxId: 0, itemSlotType: 11 }] }
}
```

Add these assertions after the existing emitted event assertion:

```js
expect(emitted[0]).toMatchObject({
  key: 'skill:1',
  rawEvent: expect.objectContaining({ key: 'skill:1' }),
  facts: expect.arrayContaining([
    expect.objectContaining({ type: 'item.outlineRevealed', cells: [1] }),
  ]),
  state: expect.objectContaining({
    gameUid: 'game-1',
    outlines: [expect.objectContaining({ cells: [1] })],
  }),
});
```

- [ ] **Step 2: Add failing SSE compatibility assertion**

In `server.test.mjs`, change the fake monitor event emitted in the SSE test to include enriched fields:

```js
monitor.emit('event', {
  key: 'skill:1',
  msgId: 39,
  rawEvent: { key: 'skill:1', msgId: 39, skill: { skillCid: 702 } },
  facts: [{ type: 'group.totalCellsKnown', group: 'blue', value: 29 }],
  state: { gameUid: 'game-1', groups: { blue: { totalCells: 29 } } },
  skill: { skillCid: 702 },
});
```

Add:

```js
expect(streamText).toContain('"facts"');
expect(streamText).toContain('"state"');
expect(streamText).toContain('"rawEvent"');
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npx vitest run lib/bidking-live-monitor.test.mjs server.test.mjs
```

Expected: FAIL because live monitor events do not yet contain `facts` and `state`.

- [ ] **Step 4: Implement live monitor enrichment**

At the top of `lib/bidking-live-monitor.js`, add:

```js
const { buildBidKingMonitorFacts } = require('./bidking-monitor-facts.js');
const {
  applyBidKingMonitorFacts,
  createEmptyBidKingMonitorState,
} = require('./bidking-monitor-store.js');
```

In the `BidKingLiveMonitor` constructor, initialize:

```js
this.monitorState = createEmptyBidKingMonitorState();
```

In `runBatch`, replace the event emission body with:

```js
const rawEvent = event.rawEvent ?? event;
const facts = buildBidKingMonitorFacts(rawEvent);
this.monitorState = applyBidKingMonitorFacts(this.monitorState, facts);
const enrichedEvent = {
  ...rawEvent,
  rawEvent,
  facts,
  state: this.monitorState,
};
if (enrichedEvent.gameUid && enrichedEvent.gameUid !== this.currentGameUid) {
  this.currentGameUid = enrichedEvent.gameUid;
}
this.pushRecentEvent(enrichedEvent);
this.emit('event', enrichedEvent);
```

Keep the existing de-dupe key computed from the raw event before enrichment.

- [ ] **Step 5: Run focused service tests**

Run:

```bash
npx vitest run lib/bidking-live-monitor.test.mjs server.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/bidking-live-monitor.js lib/bidking-live-monitor.test.mjs server.test.mjs
git commit -m "feat: emit monitor facts and state"
```

## Task 5: Add Ethan Monitor Adapter

**Files:**
- Create: `src/ethan/monitor-adapter.js`
- Create: `src/ethan/monitor-adapter.test.js`

- [ ] **Step 1: Write failing adapter tests**

Create `src/ethan/monitor-adapter.test.js`:

```js
import { describe, expect, it } from 'vitest';
import {
  getEthanMonitorAutoFills,
  getEthanMonitorGridState,
} from './monitor-adapter.js';

describe('Ethan monitor adapter', () => {
  it('maps canonical state group values into Ethan group fills', () => {
    expect(getEthanMonitorAutoFills({
      state: {
        groups: {
          wg: { totalCells: 36, averageCells: null, averagePrice: null },
          blue: { totalCells: 29, averageCells: null, averagePrice: null },
          purple: { totalCells: 12, averageCells: 2.8, averagePrice: null },
          orange: { totalCells: null, averageCells: null, averagePrice: 30472 },
          red: { totalCells: null, averageCells: null, averagePrice: null },
        },
      },
    })).toEqual([
      { groupKey: 'wg', fieldKey: 'cells', value: '36' },
      { groupKey: 'blue', fieldKey: 'cells', value: '29' },
      { groupKey: 'purple', fieldKey: 'avg', value: '2.8' },
      { groupKey: 'purple', fieldKey: 'cells', value: '12' },
      { groupKey: 'orange', fieldKey: 'priceAverage', value: '30472' },
    ]);
  });

  it('uses canonical state as the Ethan grid state when available', () => {
    const state = { gameUid: 'game-1', outlines: [{ cells: [1] }], minimumOccupied: { minTotalCells: 1 } };
    expect(getEthanMonitorGridState({ state })).toBe(state);
  });

  it('returns no fills for raw-only payloads', () => {
    expect(getEthanMonitorAutoFills({ key: 'skill:1', skill: { skillCid: 1002081 } })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/ethan/monitor-adapter.test.js
```

Expected: FAIL because `src/ethan/monitor-adapter.js` does not exist.

- [ ] **Step 3: Implement `src/ethan/monitor-adapter.js`**

Create:

```js
const GROUP_FIELD_MAP = [
  ['totalCells', 'cells'],
  ['averageCells', 'avg'],
  ['averagePrice', 'priceAverage'],
];

export function getEthanMonitorAutoFills(payload) {
  const groups = payload?.state?.groups;
  if (!groups) return [];
  const fills = [];
  for (const [groupKey, groupState] of Object.entries(groups)) {
    for (const [stateKey, fieldKey] of GROUP_FIELD_MAP) {
      const value = groupState?.[stateKey];
      if (value === null || value === undefined || value === '') continue;
      fills.push({ groupKey, fieldKey, value: formatMonitorInputNumber(value) });
    }
  }
  return fills;
}

export function getEthanMonitorGridState(payload) {
  return payload?.state ?? null;
}

function formatMonitorInputNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  if (Number.isInteger(number)) return String(number);
  return String(Number(number.toFixed(4)));
}
```

- [ ] **Step 4: Run adapter tests**

Run:

```bash
npx vitest run src/ethan/monitor-adapter.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ethan/monitor-adapter.js src/ethan/monitor-adapter.test.js
git commit -m "feat: add ethan monitor adapter"
```

## Task 6: Migrate Ethan To Facts/State Payloads

**Files:**
- Modify: `src/ethan/App.vue`
- Modify: `src/ethan/App.test.js`

- [ ] **Step 1: Write failing Ethan component test**

Add or update an Ethan monitor test so it dispatches an enriched SSE payload:

```js
monitorSource.dispatch('event', {
  data: JSON.stringify({
    key: 'skill:blue-scan',
    gameUid: 'game-1',
    rawEvent: {
      key: 'skill:blue-scan',
      gameUid: 'game-1',
      skill: { uid: 'blue-scan', itemName: '良品扫描', totalHitBoxIndex: 29 },
    },
    facts: [{ type: 'group.totalCellsKnown', group: 'blue', value: 29 }],
    state: {
      gameUid: 'game-1',
      round: 2,
      groups: {
        wg: { totalCells: null, averageCells: null, averagePrice: null },
        blue: { totalCells: 29, averageCells: null, averagePrice: null },
        purple: { totalCells: null, averageCells: 2.8, averagePrice: null },
        orange: { totalCells: null, averageCells: null, averagePrice: 30472 },
        red: { totalCells: null, averageCells: null, averagePrice: null },
      },
      outlines: [{ boxId: 1, cells: [1], width: 1, height: 1, label: '1x1' }],
      qualityCells: [],
      revealedTypes: ['家居日用'],
      minimumOccupied: { minTotalCells: 1 },
      warnings: [],
    },
  }),
});
```

Assert:

```js
expect(wrapper.find('#cells-blue').element.value).toBe('29');
expect(wrapper.find('#avg-purple').element.value).toBe('2.8');
expect(wrapper.find('#price-orange').element.value).toBe('30472');
expect(wrapper.text()).toContain('家居日用');
```

- [ ] **Step 2: Run Ethan tests to verify failure**

Run:

```bash
npx vitest run src/ethan/App.test.js src/ethan/monitor-adapter.test.js
```

Expected: FAIL because Ethan does not yet use the adapter/state payload.

- [ ] **Step 3: Update Ethan imports**

In `src/ethan/App.vue`, add:

```js
import {
  getEthanMonitorAutoFills,
  getEthanMonitorGridState,
} from './monitor-adapter.js';
```

Remove `knownMapAggregateSkillFills`, `getMonitorAggregateFill`, `getKnownMapAggregateFill`, `getMonitorAggregateGroupKey`, and `applyMonitorAggregateFill` after the new adapter path passes equivalent tests.

- [ ] **Step 4: Update SSE event handling**

Replace the `event` listener body in `connectMonitorStream()` with:

```js
const payload = parseMonitorStreamPayload(message);
if (payload) {
  handleMonitorGameChange(payload.gameUid ?? payload.rawEvent?.gameUid);
  const adaptedGridState = getEthanMonitorGridState(payload);
  if (adaptedGridState) {
    monitorGridState.value = adaptedGridState;
  } else {
    monitorGridState.value = applyMonitorEventToGridState(monitorGridState.value, payload.rawEvent ?? payload);
  }
  for (const fill of getEthanMonitorAutoFills(payload)) {
    applyAutoGroupInput(fill);
  }
}
```

Keep the raw fallback until all monitor producers send enriched payloads.

- [ ] **Step 5: Run Ethan tests**

Run:

```bash
npx vitest run src/ethan/App.test.js src/ethan/monitor-adapter.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ethan/App.vue src/ethan/App.test.js src/ethan/monitor-adapter.js src/ethan/monitor-adapter.test.js
git commit -m "refactor: consume monitor state in ethan"
```

## Task 7: Update Monitor Page For Enriched Payloads

**Files:**
- Modify: `src/monitor/App.vue`
- Modify: `src/monitor/App.test.js`

- [ ] **Step 1: Write failing Monitor page test**

Add a Monitor component assertion that dispatches an enriched payload:

```js
source.dispatch('event', {
  data: JSON.stringify({
    key: 'skill:1',
    gameUid: 'game-1',
    rawEvent: { key: 'skill:1', skill: { skillCid: 1002081 } },
    facts: [{ type: 'item.outlineRevealed', cells: [1], width: 1, height: 1 }],
    state: { gameUid: 'game-1', outlines: [{ cells: [1] }] },
  }),
});
```

Assert that the page text contains:

```js
expect(wrapper.text()).toContain('item.outlineRevealed');
expect(wrapper.text()).toContain('game-1');
```

- [ ] **Step 2: Run Monitor test to verify failure**

Run:

```bash
npx vitest run src/monitor/App.test.js
```

Expected: FAIL if the page does not surface facts/state.

- [ ] **Step 3: Update Monitor display helpers**

In `src/monitor/App.vue`, add small computed/display helpers:

```js
function getEventFacts(event) {
  return Array.isArray(event?.facts) ? event.facts : [];
}

function getEventState(event) {
  return event?.state ?? null;
}
```

Render a compact facts section for the selected event:

```vue
<section v-if="getEventFacts(selectedEvent).length" class="event-section">
  <h3>Facts</h3>
  <pre>{{ JSON.stringify(getEventFacts(selectedEvent), null, 2) }}</pre>
</section>
<section v-if="getEventState(selectedEvent)" class="event-section">
  <h3>State</h3>
  <pre>{{ JSON.stringify(getEventState(selectedEvent), null, 2) }}</pre>
</section>
```

Keep the existing raw event display.

- [ ] **Step 4: Run Monitor tests**

Run:

```bash
npx vitest run src/monitor/App.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/monitor/App.vue src/monitor/App.test.js
git commit -m "feat: show monitor facts and state"
```

## Task 8: Update Protocol Docs

**Files:**
- Modify: `docs/BIDKING_REALTIME_PROTOCOL_SCHEMA.md`
- Modify: `docs/bidking-realtime-protocol-schema.json`
- Modify: `docs/BIDKING_SKILL_PARSE_SUPPORT.md`
- Modify: `docs/Documentation.md`

- [ ] **Step 1: Document enriched monitor payload**

Add this payload shape to `docs/BIDKING_REALTIME_PROTOCOL_SCHEMA.md`:

```json
{
  "key": "skill:...",
  "gameUid": "2301:...",
  "skill": {},
  "rawEvent": {},
  "facts": [
    {
      "type": "group.totalCellsKnown",
      "group": "blue",
      "value": 29,
      "source": {}
    }
  ],
  "state": {
    "gameUid": "2301:...",
    "groups": {},
    "outlines": [],
    "qualityCells": [],
    "exactItems": [],
    "revealedTypes": [],
    "minimumOccupied": null
  }
}
```

- [ ] **Step 2: Update JSON schema**

In `docs/bidking-realtime-protocol-schema.json`, add optional top-level properties to the event schema:

```json
"rawEvent": { "type": "object" },
"facts": {
  "type": "array",
  "items": { "type": "object" }
},
"state": { "type": "object" }
```

- [ ] **Step 3: Update skill support doc**

In `docs/BIDKING_SKILL_PARSE_SUPPORT.md`, add a section named `归一化 facts 层` with:

```markdown
## 归一化 facts 层

- `group.totalCellsKnown`：品质总格数，例如良品扫描、优品扫描、极品扫描、珍品扫描。
- `group.averageCellsKnown`：品质平均格数，例如良品均格、优品均格、极品均格、珍品均格。
- `group.averagePriceKnown`：品质平均价格，例如优品均价、极品均价、珍品均价。
- `item.outlineRevealed`：藏品轮廓，包含格子、宽高、可选品质、可选具体藏品。
- `item.qualityCellsRevealed`：单格品质揭露。
- `item.exactRevealed`：具体藏品揭露，包含价格时可直接用于精确估值。
- `type.revealed`：本局涉及的藏品类型揭露。
```

- [ ] **Step 4: Update project status**

Append to `docs/Documentation.md`:

```markdown
- Monitor facts 架构实现后，live monitor SSE payload 兼容旧 raw event 结构，同时新增 `rawEvent`、`facts`、`state`；Ethan 已通过 adapter 消费 canonical state，Monitor 页面可展示 facts/state 调试信息。
```

- [ ] **Step 5: Commit**

```bash
git add docs/BIDKING_REALTIME_PROTOCOL_SCHEMA.md docs/bidking-realtime-protocol-schema.json docs/BIDKING_SKILL_PARSE_SUPPORT.md docs/Documentation.md
git commit -m "docs: document monitor facts payload"
```

## Task 9: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npx vitest run lib/bidking-monitor-facts.test.mjs lib/bidking-monitor-store.test.mjs lib/bidking-live-monitor.test.mjs src/ethan/monitor-grid.test.js src/ethan/monitor-adapter.test.js src/ethan/App.test.js src/monitor/App.test.js server.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run page builds**

Run:

```bash
npm run build:pages
```

Expected: PASS.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Commit verification-only documentation update if needed**

If `docs/Documentation.md` does not yet include the exact verification commands and results, append one bullet with the commands from Steps 1-4 and commit:

```bash
git add docs/Documentation.md
git commit -m "docs: record monitor facts verification"
```

If `docs/Documentation.md` already contains the verification results, do not create an empty commit.

## Self-Review

- Spec coverage:
  - Raw parser remains raw and lossless: covered by Task 4 preserving top-level raw event fields and `rawEvent`.
  - Facts engine owns protocol mappings: covered by Task 2.
  - Canonical monitor state: covered by Task 3 and Task 4.
  - UI consumes facts/state through adapters: covered by Task 5 and Task 6.
  - Monitor debug visibility: covered by Task 7.
  - Docs and schema: covered by Task 8.
- Placeholder scan:
  - The plan has no unresolved markers or unspecified implementation steps.
- Type consistency:
  - Facts use `group.totalCellsKnown`, `group.averageCellsKnown`, `group.averagePriceKnown`, `item.outlineRevealed`, `item.qualityCellsRevealed`, `item.exactRevealed`, and `type.revealed` consistently.
  - State uses `groups.{group}.totalCells`, `averageCells`, and `averagePrice` consistently.
  - SSE enriched payload uses top-level raw-compatible fields plus `rawEvent`, `facts`, and `state`.
