# Exchange Item Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested AutoOperation `ExchangeItem` command and Inject-page controls that list a collectible on the exchange using name/CID, count, and unit price.

**Architecture:** The renderer maps a selected collectible candidate to `itemCid`; the Agent receives numeric args, computes `totalPrice`, calls `PlayerManager.ExchangeItem`, waits for `Task<bool>`, and returns a structured result. The collectible catalog gains `itemCid` so candidate selection is deterministic.

**Tech Stack:** Vue 3, Vitest, Electron preload IPC, C++ IL2CPP AutoOperation Agent, existing base64 table extractor.

---

### Task 1: Add Item CID To Collectible Catalog

**Files:**
- Modify: `scripts/extract-bidking-collectibles.js`
- Create: `scripts/extract-bidking-collectibles.test.js`
- Regenerate: `collectibles.json`
- Regenerate: `public/data/collectibles.json`

- [ ] Write tests proving extracted collectibles include numeric `itemCid`.
- [ ] Run the new extractor test and verify it fails before implementation.
- [ ] Add `itemCid: Number(id)` to `itemRowToCollectible`.
- [ ] Regenerate catalog JSON.
- [ ] Re-run the extractor test and verify it passes.

### Task 2: Add Agent ExchangeItem Command

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`
- Rebuild: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll`
- Modify: `docs/AUTO_OPERATION_COMMANDS.md`

- [ ] Add helpers for validating positive ints, computing int32-safe `totalPrice`, waiting for `Task<bool>`, and unboxing bool.
- [ ] Add `CmdExchangeItem` that parses `itemCid`/`itemId`, `count`, `unitPrice`, and optional `timeoutMs`.
- [ ] Register `ExchangeItem` in the Agent command table.
- [ ] Build the Agent DLL.
- [ ] Inject into BidKing and verify a dry invalid-input call returns a structured error without crashing.

### Task 3: Add Inject UI Candidate Input

**Files:**
- Modify: `src/inject/App.vue`
- Modify: `src/inject/App.test.js`
- Modify: `src/shared/messages.js`

- [ ] Add tests for loading candidates, selecting by name, direct CID entry, and sending `ExchangeItem`.
- [ ] Run Inject tests and verify the new tests fail before implementation.
- [ ] Load `/data/collectibles.json`, filter candidates by name/type/quality/CID, and store the selected item.
- [ ] Add fields for item, count, and unit price with validation.
- [ ] Send `runAutoOperationCommand('ExchangeItem', { itemCid, count, unitPrice })`.
- [ ] Re-run Inject tests and verify they pass.

### Task 4: Verify And Commit

**Files:**
- All modified files from Tasks 1-3.

- [ ] Run `git diff --check`.
- [ ] Run focused Vitest files.
- [ ] Run `bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh`.
- [ ] Verify Agent command against live BidKing when available.
- [ ] Commit the completed implementation.
