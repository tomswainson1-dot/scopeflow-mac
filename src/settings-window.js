/**
 * The Settings window (ScopeFlow → Settings…, Command-comma; 4 Nov 2026). It shows the update status with a Check Now
 * or Restart to Update button, and Settings → Updates. It is a small local page (src/settings.html) with no access to
 * Node; it talks to the app only through the four calls in src/settings-preload.js.
 */

const { BrowserWindow } = require("electron");
const path = require("path");

let win = null;

/**
 * @param {{create?: (make: () => Electron.BrowserWindow) => Electron.BrowserWindow}} [options]
 *   create wraps the constructor, so main.js can keep its suite-page guards off this window.
 */
function openSettingsWindow({ create = (make) => make() } = {}) {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return win;
  }
  const next = create(
    () =>
      new BrowserWindow({
        width: 540,
        height: 430,
        useContentSize: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: false,
        title: "Settings",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
          preload: path.join(__dirname, "settings-preload.js"),
        },
      })
  );
  win = next;
  next.webContents.on("will-navigate", (event) => event.preventDefault());
  next.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  next.once("ready-to-show", () => {
    if (!next.isDestroyed()) next.show();
  });
  next.on("closed", () => {
    if (win === next) win = null;
  });
  next.loadFile(path.join(__dirname, "settings.html"));
  return next;
}

/** The open Settings window, or null. */
function settingsWindow() {
  return win && !win.isDestroyed() ? win : null;
}

module.exports = { openSettingsWindow, settingsWindow };
