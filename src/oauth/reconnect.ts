import type { Env } from "./env.js";
import { lookupAlias } from "./canonical-identity.js";
import { createLinkingSession, loadActiveLinkingSession, finalizeLinkingSession } from "../linking/session-store.js";
import { verifyConnectionLink, LINK_EXPIRED } from "../linking/routes.js";
import { saveCredential } from "../linking/credential-store.js";
import { importCredentialKey } from "../linking/credential-crypto.js";
import { buildMobileLaunchUrl, getSiteById, getSiteByBaseUrl, type SunlearnSite } from "../sunlearn-sites.js";
import { renderSunlearnConnectPage } from "../linking/sunlearn-connect-page.js";
import { PAGE_SHELL_CSS, renderBrandHeader } from "../page-shell.js";

// No credential/identity in the recovery URL. The fresh, site-bound Moodle
// proof determines the existing account; this route cannot grant OAuth access.
const RECOVERY_SESSION_USER = "recovery-pending";
function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
function page(site: SunlearnSite, sessionId: string, passport: string, errorMessage?: string): Response {
  return html(renderSunlearnConnectPage({
    sites: [{ id: site.id, name: site.name, connected: true }], sessionId,
    panels: [{ siteId: site.id, siteName: site.name, launchUrl: buildMobileLaunchUrl(site, passport), formAction: "/reconnect/link" }],
    ...(errorMessage ? { errorMessage, autoOpenSiteId: site.id } : {}),
  }));
}
export async function handleReconnect(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const site = getSiteById(new URL(request.url).searchParams.get("site") ?? "");
    if (!site?.enabled) return html("Choose a SUNLearn environment from your assistant's reconnect link.", 400);
    const session = await createLinkingSession(env.DB, RECOVERY_SESSION_USER, site.baseUrl);
    return page(site, session.sessionId, session.passport);
  }
  const form = await request.formData().catch(() => null);
  const sessionId = String(form?.get("sessionId") ?? "");
  const session = await loadActiveLinkingSession(env.DB, sessionId);
  if (!session || session.userId !== RECOVERY_SESSION_USER || session.oauthRequestJson || !session.moodleBaseUrl) return html(LINK_EXPIRED, 400);
  const site = getSiteByBaseUrl(session.moodleBaseUrl);
  if (!site?.enabled) return html(LINK_EXPIRED, 400);
  const verified = await verifyConnectionLink(session.passport, String(form?.get("connectionLink") ?? ""), site.baseUrl);
  if (!verified.ok) return page(site, sessionId, session.passport, verified.message);
  const userId = await lookupAlias(env.DB, site.baseUrl, verified.moodleUserId);
  if (!userId) return page(site, sessionId, session.passport, "This SUNLearn account has not been linked yet. Connect the app through your assistant's settings first.");
  if (!(await finalizeLinkingSession(env.DB, sessionId, userId))) return html(LINK_EXPIRED, 400);
  try {
    await saveCredential(env.DB, await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY), userId, site.baseUrl, verified.token);
  } catch { return html("Could not save your connection. Please start again.", 500); }
  return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connection restored</title><style>${PAGE_SHELL_CSS}</style>${renderBrandHeader()}<main class="page"><h1>Your ${site.name} connection is restored</h1><p>Return to your chat and ask the assistant to try again. Your other connections and data are kept.</p></main></html>`);
}
