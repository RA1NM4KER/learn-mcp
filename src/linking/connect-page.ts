// Static, framework-free developer-testing page for the legacy, bearer-key
// gated linking lane (DEFAULT_USER_ID — see AGENTS.md). This is NOT the
// student-facing SUNLearn connect experience; that's the real OAuth flow
// (src/oauth/routes.ts, src/linking/sunlearn-connect-page.ts). This page
// exists only so this deployment's single developer can exercise real
// multi-site linking against all five registry sites without going through
// a full OAuth client. The "developer access" key holds its value in memory
// only (never localStorage, never rendered back to the screen, never put in
// a URL) and can be deleted in one place once this lane is retired.

import { listEnabledSites } from "../sunlearn-sites.js";

const SITE_IDS = listEnabledSites().map((site) => site.id);

export const CONNECT_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect SUNLearn (developer)</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 560px; margin: 40px auto; padding: 0 20px; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  .step { border: 1px solid #ccc4; border-radius: 10px; padding: 16px 20px; margin-bottom: 16px; }
  .step h2 { font-size: 1.05rem; margin: 0 0 8px; }
  .step p { margin: 0 0 12px; color: #666; }
  button { font-size: 1rem; padding: 10px 18px; border-radius: 8px; border: none; background: #6b2140; color: white; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.secondary { background: transparent; color: #6b2140; border: 1px solid #6b2140; }
  select, textarea, input[type=password] { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid #ccc4; font-family: monospace; font-size: 0.9rem; }
  textarea { min-height: 70px; }
  .error { color: #b3261e; margin-top: 8px; }
  .success { color: #1e7b34; font-weight: 600; }
  details { margin-top: 20px; font-size: 0.9rem; color: #666; }
  .hidden { display: none; }
  ul.sites { list-style: none; padding: 0; }
  ul.sites li { display: flex; justify-content: space-between; padding: 6px 0; }
</style>
</head>
<body>
  <h1>Connect SUNLearn (developer)</h1>
  <p>This page is private, single-user developer testing for this deployment, not the real student sign-in
  flow (that's part of the OAuth /authorize flow).</p>

  <div class="step">
    <h2>Developer access key</h2>
    <input type="password" id="dev-key" placeholder="Access key" autocomplete="off">
    <div style="margin-top: 8px;"><button class="secondary" id="set-dev-key">Set access key</button></div>
    <div class="success hidden" id="dev-key-status"></div>
  </div>

  <div class="step">
    <h2>Sites</h2>
    <ul class="sites" id="site-list"></ul>
  </div>

  <div class="step hidden" id="step-signin">
    <h2>Sign in</h2>
    <p>Sign in through the official Stellenbosch University login page. We never see your password.</p>
    <button id="open-site">Open site</button>
    <div class="error hidden" id="start-error"></div>
  </div>

  <div class="step hidden" id="step-paste">
    <h2>Paste your connection link</h2>
    <p>Right-click "Click here if the app does not open automatically" on the confirmation page and choose
    <strong>Copy Link Address</strong>, then paste it below. Don't click that text.</p>
    <textarea id="connection-link" placeholder="Paste your connection link"></textarea>
    <div style="margin-top: 10px;">
      <button id="connect-button">Connect</button>
    </div>
    <div class="error hidden" id="complete-error"></div>
    <div class="success hidden" id="complete-success">Connected.</div>
  </div>

<script>
(function () {
  // Memory-only, by design: never localStorage, never re-displayed, never in a URL.
  let devAccessKey = "";
  let sessionId = null;
  let activeUrl = null;
  const SITES = ${JSON.stringify([...SITE_IDS])};

  const $ = (id) => document.getElementById(id);
  function show(id) { $(id).classList.remove("hidden"); }
  function hide(id) { $(id).classList.add("hidden"); }
  function showError(id, message) { $(id).textContent = message; show(id); }

  function renderSites() {
    const list = $("site-list");
    list.innerHTML = "";
    for (const siteId of SITES) {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = siteId;
      const btn = document.createElement("button");
      btn.className = "secondary";
      btn.textContent = "Connect";
      btn.addEventListener("click", () => startSite(siteId));
      li.appendChild(label);
      li.appendChild(btn);
      list.appendChild(li);
    }
  }
  renderSites();

  $("set-dev-key").addEventListener("click", () => {
    devAccessKey = $("dev-key").value;
    $("dev-key").value = "";
    const status = $("dev-key-status");
    status.textContent = devAccessKey ? "Access key set for this session." : "Access key cleared.";
    show("dev-key-status");
  });

  async function startSite(siteId) {
    hide("start-error");
    if (!devAccessKey) {
      showError("start-error", "Enter the developer access key first.");
      return;
    }
    try {
      const res = await fetch("/auth/stemlearn/start", {
        method: "POST",
        headers: { Authorization: "Bearer " + devAccessKey, "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      });
      if (!res.ok) {
        showError("start-error", "Something went wrong. Please try again.");
        return;
      }
      const data = await res.json();
      sessionId = data.sessionId;
      activeUrl = data.url;
      window.open(activeUrl, "_blank", "noopener");
      show("step-signin");
      show("step-paste");
    } catch {
      showError("start-error", "Something went wrong. Please try again.");
    }
  }

  $("open-site").addEventListener("click", () => {
    if (activeUrl) window.open(activeUrl, "_blank", "noopener");
  });

  $("connect-button").addEventListener("click", async () => {
    hide("complete-error");
    hide("complete-success");
    const connectionLink = $("connection-link").value.trim();
    if (!connectionLink || !sessionId) {
      showError("complete-error", "Paste your connection link first.");
      return;
    }
    try {
      const res = await fetch("/auth/stemlearn/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, connectionLink }),
      });
      const data = await res.json();
      if (!res.ok || !data.connected) {
        showError("complete-error", data.error || "Something went wrong. Please try again.");
        return;
      }
      $("connection-link").value = "";
      show("complete-success");
    } catch {
      showError("complete-error", "Something went wrong. Please try again.");
    }
  });
})();
</script>
</body>
</html>
`;
