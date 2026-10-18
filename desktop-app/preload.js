const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  pickKey: () => ipcRenderer.invoke('key:pick'),
  connect: () => ipcRenderer.invoke('connect'),
  testOllama: () => ipcRenderer.invoke('ollama:test'),
  analyze: (id) => ipcRenderer.invoke('analyze', id),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  addComplaint: (d) => ipcRenderer.invoke('complaint:add', d),
  onStaff: (cb) => ipcRenderer.on('staff', (_, d) => cb(d)),
  onComplaints: (cb) => ipcRenderer.on('complaints', (_, d) => cb(d)),
  onLog: (cb) => ipcRenderer.on('log', (_, m) => cb(m)),
});
