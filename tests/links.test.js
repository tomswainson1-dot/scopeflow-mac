const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { accountingUrl, openKind, productUrl, shouldStayInApp, startUrl } = require("../src/links");

const live = { SCOPEFLOW_URL: "https://app.scopeflow.us/" };
const local = { SCOPEFLOW_URL: "http://localhost:3000/" };

describe("start URL", () => {
  it("opens the live suite when nothing is configured", () => {
    assert.equal(startUrl({}), "https://app.scopeflow.us/");
  });

  it("uses SCOPEFLOW_URL when one is set", () => {
    assert.equal(startUrl({ SCOPEFLOW_URL: "http://localhost:3000/login" }), "http://localhost:3000/login");
  });
});

describe("product addresses", () => {
  it("keeps every suite product on the suite origin", () => {
    assert.equal(productUrl({ id: "estimating", path: "/projects" }, live), "https://app.scopeflow.us/projects");
    assert.equal(productUrl({ id: "crm", path: "/crm" }, live), "https://app.scopeflow.us/crm");
    assert.equal(productUrl({ id: "pm", path: "/pm" }, live), "https://app.scopeflow.us/pm");
    assert.equal(productUrl({ id: "roof", path: "/roof-report" }, live), "https://app.scopeflow.us/roof-report");
    assert.equal(productUrl({ id: "desk", path: "/desk" }, live), "https://app.scopeflow.us/desk");
  });

  it("sends accounting to its own host, and to port 3700 on this Mac", () => {
    assert.equal(accountingUrl(live), "https://accounting.scopeflow.us/accounting");
    assert.equal(productUrl({ id: "accounting" }, local), "http://localhost:3700/accounting");
  });
});

describe("what stays in the window", () => {
  const stay = [
    "https://app.scopeflow.us/projects",
    "https://app.scopeflow.us/crm",
    "https://app.scopeflow.us/pm",
    "https://app.scopeflow.us/roof-report",
    "https://app.scopeflow.us/desk",
    "https://accounting.scopeflow.us/accounting",
    "https://www.scopeflow.us/user-guide.html",
    "https://abc.supabase.co/auth/v1/authorize",
    "https://accounts.google.com/o/oauth2/v2/auth",
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    "https://appcenter.intuit.com/connect/oauth2",
    "https://login.xero.com/identity/connect/authorize",
    "about:blank",
  ];

  for (const url of stay) {
    it(`stays: ${url}`, () => {
      assert.equal(shouldStayInApp(url, live), true);
    });
  }

  const leave = [
    "https://example.com/",
    "https://scopeflow.us.evil.example/",
    "https://notscopeflow.us/",
    "http://localhost:3000/",
    "mailto:support@scopeflow.us",
    "javascript:alert(1)",
    "not a url",
  ];

  for (const url of leave) {
    it(`opens outside: ${url}`, () => {
      assert.equal(shouldStayInApp(url, live), false);
      assert.equal(openKind(url, live), "browser");
    });
  }

  it("allows localhost only while the suite itself is on localhost", () => {
    assert.equal(shouldStayInApp("http://localhost:3400/crm", local), true);
    assert.equal(shouldStayInApp("http://localhost:3400/crm", live), false);
  });

  it("opens a suite page as a window and a sign-in page as a popup", () => {
    assert.equal(openKind("https://app.scopeflow.us/crm", live), "window");
    assert.equal(openKind("https://accounts.google.com/o/oauth2/v2.0/auth", live), "popup");
    assert.equal(openKind("about:blank", live), "popup");
  });
});
