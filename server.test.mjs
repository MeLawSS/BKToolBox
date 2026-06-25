import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const request = require('supertest');
const { createApp, readCollectibles, startServer } = require('./server.js');
const { getRuntimeRoot } = require('./runtime-paths.js');
const collectibles = require('./collectibles.json');

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.kill = vi.fn();
  }
}

class FakeMonitor extends EventEmitter {
  constructor() {
    super();
    this.status = { state: 'idle', running: false, totalEvents: 0 };
    this.start = vi.fn(async (options) => {
      this.status = { state: 'capturing', running: true, totalEvents: 0, options };
      this.emit('status', this.status);
      return this.status;
    });
    this.stop = vi.fn(async () => {
      this.status = { state: 'stopped', running: false, totalEvents: 0 };
      this.emit('status', this.status);
      return this.status;
    });
    this.getStatus = vi.fn(() => this.status);
    this.getRecentEvents = vi.fn(() => []);
  }
}

class FakeCaptureDriver {
  constructor() {
    this.status = { state: 'missing', installed: false, usable: false };
    this.getStatus = vi.fn(async () => this.status);
    this.startInstall = vi.fn(async () => ({ started: true, path: 'D:\\BKToolBox\\npcap.exe' }));
    this.startUninstall = vi.fn(async () => ({ started: true, path: 'C:\\Program Files\\Npcap\\uninstall.exe' }));
  }
}

class FakeMarketPriceStore {
  constructor() {
    this.latest = {
      1022002: {
        observedAt: '2026-05-28T12:25:37.000Z',
        itemCid: 1022002,
        itemName: '医疗箱',
        minPrice: 2300,
        maxPrice: 2400,
        totalCount: 12,
        tierCount: 2,
        source: 'tcp-passive',
      },
      1022001: {
        observedAt: '2026-05-28T12:24:37.000Z',
        itemCid: 1022001,
        itemName: '急救毯',
        minPrice: 1155,
        maxPrice: 1502,
        totalCount: 355,
        tierCount: 8,
        source: 'tcp-passive',
      },
    };
    this.history = [
      {
        observedAt: '2026-05-28T12:24:37.000Z',
        itemCid: 1022001,
        itemName: '急救毯',
        minPrice: 1155,
        maxPrice: 1502,
        totalCount: 355,
        tierCount: 8,
        tiers: [{ price: 1155, count: 105 }],
        source: 'tcp-passive',
      },
    ];
    this.readLatest = vi.fn(() => this.latest);
    this.readHistory = vi.fn(() => this.history);
  }
}

class FakePriceHistoryStore {
  constructor() {
    this.latest = {
      1022001: {
        observedAt: '2026-05-28T12:24:37.000Z',
        itemCid: 1022001,
        minPrice: 1155,
      },
    };
    this.history = [
      { observedAt: '2026-05-28T12:24:37.000Z', minPrice: 1155 },
      { observedAt: '2026-05-28T12:31:02.000Z', minPrice: 1194 },
    ];
    this.readLatest = vi.fn(() => this.latest);
    this.readHistory = vi.fn(() => this.history);
    this.readCollectionCids = vi.fn(() => [1022002, 1022001]);
  }
}

class FakeMarketLadderStore {
  constructor() {
    this.ladders = [
      {
        observedAt: '2026-05-28T10:00:00.000Z',
        tiers: [{ price: 1155, count: 20 }, { price: 1500, count: 10 }],
      },
      {
        observedAt: '2026-05-28T11:00:00.000Z',
        tiers: [{ price: 1200, count: 12 }, { price: 1500, count: 10 }],
      },
      {
        observedAt: '2026-05-28T12:00:00.000Z',
        tiers: [{ price: 1250, count: 6 }, { price: 1500, count: 10 }],
      },
    ];
    this.readLadders = vi.fn(() => this.ladders);
  }
}

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


function createTestApp(spawnImpl = vi.fn(), monitor = undefined, captureDriver = undefined) {
  return createApp({
    spawn: spawnImpl,
    monitor,
    captureDriver,
    logServerEvent: () => {},
  });
}

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

describe('server routes', () => {
  it('serves main page routes and canonical redirects', async () => {
    const app = createTestApp();

    await request(app).get('/').expect(200).expect('Content-Type', /html/);
    await request(app).get('/Tools').expect(200).expect('Content-Type', /html/);
    await request(app).get('/Monitor').expect(200).expect('Content-Type', /html/);
    await request(app).get('/Price').expect(200).expect('Content-Type', /html/);

    await request(app).get('/Inject').expect(200).expect('Content-Type', /html/);

    await request(app).get('/Elsa').expect(302).expect('Location', '/Tools');
    await request(app).get('/elsa').expect(302).expect('Location', '/Tools');
    await request(app).get('/tools').expect(302).expect('Location', '/Tools');
    await request(app).get('/Ahmed').expect(302).expect('Location', '/Tools?tab=ahmed');
    await request(app).get('/ahmed').expect(302).expect('Location', '/Tools?tab=ahmed');
    await request(app).get('/Ethan').expect(302).expect('Location', '/Tools?tab=ethan');
    await request(app).get('/ethan').expect(302).expect('Location', '/Tools?tab=ethan');
    await request(app).get('/monitor').expect(302).expect('Location', '/Monitor');
    await request(app).get('/price').expect(302).expect('Location', '/Price');

    await request(app).get('/inject').expect(302).expect('Location', '/Inject');
  });

  it('serves collectibles data from the root data source', async () => {
    const app = createTestApp();

    const response = await request(app)
      .get('/data/collectibles.json')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body).toHaveLength(collectibles.length);
    expect(response.body[0]).toMatchObject(collectibles[0]);
  });

  it('reads collectibles from the runtime root for packaged resources', async () => {
    const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'bidking-runtime-'));
    const previousRuntimeRoot = process.env.BIDKING_RUNTIME_ROOT;
    try {
      const runtimeCollectibles = [{ cid: 999001, name: 'Runtime Item', price: 123 }];
      await writeFile(
        path.join(runtimeRoot, 'collectibles.json'),
        JSON.stringify(runtimeCollectibles),
        'utf8',
      );
      process.env.BIDKING_RUNTIME_ROOT = runtimeRoot;

      expect(readCollectibles(() => {})).toEqual(runtimeCollectibles);
    } finally {
      if (previousRuntimeRoot === undefined) {
        delete process.env.BIDKING_RUNTIME_ROOT;
      } else {
        process.env.BIDKING_RUNTIME_ROOT = previousRuntimeRoot;
      }
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('rejects invalid run script and limit values', async () => {
    const app = createTestApp();

    await request(app)
      .get('/run')
      .query({ script: 'not-allowed.js' })
      .expect(400, 'Invalid script');

    await request(app)
      .get('/run')
      .query({ script: 'solve-gold-total.js', limit: 'abc' })
      .expect(400, 'Invalid limit');
  });

  it('streams run output and invokes the allowed script with parsed args and limit', async () => {
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => {
      process.nextTick(() => {
        child.stdout.emit('data', Buffer.from('line out'));
        child.stderr.emit('data', Buffer.from('line err'));
        child.emit('close', 0);
      });
      return child;
    });
    const app = createTestApp(spawnImpl);

    const response = await request(app)
      .get('/run')
      .query({
        script: 'solve-gold-total.js',
        args: '15345 2',
        limit: '1',
      })
      .expect(200)
      .expect('Content-Type', /event-stream/);

    expect(response.text).toContain('data: {"type":"out","text":"line out"}');
    expect(response.text).toContain('data: {"type":"err","text":"line err"}');
    expect(response.text).toContain('data: {"type":"done","code":0}');

    expect(spawnImpl).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnImpl.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args).toEqual([
      path.join(getRuntimeRoot(), 'solve-gold-total.js'),
      '15345',
      '2',
    ]);
    expect(options.env.BIDKING_RUNTIME_ROOT).toBe(getRuntimeRoot());
    expect(options.env.LIMIT).toBe('1');
    expect(options.env.SOLVER_CONCURRENCY).toBe('1');
  });

  it('allows the all-item average price solver script', async () => {
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => {
      process.nextTick(() => child.emit('close', 0));
      return child;
    });
    const app = createTestApp(spawnImpl);

    await request(app)
      .get('/run')
      .query({
        script: 'solve-average-price-combo.js',
        args: '2 7800',
      })
      .expect(200)
      .expect('Content-Type', /event-stream/);

    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(spawnImpl.mock.calls[0][1]).toEqual([
      path.join(getRuntimeRoot(), 'solve-average-price-combo.js'),
      '2',
      '7800',
    ]);
  });

  it('allows the red average cells solver script', async () => {
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => {
      process.nextTick(() => child.emit('close', 0));
      return child;
    });
    const app = createTestApp(spawnImpl);

    await request(app)
      .get('/run')
      .query({
        script: 'solve-red-grid.js',
        args: '3.5 2',
      })
      .expect(200)
      .expect('Content-Type', /event-stream/);

    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(spawnImpl.mock.calls[0][1]).toEqual([
      path.join(getRuntimeRoot(), 'solve-red-grid.js'),
      '3.5',
      '2',
    ]);
  });

  it('allows the purple total price solver script', async () => {
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => {
      process.nextTick(() => child.emit('close', 0));
      return child;
    });
    const app = createTestApp(spawnImpl);

    await request(app)
      .get('/run')
      .query({
        script: 'solve-purple-total.js',
        args: '10380',
      })
      .expect(200)
      .expect('Content-Type', /event-stream/);

    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(spawnImpl.mock.calls[0][1]).toEqual([
      path.join(getRuntimeRoot(), 'solve-purple-total.js'),
      '10380',
    ]);
  });

  it('starts, reports, stops, and streams BidKing monitor events', async () => {
    const monitor = new FakeMonitor();
    const app = createTestApp(vi.fn(), monitor);

    await request(app)
      .post('/api/bidking-monitor/start')
      .send({
        remoteAddress: '8.133.195.27',
        port: 10000,
        batchSeconds: 8,
        gameRoot: 'D:\\SteamLibrary\\steamapps\\common\\BidKing',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.state).toBe('capturing');
      });

    expect(monitor.start).toHaveBeenCalledWith({
      remoteAddress: '8.133.195.27',
      port: 10000,
      batchSeconds: 8,
      gameRoot: 'D:\\SteamLibrary\\steamapps\\common\\BidKing',
      tablesDir: '',
      outputDir: '',
      useInferenceV2: false,
    });

    await request(app)
      .get('/api/bidking-monitor/status')
      .expect(200)
      .expect(({ body }) => {
        expect(body.state).toBe('capturing');
      });

    const server = app.listen(0);
    const streamText = await new Promise((resolve, reject) => {
      const { port } = server.address();
      let text = '';
      let emitted = false;
      const req = http.get(`http://127.0.0.1:${port}/api/bidking-monitor/events`, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
          if (!emitted && text.includes('event: status')) {
            emitted = true;
            monitor.emit('event', {
              key: 'skill:1',
              msgId: 39,
              rawEvent: { key: 'skill:1', msgId: 39, skill: { skillCid: 702 } },
              facts: [{ type: 'group.totalCellsKnown', group: 'blue', value: 29 }],
              state: { gameUid: 'game-1', groups: { blue: { totalCells: 29 } } },
              skill: { skillCid: 702 },
            });
          }
          if (text.includes('"key":"skill:1"')) {
            req.destroy();
          }
        });
      });
      req.on('close', () => {
        server.close();
        resolve(text);
      });
      req.on('error', reject);
    });

    expect(streamText).toContain('event: event');
    expect(streamText).toContain('"key":"skill:1"');
    expect(streamText).toContain('"facts"');
    expect(streamText).toContain('"state"');
    expect(streamText).toContain('"rawEvent"');

    await request(app)
      .post('/api/bidking-monitor/stop')
      .send({})
      .expect(200)
      .expect(({ body }) => {
        expect(body.state).toBe('stopped');
      });
  });

  it('passes explicit monitor output directory from the start request', async () => {
    const monitor = new FakeMonitor();
    const app = createTestApp(vi.fn(), monitor);

    await request(app)
      .post('/api/bidking-monitor/start')
      .send({
        outputDir: 'D:\\BKToolBoxLogs',
      })
      .expect(200);

    expect(monitor.start).toHaveBeenCalledWith(expect.objectContaining({
      outputDir: 'D:\\BKToolBoxLogs',
    }));
  });

  it('passes the explicit inference algorithm flag from the start request', async () => {
    const monitor = new FakeMonitor();
    const app = createTestApp(vi.fn(), monitor);

    await request(app)
      .post('/api/bidking-monitor/start')
      .send({
        useInferenceV2: true,
      })
      .expect(200);

    expect(monitor.start).toHaveBeenCalledWith(expect.objectContaining({
      useInferenceV2: true,
    }));
  });

  it('serves latest market prices and item history', async () => {
    const marketPriceStore = new FakeMarketPriceStore();
    const app = createApp({
      spawn: vi.fn(),
      monitor: new FakeMonitor(),
      captureDriver: new FakeCaptureDriver(),
      marketPriceStore,
      logServerEvent: () => {},
    });

    await request(app)
      .get('/api/market-prices/latest')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([
          marketPriceStore.latest['1022001'],
          marketPriceStore.latest['1022002'],
        ]);
      });

    await request(app)
      .get('/api/market-prices/history')
      .query({ itemCid: '1022001', limit: '10' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.itemCid).toBe(1022001);
        expect(body.history).toEqual(marketPriceStore.history);
      });

    expect(marketPriceStore.readHistory).toHaveBeenCalledWith(1022001, { limit: 10 });
  });

  it('rejects missing or invalid market price history item ids', async () => {
    const marketPriceStore = new FakeMarketPriceStore();
    const app = createApp({
      spawn: vi.fn(),
      monitor: new FakeMonitor(),
      captureDriver: new FakeCaptureDriver(),
      marketPriceStore,
      logServerEvent: () => {},
    });

    await request(app)
      .get('/api/market-prices/history')
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatch(/itemCid/i);
      });

    await request(app)
      .get('/api/market-prices/history')
      .query({ itemCid: 'abc' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatch(/itemCid/i);
      });

    await request(app)
      .get('/api/market-prices/history')
      .query({ itemCid: '' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatch(/itemCid/i);
      });

    await request(app)
      .get('/api/market-prices/history')
      .query({ itemCid: '0' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatch(/itemCid/i);
      });

    await request(app)
      .get('/api/market-prices/history')
      .query({ itemCid: '-1022001' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatch(/itemCid/i);
      });

    expect(marketPriceStore.readHistory).not.toHaveBeenCalled();
  });

  it('reports and launches packet capture driver actions', async () => {
    const captureDriver = new FakeCaptureDriver();
    const app = createTestApp(vi.fn(), undefined, captureDriver);

    await request(app)
      .get('/api/capture-driver/status')
      .expect(200)
      .expect(({ body }) => {
        expect(body.state).toBe('missing');
        expect(body.installed).toBe(false);
      });

    await request(app)
      .post('/api/capture-driver/install')
      .send({})
      .expect(200)
      .expect(({ body }) => {
        expect(body.started).toBe(true);
        expect(body.path).toContain('npcap.exe');
      });

    await request(app)
      .post('/api/capture-driver/uninstall')
      .send({})
      .expect(200)
      .expect(({ body }) => {
        expect(body.started).toBe(true);
        expect(body.path).toContain('uninstall.exe');
      });

    expect(captureDriver.getStatus).toHaveBeenCalled();
    expect(captureDriver.startInstall).toHaveBeenCalled();
    expect(captureDriver.startUninstall).toHaveBeenCalled();
  });

  it('serves persisted price history latest index and item time series', async () => {
    const priceHistoryStore = new FakePriceHistoryStore();
    const app = createApp({
      spawn: vi.fn(),
      monitor: new FakeMonitor(),
      captureDriver: new FakeCaptureDriver(),
      priceHistoryStore,
      logServerEvent: () => {},
    });

    await request(app)
      .get('/api/price-history/latest')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([priceHistoryStore.latest['1022001']]);
      });

    await request(app)
      .get('/api/price-history/item/1022001')
      .expect(200)
      .expect(({ body }) => {
        expect(body.itemCid).toBe(1022001);
        expect(body.history).toEqual(priceHistoryStore.history);
      });

    expect(priceHistoryStore.readHistory).toHaveBeenCalledWith(1022001, { limit: 1000 });
  });

  it('serves collection cids from persisted price history', async () => {
    const priceHistoryStore = new FakePriceHistoryStore();
    const app = createApp({
      spawn: vi.fn(),
      monitor: new FakeMonitor(),
      captureDriver: new FakeCaptureDriver(),
      priceHistoryStore,
      logServerEvent: () => {},
    });

    await request(app)
      .get('/api/price-history/collections')
      .expect(200)
      .expect(({ body }) => {
        expect(body.itemCids).toEqual([1022002, 1022001]);
      });

    expect(priceHistoryStore.readCollectionCids).toHaveBeenCalledTimes(1);
  });

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

  it('rejects invalid persisted price history item ids', async () => {
    const priceHistoryStore = new FakePriceHistoryStore();
    const app = createApp({
      spawn: vi.fn(),
      monitor: new FakeMonitor(),
      captureDriver: new FakeCaptureDriver(),
      priceHistoryStore,
      logServerEvent: () => {},
    });

    await request(app)
      .get('/api/price-history/item/abc')
      .expect(400)
      .expect(({ body }) => {
        expect(body.error).toMatch(/itemCid/i);
      });
  });

  it('serves per-item full ladder history', async () => {
    const marketLadderStore = new FakeMarketLadderStore();
    const app = createApp({
      spawn: vi.fn(),
      monitor: new FakeMonitor(),
      captureDriver: new FakeCaptureDriver(),
      marketLadderStore,
      logServerEvent: () => {},
    });

    await request(app)
      .get('/api/price-history/ladders/1022001?hours=12')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          itemCid: 1022001,
          ladders: marketLadderStore.ladders,
        });
      });

    expect(marketLadderStore.readLadders).toHaveBeenCalledWith(1022001, { hours: 12 });
  });


  it('stops the live monitor when the server handle stops', async () => {
    const monitor = new FakeMonitor();
    const handle = await startServer(0, '127.0.0.1', {
      monitor,
      spawn: vi.fn(),
      logServerEvent: () => {},
    });

    await handle.stop();

    expect(monitor.stop).toHaveBeenCalledTimes(1);
  });
});
