const { contextBridge, ipcRenderer } = require("electron");

/** The Settings window's only way to the app (src/settings-window.js). */
contextBridge.exposeInMainWorld("scopeflowSettings", {
  load: () => ipcRenderer.invoke("scopeflow-settings-load"),
  save: (patch) => ipcRenderer.invoke("scopeflow-settings-save", patch),
  checkNow: () => ipcRenderer.invoke("scopeflow-update-check"),
  restart: () => ipcRenderer.invoke("scopeflow-update-restart"),
  onStatus(listener) {
    ipcRenderer.on("scopeflow-update-status", (_event, view) => listener(view));
  },
});
