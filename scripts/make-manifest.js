#!/usr/bin/env node
/**
 * Writes dist/ScopeFlow-mac.json, the update file the app reads from each GitHub release (4 Nov 2026), after checking
 * the build is fit to publish: the app's version matches package.json, its signature is valid, it holds both chips,
 * and the zip unpacks to that same app. Upload it with the zip on the same release; see README → Releasing.
 *
 *   node scripts/make-manifest.js [--notes "One line on what changed"] [--base-url <url>]
 *       [--app dist/mac-universal/ScopeFlow.app] [--zip dist/ScopeFlow-mac.zip] [--out dist/ScopeFlow-mac.json]
 *       [--version <x.y.z>]
 *
 * --base-url defaults to this repository's GitHub release downloads, and --version to package.json's; a test release
 * on this Mac passes its own server and version.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { RELEASES_REPO, ZIP_NAME, compareVersions, machoArchs, sha256File } = require("../src/update-rules");

const root = path.join(__dirname, "..");

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
}

function plist(app, key) {
  try {
    return execFileSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", path.join(app, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(`make-manifest: ${message}`);
  process.exit(1);
}

function checkApp(app, version, label) {
  if (!fs.existsSync(app)) fail(`${label} not found: ${app}`);
  const appVersion = plist(app, "CFBundleShortVersionString");
  if (!appVersion || compareVersions(appVersion, version) !== 0) fail(`${label} is version ${appVersion}, package.json says ${version}.`);
  try {
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" });
  } catch (err) {
    fail(`${label} failed codesign --verify: ${String(err.stderr || err.message).trim()}`);
  }
  const executable = plist(app, "CFBundleExecutable");
  const head = Buffer.alloc(4096);
  const fd = fs.openSync(path.join(app, "Contents", "MacOS", executable), "r");
  const archs = machoArchs(head.subarray(0, fs.readSync(fd, head, 0, head.length, 0)));
  fs.closeSync(fd);
  for (const chip of ["x86_64", "arm64"]) if (!archs.includes(chip)) fail(`${label} has no ${chip} half (it has ${archs.join(", ")}).`);
  return { bundleId: plist(app, "CFBundleIdentifier"), minimumSystemVersion: plist(app, "LSMinimumSystemVersion"), archs };
}

async function main() {
  const version = option("version", JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version);
  const app = path.resolve(root, option("app", "dist/mac-universal/ScopeFlow.app"));
  const zip = path.resolve(root, option("zip", `dist/${ZIP_NAME}`));
  const out = path.resolve(root, option("out", "dist/ScopeFlow-mac.json"));
  const baseUrl = option("base-url", `https://github.com/${RELEASES_REPO}/releases/download/v${version}`).replace(/\/$/, "");
  const notes = option("notes", "");

  const built = checkApp(app, version, "The built app");
  if (!fs.existsSync(zip)) fail(`zip not found: ${zip}`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "scopeflow-manifest-"));
  try {
    execFileSync("/usr/bin/ditto", ["-x", "-k", zip, scratch]);
    const apps = fs.readdirSync(scratch).filter((name) => name.endsWith(".app"));
    if (apps.length !== 1) fail(`the zip should hold one app; it holds ${apps.length}.`);
    const unpacked = checkApp(path.join(scratch, apps[0]), version, "The app in the zip");
    if (unpacked.bundleId !== built.bundleId) fail(`the zip's app is ${unpacked.bundleId}, the build is ${built.bundleId}.`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  const { size, sha256 } = await sha256File(zip);
  const manifest = {
    name: "ScopeFlow",
    version,
    url: `${baseUrl}/${path.basename(zip)}`,
    size,
    sha256,
    bundleId: built.bundleId,
    minimumSystemVersion: built.minimumSystemVersion,
    notes: notes || undefined,
    released: new Date().toISOString(),
  };
  fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${path.relative(root, out)}: ScopeFlow ${version}, ${size} bytes, sha256 ${sha256}, ${built.archs.join(" + ")}`);
}

main().catch((err) => fail(err.stack || err.message));
