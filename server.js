const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { projectRoot, getRuntimeRoot, getRuntimePath } = require('./runtime-paths');
const { BidKingLiveMonitor } = require('./lib/bidking-live-monitor');
const { CaptureDriverManager } = require('./lib/capture-driver');
const { MarketPriceStore } = require('./lib/bidking-market-price-store');
const { PriceHistoryStore } = require('./lib/bidking-price-history-store');
const { MarketLadderStore } = require('./lib/bidking-market-ladder-store');
const { MinCellsDebuggerHistoryStore } = require('./lib/bidking-min-cells-debugger-history-store');


const serverLogPath = path.join(os.tmpdir(), 'bidking-server.log');

function logServerEvent(...parts) {
    try {
        fs.appendFileSync(
            serverLogPath,
            `[${new Date().toISOString()}] ${parts.map((part) => {
                if (part instanceof Error) {
                    return part.stack || part.message;
                }
                if (typeof part === 'string') {
                    return part;
                }
                try {
                    return JSON.stringify(part);
                } catch (_error) {
                    return String(part);
                }
            }).join(' ')}\n`
        );
    } catch (_error) {
        // Server logging must never interrupt requests.
    }
}

function readCollectibles(logger = logServerEvent) {
    const candidates = [
        getRuntimePath('collectibles.json'),
        path.join(projectRoot, 'collectibles.json')
    ];

    for (const filePath of candidates) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                logger('collectibles-read-error', filePath, error);
            }
        }
    }

    logger('collectibles-read-error', 'collectibles.json not found');
    return [];
}

function sendFirstExistingFile(res, candidates) {
    const filePath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!filePath) {
        res.status(404).end('Not Found');
        return;
    }

    res.sendFile(filePath, { dotfiles: 'allow' });
}

function createApp(deps = {}) {
    const app = express();
    const spawnImpl = deps.spawn || spawn;
    const logger = deps.logServerEvent || logServerEvent;
    const monitor = deps.monitor || new BidKingLiveMonitor();
    const captureDriver = deps.captureDriver || new CaptureDriverManager();
    const marketPriceStore = deps.marketPriceStore || monitor.marketPriceStore || new MarketPriceStore();
    const priceHistoryStore = deps.priceHistoryStore || monitor.priceHistoryStore || new PriceHistoryStore();
    const marketLadderStore = deps.marketLadderStore || new MarketLadderStore();
    const minCellsDebuggerHistoryStore = deps.minCellsDebuggerHistoryStore || new MinCellsDebuggerHistoryStore();

    const collectibles = Array.isArray(deps.collectibles) ? deps.collectibles : readCollectibles(logger);
    const services = {
        async stop() {
            await monitor.stop();
        }
    };
    app.locals.services = services;

    app.use(express.json({ limit: '32kb' }));

    function parsePositiveInteger(value) {
        if (typeof value !== 'string') {
            return null;
        }

        const trimmed = value.trim();
        if (!/^\d+$/.test(trimmed)) {
            return null;
        }

        const parsed = Number.parseInt(trimmed, 10);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }

    function parsePositiveNumber(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function findCollectible(itemCid) {
        const item = collectibles.find((candidate) => Number(candidate.itemCid ?? candidate.cid ?? candidate.id) === itemCid);
        if (!item) {
            return null;
        }

        return {
            ...item,
            itemCid,
            basePrice: Number(item.price)
        };
    }

    app.use((req, res, next) => {
        logger('request', req.method, req.url);
        res.on('finish', () => {
            logger('response', req.method, req.url, res.statusCode);
        });
        res.on('close', () => {
            if (!res.writableEnded) {
                logger('response-closed', req.method, req.url, res.statusCode);
            }
        });
        next();
    });

    app.get('/', (req, res) => {
        sendFirstExistingFile(res, [
            path.join(projectRoot, 'public', 'home', 'index.html'),
            path.join(projectRoot, 'src', 'home', 'index.html')
        ]);
    });

    app.get(['/elsa', '/Elsa'], (req, res) => {
        res.redirect('/Tools');
    });

    app.get(['/tools', '/Tools'], (req, res) => {
        if (req.path === '/tools') {
            res.redirect('/Tools');
            return;
        }

        sendFirstExistingFile(res, [
            path.join(projectRoot, 'public', 'index.html'),
            path.join(projectRoot, 'src', 'elsa', 'index.html')
        ]);
    });

    app.get(['/ahmed', '/Ahmed'], (req, res) => {
        res.redirect('/Tools?tab=ahmed');
    });

    app.get(['/ethan', '/Ethan'], (req, res) => {
        res.redirect('/Tools?tab=ethan');
    });

    app.get(['/monitor', '/Monitor'], (req, res) => {
        if (req.path === '/monitor') {
            res.redirect('/Monitor');
            return;
        }

        sendFirstExistingFile(res, [
            path.join(projectRoot, 'public', 'monitor', 'index.html'),
            path.join(projectRoot, 'src', 'monitor', 'index.html')
        ]);
    });

    app.get(['/price', '/Price'], (req, res) => {
        if (req.path === '/price') {
            res.redirect('/Price');
            return;
        }

        sendFirstExistingFile(res, [
            path.join(projectRoot, 'public', 'price', 'index.html'),
            path.join(projectRoot, 'src', 'price', 'index.html')
        ]);
    });


    app.get(['/inject', '/Inject'], (req, res) => {
        if (req.path === '/inject') {
            res.redirect('/Inject');
            return;
        }

        sendFirstExistingFile(res, [
            path.join(projectRoot, 'public', 'inject', 'index.html'),
            path.join(projectRoot, 'src', 'inject', 'index.html')
        ]);
    });

    app.get('/data/collectibles.json', (req, res) => {
        res.json(collectibles);
    });

    app.get('/api/bidking-monitor/status', (req, res) => {
        res.json(monitor.getStatus());
    });

    app.get('/api/market-prices/latest', (_req, res) => {
        const latest = marketPriceStore.readLatest();
        res.json({
            items: Object.values(latest).sort((left, right) => Number(left.itemCid) - Number(right.itemCid))
        });
    });

    app.get('/api/market-prices/history', (req, res) => {
        const itemCid = parsePositiveInteger(String(req.query.itemCid ?? ''));
        if (itemCid === null) {
            res.status(400).json({ error: 'itemCid is required' });
            return;
        }

        const limit = parsePositiveInteger(String(req.query.limit ?? '100')) ?? 100;
        res.json({
            itemCid,
            history: marketPriceStore.readHistory(itemCid, { limit })
        });
    });

    app.get('/api/price-history/latest', (_req, res) => {
        const latest = priceHistoryStore.readLatest();
        res.json({
            items: Object.values(latest).sort((left, right) => Number(right.minPrice) - Number(left.minPrice))
        });
    });

    app.get('/api/price-history/collections', (_req, res) => {
        res.json({
            itemCids: priceHistoryStore.readCollectionCids()
        });
    });

    app.get('/api/price-history/item/:itemCid', (req, res) => {
        const itemCid = parsePositiveInteger(String(req.params.itemCid ?? ''));
        if (itemCid === null) {
            res.status(400).json({ error: 'itemCid is required' });
            return;
        }

        const limit = parsePositiveInteger(String(req.query.limit ?? '1000')) ?? 1000;
        res.json({
            itemCid,
            history: priceHistoryStore.readHistory(itemCid, { limit })
        });
    });

    app.get('/api/price-history/ladders/:itemCid', (req, res) => {
        const itemCid = parsePositiveInteger(String(req.params.itemCid ?? ''));
        if (itemCid === null) {
            res.status(400).json({ error: 'itemCid is required' });
            return;
        }

        const hours = parsePositiveNumber(req.query.hours ?? 24, 24);
        res.json({
            itemCid,
            ladders: marketLadderStore.readLadders(itemCid, { hours })
        });
    });

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


    app.get('/api/capture-driver/status', async (_req, res) => {
        try {
            res.json(await captureDriver.getStatus());
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/capture-driver/install', async (_req, res) => {
        try {
            res.json(await captureDriver.startInstall());
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/capture-driver/uninstall', async (_req, res) => {
        try {
            res.json(await captureDriver.startUninstall());
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/bidking-monitor/start', async (req, res) => {
        try {
            const body = req.body || {};
            const monitorOptions = {
                remoteAddress: String(body.remoteAddress || ''),
                port: body.port,
                batchSeconds: body.batchSeconds,
                gameRoot: String(body.gameRoot || ''),
                tablesDir: String(body.tablesDir || ''),
                outputDir: String(body.outputDir || ''),
                useInferenceV2: body.useInferenceV2 === true || body.useInferenceV2 === 'true',
            };
            if (body.captureBackend) monitorOptions.captureBackend = String(body.captureBackend);
            if (body.dumpcapPath) monitorOptions.dumpcapPath = String(body.dumpcapPath);
            if (body.dumpcapInterface) monitorOptions.dumpcapInterface = String(body.dumpcapInterface);
            const status = await monitor.start(monitorOptions);
            res.json(status);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/bidking-monitor/stop', async (_req, res) => {
        try {
            res.json(await monitor.stop());
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    app.get('/api/bidking-monitor/schema', (_req, res) => {
        res.sendFile(path.join(projectRoot, 'docs', 'bidking-realtime-protocol-schema.json'), { dotfiles: 'allow' });
    });

    app.get('/api/bidking-monitor/events', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        const send = (eventName, payload) => {
            res.write(`event: ${eventName}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        };
        const onEvent = (event) => send('event', event);
        const onStatus = (status) => send('status', status);
        const onError = (status) => send('error', status);

        send('status', monitor.getStatus());
        for (const event of monitor.getRecentEvents()) {
          send('event', event);
        }
        monitor.on('event', onEvent);
        monitor.on('status', onStatus);
        monitor.on('errorEvent', onError);

        req.on('close', () => {
            monitor.off('event', onEvent);
            monitor.off('status', onStatus);
            monitor.off('errorEvent', onError);
        });
    });

    app.use(express.static(path.join(projectRoot, 'public'), { dotfiles: 'allow' }));

    app.get('/run', (req, res) => {
        const { script, args, limit } = req.query;
        const allowed = [
            'solve-gold-combo.js',
            'solve-gold-total.js',
            'solve-gold-grid.js',
            'solve-purple-grid.js',
            'solve-red-grid.js',
            'solve-purple-combo.js',
            'solve-purple-total.js',
            'solve-type-combo.js',
            'solve-average-price-combo.js'
        ];

        if (!allowed.includes(script)) {
            res.status(400).end('Invalid script');
            return;
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const argList = (args || '').trim().split(/\s+/).filter(Boolean);
        const env = {
            ...process.env,
            BIDKING_RUNTIME_ROOT: getRuntimeRoot(),
            SOLVER_CONCURRENCY: '1'
        };

        const parsedLimit = parsePositiveInteger(limit);
        if (limit !== undefined && limit !== null && limit !== '' && parsedLimit === null) {
            res.status(400).end('Invalid limit');
            return;
        }
        if (parsedLimit !== null) {
            env.LIMIT = String(parsedLimit);
        }

        if (process.versions.electron) {
            env.ELECTRON_RUN_AS_NODE = '1';
        }

        const child = spawnImpl(process.execPath, [getRuntimePath(script), ...argList], { env });
        const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

        child.stdout.on('data', (chunk) => send({ type: 'out', text: chunk.toString() }));
        child.stderr.on('data', (chunk) => send({ type: 'err', text: chunk.toString() }));
        child.on('close', (code) => {
            send({ type: 'done', code });
            res.end();
        });

        req.on('close', () => child.kill());
    });

    return app;
}

function startServer(port = 3000, host = '0.0.0.0', deps = {}) {
    const app = createApp(deps);

    return new Promise((resolve, reject) => {
        const server = app.listen(port, host, () => {
            const address = server.address();
            const resolvedPort = typeof address === 'object' && address ? address.port : port;
            logServerEvent('listening', port, {
                host,
                resolvedPort,
                projectRoot,
                runtimeRoot: getRuntimeRoot(),
                cwd: process.cwd(),
                execPath: process.execPath
            });
            resolve({
                app,
                server,
                port: resolvedPort,
                host,
                async stop() {
                    await app.locals.services?.stop?.();
                    await new Promise((stopResolve) => {
                        server.close(() => stopResolve());
                    });
                }
            });
        });
        server.on('error', (error) => {
            logServerEvent('server-error', error);
            reject(error);
        });
        server.on('clientError', (error, socket) => {
            logServerEvent('client-error', error);
            if (socket.writable) {
                socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
            }
        });
    });
}

if (require.main === module) {
    startServer()
        .then(({ port }) => {
            console.log(`http://localhost:${port}`);
        })
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = {
    createApp,
    readCollectibles,
    startServer
};
