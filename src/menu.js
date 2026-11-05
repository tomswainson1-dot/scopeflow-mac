const { PRODUCTS, productUrl } = require("./links");

/**
 * Edit → Spelling (4 Nov 2026): each person's own switches. They start at the company's rules (Settings → Spelling in
 * ScopeFlow) and, once changed here, stay as this person chose until "Use Company Settings".
 */
function spellingSubmenu(spelling, onOpenCompanySettings) {
  if (!spelling) return [];
  const e = spelling.effective();
  return [
    { type: "separator" },
    {
      label: "Spelling",
      submenu: [
        {
          label: "Check Spelling While Typing",
          type: "checkbox",
          checked: e.checkWhileTyping,
          click: (item) => spelling.setPersonal("checkWhileTyping", item.checked),
        },
        {
          label: "Correct Spelling Automatically",
          type: "checkbox",
          checked: e.autoCorrect,
          enabled: e.checkWhileTyping,
          click: (item) => spelling.setPersonal("autoCorrect", item.checked),
        },
        { type: "separator" },
        {
          label: "Use Company Settings",
          enabled: e.hasPersonalChoice,
          click: () => spelling.useCompanySettings(),
        },
        ...(e.canEditWords && onOpenCompanySettings
          ? [{ label: "Company Spelling Settings…", click: () => onOpenCompanySettings() }]
          : []),
      ],
    },
  ];
}

/**
 * ScopeFlow → Check for Updates… and Settings… (4 Nov 2026). The update item is always pressable: its words say what
 * pressing it does now (check, restart to update), and when ScopeFlow is up to date pressing it says so. Tom reads a
 * greyed-out item as missing, so it is never disabled.
 */
function updateItems(update, onOpenSettings) {
  const items = [];
  if (update) items.push({ label: update.label, enabled: true, click: () => update.click() });
  items.push({ type: "separator" });
  if (onOpenSettings) {
    items.push({ label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => onOpenSettings() }, { type: "separator" });
  }
  return items;
}

function menuTemplate({ app, shell, onGo, focusedContents, spelling, onOpenCompanySettings, update, onOpenSettings }) {
  const go = (product) => ({
    label: product.label,
    accelerator: product.accelerator,
    click: () => onGo(productUrl(product)),
  });

  const contents = () => focusedContents();

  return [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        ...updateItems(update, onOpenSettings),
        {
          label: "ScopeFlow on the web",
          click: () => shell.openExternal("https://www.scopeflow.us"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        ...spellingSubmenu(spelling, onOpenCompanySettings),
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => contents()?.reload(),
        },
        {
          label: "Reload without cache",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => contents()?.reloadIgnoringCache(),
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Go",
      submenu: [
        {
          label: "Back",
          accelerator: "CmdOrCtrl+[",
          click: () => {
            const history = contents()?.navigationHistory;
            if (history?.canGoBack()) history.goBack();
          },
        },
        {
          label: "Forward",
          accelerator: "CmdOrCtrl+]",
          click: () => {
            const history = contents()?.navigationHistory;
            if (history?.canGoForward()) history.goForward();
          },
        },
        { type: "separator" },
        ...PRODUCTS.map(go),
      ],
    },
    {
      role: "windowMenu",
    },
    {
      role: "help",
      submenu: [
        {
          label: "ScopeFlow help",
          click: () => shell.openExternal("https://www.scopeflow.us/user-guide.html"),
        },
        {
          label: "Contact support",
          click: () => shell.openExternal("mailto:support@scopeflow.us"),
        },
      ],
    },
  ];
}

module.exports = { menuTemplate, spellingSubmenu, updateItems };
