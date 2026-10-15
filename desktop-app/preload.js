const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  pickKey: () => ipcRenderer.invoke('key:pick'),
  connect: () => ipcRenderer.invoke('connect'),
  testOllama: () => ipcRenderer.invoke('ollama:test'),
  openMap: (lat, lng) => ipcRenderer.invoke('map:open', lat, lng),
  analyze: (id) => ipcRenderer.invoke('analyze', id),
  onComplaints: (cb) => ipcRenderer.on('complaints', (_, d) => cb(d)),
  onLog: (cb) => ipcRenderer.on('log', (_, m) => cb(m)),
});
