const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bidkingDesktop', {
    isDesktop: true,
    getRuntimeInfo: () => ipcRenderer.invoke('app:getRuntimeInfo'),
    listCaptureSources: () => ipcRenderer.invoke('desktop:listCaptureSources'),
    captureScreenshot: () => ipcRenderer.invoke('desktop:captureScreenshot'),
    startRegionSelection: () => ipcRenderer.invoke('desktop:startRegionSelection'),
    getLatestScreenshot: () => ipcRenderer.invoke('desktop:getLatestScreenshot'),
    getLatestScreenshotInfo: () => ipcRenderer.invoke('desktop:getLatestScreenshotInfo'),
    getScreenshotStatus: () => ipcRenderer.invoke('desktop:getScreenshotStatus'),
    clearLatestScreenshot: () => ipcRenderer.invoke('desktop:clearLatestScreenshot'),
    queryTradeInfo: () => ipcRenderer.invoke('inject:queryTradeInfo'),
    listStockMoveLists: () => ipcRenderer.invoke('inject:listStockMoveLists'),
    saveStockMoveList: (payload) => ipcRenderer.invoke('inject:saveStockMoveList', payload),
    getScheduleState: () => ipcRenderer.invoke('inject:getScheduleState'),
    setScheduleEnabled: (enabled) => ipcRenderer.invoke('inject:setScheduleEnabled', enabled),
    resetInjectionTimer: () => ipcRenderer.invoke('inject:resetTimer'),
    startAutoOperationAgent: () => ipcRenderer.invoke('inject:startAutoOperationAgent'),
    runAutoOperationCommand: (command, args = {}) => ipcRenderer.invoke('inject:runAutoOperationCommand', command, args),
    captureCollectionCidsToFile: () => ipcRenderer.invoke('inject:captureCollectionCidsToFile'),
    refreshItemTradeInfo: (itemCid) => ipcRenderer.invoke('inject:refreshItemTradeInfo', itemCid),

    startCollectionPriceScan: (config) => ipcRenderer.invoke('inject:startCollectionPriceScan', config),
    stopCollectionPriceScan: () => ipcRenderer.invoke('inject:stopCollectionPriceScan'),
    getCollectionPriceScanStatus: () => ipcRenderer.invoke('inject:getCollectionPriceScanStatus'),
    updateCollectionPriceScanConfig: (config) => ipcRenderer.invoke('inject:updateCollectionPriceScanConfig', config),
    onCollectionPriceScanState: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('inject:collectionPriceScanState', listener);
        return () => ipcRenderer.removeListener('inject:collectionPriceScanState', listener);
    },
    onScheduleState: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('inject:scheduleState', listener);
        return () => ipcRenderer.removeListener('inject:scheduleState', listener);
    },
    onScreenshotCaptured: (callback) => {
        if (typeof callback !== 'function') {
            return () => {};
        }

        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('desktop:screenshotCaptured', listener);
        return () => ipcRenderer.removeListener('desktop:screenshotCaptured', listener);
    },
    writeDataFile: (filename, content) => ipcRenderer.invoke('app:writeDataFile', filename, content),
    showNotification: (title, body) => ipcRenderer.invoke('app:showNotification', { title, body }),
    focusMainWindow: () => ipcRenderer.invoke('app:focusMainWindow'),
    onScreenshotCaptureFailed: (callback) => {
        if (typeof callback !== 'function') {
            return () => {};
        }

        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('desktop:screenshotCaptureFailed', listener);
        return () => ipcRenderer.removeListener('desktop:screenshotCaptureFailed', listener);
    }
});
