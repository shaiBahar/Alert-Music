const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig:     ()           => ipcRenderer.invoke("getConfig"),
  saveConfig:    (config)     => ipcRenderer.invoke("saveConfig", config),
  saveMp3:       (buf, name)  => ipcRenderer.invoke("saveMp3", buf, name),
  testSound:     ()           => ipcRenderer.invoke("testSound"),
  scanDevices:   ()           => ipcRenderer.invoke("scanDevices"),
  getLocalIp:    ()           => ipcRenderer.invoke("getLocalIp"),
  onLog: (callback) =>
    ipcRenderer.on("log-message", (_, entry) => callback(entry)),
  onAlertData: (callback) =>
    ipcRenderer.on("alert-data", (_, cities) => callback(cities))
});
