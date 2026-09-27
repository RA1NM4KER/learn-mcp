// The real, shared "Connect your SUNLearn courses" page. Framework-free,
// server-rendered HTML. Every not-yet-connected site's step dialog is
// rendered once, up front, always closed — opening one is a pure
// client-side `showModal()` call from that site's own "Connect" button,
// never a script that runs on page load. That's deliberate: this page (and
// its dialogs) must never "pop up" just because the page was loaded or
// refreshed — only a genuine click opens anything. The one exception is a
// failed paste: re-showing that site's dialog with its error is a direct
// response to the user's own just-submitted form, not a bare page load.
//
// This is the SAME render function used by the live OAuth linking flow
// (src/oauth/routes.ts) — there is no separate mock/preview render path.
//
// Copy reflects what the real SUNLearn confirmation page actually does
// (verified live, across all five instances): it does NOT show the raw
// connection link as visible text. It renders a link labeled "Click here if
// the app does not open automatically" — clicking it attempts to open the
// Moodle mobile app, which does nothing useful here. The link's target URL
// must be copied instead, via right-click/long-press, never by clicking it.
// "No Moodle account on this instance" is deliberately never rendered as an
// error anywhere on this page — a student may legitimately have accounts on
// only one or two of the five environments; that's just a site that stays
// "Connect" instead of becoming "Connected".
//
// Light-mode only, by design: this is a general-public-facing page reached
// via an official-looking university-adjacent login flow, so it favors a
// plain, predictable, printable appearance over following the visiting
// device's dark-mode preference.

import { PAGE_SHELL_CSS, renderBrandHeader, renderLegalFooter } from "../page-shell.js";

export interface ConnectSiteStatus {
  id: string;
  name: string;
  connected: boolean;
}

/** One not-yet-connected site's precomputed step dialog — rendered closed; opened only by that site's own "Connect" button. */
export interface SitePanel {
  siteId: string;
  siteName: string;
  launchUrl: string;
  formAction: string;
}

export interface RenderConnectPageOptions {
  sites: ConnectSiteStatus[];
  /** The pending linking-session id, submitted by every form on this page. */
  sessionId: string;
  /** One entry per not-yet-connected site — every dialog is in the page from the start, closed, ready to open on click with zero network round trip. */
  panels: SitePanel[];
  /** A paste attempt for this site just failed — its dialog reopens showing errorMessage, as the direct response to that submit (not a page load). */
  autoOpenSiteId?: string;
  errorMessage?: string;
  /** Shows a "Continue" button once at least one site is connected — oauth mode only. */
  continueAction?: { formAction: string; sessionId: string };
  /**
   * Shows a small "Disconnect" action on every connected site's tile,
   * posting to this action. Only set once a real (non-placeholder) identity
   * is known for this session — disconnecting is meaningless before that,
   * since there's no known account yet to disconnect anything from.
   */
  disconnectFormAction?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

// Light pastel background/foreground pairs for each site's avatar initials.
// A fixed map (not a hash) so colors stay stable and visually distinct as
// sites are added/reordered in sunlearn-sites.ts; DEFAULT_AVATAR_COLOR covers
// any site id not yet listed here.
const DEFAULT_AVATAR_COLOR = { bg: "#f4f4f5", fg: "#3f3f46" };
const AVATAR_COLORS: Record<string, { bg: string; fg: string }> = {
  sunlearn: { bg: "#dbeafe", fg: "#1d4ed8" },
  stemlearn: { bg: "#fce7f3", fg: "#9d174d" },
  emslearn: { bg: "#dcfce7", fg: "#15803d" },
  socscilearn: { bg: "#fef3c7", fg: "#a16207" },
  fmhslearn: { bg: "#ede9fe", fg: "#6d28d9" },
};

function avatarColorFor(siteId: string): { bg: string; fg: string } {
  return AVATAR_COLORS[siteId] ?? DEFAULT_AVATAR_COLOR;
}

function siteRow(site: ConnectSiteStatus, sessionId: string, disconnectFormAction?: string): string {
  const name = escapeHtml(site.name);
  const initials = escapeHtml(site.name.slice(0, 2).toUpperCase());
  const { bg, fg } = avatarColorFor(site.id);
  const left = `<div class="site-row-left"><span class="site-avatar" style="background:${bg};color:${fg}">${initials}</span><span class="site-name">${name}</span></div>`;

  let right: string;
  if (site.connected) {
    const disconnect = disconnectFormAction
      ? `<form method="post" action="${escapeHtml(disconnectFormAction)}" class="disconnect-form">
          <input type="hidden" name="sessionId" value="${escapeHtml(sessionId)}">
          <input type="hidden" name="siteId" value="${escapeHtml(site.id)}">
          <button type="submit" class="btn btn-ghost btn-sm">Disconnect</button>
        </form>`
      : "";
    right = `<div class="site-row-right"><span class="badge badge-success">Connected</span>${disconnect}</div>`;
  } else {
    // Pure client-side reveal of that site's own already-rendered (closed) dialog —
    // no form submission, no navigation, no network round trip.
    right = `<div class="site-row-right"><button type="button" class="btn btn-default btn-sm" onclick="document.getElementById('panel-${escapeHtml(site.id)}').showModal()">Connect</button></div>`;
  }
  return `<div class="site-row">${left}${right}</div>`;
}

function sitePanel(panel: SitePanel, sessionId: string, isAutoOpen: boolean, errorMessage: string | undefined): string {
  const openAttr = isAutoOpen ? " open" : "";
  const backdropCloseAttr = ' onclick="if(event.target===this)this.close()"';
  const closeButton = `<button type="button" class="dialog-close" aria-label="Close" onclick="this.closest('dialog').close()">&times;</button>`;

  return `<dialog class="step-dialog" id="panel-${escapeHtml(panel.siteId)}"${openAttr}${backdropCloseAttr}>
    ${closeButton}
    <h2>Connect ${escapeHtml(panel.siteName)}</h2>
    ${isAutoOpen && errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : ""}
    <p><strong>Step 1.</strong> Sign in through the official Stellenbosch University login page. We never see your password.</p>
    <a class="button-link" href="${escapeHtml(panel.launchUrl)}" target="_blank" rel="noopener"><button type="button">Open ${escapeHtml(panel.siteName)}</button></a>

    <p class="step-heading">Step 2. Copy your connection link</p>
    <div class="warning-callout">
      <p>Moodle's confirmation page shows a line that says <strong>&ldquo;Click here if the app does not open automatically.&rdquo;</strong> Clicking it just tries to open an app and won't work here.</p>
      <div class="warning-title">🚫 Don't click the link on that page</div>
      <p class="warning-action">Instead: <strong>right-click that text</strong> (press and hold on mobile) and choose <strong>&ldquo;Copy Link Address&rdquo;</strong>.</p>
      <div class="demo-video-frame"><video class="demo-video" src="/copy-link-demo.mp4" muted autoplay loop playsinline></video></div>
      <p class="demo-caption">Watch: the correct way to copy the link, shown above.</p>
    </div>

    <p class="step-heading">Step 3. Paste it below</p>
    <form method="post" action="${escapeHtml(panel.formAction)}">
      <input type="hidden" name="sessionId" value="${escapeHtml(sessionId)}">
      <input type="hidden" name="siteId" value="${escapeHtml(panel.siteId)}">
      <textarea name="connectionLink" placeholder="Paste your connection link"></textarea>
      <div class="form-actions"><button type="submit">Connect ${escapeHtml(panel.siteName)}</button></div>
    </form>

    <p class="muted">If you don't have an account on this environment, that's fine — just come back and connect the ones you use.</p>
  </dialog>`;
}

export function renderSunlearnConnectPage(options: RenderConnectPageOptions): string {
  const siteListHtml = options.sites
    .map((site) => siteRow(site, options.sessionId, options.disconnectFormAction))
    .join("\n");

  const panelsHtml = options.panels
    .map((panel) => sitePanel(panel, options.sessionId, panel.siteId === options.autoOpenSiteId, options.errorMessage))
    .join("\n");
  // Only ever opens a dialog in direct response to the user's own just-submitted
  // paste (a failed attempt re-showing its error) — never unconditionally on load.
  const autoOpenScript = options.autoOpenSiteId
    ? `<script>document.getElementById("panel-${options.autoOpenSiteId}").showModal();</script>`
    : "";

  const continuePanel = options.continueAction
    ? `<form method="post" action="${escapeHtml(options.continueAction.formAction)}" class="continue-form">
    <input type="hidden" name="sessionId" value="${escapeHtml(options.continueAction.sessionId)}">
    <button type="submit">Continue</button>
  </form>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Connect your SUNLearn courses — SUNLearn MCP</title>
<style>
${PAGE_SHELL_CSS}
  .sites-list { padding: 4px 0; margin: 0 0 24px; }
  .site-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--border); }
  .site-row:last-child { border-bottom: none; }
  .site-row-left { display: flex; align-items: center; gap: 12px; }
  .site-avatar {
    width: 32px; height: 32px; border-radius: var(--radius); color: var(--secondary-foreground); background: var(--secondary);
    display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.72rem; flex-shrink: 0; letter-spacing: -0.01em;
  }
  .site-name { font-weight: 500; font-size: 0.875rem; color: var(--foreground); }
  .site-row-right { display: flex; align-items: center; gap: 10px; }
  a.button-link { display: inline-block; text-decoration: none; }
  .disconnect-form { display: inline-flex; }
  .continue-form { margin-top: 4px; }
  .form-actions { margin-top: 14px; }

  /* Dialog */
  .step-dialog {
    border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px 26px; max-width: 460px; width: calc(100% - 40px);
    box-shadow: var(--shadow-md), 0 20px 44px rgb(0 0 0 / 0.14); position: relative; color: var(--muted-foreground);
    animation: dialog-in 0.16s ease-out; background: var(--card);
  }
  .step-dialog::backdrop { background: rgb(0 0 0 / 0.5); animation: backdrop-in 0.16s ease-out; }
  @keyframes dialog-in { from { opacity: 0; transform: scale(0.97) translateY(6px); } to { opacity: 1; transform: scale(1) translateY(0); } }
  @keyframes backdrop-in { from { opacity: 0; } to { opacity: 1; } }
  .dialog-close {
    position: absolute; top: 14px; right: 14px; width: 28px; height: 28px; padding: 0; border-radius: var(--radius);
    background: transparent; color: var(--muted-foreground); font-size: 1.2rem; line-height: 1; font-weight: 400; border: none;
  }
  .dialog-close:hover { background: var(--muted); color: var(--foreground); }
  .step-heading { font-weight: 600; color: var(--foreground); margin: 22px 0 8px; font-size: 0.875rem; }
  .step-dialog p { color: var(--muted-foreground); }
  .step-dialog p strong { color: var(--foreground); }

  /* Alert (destructive variant) */
  .warning-callout {
    background: #fef2f2; border: 1px solid var(--destructive-border); border-radius: var(--radius); padding: 16px 18px; margin: 10px 0 20px;
  }
  .warning-title { font-size: 0.95rem; font-weight: 600; color: #b91c1c; margin-bottom: 6px; }
  .warning-callout p { margin: 6px 0; font-size: 0.85rem; color: #7f1d1d; }
  .warning-action { font-size: 0.875rem !important; font-weight: 600; color: #b91c1c !important; }
  .demo-video-frame {
    width: 100%; aspect-ratio: 16 / 9; border-radius: var(--radius); margin-top: 12px; overflow: hidden;
    box-shadow: var(--shadow-sm); position: relative;
  }
  .demo-video {
    position: absolute; width: 145%; height: 145%; top: 50%; left: 38%;
    transform: translate(-38%, -52%); display: block;
  }
  .demo-caption { font-size: 0.75rem !important; color: #9f6c6c !important; margin: 8px 0 0 !important; }

  /* Input */
  textarea {
    width: 100%; padding: 10px 12px; border-radius: var(--radius); border: 1px solid var(--border);
    font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.8125rem; min-height: 76px;
    background: var(--background); color: var(--foreground);
  }
  textarea:focus { outline: 2px solid var(--ring); outline-offset: 1px; }
</style>
</head>
<body>
  ${renderBrandHeader()}
  <div class="page">
  <h1>Connect your SUNLearn courses</h1>
  <p class="intro">Stellenbosch courses are hosted across several SUNLearn environments. Connect the ones you use so your assistant can see your courses in one place.</p>
  ${options.errorMessage && !options.autoOpenSiteId ? `<p class="error">${escapeHtml(options.errorMessage)}</p>` : ""}

  <div class="card sites-list">
    ${siteListHtml}
  </div>

  ${panelsHtml}
  ${autoOpenScript}
  ${continuePanel}

  <p class="muted">Login happens on official Stellenbosch/Microsoft pages. We never receive your university password.</p>
  </div>
  ${renderLegalFooter()}
</body>
</html>
`;
}
