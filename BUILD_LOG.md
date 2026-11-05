# Build log

Append-only. Newest entry at the bottom.

## 2026-10-30 — First Mac app

Tom asked for an Apple desktop app for the whole ScopeFlow suite, built the way Chrome installs a website as an app and the way the ChatGPT desktop app is built: Electron, not a native rewrite.

The shell lives in this folder. It opens `https://app.scopeflow.us` (Estimating, CRM, Project Management, Roof Report and Agent Desk on that origin; Accounting on `accounting.scopeflow.us`). Links off the suite and its sign-in hosts open in the system browser. The Dock icon is the iPhone app's icon. No suite source was copied. No secrets were read.

Checked: `npm test` 26 passed. A smoke launch loaded `https://app.scopeflow.us/login` and quit. `dist/mac-arm64/ScopeFlow.app` is ad-hoc signed (`us.scopeflow.desktop`, version 0.1.0) and was opened on this Mac. Not an App Store build.

## 2026-10-30 — Dock icon, blue window ribbon, download page

Tom asked for the Dock icon to be rounded like the other apps, for the window border to be one clean blue ribbon, and for a page on www.scopeflow.us where other people can download the app.

The Dock icon is now a rounded squircle with the mark inset, drawn by `scripts/make-icon.swift`. The window title bar and the hairline around the page are both `#1A73E8`. Traffic lights sit on that ribbon. A smoke launch loaded `https://app.scopeflow.us/`. The zip for other Macs is `dist/ScopeFlow-mac.zip` (114 MB, Apple silicon). There is no Developer ID certificate on this Mac, so the page tells people how to open it the first time.

## 2026-10-30 — Universal build, 0.1.1

Tom asked for one download that runs on Intel and Apple silicon. `npm run pack` now builds `dist/mac-universal/ScopeFlow.app`. `lipo` reports `x86_64 arm64`. A smoke launch of the Apple silicon half loaded `https://app.scopeflow.us/`. The Intel half, run with Rosetta on this Mac, loaded `https://app.scopeflow.us/login`. The zip is 213 MB, release v0.1.1. The ribbon color in this build is the ScopeFlow navy `#0C2E5A`.

## 2026-10-30 — Push to Estimator stays in this window

Tom said the button after Push to Estimator does not take him to the project. The CRM page asks for a new window, and that second window was not appearing. A suite link that asks for a new window now loads in the window he already has. Sign-in popups and links outside ScopeFlow are unchanged. `npm test` 26 passed. The arm64 app at `dist/mac-arm64/ScopeFlow.app` was updated, ad-hoc signed, and opened. The public 0.1.1 zip was not rebuilt.

## 2026-10-30 — Back and Forward on the ribbon

Tom said there is no way back once a PDF, or any other page, replaces the one he was on. The ribbon now has Back and Forward, to the right of the window buttons. They follow the page history, so Back from a PDF returns to the previous ScopeFlow page. A trackpad swipe and the side mouse buttons do the same. Go → Back is still Command-[. `npm test` 26 passed, and a ribbon check confirmed Back enables and sends the navigation. The arm64 app was updated and reopened. The public 0.1.1 zip was not rebuilt.

## 2026-10-30 — Public download 0.1.2

Tom asked for the public Mac download to include Back and Forward. Version 0.1.2 is one universal app, `x86_64 arm64`. Both halves smoke-launched to `https://app.scopeflow.us/login`. The app is ad-hoc signed (`us.scopeflow.desktop`). The zip is 213 MB: https://github.com/tomswainson1-dot/scopeflow-mac/releases/download/v0.1.2/ScopeFlow-mac.zip. Release v0.1.2 is not a draft and the file is `ScopeFlow-mac.zip`. There is still no Developer ID certificate on this Mac.

## 2026-11-04 — 0.1.3: right-click spelling, auto-correct, company words

Tom: "There is no spelling autocorrect feature in the estimate or crm system. It underlines with red where there is a spelling issue but right click gives no suggestions or the option to add to dictionary." The cause was this app: `spellcheck: true` drew the underline, but Electron has no right-click menu of its own and the app never built one, so right-click did nothing anywhere. Chrome and Safari were fine. His choices after the review (plan: https://claude.ai/artifact/WSVfVph4g83gSYF3mBe1Ra): full Mac-style auto-correct, one shared company word list, all parts together.

**What changed.**
- `src/context-menu.js`: the right-click menu, built from what was clicked. Suggestions and Add to Dictionary on a misspelled word; Add for Everyone at <company> for a company admin on a suite page; Cut, Copy, Paste, Paste and Match Style, Select All; Look Up; Open Link and Copy Link Address; Copy Image; Back, Forward and Reload on empty space. A page that cancels the right-click (the bill grid's own menu) still gets its own menu.
- `src/page-preload.js`: auto-correct in suite pages (sandboxed preload, listens only). When a word is finished with a space or punctuation and the Mac's checker marks it misspelled, it becomes the Mac's first suggestion if that is a near miss (1 change for words up to 4 letters, 2 for longer; one word only). Command-Z puts the word back, leaves the caret after it, and that word is not corrected again on that page. Never touches company words, email/URL/password/number boxes, boxes with spellcheck off or `autocorrect="off"`, or part of an address or code; by company switches (default on) it also leaves names (a capital mid-sentence) and codes/units/short words (digits, all caps, under 3 letters) alone.
- `src/spelling.js`: reads the company's rules from ScopeFlow `GET /api/spelling` with the person's own session (on launch, on each suite page load and on window focus), keeps the company words in the app's dictionary (and takes out ones the company removes, unless the person added them too), and holds each person's Edit → Spelling choices in `spelling.json` in the app's data folder. Signed out or offline keeps the last rules read; before any are read, ScopeFlow's defaults apply (spell check and auto-correct on).
- Edit → Spelling: Check Spelling While Typing, Correct Spelling Automatically, Use Company Settings, and Company Spelling Settings… for admins.
- `npm run sign` is the ad-hoc signing step (`us.scopeflow.desktop`) earlier builds did by hand.

**Measured, and corrected in the plan.** Electron keeps added words in the app's own `Custom Dictionary.txt`, not the Mac's learned-words list, so Mail and Pages do not learn them. The plan said they would; it now says otherwise.

**Checks.** `npm test` 46 passed (26 link rules + 20 new: menu, auto-correct rules, spelling manager). Electron runs of the preload on this Mac: a textarea, an input and an editable area corrected flashng, recieve, tomorow, membraen, replacment; left the company word purlin, the name Swainsn, an email box and an `autocorrect="off"` box alone; Command-Z restored the word with the caret after it and typing on kept it. The right-click reaches the app on a text box and a page's own menu suppresses it. E2E against the Estimating branch `claude/spelling` on :3005 (signed in as the DEV ACME admin, a separate test copy of the app with its own data folder): Settings → Spelling saved; the app picked up the company word flashng and left it alone while correcting recieve and tomorow in the real company address field; emptying the list took the word back out. NOT verified by me: the suggestions inside the right-click menu on a red-underlined word (the Mac only marks misspellings in the window in use, and the test did not take over Tom's screen); Tom checks that on his Mac.

Built `dist/mac-universal/ScopeFlow.app` 0.1.3, `x86_64 arm64`, signed ad hoc as `us.scopeflow.desktop`; both halves smoke-launched to https://app.scopeflow.us/login. `dist/ScopeFlow-mac.zip` 224 MB. Not yet released.

**Released (Tom: "Yes, release"), 4 Nov 2026 ~3:51 pm CST.** GitHub release v0.1.3 "ScopeFlow 0.1.3", Latest, not a draft: `ScopeFlow-mac.zip` 223,742,575 bytes (sha256 51fbd0a3ab8a0a44…), the universal app above. The download link answers. www.scopeflow.us/mac.html links v0.1.3 ("Version 0.1.3 · Intel and Apple silicon · 224 MB") since Estimating `f7a15025` (live ~4:10 pm CST), which also put Settings → Spelling and `/api/spelling` on production. The app has no self-update: people on 0.1.2 download it again.

## 2026-11-04 — 0.1.4: ScopeFlow updates itself

Tom: "allow users to update from inside the software so I don't have to delete and re-install or run a command."

**Why not Electron's own updater.** On a Mac it is Squirrel.Mac, and electron-updater 6.8.11 hands its download to the same Squirrel (checked in its MacUpdater source). Squirrel only takes an update that meets the running app's designated requirement. For an ad-hoc build that requirement is the app's own cdhash (0.1.3's is `cdhash H"b46b…" or cdhash H"5d7a…"`), so no newer build can meet it. Measured, not assumed: a real Squirrel run on this Mac refused a newer ad-hoc build with "Code signature … did not pass validation: code failed to satisfy specified code requirement(s)". Tom chose the app's own updater over an Apple Developer ID (about $99 a year) for now. The updater keeps working if a Developer ID is added later; that would also remove the first-open warning for new installs.

**Measured before building it** (macOS 26.6.2; a probe app made from Electron itself, signed ad hoc, opened by LaunchServices):
- A download made with Electron's net module gets no quarantine, only `com.apple.provenance`.
- ditto unpacks it with a valid signature.
- A script started by the app waited for the app to quit, swapped the bundle and opened the new one. There was no Gatekeeper warning and no App Management block in /Applications, in an ordinary folder, or for a copy running translocated from a quarantined download. Tom runs 0.1.3 that way, from ~/Downloads through AppTranslocation. The mount table names the original of a translocated app.

**What changed.**
- **ScopeFlow → Check for Updates…** is always pressable. Its words say what pressing it does: Check for Updates…, Checking for Updates…, Downloading Update…, or Restart to Update to x.y.z…. When ScopeFlow is up to date it says "You're up to date".
- **ScopeFlow → Settings…** (Command-comma) shows the update status with a Check Now or Restart to Update button, and **Settings → Updates**. The defaults:
  - check automatically: on;
  - check when ScopeFlow opens: on;
  - while open, check again every 4 hours (or every hour, day or week, or never);
  - download in the background, then ask: on.
  Not settings: safety limits. A download that stalls for 60 s is ended, the install script waits at most 10 minutes for ScopeFlow to quit, and a zip over 2 GB is refused.
- A **Restart to Update** button on the right of the blue bar while an update waits.
- **No dialog mid-work (my decision).** An automatic check never opens a dialog while someone works, because a Return typed into a page would press Restart to Update. It shows the button and the menu item. Pressing either asks "Update available, restart to update" (Restart to Update / Later). The one automatic question is when ScopeFlow opens with an update already downloaded.
- **Code.**
  - `src/update-rules.js`: plain logic (versions, settings, when to check, the release file and the SHA-256, checks on the new app, translocation, words).
  - `src/updater.js`: the steps.
  - `src/update-mac.js`: net.request, with redirects followed only to GitHub or a test server on this Mac; ditto, plutil, codesign, mount.
  - `src/update-install.js`: the install script. It makes two renames in the app's own folder. If either fails it puts the old app back, opens it and writes why; the next start shows that. It reopens with the same switches.
  - The Settings window: `src/settings*.js` and `src/settings.html`.
- **Releases.**
  - Each GitHub release now also carries `ScopeFlow-mac.json` (version, zip URL, size, SHA-256, bundle id, minimum macOS).
  - The app reads it from `releases/latest/download/`, so it never calls the GitHub API.
  - `scripts/make-manifest.js` writes that file after checking the build: version, signature, both chips, and that the zip unpacks to the same app.
  - `npm run release` runs the tests, then builds, signs, zips and writes the file. README → Releasing has the steps.

**Checks.**
- `npm test`: 83 passed (46 before, 37 new: versions, the release file and checksum, when to check and what to do, the new app's checks, translocation, menu and words, settings, the updater's steps, and the install script run for real on temporary folders).
- Built `dist/mac-universal/ScopeFlow.app` 0.1.4: x86_64 + arm64, ad hoc `us.scopeflow.desktop`, signature valid, minimum macOS 13.0. Both halves smoke-launched to https://app.scopeflow.us/login.

End to end on this Mac, Tom's own copy untouched. The test copies were the 0.1.4 build and a 0.1.5 test build served from this Mac, with bundle id `us.scopeflow.desktop.updatetest` and their own data folders.
1. **In /Applications.**
   - The launch check found 0.1.5, then downloaded and checked 224 MB in 1.5 s.
   - ScopeFlow → Restart to Update to 0.1.5… asked "Update available, restart to update". Restart to Update quit the app, swapped it, and about 6 s later it reopened on 0.1.5 with the same data folder. Its launch check said up to date.
   - The new app had no quarantine, a valid signature, and nothing was left behind.
   - Check for Updates… then said "You're up to date. ScopeFlow 0.1.5 is the newest version."
   - In Settings, Check Now ran a check. Turning automatic checks off was saved to settings.json and hid the two timing choices.
2. **A quarantined copy in a Downloads folder, running translocated like Tom's.**
   - It updated the same way. The new version went to the original Downloads path, not the temporary copy, and 0.1.5 then ran from that folder directly.
   - Someone at the Mac made the Later and Restart to Update presses in this run. My clicks were blocked by the screen lock by then.
3. **Against the real GitHub address.** It followed github.com's redirects. v0.1.3 has no ScopeFlow-mac.json, so it logged "The newest ScopeFlow release on GitHub has no update file" and stayed quiet.

Found while testing: changing a copy's CFBundleName stops Electron finding its helper apps ("Unable to find helper app"). The updater never changes Info.plist, so only my first test copies were affected.

Not verified:
- I didn't see the blue-bar button myself: the test window opened on a desktop Space I could not capture. It was used in run 2.
- A copy downloaded by a browser and moved into /Applications with Finder.
- A Mac account that is not an administrator: only the message is unit-tested.

Not yet released.

**Released (Tom: "Yes, release"), 4 Nov 2026 ~7:17 pm CST.**
- GitHub release v0.1.4 "ScopeFlow 0.1.4", Latest, not a draft. Tag `v0.1.4` → `6367cd0`. It was published as a draft first and made Latest once both files were up:
  - `ScopeFlow-mac.zip`: 223,763,984 bytes, sha256 `0b142379c91b24b2d7d250cd34b2215dd8e6f734306af6fa5d9a1ca4531f4948`.
  - `ScopeFlow-mac.json`: 483 bytes.
- GitHub's own digests match both local files.
- `releases/latest/download/ScopeFlow-mac.json` now returns the 0.1.4 file. The zip link answers 200 from release-assets.githubusercontent.com.
- The 0.1.4 build, reading the live feed: "check (launch): newest 0.1.4, this copy 0.1.4: up-to-date".
- www.scopeflow.us/mac.html links v0.1.4 since Estimating `d50eebd2`: "Version 0.1.4 · Intel and Apple silicon · 224 MB · Updates itself", plus a fifth step, "Let it update itself". Pushed 7:21 pm CST with the preview checked first. Health reports `d50eebd` on app.scopeflow.us, estimating.totalcladdingandroofing.com and tcr-estimating.vercel.app. `smoke-domain.mjs` PASS on both domains; push record `d9cb5403`, smoked again (PASS); Estimating's local `main` fast-forwarded.

0.1.4 is the last version anyone installs by hand. People on 0.1.0–0.1.3 (Tom's copy is 0.1.3, in Downloads) download 0.1.4 once. After that, new versions arrive in the app: publish a release with both files (README → Releasing) and Restart to Update appears.
