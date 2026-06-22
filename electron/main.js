const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Notification, screen } = require('electron');
const {
    claimCabinetReward,
    getCollectionPriceScanStatus,
    listStockMoveLists,
    queryCabinetReward,
    queryTradeInfo,
    refreshItemTradeInfo,
    runAutoOperationCommand,
    saveStockMoveList,
    startAutoOperationAgent,
    startCollectionPriceScan,
    stopCollectionPriceScan,
    unloadAutoOperationAgent,
    updateCollectionPriceScanConfig,
} = require('./services/inject-service');
const { createCollectionPriceScanController } = require('./services/collection-price-scan-controller');
const {
    recordCollectionCids,
    recordTradeInfoSnapshot,
} = require('../lib/trade-info-history-recorder');
const scheduler = require('./services/inject-scheduler');
scheduler.init(async () => {
    writeStartupLog('[inject] starting');
    try {
        const result = await queryTradeInfo();
        writeStartupLog('[inject] ok', result?.output || '');
        return result;
    } catch (err) {
        writeStartupLog('[inject] error', err.message);
        throw err;
    }
});
const {
    buildLatestScreenshotPayload: buildScreenshotPayload,
    createScreenshotErrorPayload: createScreenshotErrorPayloadBase,
    formatLogPart,
    getLatestScreenshotKey: getScreenshotKey,
    getLatestScreenshotPayload: createLatestScreenshotPayload,
    imageToDataUrl,
    isAhmedUrl,
    isEthanUrl,
} = require('./desktop-utils');
const { showDesktopNotification } = require('./services/desktop-notification');
const { raiseAndFocusWindow } = require('./services/window-focus');
const startupLogPath = path.join(os.tmpdir(), 'bidking-electron.log');
const screenshotHotkey = process.env.BIDKING_SCREENSHOT_HOTKEY || 'CommandOrControl+Shift+A';
const regionScreenshotHotkey =
    process.env.BIDKING_REGION_SCREENSHOT_HOTKEY || 'CommandOrControl+Shift+S';
const ahmedRegionScreenshotHotkey =
    process.env.BIDKING_AHMED_REGION_SCREENSHOT_HOTKEY || 'F2';

function writeStartupLog(...parts) {
    try {
        fs.appendFileSync(
            startupLogPath,
            `[${new Date().toISOString()}] ${parts.map(formatLogPart).join(' ')}\n`
        );
    } catch (_error) {
        // Logging must never block startup.
    }
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('enable-logging');
app.commandLine.appendSwitch('log-file', startupLogPath);

process.env.BIDKING_RUNTIME_ROOT = app.isPackaged
    ? path.join(process.resourcesPath, 'runtime')
    : path.join(__dirname, '..');
process.env.BIDKING_APP_ROOT = app.isPackaged
    ? path.dirname(process.execPath)
    : path.join(__dirname, '..');
process.env.BIDKING_DOCUMENTS_DIR = app.getPath('documents');
const appIconPath = path.join(__dirname, '..', 'BidKing.png');

const { startServer } = require('../server');

let mainWindow = null;
let serverHandle = null;
let serverUrl = null;
let latestScreenshot = null;
let screenshotCaptureInProgress = false;
let screenshotHotkeyRegistered = false;
let regionScreenshotHotkeyRegistered = false;
let ahmedRegionScreenshotHotkeyRegistered = false;
let lastScreenshotError = null;
let regionSelectionSession = null;
let beforeQuitCleanupStarted = false;
let beforeQuitCleanupComplete = false;
const collectionPriceScanController = createCollectionPriceScanController({
    startAutoOperationAgent,
    runAutoOperationCommand,
    recordCollectionCids,
    recordTradeInfoSnapshot,
});

collectionPriceScanController.subscribe((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
        try {
            window.webContents.send('inject:collectionPriceScanState', state);
        } catch (_) {}
    }
});

process.on('uncaughtException', (error) => {
    writeStartupLog('uncaughtException', error);
});

process.on('unhandledRejection', (error) => {
    writeStartupLog('unhandledRejection', error);
});

async function startEmbeddedServer() {
    return startServer(0, '127.0.0.1');
}

async function listCaptureSources() {
    const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        fetchWindowIcons: true,
        thumbnailSize: { width: 360, height: 240 }
    });

    return sources.map((source) => ({
        id: source.id,
        name: source.name,
        displayId: source.display_id || null,
        appIconDataUrl: imageToDataUrl(source.appIcon),
        thumbnailDataUrl: imageToDataUrl(source.thumbnail)
    }));
}

async function getScreenSourceForDisplay(targetDisplay, thumbnailSize) {
    const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize
    });

    const targetSource =
        sources.find((source) => source.display_id === String(targetDisplay.id)) ||
        sources[0];

    if (!targetSource || !targetSource.thumbnail || targetSource.thumbnail.isEmpty()) {
        throw new Error('Unable to capture screenshot from desktop source.');
    }

    return targetSource;
}

function getLatestScreenshotPayload(withDataUrl = true) {
    return createLatestScreenshotPayload(latestScreenshot, withDataUrl);
}

function getLatestScreenshotKey() {
    return getScreenshotKey(latestScreenshot);
}

function isAhmedPageActive() {
    return Boolean(
        mainWindow &&
        !mainWindow.isDestroyed() &&
        isAhmedUrl(mainWindow.webContents.getURL())
    );
}

function isEthanPageActive() {
    return Boolean(
        mainWindow &&
        !mainWindow.isDestroyed() &&
        isEthanUrl(mainWindow.webContents.getURL())
    );
}

function broadcastToAllWindows(channel, payload) {
    for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(channel, payload);
    }
}

function broadcastScreenshotCaptured() {
    const payload = getLatestScreenshotPayload(false);
    if (!payload) {
        return;
    }

    broadcastToAllWindows('desktop:screenshotCaptured', payload);
}

function getScreenshotStatus() {
    return {
        hotkey: screenshotHotkey,
        registered: screenshotHotkeyRegistered,
        regionHotkey: regionScreenshotHotkey,
        regionHotkeyRegistered: regionScreenshotHotkeyRegistered,
        ahmedRegionHotkey: ahmedRegionScreenshotHotkey,
        ahmedRegionHotkeyRegistered: ahmedRegionScreenshotHotkeyRegistered,
        ahmedRegionHotkeyEnabled: isAhmedPageActive(),
        ethanPageActive: isEthanPageActive(),
        captureInProgress: screenshotCaptureInProgress,
        regionSelectionActive: Boolean(regionSelectionSession),
        hasScreenshot: Boolean(latestScreenshot),
        latestScreenshot: getLatestScreenshotPayload(false),
        lastError: lastScreenshotError
    };
}

function createScreenshotErrorPayload(error, extra = {}) {
    return createScreenshotErrorPayloadBase(error, {
        hotkey: screenshotHotkey,
        ...extra
    });
}

function setLastScreenshotError(error, extra = {}) {
    lastScreenshotError = createScreenshotErrorPayload(error, extra);
    writeStartupLog('screenshot-error', lastScreenshotError);
    broadcastToAllWindows('desktop:screenshotCaptureFailed', lastScreenshotError);
}

function buildLatestScreenshotPayload({
    image,
    displayId,
    sourceId,
    hotkey = screenshotHotkey,
    captureMode = 'full-screen'
}) {
    return buildScreenshotPayload({
        image,
        displayId,
        sourceId,
        hotkey,
        captureMode,
    });
}

function commitLatestScreenshot(nextScreenshot) {
    latestScreenshot = nextScreenshot;
    lastScreenshotError = null;

    writeStartupLog('screenshot-captured', {
        hotkey: latestScreenshot.hotkey,
        displayId: latestScreenshot.displayId,
        width: latestScreenshot.width,
        height: latestScreenshot.height,
        byteLength: latestScreenshot.pngBuffer.length,
        captureMode: latestScreenshot.captureMode
    });

    broadcastScreenshotCaptured();
}

function closeRegionSelectionWindows() {
    if (!regionSelectionSession) {
        return;
    }

    const session = regionSelectionSession;
    session.closing = true;

    for (const entry of session.windows.values()) {
        if (!entry.window.isDestroyed()) {
            entry.window.close();
        }
    }
}

function resolveRegionSelection(result) {
    if (!regionSelectionSession) {
        return;
    }

    const session = regionSelectionSession;
    regionSelectionSession = null;
    session.resolve(result);
}

function cancelRegionSelection(reason = 'cancelled') {
    if (!regionSelectionSession) {
        return;
    }

    closeRegionSelectionWindows();
    resolveRegionSelection({ ok: false, cancelled: true, reason });
}

async function captureRegionScreenshot(entry, rect) {
    const { display } = entry;
    const scaleFactor = display.scaleFactor || 1;
    const thumbnailSize = {
        width: Math.max(1, Math.floor(display.size.width * scaleFactor)),
        height: Math.max(1, Math.floor(display.size.height * scaleFactor))
    };
    const targetSource = await getScreenSourceForDisplay(display, thumbnailSize);

    const cropRect = {
        x: Math.max(0, Math.round(rect.left * scaleFactor)),
        y: Math.max(0, Math.round(rect.top * scaleFactor)),
        width: Math.max(1, Math.round(rect.width * scaleFactor)),
        height: Math.max(1, Math.round(rect.height * scaleFactor))
    };
    const imageSize = targetSource.thumbnail.getSize();

    cropRect.width = Math.min(cropRect.width, imageSize.width - cropRect.x);
    cropRect.height = Math.min(cropRect.height, imageSize.height - cropRect.y);

    if (cropRect.width < 1 || cropRect.height < 1) {
        throw new Error('Selected region is empty.');
    }

    const croppedImage = targetSource.thumbnail.crop(cropRect);
    commitLatestScreenshot(buildLatestScreenshotPayload({
        image: croppedImage,
        displayId: display.id,
        sourceId: targetSource.id,
        hotkey: null,
        captureMode: 'region'
    }));

    return getLatestScreenshotPayload(false);
}

async function completeRegionSelection(webContentsId, rect) {
    if (!regionSelectionSession || regionSelectionSession.closing) {
        return;
    }

    const entry = regionSelectionSession.windows.get(webContentsId);
    if (!entry) {
        return;
    }

    try {
        const screenshot = await captureRegionScreenshot(entry, rect);
        closeRegionSelectionWindows();
        resolveRegionSelection({ ok: true, cancelled: false, screenshot });
    } catch (error) {
        setLastScreenshotError(error, { captureMode: 'region' });
        closeRegionSelectionWindows();
        resolveRegionSelection({
            ok: false,
            cancelled: false,
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

function createRegionSelectionWindow(display) {
    const selectionWindow = new BrowserWindow({
        show: false,
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: true,
        skipTaskbar: true,
        focusable: true,
        alwaysOnTop: true,
        hasShadow: false,
        roundedCorners: false,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: path.join(__dirname, 'region-selector-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    selectionWindow.setMenuBarVisibility(false);
    selectionWindow.setAlwaysOnTop(true, 'screen-saver');
    selectionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    selectionWindow.loadFile(path.join(__dirname, 'region-selector.html')).catch((error) => {
        writeStartupLog('region-selector-load-failed', error);
        setImmediate(() => {
            if (regionSelectionSession) {
                cancelRegionSelection('load-failed');
            }
        });
    });

    return selectionWindow;
}

function startRegionSelection() {
    if (regionSelectionSession) {
        return Promise.resolve({ ok: false, cancelled: false, error: 'Region selection is already active.' });
    }

    return new Promise((resolve) => {
        const windows = new Map();
        regionSelectionSession = {
            windows,
            resolve,
            closing: false
        };

        for (const display of screen.getAllDisplays()) {
            const window = createRegionSelectionWindow(display);
            windows.set(window.webContents.id, { window, display });

            window.once('ready-to-show', () => {
                window.show();
                window.focus();
            });

            window.on('closed', () => {
                const session = regionSelectionSession;
                if (!session) {
                    return;
                }

                session.windows.delete(window.webContents.id);
                if (!session.closing) {
                    cancelRegionSelection('window-closed');
                }
            });
        }
    });
}

async function captureScreenshotToMemory() {
    if (regionSelectionSession) {
        writeStartupLog('screenshot-capture-skipped', 'region selection is active');
        return getLatestScreenshotPayload(false);
    }

    if (screenshotCaptureInProgress) {
        writeStartupLog('screenshot-capture-skipped', 'capture already in progress');
        return getLatestScreenshotPayload(false);
    }

    screenshotCaptureInProgress = true;

    try {
        const cursorPoint = screen.getCursorScreenPoint();
        const targetDisplay = screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay();
        const scaleFactor = targetDisplay.scaleFactor || 1;
        const thumbnailSize = {
            width: Math.max(1, Math.floor(targetDisplay.size.width * scaleFactor)),
            height: Math.max(1, Math.floor(targetDisplay.size.height * scaleFactor))
        };
        const targetSource = await getScreenSourceForDisplay(targetDisplay, thumbnailSize);

        commitLatestScreenshot(buildLatestScreenshotPayload({
            image: targetSource.thumbnail,
            displayId: targetDisplay.id,
            sourceId: targetSource.id,
            hotkey: screenshotHotkey,
            captureMode: 'full-screen'
        }));
        return getLatestScreenshotPayload(false);
    } catch (error) {
        setLastScreenshotError(error);
        throw error;
    } finally {
        screenshotCaptureInProgress = false;
    }
}

function clearLatestScreenshot() {
    latestScreenshot = null;
    writeStartupLog('screenshot-cleared');
}

function unregisterAhmedGlobalShortcut() {
    globalShortcut.unregister(ahmedRegionScreenshotHotkey);
    ahmedRegionScreenshotHotkeyRegistered = false;
}

function updateAhmedGlobalShortcutRegistration() {
    const shouldRegister = isAhmedPageActive();

    if (!shouldRegister) {
        if (ahmedRegionScreenshotHotkeyRegistered) {
            unregisterAhmedGlobalShortcut();
            writeStartupLog('global-shortcut-unregistered', ahmedRegionScreenshotHotkey);
        }
        return;
    }

    if (ahmedRegionScreenshotHotkeyRegistered) {
        return;
    }

    ahmedRegionScreenshotHotkeyRegistered = globalShortcut.register(ahmedRegionScreenshotHotkey, () => {
        if (regionSelectionSession) {
            writeStartupLog('region-selection-skipped', 'region selection is already active');
            return;
        }

        startRegionSelection().catch((error) => {
            writeStartupLog('region-selection-failed', error);
        });
    });

    if (!ahmedRegionScreenshotHotkeyRegistered) {
        writeStartupLog('global-shortcut-register-failed', ahmedRegionScreenshotHotkey);
    } else {
        writeStartupLog('global-shortcut-registered', ahmedRegionScreenshotHotkey);
    }
}

function registerGlobalShortcuts() {
    screenshotHotkeyRegistered = globalShortcut.register(screenshotHotkey, () => {
        if (regionSelectionSession) {
            writeStartupLog('screenshot-capture-skipped', 'region selection is active');
            return;
        }

        captureScreenshotToMemory().catch((error) => {
            writeStartupLog('screenshot-capture-failed', error);
        });
    });

    if (!screenshotHotkeyRegistered) {
        writeStartupLog('global-shortcut-register-failed', screenshotHotkey);
    } else {
        writeStartupLog('global-shortcut-registered', screenshotHotkey);
    }

    regionScreenshotHotkeyRegistered = globalShortcut.register(regionScreenshotHotkey, () => {
        if (regionSelectionSession) {
            writeStartupLog('region-selection-skipped', 'region selection is already active');
            return;
        }

        startRegionSelection().catch((error) => {
            writeStartupLog('region-selection-failed', error);
        });
    });

    if (!regionScreenshotHotkeyRegistered) {
        writeStartupLog('global-shortcut-register-failed', regionScreenshotHotkey);
    } else {
        writeStartupLog('global-shortcut-registered', regionScreenshotHotkey);
    }

    updateAhmedGlobalShortcutRegistration();
}

function registerIpc() {
    ipcMain.handle('app:getRuntimeInfo', () => ({
        isDesktop: true,
        serverUrl,
        screenshotHotkey,
        screenshotHotkeyRegistered,
        regionScreenshotHotkey,
        regionScreenshotHotkeyRegistered,
        ahmedRegionScreenshotHotkey,
        ahmedRegionScreenshotHotkeyRegistered,
        platform: process.platform,
        versions: {
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node
        }
    }));

    ipcMain.handle('desktop:listCaptureSources', async () => listCaptureSources());
    ipcMain.handle('desktop:captureScreenshot', async () => captureScreenshotToMemory());
    ipcMain.handle('desktop:startRegionSelection', async () => startRegionSelection());
    ipcMain.handle('desktop:getLatestScreenshot', async () => getLatestScreenshotPayload(true));
    ipcMain.handle('desktop:getLatestScreenshotInfo', async () => getLatestScreenshotPayload(false));
    ipcMain.handle('desktop:getScreenshotStatus', async () => getScreenshotStatus());
    ipcMain.handle('desktop:clearLatestScreenshot', async () => {
        clearLatestScreenshot();
        return true;
    });
    ipcMain.on('region-selector:complete', (event, rect) => {
        completeRegionSelection(event.sender.id, rect);
    });
    ipcMain.on('region-selector:cancel', (_event, payload) => {
        cancelRegionSelection(payload?.reason || 'cancelled');
    });
    ipcMain.handle('inject:queryTradeInfo', async () => {
        try {
            return await queryTradeInfo();
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle('inject:queryCabinetReward', async () => {
        try {
            return await queryCabinetReward();
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle('inject:claimCabinetReward', async () => {
        try {
            return await claimCabinetReward();
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle('inject:listStockMoveLists', async () => {
        try {
            return await listStockMoveLists();
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle('inject:saveStockMoveList', async (_event, payload) => {
        try {
            return await saveStockMoveList(payload);
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle('inject:startAutoOperationAgent', async () => {
        try {
            writeStartupLog('start-auto-operation-agent');
            const result = await startAutoOperationAgent();
            writeStartupLog('start-auto-operation-agent-ok', result);
            return result;
        } catch (error) {
            writeStartupLog('start-auto-operation-agent-failed', error);
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle('inject:runAutoOperationCommand', async (_event, command, args) => {
        try {
            return await runAutoOperationCommand(command, args || {});
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle('inject:refreshItemTradeInfo', async (_event, itemCid) => {
        try {
            return await refreshItemTradeInfo(itemCid);
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });

    ipcMain.handle('inject:startCollectionPriceScan', async (_event, config) => {
        try {
            return await startCollectionPriceScan(config || {}, { controller: collectionPriceScanController });
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle('inject:stopCollectionPriceScan', () => {
        try {
            return stopCollectionPriceScan({ controller: collectionPriceScanController });
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle('inject:getCollectionPriceScanStatus', () => {
        try {
            return getCollectionPriceScanStatus({ controller: collectionPriceScanController });
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });
    ipcMain.handle('inject:updateCollectionPriceScanConfig', (_event, config) => {
        try {
            return updateCollectionPriceScanConfig(config || {}, { controller: collectionPriceScanController });
        } catch (error) {
            return { ok: false, error: error.message };
        }
    });

    function notifyAll(state) {
        BrowserWindow.getAllWindows().forEach(win => {
            try { win.webContents.send('inject:scheduleState', state); } catch (_) {}
        });
    }

    ipcMain.handle('inject:getScheduleState', () => scheduler.getState());

    ipcMain.handle('inject:setScheduleEnabled', (_event, enabled) => {
        scheduler.setEnabled(enabled, notifyAll);
        return scheduler.getState();
    });

    ipcMain.handle('inject:resetTimer', () => {
        scheduler.resetTimer(notifyAll);
        return scheduler.getState();
    });

    ipcMain.handle('app:writeDataFile', (_event, filename, content) => {
        const dir = path.join(app.getPath('documents'), 'BidKing');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, filename), String(content ?? ''), 'utf8');
    });
    ipcMain.handle('app:showNotification', (_event, payload) => {
        try {
            return showDesktopNotification(payload, { Notification });
        } catch (error) {
            return { ok: false, error: error?.message || String(error) };
        }
    });
    ipcMain.handle('app:focusMainWindow', () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return { ok: false, error: 'no window' };
        }
        raiseAndFocusWindow(mainWindow);
        return { ok: true };
    });
}

async function createMainWindow() {
    if (!serverHandle) {
        serverHandle = await startEmbeddedServer();
        serverUrl = `http://127.0.0.1:${serverHandle.port}`;
        writeStartupLog('server-started', serverUrl);
    }

    mainWindow = new BrowserWindow({
        show: false,
        width: 1680,
        height: 1080,
        minWidth: 1280,
        minHeight: 800,
        icon: appIconPath,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.once('ready-to-show', () => {
        writeStartupLog('window-ready-to-show');
        mainWindow.show();
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
        writeStartupLog('did-fail-load', { errorCode, errorDescription, validatedURL });
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        writeStartupLog('render-process-gone', details);
    });

    mainWindow.webContents.on('did-navigate', () => {
        updateAhmedGlobalShortcutRegistration();
    });

    mainWindow.webContents.on('did-navigate-in-page', () => {
        updateAhmedGlobalShortcutRegistration();
    });

    await mainWindow.loadURL(`${serverUrl}/`);
    writeStartupLog('load-url-complete', `${serverUrl}/`);
    updateAhmedGlobalShortcutRegistration();

    mainWindow.on('closed', () => {
        unregisterAhmedGlobalShortcut();
        writeStartupLog('window-closed');
        mainWindow = null;
    });
}

async function closeEmbeddedServer() {
    if (!serverHandle || !serverHandle.server) {
        return;
    }

    if (typeof serverHandle.stop === 'function') {
        await serverHandle.stop();
    } else {
        await new Promise((resolve) => {
            serverHandle.server.close(() => resolve());
        });
    }

    serverHandle = null;
    serverUrl = null;
}

async function performBeforeQuitCleanup() {
    cancelRegionSelection('quit');
    globalShortcut.unregisterAll();

    try {
        stopCollectionPriceScan({ controller: collectionPriceScanController });
    } catch (error) {
        writeStartupLog('stop-collection-scan-failed', error);
    }

    try {
        const result = await unloadAutoOperationAgent();
        writeStartupLog('unload-auto-operation-agent', result);
    } catch (error) {
        writeStartupLog('unload-auto-operation-agent-failed', error);
    }

    try {
        await closeEmbeddedServer();
    } catch (error) {
        writeStartupLog('close-server-failed', error);
        console.error(error);
    }
}

app.whenReady().then(async () => {
    writeStartupLog('app-when-ready');
    registerIpc();
    registerGlobalShortcuts();
    await createMainWindow();

    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            await createMainWindow();
        }
    });
}).catch((error) => {
    writeStartupLog('app-when-ready-failed', error);
    console.error(error);
    app.quit();
});

app.on('window-all-closed', () => {
    writeStartupLog('window-all-closed');
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', (event) => {
    writeStartupLog('before-quit');
    if (beforeQuitCleanupComplete) return;
    event.preventDefault();
    if (beforeQuitCleanupStarted) return;

    beforeQuitCleanupStarted = true;
    performBeforeQuitCleanup().finally(() => {
        beforeQuitCleanupComplete = true;
        app.quit();
    });
});

app.on('child-process-gone', (_event, details) => {
    writeStartupLog('child-process-gone', details);
});

app.on('gpu-process-crashed', (_event, killed) => {
    writeStartupLog('gpu-process-crashed', { killed });
});
