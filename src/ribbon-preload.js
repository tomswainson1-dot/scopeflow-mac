const { contextBridge, ipcRenderer } = require("electron");

let state = { back: false, forward: false };
const listeners = new Set();

ipcRenderer.on("scopeflow-nav-state", (_event, next) => {
  state = next && typeof next === "object" ? next : state;
  for (const listener of listeners) listener(state);
});

contextBridge.exposeInMainWorld("scopeflowRibbon", {
  back() {
    ipcRenderer.send("scopeflow-nav", "back");
  },
  forward() {
    ipcRenderer.send("scopeflow-nav", "forward");
  },
  onState(listener) {
    listeners.add(listener);
    listener(state);
  },
});
