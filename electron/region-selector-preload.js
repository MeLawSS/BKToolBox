const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('regionSelector', {
    completeSelection: (rect) => ipcRenderer.send('region-selector:complete', rect),
    cancelSelection: (reason) => ipcRenderer.send('region-selector:cancel', { reason })
});
