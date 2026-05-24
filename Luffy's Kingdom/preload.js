const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listPartitions: () => ipcRenderer.invoke('list-partitions'),
  loadAccounts: () => ipcRenderer.invoke('load-accounts'),
  saveAccounts: (data) => ipcRenderer.invoke('save-accounts', data),
});
