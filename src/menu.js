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

function menuTemplate({ app, shell, onGo, focusedContents, spelling, onOpenCompanySettings }) {
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
        { type: "separator" },
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

module.exports = { menuTemplate, spellingSubmenu };
