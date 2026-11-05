/* The Settings window's page (src/settings.html). Plain browser code: no Node, only window.scopeflowSettings. */
(() => {
  const api = window.scopeflowSettings;
  const $ = (id) => document.getElementById(id);
  let action = "check";

  function lastChecked(ms) {
    if (!ms) return "Not checked yet.";
    const at = new Date(ms);
    const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (at.toDateString() === new Date().toDateString()) return `Last checked today at ${time}.`;
    return `Last checked ${at.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })} at ${time}.`;
  }

  function paintStatus(view) {
    if (!view) return;
    $("title").textContent = view.text.title;
    $("detail").textContent = view.text.detail;
    const downloading = view.state === "downloading" && Number.isFinite(view.progress);
    $("bar").hidden = !downloading;
    $("fill").style.width = downloading ? `${Math.round(view.progress * 100)}%` : "0";
    $("checked").textContent = `You have version ${view.current}. ${lastChecked(view.lastCheckAt)}`;
    $("action").textContent = view.button.label;
    action = view.button.action;
  }

  function paintSettings(settings) {
    if (!settings) return;
    $("automatic").checked = settings.automatic;
    $("checkOnLaunch").checked = settings.checkOnLaunch;
    $("intervalHours").value = String(settings.intervalHours);
    $("downloadInBackground").checked = settings.downloadInBackground;
    // Rather than greyed out, the two "when" choices are hidden while automatic checks are off.
    $("auto").hidden = !settings.automatic;
  }

  api.load().then((data) => {
    if (!data) return;
    const select = $("intervalHours");
    for (const choice of data.choices) {
      const option = document.createElement("option");
      option.value = String(choice.hours);
      option.textContent = choice.label;
      select.append(option);
    }
    paintSettings(data.settings);
    paintStatus(data.status);
  });
  api.onStatus(paintStatus);

  for (const id of ["automatic", "checkOnLaunch", "downloadInBackground"]) {
    $(id).addEventListener("change", (event) => api.save({ [id]: event.target.checked }).then(paintSettings));
  }
  $("intervalHours").addEventListener("change", (event) => api.save({ intervalHours: Number(event.target.value) }).then(paintSettings));
  $("action").addEventListener("click", () => {
    if (action === "check") api.checkNow();
    else if (action === "restart") api.restart();
  });
})();
