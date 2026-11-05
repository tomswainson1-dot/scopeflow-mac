/**
 * The in-app updater's steps (4 Nov 2026): check the newest GitHub release, download and check it, ask "Update
 * available, restart to update", then hand over to the install script and quit. The rules are in src/update-rules.js;
 * the network, the macOS tools and the dialogs are passed in (src/update-mac.js and src/main.js), so the tests run the
 * whole sequence without Electron.
 *
 * Status states: idle, checking, up-to-date, available, downloading, verifying, ready, installing, blocked (cannot
 * update here or needs a newer macOS), error, unsupported (running from source).
 */

const path = require("path");
const nodeFs = require("fs");
const {
  ZIP_NAME,
  checkDownload,
  checkStagedApp,
  cleanUpdateSettings,
  compareVersions,
  decideUpdate,
  nextCheckDelay,
  parseVersion,
  shouldCheck,
  validateManifest,
} = require("./update-rules");
const { readInstallResult } = require("./update-install");

const RESULT_FILE = "install-result.txt";

/**
 * @param {object} d
 * @param {string} d.currentVersion        app.getVersion()
 * @param {string} d.feedUrl               where ScopeFlow-mac.json is read from
 * @param {string|null} [d.disabledReason] a sentence when updates cannot work here (running from source)
 * @param {string|null} d.systemVersion    "26.6.2"
 * @param {string} d.arch                  process.arch
 * @param {string|null} d.ownBundleId      this app's bundle id; the new app must have the same
 * @param {() => object} d.settings        Settings → Updates
 * @param {{read(): any, write(state: object): void}} d.store   update-state.json
 * @param {string} d.updatesDir            where downloads are unpacked (in the app's data folder)
 * @param {() => ({target: string} | {problem: string})} d.locate
 * @param {(url: string) => Promise<any>} d.fetchJson
 * @param {(url: string, file: string, o: {expectedSize: number, onProgress(bytes: number): void}) => Promise<void>} d.download
 * @param {(file: string) => Promise<{size: number, sha256: string}>} d.hashFile
 * @param {(zip: string, dir: string) => Promise<string>} d.unpack      → the unpacked .app
 * @param {(app: string) => Promise<object>} d.inspectApp               → see checkStagedApp
 * @param {(p: {target: string, staged: string, resultFile: string}) => void} d.startInstall
 * @param {() => void} d.quit
 * @param {{askRestart(status): Promise<boolean>, tell(status): Promise<void>, showProgress(): void, nudge?(status): void}} d.ui
 *   nudge: an automatic check found an update; draw attention without a dialog (the Dock icon bounces once).
 */
function createUpdater(d) {
  const fs = d.fs || nodeFs;
  const now = d.now || (() => Date.now());
  const log = d.log || (() => {});
  const onStatus = d.onStatus || (() => {});
  const setTimer = d.setTimer || setTimeout;
  const clearTimer = d.clearTimer || clearTimeout;
  const resultFile = path.join(d.updatesDir, RESULT_FILE);

  const saved = (() => {
    try {
      const s = d.store.read();
      return s && typeof s === "object" ? s : {};
    } catch {
      return {};
    }
  })();
  let status = { state: "idle", current: d.currentVersion, latest: null, progress: null, title: null, message: null, notes: null };
  let job = null;
  let prompting = false;
  let pendingManifest = null;
  let timer = null;
  /** The version already downloaded when ScopeFlow opened, if any: offered straight away at launch. */
  let waitingAtStart = null;

  const save = () => {
    try {
      d.store.write(saved);
    } catch (err) {
      log(`could not save the update state: ${err.message}`);
    }
  };

  function setStatus(patch) {
    status = { ...status, ...patch, current: d.currentVersion, lastCheckAt: Number.isFinite(saved.lastCheckAt) ? saved.lastCheckAt : null };
    onStatus(status);
    return status;
  }

  const settings = () => cleanUpdateSettings(d.settings());

  /** A downloaded, checked update that is newer than this copy and still on disk. */
  function stagedUpdate() {
    const s = saved.staged;
    if (!s || typeof s.version !== "string" || typeof s.app !== "string" || !parseVersion(s.version)) return null;
    if (compareVersions(s.version, d.currentVersion) <= 0) return null;
    return fs.existsSync(s.app) ? s : null;
  }

  function forgetStaged() {
    if (!saved.staged) return;
    try {
      fs.rmSync(path.join(d.updatesDir, saved.staged.version), { recursive: true, force: true });
    } catch {
      // Tidied again on the next start.
    }
    delete saved.staged;
    save();
  }

  /** One check or download at a time. */
  function run(work) {
    if (!job) {
      job = Promise.resolve()
        .then(work)
        .catch((err) => {
          log(`unexpected: ${err && err.stack ? err.stack : err}`);
          setStatus({ state: "error", title: "ScopeFlow could not update", message: String(err && err.message ? err.message : err), progress: null });
        })
        .finally(() => {
          job = null;
          schedule();
        });
    }
    return job;
  }

  async function fetchManifest() {
    let raw;
    try {
      raw = await d.fetchJson(d.feedUrl);
    } catch (err) {
      throw new Error(err && err.status === 404
        ? "The newest ScopeFlow release on GitHub has no update file (ScopeFlow-mac.json)."
        : `GitHub could not be reached (${err && err.message ? err.message : err}). Check the internet connection and try again.`);
    }
    const checked = validateManifest(raw, d.feedUrl);
    if (!checked.ok) throw new Error(checked.error);
    return checked.manifest;
  }

  async function lookForUpdate(trigger) {
    // The next automatic check counts from this attempt, so a Mac that is offline asks again after the person's
    // interval, not over and over.
    saved.lastAttemptAt = now();
    save();
    setStatus({ state: "checking", title: null, message: null, progress: null });
    let manifest;
    try {
      manifest = await fetchManifest();
    } catch (err) {
      log(`check (${trigger}) failed: ${err.message}`);
      const staged = stagedUpdate();
      if (staged) return setStatus({ state: "ready", latest: staged.version, notes: staged.notes || null });
      return setStatus({ state: "error", title: "ScopeFlow could not check for updates", message: err.message });
    }
    saved.lastCheckAt = now();
    save();
    const decision = decideUpdate({ currentVersion: d.currentVersion, manifest, systemVersion: d.systemVersion });
    log(`check (${trigger}): newest ${manifest.version}, this copy ${d.currentVersion}: ${decision.kind}`);
    if (decision.kind === "up-to-date") {
      forgetStaged();
      return setStatus({ state: "up-to-date", latest: manifest.version, notes: null });
    }
    if (decision.kind === "needs-newer-macos") {
      return setStatus({ state: "blocked", latest: manifest.version, title: "This update needs a newer macOS", message: decision.message });
    }
    const staged = stagedUpdate();
    if (staged && staged.version === manifest.version) {
      return setStatus({ state: "ready", latest: staged.version, notes: staged.notes || manifest.notes || null });
    }
    const place = d.locate();
    if (place.problem) {
      return setStatus({ state: "blocked", latest: manifest.version, title: "ScopeFlow cannot update itself here", message: place.problem });
    }
    pendingManifest = manifest;
    setStatus({ state: "available", latest: manifest.version, notes: manifest.notes || null });
    if (trigger === "manual" || trigger === "window" || settings().downloadInBackground) {
      if (trigger === "manual") d.ui.showProgress();
      await fetchUpdate(manifest);
    }
    return status;
  }

  async function fetchUpdate(manifest) {
    const dir = path.join(d.updatesDir, manifest.version);
    try {
      setStatus({ state: "downloading", latest: manifest.version, progress: 0, title: null, message: null });
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const zip = path.join(dir, ZIP_NAME);
      let shown = -1;
      await d.download(manifest.url, zip, {
        expectedSize: manifest.size,
        onProgress: (bytes) => {
          const progress = Math.min(1, bytes / manifest.size);
          const percent = Math.floor(progress * 100);
          if (percent !== shown) {
            shown = percent;
            setStatus({ progress });
          }
        },
      });
      setStatus({ state: "verifying", progress: null });
      const problem = checkDownload(await d.hashFile(zip), manifest);
      if (problem) throw new Error(problem);
      const app = await d.unpack(zip, path.join(dir, "app"));
      const info = await d.inspectApp(app);
      const appProblem = checkStagedApp(info, {
        bundleId: d.ownBundleId,
        version: manifest.version,
        arch: d.arch,
        systemVersion: d.systemVersion,
      });
      if (appProblem) throw new Error(`${appProblem} Nothing was changed.`);
      fs.rmSync(zip, { force: true });
      saved.staged = { version: manifest.version, app, notes: manifest.notes || null };
      save();
      log(`${manifest.version} downloaded and checked: ${app}`);
      return setStatus({ state: "ready", notes: manifest.notes || null });
    } catch (err) {
      log(`download of ${manifest.version} failed: ${err.message}`);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Tidied again on the next start.
      }
      return setStatus({
        state: "error",
        progress: null,
        title: `ScopeFlow ${manifest.version} could not be downloaded`,
        message: err.message,
      });
    }
  }

  async function install() {
    const staged = stagedUpdate();
    if (!staged) {
      setStatus({ state: "error", title: "The update is no longer there", message: "Check for updates again." });
      await d.ui.tell(status);
      return;
    }
    const place = d.locate();
    if (place.problem) {
      setStatus({ state: "blocked", title: "ScopeFlow cannot update itself here", message: place.problem });
      await d.ui.tell(status);
      return;
    }
    try {
      fs.rmSync(resultFile, { force: true });
      d.startInstall({ target: place.target, staged: staged.app, resultFile });
    } catch (err) {
      setStatus({ state: "error", title: "The update could not start", message: err.message });
      await d.ui.tell(status);
      return;
    }
    saved.installing = { version: staged.version, from: d.currentVersion, at: now() };
    save();
    setStatus({ state: "installing", latest: staged.version });
    log(`installing ${staged.version} over ${place.target}; quitting`);
    d.quit();
  }

  /** "Update available, restart to update". Never two at once. */
  async function offerRestart() {
    if (prompting || (status.state !== "ready" && status.state !== "available")) return;
    prompting = true;
    try {
      const yes = await d.ui.askRestart(status);
      log(`${status.latest}: ${yes ? "Restart to Update" : "Later"}`);
      if (!yes) return;
      if (status.state === "available") {
        d.ui.showProgress();
        if (pendingManifest) await run(() => fetchUpdate(pendingManifest));
        if (status.state !== "ready") {
          await d.ui.tell(status);
          return;
        }
      }
      await install();
    } finally {
      prompting = false;
    }
  }

  /**
   * After a check. The menu item gets the question or the result in words. An automatic check never opens a dialog
   * while the person is working (a Return meant for the page would restart ScopeFlow): a new version shows as Restart
   * to Update in the window's ribbon and the ScopeFlow menu. The one automatic question is at launch, before work
   * starts, for an update downloaded earlier. A newer version this copy cannot install is mentioned once.
   */
  async function respond(trigger) {
    if (status.state === "ready" || status.state === "available") {
      if (trigger === "manual" || (trigger === "launch" && waitingAtStart === status.latest && status.state === "ready")) {
        await offerRestart();
      } else if (trigger === "launch" || trigger === "timer") {
        d.ui.nudge?.(status);
      }
      return;
    }
    if (trigger === "manual") {
      await d.ui.tell(status);
      return;
    }
    if ((trigger === "launch" || trigger === "timer") && status.state === "blocked" && status.latest && saved.blockedNotice !== status.latest) {
      saved.blockedNotice = status.latest;
      save();
      await d.ui.tell(status);
    }
  }

  /**
   * @param {"launch"|"timer"|"manual"|"window"} trigger
   */
  async function check(trigger = "manual") {
    if (d.disabledReason) {
      setStatus({ state: "unsupported", title: "Updates are off here", message: d.disabledReason });
      if (trigger === "manual") await d.ui.tell(status);
      return status;
    }
    if (job) {
      if (trigger === "manual") d.ui.showProgress();
      return status;
    }
    if (!shouldCheck({ trigger, settings: settings(), lastCheckAt: saved.lastAttemptAt, now: now() })) return status;
    await run(() => lookForUpdate(trigger));
    await respond(trigger);
    return status;
  }

  /** The ScopeFlow menu item, and the Restart to Update button in the window's ribbon. */
  function menuClick() {
    switch (status.state) {
      case "ready":
      case "available":
        return offerRestart();
      case "checking":
      case "downloading":
      case "verifying":
        d.ui.showProgress();
        return Promise.resolve();
      case "installing":
        return Promise.resolve();
      default:
        return check("manual");
    }
  }

  /** The Restart to Update button in Settings: the click is the go-ahead. */
  async function restartNow() {
    if (status.state === "ready") return install();
    if (status.state === "available" && pendingManifest) {
      await run(() => fetchUpdate(pendingManifest));
      if (status.state === "ready") return install();
      return undefined;
    }
    return check("window");
  }

  function schedule() {
    if (timer) clearTimer(timer);
    timer = null;
    if (d.disabledReason) return;
    const delay = nextCheckDelay({ settings: settings(), lastCheckAt: saved.lastAttemptAt, now: now() });
    if (delay === null) return;
    timer = setTimer(() => {
      timer = null;
      check("timer").finally(schedule);
    }, Math.max(delay, 1000));
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  /** Remove downloads for this version or older, and anything else that is not the update waiting to install. */
  function tidy() {
    let names = [];
    try {
      names = fs.readdirSync(d.updatesDir);
    } catch {
      return;
    }
    const keep = stagedUpdate();
    for (const name of names) {
      if (name === RESULT_FILE || (keep && name === keep.version)) continue;
      try {
        fs.rmSync(path.join(d.updatesDir, name), { recursive: true, force: true });
      } catch {
        // Tried again on the next start.
      }
    }
    if (saved.staged && !keep) {
      delete saved.staged;
      save();
    }
  }

  /** On launch: report the last install, tidy up, then the launch check and the timer. */
  async function start() {
    let result = null;
    try {
      result = readInstallResult(fs.readFileSync(resultFile, "utf8"));
      fs.rmSync(resultFile, { force: true });
    } catch {
      result = null;
    }
    let failedInstall = null;
    if (saved.installing) {
      const wanted = saved.installing.version;
      const arrived = parseVersion(wanted) && compareVersions(d.currentVersion, wanted) >= 0;
      if (arrived) log(`now running ${d.currentVersion} (updated from ${saved.installing.from})`);
      else failedInstall = (result && !result.ok && result.reason) || "ScopeFlow did not open on the new version.";
      delete saved.installing;
      save();
    }
    tidy();
    const staged = stagedUpdate();
    waitingAtStart = staged ? staged.version : null;
    if (staged) setStatus({ state: "ready", latest: staged.version, notes: staged.notes || null });
    else setStatus({});
    schedule();
    if (failedInstall) {
      log(`the last update was not installed: ${failedInstall}`);
      setStatus({ state: "error", title: "The update was not installed", message: `${failedInstall} This copy of ScopeFlow was left as it was.` });
      await d.ui.tell(status);
    }
    return check("launch");
  }

  function stop() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  return {
    check,
    menuClick,
    restartNow,
    schedule,
    start,
    status: () => status,
    stop,
  };
}

module.exports = { RESULT_FILE, createUpdater };
