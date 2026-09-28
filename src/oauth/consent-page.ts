import type { ConsentDescription } from "./describe-consent.js";
import { PAGE_SHELL_CSS, renderBrandHeader, renderLegalFooter } from "../page-shell.js";
import { PRODUCT_NAME } from "../brand.js";

// Plain-language permission categories for scopes we currently grant. No raw
// scope strings, no OAuth jargon, no tokens, no protocol internals — per the
// consent-page requirements. Extend this map if/when finer scopes are ever
// introduced; for V1 there is exactly one.
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "stemlearn:read": "View enrolled courses, course content and files, assignments, quizzes, grades, calendar and notifications",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

// Deliberately says "SUNLearn", never a specific site name: by the time a
// student reaches consent they may have linked any subset of the five
// registry sites (src/sunlearn-sites.ts) to this one identity — this screen
// grants access to the whole connected account, not just whichever site
// happened to be linked first.
export function renderConsentPage(details: ConsentDescription, handle: string, linkingSessionId: string): string {
  const name = escapeHtml(details.clientName);
  const origin = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  const permissionItems = details.scope
    .map((scope) => `<li>${escapeHtml(SCOPE_DESCRIPTIONS[scope] ?? scope)}</li>`)
    .join("");
  const scopeInputs = details.scope
    .map((scope) => `<input type="hidden" name="scope" value="${escapeHtml(scope)}">`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Connect SUNLearn: ${PRODUCT_NAME}</title>
<style>
${PAGE_SHELL_CSS}
  .card { padding: 28px 30px; margin-bottom: 24px; }
  ul { padding-left: 20px; margin: 10px 0; }
  li { margin: 4px 0; }
  .note { color: var(--muted-foreground); font-size: 0.85rem; }
  .warning { color: #b91c1c; font-weight: 600; background: #fef2f2; border: 1px solid var(--destructive-border); border-radius: var(--radius); padding: 10px 14px; }
  .consent-actions { margin-top: 18px; }
  .consent-actions button { margin-right: 10px; padding: 0 18px; height: 36px; }
</style>
</head>
<body>
  ${renderBrandHeader()}
  <div class="page">
  <div class="card">
    <h1>Connect SUNLearn</h1>
    <p><strong>${name}</strong> would like permission to access your SUNLearn information through this MCP.</p>
    <p class="note">${origin} For V1 this server is read-only.</p>
    <p>It would be able to:</p>
    <ul>${permissionItems}</ul>
    <p class="note">Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
    ${details.redirectIsLoopback ? '<p class="warning">This sends access to an app on your computer. Continue only if you just started signing in from it.</p>' : ""}
    <form method="post" action="/authorize/consent" class="consent-actions">
      <input type="hidden" name="handle" value="${escapeHtml(handle)}">
      <input type="hidden" name="sessionId" value="${escapeHtml(linkingSessionId)}">
      ${scopeInputs}
      <button type="submit" name="decision" value="approve">Allow</button>
      <button type="submit" name="decision" value="deny" class="btn-outline">Cancel</button>
    </form>
  </div>
  </div>
  ${renderLegalFooter()}
</body>
</html>
`;
}
