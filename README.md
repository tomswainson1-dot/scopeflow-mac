# ScopeFlow for Mac

The ScopeFlow suite in its own Mac application. Electron (the same Chromium engine as Google Chrome) opens [app.scopeflow.us](https://app.scopeflow.us) in a window with a Dock icon and a menu bar. There is no address bar. The website is the app.

The window has one blue ribbon across the top, and the same blue as a hairline around the page. The Dock icon is a rounded squircle. Other people download it from [www.scopeflow.us/mac.html](https://www.scopeflow.us/mac.html).

After you sign in, the suite's own application tiles open Estimating, the CRM, Project Management and Roof Report. The **Go** menu also opens Agent Desk and Accounting.

Sign-in is the same ScopeFlow account. The password form stays in this window. The session is kept for this app only, separate from Safari and Chrome. A magic link or a password-reset email still opens in your browser, because those links arrive in Mail.

## Run it

```bash
npm install
npm test
npm start
```

A double-clickable app, with both Apple silicon and Intel in the one file:

```bash
npm run pack
open "dist/mac-universal/ScopeFlow.app"
```

The build is ad-hoc signed for this Mac. It is not an App Store build. macOS runs the half that matches the chip.

## Point it at a local suite

```bash
SCOPEFLOW_URL=http://localhost:3000 npm start
```

Accounting then opens on `http://localhost:3700/accounting`. Set `SCOPEFLOW_ACCOUNTING_URL` to override that.

## Menus

- **ScopeFlow → Check for Updates…** and **ScopeFlow → Settings…** (Command-comma)
- **Go → Applications** and the product list, with Command-1 through Command-6
- **Go → Back / Forward**
- **View → Reload**, zoom, full screen
- **Edit** has the usual copy and paste, which a web page needs from the menu, and **Edit → Spelling**: Check Spelling While Typing, Correct Spelling Automatically, and Use Company Settings

## Right-click and spelling (0.1.3)

Right-click works everywhere in the suite. On a word underlined in red it offers the Mac's suggestions and **Add to Dictionary**; a company admin also gets **Add for Everyone at <company>**. Cut, Copy, Paste, Look Up, links and images are there too. Where a ScopeFlow page has its own right-click menu (the bill grid's rows), that menu opens instead.

Auto-correct works the Mac way: finish a misspelled word with a space or punctuation and it becomes the Mac's first suggestion, if that is a near miss. Command-Z puts your word back and leaves it alone after that. It never touches company words, email and web address boxes, or boxes marked `autocorrect="off"`; by default it also leaves names, codes, units and short words alone.

The company's rules and word list are set in ScopeFlow under **Settings → Spelling** (admins), and the app reads them from `/api/spelling` as you sign in and as pages load. Company words go into this app's own dictionary on each Mac, not the Mac's shared one. Each person can override the company in **Edit → Spelling**.

## Updates (0.1.4)

From 0.1.4 ScopeFlow updates itself. There is no deleting and reinstalling, and no Terminal command. 0.1.4 is the last version anyone installs by hand.

- **When it checks.** It checks when ScopeFlow opens, and again every 4 hours while it stays open. **ScopeFlow → Settings…** changes that: turn automatic checks off, stop the check at opening, or check every hour, 4 hours, day or week, or not while open. The same window can stop ScopeFlow downloading an update before asking. **ScopeFlow → Check for Updates…** checks at any time, and when ScopeFlow is up to date it says so.
- **What you see.** A new version downloads in the background. Then **Restart to Update** appears on the right of the blue bar and in the ScopeFlow menu. Pressing either asks *Update available, restart to update*. **Restart to Update** closes ScopeFlow, puts the new version where the old one was, and opens it again. **Later** leaves it waiting. An automatic check never opens a dialog while you work. The one exception: if an update was already downloaded when ScopeFlow opens, it asks straight away.
- **Where it comes from.** The newest release on GitHub. The app reads `ScopeFlow-mac.json` from that release and downloads `ScopeFlow-mac.zip` from the same release. It only installs the zip if its size and SHA-256 match that file, it unpacks to this app (same bundle id, the promised version, a valid signature, this Mac's chip and macOS), and it was downloaded over https from GitHub. Anything else is thrown away and nothing changes.
- **Why not Electron's own updater.** On a Mac, Electron's updater (Squirrel.Mac, which electron-updater also uses) only accepts an update signed with the same Apple Developer ID. This app is signed ad hoc, and Squirrel refused a newer build in a test on 4 Nov 2026. With a Developer ID later, this updater keeps working, and the first-open warning for new installs goes away.
- **Where it can't update.** If your Mac account cannot change the folder ScopeFlow is in, the app says so and leaves it alone. That happens with a non-administrator account and the app in /Applications. A copy run straight from Downloads (macOS runs it from a temporary copy) is updated where it is.
- **What it writes.** In the app's data folder (`~/Library/Application Support/ScopeFlow`): `settings.json`, `update-state.json`, `updates.log` (checks, downloads and the install step), and `Updates/` while an update waits.

Try it with a test copy: `open -n "<copy>.app" --args --user-data-dir=<folder> --scopeflow-update-feed=http://127.0.0.1:<port>/ScopeFlow-mac.json`. The copy then uses its own data folder and reads updates from a server on this Mac. Both switches are passed on when it reopens after updating. The update address accepts only GitHub or this Mac.

## Releasing

Each release is a GitHub Release on `tomswainson1-dot/scopeflow-mac`. It has two files: `ScopeFlow-mac.zip` and `ScopeFlow-mac.json`. The app reads the second, so a release without it is never offered in-app.

```bash
npm version 0.1.5 --no-git-tag-version
npm run release -- --notes "One line on what changed"
gh release create v0.1.5 dist/ScopeFlow-mac.zip dist/ScopeFlow-mac.json --title "ScopeFlow 0.1.5" --notes-file <notes> --draft
gh release edit v0.1.5 --draft=false --latest
```

`npm run release` runs the tests and then builds, signs and zips the app. Its last step is `scripts/make-manifest.js`. That checks the build is fit to publish (version, signature, both chips, and the zip unpacks to the same app) and writes the manifest with the zip's size and SHA-256. Publish the release as a draft first, and make it Latest only when both files are uploaded. Then update the download link on www.scopeflow.us/mac.html in the Estimating repo.
