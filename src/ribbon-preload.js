const { contextBridge, ipcRenderer } = require("electron");

let state = { back: false, forward: false };
const listeners = new Set();
/** Restart to Update on the ribbon (4 Nov 2026): null, or { label, title } while an update is waiting. */
let update = null;
const updateListeners = new Set();

ipcRenderer.on("scopeflow-nav-state", (_event, next) => {
  state = next && typeof next === "object" ? next : state;
  for (const listener of listeners) listener(state);
});

ipcRenderer.on("scopeflow-update-button", (_event, next) => {
  update = next && typeof next === "object" ? next : null;
  for (const listener of updateListeners) listener(update);
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
  update() {
    ipcRenderer.send("scopeflow-update-click");
  },
  onUpdate(listener) {
    updateListeners.add(listener);
    listener(update);
  },
});
