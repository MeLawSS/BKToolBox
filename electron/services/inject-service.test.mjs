/* @vitest-environment node */
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const service = await import('./inject-service.js');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const tempRoots = [];

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bidking-inject-service-'));
  tempRoots.push(root);
  return root;
}

async function advanceUnloadWaitTimers(ms) {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
  }
  await vi.advanceTimersByTimeAsync(ms);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.useRealTimers();
});


describe('inject-service AutoOperation Agent', () => {
  it('does not keep legacy SharpMonoInjector directories in tools/inject', () => {
    expect(fs.existsSync(path.join(projectRoot, 'tools', 'inject', 'SharpMonoInjector.Console'))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, 'tools', 'inject', 'SharpMonoInjector.Gui'))).toBe(false);
  });

  it('accepts AutoOperation frames larger than 64KB', async () => {
    class MockSocket extends EventEmitter {
      constructor() {
        super();
        this.writes = [];
      }

      setTimeout(_timeoutMs, _handler) {}

      write(chunk) {
        this.writes.push(Buffer.from(chunk));
        return true;
      }

      destroy() {}
    }

    const socket = new MockSocket();
    const net = {
      createConnection: vi.fn(() => {
        queueMicrotask(() => socket.emit('connect'));
        return socket;
      }),
    };
    const id = 'large-frame';
    const responsePromise = service.sendAutoOperationCommand('GetStockContainers', {}, {
      net,
      id,
      timeoutMs: 100,
    });

    await new Promise((resolve) => setImmediate(resolve));

    const frame = JSON.stringify({
      id,
      ok: true,
      result: {
        padding: 'x'.repeat(70000),
      },
    });
    const body = Buffer.from(frame, 'utf8');
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(body.length, 0);
    socket.emit('data', Buffer.concat([header, body]));

    await expect(responsePromise).resolves.toEqual(expect.objectContaining({
      id,
      ok: true,
      result: expect.objectContaining({
        padding: expect.any(String),
      }),
    }));
  });

  it('reuses a reachable AutoOperation Agent instead of injecting it again', async () => {
    const execFile = vi.fn();
    const sendAutoOperationCommand = vi.fn().mockResolvedValue({
      id: '1',
      ok: true,
      result: { pong: true },
    });

    const result = await service.startAutoOperationAgent({
      execFile,
      sendAutoOperationCommand,
    });

    expect(execFile).not.toHaveBeenCalled();
    expect(sendAutoOperationCommand).toHaveBeenCalledWith('Ping', {}, expect.any(Object));
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({ pong: true }),
      reused: true,
    }));
  });

  it('injects the AutoOperation Agent DLL and verifies it with Ping', async () => {
    const documentsDir = makeTempRoot();
    const execFile = vi.fn((_exe, _args, _opts, callback) => {
      callback(null, 'Injected', '');
    });
    const sendAutoOperationCommand = vi.fn()
      .mockRejectedValueOnce(new Error('connect ENOENT \\\\.\\pipe\\BKAutoOp'))
      .mockResolvedValueOnce({
        id: '1',
        ok: true,
        result: { pong: true },
      });

    const result = await service.startAutoOperationAgent({
      execFile,
      documentsDir,
      sendAutoOperationCommand,
    });

    expect(execFile).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining([
        '-DllPath',
        expect.stringContaining('BKAutoOpAgent.dll'),
        '-Command',
        'AutoOperationAgent',
      ]),
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(1, 'Ping', {}, expect.any(Object));
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(2, 'Ping', {}, expect.any(Object));
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      injection: expect.objectContaining({ output: 'Injected' }),
      value: expect.objectContaining({ pong: true }),
    }));
  });

  it('includes injector output when AutoOperation Agent ping fails after injection', async () => {
    const execFile = vi.fn((_exe, _args, _opts, callback) => {
      callback(null, 'Target: BidKing PID=123\nInjected', '');
    });
    const sendAutoOperationCommand = vi.fn().mockRejectedValue(new Error('connect ENOENT \\\\.\\pipe\\BKAutoOp'));

    await expect(service.startAutoOperationAgent({
      execFile,
      sendAutoOperationCommand,
      agentTimeoutMs: 1,
      agentPollIntervalMs: 1,
    })).rejects.toThrow('Injector output: Target: BidKing PID=123');
  });

  it('runs a generic AutoOperation command through the Agent pipe', async () => {
    const sendAutoOperationCommand = vi.fn().mockResolvedValue({
      id: '7',
      ok: true,
      result: { panel: 'TradingExchange_Main' },
    });

    const result = await service.runAutoOperationCommand('GetCurrentUI', {}, {
      sendAutoOperationCommand,
    });

    expect(sendAutoOperationCommand).toHaveBeenCalledWith('GetCurrentUI', {}, expect.any(Object));
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({ panel: 'TradingExchange_Main' }),
    }));
  });

  it('preserves MoveStockItem refresh metadata from the Agent pipe', async () => {
    const sendAutoOperationCommand = vi.fn().mockResolvedValue({
      id: '9',
      ok: true,
      result: {
        moved: true,
        stocksRefreshed: true,
        containers: [
          { stockId: 1, items: [] },
          { stockId: 2, items: [{ itemUid: 'boots-a', stockId: 2, pos: 5 }] },
        ],
      },
    });

    const result = await service.runAutoOperationCommand('MoveStockItem', {
      oldStockId: 1,
      oldSlot: 0,
      newStockId: 2,
      newSlot: 5,
      isRotate: false,
    }, {
      sendAutoOperationCommand,
    });

    expect(sendAutoOperationCommand).toHaveBeenCalledWith('MoveStockItem', {
      oldStockId: 1,
      oldSlot: 0,
      newStockId: 2,
      newSlot: 5,
      isRotate: false,
    }, expect.any(Object));
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({
        moved: true,
        stocksRefreshed: true,
        containers: expect.any(Array),
      }),
    }));
  });

  it('preserves MoveStockItem refresh flags from the Agent pipe response', async () => {
    const sendAutoOperationCommand = vi.fn().mockResolvedValue({
      id: '9',
      ok: true,
      result: {
        moved: true,
        stocksRefreshed: true,
        containers: [
          {
            stockId: 2,
            items: [
              { itemUid: '123456789', itemCid: 1032006, pos: 5 },
            ],
          },
        ],
      },
    });

    const result = await service.runAutoOperationCommand('MoveStockItem', {
      oldStockId: 1,
      oldSlot: 0,
      newStockId: 2,
      newSlot: 5,
      isRotate: false,
    }, {
      sendAutoOperationCommand,
    });

    expect(sendAutoOperationCommand).toHaveBeenCalledWith(
      'MoveStockItem',
      {
        oldStockId: 1,
        oldSlot: 0,
        newStockId: 2,
        newSlot: 5,
        isRotate: false,
      },
      expect.any(Object),
    );
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({
        moved: true,
        stocksRefreshed: true,
        containers: expect.arrayContaining([
          expect.objectContaining({ stockId: 2 }),
        ]),
      }),
    }));
  });

  it('waits for the AutoOperation Agent to disappear when running UnloadAgent through the generic command path', async () => {
    vi.useFakeTimers();
    const sendAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({
        id: '7',
        ok: true,
        result: { unloading: true, delayMs: 200 },
      })
      .mockResolvedValueOnce({
        id: '8',
        ok: true,
        result: { pong: true },
      })
      .mockRejectedValueOnce(new Error('connect ENOENT \\\\.\\pipe\\BKAutoOp'));

    const resultPromise = service.runAutoOperationCommand('UnloadAgent', { delayMs: 200 }, {
      sendAutoOperationCommand,
      unloadPollIntervalMs: 1,
      unloadTimeoutMs: 50,
      unloadGraceMs: 0,
    });
    await advanceUnloadWaitTimers(5);
    const result = await resultPromise;

    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      1,
      'UnloadAgent',
      { delayMs: 200 },
      expect.any(Object),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      2,
      'Ping',
      {},
      expect.any(Object),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      3,
      'Ping',
      {},
      expect.any(Object),
    );
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({ unloading: true, unloaded: true }),
    }));
  });

  it('does not treat ping timeout as proof that UnloadAgent finished', async () => {
    vi.useFakeTimers();
    const sendAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({
        id: '7',
        ok: true,
        result: { unloading: true, delayMs: 200 },
      })
      .mockRejectedValue(new Error('ping timed out'));

    const resultPromise = service.runAutoOperationCommand('UnloadAgent', { delayMs: 200 }, {
      sendAutoOperationCommand,
      unloadPollIntervalMs: 1,
      unloadTimeoutMs: 10,
      unloadGraceMs: 0,
    });
    const expectation = expect(resultPromise).rejects.toThrow('AutoOperation Agent did not unload before timeout');
    await advanceUnloadWaitTimers(20);
    await expectation;
  });

  it('uses longer pipe timeouts for long-running AutoOperation commands', async () => {
    const sendAutoOperationCommand = vi.fn().mockResolvedValue({
      id: '8',
      ok: true,
      result: {},
    });

    await service.runAutoOperationCommand('GetCollectionItemCids', {}, { sendAutoOperationCommand });
    await service.runAutoOperationCommand('GetItemTradeInfo', { itemCid: 1032006 }, { sendAutoOperationCommand });
    await service.runAutoOperationCommand('GetWarehouseItemList', {}, { sendAutoOperationCommand });
    await service.runAutoOperationCommand('GetStockCollectibleCounts', {}, { sendAutoOperationCommand });
    await service.runAutoOperationCommand('GetStockContainers', {}, { sendAutoOperationCommand });
    await service.runAutoOperationCommand('MoveStockItem', {
      oldStockId: 1,
      oldSlot: 24,
      newStockId: 2,
      newSlot: 13,
      isRotate: false,
    }, { sendAutoOperationCommand });
    await service.runAutoOperationCommand('CollectCabinetReward', {}, { sendAutoOperationCommand });
    await service.runAutoOperationCommand('AutoAuction', {
      roomId: 101,
      bidAmount: 25000,
    }, { sendAutoOperationCommand });
    await service.runAutoOperationCommand('ExchangeItem', {
      itemCid: 1032006,
      count: 1,
      unitPrice: 6200,
      timeoutMs: 60000,
    }, { sendAutoOperationCommand });
    await service.runAutoOperationCommand('RefreshExchangeSellSlots', {}, { sendAutoOperationCommand });

    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      1,
      'GetCollectionItemCids',
      {},
      expect.objectContaining({ timeoutMs: 45000 }),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      2,
      'GetItemTradeInfo',
      { itemCid: 1032006 },
      expect.objectContaining({ timeoutMs: 45000 }),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      3,
      'GetWarehouseItemList',
      {},
      expect.objectContaining({ timeoutMs: 45000 }),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      4,
      'GetStockCollectibleCounts',
      {},
      expect.objectContaining({ timeoutMs: 45000 }),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      5,
      'GetStockContainers',
      {},
      expect.objectContaining({ timeoutMs: 45000 }),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      6,
      'MoveStockItem',
      {
        oldStockId: 1,
        oldSlot: 24,
        newStockId: 2,
        newSlot: 13,
        isRotate: false,
      },
      expect.objectContaining({ timeoutMs: 45000 }),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      7,
      'CollectCabinetReward',
      {},
      expect.objectContaining({ timeoutMs: 45000 }),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      8,
      'AutoAuction',
      {
        roomId: 101,
        bidAmount: 25000,
      },
      expect.objectContaining({ timeoutMs: 600000 }),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      9,
      'ExchangeItem',
      {
        itemCid: 1032006,
        count: 1,
        unitPrice: 6200,
        timeoutMs: 60000,
      },
      expect.objectContaining({ timeoutMs: 185000 }),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      10,
      'RefreshExchangeSellSlots',
      {},
      expect.objectContaining({ timeoutMs: 20000 }),
    );
  });

  it('derives wait command pipe timeouts from protocol defaults and explicit timeoutMs', async () => {
    const sendAutoOperationCommand = vi.fn().mockResolvedValue({
      id: '8w',
      ok: true,
      result: {},
    });

    await service.runAutoOperationCommand('WaitForVisiblePanel', {
      panel: 'UIMain',
      visible: true,
    }, { sendAutoOperationCommand });
    await service.runAutoOperationCommand('WaitForNode', {
      panel: 'UIMain',
      rootPath: 'WareHousePanel/WareHouse',
      path: 'Down/saleTog',
      pathMode: 'exact',
      state: 'interactive',
      timeoutMs: 7000,
      pollIntervalMs: 50,
    }, { sendAutoOperationCommand });

    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      1,
      'WaitForVisiblePanel',
      {
        panel: 'UIMain',
        visible: true,
      },
      expect.objectContaining({ timeoutMs: 4000 }),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      2,
      'WaitForNode',
      {
        panel: 'UIMain',
        rootPath: 'WareHousePanel/WareHouse',
        path: 'Down/saleTog',
        pathMode: 'exact',
        state: 'interactive',
        timeoutMs: 7000,
        pollIntervalMs: 50,
      },
      expect.objectContaining({ timeoutMs: 8000 }),
    );
  });

  it('does not clamp invalid wait command timeoutMs into the protocol range', async () => {
    const sendAutoOperationCommand = vi.fn().mockResolvedValue({
      id: '8x',
      ok: true,
      result: {},
    });

    await service.runAutoOperationCommand('WaitForNode', {
      panel: 'Battle_Main',
      rootPath: 'InputDevice/Panel1',
      path: 'chujia',
      pathMode: 'exact',
      state: 'active',
      timeoutMs: 60001,
      pollIntervalMs: 50,
    }, { sendAutoOperationCommand });

    expect(sendAutoOperationCommand).toHaveBeenCalledWith(
      'WaitForNode',
      {
        panel: 'Battle_Main',
        rootPath: 'InputDevice/Panel1',
        path: 'chujia',
        pathMode: 'exact',
        state: 'active',
        timeoutMs: 60001,
        pollIntervalMs: 50,
      },
      expect.objectContaining({ timeoutMs: 61001 }),
    );
  });

  it('unloads the AutoOperation Agent with a short timeout', async () => {
    vi.useFakeTimers();
    const sendAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({
        id: '9',
        ok: true,
        result: { unloading: true, delayMs: 200 },
      })
      .mockResolvedValueOnce({
        id: '10',
        ok: true,
        result: { pong: true },
      })
      .mockRejectedValueOnce(new Error('connect ENOENT \\\\.\\pipe\\BKAutoOp'));

    const resultPromise = service.unloadAutoOperationAgent({
      sendAutoOperationCommand,
      unloadPollIntervalMs: 1,
      unloadTimeoutMs: 50,
      unloadGraceMs: 0,
    });
    await advanceUnloadWaitTimers(5);
    const result = await resultPromise;

    expect(sendAutoOperationCommand).toHaveBeenCalledWith(
      'UnloadAgent',
      { delayMs: 200 },
      expect.objectContaining({ timeoutMs: 2000 }),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      2,
      'Ping',
      {},
      expect.any(Object),
    );
    expect(sendAutoOperationCommand).toHaveBeenNthCalledWith(
      3,
      'Ping',
      {},
      expect.any(Object),
    );
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({ unloading: true, unloaded: true }),
    }));
  });

  it('does not throw when unloading the AutoOperation Agent fails during shutdown', async () => {
    const sendAutoOperationCommand = vi.fn().mockRejectedValue(new Error('pipe not found'));

    const result = await service.unloadAutoOperationAgent({ sendAutoOperationCommand });

    expect(result).toEqual({
      ok: false,
      error: 'pipe not found',
    });
  });

  it('reports failure when the AutoOperation Agent still responds after the unload timeout', async () => {
    vi.useFakeTimers();
    const sendAutoOperationCommand = vi.fn()
      .mockResolvedValueOnce({
        id: '9',
        ok: true,
        result: { unloading: true, delayMs: 200 },
      })
      .mockResolvedValue({
        id: '10',
        ok: true,
        result: { pong: true },
      });

    const resultPromise = service.unloadAutoOperationAgent({
      sendAutoOperationCommand,
      unloadPollIntervalMs: 1,
      unloadTimeoutMs: 5,
      unloadGraceMs: 0,
    });
    await advanceUnloadWaitTimers(20);
    const result = await resultPromise;

    expect(result).toEqual({
      ok: false,
      error: 'AutoOperation Agent did not unload before timeout',
    });
  });
});

describe('single item trade info refresh', () => {
  it('starts the Agent, queries one item, records the snapshot, and returns the written summary', async () => {
    const startAutoOperationAgent = vi.fn().mockResolvedValue({ ok: true });
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        itemCid: 1022002,
        minPrice: 3996,
        tierCount: 1,
        totalCount: 3,
        tiers: [{ price: 3996, count: 3 }],
      },
    });
    const recordTradeInfoSnapshot = vi.fn().mockReturnValue({
      ok: true,
      itemCid: 1022002,
      minPrice: 3996,
      tierCount: 1,
      totalCount: 3,
    });

    const result = await service.refreshItemTradeInfo(1022002, {
      startAutoOperationAgent,
      runAutoOperationCommand,
      recordTradeInfoSnapshot,
    });

    expect(startAutoOperationAgent).toHaveBeenCalledTimes(1);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetItemTradeInfo', { itemCid: 1022002 }, expect.any(Object));
    expect(recordTradeInfoSnapshot).toHaveBeenCalledWith({
      itemCid: 1022002,
      minPrice: 3996,
      tierCount: 1,
      totalCount: 3,
      tiers: [{ price: 3996, count: 3 }],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        ok: true,
        itemCid: 1022002,
        minPrice: 3996,
        tierCount: 1,
        totalCount: 3,
      },
    });
  });

  it('rejects invalid item cids before starting the Agent', async () => {
    const startAutoOperationAgent = vi.fn();

    await expect(service.refreshItemTradeInfo('bad', { startAutoOperationAgent }))
      .rejects.toThrow('itemCid is required');
    expect(startAutoOperationAgent).not.toHaveBeenCalled();
  });

  it('throws the writer error when the snapshot cannot be recorded', async () => {
    await expect(service.refreshItemTradeInfo(1022002, {
      startAutoOperationAgent: vi.fn().mockResolvedValue({ ok: true }),
      runAutoOperationCommand: vi.fn().mockResolvedValue({
        ok: true,
        value: { itemCid: 1022002, tiers: [] },
      }),
      recordTradeInfoSnapshot: vi.fn().mockReturnValue({ ok: false, error: 'invalid trade info snapshot' }),
    })).rejects.toThrow('invalid trade info snapshot');
  });

  it('starts the Agent, captures collection cids, writes them to file, and returns the written summary', async () => {
    const startAutoOperationAgent = vi.fn().mockResolvedValue({ ok: true });
    const runAutoOperationCommand = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        cids: [1032006, 1013007, 1032006],
      },
    });
    const recordCollectionCids = vi.fn().mockReturnValue({
      written: true,
      itemCids: [1032006, 1013007],
      outputPath: 'C:/Users/test/Documents/BKPriceHistory/Cids.json',
    });

    const result = await service.captureCollectionCidsToFile({
      startAutoOperationAgent,
      runAutoOperationCommand,
      recordCollectionCids,
    });

    expect(startAutoOperationAgent).toHaveBeenCalledTimes(1);
    expect(runAutoOperationCommand).toHaveBeenCalledWith('GetCollectionItemCids', {}, expect.any(Object));
    expect(recordCollectionCids).toHaveBeenCalledWith([1032006, 1013007, 1032006], expect.any(Object));
    expect(result).toEqual({
      ok: true,
      value: {
        itemCids: [1032006, 1013007],
        count: 2,
        outputPath: 'C:/Users/test/Documents/BKPriceHistory/Cids.json',
      },
    });
  });

  it('propagates collection capture command failures', async () => {
    const startAutoOperationAgent = vi.fn().mockResolvedValue({ ok: true });
    const runAutoOperationCommand = vi.fn().mockRejectedValue(new Error('native failed'));
    const recordCollectionCids = vi.fn();

    await expect(service.captureCollectionCidsToFile({
      startAutoOperationAgent,
      runAutoOperationCommand,
      recordCollectionCids,
    })).rejects.toThrow('native failed');
    expect(recordCollectionCids).not.toHaveBeenCalled();
  });

  it('propagates Agent startup failures before querying collection cids', async () => {
    const startAutoOperationAgent = vi.fn().mockRejectedValue(new Error('agent failed'));
    const runAutoOperationCommand = vi.fn();
    const recordCollectionCids = vi.fn();

    await expect(service.captureCollectionCidsToFile({
      startAutoOperationAgent,
      runAutoOperationCommand,
      recordCollectionCids,
    })).rejects.toThrow('agent failed');
    expect(runAutoOperationCommand).not.toHaveBeenCalled();
    expect(recordCollectionCids).not.toHaveBeenCalled();
  });
});

describe('collection price scan desktop helpers', () => {
  it('passes collection scan start/stop/status to the controller', async () => {
    const controller = {
      start: vi.fn().mockResolvedValue({ state: 'running' }),
      stop: vi.fn().mockReturnValue({ state: 'stopped' }),
      getState: vi.fn().mockReturnValue({ state: 'running' }),
      updateConfig: vi.fn().mockReturnValue({ config: { scanIntervalMinutes: 30 } }),
    };

    expect(await service.startCollectionPriceScan({ scanIntervalMinutes: 30 }, { controller }))
      .toEqual({ state: 'running' });
    expect(service.stopCollectionPriceScan({ controller })).toEqual({ state: 'stopped' });
    expect(service.getCollectionPriceScanStatus({ controller })).toEqual({ state: 'running' });
    expect(service.updateCollectionPriceScanConfig({ scanIntervalMinutes: 30 }, { controller }))
      .toEqual({ config: { scanIntervalMinutes: 30 } });

    expect(controller.start).toHaveBeenCalledWith({ scanIntervalMinutes: 30 });
    expect(controller.stop).toHaveBeenCalledTimes(1);
    expect(controller.getState).toHaveBeenCalledTimes(1);
    expect(controller.updateConfig).toHaveBeenCalledWith({ scanIntervalMinutes: 30 });
  });

  it('throws a clear error when the controller is unavailable', async () => {
    await expect(service.startCollectionPriceScan({}, {}))
      .rejects.toThrow('Collection price scan controller is unavailable');
    expect(() => service.stopCollectionPriceScan({}))
      .toThrow('Collection price scan controller is unavailable');
    expect(() => service.getCollectionPriceScanStatus({}))
      .toThrow('Collection price scan controller is unavailable');
    expect(() => service.updateCollectionPriceScanConfig({}, {}))
      .toThrow('Collection price scan controller is unavailable');
  });
});


describe('inject-service stock move saved lists', () => {
  it('saves a stock move list under Documents/BidKing/stock-move-lists', async () => {
    const documentsDir = makeTempRoot();
    const writeFile = vi.spyOn(fs.promises, 'writeFile');
    const rename = vi.spyOn(fs.promises, 'rename');

    const result = await service.saveStockMoveList({
      name: '主仓高频车件',
      itemCids: [1083009, 1032006, 1083009],
      items: [
        { itemCid: 1083009, name: 'Intake Manifold', quality: 'blue', type: 'vehicle', sizeKey: '1x2' },
      ],
    }, { documentsDir });

    expect(result.ok).toBe(true);
    expect(result.value.name).toBe('主仓高频车件');
    expect(result.value.itemCids).toEqual([1083009, 1032006]);
    expect(result.value.id).toMatch(/^\d{14}-[a-z0-9]+$/);

    const listDir = path.join(documentsDir, 'BidKing', 'stock-move-lists');
    const finalPath = path.join(listDir, `${result.value.id}.json`);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][0]).not.toBe(finalPath);
    expect(path.dirname(writeFile.mock.calls[0][0])).toBe(listDir);
    expect(rename).toHaveBeenCalledWith(writeFile.mock.calls[0][0], finalPath);
    expect(fs.readdirSync(listDir)).toEqual([`${result.value.id}.json`]);
  });

  it('lists saved stock move lists sorted by savedAt desc and skips broken files', async () => {
    const documentsDir = makeTempRoot();
    const listDir = path.join(documentsDir, 'BidKing', 'stock-move-lists');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.mkdirSync(listDir, { recursive: true });
    fs.writeFileSync(path.join(listDir, 'older.json'), JSON.stringify({
      id: 'older',
      name: 'older',
      savedAt: '2026-06-05T01:00:00.000Z',
      itemCids: [1011001],
      items: [],
    }));
    fs.writeFileSync(path.join(listDir, 'broken.json'), '{broken');
    fs.writeFileSync(path.join(listDir, 'newer.json'), JSON.stringify({
      id: 'newer',
      name: 'newer',
      savedAt: '2026-06-05T02:00:00.000Z',
      itemCids: [1032006],
      items: [],
    }));

    const result = await service.listStockMoveLists({ documentsDir });

    expect(result.ok).toBe(true);
    expect(result.value.map((entry) => entry.id)).toEqual(['newer', 'older']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(' ')).toContain('broken.json');
  });

  it('rejects blank names and empty itemCid arrays', async () => {
    const documentsDir = makeTempRoot();

    await expect(service.saveStockMoveList({
      name: '   ',
      itemCids: [1083009],
      items: [],
    }, { documentsDir })).rejects.toThrow('name is required');

    await expect(service.saveStockMoveList({
      name: 'valid',
      itemCids: [],
      items: [],
    }, { documentsDir })).rejects.toThrow('itemCids is required');
  });
});
