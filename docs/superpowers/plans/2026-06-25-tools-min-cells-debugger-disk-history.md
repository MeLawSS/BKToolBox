# Tools Minimum Cells Debugger Disk History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every completed Tools V2 minimum-cells debugger calculation to an append-only NDJSON file under `Documents/BKToolBox/min-cells-debugger-history/history.ndjson`, while keeping current `localStorage` history behavior unchanged.

**Architecture:** Add a focused CommonJS store that validates debugger history entries and appends normalized records to disk. Wire that store into `server.js#createApp()` with dependency injection and expose a `POST /api/tools/min-cells-debugger/history` endpoint. Update the debugger composable to fire a background POST after local history succeeds and surface disk-write errors via a separate `diskPersistenceError` state.

**Tech Stack:** Node.js CommonJS modules, Express routes, Vue 3 composition API, Vitest, Supertest, `@vue/test-utils`, filesystem temp directories.

---

## File Map

- Create `lib/bidking-min-cells-debugger-history-store.js`: disk history store, entry normalization, mirrored debugger grid constants, NDJSON append.
- Create `lib/bidking-min-cells-debugger-history-store.test.mjs`: store unit tests for valid writes, multiple appends, validation rejection, and grid constant drift.
- Modify `server.js`: import the new store, instantiate it in `createApp(deps)`, and add `POST /api/tools/min-cells-debugger/history`.
- Modify `server.test.mjs`: inject fake stores and test success, bad payload, and write failure route behavior.
- Modify `src/elsa/useMinimumCellsDebugger.js`: add `diskPersistenceError`, background POST, stale error clearing, and expose the new state.
- Modify `src/elsa/ToolsMinimumCellsDebuggerPanel.vue`: render disk persistence errors separately from local storage errors.
- Modify `src/shared/messages.js`: add localized disk persistence error copy in Chinese and English.
- Modify `src/elsa/App.test.js`: assert the frontend POST, error behavior, and preservation of local result/history.

---

### Task 1: Disk History Store

**Files:**
- Create: `lib/bidking-min-cells-debugger-history-store.js`
- Create: `lib/bidking-min-cells-debugger-history-store.test.mjs`

- [ ] **Step 1: Write the failing store tests**

Create `lib/bidking-min-cells-debugger-history-store.test.mjs` with:

```javascript
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  DEBUGGER_GRID_ROWS,
  DEBUGGER_GRID_COLUMNS,
} from '../src/elsa/minimum-cells-debugger.js';

const require = createRequire(import.meta.url);
const {
  MinCellsDebuggerHistoryStore,
  normalizeMinCellsDebuggerHistoryEntry,
  DEBUGGER_HISTORY_GRID_ROWS,
  DEBUGGER_HISTORY_GRID_COLUMNS,
} = require('./bidking-min-cells-debugger-history-store.js');

function createValidEntry(overrides = {}) {
  return {
    id: 'hist-test-1',
    createdAt: '2026-06-25T06:00:00.000Z',
    version: 1,
    grid: { rows: 43, columns: 10 },
    outlines: [
      { boxId: 12, width: 2, height: 3, cells: [12, 13, 22, 23, 32, 33] },
    ],
    result: {
      valid: true,
      minTotalCells: 19,
      knownOutlineCellCount: 6,
      unknownBlockingCellCount: 5,
      unknownBlockingCells: [41, 42],
      order: [12],
      holeCells: [],
    },
    summary: '1 / 6 / 19',
    ...overrides,
  };
}

async function withTempStore(testFn) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'min-cells-debugger-history-'));
  try {
    const store = new MinCellsDebuggerHistoryStore({
      rootDir,
      now: () => new Date('2026-06-25T06:00:01.234Z'),
    });
    await testFn(store, rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

describe('MinCellsDebuggerHistoryStore', () => {
  it('keeps mirrored grid constants aligned with the frontend debugger grid', () => {
    expect(DEBUGGER_HISTORY_GRID_ROWS).toBe(DEBUGGER_GRID_ROWS);
    expect(DEBUGGER_HISTORY_GRID_COLUMNS).toBe(DEBUGGER_GRID_COLUMNS);
  });

  it('normalizes a valid debugger history entry with savedAt and source', () => {
    const normalized = normalizeMinCellsDebuggerHistoryEntry(
      createValidEntry(),
      { savedAt: '2026-06-25T06:00:01.234Z' },
    );

    expect(normalized).toMatchObject({
      id: 'hist-test-1',
      version: 1,
      grid: { rows: 43, columns: 10 },
      savedAt: '2026-06-25T06:00:01.234Z',
      source: 'tools-min-cells-debugger',
    });
    expect(normalized.outlines[0].cells).toEqual([12, 13, 22, 23, 32, 33]);
  });

  it('appends one JSON line for a valid entry', async () => {
    await withTempStore(async (store) => {
      const result = store.recordEntry(createValidEntry());

      expect(result).toMatchObject({
        written: true,
        savedAt: '2026-06-25T06:00:01.234Z',
      });
      expect(result.outputPath.endsWith(path.join('min-cells-debugger-history', 'history.ndjson'))).toBe(true);

      const text = await readFile(result.outputPath, 'utf8');
      const lines = text.trim().split('\n');
      expect(lines).toHaveLength(1);

      const row = JSON.parse(lines[0]);
      expect(row.id).toBe('hist-test-1');
      expect(row.savedAt).toBe('2026-06-25T06:00:01.234Z');
      expect(row.source).toBe('tools-min-cells-debugger');
    });
  });

  it('appends multiple entries without rewriting previous rows', async () => {
    await withTempStore(async (store) => {
      const first = store.recordEntry(createValidEntry({ id: 'hist-test-1' }));
      store.recordEntry(createValidEntry({ id: 'hist-test-2' }));

      const text = await readFile(first.outputPath, 'utf8');
      const rows = text.trim().split('\n').map((line) => JSON.parse(line));
      expect(rows.map((row) => row.id)).toEqual(['hist-test-1', 'hist-test-2']);
    });
  });

  it('rejects malformed entries without writing a row', async () => {
    await withTempStore(async (store, rootDir) => {
      expect(() => store.recordEntry(createValidEntry({
        grid: { rows: 42, columns: 10 },
      }))).toThrow('Invalid minimum cells debugger history entry');

      await expect(readFile(path.join(rootDir, 'min-cells-debugger-history', 'history.ndjson'), 'utf8'))
        .rejects
        .toMatchObject({ code: 'ENOENT' });
    });
  });
});
```

- [ ] **Step 2: Run the store tests and confirm they fail**

Run:

```bash
npx vitest run lib/bidking-min-cells-debugger-history-store.test.mjs
```

Expected: FAIL because `lib/bidking-min-cells-debugger-history-store.js` does not exist.

- [ ] **Step 3: Implement the store**

Create `lib/bidking-min-cells-debugger-history-store.js`:

```javascript
const fs = require('fs');
const path = require('path');
const { getDocumentsDir } = require('../runtime-paths');

const DEBUGGER_HISTORY_DIR = path.join('BKToolBox', 'min-cells-debugger-history');
const DEBUGGER_HISTORY_FILE = 'history.ndjson';
const DEBUGGER_HISTORY_SOURCE = 'tools-min-cells-debugger';

// Mirrors src/elsa/minimum-cells-debugger.js. Keep the test in sync with frontend constants.
const DEBUGGER_HISTORY_GRID_ROWS = 43;
const DEBUGGER_HISTORY_GRID_COLUMNS = 10;

class MinCellsDebuggerHistoryStore {
  constructor({ rootDir, now = () => new Date() } = {}) {
    this.rootDir = rootDir || path.join(getDocumentsDir(), DEBUGGER_HISTORY_DIR);
    this.now = now;
    this.historyPath = path.join(this.rootDir, DEBUGGER_HISTORY_FILE);
  }

  recordEntry(entry) {
    const savedAt = this.now().toISOString();
    const normalized = normalizeMinCellsDebuggerHistoryEntry(entry, { savedAt });
    if (!normalized) {
      throw new Error('Invalid minimum cells debugger history entry');
    }

    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.appendFileSync(this.historyPath, `${JSON.stringify(normalized)}\n`, 'utf8');

    return {
      written: true,
      savedAt,
      outputPath: this.historyPath,
    };
  }
}

function normalizeMinCellsDebuggerHistoryEntry(entry, { savedAt = new Date().toISOString() } = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (typeof entry.id !== 'string' || entry.id.trim() === '') return null;
  if (!isValidIsoDate(entry.createdAt)) return null;
  if (entry.version !== 1) return null;
  if (entry.grid?.rows !== DEBUGGER_HISTORY_GRID_ROWS) return null;
  if (entry.grid?.columns !== DEBUGGER_HISTORY_GRID_COLUMNS) return null;
  if (!Array.isArray(entry.outlines)) return null;
  if (!entry.outlines.every(isValidOutline)) return null;
  if (entry.result !== null && (!entry.result || typeof entry.result !== 'object' || Array.isArray(entry.result))) return null;
  if (typeof entry.summary !== 'string') return null;
  if (!isValidIsoDate(savedAt)) return null;

  return {
    id: entry.id,
    createdAt: new Date(entry.createdAt).toISOString(),
    version: 1,
    grid: {
      rows: DEBUGGER_HISTORY_GRID_ROWS,
      columns: DEBUGGER_HISTORY_GRID_COLUMNS,
    },
    outlines: entry.outlines.map((outline) => ({
      boxId: outline.boxId,
      width: outline.width,
      height: outline.height,
      cells: [...outline.cells],
    })),
    result: entry.result === null ? null : { ...entry.result },
    summary: entry.summary,
    savedAt: new Date(savedAt).toISOString(),
    source: DEBUGGER_HISTORY_SOURCE,
  };
}

function isValidOutline(outline) {
  return outline &&
    typeof outline === 'object' &&
    !Array.isArray(outline) &&
    Number.isFinite(outline.boxId) &&
    Number.isFinite(outline.width) &&
    Number.isFinite(outline.height) &&
    Array.isArray(outline.cells) &&
    outline.cells.every((cell) => Number.isFinite(cell));
}

function isValidIsoDate(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

module.exports = {
  MinCellsDebuggerHistoryStore,
  normalizeMinCellsDebuggerHistoryEntry,
  DEBUGGER_HISTORY_GRID_ROWS,
  DEBUGGER_HISTORY_GRID_COLUMNS,
};
```

- [ ] **Step 4: Run the store tests and confirm they pass**

Run:

```bash
npx vitest run lib/bidking-min-cells-debugger-history-store.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the store**

Run:

```bash
git add lib/bidking-min-cells-debugger-history-store.js lib/bidking-min-cells-debugger-history-store.test.mjs
git commit -m "feat: add min cells debugger disk history store"
```

---

### Task 2: Server API Route

**Files:**
- Modify: `server.js`
- Modify: `server.test.mjs`

- [ ] **Step 1: Write failing server route tests**

In `server.test.mjs`, add this fake store near the existing fake store classes:

```javascript
class FakeMinCellsDebuggerHistoryStore {
  constructor() {
    this.result = {
      written: true,
      savedAt: '2026-06-25T06:00:01.234Z',
      outputPath: 'C:\\Users\\alice\\Documents\\BKToolBox\\min-cells-debugger-history\\history.ndjson',
    };
    this.recordEntry = vi.fn(() => this.result);
  }
}
```

Add this helper near the other test helpers:

```javascript
function createValidDebuggerHistoryEntry(overrides = {}) {
  return {
    id: 'hist-test-route',
    createdAt: '2026-06-25T06:00:00.000Z',
    version: 1,
    grid: { rows: 43, columns: 10 },
    outlines: [
      { boxId: 12, width: 2, height: 3, cells: [12, 13, 22, 23, 32, 33] },
    ],
    result: {
      valid: true,
      minTotalCells: 19,
      knownOutlineCellCount: 6,
      unknownBlockingCellCount: 5,
      unknownBlockingCells: [41, 42],
      order: [12],
      holeCells: [],
    },
    summary: '1 / 6 / 19',
    ...overrides,
  };
}
```

Add these tests inside `describe('server routes', ...)`:

```javascript
it('persists minimum cells debugger history through the tools API', async () => {
  const minCellsDebuggerHistoryStore = new FakeMinCellsDebuggerHistoryStore();
  const app = createApp({
    spawn: vi.fn(),
    minCellsDebuggerHistoryStore,
    logServerEvent: () => {},
  });

  const entry = createValidDebuggerHistoryEntry();
  const response = await request(app)
    .post('/api/tools/min-cells-debugger/history')
    .send({ entry })
    .expect(200);

  expect(response.body).toEqual({
    ok: true,
    savedAt: '2026-06-25T06:00:01.234Z',
    outputPath: 'C:\\Users\\alice\\Documents\\BKToolBox\\min-cells-debugger-history\\history.ndjson',
  });
  expect(minCellsDebuggerHistoryStore.recordEntry).toHaveBeenCalledWith(entry);
});

it('rejects invalid minimum cells debugger history payloads', async () => {
  const minCellsDebuggerHistoryStore = new FakeMinCellsDebuggerHistoryStore();
  minCellsDebuggerHistoryStore.recordEntry.mockImplementation(() => {
    throw new Error('Invalid minimum cells debugger history entry');
  });
  const app = createApp({
    spawn: vi.fn(),
    minCellsDebuggerHistoryStore,
    logServerEvent: () => {},
  });

  const response = await request(app)
    .post('/api/tools/min-cells-debugger/history')
    .send({ entry: createValidDebuggerHistoryEntry({ id: '' }) })
    .expect(400);

  expect(response.body.error).toBe('Invalid minimum cells debugger history entry');
});

it('reports minimum cells debugger history disk write failures', async () => {
  const minCellsDebuggerHistoryStore = new FakeMinCellsDebuggerHistoryStore();
  minCellsDebuggerHistoryStore.recordEntry.mockImplementation(() => {
    throw new Error('disk full');
  });
  const app = createApp({
    spawn: vi.fn(),
    minCellsDebuggerHistoryStore,
    logServerEvent: () => {},
  });

  const response = await request(app)
    .post('/api/tools/min-cells-debugger/history')
    .send({ entry: createValidDebuggerHistoryEntry() })
    .expect(500);

  expect(response.body.error).toBe('disk full');
});
```

- [ ] **Step 2: Run route tests and confirm they fail**

Run:

```bash
npx vitest run server.test.mjs --testNamePattern "minimum cells debugger history"
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Wire the store and route**

Modify the imports at the top of `server.js`:

```javascript
const { MinCellsDebuggerHistoryStore } = require('./lib/bidking-min-cells-debugger-history-store');
```

Inside `createApp(deps = {})`, after `marketLadderStore`:

```javascript
const minCellsDebuggerHistoryStore = deps.minCellsDebuggerHistoryStore || new MinCellsDebuggerHistoryStore();
```

Add the route near the other JSON API routes, after the price-history routes or before capture-driver routes:

```javascript
app.post('/api/tools/min-cells-debugger/history', (req, res) => {
    try {
        const result = minCellsDebuggerHistoryStore.recordEntry(req.body?.entry);
        res.json({
            ok: true,
            savedAt: result.savedAt,
            outputPath: result.outputPath
        });
    } catch (error) {
        const status = error?.message === 'Invalid minimum cells debugger history entry' ? 400 : 500;
        res.status(status).json({ error: error.message });
    }
});
```

- [ ] **Step 4: Run route tests and confirm they pass**

Run:

```bash
npx vitest run server.test.mjs --testNamePattern "minimum cells debugger history"
```

Expected: PASS.

- [ ] **Step 5: Commit the route**

Run:

```bash
git add server.js server.test.mjs
git commit -m "feat: add min cells debugger history API"
```

---

### Task 3: Frontend Disk Persistence

**Files:**
- Modify: `src/elsa/useMinimumCellsDebugger.js`
- Modify: `src/elsa/ToolsMinimumCellsDebuggerPanel.vue`
- Modify: `src/shared/messages.js`
- Modify: `src/elsa/App.test.js`

- [ ] **Step 1: Write failing frontend tests for successful disk POST**

In `src/elsa/App.test.js`, inside `describe('minimum cells debugger tab', ...)`, add this test:

```javascript
it('posts completed debugger calculations to disk history after local persistence', async () => {
  const fetchMock = vi.fn(async (url) => {
    if (String(url) === '/api/tools/min-cells-debugger/history') {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          savedAt: '2026-06-25T06:00:01.234Z',
          outputPath: 'C:\\Users\\alice\\Documents\\BKToolBox\\min-cells-debugger-history\\history.ndjson',
        }),
      };
    }
    if (String(url) === '/api/bidking-monitor/status') {
      return { ok: true, json: async () => ({ state: 'idle', running: false, totalEvents: 0, lastError: null }) };
    }
    return {
      ok: true,
      json: async () => String(url).includes('/data/collectibles.json') ? realCollectibles : realAveragePrices,
    };
  });
  vi.stubGlobal('fetch', fetchMock);

  const wrapper = mountDebuggerApp();
  mountedWrappers.push(wrapper);
  const tabButtons = wrapper.findAll('.tab-button').filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
  await tabButtons[0].trigger('click');
  await nextTick();

  const panel = wrapper.findComponent({ name: 'ToolsMinimumCellsDebuggerPanel' });
  panel.vm.addOutlineFromDrag(0, 0, 1, 1);
  await nextTick();

  await wrapper.find('.debugger-actions .action-button').trigger('click');
  await nextTick();
  await flushPromises();

  const raw = localStorage.getItem(DEBUGGER_HISTORY_KEY);
  expect(raw).toBeTruthy();
  const history = JSON.parse(raw);
  expect(history).toHaveLength(1);

  const historyPost = fetchMock.mock.calls.find(([url]) => url === '/api/tools/min-cells-debugger/history');
  expect(historyPost).toBeTruthy();
  expect(historyPost[1]).toMatchObject({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  expect(JSON.parse(historyPost[1].body).entry).toMatchObject({
    id: history[0].id,
    grid: { rows: 43, columns: 10 },
    outlines: history[0].outlines,
  });
});
```

- [ ] **Step 2: Run the frontend success test and confirm it fails**

Run:

```bash
npx vitest run src/elsa/App.test.js --testNamePattern "posts completed debugger calculations"
```

Expected: FAIL because no disk-history POST occurs.

- [ ] **Step 3: Write failing frontend test for disk failure behavior**

Add this test in the same describe block:

```javascript
it('keeps local result and history when disk history persistence fails', async () => {
  const fetchMock = vi.fn(async (url) => {
    if (String(url) === '/api/tools/min-cells-debugger/history') {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'disk full' }),
      };
    }
    if (String(url) === '/api/bidking-monitor/status') {
      return { ok: true, json: async () => ({ state: 'idle', running: false, totalEvents: 0, lastError: null }) };
    }
    return {
      ok: true,
      json: async () => String(url).includes('/data/collectibles.json') ? realCollectibles : realAveragePrices,
    };
  });
  vi.stubGlobal('fetch', fetchMock);

  const wrapper = mountDebuggerApp();
  mountedWrappers.push(wrapper);
  const tabButtons = wrapper.findAll('.tab-button').filter((btn) => btn.text().includes('Min Cells') || btn.text().includes('最小格数'));
  await tabButtons[0].trigger('click');
  await nextTick();

  const panel = wrapper.findComponent({ name: 'ToolsMinimumCellsDebuggerPanel' });
  panel.vm.addOutlineFromDrag(0, 0, 1, 1);
  await nextTick();

  await wrapper.find('.debugger-actions .action-button').trigger('click');
  await nextTick();
  await flushPromises();
  await nextTick();

  expect(wrapper.find('.debugger-result').exists()).toBe(true);
  expect(JSON.parse(localStorage.getItem(DEBUGGER_HISTORY_KEY))).toHaveLength(1);
  expect(wrapper.find('.debugger-storage-error').exists()).toBe(false);
  expect(wrapper.find('.debugger-disk-error').text()).toContain('文件');
});
```

- [ ] **Step 4: Run the frontend failure test and confirm it fails**

Run:

```bash
npx vitest run src/elsa/App.test.js --testNamePattern "keeps local result and history when disk history persistence fails"
```

Expected: FAIL because `diskPersistenceError` and `.debugger-disk-error` do not exist.

- [ ] **Step 5: Implement frontend disk persistence state and POST**

Modify `src/elsa/useMinimumCellsDebugger.js`:

```javascript
const diskPersistenceError = ref('');
```

In `calculate()`, after `saveHistoryEntry(entry);`, add:

```javascript
persistHistoryEntryToDisk(entry);
```

Add this function near the history persistence helpers:

```javascript
function persistHistoryEntryToDisk(entry) {
  if (typeof fetch !== 'function') return;

  fetch('/api/tools/min-cells-debugger/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry }),
  })
    .then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      diskPersistenceError.value = '';
    })
    .catch(() => {
      diskPersistenceError.value = 'tools.debugger.diskPersistenceError';
    });
}
```

Update `clearMatrix()` and `restoreHistoryEntry()` to set:

```javascript
diskPersistenceError.value = '';
```

Return `diskPersistenceError` from the composable.

- [ ] **Step 6: Render the disk persistence error and add messages**

Modify the destructuring in `src/elsa/ToolsMinimumCellsDebuggerPanel.vue` to include:

```javascript
diskPersistenceError,
```

Render below the existing storage error:

```vue
<p v-if="diskPersistenceError" class="debugger-disk-error">{{ t(diskPersistenceError) }}</p>
```

Update the CSS selector so the disk error shares the same visual language as storage errors:

```css
.debugger-storage-error,
.debugger-disk-error {
  margin: 0;
  padding: 6px 10px;
  background: var(--surface-2);
  border: 1px solid var(--danger);
  border-radius: 4px;
  font-size: 13px;
  color: var(--danger);
}
```

In `src/shared/messages.js`, add Chinese text beside the existing debugger `storageError`:

```javascript
diskPersistenceError: '文件历史记录落盘失败，本地历史和当前结果仍有效。',
```

Add English text beside the English debugger `storageError`:

```javascript
diskPersistenceError: 'Failed to persist file history. Local history and the current result remain valid.',
```

- [ ] **Step 7: Run frontend tests and confirm they pass**

Run:

```bash
npx vitest run src/elsa/App.test.js --testNamePattern "minimum cells debugger tab"
```

Expected: PASS.

- [ ] **Step 8: Commit frontend persistence**

Run:

```bash
git add src/elsa/useMinimumCellsDebugger.js src/elsa/ToolsMinimumCellsDebuggerPanel.vue src/shared/messages.js src/elsa/App.test.js
git commit -m "feat: persist debugger history to disk from Tools"
```

---

### Task 4: Full Verification

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run all focused tests**

Run:

```bash
npx vitest run lib/bidking-min-cells-debugger-history-store.test.mjs server.test.mjs src/elsa/App.test.js src/elsa/minimum-cells-debugger.test.js
```

Expected: PASS.

- [ ] **Step 2: Run the Elsa production build**

Run:

```bash
npm run build:elsa
```

Expected: PASS.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intentional files are modified. Existing unrelated untracked files under `tools/inject/AutoOperation/BKAutoOpAgent/` may remain and must not be deleted.

- [ ] **Step 4: Commit verification-only fixes if needed**

If any verification command fails, make the smallest correction required, re-run the failing command, and commit the fix with a focused message.

---

## Self-Review

- Spec coverage: The plan covers disk location, NDJSON format, server-side validation, `savedAt/source`, route behavior, DI wiring, synchronous `calculate()`, split error state, and all requested tests.
- Placeholder scan: No task uses TBD/TODO/fill-in instructions; code snippets contain concrete paths, APIs, and expected commands.
- Type consistency: Store class, normalization helper, route dependency name, endpoint path, `diskPersistenceError`, and message key are consistent across tasks.
