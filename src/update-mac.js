/**
 * The network and macOS side of in-app updates (4 Nov 2026), passed into src/updater.js by src/main.js.
 *
 * Downloads use Electron's net module in the main process (Chromium's network stack, so a company proxy works). Measured
 * 4 Nov 2026: a file saved this way carries no quarantine, so the new app opens without a first-open warning. Redirects
 * are followed only to GitHub (github.com → release-assets.githubusercontent.com) or the test server a test copy was
 * opened with. ditto, plutil, codesign, mount and open are part of macOS; lipo is not used (on most Macs it asks to
 * install Xcode's tools), the chips are read from the executable's header instead.
 */

const { net } = require("electron");
const { execFile, execFileSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { MAX_MANIFEST_BYTES, MAX_ZIP_BYTES, isAllowedUpdateUrl, locateApp, machoArchs } = require("./update-rules");
const { installCommand } = require("./update-install");

/** A download that receives nothing for this long is ended. Not a setting: it only stops waiting on a dead connection. */
const STALL_MS = 60 * 1000;

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || "").trim();
        reject(err);
      } else {
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    });
  });
}

const hostOf = (raw) => {
  try {
    return new URL(raw).host;
  } catch {
    return "an unknown address";
  }
};

/**
 * @param {{feedUrl: string, userAgent: string}} context
 * @returns {Promise<{request: Electron.ClientRequest, response: Electron.IncomingMessage}>}
 */
function open(url, accept, { feedUrl, userAgent }) {
  return new Promise((resolve, reject) => {
    if (!isAllowedUpdateUrl(url, feedUrl)) {
      reject(new Error(`ScopeFlow only downloads updates from GitHub, not ${hostOf(url)}.`));
      return;
    }
    const request = net.request({ url, redirect: "manual", useSessionCookies: false, cache: "no-store" });
    request.setHeader("User-Agent", userAgent);
    request.setHeader("Accept", accept);
    request.on("redirect", (_status, _method, next) => {
      if (isAllowedUpdateUrl(next, feedUrl)) {
        request.followRedirect();
        return;
      }
      request.abort();
      reject(new Error(`ScopeFlow did not follow a redirect to ${hostOf(next)}.`));
    });
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        const err = new Error(`GitHub answered ${response.statusCode}`);
        err.status = response.statusCode;
        response.on("data", () => {});
        response.on("error", () => {});
        reject(err);
        return;
      }
      resolve({ request, response });
    });
    request.on("error", reject);
    request.end();
  });
}

function createUpdateMac({ feedUrl, userAgent, logFile, relaunchArgs = [] }) {
  const context = { feedUrl, userAgent };

  async function fetchJson(url) {
    const { response } = await open(url, "application/json", context);
    const chunks = [];
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > MAX_MANIFEST_BYTES) throw new Error("The update file is far larger than expected.");
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("The update file on GitHub could not be read.");
    }
  }

  async function download(url, file, { expectedSize, onProgress }) {
    const { request, response } = await open(url, "application/octet-stream", context);
    const part = `${file}.part`;
    const limit = Math.min(expectedSize, MAX_ZIP_BYTES);
    let received = 0;
    let stall = null;
    const counter = new Transform({
      transform(chunk, _encoding, done) {
        received += chunk.length;
        if (received > limit) {
          done(new Error("The download is larger than the release says."));
          return;
        }
        arm();
        onProgress(received);
        done(null, chunk);
      },
    });
    function arm() {
      clearTimeout(stall);
      stall = setTimeout(() => counter.destroy(new Error("The download stopped. Check the internet connection and try again.")), STALL_MS);
    }
    arm();
    try {
      await pipeline(response, counter, fs.createWriteStream(part));
      fs.renameSync(part, file);
    } catch (err) {
      try {
        request.abort();
      } catch {
        // Already finished.
      }
      fs.rmSync(part, { force: true });
      throw err;
    } finally {
      clearTimeout(stall);
    }
  }

  /** ditto, the way Finder unpacks; --noqtn so no quarantine is carried over even if the zip ever had one. */
  async function unpack(zip, dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    try {
      await run("/usr/bin/ditto", ["-x", "-k", "--noqtn", zip, dir]);
    } catch (err) {
      throw new Error(`The download could not be unpacked (${err.stderr || err.message}).`);
    }
    const apps = fs.readdirSync(dir).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1) throw new Error("The download does not hold exactly one app.");
    return path.join(dir, apps[0]);
  }

  async function plistValue(plist, key) {
    try {
      const { stdout } = await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plist]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async function inspectApp(appPath) {
    const plist = path.join(appPath, "Contents", "Info.plist");
    const [bundleId, version, minimumSystemVersion, executable] = await Promise.all([
      plistValue(plist, "CFBundleIdentifier"),
      plistValue(plist, "CFBundleShortVersionString"),
      plistValue(plist, "LSMinimumSystemVersion"),
      plistValue(plist, "CFBundleExecutable"),
    ]);
    let archs = [];
    if (executable) {
      const head = Buffer.alloc(4096);
      let fd = null;
      try {
        fd = fs.openSync(path.join(appPath, "Contents", "MacOS", executable), "r");
        archs = machoArchs(head.subarray(0, fs.readSync(fd, head, 0, head.length, 0)));
      } catch {
        archs = [];
      } finally {
        if (fd !== null) fs.closeSync(fd);
      }
    }
    let signatureOk = true;
    let signatureError;
    try {
      await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
    } catch (err) {
      signatureOk = false;
      signatureError = String(err.stderr || err.message).split("\n").filter(Boolean).pop();
    }
    return { bundleId, version, minimumSystemVersion, archs, signatureOk, signatureError };
  }

  function locate() {
    return locateApp({
      execPath: process.execPath,
      mountTable: () => {
        try {
          return execFileSync("/sbin/mount", { encoding: "utf8" });
        } catch {
          return "";
        }
      },
      canWrite: (dir) => {
        try {
          fs.accessSync(dir, fs.constants.W_OK);
          return true;
        } catch {
          return false;
        }
      },
    });
  }

  /** Starts src/update-install.js's script on its own, so it outlives ScopeFlow. */
  function startInstall({ target, staged, resultFile }) {
    const command = installCommand({ pid: process.pid, target, staged, logFile, resultFile, relaunch: true, args: relaunchArgs });
    const child = spawn(command.file, command.args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  }

  return { download, fetchJson, inspectApp, locate, startInstall, unpack };
}

/** This app's own bundle id, read from its Info.plist (a test copy has its own), or null when run from source. */
function ownBundleId(bundlePath) {
  if (!bundlePath) return null;
  try {
    return execFileSync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", path.join(bundlePath, "Contents", "Info.plist")], {
      encoding: "utf8",
    }).trim() || null;
  } catch {
    return null;
  }
}

module.exports = { createUpdateMac, ownBundleId };
