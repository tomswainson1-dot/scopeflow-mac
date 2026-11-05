const { app, BaseWindow, BrowserWindow, Menu, clipboard, dialog, ipcMain, powerMonitor, session, shell, screen, WebContentsView } = require("electron");
const fs = require("fs");
const path = require("path");
const { configuredSuiteUrl, openKind, shouldStayInApp, startUrl } = require("./links");
const { menuTemplate } = require("./menu");
const { contextMenuTemplate } = require("./context-menu");
const { createSpelling } = require("./spelling");
const { createSettingsStore } = require("./settings");
const { openSettingsWindow, settingsWindow } = require("./settings-window");
const { createUpdateMac, ownBundleId } = require("./update-mac");
const {
  INTERVAL_CHOICES,
  bundleFromExecPath,
  describe,
  menuLabel,
  resolveFeedUrl,
  restartPrompt,
  ribbonButton,
  settingsButton,
  sha256File,
} = require("./update-rules");
const { createUpdater } = require("./updater");

app.setName("ScopeFlow");

const smoke = process.env.SCOPEFLOW_SMOKE === "1";
const windows = new Set();
/** Spelling for the whole suite (src/spelling.js), made once the app is ready. */
let spelling = null;
/** Settings → Updates and later sections (src/settings.js), and the in-app updater (src/updater.js). */
let settingsStore = null;
let updater = null;

/** One clean blue, used for the title ribbon and the window edge together. */
const RIBBON = "#0C2E5A";
const RIBBON_LINE = "#0C2E5A";
const RIBBON_HEIGHT = 48;
let buildingChrome = false;

/** Google rejects the word Electron in the user agent during sign-in. */
function chromeUserAgent() {
  const chrome = process.versions.chrome;
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function webPreferences() {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    backgroundThrottling: false,
    spellcheck: true,
  };
}

/** The suite page itself: also runs auto-correct (src/page-preload.js). Sign-in popups and the ribbon do not. */
function pagePreferences() {
  return {
    ...webPreferences(),
    preload: path.join(__dirname, "page-preload.js"),
  };
}

function ribbonPreferences() {
  return {
    ...webPreferences(),
    spellcheck: false,
    preload: path.join(__dirname, "ribbon-preload.js"),
  };
}

function stateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function savedBounds() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (!parsed || typeof parsed.width !== "number" || typeof parsed.height !== "number") return null;
    const centerX = (parsed.x ?? 0) + parsed.width / 2;
    const centerY = (parsed.y ?? 0) + parsed.height / 2;
    const visible = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return centerX >= area.x && centerX <= area.x + area.width && centerY >= area.y && centerY <= area.y + area.height;
    });
    return visible ? parsed : null;
  } catch {
    return null;
  }
}

function rememberBounds(win) {
  if (win.isDestroyed()) return;
  const bounds = win.getBounds();
  const next = { ...bounds, maximized: win.isMaximized() };
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(next));
  } catch {
    // A missed write only means the next launch uses the default size.
  }
}

function offlinePage(detail) {
  const message = String(detail || "ScopeFlow could not be reached.")
    .replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  const home = startUrl();
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>ScopeFlow</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0C2E5A; color: white;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 28rem; padding: 2rem; }
  h1 { font-size: 1.5rem; font-weight: 600; margin: 0 0 .5rem; }
  p { color: rgba(255,255,255,.8); margin: 0 0 1.5rem; }
  a { display: inline-block; background: #2191FB; color: white; text-decoration: none; border-radius: 8px;
    padding: .6rem 1rem; font-weight: 600; }
</style>
<main>
  <h1>ScopeFlow is not available</h1>
  <p>${message}</p>
  <a href="${home}">Try again</a>
</main>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** A ScopeFlow page (any product), as opposed to a sign-in popup or a page outside the suite. */
function isSuiteUrl(url) {
  return /^https?:/i.test(url || "") && openKind(url) === "window";
}

function spellingFile() {
  return path.join(app.getPath("userData"), "spelling.json");
}

function windowForContents(contents) {
  for (const win of windows) {
    if (!win.isDestroyed() && win.pageView?.webContents === contents) return win;
  }
  return BrowserWindow.fromWebContents(contents) || null;
}

/** Send each suite page the auto-correct rules that apply now; any other page gets none. */
function broadcastSpelling() {
  if (!spelling) return;
  for (const win of windows) {
    const contents = win.isDestroyed() ? null : win.pageView?.webContents;
    if (!contents || contents.isDestroyed()) continue;
    contents.send("scopeflow-spelling", isSuiteUrl(contents.getURL()) ? spelling.pageConfig() : { autoCorrect: false });
  }
}

/**
 * The right-click menu (src/context-menu.js). Electron shows none of its own, so before 0.1.3 right-click did nothing,
 * not even on a red-underlined word.
 */
function attachContextMenu(contents) {
  contents.on("context-menu", (_event, params) => {
    const e = spelling ? spelling.effective() : { canEditWords: false, companyName: null };
    const history = contents.navigationHistory;
    const win = windowForContents(contents);
    const template = contextMenuTemplate(params, {
      platform: process.platform,
      isSuitePage: isSuiteUrl(contents.getURL()),
      canEditWords: e.canEditWords,
      companyName: e.companyName,
      history: { canGoBack: history.canGoBack(), canGoForward: history.canGoForward() },
      actions: {
        replaceMisspelling: (word) => contents.replaceMisspelling(word),
        addToDictionary: (word) => spelling?.addPersonWord(word),
        addForEveryone: (word) => {
          spelling?.addCompanyWord(word).then((result) => {
            if (result.ok) return;
            const options = {
              type: "warning",
              message: `“${word}” was not added for everyone`,
              detail: `${result.error} It was added to your own dictionary on this Mac instead.`,
            };
            (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)).catch(() => {});
          });
        },
        cut: () => contents.cut(),
        copy: () => contents.copy(),
        paste: () => contents.paste(),
        pasteAndMatchStyle: () => contents.pasteAndMatchStyle(),
        selectAll: () => contents.selectAll(),
        lookUp: () => contents.showDefinitionForSelection(),
        openLink: (url) => {
          if (isSuiteUrl(url)) contents.loadURL(url);
          else shell.openExternal(url).catch(() => {});
        },
        copyText: (text) => clipboard.writeText(text),
        copyImageAt: (x, y) => contents.copyImageAt(x, y),
        back: () => history.canGoBack() && history.goBack(),
        forward: () => history.canGoForward() && history.goForward(),
        reload: () => contents.reload(),
      },
    });
    if (template.length === 0) return;
    Menu.buildFromTemplate(template).popup(win ? { window: win } : {});
  });
}

function attachGuards(contents) {
  attachContextMenu(contents);
  const leave = (event, url) => {
    if (shouldStayInApp(url)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => {});
  };
  contents.on("will-navigate", leave);
  contents.on("will-redirect", leave);
  contents.setWindowOpenHandler(({ url }) => {
    const kind = openKind(url);
    if (kind === "browser") {
      if (url && url !== "about:blank") shell.openExternal(url).catch(() => {});
      return { action: "deny" };
    }
    if (kind === "popup") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 520,
          height: 760,
          title: "ScopeFlow",
          backgroundColor: "#ffffff",
          titleBarStyle: "default",
          webPreferences: webPreferences(),
        },
      };
    }
    // A suite page asked for a new window (Push to Estimator uses window.open).
    // Load it here instead: a second window from that call does not open, so the
    // person never arrives. This is the same window they are already in.
    contents.loadURL(url);
    return { action: "deny" };
  });
  contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    if (smoke) {
      console.error(`SMOKE_FAIL ${code} ${description}`);
      app.exit(1);
      return;
    }
    contents.loadURL(offlinePage(description)).catch(() => {});
  });
  contents.on("did-finish-load", () => {
    if (!smoke) return;
    console.log(`SMOKE_OK ${contents.getURL()}`);
    app.quit();
  });
}

function chevron(direction) {
  const d = direction === "back" ? "M10 3 L5 8 L10 13" : "M6 3 L11 8 L6 13";
  return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function ribbonDocument(title) {
  const text = String(title || "ScopeFlow")
    .replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; background: ${RIBBON}; color: #fff;
    font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    user-select: none; }
  body { display: flex; align-items: center; gap: 2px; box-sizing: border-box;
    padding: 0 14px 0 2px; -webkit-app-region: drag; border-bottom: 1px solid ${RIBBON_LINE}; }
  button { -webkit-app-region: no-drag; width: 28px; height: 28px; padding: 0; border: 0;
    border-radius: 6px; background: transparent; color: #fff; display: grid; place-items: center; }
  button:not(:disabled):hover { background: rgba(255,255,255,.16); }
  button:disabled { opacity: .35; }
  span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; margin-left: 8px; }
  #update { width: auto; height: 24px; margin-left: auto; padding: 0 12px; border-radius: 12px; flex: none;
    background: #2191FB; color: #fff; font: 600 12px/24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    white-space: nowrap; display: block; }
  #update:hover { background: #3EA0FC; }
  #update[hidden] { display: none; }
</style></head><body>
<button id="back" type="button" title="Back" aria-label="Back" disabled>${chevron("back")}</button>
<button id="forward" type="button" title="Forward" aria-label="Forward" disabled>${chevron("forward")}</button>
<span id="t">${text}</span>
<button id="update" type="button" hidden></button>
<script>
  const back = document.getElementById("back");
  const forward = document.getElementById("forward");
  const update = document.getElementById("update");
  const ribbon = window.scopeflowRibbon;
  function paint(state) {
    back.disabled = !state.back;
    forward.disabled = !state.forward;
  }
  function paintUpdate(info) {
    update.hidden = !info;
    if (!info) return;
    update.textContent = info.label;
    update.title = info.title;
  }
  if (ribbon) {
    back.addEventListener("click", () => ribbon.back());
    forward.addEventListener("click", () => ribbon.forward());
    update.addEventListener("click", () => ribbon.update());
    ribbon.onState(paint);
    ribbon.onUpdate(paintUpdate);
  }
</script>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function windowForRibbon(contents) {
  for (const win of windows) {
    if (!win.isDestroyed() && win.ribbonView?.webContents === contents) return win;
  }
  return null;
}

function go(win, direction) {
  if (!win || win.isDestroyed() || !win.pageView) return;
  const history = win.pageView.webContents.navigationHistory;
  if (direction === "back" && history.canGoBack()) history.goBack();
  if (direction === "forward" && history.canGoForward()) history.goForward();
}

function syncNav(win) {
  if (!win || win.isDestroyed() || !win.ribbonView || win.ribbonView.webContents.isDestroyed()) return;
  const history = win.pageView?.webContents.navigationHistory;
  if (!history) return;
  win.ribbonView.webContents.send("scopeflow-nav-state", {
    back: history.canGoBack(),
    forward: history.canGoForward(),
  });
}

/** Restart to Update on the right of the ribbon when an update is waiting (src/update-rules.js ribbonButton). */
function syncUpdateButton(win) {
  if (!win || win.isDestroyed() || !win.ribbonView || win.ribbonView.webContents.isDestroyed()) return;
  win.ribbonView.webContents.send("scopeflow-update-button", ribbonButton(updater?.status()));
}

function layoutChrome(win) {
  if (win.isDestroyed() || !win.pageView || !win.ribbonView) return;
  const { width, height } = win.getContentBounds();
  const full = win.isFullScreen();
  const top = full ? 0 : RIBBON_HEIGHT;
  const edge = full ? 0 : 1;
  const lights = 78;
  win.ribbonView.setVisible(!full);
  win.ribbonView.setBounds({ x: lights, y: 0, width: Math.max(0, width - lights), height: top });
  win.pageView.setBounds({
    x: edge,
    y: top,
    width: Math.max(0, width - edge * 2),
    height: Math.max(0, height - top - edge),
  });
}

function setRibbonTitle(win, title) {
  const text = title && title.trim() ? title.trim() : "ScopeFlow";
  win.setTitle(text);
  const script = `document.getElementById("t").textContent = ${JSON.stringify(text)}`;
  win.ribbonView?.webContents.executeJavaScript(script).catch(() => {});
}

function focusedSuiteWindow() {
  for (const win of windows) {
    if (!win.isDestroyed() && win.isFocused()) return win;
  }
  for (const win of windows) {
    if (!win.isDestroyed()) return win;
  }
  return null;
}

function createWindow(url, { remember = true } = {}) {
  const saved = remember ? savedBounds() : null;
  const win = new BaseWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "ScopeFlow",
    backgroundColor: RIBBON,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 17 },
    roundedCorners: true,
  });
  windows.add(win);

  buildingChrome = true;
  const page = new WebContentsView({ webPreferences: pagePreferences() });
  const ribbon = new WebContentsView({ webPreferences: ribbonPreferences() });
  buildingChrome = false;
  page.setBackgroundColor("#ffffff");
  ribbon.setBackgroundColor(RIBBON);
  win.contentView.addChildView(page);
  win.contentView.addChildView(ribbon);
  win.pageView = page;
  win.ribbonView = ribbon;
  ribbon.webContents.loadURL(ribbonDocument("ScopeFlow"));
  attachGuards(page.webContents);

  if (saved?.maximized) win.maximize();
  const relayout = () => layoutChrome(win);
  relayout();
  win.on("resize", relayout);
  win.on("enter-full-screen", relayout);
  win.on("leave-full-screen", relayout);
  const syncTitle = () => setRibbonTitle(win, page.webContents.getTitle());
  const syncBoth = () => {
    syncTitle();
    syncNav(win);
  };
  ribbon.webContents.on("did-finish-load", syncBoth);
  ribbon.webContents.on("did-finish-load", () => syncUpdateButton(win));
  page.webContents.on("page-title-updated", (_event, title) => setRibbonTitle(win, title));
  page.webContents.on("did-navigate", () => syncNav(win));
  page.webContents.on("did-navigate-in-page", () => syncNav(win));
  page.webContents.on("did-finish-load", syncBoth);
  // The company's spelling rules may have changed (Settings → Spelling): read them again as suite pages load.
  page.webContents.on("did-finish-load", () => {
    if (isSuiteUrl(page.webContents.getURL())) spelling?.refresh();
  });
  win.on("focus", () => spelling?.refresh());
  win.on("swipe", (_event, direction) => {
    if (direction === "right") go(win, "back");
    if (direction === "left") go(win, "forward");
  });
  win.on("app-command", (_event, command) => {
    if (command === "browser-backward") go(win, "back");
    if (command === "browser-forward") go(win, "forward");
  });
  page.webContents.once("ready-to-show", () => {
    if (!win.isDestroyed()) win.show();
  });

  if (remember) {
    const save = () => rememberBounds(win);
    win.on("resize", save);
    win.on("move", save);
    win.on("close", save);
  }
  win.on("closed", () => windows.delete(win));
  page.webContents.loadURL(url || startUrl());
  return win;
}

function focusedContents() {
  const win = focusedSuiteWindow();
  if (win) return win.pageView.webContents;
  const popup = BrowserWindow.getFocusedWindow();
  return popup && !popup.isDestroyed() ? popup.webContents : null;
}

/* ------------------------------------------------------------------------------------- Settings and updates */

function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

function updateStateFile() {
  return path.join(app.getPath("userData"), "update-state.json");
}

/** What the updater did, for support: checks, downloads, installs, and the install script's own lines. */
function updatesLog() {
  return path.join(app.getPath("userData"), "updates.log");
}

function logUpdate(line) {
  try {
    fs.mkdirSync(path.dirname(updatesLog()), { recursive: true });
    fs.appendFileSync(updatesLog(), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Logging must never stop an update.
  }
}

/** The Settings window gets the status with its words and button worked out here. */
function updateView(status) {
  return { ...status, text: describe(status), button: settingsButton(status) };
}

function fromSettingsWindow(event) {
  const win = settingsWindow();
  return Boolean(win && event.sender === win.webContents);
}

/** The settings page is not a suite page, so it gets none of the suite's link guards or right-click menu. */
function openSettings() {
  return openSettingsWindow({
    create: (make) => {
      buildingChrome = true;
      try {
        return make();
      } finally {
        buildingChrome = false;
      }
    },
  });
}

let menuStatusKey = "";
function onUpdateStatus(status) {
  const key = `${status.state}|${status.latest}`;
  if (key !== menuStatusKey) {
    menuStatusKey = key;
    installMenu();
    for (const win of windows) syncUpdateButton(win);
  }
  settingsWindow()?.webContents.send("scopeflow-update-status", updateView(status));
}

function dialogParent() {
  const win = focusedSuiteWindow();
  return win && !win.isDestroyed() && win.isVisible() ? win : null;
}

const updateUi = {
  /** "Update available, restart to update" → true for Restart to Update. */
  async askRestart(status) {
    const parent = dialogParent();
    if (!parent || !parent.isFocused()) app.dock?.bounce("informational");
    const options = { type: "info", noLink: true, ...restartPrompt(status) };
    const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    return response === 0;
  },
  /** The status in words, e.g. "You're up to date". */
  async tell(status) {
    const { title, detail } = describe(status);
    const warn = status.state === "error" || status.state === "blocked";
    const options = { type: warn ? "warning" : "info", message: title, detail, buttons: ["OK"], noLink: true };
    const parent = dialogParent();
    await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)).catch(() => {});
  },
  /** Progress lives in Settings → Updates. */
  showProgress() {
    openSettings();
  },
  /** An automatic check found an update: the ribbon and menu now offer it; if ScopeFlow is in the background, one Dock bounce. */
  nudge() {
    if (!BaseWindow.getFocusedWindow()) app.dock?.bounce("informational");
  },
};

function createAppUpdater() {
  const feedUrl = resolveFeedUrl(app.commandLine.getSwitchValue("scopeflow-update-feed"));
  const bundle = bundleFromExecPath(process.execPath);
  let disabledReason = null;
  if (process.platform !== "darwin") disabledReason = "In-app updates are for the Mac app.";
  else if (!app.isPackaged || !bundle) {
    disabledReason = "ScopeFlow is running from its source folder (npm start), so it does not update itself. Build it with npm run pack.";
  }
  try {
    if (fs.statSync(updatesLog()).size > 1024 * 1024) fs.renameSync(updatesLog(), `${updatesLog()}.old`);
  } catch {
    // No log yet.
  }
  const mac = createUpdateMac({
    feedUrl,
    userAgent: `ScopeFlow-Mac/${app.getVersion()}`,
    logFile: updatesLog(),
    relaunchArgs: process.argv.slice(1),
  });
  return createUpdater({
    currentVersion: app.getVersion(),
    feedUrl,
    disabledReason,
    systemVersion: process.getSystemVersion(),
    arch: process.arch,
    ownBundleId: ownBundleId(bundle),
    settings: () => settingsStore.get("updates"),
    store: {
      read: () => JSON.parse(fs.readFileSync(updateStateFile(), "utf8")),
      write: (state) => {
        fs.mkdirSync(path.dirname(updateStateFile()), { recursive: true });
        fs.writeFileSync(updateStateFile(), JSON.stringify(state));
      },
    },
    updatesDir: path.join(app.getPath("userData"), "Updates"),
    locate: mac.locate,
    fetchJson: mac.fetchJson,
    download: mac.download,
    hashFile: sha256File,
    unpack: mac.unpack,
    inspectApp: mac.inspectApp,
    startInstall: mac.startInstall,
    quit: () => app.quit(),
    ui: updateUi,
    log: logUpdate,
    onStatus: onUpdateStatus,
  });
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate({
    app,
    shell,
    focusedContents,
    spelling,
    update: {
      label: menuLabel(updater?.status()),
      click: () => {
        if (updater) updater.menuClick();
      },
    },
    onOpenSettings: () => openSettings(),
    onOpenCompanySettings: () => {
      const url = new URL("/settings/spelling", configuredSuiteUrl().origin).href;
      const win = focusedSuiteWindow();
      if (win) win.pageView.webContents.loadURL(url);
      else createWindow(url);
    },
    onGo: (url) => {
      const win = focusedSuiteWindow();
      if (win) win.pageView.webContents.loadURL(url);
      else createWindow(url);
    },
  })));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = [...windows][0];
    if (!win) {
      createWindow(startUrl());
      return;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: "ScopeFlow",
      applicationVersion: app.getVersion(),
      version: "",
      copyright: "Total Cladding and Roofing LLC",
    });

    const userAgent = chromeUserAgent();
    app.userAgentFallback = userAgent;
    session.defaultSession.setUserAgent(userAgent);

    const allowed = new Set([
      "notifications",
      "media",
      "geolocation",
      "clipboard-read",
      "clipboard-sanitized-write",
      "fullscreen",
      "pointerLock",
    ]);
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(allowed.has(permission));
    });

    spelling = createSpelling({
      dictionary: {
        add: (word) => session.defaultSession.addWordToSpellCheckerDictionary(word),
        remove: (word) => session.defaultSession.removeWordFromSpellCheckerDictionary(word),
        setEnabled: (on) => session.defaultSession.setSpellCheckerEnabled(on),
      },
      request: async (method, url, body) => {
        const res = await session.defaultSession.fetch(url, {
          method,
          credentials: "include",
          redirect: "manual",
          headers: body
            ? { accept: "application/json", "content-type": "application/json", "x-scopeflow-desktop": "1" }
            : { accept: "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        let json = null;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        return { status: res.status, json };
      },
      store: {
        read: () => JSON.parse(fs.readFileSync(spellingFile(), "utf8")),
        write: (state) => {
          fs.mkdirSync(path.dirname(spellingFile()), { recursive: true });
          fs.writeFileSync(spellingFile(), JSON.stringify(state));
        },
      },
      suiteOrigin: configuredSuiteUrl().origin,
      onChange: () => {
        installMenu();
        broadcastSpelling();
      },
    });
    ipcMain.handle("scopeflow-spelling-get", (event) => {
      const url = event.senderFrame?.url || event.sender.getURL();
      return spelling && isSuiteUrl(url) ? spelling.pageConfig() : { autoCorrect: false };
    });

    ipcMain.on("scopeflow-nav", (event, direction) => {
      if (direction !== "back" && direction !== "forward") return;
      go(windowForRibbon(event.sender), direction);
    });

    settingsStore = createSettingsStore({
      read: () => JSON.parse(fs.readFileSync(settingsFile(), "utf8")),
      write: (state) => {
        fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
        fs.writeFileSync(settingsFile(), JSON.stringify(state, null, 2));
      },
      onChange: (section) => {
        if (section === "updates") updater?.schedule();
      },
    });
    updater = createAppUpdater();
    ipcMain.handle("scopeflow-settings-load", (event) => {
      if (!fromSettingsWindow(event)) return null;
      return { settings: settingsStore.get("updates"), choices: INTERVAL_CHOICES, status: updateView(updater.status()) };
    });
    ipcMain.handle("scopeflow-settings-save", (event, patch) => {
      if (!fromSettingsWindow(event)) return null;
      return settingsStore.set("updates", patch);
    });
    ipcMain.handle("scopeflow-update-check", (event) => {
      if (fromSettingsWindow(event)) updater.check("window");
    });
    ipcMain.handle("scopeflow-update-restart", (event) => {
      if (fromSettingsWindow(event)) updater.restartNow();
    });
    ipcMain.on("scopeflow-update-click", (event) => {
      if (windowForRibbon(event.sender)) updater.menuClick();
    });
    // A Mac that slept past a check time checks soon after it wakes.
    powerMonitor.on("resume", () => updater.schedule());

    installMenu();
    app.on("web-contents-created", (_event, contents) => {
      if (buildingChrome || contents.__scopeflowPage) return;
      if (contents.getType() === "window" && contents.listenerCount("will-navigate") === 0) {
        attachGuards(contents);
      }
    });
    createWindow(startUrl());
    spelling.refresh();
    if (!smoke) updater.start().catch((err) => logUpdate(`start failed: ${err && err.stack ? err.stack : err}`));
  });
}

app.on("activate", () => {
  if (windows.size === 0 && BrowserWindow.getAllWindows().length === 0) createWindow(startUrl());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
