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
