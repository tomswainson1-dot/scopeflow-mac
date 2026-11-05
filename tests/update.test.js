const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const rules = require("../src/update-rules");
const { installCommand, readInstallResult, relaunchArgs } = require("../src/update-install");
const { createUpdater, RESULT_FILE } = require("../src/updater");
const { createSettingsStore } = require("../src/settings");
const { menuTemplate } = require("../src/menu");

/**
 * In-app updates (4 Nov 2026; Tom: "allow users to update from inside the software so I don't have to delete and
 * re-install or run a command"). Electron's own updater turns down an ad-hoc signed app, so ScopeFlow checks GitHub,
 * downloads, checks the SHA-256 and swaps itself (src/update-rules.js, src/updater.js, src/update-install.js).
 */

const REPO_ZIP = "https://github.com/tomswainson1-dot/scopeflow-mac/releases/download/v0.1.5/ScopeFlow-mac.zip";
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "scopeflow-update-test-"));
const goodManifest = (over = {}) => ({
  name: "ScopeFlow",
  version: "0.1.5",
  url: REPO_ZIP,
  size: 11,
  sha256: sha("hello world"),
  bundleId: "us.scopeflow.desktop",
  minimumSystemVersion: "12.0",
  notes: "Faster bill grid.",
  ...over,
});

/* ---------------------------------------------------------------- versions */

test("versions compare the semver way: 0.1.10 is newer than 0.1.9, a pre-release is older than its release", () => {
  const ordered = ["0.1.3", "0.1.4", "0.1.9", "0.1.10", "0.2.0-beta.1", "0.2.0-beta.2", "0.2.0-beta.10", "0.2.0-rc.1", "0.2.0", "1.0.0"];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    assert.equal(rules.compareVersions(ordered[i], ordered[i + 1]), -1, `${ordered[i]} < ${ordered[i + 1]}`);
    assert.equal(rules.compareVersions(ordered[i + 1], ordered[i]), 1, `${ordered[i + 1]} > ${ordered[i]}`);
  }
  assert.equal(rules.compareVersions("v0.1.4", "0.1.4"), 0);
  assert.equal(rules.compareVersions("0.1.4+build.7", "0.1.4"), 0);
  assert.equal(rules.compareVersions("1.0.0-1", "1.0.0-alpha"), -1, "numbers before words");
});

test("anything that is not a version is refused", () => {
  for (const bad of ["", "0.1", "latest", "0.1.4.2", "v", null, undefined, "01.2.x"]) {
    assert.equal(rules.parseVersion(bad), null, String(bad));
  }
  assert.throws(() => rules.compareVersions("latest", "0.1.4"), /Not a version/);
});

test("macOS versions compare by their dotted numbers", () => {
  assert.equal(rules.compareDotted("26.6.2", "12.0"), 1);
  assert.equal(rules.compareDotted("12", "12.0.0"), 0);
  assert.equal(rules.compareDotted("10.15.7", "11.0"), -1);
});

/* ---------------------------------------------------------------- the release and its checksum */

test("a release's update file is read and tidied", () => {
  const checked = rules.validateManifest(goodManifest({ sha256: sha("hello world").toUpperCase(), notes: `  ${"x".repeat(700)} ` }), rules.DEFAULT_FEED_URL);
  assert.equal(checked.ok, true);
  assert.equal(checked.manifest.version, "0.1.5");
  assert.equal(checked.manifest.sha256, sha("hello world"), "lower case");
  assert.equal(checked.manifest.notes.length, 600, "long notes are cut");
  assert.equal(checked.manifest.minimumSystemVersion, "12.0");
});

test("an update file that is incomplete or points away from ScopeFlow's GitHub releases is refused", () => {
  const cases = [
    [null, /expected form/],
    [[], /expected form/],
    [goodManifest({ version: "latest" }), /version/],
    [goodManifest({ url: REPO_ZIP.replace("https:", "http:") }), /somewhere other/],
    [goodManifest({ url: "https://example.com/ScopeFlow-mac.zip" }), /somewhere other/],
    [goodManifest({ url: "https://github.com/someone-else/scopeflow-mac/releases/download/v0.1.5/ScopeFlow-mac.zip" }), /somewhere other/],
    [goodManifest({ url: "https://github.com.evil.example/x.zip" }), /somewhere other/],
    [goodManifest({ size: 0 }), /size/],
    [goodManifest({ size: "224 MB" }), /size/],
    [goodManifest({ size: 3 * 1024 * 1024 * 1024 }), /size/],
    [goodManifest({ sha256: "abc123" }), /SHA-256/],
    [goodManifest({ sha256: "z".repeat(64) }), /SHA-256/],
  ];
  for (const [raw, error] of cases) {
    const checked = rules.validateManifest(raw, rules.DEFAULT_FEED_URL);
    assert.equal(checked.ok, false, JSON.stringify(raw));
    assert.match(checked.error, error);
  }
});

test("a test server on this Mac may serve its own update, but only from the same address", () => {
  const feed = "http://127.0.0.1:8123/ScopeFlow-mac.json";
  assert.equal(rules.validateManifest(goodManifest({ url: "http://127.0.0.1:8123/ScopeFlow-mac.zip" }), feed).ok, true);
  assert.equal(rules.validateManifest(goodManifest({ url: "http://127.0.0.1:9999/ScopeFlow-mac.zip" }), feed).ok, false);
  assert.equal(rules.validateManifest(goodManifest({ url: "http://127.0.0.1:8123/ScopeFlow-mac.zip" }), rules.DEFAULT_FEED_URL).ok, false);
});

test("redirects are followed only to GitHub", () => {
  const feed = rules.DEFAULT_FEED_URL;
  assert.equal(rules.isAllowedUpdateUrl("https://github.com/tomswainson1-dot/scopeflow-mac/releases/download/v0.1.5/ScopeFlow-mac.json", feed), true);
  assert.equal(rules.isAllowedUpdateUrl("https://release-assets.githubusercontent.com/github-production-release-asset/1/abc", feed), true);
  assert.equal(rules.isAllowedUpdateUrl("https://objects.githubusercontent.com/x", feed), true);
  assert.equal(rules.isAllowedUpdateUrl("http://github.com/x", feed), false);
  assert.equal(rules.isAllowedUpdateUrl("https://evilgithub.com/x", feed), false);
  assert.equal(rules.isAllowedUpdateUrl("https://github.com.evil.example/x", feed), false);
  assert.equal(rules.isAllowedUpdateUrl("not a url", feed), false);
});

test("the update address is the newest GitHub release unless a test copy names GitHub or this Mac", () => {
  assert.equal(rules.DEFAULT_FEED_URL, "https://github.com/tomswainson1-dot/scopeflow-mac/releases/latest/download/ScopeFlow-mac.json");
  assert.equal(rules.resolveFeedUrl(""), rules.DEFAULT_FEED_URL);
  assert.equal(rules.resolveFeedUrl("nonsense"), rules.DEFAULT_FEED_URL);
  assert.equal(rules.resolveFeedUrl("https://example.com/ScopeFlow-mac.json"), rules.DEFAULT_FEED_URL);
  assert.equal(rules.resolveFeedUrl("http://127.0.0.1:8123/ScopeFlow-mac.json"), "http://127.0.0.1:8123/ScopeFlow-mac.json");
});

test("the download must be exactly the published file: size, then SHA-256", async () => {
  const dir = tmp();
  const file = path.join(dir, "ScopeFlow-mac.zip");
  fs.writeFileSync(file, "hello world");
  const got = await rules.sha256File(file);
  assert.deepEqual(got, { size: 11, sha256: sha("hello world") });
  const manifest = rules.validateManifest(goodManifest(), rules.DEFAULT_FEED_URL).manifest;
  assert.equal(rules.checkDownload(got, manifest), null);
  assert.equal(rules.checkDownload({ ...got, sha256: got.sha256.toUpperCase() }, manifest), null);
  assert.match(rules.checkDownload({ ...got, size: 10 }, manifest), /10 bytes but the release says 11/);
  assert.match(rules.checkDownload({ ...got, sha256: sha("tampered") }, manifest), /does not match the SHA-256 checksum published with ScopeFlow 0\.1\.5/);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------- the update decision */

test("when to check: the menu and Check Now always; automatic checks follow Settings → Updates", () => {
  const now = 100 * rules.HOUR;
  const s = (over) => ({ ...rules.UPDATE_DEFAULTS, ...over });
  const off = s({ automatic: false });
  assert.equal(rules.shouldCheck({ trigger: "manual", settings: off, now }), true);
  assert.equal(rules.shouldCheck({ trigger: "window", settings: off, now }), true);
  assert.equal(rules.shouldCheck({ trigger: "launch", settings: off, now }), false);
  assert.equal(rules.shouldCheck({ trigger: "timer", settings: off, now, lastCheckAt: 0 }), false);
  assert.equal(rules.shouldCheck({ trigger: "launch", settings: s(), now }), true, "on launch by default");
  assert.equal(rules.shouldCheck({ trigger: "launch", settings: s({ checkOnLaunch: false }), now }), false);
  assert.equal(rules.shouldCheck({ trigger: "timer", settings: s(), now, lastCheckAt: null }), true, "never checked");
  assert.equal(rules.shouldCheck({ trigger: "timer", settings: s(), now, lastCheckAt: now - 3 * rules.HOUR }), false);
  assert.equal(rules.shouldCheck({ trigger: "timer", settings: s(), now, lastCheckAt: now - 4 * rules.HOUR }), true);
  assert.equal(rules.shouldCheck({ trigger: "timer", settings: s({ intervalHours: 0 }), now, lastCheckAt: 0 }), false);
  assert.equal(rules.shouldCheck({ trigger: "timer", settings: s(), now, lastCheckAt: now + rules.HOUR }), true, "clock went back");
});

test("the next check while open counts from the last one", () => {
  const now = 100 * rules.HOUR;
  const s = (over) => ({ ...rules.UPDATE_DEFAULTS, ...over });
  assert.equal(rules.nextCheckDelay({ settings: s(), lastCheckAt: now - rules.HOUR, now }), 3 * rules.HOUR);
  assert.equal(rules.nextCheckDelay({ settings: s(), lastCheckAt: null, now }), 4 * rules.HOUR);
  assert.equal(rules.nextCheckDelay({ settings: s(), lastCheckAt: now - 9 * rules.HOUR, now }), 0, "overdue");
  assert.equal(rules.nextCheckDelay({ settings: s({ intervalHours: 168 }), lastCheckAt: now, now }), 168 * rules.HOUR);
  assert.equal(rules.nextCheckDelay({ settings: s({ intervalHours: 0 }), lastCheckAt: now, now }), null);
  assert.equal(rules.nextCheckDelay({ settings: s({ automatic: false }), lastCheckAt: now, now }), null);
});

test("Settings → Updates: the defaults, and anything not understood goes back to its default", () => {
  assert.deepEqual(rules.cleanUpdateSettings(undefined), { automatic: true, checkOnLaunch: true, intervalHours: 4, downloadInBackground: true });
  assert.deepEqual(
    rules.cleanUpdateSettings({ automatic: false, checkOnLaunch: "no", intervalHours: 3, downloadInBackground: false }),
    { automatic: false, checkOnLaunch: true, intervalHours: 4, downloadInBackground: false }
  );
  assert.equal(rules.cleanUpdateSettings({ intervalHours: "24" }).intervalHours, 24);
  assert.deepEqual(rules.INTERVAL_CHOICES.map((c) => c.label), ["Every hour", "Every 4 hours", "Every day", "Every week", "Never"]);
});

test("a newer release is offered; the same or an older one is not; one that needs a newer macOS says so", () => {
  const m = (over) => rules.validateManifest(goodManifest(over), rules.DEFAULT_FEED_URL).manifest;
  assert.deepEqual(rules.decideUpdate({ currentVersion: "0.1.4", manifest: m(), systemVersion: "26.6.2" }), { kind: "available", latest: "0.1.5" });
  assert.equal(rules.decideUpdate({ currentVersion: "0.1.5", manifest: m(), systemVersion: "26.6.2" }).kind, "up-to-date");
  assert.equal(rules.decideUpdate({ currentVersion: "0.2.0", manifest: m(), systemVersion: "26.6.2" }).kind, "up-to-date");
  const old = rules.decideUpdate({ currentVersion: "0.1.4", manifest: m({ minimumSystemVersion: "13.0" }), systemVersion: "12.7.6" });
  assert.equal(old.kind, "needs-newer-macos");
  assert.match(old.message, /needs macOS 13\.0 or later, and this Mac has macOS 12\.7\.6/);
});

test("the unpacked app must be this app, the promised version, signed, and built for this Mac", () => {
  const info = { bundleId: "us.scopeflow.desktop", version: "0.1.5", minimumSystemVersion: "12.0", archs: ["x86_64", "arm64"], signatureOk: true };
  const expected = { bundleId: "us.scopeflow.desktop", version: "0.1.5", arch: "arm64", systemVersion: "26.6.2" };
  assert.equal(rules.checkStagedApp(info, expected), null);
  assert.equal(rules.checkStagedApp(info, { ...expected, arch: "x64" }), null, "Intel half");
  assert.match(rules.checkStagedApp({ ...info, bundleId: "com.example.other" }, expected), /different app/);
  assert.match(rules.checkStagedApp({ ...info, version: "0.1.4" }, expected), /version 0\.1\.4, not 0\.1\.5/);
  assert.match(rules.checkStagedApp({ ...info, archs: ["arm64"] }, { ...expected, arch: "x64" }), /chip \(x86_64\)/);
  assert.match(rules.checkStagedApp({ ...info, minimumSystemVersion: "27.0" }, expected), /needs macOS 27\.0/);
  assert.match(rules.checkStagedApp({ ...info, signatureOk: false, signatureError: "a sealed resource is missing or invalid" }, expected), /code-signature check \(a sealed resource/);
  assert.match(rules.checkStagedApp(null, expected), /did not contain/);
});

test("the chips are read from the executable's header", () => {
  const fat = Buffer.alloc(48);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(2, 4);
  fat.writeUInt32BE(0x01000007, 8);
  fat.writeUInt32BE(0x0100000c, 28);
  assert.deepEqual(rules.machoArchs(fat), ["x86_64", "arm64"]);
  const thin = Buffer.alloc(8);
  thin.writeUInt32LE(0xfeedfacf, 0);
  thin.writeUInt32LE(0x0100000c, 4);
  assert.deepEqual(rules.machoArchs(thin), ["arm64"]);
  assert.deepEqual(rules.machoArchs(Buffer.from("#!/bin/sh\n")), []);
  assert.equal(rules.machArch("x64"), "x86_64");
});

test("the app to replace: its own bundle, or the original behind a translocated copy", () => {
  const original = "/Users/alex/Downloads/ScopeFlow.app";
  const mount = "/private/var/folders/ab/cd/T/AppTranslocation/0A1B2C3D-0000-4000-8000-000000000001";
  const table = [
    "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)",
    `${original} on ${mount} (nullfs, local, nodev, nosuid, read-only, nobrowse, mounted by alex)`,
  ].join("\n");
  const translocated = `${mount}/d/ScopeFlow.app`;
  assert.equal(rules.bundleFromExecPath("/Applications/ScopeFlow.app/Contents/MacOS/ScopeFlow"), "/Applications/ScopeFlow.app");
  assert.equal(rules.bundleFromExecPath("/usr/local/bin/electron"), null);
  assert.equal(rules.originalBundlePath("/Applications/ScopeFlow.app", table), "/Applications/ScopeFlow.app");
  assert.equal(rules.originalBundlePath(translocated, table), original);
  assert.equal(rules.originalBundlePath(translocated, ""), null, "not in the mount table");
  assert.equal(rules.originalBundlePath(`${mount}/d/Other.app`, table), null, "a different app's mount");

  const canWrite = (dir) => dir !== "/Applications";
  const exec = `${translocated}/Contents/MacOS/ScopeFlow`;
  assert.deepEqual(rules.locateApp({ execPath: exec, mountTable: () => table, canWrite }), { target: original, running: translocated });
  assert.match(rules.locateApp({ execPath: exec, mountTable: () => "", canWrite }).problem, /temporary copy/);
  assert.match(rules.locateApp({ execPath: "/Applications/ScopeFlow.app/Contents/MacOS/ScopeFlow", mountTable: () => "", canWrite }).problem, /“\/Applications”, because your Mac account cannot change that folder/);
  assert.match(rules.locateApp({ execPath: "/usr/local/bin/electron", mountTable: () => "", canWrite }).problem, /not running as an app/);
});

/* ---------------------------------------------------------------- words and the menu */

test("the menu item is always pressable and says what it will do", () => {
  const labels = {
    idle: "Check for Updates…",
    "up-to-date": "Check for Updates…",
    error: "Check for Updates…",
    checking: "Checking for Updates…",
    downloading: "Downloading Update…",
    ready: "Restart to Update to 0.1.5…",
    installing: "Restarting to Update…",
  };
  for (const [state, label] of Object.entries(labels)) {
    const status = { state, latest: "0.1.5", current: "0.1.4" };
    assert.equal(rules.menuLabel(status), label);
    const template = menuTemplate({
      app: { name: "ScopeFlow" },
      shell: {},
      onGo() {},
      focusedContents: () => null,
      spelling: null,
      update: { label: rules.menuLabel(status), click() {} },
      onOpenSettings() {},
    });
    const item = template[0].submenu.find((i) => i.label === label);
    assert.ok(item, `${state}: ${label} is in the ScopeFlow menu`);
    assert.equal(item.enabled, true, `${state}: never greyed out`);
  }
  assert.equal(rules.menuLabel(undefined), "Check for Updates…", "before the updater starts");
});

test("the ScopeFlow menu: About, Check for Updates…, Settings… (Command-comma)", () => {
  const template = menuTemplate({
    app: { name: "ScopeFlow" },
    shell: {},
    onGo() {},
    focusedContents: () => null,
    spelling: null,
    update: { label: "Check for Updates…", click() {} },
    onOpenSettings() {},
  });
  const names = template[0].submenu.map((i) => i.label || i.role || "—");
  assert.deepEqual(names.slice(0, 5), ["about", "Check for Updates…", "—", "Settings…", "—"]);
  assert.equal(template[0].submenu.find((i) => i.label === "Settings…").accelerator, "CmdOrCtrl+,");
});

test("up to date is said in words; the restart question has Restart to Update first", () => {
  assert.deepEqual(rules.describe({ state: "up-to-date", current: "0.1.4", latest: "0.1.4" }), {
    title: "You're up to date",
    detail: "ScopeFlow 0.1.4 is the newest version.",
  });
  const prompt = rules.restartPrompt({ state: "ready", current: "0.1.4", latest: "0.1.5", notes: "Faster bill grid." });
  assert.equal(prompt.message, "Update available, restart to update");
  assert.deepEqual(prompt.buttons, ["Restart to Update", "Later"]);
  assert.equal(prompt.defaultId, 0);
  assert.equal(prompt.cancelId, 1);
  assert.match(prompt.detail, /ScopeFlow 0\.1\.5 is ready to install\. You have 0\.1\.4\./);
  assert.match(prompt.detail, /What's new: Faster bill grid\./);
  assert.match(rules.restartPrompt({ state: "available", current: "0.1.4", latest: "0.1.5" }).detail, /will download it/);
  assert.deepEqual(rules.settingsButton({ state: "ready" }), { label: "Restart to Update", action: "restart" });
  assert.deepEqual(rules.settingsButton({ state: "up-to-date" }), { label: "Check Now", action: "check" });
  assert.deepEqual(rules.settingsButton({ state: "downloading" }), { label: "Downloading…", action: "none" });
});

/* ---------------------------------------------------------------- settings */

test("settings are kept per section, cleaned, and saved", () => {
  let written = null;
  const changed = [];
  const store = createSettingsStore({
    read: () => ({ updates: { automatic: false, intervalHours: 99 } }),
    write: (state) => {
      written = JSON.parse(JSON.stringify(state));
    },
    onChange: (section) => changed.push(section),
  });
  assert.deepEqual(store.get("updates"), { automatic: false, checkOnLaunch: true, intervalHours: 4, downloadInBackground: true });
  assert.deepEqual(store.set("updates", { automatic: true, intervalHours: 24, extra: "ignored" }), {
    automatic: true,
    checkOnLaunch: true,
    intervalHours: 24,
    downloadInBackground: true,
  });
  assert.deepEqual(written, { updates: { automatic: true, checkOnLaunch: true, intervalHours: 24, downloadInBackground: true } });
  assert.deepEqual(changed, ["updates"]);
  assert.throws(() => store.get("nope"), /No settings section/);
  const damaged = createSettingsStore({ read: () => { throw new SyntaxError("bad json"); }, write() {} });
  assert.deepEqual(damaged.get("updates"), rules.cleanUpdateSettings({}));
});

/* ---------------------------------------------------------------- the updater's steps */

function harness(over = {}) {
  const dir = tmp();
  const calls = [];
  const box = { saved: over.saved || {} };
  const manifest = over.manifest || goodManifest();
  const d = {
    currentVersion: "0.1.4",
    feedUrl: rules.DEFAULT_FEED_URL,
    systemVersion: "26.6.2",
    arch: "arm64",
    ownBundleId: "us.scopeflow.desktop",
    settings: () => ({ ...rules.UPDATE_DEFAULTS, ...over.settings }),
    store: {
      read: () => box.saved,
      write: (state) => {
        box.saved = JSON.parse(JSON.stringify(state));
      },
    },
    updatesDir: path.join(dir, "Updates"),
    locate: () => over.place || { target: "/Applications/ScopeFlow.app" },
    fetchJson: async (url) => {
      calls.push(["fetch", url]);
      if (over.fetchError) throw over.fetchError;
      return manifest;
    },
    download: async (url, file, { onProgress }) => {
      calls.push(["download", url]);
      fs.writeFileSync(file, over.payload ?? "hello world");
      onProgress(5);
      onProgress(11);
    },
    hashFile: rules.sha256File,
    unpack: async (_zip, into) => {
      const app = path.join(into, "ScopeFlow.app");
      fs.mkdirSync(app, { recursive: true });
      return app;
    },
    inspectApp: async () => over.info || { bundleId: "us.scopeflow.desktop", version: "0.1.5", minimumSystemVersion: "12.0", archs: ["x86_64", "arm64"], signatureOk: true },
    startInstall: (p) => calls.push(["install", p]),
    quit: () => calls.push(["quit"]),
    ui: {
      askRestart: async (status) => {
        calls.push(["ask", status.state, status.latest]);
        return (over.answers || [true]).shift() ?? true;
      },
      tell: async (status) => calls.push(["tell", status.state, rules.describe(status).title]),
      showProgress: () => calls.push(["progress"]),
      nudge: (status) => calls.push(["nudge", status.state]),
    },
    now: () => 1_000_000,
    setTimer: () => null,
    clearTimer: () => {},
    ...over.deps,
  };
  const statuses = [];
  const updater = createUpdater({ ...d, onStatus: (s) => statuses.push(s.state) });
  return { updater, calls, box, dir, statuses, d, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("an automatic check downloads and checks 0.1.5, then offers it on the ribbon and in the menu, with no dialog mid-work", async () => {
  const h = harness();
  await h.updater.start();
  assert.deepEqual(h.calls.map((c) => c[0]), ["fetch", "download", "nudge"]);
  assert.equal(h.updater.status().state, "ready");
  assert.equal(rules.menuLabel(h.updater.status()), "Restart to Update to 0.1.5…");
  assert.deepEqual(rules.ribbonButton(h.updater.status()), { label: "Restart to Update", title: "ScopeFlow 0.1.5 is ready to install" });
  assert.equal(fs.existsSync(path.join(h.dir, "Updates", "0.1.5", "ScopeFlow-mac.zip")), false, "the zip is removed once unpacked");
  assert.equal(h.box.saved.staged.version, "0.1.5");
  for (const step of ["checking", "available", "downloading", "verifying", "ready"]) assert.ok(h.statuses.includes(step), step);
  await h.updater.check("timer");
  assert.equal(h.calls.filter((c) => c[0] === "ask").length, 0, "a later automatic check does not ask either");
  h.done();
});

test("Restart to Update (menu or ribbon) asks “Update available, restart to update”, then installs and quits", async () => {
  const h = harness();
  await h.updater.start();
  await h.updater.menuClick();
  assert.deepEqual(h.calls.slice(3).map((c) => c[0]), ["ask", "install", "quit"]);
  assert.deepEqual(h.calls[3], ["ask", "ready", "0.1.5"]);
  const install = h.calls[4][1];
  assert.equal(install.target, "/Applications/ScopeFlow.app");
  assert.equal(install.staged, path.join(h.dir, "Updates", "0.1.5", "app", "ScopeFlow.app"));
  assert.equal(install.resultFile, path.join(h.dir, "Updates", RESULT_FILE));
  assert.deepEqual(h.box.saved.installing, { version: "0.1.5", from: "0.1.4", at: 1_000_000 });
  assert.equal(h.updater.status().state, "installing");
  assert.equal(rules.menuLabel(h.updater.status()), "Restarting to Update…");
  h.done();
});

test("Later keeps the update waiting; pressing Restart to Update again asks again", async () => {
  const h = harness({ answers: [false, true] });
  await h.updater.start();
  await h.updater.menuClick();
  assert.equal(h.updater.status().state, "ready");
  assert.equal(h.calls.some((c) => c[0] === "install"), false);
  await h.updater.menuClick();
  assert.deepEqual(h.calls.slice(3).map((c) => c[0]), ["ask", "ask", "install", "quit"]);
  h.done();
});

test("an update downloaded earlier is offered as soon as ScopeFlow opens, even offline", async () => {
  for (const fetchError of [null, new Error("net::ERR_INTERNET_DISCONNECTED")]) {
    const h = harness({ fetchError });
    const app = path.join(h.dir, "Updates", "0.1.5", "app", "ScopeFlow.app");
    fs.mkdirSync(app, { recursive: true });
    h.box.saved = { staged: { version: "0.1.5", app, notes: null } };
    const updater = createUpdater({ ...h.d, onStatus: () => {} });
    await updater.start();
    assert.deepEqual(h.calls.map((c) => c[0]), ["fetch", "ask", "install", "quit"], fetchError ? "offline" : "online");
    assert.equal(h.calls[2][1].staged, app);
    h.done();
  }
});

test("Check for Updates… when up to date says so in words; an automatic check stays quiet", async () => {
  const h = harness({ manifest: goodManifest({ version: "0.1.4" }) });
  await h.updater.start();
  assert.deepEqual(h.calls.map((c) => c[0]), ["fetch"], "launch: nothing shown");
  await h.updater.menuClick();
  assert.deepEqual(h.calls.at(-1), ["tell", "up-to-date", "You're up to date"]);
  assert.equal(h.calls.some((c) => c[0] === "download"), false);
  h.done();
});

test("a download that does not match the published SHA-256 is thrown away and nothing is installed", async () => {
  const h = harness({ payload: "hello worlD" });
  await h.updater.check("manual");
  assert.equal(h.calls.some((c) => c[0] === "ask" || c[0] === "install"), false);
  assert.equal(h.updater.status().state, "error");
  assert.match(h.updater.status().message, /does not match the SHA-256 checksum published with ScopeFlow 0\.1\.5/);
  assert.deepEqual(h.calls.at(-1), ["tell", "error", "ScopeFlow 0.1.5 could not be downloaded"]);
  assert.equal(fs.existsSync(path.join(h.dir, "Updates", "0.1.5")), false);
  assert.equal(h.box.saved.staged, undefined);
  h.done();
});

test("a download holding a different app, or one this Mac cannot run, is refused", async () => {
  const other = harness({ info: { bundleId: "com.example.other", version: "0.1.5", archs: ["x86_64", "arm64"], signatureOk: true } });
  await other.updater.check("manual");
  assert.match(other.updater.status().message, /different app/);
  assert.equal(other.calls.some((c) => c[0] === "install"), false);
  other.done();
  const intelOnly = harness({ info: { bundleId: "us.scopeflow.desktop", version: "0.1.5", archs: ["x86_64"], signatureOk: true } });
  await intelOnly.updater.check("manual");
  assert.match(intelOnly.updater.status().message, /chip \(arm64\)/);
  intelOnly.done();
});

test("GitHub out of reach: the menu item says so; an automatic check stays quiet", async () => {
  const h = harness({ fetchError: new Error("net::ERR_INTERNET_DISCONNECTED") });
  await h.updater.check("launch");
  assert.deepEqual(h.calls.map((c) => c[0]), ["fetch"]);
  await h.updater.check("manual");
  assert.equal(h.calls.at(-1)[2], "ScopeFlow could not check for updates");
  assert.match(h.updater.status().message, /ERR_INTERNET_DISCONNECTED/);
  h.done();
  const missing = harness({ fetchError: Object.assign(new Error("GitHub answered 404"), { status: 404 }) });
  await missing.updater.check("manual");
  assert.match(missing.updater.status().message, /has no update file/);
  missing.done();
});

test("automatic checks off: nothing on launch, and the menu item still checks", async () => {
  const h = harness({ settings: { automatic: false } });
  await h.updater.start();
  assert.deepEqual(h.calls, []);
  await h.updater.menuClick();
  assert.equal(h.calls[0][0], "fetch");
  h.done();
});

test("background download off: Update Available on the ribbon; pressing it asks, then downloads and restarts", async () => {
  const h = harness({ settings: { downloadInBackground: false } });
  await h.updater.check("launch");
  assert.deepEqual(h.calls.map((c) => c[0]), ["fetch", "nudge"]);
  assert.deepEqual(rules.ribbonButton(h.updater.status()), { label: "Update Available", title: "ScopeFlow 0.1.5 is available" });
  await h.updater.menuClick();
  assert.deepEqual(h.calls.slice(2).map((c) => c[0]), ["ask", "progress", "download", "install", "quit"]);
  assert.deepEqual(h.calls[2], ["ask", "available", "0.1.5"]);
  h.done();
});

test("a folder this Mac account cannot change: told once per version, never half-installed", async () => {
  const h = harness({ place: { problem: "ScopeFlow cannot update itself in “/Applications”, because your Mac account cannot change that folder." } });
  await h.updater.check("launch");
  await h.updater.check("timer");
  const tells = h.calls.filter((c) => c[0] === "tell");
  assert.equal(tells.length, 1);
  assert.deepEqual(tells[0], ["tell", "blocked", "ScopeFlow cannot update itself here"]);
  assert.equal(h.calls.some((c) => c[0] === "download" || c[0] === "install"), false);
  h.done();
});

test("the next start reports an install that failed, and tidies old downloads after one that worked", async () => {
  const failed = harness({ saved: { installing: { version: "0.1.5", from: "0.1.4" } }, manifest: goodManifest({ version: "0.1.4" }) });
  fs.mkdirSync(failed.d.updatesDir, { recursive: true });
  fs.writeFileSync(path.join(failed.d.updatesDir, RESULT_FILE), "failed\tThe old version could not be moved aside. Permission denied\n");
  await failed.updater.start();
  const tell = failed.calls.find((c) => c[0] === "tell");
  assert.deepEqual(tell, ["tell", "error", "The update was not installed"]);
  assert.equal(failed.box.saved.installing, undefined);
  assert.equal(fs.existsSync(path.join(failed.d.updatesDir, RESULT_FILE)), false);
  failed.done();

  const worked = harness({
    saved: { installing: { version: "0.1.5", from: "0.1.4" }, staged: { version: "0.1.5", app: "/gone/ScopeFlow.app" } },
    manifest: goodManifest({ version: "0.1.5" }),
    deps: { currentVersion: "0.1.5" },
  });
  fs.mkdirSync(path.join(worked.d.updatesDir, "0.1.5", "app"), { recursive: true });
  fs.mkdirSync(path.join(worked.d.updatesDir, "0.1.3"), { recursive: true });
  await worked.updater.start();
  assert.equal(worked.calls.some((c) => c[0] === "tell"), false);
  assert.deepEqual(fs.readdirSync(worked.d.updatesDir), []);
  assert.equal(worked.box.saved.staged, undefined);
  assert.equal(worked.updater.status().state, "up-to-date");
  worked.done();
});

test("running from source: the menu item says updates are off here", async () => {
  const h = harness({ deps: { disabledReason: "ScopeFlow is running from its source folder (npm start), so it does not update itself." } });
  await h.updater.start();
  assert.deepEqual(h.calls, []);
  await h.updater.menuClick();
  assert.deepEqual(h.calls, [["tell", "unsupported", "Updates are off here"]]);
  h.done();
});

/* ---------------------------------------------------------------- the install script */

const onMac = process.platform === "darwin";

function fakeApps() {
  const dir = tmp();
  const target = path.join(dir, "Applications", "ScopeFlow.app");
  const staged = path.join(dir, "Updates", "0.1.5", "app", "ScopeFlow.app");
  for (const [app, version] of [[target, "0.1.4"], [staged, "0.1.5"]]) {
    fs.mkdirSync(path.join(app, "Contents"), { recursive: true });
    fs.writeFileSync(path.join(app, "Contents", "version"), version);
  }
  return { dir, target, staged, log: path.join(dir, "updates.log"), result: path.join(dir, "Updates", RESULT_FILE) };
}

const deadPid = () => spawnSync("/usr/bin/true").pid;

function runScript(command) {
  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, { stdio: "ignore" });
    child.on("exit", (code) => resolve(code));
  });
}

test("the install script waits for ScopeFlow to quit, then swaps in the new app and leaves nothing behind", { skip: !onMac }, async () => {
  const f = fakeApps();
  const app = spawn("/bin/sleep", ["0.6"]);
  const started = Date.now();
  const code = await runScript(installCommand({ pid: app.pid, target: f.target, staged: f.staged, logFile: f.log, resultFile: f.result, relaunch: false }));
  assert.equal(code, 0);
  assert.ok(Date.now() - started >= 500, "waited for the app to quit");
  assert.equal(fs.readFileSync(path.join(f.target, "Contents", "version"), "utf8"), "0.1.5");
  assert.equal(fs.existsSync(f.staged), false);
  assert.deepEqual(fs.readdirSync(path.dirname(f.target)), ["ScopeFlow.app"], "no .old or .new copies left");
  assert.deepEqual(readInstallResult(fs.readFileSync(f.result, "utf8")), { ok: true, where: f.target });
  assert.match(fs.readFileSync(f.log, "utf8"), /installed at .*ScopeFlow\.app/);
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test("the install script keeps the old app when the folder cannot be changed, and says why", { skip: !onMac }, async () => {
  const f = fakeApps();
  const folder = path.dirname(f.target);
  fs.chmodSync(folder, 0o555);
  try {
    const code = await runScript(installCommand({ pid: deadPid(), target: f.target, staged: f.staged, logFile: f.log, resultFile: f.result, relaunch: false }));
    assert.equal(code, 1);
    assert.equal(fs.readFileSync(path.join(f.target, "Contents", "version"), "utf8"), "0.1.4", "old app untouched");
    assert.equal(fs.existsSync(f.staged), true, "new app still waiting");
    const result = readInstallResult(fs.readFileSync(f.result, "utf8"));
    assert.equal(result.ok, false);
    assert.match(result.reason, /could not be put in .*Permission denied/);
  } finally {
    fs.chmodSync(folder, 0o755);
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test("the install script refuses anything that is not an app", { skip: !onMac }, async () => {
  const f = fakeApps();
  const command = installCommand({ pid: deadPid(), target: f.target, staged: f.staged, logFile: f.log, resultFile: f.result, relaunch: false });
  command.args[4] = path.dirname(f.target); // the folder, not the app
  assert.equal(await runScript(command), 1);
  assert.match(readInstallResult(fs.readFileSync(f.result, "utf8")).reason, /Not an app to replace/);
  assert.equal(fs.readFileSync(path.join(f.target, "Contents", "version"), "utf8"), "0.1.4");
  fs.rmSync(f.dir, { recursive: true, force: true });
});

test("the install command: only the app's own switches go to the new copy; paths must be apps", () => {
  assert.deepEqual(relaunchArgs(["--user-data-dir=/tmp/test", "-psn_0_123", "--scopeflow-update-feed=http://127.0.0.1:8123/x.json", 7]), [
    "--user-data-dir=/tmp/test",
    "--scopeflow-update-feed=http://127.0.0.1:8123/x.json",
  ]);
  const ok = { pid: 42, target: "/Applications/ScopeFlow.app", staged: "/tmp/u/ScopeFlow.app", logFile: "/tmp/l", resultFile: "/tmp/r" };
  const command = installCommand({ ...ok, args: ["--user-data-dir=/tmp/test"] });
  assert.equal(command.file, "/bin/sh");
  assert.deepEqual(command.args.slice(2), ["scopeflow-update", "42", "/Applications/ScopeFlow.app", "/tmp/u/ScopeFlow.app", "/tmp/l", "/tmp/r", "yes", "--user-data-dir=/tmp/test"]);
  assert.throws(() => installCommand({ ...ok, target: "Applications/ScopeFlow.app" }), /not an app/);
  assert.throws(() => installCommand({ ...ok, staged: "/tmp/u" }), /not an app/);
  assert.throws(() => installCommand({ ...ok, pid: 0 }), /process id/);
  assert.equal(readInstallResult("nonsense"), null);
});
