/**
 * Auto-correct as you type, Mac style (4 Nov 2026).
 *
 * Tom chose "Full Mac-style": when a word is finished with a space or punctuation and the Mac's own spelling checker marks
 * it as misspelled, swap in the Mac's first suggestion. Command-Z puts the word back, and a word put back is left alone on
 * that page from then on. The company's rules (Settings → Spelling in ScopeFlow, read by the main process) say whether it
 * runs and what it leaves alone; each person can also turn it off in Edit → Spelling.
 *
 * This preload is sandboxed, so it cannot load other files: the rules live here as plain functions and are exported for
 * the tests (`module` exists under Node, not in the page). It only listens; it adds nothing to the page's own scripts.
 */

const electron = require("electron");

/** A word ends at one of these, typed straight after it. Not the apostrophe: "isn" + ' is half of "isn't". */
const BOUNDARY = /^[  .,;:!?)\]}]$/;
/** The word just before the boundary: letters, with apostrophes inside it. */
const WORD_AT_END = /([\p{L}][\p{L}'’]*)$/u;
/** What may come right before a word for it to be a word on its own (not part of an address, a path or a code). */
const WORD_START = /[\s(\[{"“‘]$/u;

/** The text before `word` starts a sentence: nothing, or ., ! or ? then space, or a new line. */
function isSentenceStart(before) {
  const trimmed = before.replace(/[ \t ("“‘]+$/u, "");
  return trimmed === "" || /[.!?\n]$/.test(trimmed);
}

/**
 * Find the word that was just finished. `text` is everything before the caret, ending with the boundary that was typed.
 * Returns null when the boundary is not there or what precedes it is not a plain word.
 */
function wordBeforeBoundary(text, boundary) {
  if (!boundary) return null;
  // An editable area stores a space typed at the end of its text as a non-breaking space.
  const tail = text.slice(-boundary.length);
  if (tail !== boundary && !(boundary === " " && tail === " ")) return null;
  const head = text.slice(0, text.length - boundary.length);
  const m = WORD_AT_END.exec(head);
  if (!m) return null;
  let word = m[1];
  while (/['’]$/.test(word)) word = word.slice(0, -1);
  if (!word) return null;
  const start = m.index;
  const before = head.slice(0, start);
  if (before !== "" && !WORD_START.test(before)) return null;
  return { word, start, end: start + word.length, before };
}

/** The company's guards. `rules`: { skipNames, skipCodes, words: Set of lower-case words, ignored: Set }. */
function mayCorrect(word, before, rules) {
  const lower = word.toLocaleLowerCase();
  if (rules.words?.has(lower) || rules.ignored?.has(lower)) return false;
  if (rules.skipCodes) {
    if (/\p{N}/u.test(word)) return false;
    if (word.length < 3) return false;
    if (word.length > 1 && word === word.toLocaleUpperCase() && word !== lower) return false;
  }
  if (rules.skipNames) {
    const capitals = [...word].filter((c) => c !== c.toLocaleLowerCase() && c === c.toLocaleUpperCase()).length;
    const onlyFirst = capitals === 1 && word[0] !== word[0].toLocaleLowerCase();
    if (capitals > 1) return false;
    if (capitals === 1 && !(onlyFirst && isSentenceStart(before))) return false;
  }
  return true;
}

/** Edit distance with swaps (Damerau–Levenshtein, optimal string alignment), case-insensitive. */
function editDistance(a, b) {
  a = a.toLocaleLowerCase();
  b = b.toLocaleLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * The Mac's first suggestion, if it is a near miss of what was typed: one word, and at most one change for a short word
 * (up to 4 letters) or two for a longer one. A far-off first suggestion is a guess, and a guess is not corrected.
 * Keeps a capital first letter.
 */
function pickCorrection(word, suggestions) {
  const first = (suggestions || [])[0];
  if (!first || /\s/.test(first)) return null;
  if (first.toLocaleLowerCase() === word.toLocaleLowerCase()) return null;
  const limit = word.length <= 4 ? 1 : 2;
  if (editDistance(word, first) > limit) return null;
  const capitalFirst = word[0] !== word[0].toLocaleLowerCase();
  return capitalFirst ? first[0].toLocaleUpperCase() + first.slice(1) : first;
}

const rules = { BOUNDARY, isSentenceStart, wordBeforeBoundary, mayCorrect, editDistance, pickCorrection };

/* ------------------------------------------------------------------------------------------------------------------ */
/* In the page                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------------ */

const NO_CORRECT_INPUT_TYPES = new Set(["email", "url", "password", "number", "tel", "date", "time", "datetime-local"]);

function startInPage({ webFrame, ipcRenderer }) {
  let config = { autoCorrect: false, skipNames: true, skipCodes: true, words: new Set() };
  const ignored = new Set();
  let busy = false;
  let last = null; // { el, word, replacement }

  const apply = (next) => {
    if (!next || typeof next !== "object") return;
    config = {
      autoCorrect: next.autoCorrect === true,
      skipNames: next.skipNames !== false,
      skipCodes: next.skipCodes !== false,
      words: new Set((Array.isArray(next.words) ? next.words : []).map((w) => String(w).toLocaleLowerCase())),
    };
  };
  ipcRenderer.on("scopeflow-spelling", (_event, next) => apply(next));
  ipcRenderer.invoke("scopeflow-spelling-get").then(apply, () => {});

  function eligible(el) {
    if (!el || el.isContentEditable === undefined) return false;
    if (el.spellcheck === false) return false;
    if (el.closest?.('[autocorrect="off"], [data-autocorrect="off"]')) return false;
    if (el.tagName === "INPUT") return !NO_CORRECT_INPUT_TYPES.has(el.type) && !el.readOnly;
    if (el.tagName === "TEXTAREA") return !el.readOnly;
    return el.isContentEditable === true;
  }

  function correctField(el, boundary) {
    if (el.selectionStart !== el.selectionEnd || el.selectionStart == null) return null;
    const caret = el.selectionStart;
    const found = wordBeforeBoundary(el.value.slice(0, caret), boundary);
    if (!found) return null;
    return {
      found,
      replace(replacement) {
        el.setSelectionRange(found.start, found.end);
        document.execCommand("insertText", false, replacement);
        const at = found.start + replacement.length + boundary.length;
        el.setSelectionRange(at, at);
      },
    };
  }

  function correctEditable(boundary) {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode || sel.anchorNode.nodeType !== Node.TEXT_NODE) return null;
    const node = sel.anchorNode;
    const found = wordBeforeBoundary(node.data.slice(0, sel.anchorOffset), boundary);
    if (!found) return null;
    return {
      found,
      replace(replacement) {
        const range = document.createRange();
        range.setStart(node, found.start);
        range.setEnd(node, found.end);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand("insertText", false, replacement);
        for (let i = 0; i < boundary.length; i++) sel.modify("move", "forward", "character");
      },
    };
  }

  window.addEventListener(
    "input",
    (event) => {
      if (busy) return;
      const el = event.target;
      // Command-Z straight after a correction: that word is left alone on this page from now on.
      if (event.inputType === "historyUndo" && last && last.el === el) {
        ignored.add(last.word.toLocaleLowerCase());
        // Undo leaves the restored word selected; put the caret back after it, where it was, so typing on keeps it.
        try {
          if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
            if (el.selectionStart !== el.selectionEnd && el.value.slice(el.selectionStart, el.selectionEnd) === last.word) {
              const at = el.selectionEnd + last.boundary.length;
              el.setSelectionRange(at, at);
            }
          } else {
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && sel.toString() === last.word) {
              sel.collapseToEnd();
              for (let i = 0; i < last.boundary.length; i++) sel.modify("move", "forward", "character");
            }
          }
        } catch {
          // The caret stays where undo left it.
        }
        last = null;
        return;
      }
      last = null;
      if (!config.autoCorrect || event.isComposing) return;
      let boundary = null;
      if (event.inputType === "insertText" && typeof event.data === "string" && BOUNDARY.test(event.data)) boundary = event.data;
      else if ((event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") && el.tagName === "TEXTAREA") boundary = "\n";
      if (!boundary || !eligible(el)) return;

      const edit = el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? correctField(el, boundary) : correctEditable(boundary);
      if (!edit) return;
      const { word, before } = edit.found;
      if (!mayCorrect(word, before, { ...config, ignored })) return;
      if (!webFrame.isWordMisspelled(word)) return;
      const replacement = pickCorrection(word, webFrame.getWordSuggestions(word));
      if (!replacement) return;

      busy = true;
      try {
        edit.replace(replacement);
        last = { el, word, replacement, boundary };
      } catch {
        // A page that will not take the edit keeps what was typed.
      } finally {
        busy = false;
      }
    },
    true
  );
}

if (electron && typeof electron === "object" && electron.webFrame && electron.ipcRenderer && typeof window !== "undefined") {
  startInPage(electron);
}

if (typeof module === "object" && module) module.exports = rules;
