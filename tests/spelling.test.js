const test = require("node:test");
const assert = require("node:assert/strict");
const { contextMenuTemplate } = require("../src/context-menu");
const rules = require("../src/page-preload");
const { createSpelling } = require("../src/spelling");

/**
 * Spelling in the Mac app (4 Nov 2026; Tom: right-click "gives no suggestions or the option to add to dictionary"; his
 * choices: full Mac-style auto-correct, one company word list).
 */

const noop = () => {};
const actions = new Proxy({}, { get: () => noop });
const ctx = (over = {}) => ({
  platform: "darwin",
  isSuitePage: true,
  canEditWords: false,
  companyName: "TCR LLC",
  history: { canGoBack: true, canGoForward: false },
  actions,
  ...over,
});
const labels = (template) => template.map((i) => (i.type === "separator" ? "—" : i.label));

/* ---------------------------------------------------------------- the right-click menu */

test("a misspelled word: suggestions, Add to Dictionary, then the edit items", () => {
  const t = contextMenuTemplate(
    { isEditable: true, misspelledWord: "flashng", dictionarySuggestions: ["flashing", "flushing"], selectionText: "flashng", editFlags: {} },
    ctx()
  );
  assert.deepEqual(labels(t), [
    "flashing",
    "flushing",
    "—",
    "Add to Dictionary",
    "—",
    "Cut",
    "Copy",
    "Paste",
    "Paste and Match Style",
    "Select All",
    "—",
    "Look Up “flashng”",
  ]);
});

test("choosing a suggestion replaces the word; Add to Dictionary adds it", () => {
  const calls = [];
  const spy = new Proxy({}, { get: (_t, name) => (...args) => calls.push([name, ...args]) });
  const t = contextMenuTemplate({ isEditable: true, misspelledWord: "recieve", dictionarySuggestions: ["receive"], editFlags: {} }, ctx({ actions: spy }));
  t.find((i) => i.label === "receive").click();
  t.find((i) => i.label === "Add to Dictionary").click();
  assert.deepEqual(calls, [["replaceMisspelling", "receive"], ["addToDictionary", "recieve"]]);
});

test("no suggestions says so", () => {
  const t = contextMenuTemplate({ isEditable: true, misspelledWord: "zxqv", dictionarySuggestions: [], editFlags: {} }, ctx());
  assert.equal(t[0].label, "No Suggestions");
  assert.equal(t[0].enabled, false);
});

test("an admin also gets Add for Everyone, named for the company; never on a sign-in popup", () => {
  const p = { isEditable: true, misspelledWord: "purlin", dictionarySuggestions: ["purloin"], editFlags: {} };
  assert.ok(labels(contextMenuTemplate(p, ctx({ canEditWords: true }))).includes("Add for Everyone at TCR LLC"));
  assert.ok(labels(contextMenuTemplate(p, ctx({ canEditWords: true, companyName: null }))).includes("Add for Everyone"));
  assert.ok(!labels(contextMenuTemplate(p, ctx({ canEditWords: false }))).some((l) => l.startsWith("Add for Everyone")));
  assert.ok(!labels(contextMenuTemplate(p, ctx({ canEditWords: true, isSuitePage: false }))).some((l) => l.startsWith("Add for Everyone")));
});

test("edit items follow what the box allows", () => {
  const t = contextMenuTemplate({ isEditable: true, editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true } }, ctx());
  const byLabel = Object.fromEntries(t.map((i) => [i.label, i]));
  assert.equal(byLabel.Cut.enabled, false);
  assert.equal(byLabel.Copy.enabled, false);
  assert.equal(byLabel.Paste.enabled, true);
});

test("selected page text: Copy and Look Up; a link; an image", () => {
  assert.deepEqual(labels(contextMenuTemplate({ selectionText: "standing seam", editFlags: {} }, ctx())), ["Copy", "—", "Look Up “standing seam”"]);
  assert.deepEqual(labels(contextMenuTemplate({ linkURL: "https://app.scopeflow.us/projects", editFlags: {} }, ctx())), ["Open Link", "Copy Link Address"]);
  assert.deepEqual(
    labels(contextMenuTemplate({ mediaType: "image", hasImageContents: true, srcURL: "https://x.test/a.png", x: 1, y: 2, editFlags: {} }, ctx())),
    ["Copy Image", "Copy Image Address"]
  );
});

test("Look Up is a Mac menu item; a long selection is shortened", () => {
  assert.ok(!labels(contextMenuTemplate({ selectionText: "roof", editFlags: {} }, ctx({ platform: "win32" }))).some((l) => l.startsWith("Look Up")));
  const long = labels(contextMenuTemplate({ selectionText: "a very long piece of selected page text", editFlags: {} }, ctx())).at(-1);
  assert.equal(long, "Look Up “a very long piece of se…”");
});

test("right-click on nothing in particular: Back, Forward, Reload", () => {
  const t = contextMenuTemplate({ editFlags: {} }, ctx());
  assert.deepEqual(labels(t), ["Back", "Forward", "Reload"]);
  assert.equal(t[1].enabled, false);
});

/* ---------------------------------------------------------------- auto-correct rules */

test("finds the word just finished, and only a word on its own", () => {
  assert.deepEqual(rules.wordBeforeBoundary("new flashng ", " "), { word: "flashng", start: 4, end: 11, before: "new " });
  assert.equal(rules.wordBeforeBoundary("flashng.", ".").word, "flashng");
  assert.equal(rules.wordBeforeBoundary("(recieve)", ")").word, "recieve");
  assert.equal(rules.wordBeforeBoundary("isn' ", " ").word, "isn");
  assert.equal(rules.wordBeforeBoundary("tom@exmaple ", " "), null); // part of an email address
  assert.equal(rules.wordBeforeBoundary("www.exmaple ", " "), null); // part of an address
  assert.equal(rules.wordBeforeBoundary("re-rooof ", " "), null); // part of a compound
  assert.equal(rules.wordBeforeBoundary("M12 ", " "), null); // not letters
  assert.equal(rules.wordBeforeBoundary("word", " "), null); // the boundary is not there
});

test("the boundary is a space or punctuation, never an apostrophe", () => {
  for (const ch of [" ", ".", ",", ";", ":", "!", "?", ")"]) assert.ok(rules.BOUNDARY.test(ch), ch);
  for (const ch of ["'", "’", "a", "-", "/"]) assert.ok(!rules.BOUNDARY.test(ch), ch);
});

test("sentence start: the start of the box, after . ! ? or a new line", () => {
  assert.ok(rules.isSentenceStart(""));
  assert.ok(rules.isSentenceStart("Done. "));
  assert.ok(rules.isSentenceStart("Done!\n"));
  assert.ok(!rules.isSentenceStart("call "));
});

test("the company's guards", () => {
  const on = { skipNames: true, skipCodes: true, words: new Set(["purlin"]), ignored: new Set(["teh"]) };
  assert.equal(rules.mayCorrect("flashng", "new ", on), true);
  assert.equal(rules.mayCorrect("purlin", "", on), false); // company word
  assert.equal(rules.mayCorrect("Purlin", "", on), false); // company word in any case
  assert.equal(rules.mayCorrect("teh", "", on), false); // put back with Command-Z earlier
  assert.equal(rules.mayCorrect("Swainsn", "call ", on), false); // a name mid-sentence
  assert.equal(rules.mayCorrect("Recieve", "", on), true); // a capital at the start of a sentence
  assert.equal(rules.mayCorrect("McDonalds", "", on), false); // capitals inside the word
  assert.equal(rules.mayCorrect("TPO", "", on), false); // all capitals
  assert.equal(rules.mayCorrect("nr", "4 ", on), false); // short
  const off = { skipNames: false, skipCodes: false, words: new Set(), ignored: new Set() };
  assert.equal(rules.mayCorrect("Swainsn", "call ", off), true);
  assert.equal(rules.mayCorrect("nr", "4 ", off), true);
});

test("only a near-miss first suggestion is used; a capital first letter is kept", () => {
  assert.equal(rules.pickCorrection("flashng", ["flashing"]), "flashing");
  assert.equal(rules.pickCorrection("recieve", ["receive", "relieve"]), "receive"); // a swap counts as one change
  assert.equal(rules.pickCorrection("Recieve", ["receive"]), "Receive");
  assert.equal(rules.pickCorrection("purlin", ["purloin"]), "purloin"); // why company words matter
  assert.equal(rules.pickCorrection("roff", ["roof"]), "roof"); // one change in a short word
  assert.equal(rules.pickCorrection("rfoo", ["roof"]), null); // two changes in a short word: a guess
  assert.equal(rules.pickCorrection("membraen", ["membrane"]), "membrane");
  assert.equal(rules.pickCorrection("xyzzyq", ["fizzy"]), null); // far off
  assert.equal(rules.pickCorrection("flashng", ["flash ng"]), null); // two words
  assert.equal(rules.pickCorrection("flashng", []), null);
});

/* ---------------------------------------------------------------- the spelling manager */

function harness(saved = null, answers = []) {
  const dict = { added: [], removed: [], enabled: [] };
  const requests = [];
  let stored = saved;
  const s = createSpelling({
    dictionary: { add: (w) => dict.added.push(w), remove: (w) => dict.removed.push(w), setEnabled: (on) => dict.enabled.push(on) },
    request: async (method, url, body) => {
      requests.push([method, url, body]);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next || { status: 500, json: null };
    },
    store: { read: () => stored, write: (st) => (stored = JSON.parse(JSON.stringify(st))) },
    suiteOrigin: "https://app.scopeflow.us",
  });
  return { s, dict, requests, stored: () => stored };
}
const feed = (over = {}) => ({ status: 200, json: { ok: true, version: 1, checkWhileTyping: true, autoCorrect: true, skipNames: true, skipCodes: true, words: [], companyName: "TCR LLC", canEditWords: false, ...over } });

test("before the company's rules are read: spell check and auto-correct on (ScopeFlow's defaults)", () => {
  const { s, dict } = harness();
  assert.equal(s.effective().checkWhileTyping, true);
  assert.equal(s.effective().autoCorrect, true);
  assert.deepEqual(dict.enabled, [true]);
});

test("reading the rules adds the company's words to the app's dictionary, once", async () => {
  const { s, dict, requests } = harness(null, [feed({ words: ["Kingspan", "EPDM"] }), feed({ words: ["Kingspan", "EPDM"] })]);
  assert.equal(await s.refresh(), true);
  await s.refresh();
  assert.deepEqual(requests[0], ["GET", "https://app.scopeflow.us/api/spelling", undefined]);
  assert.deepEqual(dict.added, ["Kingspan", "EPDM"]);
});

test("a word the company removes comes out of the dictionary, unless the person added it too", async () => {
  const { s, dict } = harness(null, [feed({ words: ["Kingspan", "soffit"] }), feed({ words: [] })]);
  await s.refresh();
  s.addPersonWord("soffit");
  await s.refresh();
  assert.deepEqual(dict.removed, ["Kingspan"]);
});

test("signed out or offline keeps the last rules read", async () => {
  const { s } = harness(null, [feed({ autoCorrect: false, words: ["purlin"] }), { status: 401, json: { ok: false } }, new Error("offline")]);
  await s.refresh();
  assert.equal(await s.refresh(), false);
  assert.equal(await s.refresh(), false);
  assert.equal(s.effective().autoCorrect, false);
  assert.deepEqual(s.pageConfig().words, ["purlin"]);
});

test("a person's own choice wins until Use Company Settings; auto-correct needs spell check", async () => {
  const { s, dict } = harness(null, [feed({ autoCorrect: true })]);
  await s.refresh();
  s.setPersonal("autoCorrect", false);
  assert.equal(s.effective().autoCorrect, false);
  assert.equal(s.effective().hasPersonalChoice, true);
  s.setPersonal("autoCorrect", true);
  s.setPersonal("checkWhileTyping", false);
  assert.equal(s.effective().autoCorrect, false);
  assert.equal(dict.enabled.at(-1), false);
  s.useCompanySettings();
  assert.equal(s.effective().checkWhileTyping, true);
  assert.equal(s.effective().autoCorrect, true);
  assert.equal(s.effective().hasPersonalChoice, false);
});

test("what was read and chosen survives a restart", async () => {
  const first = harness(null, [feed({ words: ["Kingspan"], skipNames: false })]);
  await first.s.refresh();
  first.s.setPersonal("autoCorrect", false);
  const again = harness(first.stored());
  assert.equal(again.s.effective().autoCorrect, false);
  assert.equal(again.s.effective().skipNames, false);
  assert.deepEqual(again.dict.added, []); // already in the dictionary
});

test("Add for Everyone posts the word; if ScopeFlow refuses, it is kept on this Mac and the reason comes back", async () => {
  const ok = harness(null, [feed({ words: ["purlin"], canEditWords: true })]);
  assert.deepEqual(await ok.s.addCompanyWord("purlin"), { ok: true });
  assert.deepEqual(ok.requests[0], ["POST", "https://app.scopeflow.us/api/spelling", { word: "purlin" }]);
  assert.deepEqual(ok.s.pageConfig().words, ["purlin"]);

  const refused = harness(null, [{ status: 403, json: { ok: false, error: "Only an admin can do that." } }]);
  assert.deepEqual(await refused.s.addCompanyWord("soffit"), { ok: false, error: "Only an admin can do that." });
  assert.ok(refused.dict.added.includes("soffit"));
});
