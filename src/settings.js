/**
 * The app's own settings (4 Nov 2026), kept in settings.json in the app's data folder and changed in the Settings window
 * (ScopeFlow → Settings…, Command-comma). Tom wants every timing and default there rather than fixed in the code.
 * The first section is Updates; each section cleans what it reads, so a damaged or older file falls back to defaults.
 */

const { cleanUpdateSettings } = require("./update-rules");

const SECTIONS = {
  updates: cleanUpdateSettings,
};

/**
 * @param {{read(): any, write(state: object): void, onChange?: (section: string) => void}} store
 */
function createSettingsStore({ read, write, onChange = () => {} }) {
  let raw = {};
  try {
    raw = read() || {};
  } catch {
    raw = {};
  }
  const state = {};
  for (const [name, clean] of Object.entries(SECTIONS)) state[name] = clean(raw[name]);

  function section(name) {
    if (!Object.hasOwn(SECTIONS, name)) throw new Error(`No settings section called ${name}`);
    return name;
  }

  return {
    get(name) {
      return { ...state[section(name)] };
    },
    /** Merges a change into one section, keeps only what that section understands, saves, and returns the result. */
    set(name, patch) {
      section(name);
      state[name] = SECTIONS[name]({ ...state[name], ...(patch && typeof patch === "object" ? patch : {}) });
      try {
        write(state);
      } catch {
        // Kept for this session; the next launch reads the last saved file.
      }
      onChange(name);
      return { ...state[name] };
    },
  };
}

module.exports = { createSettingsStore };
