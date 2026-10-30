const { PRODUCTS, productUrl } = require("./links");

function menuTemplate({ app, shell, onGo, focusedContents }) {
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

module.exports = { menuTemplate };
