# Build log

Append-only. Newest entry at the bottom.

## 2026-10-30 — First Mac app

Tom asked for an Apple desktop app for the whole ScopeFlow suite, built the way Chrome installs a website as an app and the way the ChatGPT desktop app is built: Electron, not a native rewrite.

The shell lives in this folder. It opens `https://app.scopeflow.us` (Estimating, CRM, Project Management, Roof Report and Agent Desk on that origin; Accounting on `accounting.scopeflow.us`). Links off the suite and its sign-in hosts open in the system browser. The Dock icon is the iPhone app's icon. No suite source was copied. No secrets were read.

Checked: `npm test` 26 passed. A smoke launch loaded `https://app.scopeflow.us/login` and quit. `dist/mac-arm64/ScopeFlow.app` is ad-hoc signed (`us.scopeflow.desktop`, version 0.1.0) and was opened on this Mac. Not an App Store build.

## 2026-10-30 — Dock icon, blue window ribbon, download page

Tom asked for the Dock icon to be rounded like the other apps, for the window border to be one clean blue ribbon, and for a page on www.scopeflow.us where other people can download the app.

The Dock icon is now a rounded squircle with the mark inset, drawn by `scripts/make-icon.swift`. The window title bar and the hairline around the page are both `#1A73E8`. Traffic lights sit on that ribbon. A smoke launch loaded `https://app.scopeflow.us/`. The zip for other Macs is `dist/ScopeFlow-mac.zip` (114 MB, Apple silicon). There is no Developer ID certificate on this Mac, so the page tells people how to open it the first time.
