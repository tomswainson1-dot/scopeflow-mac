/**
 * In-app updates for ScopeFlow for Mac (4 Nov 2026). Tom: "allow users to update from inside the software so I don't
 * have to delete and re-install or run a command."
 *
 * Why not Electron's own updater: on macOS it is Squirrel.Mac (electron-updater hands its download to Squirrel too), and
 * Squirrel only takes an update whose code signature meets the running app's designated requirement. This app is signed
 * ad hoc (there is no Apple Developer ID on this Mac), so that requirement is the app's own cdhash and no newer build can
 * meet it. Measured 4 Nov 2026 on macOS 26.6.2: Squirrel turned down a newer ad-hoc build with "code failed to satisfy
 * specified code requirement(s)".
 *
 * So the app updates itself. It reads ScopeFlow-mac.json from the newest GitHub release, downloads ScopeFlow-mac.zip from
 * that same release, checks its size and SHA-256 against that file, unpacks it with ditto and checks the new app (same
 * bundle id, the promised version, a valid signature, this Mac's chip, this macOS). When the person chooses Restart to
 * Update, a small shell script swaps the app once ScopeFlow has quit and opens the new one (src/update-install.js).
 * Measured the same day: macOS put no quarantine on the download, showed no Gatekeeper warning for the new copy and did
 * not block the swap (App Management), with the app in /Applications, in an ordinary folder, and running translocated
 * from a quarantined download in the way Tom runs his own copy from Downloads.
 *
 * This file is the plain logic (no Electron), so the tests run without it. src/updater.js runs the steps;
 * src/update-mac.js does the network and the macOS tools.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const RELEASES_REPO = "tomswainson1-dot/scopeflow-mac";
const MANIFEST_NAME = "ScopeFlow-mac.json";
const ZIP_NAME = "ScopeFlow-mac.zip";
/**
 * The manifest on the newest release. GitHub answers this address with a redirect to the file on whichever release is
 * marked Latest, so the app never calls the GitHub API and is never rate-limited.
 */
const DEFAULT_FEED_URL = `https://github.com/${RELEASES_REPO}/releases/latest/download/${MANIFEST_NAME}`;

const HOUR = 60 * 60 * 1000;
/** Sanity limits on what is downloaded, not settings: the 0.1.3 zip is 224 MB and its manifest is under 1 KB. */
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Settings → Updates. These are what a person starts with; each one can be changed in the Settings window
 * (Tom: every timing and default in a settings window, never hard-coded).
 */
const UPDATE_DEFAULTS = Object.freeze({
  /** Check for updates automatically. Off means only when the person asks. */
  automatic: true,
  /** …when ScopeFlow opens. */
  checkOnLaunch: true,
  /** …and again while ScopeFlow stays open, this many hours after the last check. 0 = not while it is open. */
  intervalHours: 4,
  /** Download a new version before asking, so Restart to Update is quick. Off means ask first, then download. */
  downloadInBackground: true,
});

/** The choices offered for "While ScopeFlow is open, check again". */
const INTERVAL_CHOICES = Object.freeze([
  Object.freeze({ hours: 1, label: "Every hour" }),
  Object.freeze({ hours: 4, label: "Every 4 hours" }),
  Object.freeze({ hours: 24, label: "Every day" }),
  Object.freeze({ hours: 168, label: "Every week" }),
  Object.freeze({ hours: 0, label: "Never" }),
]);

/** A saved settings object, with anything missing or not understood put back to its default. */
function cleanUpdateSettings(raw) {
  const given = raw && typeof raw === "object" ? raw : {};
  const bool = (key) => (typeof given[key] === "boolean" ? given[key] : UPDATE_DEFAULTS[key]);
  const hours = Number(given.intervalHours);
  return {
    automatic: bool("automatic"),
    checkOnLaunch: bool("checkOnLaunch"),
    intervalHours: INTERVAL_CHOICES.some((c) => c.hours === hours) ? hours : UPDATE_DEFAULTS.intervalHours,
    downloadInBackground: bool("downloadInBackground"),
  };
}

/* ------------------------------------------------------------------------------------------------ versions */

const VERSION_RE = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** "0.1.4", "v0.1.4" or "1.2.0-beta.2" → its parts; anything else → null. */
function parseVersion(text) {
  const m = VERSION_RE.exec(String(text ?? "").trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split(".") : [] };
}

/** -1, 0 or 1, the semver way: 0.1.10 is newer than 0.1.9, and 0.2.0-beta.1 is older than 0.2.0. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x) throw new Error(`Not a version: ${a}`);
  if (!y) throw new Error(`Not a version: ${b}`);
  for (const part of ["major", "minor", "patch"]) {
    if (x[part] !== y[part]) return x[part] < y[part] ? -1 : 1;
  }
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pNum = /^\d+$/.test(p);
    const qNum = /^\d+$/.test(q);
    if (pNum && qNum && Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1;
    if (pNum !== qNum) return pNum ? -1 : 1;
    if (!pNum && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** macOS versions ("26.6.2", "12.0"): any number of dotted parts, missing parts count as 0. */
function compareDotted(a, b) {
  const x = String(a).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const y = String(b).split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/* ------------------------------------------------------------------------------------------------ when to check */

/**
 * Whether to look for an update now.
 * @param {{trigger: "launch"|"timer"|"manual"|"window", settings: object, lastCheckAt?: number|null, now: number}} p
 *   "manual" is the menu item and "window" is Check Now in Settings: those always check.
 */
function shouldCheck({ trigger, settings, lastCheckAt, now }) {
  if (trigger === "manual" || trigger === "window") return true;
  const s = cleanUpdateSettings(settings);
  if (!s.automatic) return false;
  if (trigger === "launch") return s.checkOnLaunch;
  if (trigger === "timer") {
    if (!s.intervalHours) return false;
    if (!Number.isFinite(lastCheckAt) || lastCheckAt > now) return true;
    return now - lastCheckAt >= s.intervalHours * HOUR;
  }
  return false;
}

/** Milliseconds until the next check while ScopeFlow is open, or null for none. */
function nextCheckDelay({ settings, lastCheckAt, now }) {
  const s = cleanUpdateSettings(settings);
  if (!s.automatic || !s.intervalHours) return null;
  const every = s.intervalHours * HOUR;
  // Never checked, or the clock went back: the full interval from now.
  if (!Number.isFinite(lastCheckAt) || lastCheckAt > now) return every;
  return Math.max(0, lastCheckAt + every - now);
}

/* ------------------------------------------------------------------------------------------------ the release */

function hostIs(hostname, suffix) {
  const host = String(hostname).toLowerCase().replace(/\.$/, "");
  return host === suffix || host.endsWith(`.${suffix}`);
}

function isLoopback(hostname) {
  const host = String(hostname).toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

/** GitHub serves the release files: github.com, which redirects to release-assets.githubusercontent.com. */
function isGitHubUrl(url) {
  return url.protocol === "https:" && (hostIs(url.hostname, "github.com") || hostIs(url.hostname, "githubusercontent.com"));
}

/**
 * The address to read the manifest from: the newest GitHub release, unless a test copy was opened with
 * --scopeflow-update-feed=<address>. Only another GitHub address or a server on this Mac is accepted.
 */
function resolveFeedUrl(override) {
  const text = String(override ?? "").trim();
  if (!text) return DEFAULT_FEED_URL;
  try {
    const url = new URL(text);
    if (isGitHubUrl(url)) return url.href;
    if ((url.protocol === "http:" || url.protocol === "https:") && isLoopback(url.hostname)) return url.href;
  } catch {
    // Not an address: ignore it.
  }
  return DEFAULT_FEED_URL;
}

/**
 * Where the app may fetch from, redirects included: GitHub over https, or the same test server on this Mac as the
 * manifest. The SHA-256 check is what proves the file; this keeps the app from talking to anything else on the way.
 */
function isAllowedUpdateUrl(raw, feedUrl) {
  let url;
  let feed;
  try {
    url = new URL(raw);
    feed = new URL(feedUrl);
  } catch {
    return false;
  }
  if (isLoopback(feed.hostname)) return url.origin === feed.origin || isGitHubUrl(url);
  return isGitHubUrl(url);
}

/**
 * ScopeFlow-mac.json, as published with each release by scripts/make-manifest.js:
 * { name, version, url, size, sha256, bundleId, minimumSystemVersion, notes, released }
 * @returns {{ok: true, manifest: object} | {ok: false, error: string}}
 */
function validateManifest(raw, feedUrl) {
  const fail = (error) => ({ ok: false, error });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("The update file is not in the expected form.");
  if (!parseVersion(raw.version)) return fail("The update file has no version number.");
  const elsewhere = "The update file points somewhere other than ScopeFlow's releases on GitHub.";
  if (typeof raw.url !== "string" || !isAllowedUpdateUrl(raw.url, feedUrl)) return fail(elsewhere);
  const zipUrl = new URL(raw.url);
  if (hostIs(zipUrl.hostname, "github.com") && !zipUrl.pathname.startsWith(`/${RELEASES_REPO}/releases/download/`)) {
    return fail(elsewhere);
  }
  if (!Number.isSafeInteger(raw.size) || raw.size <= 0 || raw.size > MAX_ZIP_BYTES) return fail("The update file gives no download size.");
  if (typeof raw.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(raw.sha256)) return fail("The update file has no SHA-256 checksum.");
  const minimum = typeof raw.minimumSystemVersion === "string" && /^\d+(\.\d+)*$/.test(raw.minimumSystemVersion)
    ? raw.minimumSystemVersion
    : null;
  const notes = typeof raw.notes === "string" && raw.notes.trim() ? raw.notes.trim().slice(0, 600) : null;
  return {
    ok: true,
    manifest: {
      version: String(raw.version).trim().replace(/^v/, ""),
      url: zipUrl.href,
      size: raw.size,
      sha256: raw.sha256.toLowerCase(),
      bundleId: typeof raw.bundleId === "string" ? raw.bundleId : null,
      minimumSystemVersion: minimum,
      notes,
    },
  };
}

/**
 * What to do with the newest release.
 * @returns {{kind: "up-to-date"|"available"|"needs-newer-macos", latest: string, message?: string}}
 */
function decideUpdate({ currentVersion, manifest, systemVersion }) {
  const latest = manifest.version;
  if (compareVersions(latest, currentVersion) <= 0) return { kind: "up-to-date", latest };
  if (manifest.minimumSystemVersion && systemVersion && compareDotted(systemVersion, manifest.minimumSystemVersion) < 0) {
    return {
      kind: "needs-newer-macos",
      latest,
      message: `ScopeFlow ${latest} needs macOS ${manifest.minimumSystemVersion} or later, and this Mac has macOS ${systemVersion}. ScopeFlow ${currentVersion} keeps working.`,
    };
  }
  return { kind: "available", latest };
}

/** The SHA-256 and size of a file, read in pieces (the zip is about 224 MB). */
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    let size = 0;
    fs.createReadStream(file)
      .on("data", (chunk) => {
        size += chunk.length;
        hash.update(chunk);
      })
      .on("error", reject)
      .on("end", () => resolve({ size, sha256: hash.digest("hex") }));
  });
}

/** Null when the download is exactly the published file; otherwise what is wrong, in words. */
function checkDownload(got, manifest) {
  if (got.size !== manifest.size) {
    return `The download is ${got.size} bytes but the release says ${manifest.size}. Nothing was changed.`;
  }
  if (String(got.sha256).toLowerCase() !== manifest.sha256.toLowerCase()) {
    return `The download does not match the SHA-256 checksum published with ScopeFlow ${manifest.version}. Nothing was changed.`;
  }
  return null;
}

/** Mach-O CPU types: the two a Mac runs today, and the old ones by name. */
const CPU_TYPES = { 0x01000007: "x86_64", 0x0100000c: "arm64", 7: "i386", 12: "arm" };

/** The chips an executable is built for, from its first bytes (no lipo: that needs Xcode's tools on most Macs). */
function machoArchs(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return [];
  const big = buffer.readUInt32BE(0);
  if (big === 0xcafebabe || big === 0xcafebabf) {
    const count = buffer.readUInt32BE(4);
    const entry = big === 0xcafebabe ? 20 : 32;
    if (count < 1 || count > 16) return [];
    const archs = [];
    for (let i = 0; i < count && 8 + (i + 1) * entry <= buffer.length; i += 1) {
      const cpu = buffer.readUInt32BE(8 + i * entry);
      archs.push(CPU_TYPES[cpu] || `cpu ${cpu}`);
    }
    return archs;
  }
  const little = buffer.readUInt32LE(0);
  if (little === 0xfeedfacf || little === 0xfeedface) {
    const cpu = buffer.readUInt32LE(4);
    return [CPU_TYPES[cpu] || `cpu ${cpu}`];
  }
  return [];
}

/** Node's name for this Mac's chip → the Mach-O name. */
function machArch(nodeArch) {
  return { arm64: "arm64", x64: "x86_64" }[nodeArch] || nodeArch;
}

/**
 * The new app, unpacked, before it is allowed to replace this one. Null when it is fit to install.
 * @param {{bundleId: string|null, version: string|null, minimumSystemVersion: string|null, archs: string[], signatureOk: boolean, signatureError?: string}} info
 * @param {{bundleId: string|null, version: string, arch: string, systemVersion: string|null}} expected
 */
function checkStagedApp(info, expected) {
  if (!info) return "The download did not contain the ScopeFlow app.";
  if (expected.bundleId && info.bundleId !== expected.bundleId) {
    return `The download is a different app (${info.bundleId || "no bundle id"}), not ${expected.bundleId}.`;
  }
  if (!info.version || !parseVersion(info.version) || compareVersions(info.version, expected.version) !== 0) {
    return `The app in the download is version ${info.version || "unknown"}, not ${expected.version}.`;
  }
  const chip = machArch(expected.arch);
  if (!info.archs.includes(chip)) {
    return `The app in the download does not run on this Mac's chip (${chip}); it has ${info.archs.join(", ") || "none"}.`;
  }
  if (info.minimumSystemVersion && expected.systemVersion && compareDotted(expected.systemVersion, info.minimumSystemVersion) < 0) {
    return `The new version needs macOS ${info.minimumSystemVersion} or later.`;
  }
  if (!info.signatureOk) {
    return `The app in the download failed its code-signature check${info.signatureError ? ` (${info.signatureError})` : ""}.`;
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------ where the app is */

/** …/ScopeFlow.app/Contents/MacOS/ScopeFlow → …/ScopeFlow.app, or null when not run from an app bundle. */
function bundleFromExecPath(execPath) {
  const macos = path.dirname(String(execPath || ""));
  const contents = path.dirname(macos);
  const bundle = path.dirname(contents);
  if (path.basename(macos) !== "MacOS" || path.basename(contents) !== "Contents" || !bundle.endsWith(".app")) return null;
  return bundle;
}

/**
 * An app opened from a quarantined download that was never moved by Finder runs from a read-only copy macOS makes
 * (App Translocation): /private/var/folders/…/AppTranslocation/<id>/d/ScopeFlow.app. Tom's own copy runs that way from
 * Downloads. The mount table names the original:
 * "/Users/tom/Downloads/ScopeFlow.app on /private/var/folders/…/AppTranslocation/<id> (nullfs, …, read-only, …)".
 * Returns the bundle to replace, or null when the original cannot be found.
 */
function originalBundlePath(bundle, mountTable) {
  const marker = "/AppTranslocation/";
  const at = bundle.indexOf(marker);
  if (at < 0) return bundle;
  const id = bundle.slice(at + marker.length).split("/")[0];
  if (!id) return null;
  const needle = `${marker}${id} (`;
  for (const line of String(mountTable || "").split("\n")) {
    const i = line.indexOf(needle);
    if (i < 0) continue;
    const on = line.lastIndexOf(" on ", i);
    if (on <= 0) continue;
    const source = line.slice(0, on);
    if (source.endsWith(".app") && path.basename(source) === path.basename(bundle)) return source;
  }
  return null;
}

/**
 * Where to install, or why ScopeFlow cannot update itself where it is.
 * @param {{execPath: string, mountTable: () => string, canWrite: (dir: string) => boolean}} p
 * @returns {{target: string, running: string} | {problem: string}}
 */
function locateApp({ execPath, mountTable, canWrite }) {
  const running = bundleFromExecPath(execPath);
  if (!running) return { problem: "ScopeFlow is not running as an app here, so it cannot update itself." };
  const target = running.includes("/AppTranslocation/") ? originalBundlePath(running, mountTable()) : running;
  if (!target) {
    return {
      problem:
        "macOS is running ScopeFlow from a temporary copy and the original could not be found. Quit ScopeFlow, move it to your Applications folder, open it from there and check again.",
    };
  }
  const folder = path.dirname(target);
  if (!canWrite(folder)) {
    return {
      problem: `ScopeFlow cannot update itself in “${folder}”, because your Mac account cannot change that folder. Ask someone with an administrator account on this Mac to update it, or move ScopeFlow to a folder you can change.`,
    };
  }
  return { target, running };
}

/* ------------------------------------------------------------------------------------------------ words */

const pct = (progress) => (Number.isFinite(progress) ? ` (${Math.floor(progress * 100)}%)` : "");

/** The ScopeFlow-menu item. Always pressable, so it is never greyed out; it says what pressing it does now. */
function menuLabel(status) {
  switch (status?.state) {
    case "checking":
      return "Checking for Updates…";
    case "downloading":
    case "verifying":
      return "Downloading Update…";
    case "ready":
      return `Restart to Update to ${status.latest}…`;
    case "installing":
      return "Restarting to Update…";
    default:
      return "Check for Updates…";
  }
}

/** The status in words: a title and a sentence or two, for the Settings window and for messages. */
function describe(status) {
  const current = status?.current || "";
  const latest = status?.latest || "";
  switch (status?.state) {
    case "checking":
      return { title: "Checking for updates…", detail: "ScopeFlow is looking for a newer version on GitHub." };
    case "up-to-date":
      return { title: "You're up to date", detail: `ScopeFlow ${current} is the newest version.` };
    case "available":
      return { title: "Update available", detail: `ScopeFlow ${latest} is available. You have ${current}.` };
    case "downloading":
      return {
        title: `Downloading ScopeFlow ${latest}${pct(status.progress)}`,
        detail: "ScopeFlow will ask you to restart when the update is ready. You can keep working.",
      };
    case "verifying":
      return { title: `Checking ScopeFlow ${latest}`, detail: "ScopeFlow is checking the download before it can be installed." };
    case "ready":
      return { title: "Update available, restart to update", detail: `ScopeFlow ${latest} is ready to install. You have ${current}.` };
    case "installing":
      return { title: "Restarting to update", detail: `ScopeFlow is closing to install ${latest}, and will open again.` };
    case "blocked":
    case "error":
    case "unsupported":
      return { title: status.title || "ScopeFlow could not update", detail: status.message || "" };
    default:
      return { title: `ScopeFlow ${current}`, detail: "ScopeFlow has not checked for updates yet." };
  }
}

/** The button on the right of each window's ribbon, shown only when there is an update to install. */
function ribbonButton(status) {
  if (status?.state === "ready") return { label: "Restart to Update", title: `ScopeFlow ${status.latest} is ready to install` };
  if (status?.state === "available") return { label: "Update Available", title: `ScopeFlow ${status.latest} is available` };
  return null;
}

/** The button beside the status in Settings → Updates. Never greyed out: while busy it names what is happening. */
function settingsButton(status) {
  switch (status?.state) {
    case "ready":
    case "available":
      return { label: "Restart to Update", action: "restart" };
    case "checking":
      return { label: "Checking…", action: "none" };
    case "downloading":
    case "verifying":
      return { label: "Downloading…", action: "none" };
    case "installing":
      return { label: "Restarting…", action: "none" };
    default:
      return { label: "Check Now", action: "check" };
  }
}

/** The "Update available, restart to update" question. */
function restartPrompt(status) {
  const downloaded = status.state === "ready";
  const lines = [
    downloaded
      ? `ScopeFlow ${status.latest} is ready to install. You have ${status.current}.`
      : `ScopeFlow ${status.latest} is available. You have ${status.current}.`,
    downloaded
      ? "ScopeFlow will close and open again on the new version. Save anything you are working on first."
      : "ScopeFlow will download it, close and open again on the new version. Save anything you are working on first.",
  ];
  if (status.notes) lines.push(`What's new: ${status.notes}`);
  return {
    message: "Update available, restart to update",
    detail: lines.join("\n\n"),
    buttons: ["Restart to Update", "Later"],
    defaultId: 0,
    cancelId: 1,
  };
}

module.exports = {
  DEFAULT_FEED_URL,
  HOUR,
  INTERVAL_CHOICES,
  MANIFEST_NAME,
  MAX_MANIFEST_BYTES,
  MAX_ZIP_BYTES,
  RELEASES_REPO,
  UPDATE_DEFAULTS,
  ZIP_NAME,
  bundleFromExecPath,
  checkDownload,
  checkStagedApp,
  cleanUpdateSettings,
  compareDotted,
  compareVersions,
  decideUpdate,
  describe,
  isAllowedUpdateUrl,
  locateApp,
  machArch,
  machoArchs,
  menuLabel,
  nextCheckDelay,
  originalBundlePath,
  parseVersion,
  resolveFeedUrl,
  restartPrompt,
  ribbonButton,
  settingsButton,
  sha256File,
  shouldCheck,
  validateManifest,
};
