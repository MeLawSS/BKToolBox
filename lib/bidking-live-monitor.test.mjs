import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import EventEmitter from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { BidKingLiveMonitor, buildDumpcapArgs, normalizeOptions } = require('./bidking-live-monitor.js');
const bidkingMonitorGrid = require('./bidking-monitor-grid.js');

describe('BidKingLiveMonitor', () => {
  it('finds packaged BidKing tables under the runtime root', async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'bidking-runtime-root-'));
    const tablesDir = path.join(runtimeRoot, 'Archive', 'BidKing', 'BidKing_Data', 'StreamingAssets', 'Tables');
    await mkdir(tablesDir, { recursive: true });
    await writeFile(path.join(tablesDir, 'Item.txt'), 'item', 'utf8');
    await writeFile(path.join(tablesDir, 'Item_Type.txt'), 'type', 'utf8');

    const normalized = normalizeOptions({ port: 10000, batchSeconds: 2 }, runtimeRoot);

    expect(normalized.tablesDir).toBe(tablesDir);
    await rm(runtimeRoot, { recursive: true, force: true });
  });

  it('uses the application log directory as the default output directory', () => {
    const defaultOutputDir = path.join(process.cwd(), 'log');
    const normalized = normalizeOptions({ port: 10000, batchSeconds: 2 }, process.cwd(), defaultOutputDir);

    expect(normalized.outputDir).toBe(defaultOutputDir);
  });

  it('constructs with the runtime log directory by default', () => {
    const monitor = new BidKingLiveMonitor({
      execFileAsync: async () => ({ stdout: '', stderr: '' }),
      sleep: async () => {},
      runtimeRoot: process.cwd(),
    });

    expect(monitor.outputDir).toBe(path.join(process.cwd(), 'log'));
  });

  it('applies the inference algorithm flag when monitor capture starts', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-'));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => child.emit('exit', 0, null));
    const spawn = vi.fn(() => child);
    const setInferenceAlgorithmV2Spy = vi.spyOn(bidkingMonitorGrid, 'setInferenceAlgorithmV2');
    const monitor = new BidKingLiveMonitor({
      execFileAsync: async () => ({ stdout: '', stderr: '' }),
      spawn,
      runtimeRoot: process.cwd(),
      outputDir,
      now: () => new Date('2026-05-23T08:00:00.000Z'),
    });

    try {
      await monitor.start({
        port: 10000,
        batchSeconds: 2,
        tablesDir: 'Tables',
        dumpcapPath: 'dumpcap',
        useInferenceV2: true,
      });

      expect(setInferenceAlgorithmV2Spy).toHaveBeenCalledWith(true);
      expect(monitor.getStatus().options).toMatchObject({
        useInferenceV2: true,
      });
    } finally {
      await monitor.stop();
      await monitor.loopPromise;
      setInferenceAlgorithmV2Spy.mockRestore();
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('keeps an explicit monitor output directory when provided', () => {
    const defaultOutputDir = path.join(process.cwd(), 'log');
    const explicitOutputDir = path.join(os.tmpdir(), 'custom-bidking-monitor');
    const normalized = normalizeOptions({
      port: 10000,
      batchSeconds: 2,
      outputDir: explicitOutputDir,
    }, process.cwd(), defaultOutputDir);

    expect(normalized.outputDir).toBe(explicitOutputDir);
  });

  it('persists parsed market price events without adding gameplay facts', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-'));
    const recorded = [];
    const monitor = new BidKingLiveMonitor({
      execFileAsync: async () => ({ stdout: '', stderr: '' }),
      sleep: async () => {},
      runtimeRoot: outputDir,
      outputDir,
      marketPriceStore: {
        recordEvent(event) {
          recorded.push(event);
          return { written: true, snapshot: { itemCid: event.itemCid, minPrice: event.minPrice } };
        },
      },
    });

    try {
      const count = monitor.handleParsedEvent({
        type: 'market_price',
        key: 'market:1022001:99',
        clientMsgId: 99,
        itemCid: 1022001,
        requestUid: '1247189784563310',
        prices: [{ price: 1155, count: 105 }],
        minPrice: 1155,
        maxPrice: 1155,
        totalCount: 105,
      });

      expect(count).toBe(1);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ type: 'market_price', itemCid: 1022001 });
      expect(monitor.getRecentEvents()[0]).toMatchObject({
        type: 'market_price',
        facts: [],
        state: expect.objectContaining({
          gameUid: null,
          outlines: [],
        }),
        marketPriceSnapshot: {
          itemCid: 1022001,
          minPrice: 1155,
        },
      });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it('writes market prices under the explicit start outputDir', async () => {
    const initialOutputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-initial-'));
    const explicitOutputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-explicit-'));
    const priceHistoryStore = {
      recordSnapshot: vi.fn(),
    };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => child.emit('exit', 0, null));
    const spawn = vi.fn(() => child);
    let monitor;
    monitor = new BidKingLiveMonitor({
      execFileAsync: async () => ({ stdout: '', stderr: '' }),
      spawn,
      runtimeRoot: initialOutputDir,
      outputDir: initialOutputDir,
      priceHistoryStore,
      now: () => new Date('2026-05-28T12:24:37.000Z'),
    });

    try {
      await monitor.start({
        port: 10000,
        batchSeconds: 2,
        tablesDir: 'Tables',
        outputDir: explicitOutputDir,
        dumpcapPath: 'dumpcap',
      });

      // Wait until the loop has called spawn (past reassembler.init())
      const deadline = Date.now() + 5000;
      while (!spawn.mock.calls.length && Date.now() < deadline) {
        await new Promise(resolve => setImmediate(resolve));
      }

      monitor.handleParsedEvent({
        type: 'market_price',
        key: 'market:1022001:99',
        clientMsgId: 99,
        itemCid: 1022001,
        itemName: '急救毯',
        requestUid: '1247189784563310',
        prices: [{ price: 1155, count: 105 }],
      });
      child.emit('exit', 0, null);
      await monitor.loopPromise;

      const snapshotsText = await readFile(
        path.join(explicitOutputDir, 'market-prices', 'snapshots.ndjson'),
        'utf8',
      );
      expect(snapshotsText.trim().split('\n')).toHaveLength(1);
      expect(priceHistoryStore.recordSnapshot).not.toHaveBeenCalled();
    } finally {
      await monitor?.stop();
      await rm(initialOutputDir, { recursive: true, force: true });
      await rm(explicitOutputDir, { recursive: true, force: true });
    }
  });

  it('uses auto capture with dumpcap arguments available by default', () => {
    const normalized = normalizeOptions({ port: 10000, batchSeconds: 2 }, process.cwd());

    expect(normalized.captureBackend).toBe('auto');
    expect(normalized.dumpcapInterface).toBe('auto');
    expect(buildDumpcapArgs({
      ...normalized,
      remoteAddress: '8.133.195.27',
    })).toEqual([
      '-i',
      '1',
      '-f',
      'tcp port 10000 and host 8.133.195.27',
      '-s',
      '0',
      '-w',
      '-',
    ]);
  });

  it('rejects pktmon as a configured capture backend', () => {
    expect(() => normalizeOptions({
      port: 10000,
      batchSeconds: 2,
      captureBackend: 'pktmon',
    }, process.cwd())).toThrow('captureBackend must be auto or dumpcap');
  });

  it('selects a physical dumpcap interface before starting automatic dumpcap capture', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-'));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    const spawn = vi.fn(() => child);
    const execFileAsync = vi.fn(async (command, args) => {
      if (command === 'dumpcap' && args[0] === '-D') {
        return {
          stdout: [
            '1. \\Device\\NPF_{A} (本地连接* 10)',
            '4. \\Device\\NPF_{B} (以太网)',
            '5. \\Device\\NPF_{C} (vEthernet (Default Switch))',
            '9. \\Device\\NPF_{D} (WLAN)',
            '12. \\Device\\NPF_Loopback (Adapter for loopback traffic capture)',
          ].join('\n'),
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    });
    const monitor = new BidKingLiveMonitor({
      execFileAsync,
      spawn,
      runtimeRoot: outputDir,
      outputDir,
      now: () => new Date('2026-05-23T08:00:00.000Z')
    });

    await monitor.start({
      port: 10000,
      batchSeconds: 2,
      tablesDir: 'Tables',
      dumpcapPath: 'dumpcap',
      dumpcapInterface: 'auto',
    });

    // Wait until the loop has called spawn (past reassembler.init())
    const deadline = Date.now() + 5000;
    while (!spawn.mock.calls.length && Date.now() < deadline) {
      await new Promise(resolve => setImmediate(resolve));
    }
    child.emit('exit', 0, null);
    await monitor.loopPromise;

    expect(execFileAsync).toHaveBeenCalledWith('dumpcap', ['-D'], expect.any(Object));
    expect(spawn).toHaveBeenCalledWith('dumpcap', expect.arrayContaining([
      '-i',
      '4',
    ]), expect.any(Object));
    expect(monitor.getStatus().options.dumpcapInterface).toBe('4');

    await rm(outputDir, { recursive: true, force: true });
  });

  it('runs dumpcap continuously via stdout pipe and emits parsed events', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-'));
    const emitted = [];
    const { EventEmitter } = await import('node:events');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => { child.emit('exit', 0, null); });

    const spawn = vi.fn(() => child);
    const execFileAsync = vi.fn(async () => ({ stdout: '', stderr: '' }));

    const monitor = new BidKingLiveMonitor({
      execFileAsync,
      spawn,
      runtimeRoot: outputDir,
      outputDir,
      now: () => new Date('2026-05-23T08:00:00.000Z'),
    });
    monitor.on('event', e => emitted.push(e));

    await monitor.start({ port: 10000, dumpcapPath: 'dumpcap' });

    // Wait until the loop has called spawn (i.e., past reassembler.init())
    const deadline = Date.now() + 5000;
    while (!spawn.mock.calls.length && Date.now() < deadline) {
      await new Promise(resolve => setImmediate(resolve));
    }

    // Emit a clean stop — child exits normally
    child.emit('exit', 0, null);
    await monitor.loopPromise;

    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/dumpcap/),
      expect.arrayContaining(['-w', '-']),
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] }),
    );
    expect(emitted).toHaveLength(0); // no pcapng data pushed, no events

    await rm(outputDir, { recursive: true, force: true });
  });

  it('reports an error when auto capture cannot find dumpcap', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-'));
    const originalPath = process.env.PATH;
    process.env.PATH = '';
    let monitor;
    const spawn = vi.fn(() => {
      throw new Error('dumpcap should not be spawned when it is unavailable');
    });
    const monitorExec = vi.fn(async () => ({ stdout: '', stderr: '' }));
    monitor = new BidKingLiveMonitor({
      execFileAsync: monitorExec,
      spawn,
      sleep: async () => {
        await monitor.stop();
      },
      runtimeRoot: outputDir,
      outputDir,
      now: () => new Date('2026-05-23T08:00:00.000Z')
    });

    try {
      await monitor.start({ port: 10000, batchSeconds: 2, tablesDir: 'Tables' });
      await monitor.loopPromise;
    } finally {
      process.env.PATH = originalPath;
      await rm(outputDir, { recursive: true, force: true });
    }

    expect(spawn).not.toHaveBeenCalled();
    expect(monitorExec.mock.calls.some(([command]) => command === 'pktmon')).toBe(false);
    expect(monitor.getStatus()).toMatchObject({
      running: false,
      state: 'error',
      lastError: expect.objectContaining({
        message: expect.stringContaining('dumpcap'),
      }),
    });
  });

  it('keeps dumpcap startup failures as terminal errors', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-'));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    const spawn = vi.fn(() => child);
    const execFileAsync = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const monitor = new BidKingLiveMonitor({
      execFileAsync,
      spawn,
      runtimeRoot: process.cwd(),
      outputDir,
      now: () => new Date('2026-05-23T08:00:00.000Z')
    });

    await monitor.start({ port: 10000, batchSeconds: 2, tablesDir: 'Tables', dumpcapPath: 'dumpcap' });

    // Wait until the loop has called spawn (i.e., past reassembler.init())
    const deadline = Date.now() + 5000;
    while (!spawn.mock.calls.length && Date.now() < deadline) {
      await new Promise(resolve => setImmediate(resolve));
    }

    // Simulate dumpcap failing immediately with exit code 2
    child.stderr.emit('data', Buffer.from('Unable to load Npcap or WinPcap (wpcap.dll)'));
    child.emit('exit', 2, null);
    await monitor.loopPromise;

    expect(spawn).toHaveBeenCalledOnce();
    expect(execFileAsync.mock.calls.some(([command]) => command === 'pktmon')).toBe(false);
    expect(monitor.getStatus()).toMatchObject({
      running: false,
      state: 'error',
      lastError: expect.objectContaining({
        message: expect.stringContaining('dumpcap exited with code 2'),
      }),
    });

    await rm(outputDir, { recursive: true, force: true });
  });

  it('restarts dumpcap and keeps monitoring when it is terminated by signal', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-'));
    const emitted = [];
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    const restartedChild = new EventEmitter();
    restartedChild.stdout = new EventEmitter();
    restartedChild.stderr = new EventEmitter();
    restartedChild.kill = vi.fn(() => restartedChild.emit('exit', 0, null));
    let spawnCalls = 0;
    const spawn = vi.fn(() => {
      spawnCalls += 1;
      return spawnCalls === 1 ? child : restartedChild;
    });
    const execFileAsync = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const monitor = new BidKingLiveMonitor({
      execFileAsync,
      spawn,
      runtimeRoot: process.cwd(),
      outputDir,
      now: () => new Date('2026-05-23T08:00:00.000Z')
    });
    monitor.on('event', (event) => emitted.push(event));

    await monitor.start({ port: 10000, batchSeconds: 2, tablesDir: 'Tables', dumpcapPath: 'dumpcap' });

    // Wait until the loop has called spawn for the first child
    const deadline = Date.now() + 5000;
    while (spawnCalls < 1 && Date.now() < deadline) {
      await new Promise(resolve => setImmediate(resolve));
    }

    // First child is terminated by signal — loop should restart
    child.emit('exit', null, 'SIGTERM');

    // Wait until the loop has called spawn for the restarted child
    const deadline2 = Date.now() + 5000;
    while (spawnCalls < 2 && Date.now() < deadline2) {
      await new Promise(resolve => setImmediate(resolve));
    }

    // Stop the restarted child cleanly
    restartedChild.emit('exit', 0, null);
    await monitor.loopPromise;

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(monitor.getStatus().state).toBe('stopped');
    expect(monitor.getStatus().lastError).toBe(null);
    expect(monitor.getStatus().lastCaptureRestart).toMatchObject({
      count: 1,
      signal: 'SIGTERM',
    });
    expect(emitted).toHaveLength(0); // no pcapng data pushed through pipe
    expect(execFileAsync.mock.calls.some(([command, args]) =>
      command === 'pktmon' && ['filter', 'start', 'etl2pcap'].includes(args[0])
    )).toBe(false);

    await rm(outputDir, { recursive: true, force: true });
  });

  it('resets monitor state for a new start session', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-'));
    const emitted = [];
    const makeChild = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => child.emit('exit', 0, null));
      return child;
    };
    let currentChild = null;
    const spawn = vi.fn(() => {
      currentChild = makeChild();
      return currentChild;
    });
    const execFileAsync = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const monitor = new BidKingLiveMonitor({
      execFileAsync,
      spawn,
      runtimeRoot: process.cwd(),
      outputDir,
      now: () => new Date('2026-05-23T08:00:00.000Z')
    });
    monitor.on('event', (event) => emitted.push(event));

    // First session: inject a blue-total event, then stop
    let spawnCount = 0;
    const origSpawn = spawn.getMockImplementation();
    spawn.mockImplementation((...args) => {
      spawnCount += 1;
      return origSpawn(...args);
    });

    await monitor.start({ port: 10000, batchSeconds: 2, tablesDir: 'Tables', dumpcapPath: 'dumpcap' });
    // Wait until the loop has called spawn (past reassembler.init())
    const deadline1 = Date.now() + 5000;
    while (spawnCount < 1 && Date.now() < deadline1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    monitor.handleParsedEvent({
      key: 'skill:first-blue-total',
      gameUid: 'same-game',
      type: 'skill',
      msgId: 39,
      skill: { uid: 'first-blue-total', itemCid: 202, totalHitBoxIndex: 29 }
    });
    currentChild.emit('exit', 0, null);
    await monitor.loopPromise;

    expect(emitted).toHaveLength(1);
    expect(emitted[0].state.groups.blue.totalCells).toBe(29);

    // Second session: state should be reset — same key can emit again from a fresh state
    await monitor.start({ port: 10000, batchSeconds: 2, tablesDir: 'Tables', dumpcapPath: 'dumpcap' });
    // Wait until the loop has called spawn for the second session
    const deadline2 = Date.now() + 5000;
    while (spawnCount < 2 && Date.now() < deadline2) {
      await new Promise(resolve => setImmediate(resolve));
    }
    monitor.handleParsedEvent({
      key: 'skill:second-orange-total',
      gameUid: 'same-game',
      type: 'skill',
      msgId: 39,
      skill: { uid: 'second-orange-total', itemCid: 204, totalHitBoxIndex: 12 }
    });
    currentChild.emit('exit', 0, null);
    await monitor.loopPromise;

    expect(emitted).toHaveLength(2);
    expect(emitted[1].state.gameUid).toBe('same-game');
    expect(emitted[1].state.groups.blue.totalCells).toBeNull();
    expect(emitted[1].state.groups.orange.totalCells).toBe(12);

    await rm(outputDir, { recursive: true, force: true });
  });

  it('uses a port-only dumpcap filter when remote address is not configured', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-'));
    expect(buildDumpcapArgs({
      port: 10000,
      batchSeconds: 2,
      remoteAddress: '',
      dumpcapInterface: 'auto',
    })).toEqual([
      '-i',
      '1',
      '-f',
      'tcp port 10000',
      '-s',
      '0',
      '-w',
      '-',
    ]);

    await rm(outputDir, { recursive: true, force: true });
  });

  it('stops dumpcap when a running loop fails mid-batch', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'bidking-monitor-'));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => child.emit('exit', 0, null));
    const spawn = vi.fn(() => child);
    const execFileAsync = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const monitor = new BidKingLiveMonitor({
      execFileAsync,
      spawn,
      runtimeRoot: process.cwd(),
      outputDir,
      now: () => new Date('2026-05-23T08:00:00.000Z')
    });

    await monitor.start({
      remoteAddress: '8.133.195.27',
      port: 10000,
      batchSeconds: 2,
      dumpcapPath: 'dumpcap',
      tablesDir: 'Tables'
    });

    // Wait until the loop has called spawn (past reassembler.init())
    const deadline = Date.now() + 5000;
    while (!spawn.mock.calls.length && Date.now() < deadline) {
      await new Promise(resolve => setImmediate(resolve));
    }

    // Push invalid pcapng bytes — triggers a reader error, which kills the child and restarts the loop
    child.stdout.emit('data', Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]));

    // Wait until the kill has been called (reader error was handled)
    const killDeadline = Date.now() + 5000;
    while (!child.kill.mock.calls.length && Date.now() < killDeadline) {
      await new Promise(resolve => setImmediate(resolve));
    }

    // Reader errors now restart the loop — stop the monitor explicitly to settle loopPromise
    await monitor.stop();
    await monitor.loopPromise;

    expect(child.kill).toHaveBeenCalled();
    expect(monitor.getStatus()).toMatchObject({
      running: false,
      state: 'stopped'
    });

    await rm(outputDir, { recursive: true, force: true });
  });
});
