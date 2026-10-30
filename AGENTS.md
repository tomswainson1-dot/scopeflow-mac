# ScopeFlow for Mac

This folder is the Apple desktop application for the ScopeFlow suite. Everything for it stays here.

The app is an Electron shell. The suite itself stays in its own projects (Estimating, CRM, Project Management, Roof Report, Agent Desk, Accounting). This app does not copy that code. It opens the live suite at `https://app.scopeflow.us` in its own window, the way Chrome installs a site as an app.

## What is here

| Path | What it is |
|---|---|
| `src/` | The Electron main process: window, menu, and which links stay in the app |
| `tests/` | Checks for those link rules |
| `assets/` | The dock icon, the same mark as the iPhone app |
| `dist/` | Built `ScopeFlow.app` (not source; git ignores it) |

## Rules

- Do not read or print `config/*.env`, `.secrets/`, or database backups from the other ScopeFlow folders.
- Do not put this app's files in those folders, and do not put their source in this one.
- A change to how a product works belongs in that product's repo. A change to the Mac window, menu, icon, or link rules belongs here.
- `npm test` must pass before handing the app over.
