/**
 * Which addresses stay inside the ScopeFlow window.
 *
 * The suite is one website on app.scopeflow.us (Estimating, CRM at /crm,
 * Project Management at /pm, Roof Report at /roof-report, Agent Desk at
 * /desk). Accounting is accounting.scopeflow.us. Sign-in and connected
 * accounts hop out to Supabase, Google, Microsoft, Intuit and Xero and then
 * come back, so those hosts stay in the window too. Anything else opens in
 * the normal browser, the way an installed Chrome app does.
 */

const DEFAULT_SUITE_ORIGIN = "https://app.scopeflow.us";

/** Hosts a sign-in or a connected account is allowed to visit. */
const AUTH_HOST_SUFFIXES = [
  "supabase.co",
  "google.com",
  "googleusercontent.com",
  "gstatic.com",
  "microsoftonline.com",
  "microsoft.com",
  "live.com",
  "office.com",
  "office365.com",
  "intuit.com",
  "xero.com",
  "apple.com",
  "icloud.com",
];

const PRODUCTS = [
  { id: "home", label: "Applications", path: "/" },
  { id: "estimating", label: "Estimating", path: "/projects", accelerator: "CmdOrCtrl+1" },
  { id: "crm", label: "CRM", path: "/crm", accelerator: "CmdOrCtrl+2" },
  { id: "pm", label: "Project Management", path: "/pm", accelerator: "CmdOrCtrl+3" },
  { id: "roof", label: "Roof Report", path: "/roof-report", accelerator: "CmdOrCtrl+4" },
  { id: "desk", label: "Agent Desk", path: "/desk", accelerator: "CmdOrCtrl+5" },
  { id: "accounting", label: "Accounting", accelerator: "CmdOrCtrl+6" },
];

function configuredSuiteUrl(env = process.env) {
  const raw = (env.SCOPEFLOW_URL || DEFAULT_SUITE_ORIGIN).trim();
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("SCOPEFLOW_URL must start with http:// or https://");
  }
  return url;
}

function startUrl(env = process.env) {
  return configuredSuiteUrl(env).href;
}

function suiteHost(env = process.env) {
  return configuredSuiteUrl(env).hostname.toLowerCase();
}

function isLocalHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1";
}

function hostIs(hostname, suffix) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const needle = suffix.toLowerCase();
  return host === needle || host.endsWith(`.${needle}`);
}

function accountingUrl(env = process.env) {
  if (env.SCOPEFLOW_ACCOUNTING_URL?.trim()) return env.SCOPEFLOW_ACCOUNTING_URL.trim();
  const host = suiteHost(env);
  if (isLocalHost(host)) return "http://localhost:3700/accounting";
  return "https://accounting.scopeflow.us/accounting";
}

function productUrl(product, env = process.env) {
  if (product.id === "accounting") return accountingUrl(env);
  const suite = configuredSuiteUrl(env);
  return new URL(product.path, suite.origin).href;
}

function shouldStayInApp(rawUrl, env = process.env) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === "about:" || url.protocol === "blob:" || url.protocol === "data:") return true;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname;
  const home = suiteHost(env);
  if (isLocalHost(host)) return isLocalHost(home);
  if (hostIs(host, "scopeflow.us")) return true;
  if (host.toLowerCase() === home) return true;
  return AUTH_HOST_SUFFIXES.some((suffix) => hostIs(host, suffix));
}

/** A new ScopeFlow window, a small sign-in popup, or the system browser. */
function openKind(rawUrl, env = process.env) {
  if (!shouldStayInApp(rawUrl, env)) return "browser";
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return "browser";
  }
  if (url.protocol === "about:" || url.protocol === "blob:" || url.protocol === "data:") return "popup";
  const host = url.hostname;
  const home = suiteHost(env);
  if (host.toLowerCase() === home || hostIs(host, "scopeflow.us") || (isLocalHost(host) && isLocalHost(home))) {
    return "window";
  }
  return "popup";
}

module.exports = {
  AUTH_HOST_SUFFIXES,
  DEFAULT_SUITE_ORIGIN,
  PRODUCTS,
  accountingUrl,
  configuredSuiteUrl,
  openKind,
  productUrl,
  shouldStayInApp,
  startUrl,
  suiteHost,
};
