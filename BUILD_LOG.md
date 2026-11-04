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
