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

- **Go → Applications** and the product list, with Command-1 through Command-6
- **Go → Back / Forward**
- **View → Reload**, zoom, full screen
- **Edit** has the usual copy and paste, which a web page needs from the menu, and **Edit → Spelling**: Check Spelling While Typing, Correct Spelling Automatically, and Use Company Settings

## Right-click and spelling (0.1.3)

Right-click works everywhere in the suite. On a word underlined in red it offers the Mac's suggestions and **Add to Dictionary**; a company admin also gets **Add for Everyone at <company>**. Cut, Copy, Paste, Look Up, links and images are there too. Where a ScopeFlow page has its own right-click menu (the bill grid's rows), that menu opens instead.

Auto-correct works the Mac way: finish a misspelled word with a space or punctuation and it becomes the Mac's first suggestion, if that is a near miss. Command-Z puts your word back and leaves it alone after that. It never touches company words, email and web address boxes, or boxes marked `autocorrect="off"`; by default it also leaves names, codes, units and short words alone.

The company's rules and word list are set in ScopeFlow under **Settings → Spelling** (admins), and the app reads them from `/api/spelling` as you sign in and as pages load. Company words go into this app's own dictionary on each Mac, not the Mac's shared one. Each person can override the company in **Edit → Spelling**.
