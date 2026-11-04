/**
 * The right-click menu (4 Nov 2026).
 *
 * Tom: "It underlines with red where there is a spelling issue but right click gives no suggestions or the option to add
 * to dictionary." Spell checking was on, but Electron has no right-click menu of its own and this app never built one, so
 * right-click did nothing at all. This builds the menu from what was right-clicked: spelling suggestions and Add to
 * Dictionary (plus Add for Everyone for a company admin), Cut/Copy/Paste, Look Up, links and images.
 *
 * Plain data in, a Menu template out: every action goes through `actions`, so the tests can run it without Electron.
 * A ScopeFlow page that opens its own menu (the bill grid's Copy, Paste and Duplicate) cancels the right-click, and
 * Electron then never asks for this one.
 */

const LOOK_UP_MAX = 24;

function quoted(text) {
  const t = text.replace(/\s+/g, " ").trim();
  return `“${t.length > LOOK_UP_MAX ? `${t.slice(0, LOOK_UP_MAX - 1)}…` : t}”`;
}

/** Drop leading, trailing and doubled separators. */
function tidy(items) {
  const out = [];
  for (const item of items) {
    if (item.type === "separator" && (out.length === 0 || out[out.length - 1].type === "separator")) continue;
    out.push(item);
  }
  while (out.length && out[out.length - 1].type === "separator") out.pop();
  return out;
}

/**
 * @param {object} params  Electron's context-menu params (isEditable, misspelledWord, dictionarySuggestions, editFlags,
 *                         selectionText, linkURL, mediaType, hasImageContents, srcURL, x, y).
 * @param {object} ctx
 * @param {string} ctx.platform           process.platform
 * @param {boolean} ctx.isSuitePage       a ScopeFlow page (not a sign-in popup)
 * @param {boolean} ctx.canEditWords      the person is a company admin
 * @param {string|null} ctx.companyName   for "Add for Everyone at …"
 * @param {{canGoBack: boolean, canGoForward: boolean}} ctx.history
 * @param {object} ctx.actions            replaceMisspelling, addToDictionary, addForEveryone, cut, copy, paste,
 *                                        pasteAndMatchStyle, selectAll, lookUp, openLink, copyText, copyImageAt,
 *                                        back, forward, reload
 */
function contextMenuTemplate(params, ctx) {
  const a = ctx.actions;
  const flags = params.editFlags || {};
  const selection = (params.selectionText || "").trim();
  const items = [];

  // Spelling: only for a misspelled word in a box being typed in.
  if (params.isEditable && params.misspelledWord) {
    const word = params.misspelledWord;
    const suggestions = (params.dictionarySuggestions || []).filter((s) => s && s !== word);
    if (suggestions.length === 0) {
      items.push({ label: "No Suggestions", enabled: false });
    } else {
      for (const s of suggestions) items.push({ label: s, click: () => a.replaceMisspelling(s) });
    }
    items.push({ type: "separator" });
    items.push({ label: "Add to Dictionary", click: () => a.addToDictionary(word) });
    if (ctx.isSuitePage && ctx.canEditWords) {
      items.push({
        label: ctx.companyName ? `Add for Everyone at ${ctx.companyName}` : "Add for Everyone",
        click: () => a.addForEveryone(word),
      });
    }
    items.push({ type: "separator" });
  }

  if (params.isEditable) {
    items.push({ label: "Cut", enabled: flags.canCut !== false, click: () => a.cut() });
    items.push({ label: "Copy", enabled: flags.canCopy !== false, click: () => a.copy() });
    items.push({ label: "Paste", enabled: flags.canPaste !== false, click: () => a.paste() });
    items.push({ label: "Paste and Match Style", enabled: flags.canPaste !== false, click: () => a.pasteAndMatchStyle() });
    items.push({ label: "Select All", enabled: flags.canSelectAll !== false, click: () => a.selectAll() });
  } else if (selection) {
    items.push({ label: "Copy", click: () => a.copy() });
  }

  if (selection && ctx.platform === "darwin") {
    items.push({ type: "separator" });
    items.push({ label: `Look Up ${quoted(selection)}`, click: () => a.lookUp() });
  }

  const link = params.linkURL || "";
  if (/^https?:\/\//i.test(link)) {
    items.push({ type: "separator" });
    items.push({ label: "Open Link", click: () => a.openLink(link) });
    items.push({ label: "Copy Link Address", click: () => a.copyText(link) });
  }

  if (params.mediaType === "image" && params.hasImageContents) {
    items.push({ type: "separator" });
    items.push({ label: "Copy Image", click: () => a.copyImageAt(params.x, params.y) });
    if (/^https?:\/\//i.test(params.srcURL || "")) {
      items.push({ label: "Copy Image Address", click: () => a.copyText(params.srcURL) });
    }
  }

  if (tidy(items).length === 0) {
    items.push({ label: "Back", enabled: Boolean(ctx.history?.canGoBack), click: () => a.back() });
    items.push({ label: "Forward", enabled: Boolean(ctx.history?.canGoForward), click: () => a.forward() });
    items.push({ label: "Reload", click: () => a.reload() });
  }

  return tidy(items);
}

module.exports = { contextMenuTemplate };
