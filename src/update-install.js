/**
 * The last step of an in-app update (4 Nov 2026): a short shell script ScopeFlow starts just before it quits. It waits
 * for ScopeFlow to quit, puts the new app where the old one was, and opens it again. It runs outside the app because an
 * app cannot safely replace its own files while it is running, and it is a shell script because /bin/sh, mv and open are
 * on every Mac (Electron's own "move to Applications" uses the same wait-then-open step).
 *
 * The swap is two renames in the app's own folder, so the app is missing for only an instant. If either rename fails
 * the old app is put back and opened again, and the reason is written to the result file; ScopeFlow tells the person
 * on its next start. The new copy carries no quarantine (measured: the download gets none); removing it anyway keeps a
 * first-open warning from appearing if macOS ever adds one.
 *
 * The script is passed to /bin/sh -c as text, because a file inside the app's app.asar cannot be read by /bin/sh.
 */

const path = require("path");

const INSTALL_SCRIPT = String.raw`
pid=$1; target=$2; staged=$3; log=$4; result=$5; relaunch=$6
shift 6
say() { printf '%s helper: %s\n' "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$log"; }
failed() { say "FAILED: $1"; printf 'failed\t%s\n' "$1" > "$result"; }
reopen() {
  [ "$relaunch" = yes ] || return 0
  if [ $# -gt 0 ]; then out=$(/usr/bin/open -n "$target" --args "$@" 2>&1); else out=$(/usr/bin/open -n "$target" 2>&1); fi
  if [ $? -eq 0 ]; then say "opened $target"; else say "could not open $target: $out"; fi
}
case "$target" in /*.app) ;; *) failed "Not an app to replace: $target"; exit 1 ;; esac
case "$staged" in /*.app) ;; *) failed "Not a new app: $staged"; exit 1 ;; esac
waited=0
while /bin/kill -0 "$pid" 2>/dev/null; do
  /bin/sleep 0.2
  waited=$((waited + 1))
  if [ "$waited" -ge 3000 ]; then failed "ScopeFlow did not quit within 10 minutes, so the update was not installed."; exit 1; fi
done
say "ScopeFlow has quit; installing over $target"
dir=$(/usr/bin/dirname "$target")
name=$(/usr/bin/basename "$target")
new="$dir/.$name.new-$$"
old="$dir/.$name.old-$$"
if ! out=$(/bin/mv "$staged" "$new" 2>&1); then
  /bin/rm -rf "$new"
  failed "The new version could not be put in $dir. $out"
  reopen "$@"; exit 1
fi
if ! out=$(/bin/mv "$target" "$old" 2>&1); then
  /bin/rm -rf "$new"
  failed "The old version could not be moved aside. $out"
  reopen "$@"; exit 1
fi
if ! out=$(/bin/mv "$new" "$target" 2>&1); then
  /bin/mv "$old" "$target"
  /bin/rm -rf "$new"
  failed "The new version could not be put in place. $out"
  reopen "$@"; exit 1
fi
/usr/bin/xattr -dr com.apple.quarantine "$target" 2>/dev/null
printf 'ok\t%s\n' "$target" > "$result"
say "installed at $target"
/bin/rm -rf "$old" 2>/dev/null || say "could not remove the old version at $old"
reopen "$@"
exit 0
`;

/** Only the switches the app was opened with (a test copy's --user-data-dir and update feed) go to the new copy. */
function relaunchArgs(argv) {
  return (Array.isArray(argv) ? argv : []).filter((arg) => typeof arg === "string" && arg.startsWith("--"));
}

/**
 * The command that installs an update.
 * @param {{pid: number, target: string, staged: string, logFile: string, resultFile: string, relaunch?: boolean, args?: string[]}} p
 * @returns {{file: string, args: string[]}} for child_process.spawn, detached
 */
function installCommand({ pid, target, staged, logFile, resultFile, relaunch = true, args = [] }) {
  for (const [label, value] of [["app", target], ["new app", staged]]) {
    if (typeof value !== "string" || !path.isAbsolute(value) || !value.endsWith(".app")) {
      throw new Error(`The ${label} to install is not an app: ${value}`);
    }
  }
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Not a process id: ${pid}`);
  return {
    file: "/bin/sh",
    args: [
      "-c",
      INSTALL_SCRIPT,
      "scopeflow-update",
      String(pid),
      target,
      staged,
      logFile,
      resultFile,
      relaunch ? "yes" : "no",
      ...relaunchArgs(args),
    ],
  };
}

/** The result file the script leaves: "ok\t<where>" or "failed\t<why>". */
function readInstallResult(text) {
  const [word, ...rest] = String(text || "").trim().split("\t");
  if (word === "ok") return { ok: true, where: rest.join("\t") };
  if (word === "failed") return { ok: false, reason: rest.join("\t") || "The update could not be installed." };
  return null;
}

module.exports = { INSTALL_SCRIPT, installCommand, readInstallResult, relaunchArgs };
