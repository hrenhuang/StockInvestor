const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stockInvestor', {
  getStockFilePath: () => ipcRenderer.invoke('app:get-stock-file-path'),
  saveStock: (payload) => ipcRenderer.invoke('stocks:save', payload),
  removeStock: (payload) => ipcRenderer.invoke('stocks:remove', payload),
  calculateSummary: () => ipcRenderer.invoke('stocks:summary')
});
