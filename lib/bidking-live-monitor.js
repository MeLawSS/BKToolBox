const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { getRuntimeLogDir, getRuntimeRoot } = require('../runtime-paths');
const { MarketPriceStore } = require('./bidking-market-price-store.js');
const { PriceHistoryStore } = require('./bidking-price-history-store.js');
const { buildBidKingMonitorFacts } = require('./bidking-monitor-facts.js');
const {
  applyBidKingMonitorFacts,
  createEmptyBidKingMonitorState,
} = require('./bidking-monitor-store.js');
const { PcapngStreamReader } = require('./bidking-pcap-stream-reader.js');
const { TcpStreamReassembler } = require('./bidking-tcp-reassembler.js');
const { TeeWriter } = require('./bidking-capture-tee-writer.js');

const execFileAsyncDefault = promisify(execFile);
const DEFAULT_REMOTE_ADDRESS = '';
const DEFAULT_PORT = 10000;
const DEFAULT_BATCH_SECONDS = 2;
const DEFAULT_CAPTURE_BACKEND = 'auto';
const DEFAULT_DUMPCAP_INTERFACE = 'auto';

class BidKingLiveMonitor extends EventEmitter {
  constructor(deps = {}) {
    super();
    this.execFileAsync = deps.execFileAsync || execFileAsyncDefault;
    this.spawn = deps.spawn || spawn;
    this.sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = deps.now || (() => new Date());
    this.runtimeRoot = deps.runtimeRoot || getRuntimeRoot();
    this.outputDir = deps.outputDir || getRuntimeLogDir();
    this.priceHistoryStore = deps.priceHistoryStore || new PriceHistoryStore();
    this.hasInjectedMarketPriceStore = Boolean(deps.marketPriceStore);
    this.marketPriceStore = deps.marketPriceStore || new MarketPriceStore({
      outputDir: this.outputDir,
      now: this.now,
      priceHistoryStore: this.priceHistoryStore,
    });
    this.running = false;
    this.stopRequested = false;
    this.loopPromise = null;
    this.status = {
      state: 'idle',
      running: false,
      totalEvents: 0,
      lastError: null,
      startedAt: null,
      stoppedAt: null,
      currentCapture: null
    };
    this.seenEventKeys = new Set();
    this.recentEvents = [];
    this.currentGameUid = null;
    this.monitorState = createEmptyBidKingMonitorState();
    this.dumpcapProcess = null;
    this.dumpcapError = null;
  }

  getStatus() {
    return {
      ...this.status,
      running: this.running,
      totalEvents: this.seenEventKeys.size
    };
  }

  getRecentEvents() {
    return clonePlainData(this.recentEvents);
  }

  async start(options = {}) {
    if (this.running) {
      return this.getStatus();
    }

    this.options = normalizeOptions(options, this.runtimeRoot, this.outputDir);
    if (!this.hasInjectedMarketPriceStore && typeof this.marketPriceStore.setOutputDir === 'function') {
      this.marketPriceStore.setOutputDir(this.options.outputDir);
    }
    fs.mkdirSync(this.options.outputDir, { recursive: true });
    this.running = true;
    this.stopRequested = false;
    this.resetSessionState();
    this.updateStatus({
      state: 'starting',
      running: true,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      lastError: null,
      lastBatch: undefined,
      options: this.publicOptions()
    });

    if (!this._loopGeneration) this._loopGeneration = 0;
    const generation = ++this._loopGeneration;
    this.loopPromise = this.runLoop().then(() => {
      if (this._loopGeneration === generation) {
        this.running = false;
        this.updateStatus({ state: 'stopped', running: false, currentCapture: null });
      }
    }).catch(async (error) => {
      if (this._loopGeneration !== generation) return;
      await this.stopCaptureQuiet();
      this.running = false;
      this.updateStatus({
        state: 'error',
        running: false,
        lastError: formatError(error),
        stoppedAt: new Date().toISOString()
      });
      this.emit('errorEvent', this.getStatus());
    });

    return this.getStatus();
  }

  async stop() {
    this.stopRequested = true;
    this.running = false;
    this.recentEvents = [];
    await this.stopCaptureQuiet();
    this.updateStatus({
      state: 'stopped',
      running: false,
      stoppedAt: new Date().toISOString(),
      currentCapture: null
    });
    return this.getStatus();
  }

  async runLoop() {
    const effectiveOptions = this.resolveCaptureOptions(this.options);
    this.options = effectiveOptions;
    await this.runDumpcapLoop(effectiveOptions);
  }

  resolveCaptureOptions(options) {
    const dumpcapPath = resolveDumpcapPath(options, this.runtimeRoot);
    if (!dumpcapPath) {
      throw new Error(
        'dumpcap.exe was not found. Install tools/WiresharkPortable64 and run npm run prepare:dumpcap, or add dumpcap to PATH.'
      );
    }
    return {
      ...options,
      captureBackend: 'dumpcap',
      dumpcapPath,
    };
  }

  async runDumpcapLoop(options) {
    const normalized = await this.resolveDumpcapRuntimeOptions(normalizeOptions(options, this.runtimeRoot, this.outputDir));
    fs.mkdirSync(normalized.outputDir, { recursive: true });
    this.dumpcapError = null;
    let restartCount = 0;
    let currentTee = null;

    this._reassembler = new TcpStreamReassembler({
      port: normalized.port,
      tablesDir: normalized.tablesDir,
    });
    await this._reassembler.init();
    this._reassembler.on('gap', ({ direction, expected, got }) => {
      this.updateStatus({ lastCaptureMessage: `TCP gap ${direction}: expected ${expected}, got ${got}` });
    });
    this._reassembler.on('event', event => this.handleParsedEvent(event));

    while (!this.stopRequested) {
      this.dumpcapError = null;

      this.updateStatus({
        state: 'capturing',
        options: this.publicOptions(normalized),
      });

      const { child, tee, readerErrorPromise, exitPromise } = await this.startDumpcapPipeCapture(normalized);
      currentTee = tee;

      try {
        await Promise.race([exitPromise, readerErrorPromise]);
      } catch (readerErr) {
        this.updateStatus({ lastCaptureMessage: `pcapng stream error: ${readerErr.message}` });
        this.dumpcapError = Object.assign(new Error(readerErr.message), { signal: 'STREAM_ERROR' });
        child.kill();
        await exitPromise;
      }

      await currentTee.end();
      currentTee = null;

      if (this.stopRequested) break;

      const error = this.dumpcapError;
      this.dumpcapError = null;

      if (!error || !canRestartDumpcapError(error)) {
        if (error) throw error;
        break;
      }

      restartCount += 1;
      this._reassembler.resetStreamState();
      this.updateStatus({
        state: 'capturing',
        lastError: null,
        lastCaptureRestart: {
          count: restartCount,
          code: error.code ?? null,
          signal: error.signal ?? null,
          message: error.message,
          restartedAt: new Date().toISOString(),
        },
        lastCaptureMessage: `${error.message}; restarting dumpcap`,
      });
    }

    if (currentTee) await currentTee.end();
  }

  async resolveDumpcapRuntimeOptions(options) {
    if (!isAutoDumpcapInterface(options.dumpcapInterface)) {
      return options;
    }

    const dumpcapPath = resolveDumpcapPath(options, this.runtimeRoot);
    try {
      const result = await this.execFileAsync(dumpcapPath, ['-D'], {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      });
      const selectedInterface = selectDumpcapInterface(result?.stdout || '');
      return {
        ...options,
        dumpcapPath,
        dumpcapInterface: selectedInterface,
        requestedDumpcapInterface: options.dumpcapInterface
      };
    } catch (error) {
      this.updateStatus({
        lastCaptureMessage: `dumpcap interface auto-select failed: ${error?.message || String(error)}`
      });
      return {
        ...options,
        dumpcapPath,
        dumpcapInterface: '1',
        requestedDumpcapInterface: options.dumpcapInterface
      };
    }
  }

  async startDumpcapPipeCapture(options) {
    const tee = new TeeWriter({
      outputDir: options.outputDir,
      maxFiles: 120,
      rotationBytes: 32 * 1024 * 1024,
      now: this.now,
      onError: (err) => this.updateStatus({ lastCaptureMessage: `archive error: ${err.message}` }),
    });
    const reader = new PcapngStreamReader();
    const reassembler = this._reassembler;

    const args = buildDumpcapArgs(options);
    const child = this.spawn(resolveDumpcapPath(options), args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.dumpcapProcess = child;

    let readerErrorReject = null;
    const readerErrorPromise = new Promise((_, rej) => { readerErrorReject = rej; });
    readerErrorPromise.catch(() => {});

    let _exitResolve;
    const exitPromise = new Promise(resolve => { _exitResolve = resolve; });
    child.once('exit', _exitResolve);

    child.stdout.on('data', chunk => reader.push(chunk));
    reader.on('block', block => tee.writeBlock(block));
    reader.on('packet', (data, idx) => reassembler.pushPacket(data));
    reader.on('error', err => readerErrorReject(err));
    tee.on('rotate', filePath => this.updateStatus({ currentCapture: { capturePath: filePath } }));

    child.stderr?.on?.('data', chunk => this.updateStatus({ lastCaptureMessage: String(chunk).trim() }));
    child.on?.('error', err => {
      this.dumpcapError = err;
      this.updateStatus({ state: 'error', lastError: formatError(err) });
      _exitResolve(); // ensure exitPromise settles if 'exit' never fires
    });
    child.on?.('exit', (code, signal) => {
      if (this.dumpcapError) return; // don't overwrite an already-set error
      if (!this.stopRequested && code !== 0) {
        this.dumpcapError = new Error(`dumpcap exited with code ${code ?? '-'} signal ${signal ?? '-'}`);
        this.dumpcapError.code = code;
        this.dumpcapError.signal = signal;
        if (!signal) {
          this.updateStatus({ state: 'error', lastError: formatError(this.dumpcapError) });
        }
      }
    });

    return { child, tee, readerErrorPromise, exitPromise };
  }

  async stopDumpcapQuiet() {
    const child = this.dumpcapProcess;
    if (!child) return;
    this.dumpcapProcess = null;
    try {
      child.kill?.();
    } catch (_error) {
      // Stopping monitor should tolerate an already-exited dumpcap process.
    }
  }

  async stopCaptureQuiet() {
    await this.stopDumpcapQuiet();
  }

  updateStatus(patch) {
    this.status = {
      ...this.status,
      ...patch,
      running: this.running,
      totalEvents: this.seenEventKeys.size
    };
    this.emit('status', this.getStatus());
  }

  pushRecentEvent(event) {
    this.recentEvents.push(event);
    if (this.recentEvents.length > 200) {
      this.recentEvents = this.recentEvents.slice(-200);
    }
  }

  resetSessionState() {
    this.seenEventKeys = new Set();
    this.recentEvents = [];
    this.currentGameUid = null;
    this.monitorState = createEmptyBidKingMonitorState();
  }

  handleParsedEvent(event) {
    const rawEvent = event.rawEvent ?? event;
    const eventGameUid = normalizeGameUid(rawEvent.gameUid);

    if (eventGameUid && eventGameUid !== this.currentGameUid) {
      return this.emitParsedEvent(rawEvent, eventGameUid);
    }

    return this.emitParsedEvent(rawEvent, eventGameUid || this.currentGameUid);
  }

  emitParsedEvent(event, inferredGameUid = null) {
    const rawEvent = event.gameUid || !inferredGameUid
      ? event
      : { ...event, gameUid: inferredGameUid };
    const dedupKey = getEventDedupKey(rawEvent);
    if (!dedupKey || this.seenEventKeys.has(dedupKey)) return 0;
    this.seenEventKeys.add(dedupKey);

    const facts = buildBidKingMonitorFacts(rawEvent);
    this.monitorState = applyBidKingMonitorFacts(this.monitorState, facts);
    const rawEventSnapshot = clonePlainData(rawEvent);
    let marketPriceSnapshot = null;
    if (rawEventSnapshot.type === 'market_price') {
      const result = this.marketPriceStore.recordEvent(rawEventSnapshot);
      marketPriceSnapshot = result.snapshot ?? null;
    }
    const enrichedEvent = {
      ...rawEventSnapshot,
      rawEvent: rawEventSnapshot,
      facts: clonePlainData(facts),
      state: clonePlainData(this.monitorState),
      marketPriceSnapshot,
    };
    if (enrichedEvent.gameUid && enrichedEvent.gameUid !== this.currentGameUid) {
      this.currentGameUid = enrichedEvent.gameUid;
    }
    this.pushRecentEvent(clonePlainData(enrichedEvent));
    this.emit('event', clonePlainData(enrichedEvent));
    return 1;
  }

  publicOptions(options = this.options) {
    if (!options) return null;
    return {
      remoteAddress: options.remoteAddress,
      port: options.port,
      batchSeconds: options.batchSeconds,
      captureBackend: options.captureBackend,
      dumpcapPath: options.dumpcapPath,
      dumpcapInterface: options.dumpcapInterface,
      gameRoot: options.gameRoot,
      tablesDir: options.tablesDir,
      outputDir: options.outputDir
    };
  }
}

function normalizeGameUid(value) {
  const gameUid = String(value ?? '').trim();
  return gameUid || null;
}

function canRestartDumpcapError(error) {
  return Boolean(error?.signal);
}

function normalizeOptions(options = {}, runtimeRoot = getRuntimeRoot(), fallbackOutputDir) {
  const remoteAddress = String(options.remoteAddress || DEFAULT_REMOTE_ADDRESS).trim();
  const port = parsePort(options.port ?? DEFAULT_PORT);
  const batchSeconds = parseBatchSeconds(options.batchSeconds ?? DEFAULT_BATCH_SECONDS);
  const captureBackend = parseCaptureBackend(options.captureBackend ?? DEFAULT_CAPTURE_BACKEND);
  const dumpcapPath = String(options.dumpcapPath || '').trim();
  const dumpcapInterface = String(options.dumpcapInterface || DEFAULT_DUMPCAP_INTERFACE).trim();
  const gameRoot = String(options.gameRoot || '').trim();
  const tablesDir = String(options.tablesDir || findTablesDir(gameRoot) || findTablesDir(path.join(runtimeRoot, 'Archive', 'BidKing')) || '').trim();
  const outputDir = path.resolve(String(options.outputDir || fallbackOutputDir || path.join(os.tmpdir(), 'bidking-live-monitor')));

  return {
    remoteAddress,
    port,
    batchSeconds,
    captureBackend,
    dumpcapPath,
    dumpcapInterface,
    gameRoot,
    tablesDir,
    outputDir
  };
}

function buildDumpcapArgs(options) {
  const captureFilter = options.remoteAddress
    ? `tcp port ${options.port} and host ${options.remoteAddress}`
    : `tcp port ${options.port}`;
  const dumpcapInterface = options.dumpcapInterface || DEFAULT_DUMPCAP_INTERFACE;
  return [
    '-i',
    isAutoDumpcapInterface(dumpcapInterface) ? '1' : dumpcapInterface,
    '-f',
    captureFilter,
    '-s',
    '0',
    '-w',
    '-',
  ];
}

function isAutoDumpcapInterface(value) {
  return String(value || '').trim().toLowerCase() === 'auto';
}

function selectDumpcapInterface(dumpcapListOutput) {
  const interfaces = parseDumpcapInterfaces(dumpcapListOutput);
  if (interfaces.length === 0) return '1';

  const ranked = interfaces
    .map((entry, index) => ({ ...entry, index, score: scoreDumpcapInterface(entry.description) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return ranked[0]?.id || '1';
}

function parseDumpcapInterfaces(dumpcapListOutput) {
  return String(dumpcapListOutput || '')
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/);
      if (!match) return null;
      return {
        id: match[1],
        description: match[2]
      };
    })
    .filter(Boolean);
}

function scoreDumpcapInterface(description) {
  const text = String(description || '').toLowerCase();
  if (/loopback|adapter for loopback|vethernet|virtual|vmware|virtualbox|bluetooth|本地连接\*|蓝牙|natpierce|tunnel|隧道/.test(text)) {
    return 0;
  }
  if (/以太网|ethernet/.test(text)) return 100;
  if (/wlan|wi-?fi|wireless|无线/.test(text)) return 90;
  return 10;
}

function resolveDumpcapPath(options, runtimeRoot = getRuntimeRoot()) {
  if (options.dumpcapPath) return options.dumpcapPath;
  const bundledExe = path.join(runtimeRoot, 'tools', 'dumpcap', 'dumpcap.exe');
  if (fs.existsSync(bundledExe)) return bundledExe;
  return findExecutableOnPath(process.platform === 'win32' ? 'dumpcap.exe' : 'dumpcap');
}

function findExecutableOnPath(command) {
  const pathEnv = process.env.PATH || process.env.Path || '';
  if (!pathEnv) return null;
  const hasPathSeparator = command.includes('/') || command.includes('\\');
  if (hasPathSeparator) {
    return fs.existsSync(command) ? command : null;
  }
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('port must be a TCP port number');
  }
  return port;
}

function parseBatchSeconds(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 2 || seconds > 60) {
    throw new Error('batchSeconds must be an integer from 2 to 60');
  }
  return seconds;
}

function parseCaptureBackend(value) {
  const backend = String(value || DEFAULT_CAPTURE_BACKEND).trim().toLowerCase();
  if (backend === 'auto' || backend === 'dumpcap') return backend;
  throw new Error('captureBackend must be auto or dumpcap');
}

function findTablesDir(root) {
  if (!root) return '';
  const candidates = [
    path.join(root, 'BidKing_Data', 'StreamingAssets', 'Tables'),
    path.join(root, 'StreamingAssets', 'Tables'),
    path.join(root, 'Tables')
  ];
  return candidates.find((candidate) => {
    return fs.existsSync(path.join(candidate, 'Item.txt')) && fs.existsSync(path.join(candidate, 'Item_Type.txt'));
  }) || '';
}

function sortEventsForProcessing(events) {
  return [...events].sort((left, right) => {
    const leftTime = getEventCastTime(left);
    const rightTime = getEventCastTime(right);
    if (leftTime !== rightTime) return leftTime - rightTime;
    return getMessageOrder(left) - getMessageOrder(right);
  });
}

function getEventCastTime(event) {
  const time = Number(event?.skill?.castTime);
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function getMessageOrder(event) {
  const order = {
    game_start: 0,
    game_next_round: 1,
    game_use_item: 2,
    game_over: 3
  };
  return order[event?.sourceKind] ?? 99;
}

function getEventDedupKey(event) {
  if (!event?.key) return '';
  const scopedKey = event.gameUid ? `${event.gameUid}:${event.key}` : event.key;
  return `${scopedKey}:${buildEventPayloadSignature(event)}`;
}

function buildEventPayloadSignature(event) {
  const skill = event?.skill ?? {};
  return JSON.stringify({
    group: event?.group ?? '',
    round: event?.round ?? '',
    skillCid: skill.skillCid ?? '',
    itemCid: skill.itemCid ?? '',
    castRound: skill.castRound ?? '',
    totalHitBoxIndex: skill.totalHitBoxIndex ?? '',
    hitItemTotalPrice: skill.hitItemTotalPrice ?? '',
    allHitItemAvgPrice: skill.allHitItemAvgPrice ?? '',
    allHitBoxAvgPrice: skill.allHitBoxAvgPrice ?? '',
    allHitItemAvgBoxIndex: skill.allHitItemAvgBoxIndex ?? '',
    hitItemTypeList: skill.hitItemTypeList ?? [],
    hitItemQuilityList: skill.hitItemQuilityList ?? [],
    hitBoxList: (skill.hitBoxList ?? []).map((box) => ({
      boxId: box.boxId ?? null,
      itemCid: box.itemCid ?? null,
      itemName: box.itemName ?? null,
      itemPrice: box.itemPrice ?? box.price ?? null,
      itemSlotType: box.itemSlotType ?? null,
      itemQuility: box.itemQuility ?? box.itemQuality ?? box.qualityId ?? null,
      itemQuilityName: box.itemQuilityName ?? box.itemQualityName ?? box.quality ?? null,
      itemBoxIndex: box.itemBoxIndex ?? null,
    })),
  });
}

function clonePlainData(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function formatError(error) {
  return {
    message: error?.message || String(error),
    code: error?.code || null
  };
}

module.exports = {
  BidKingLiveMonitor,
  normalizeOptions,
  buildDumpcapArgs,
  sortEventsForProcessing
};
