const { app, BaseWindow, BrowserWindow, Menu, session, shell, screen, WebContentsView } = require("electron");
const fs = require("fs");
const path = require("path");
const { openKind, shouldStayInApp, startUrl } = require("./links");
const { menuTemplate } = require("./menu");

app.setName("ScopeFlow");

const smoke = process.env.SCOPEFLOW_SMOKE === "1";
const windows = new Set();

/** One clean blue, used for the title ribbon and the window edge together. */
const RIBBON = "#1A73E8";
const RIBBON_LINE = "#185ABC";
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

function attachGuards(contents) {
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
    createWindow(url, { remember: false });
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

function ribbonDocument(title) {
  const text = String(title || "ScopeFlow")
    .replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; background: ${RIBBON}; color: #fff;
    font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    user-select: none; }
  body { display: flex; align-items: center; box-sizing: border-box;
    padding: 0 18px; -webkit-app-region: drag; border-bottom: 1px solid ${RIBBON_LINE}; }
  span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style></head><body><span id="t">${text}</span></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
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
  const page = new WebContentsView({ webPreferences: webPreferences() });
  const ribbon = new WebContentsView({
    webPreferences: { ...webPreferences(), spellcheck: false },
  });
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
  ribbon.webContents.once("did-finish-load", syncTitle);
  page.webContents.on("page-title-updated", (_event, title) => setRibbonTitle(win, title));
  page.webContents.on("did-finish-load", syncTitle);
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

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate({
    app,
    shell,
    focusedContents,
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

    const icon = path.join(__dirname, "..", "assets", "icon.png");
    if (process.platform === "darwin" && app.dock && fs.existsSync(icon)) {
      app.dock.setIcon(icon);
    }

    installMenu();
    app.on("web-contents-created", (_event, contents) => {
      if (buildingChrome || contents.__scopeflowPage) return;
      if (contents.getType() === "window" && contents.listenerCount("will-navigate") === 0) {
        attachGuards(contents);
      }
    });
    createWindow(startUrl());
  });
}

app.on("activate", () => {
  if (windows.size === 0 && BrowserWindow.getAllWindows().length === 0) createWindow(startUrl());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
