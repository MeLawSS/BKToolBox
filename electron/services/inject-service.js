const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFile } = require('child_process');
const { getRuntimePath } = require('../../runtime-paths');
const {
    recordTradeInfoSnapshot: defaultRecordTradeInfoSnapshot,
} = require('../../lib/trade-info-history-recorder');

const AUTO_OPERATION_PIPE = '\\\\.\\pipe\\BKAutoOp';
const MAX_AUTO_OPERATION_FRAME_BYTES = 262144;
const DEFAULT_AUTO_OPERATION_TIMEOUT_MS = 5000;
const LONG_AUTO_OPERATION_TIMEOUT_MS = 45000;
const AUTO_AUCTION_TIMEOUT_MS = 600000;
const DEFAULT_WAIT_AUTO_OPERATION_TIMEOUT_MS = 3000;
const WAIT_AUTO_OPERATION_TIMEOUT_BUFFER_MS = 1000;
const WAIT_AUTO_OPERATION_MIN_TIMEOUT_MS = 100;
const WAIT_AUTO_OPERATION_MAX_TIMEOUT_MS = 30000;
const EXCHANGE_ITEM_DEFAULT_NATIVE_TIMEOUT_MS = 15000;
const EXCHANGE_ITEM_MIN_NATIVE_TIMEOUT_MS = 1000;
const EXCHANGE_ITEM_MAX_NATIVE_TIMEOUT_MS = 60000;
const EXCHANGE_ITEM_TIMEOUT_BUFFER_MS = 5000;

function getCabinetRewardPath(documentsDir) {
    return path.join(documentsDir, 'BidKing', 'cabinet-reward.json');
}


function getStockMoveListsDir(documentsDir) {
    return path.join(documentsDir, 'BidKing', 'stock-move-lists');
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonFile(filePath) {
    const text = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(text);
}

async function waitForJsonFile(filePath, startedAt, options = {}) {
    const timeoutMs = options.timeoutMs ?? 20000;
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
        try {
            const stat = await fs.promises.stat(filePath);
            if (stat.mtimeMs >= startedAt - 1000) {
                return await readJsonFile(filePath);
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        await delay(pollIntervalMs);
    }

    throw new Error(`Timed out waiting for ${filePath}`);
}

async function runInjector(command, deps = {}) {
    const execFileImpl = deps.execFile || execFile;
    const psPath  = getRuntimePath('tools', 'inject', 'BKPayload64', 'inject.ps1');
    const dllPath = deps.dllPath || getRuntimePath('tools', 'inject', 'BKPayload64', 'BKPayload64.dll');

    return new Promise((resolve, reject) => {
        execFileImpl(
            'powershell.exe',
            ['-ExecutionPolicy', 'Bypass', '-File', psPath, '-DllPath', dllPath, '-Command', command],
            { windowsHide: true, timeout: 15000 },
            (err, stdout, stderr) => {
                if (err) return reject(new Error((stderr || err.message).trim()));
                resolve({ ok: true, output: (stdout || '').trim() });
            }
        );
    });
}

async function queryTradeInfo(deps = {}) {
    return runInjector('CollectionPrices', deps);
}

function parseRequiredPositiveSafeInteger(value, message) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(message);
    }
    return value;
}

function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

function clampSafeInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) return fallback;
    return Math.min(max, Math.max(min, number));
}

function isWaitAutoOperationCommand(command) {
    return command === 'WaitForVisiblePanel' || command === 'WaitForNode';
}

function getWaitAutoOperationCommandTimeoutMs(args = {}) {
    if (args?.timeoutMs === undefined) {
        return DEFAULT_WAIT_AUTO_OPERATION_TIMEOUT_MS + WAIT_AUTO_OPERATION_TIMEOUT_BUFFER_MS;
    }

    const requestedTimeoutMs = Number(args?.timeoutMs);
    if (
        Number.isSafeInteger(requestedTimeoutMs) &&
        requestedTimeoutMs >= WAIT_AUTO_OPERATION_MIN_TIMEOUT_MS &&
        requestedTimeoutMs <= WAIT_AUTO_OPERATION_MAX_TIMEOUT_MS
    ) {
        return requestedTimeoutMs + WAIT_AUTO_OPERATION_TIMEOUT_BUFFER_MS;
    }

    if (Number.isSafeInteger(requestedTimeoutMs) && requestedTimeoutMs > 0) {
        return requestedTimeoutMs + WAIT_AUTO_OPERATION_TIMEOUT_BUFFER_MS;
    }

    return DEFAULT_AUTO_OPERATION_TIMEOUT_MS;
}

function normalizeSavedStockMoveItemCids(itemCids) {
    return [...new Set(
        (Array.isArray(itemCids) ? itemCids : [])
            .map((value) => Number(value))
            .filter((value) => Number.isSafeInteger(value) && value > 0)
    )];
}

function normalizeSavedStockMoveItems(items, itemCids) {
    const allowedItemCids = new Set(itemCids);
    const normalizedItems = [];
    const seenItemCids = new Set();

    for (const item of Array.isArray(items) ? items : []) {
        const itemCid = Number(item?.itemCid);
        if (!allowedItemCids.has(itemCid) || seenItemCids.has(itemCid)) {
            continue;
        }

        normalizedItems.push({
            itemCid,
            name: typeof item?.name === 'string' ? item.name : '',
            quality: typeof item?.quality === 'string' ? item.quality : '',
            type: typeof item?.type === 'string' ? item.type : '',
            sizeKey: typeof item?.sizeKey === 'string' ? item.sizeKey : '',
        });
        seenItemCids.add(itemCid);
    }

    return normalizedItems;
}

function normalizeSavedStockMoveList(value) {
    const id = String(value?.id || '').trim();
    const name = String(value?.name || '').trim();
    const savedAt = typeof value?.savedAt === 'string' ? value.savedAt.trim() : '';
    const itemCids = normalizeSavedStockMoveItemCids(value?.itemCids);

    if (!id || !name || !savedAt || !itemCids.length) {
        return null;
    }

    return {
        id,
        name,
        savedAt,
        itemCids,
        items: normalizeSavedStockMoveItems(value?.items, itemCids),
    };
}



async function writeJsonFileAtomically(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
        await fs.promises.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
        await fs.promises.rename(tempPath, filePath);
    } catch (error) {
        try {
            await fs.promises.unlink(tempPath);
        } catch (_cleanupError) {}
        throw error;
    }
}

async function saveStockMoveList(payload = {}, deps = {}) {
    const documentsDir = deps.documentsDir || process.env.BIDKING_DOCUMENTS_DIR;
    if (!documentsDir) {
        throw new Error('Documents directory is not available.');
    }

    const name = String(payload.name || '').trim();
    if (!name) {
        throw new Error('name is required');
    }

    const itemCids = normalizeSavedStockMoveItemCids(payload.itemCids);
    if (!itemCids.length) {
        throw new Error('itemCids is required');
    }

    const savedAt = new Date().toISOString();
    const id = `${savedAt.replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
    const value = {
        id,
        name,
        savedAt,
        itemCids,
        items: normalizeSavedStockMoveItems(payload.items, itemCids),
    };

    const listDir = getStockMoveListsDir(documentsDir);
    const outputPath = path.join(listDir, `${id}.json`);
    await fs.promises.mkdir(listDir, { recursive: true });
    await writeJsonFileAtomically(outputPath, value);
    return { ok: true, value };
}

async function listStockMoveLists(deps = {}) {
    const documentsDir = deps.documentsDir || process.env.BIDKING_DOCUMENTS_DIR;
    if (!documentsDir) {
        throw new Error('Documents directory is not available.');
    }

    const listDir = getStockMoveListsDir(documentsDir);

    try {
        const names = await fs.promises.readdir(listDir);
        const entries = [];

        for (const name of names) {
            if (!name.endsWith('.json')) {
                continue;
            }

            try {
                const value = await readJsonFile(path.join(listDir, name));
                const normalizedValue = normalizeSavedStockMoveList(value);
                if (normalizedValue) {
                    entries.push(normalizedValue);
                } else {
                    console.warn('[inject] Skipping invalid stock move saved list file', path.join(listDir, name));
                }
            } catch (error) {
                console.warn(
                    '[inject] Skipping stock move saved list file',
                    path.join(listDir, name),
                    error?.message || error
                );
            }
        }

        entries.sort((left, right) => String(right.savedAt || '').localeCompare(String(left.savedAt || '')));
        return { ok: true, value: entries };
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return { ok: true, value: [] };
        }
        throw error;
    }
}

function writeAutoOperationFrame(socket, json) {
    const body = Buffer.from(json, 'utf8');
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(body.length, 0);
    socket.write(Buffer.concat([header, body]));
}

async function sendAutoOperationCommand(command, args = {}, deps = {}) {
    const netImpl = deps.net || net;
    const pipeName = deps.pipeName || AUTO_OPERATION_PIPE;
    const timeoutMs = deps.timeoutMs ?? DEFAULT_AUTO_OPERATION_TIMEOUT_MS;
    const id = String(deps.id || Date.now());
    const payload = JSON.stringify({ id, cmd: command, args: args || {} });

    return new Promise((resolve, reject) => {
        const socket = netImpl.createConnection(pipeName);
        let chunks = Buffer.alloc(0);
        let settled = false;

        function finish(error, value) {
            if (settled) return;
            settled = true;
            socket.destroy?.();
            if (error) reject(error);
            else resolve(value);
        }

        socket.setTimeout?.(timeoutMs, () => finish(new Error('AutoOperation Agent ping timed out')));
        socket.once?.('connect', () => writeAutoOperationFrame(socket, payload));
        socket.on?.('data', (chunk) => {
            chunks = Buffer.concat([chunks, chunk]);
            while (chunks.length >= 4) {
                const length = chunks.readUInt32LE(0);
                if (length <= 0 || length > MAX_AUTO_OPERATION_FRAME_BYTES) {
                    finish(new Error('Invalid AutoOperation Agent response frame'));
                    return;
                }
                if (chunks.length < 4 + length) return;

                const frame = chunks.subarray(4, 4 + length).toString('utf8');
                chunks = chunks.subarray(4 + length);

                try {
                    const message = JSON.parse(frame);
                    if (message?.id === id) {
                        finish(null, message);
                        return;
                    }
                } catch (error) {
                    finish(error);
                    return;
                }
            }
        });
        socket.once?.('error', (error) => finish(error));
        socket.once?.('close', () => {
            if (!settled) finish(new Error('AutoOperation Agent connection closed'));
        });
    });
}

function getAutoOperationCommandTimeoutMs(command, args = {}, deps = {}) {
    if (deps.timeoutMs !== undefined) return deps.timeoutMs;
    if (isWaitAutoOperationCommand(command)) {
        return getWaitAutoOperationCommandTimeoutMs(args);
    }
    if (command === 'GetCollectionItemCids' ||
        command === 'GetItemTradeInfo' ||
        command === 'GetWarehouseItemList' ||
        command === 'GetStockCollectibleCounts' ||
        command === 'GetStockContainers' ||
        command === 'MoveStockItem' ||
        command === 'CollectCabinetReward') {
        return LONG_AUTO_OPERATION_TIMEOUT_MS;
    }
    if (command === 'AutoAuction') {
        return AUTO_AUCTION_TIMEOUT_MS;
    }
    if (command === 'ExchangeItem') {
        const nativeTimeoutMs = clampSafeInteger(
            args?.timeoutMs,
            EXCHANGE_ITEM_MIN_NATIVE_TIMEOUT_MS,
            EXCHANGE_ITEM_MAX_NATIVE_TIMEOUT_MS,
            EXCHANGE_ITEM_DEFAULT_NATIVE_TIMEOUT_MS
        );
        return nativeTimeoutMs * 3 + EXCHANGE_ITEM_TIMEOUT_BUFFER_MS;
    }
    return DEFAULT_AUTO_OPERATION_TIMEOUT_MS;
}

async function pingAutoOperationAgent(deps = {}) {
    const response = await (deps.sendAutoOperationCommand || sendAutoOperationCommand)('Ping', {}, deps);
    if (response?.ok === false) {
        throw new Error(response.error || 'AutoOperation Agent ping failed');
    }
    return {
        ok: true,
        value: response?.result || {},
        response,
    };
}

function isAutoOperationAgentUnavailableError(error) {
    const code = String(error?.code || '').toLowerCase();
    if (code === 'enoent' || code === 'econnrefused') {
        return true;
    }

    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('enoent') ||
        message.includes('no such file') ||
        message.includes('cannot find the file') ||
        message.includes('connect econnrefused') ||
        message.includes('pipe not found') ||
        (message.includes('pipe') && message.includes('not found'));
}

async function waitForAutoOperationAgentToUnload(deps = {}) {
    const timeoutMs = clampSafeInteger(deps.unloadTimeoutMs, 0, 60000, 10000);
    const pollIntervalMs = clampSafeInteger(deps.unloadPollIntervalMs, 1, 5000, 100);
    const graceMs = clampSafeInteger(deps.unloadGraceMs, 0, 5000, 500);
    const pingTimeoutMs = clampSafeInteger(deps.unloadPingTimeoutMs, 1, 5000, 500);
    const deadline = Date.now() + timeoutMs;
    let lastPingError = null;

    while (Date.now() <= deadline) {
        try {
            await pingAutoOperationAgent({
                ...deps,
                timeoutMs: pingTimeoutMs,
            });
        } catch (error) {
            if (isAutoOperationAgentUnavailableError(error)) {
                if (graceMs > 0) await delay(graceMs);
                return;
            }
            lastPingError = error;
        }
        await delay(pollIntervalMs);
    }

    const timeoutError = new Error('AutoOperation Agent did not unload before timeout');
    if (lastPingError) {
        timeoutError.cause = lastPingError;
    }
    throw timeoutError;
}

async function runAutoOperationCommand(command, args = {}, deps = {}) {
    if (!command || typeof command !== 'string') {
        throw new Error('AutoOperation command is required');
    }
    const commandArgs = args || {};
    const commandDeps = {
        ...deps,
        timeoutMs: getAutoOperationCommandTimeoutMs(command, commandArgs, deps),
    };
    const response = await (deps.sendAutoOperationCommand || sendAutoOperationCommand)(command, commandArgs, commandDeps);
    if (response?.ok === false) {
        throw new Error(response.error || `AutoOperation command failed: ${command}`);
    }
    const result = {
        ok: true,
        value: response?.result || {},
        response,
    };

    if (command === 'UnloadAgent') {
        await waitForAutoOperationAgentToUnload(deps);
        return {
            ...result,
            value: {
                ...result.value,
                unloaded: true,
            },
        };
    }

    return result;
}

async function unloadAutoOperationAgent(deps = {}) {
    const delayMs = clampSafeInteger(deps.delayMs, 0, 5000, 200);
    try {
        return await runAutoOperationCommand('UnloadAgent', { delayMs }, {
            ...deps,
            timeoutMs: deps.timeoutMs ?? 2000,
        });
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }
}


async function waitForAutoOperationPing(deps = {}) {
    const timeoutMs = deps.agentTimeoutMs ?? 8000;
    const pollIntervalMs = deps.agentPollIntervalMs ?? 250;
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() <= deadline) {
        try {
            return await pingAutoOperationAgent(deps);
        } catch (error) {
            lastError = error;
            await delay(pollIntervalMs);
        }
    }

    throw lastError || new Error('AutoOperation Agent ping timed out');
}

async function startAutoOperationAgent(deps = {}) {
    try {
        const ping = await pingAutoOperationAgent(deps);
        return { ...ping, reused: true };
    } catch (_error) {
        // No reachable agent yet; continue with injection.
    }

    const injection = await runInjector('AutoOperationAgent', {
        ...deps,
        dllPath: deps.dllPath || getRuntimePath('tools', 'inject', 'AutoOperation', 'BKAutoOpAgent', 'BKAutoOpAgent.dll'),
    });
    try {
        const ping = await waitForAutoOperationPing(deps);
        return { ...ping, injection };
    } catch (error) {
        const output = injection?.output ? ` Injector output: ${injection.output}` : '';
        throw new Error(`${error?.message || String(error)}.${output}`.trim());
    }
}

async function refreshItemTradeInfo(itemCid, deps = {}) {
    const cid = parseRequiredPositiveSafeInteger(Number(itemCid), 'itemCid is required');
    await (deps.startAutoOperationAgent || startAutoOperationAgent)(deps);
    const response = await (deps.runAutoOperationCommand || runAutoOperationCommand)(
        'GetItemTradeInfo',
        { itemCid: cid },
        deps
    );
    const written = (deps.recordTradeInfoSnapshot || defaultRecordTradeInfoSnapshot)(response?.value);
    if (written?.ok === false) {
        throw new Error(written.error || 'failed to record trade info snapshot');
    }
    return { ok: true, value: written };
}

function getCollectionPriceScanController(deps = {}) {
    if (!deps.controller) {
        throw new Error('Collection price scan controller is unavailable');
    }
    return deps.controller;
}

async function startCollectionPriceScan(config = {}, deps = {}) {
    return getCollectionPriceScanController(deps).start(config);
}

function stopCollectionPriceScan(deps = {}) {
    return getCollectionPriceScanController(deps).stop();
}

function getCollectionPriceScanStatus(deps = {}) {
    return getCollectionPriceScanController(deps).getState();
}

function updateCollectionPriceScanConfig(config = {}, deps = {}) {
    return getCollectionPriceScanController(deps).updateConfig(config);
}

async function runCabinetRewardCommand(command, deps = {}) {
    const documentsDir = deps.documentsDir || process.env.BIDKING_DOCUMENTS_DIR;
    if (!documentsDir) {
        throw new Error('Documents directory is not available.');
    }

    const outputPath = getCabinetRewardPath(documentsDir);
    const startedAt = Date.now();
    await runInjector(command, {
        ...deps,
        dllPath: deps.dllPath || getRuntimePath('tools', 'inject', 'BKCabinetRewardPayload64', 'BKCabinetRewardPayload64.dll'),
    });
    const value = await waitForJsonFile(outputPath, startedAt, {
        timeoutMs: deps.timeoutMs ?? 45000,
        pollIntervalMs: deps.pollIntervalMs,
    });
    const ok = value?.ok !== false;
    return {
        ok,
        error: ok ? undefined : value?.error,
        path: outputPath,
        value,
    };
}

async function queryCabinetReward(deps = {}) {
    return runCabinetRewardCommand('CabinetReward', deps);
}

async function claimCabinetReward(deps = {}) {
    return runCabinetRewardCommand('ClaimCabinetReward', deps);
}

module.exports = {
    claimCabinetReward,
    getCabinetRewardPath,
    getCollectionPriceScanStatus,
    listStockMoveLists,
    pingAutoOperationAgent,
    queryCabinetReward,
    queryTradeInfo,
    refreshItemTradeInfo,
    runAutoOperationCommand,
    runInjector,
    saveStockMoveList,
    sendAutoOperationCommand,
    startAutoOperationAgent,
    startCollectionPriceScan,
    stopCollectionPriceScan,
    unloadAutoOperationAgent,
    updateCollectionPriceScanConfig,
};
