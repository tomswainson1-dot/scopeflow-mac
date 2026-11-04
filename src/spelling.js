/**
 * Spelling for the whole suite (4 Nov 2026).
 *
 * The company's rules come from ScopeFlow (Settings → Spelling, GET /api/spelling, asked with the person's own session):
 * whether to check spelling while typing, whether to auto-correct and what to leave alone, and the company's own words.
 * This keeps the app's dictionary in step with that word list, remembers what each person chose for themselves in
 * Edit → Spelling, and works out what applies.
 *
 * Words go into the app's own dictionary (Electron keeps it as "Custom Dictionary.txt" in the app's data folder; measured
 * 4 Nov 2026: macOS's own learned-words list is not touched), so other Mac apps are unaffected. A company word is taken
 * out again when the company removes it, unless the person had added it themselves. Everything Electron-specific is passed
 * in, so the tests run without Electron.
 */

/** Before the company's rules have ever been read: the same defaults ScopeFlow uses (lib/spelling.ts). */
const COMPANY_DEFAULTS = {
  checkWhileTyping: true,
  autoCorrect: true,
  skipNames: true,
  skipCodes: true,
  words: [],
  companyName: null,
  canEditWords: false,
};

const lower = (w) => String(w).toLocaleLowerCase();

function cleanCompany(feed) {
  if (!feed || typeof feed !== "object") return null;
  const bool = (v, d) => (typeof v === "boolean" ? v : d);
  return {
    checkWhileTyping: bool(feed.checkWhileTyping, true),
    autoCorrect: bool(feed.autoCorrect, true),
    skipNames: bool(feed.skipNames, true),
    skipCodes: bool(feed.skipCodes, true),
    words: Array.isArray(feed.words) ? feed.words.filter((w) => typeof w === "string" && w.trim()).map((w) => w.trim()) : [],
    companyName: typeof feed.companyName === "string" ? feed.companyName : null,
    canEditWords: feed.canEditWords === true,
  };
}

/**
 * @param {object} deps
 * @param {{add(word: string): void, remove(word: string): void, setEnabled(on: boolean): void}} deps.dictionary
 * @param {(method: string, url: string, body?: object) => Promise<{status: number, json: any}>} deps.request
 * @param {{read(): any, write(state: object): void}} deps.store
 * @param {string} deps.suiteOrigin   e.g. https://app.scopeflow.us
 * @param {() => void} [deps.onChange]
 */
function createSpelling({ dictionary, request, store, suiteOrigin, onChange = () => {} }) {
  const saved = (() => {
    try {
      return store.read() || {};
    } catch {
      return {};
    }
  })();
  const state = {
    company: cleanCompany(saved.company),
    personal: {
      checkWhileTyping: typeof saved.personal?.checkWhileTyping === "boolean" ? saved.personal.checkWhileTyping : null,
      autoCorrect: typeof saved.personal?.autoCorrect === "boolean" ? saved.personal.autoCorrect : null,
    },
    /** Company words this app put in its dictionary. */
    companyAdded: Array.isArray(saved.companyAdded) ? saved.companyAdded.filter((w) => typeof w === "string") : [],
    /** Words the person added with right-click → Add to Dictionary. */
    personAdded: Array.isArray(saved.personAdded) ? saved.personAdded.filter((w) => typeof w === "string") : [],
  };
  let inFlight = null;

  const save = () => {
    try {
      store.write(state);
    } catch {
      // A missed write only means the next launch reads the rules again.
    }
  };

  function effective() {
    const company = state.company || COMPANY_DEFAULTS;
    const checkWhileTyping = state.personal.checkWhileTyping ?? company.checkWhileTyping;
    const autoCorrect = checkWhileTyping && (state.personal.autoCorrect ?? company.autoCorrect);
    return {
      checkWhileTyping,
      autoCorrect,
      skipNames: company.skipNames,
      skipCodes: company.skipCodes,
      words: company.words,
      companyName: company.companyName,
      canEditWords: company.canEditWords,
      hasPersonalChoice: state.personal.checkWhileTyping !== null || state.personal.autoCorrect !== null,
      companyRead: state.company !== null,
    };
  }

  /** Put the company's words in the app's dictionary and take out the ones the company removed. */
  function syncDictionary() {
    const wanted = new Map((state.company?.words || []).map((w) => [lower(w), w]));
    const added = new Map(state.companyAdded.map((w) => [lower(w), w]));
    const person = new Set(state.personAdded.map(lower));
    for (const [key, word] of wanted) {
      if (!added.has(key)) {
        dictionary.add(word);
        added.set(key, word);
      }
    }
    for (const [key, word] of [...added]) {
      if (!wanted.has(key)) {
        if (!person.has(key)) dictionary.remove(word);
        added.delete(key);
      }
    }
    state.companyAdded = [...added.values()];
  }

  function applyAll() {
    dictionary.setEnabled(effective().checkWhileTyping);
    onChange();
  }

  function takeFeed(json) {
    const company = cleanCompany(json);
    if (!company) return false;
    state.company = company;
    syncDictionary();
    save();
    applyAll();
    return true;
  }

  /** Read the company's rules. Signed out or offline keeps the last rules read. Never throws. */
  function refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const { status, json } = await request("GET", `${suiteOrigin}/api/spelling`);
        if (status === 200 && json && json.ok) return takeFeed(json);
        return false;
      } catch {
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function addPersonWord(word) {
    dictionary.add(word);
    if (!state.personAdded.some((w) => lower(w) === lower(word))) state.personAdded.push(word);
    save();
  }

  /** Right-click → Add for Everyone (admins). Returns { ok } or { ok: false, error }; the word is in the dictionary either way. */
  async function addCompanyWord(word) {
    dictionary.add(word);
    try {
      const { status, json } = await request("POST", `${suiteOrigin}/api/spelling`, { word });
      if (status === 200 && json && json.ok) {
        takeFeed(json);
        return { ok: true };
      }
      addPersonWord(word);
      return { ok: false, error: (json && json.error) || `ScopeFlow answered ${status}.` };
    } catch {
      addPersonWord(word);
      return { ok: false, error: "ScopeFlow could not be reached." };
    }
  }

  /** Edit → Spelling: a person's own choice, or null to follow the company again. */
  function setPersonal(key, value) {
    if (key !== "checkWhileTyping" && key !== "autoCorrect") return;
    state.personal[key] = typeof value === "boolean" ? value : null;
    save();
    applyAll();
  }

  function resetToCompany() {
    state.personal = { checkWhileTyping: null, autoCorrect: null };
    save();
    applyAll();
  }

  /** What a page's auto-correct needs (page-preload.js). */
  function pageConfig() {
    const e = effective();
    return { autoCorrect: e.autoCorrect, skipNames: e.skipNames, skipCodes: e.skipCodes, words: e.words };
  }

  // Start from what was saved: the dictionary switch as last chosen, and any company words not yet added.
  syncDictionary();
  dictionary.setEnabled(effective().checkWhileTyping);

  return { effective, refresh, addPersonWord, addCompanyWord, setPersonal, useCompanySettings: resetToCompany, pageConfig };
}

module.exports = { COMPANY_DEFAULTS, createSpelling };
