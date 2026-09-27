import { AuthorizationError, type AuthRequest } from "@cloudflare/workers-oauth-provider";
import { oauthHelpers, type Env } from "./env.js";
import {
  createLinkingSession,
  finalizeLinkingSession,
  loadActiveLinkingSession,
  loadLinkingSessionUserId,
  setLinkingSessionUserId,
} from "../linking/session-store.js";
import { verifyConnectionLink, LINK_EXPIRED, SOMETHING_WENT_WRONG, UNKNOWN_SITE } from "../linking/routes.js";
import { D1CredentialResolver, deleteCredential, saveCredential } from "../linking/credential-store.js";
import { importCredentialKey } from "../linking/credential-crypto.js";
import { resolveCanonicalUserId } from "./canonical-identity.js";
import { describeConsent } from "./describe-consent.js";
import { renderSunlearnConnectPage, type ConnectSiteStatus, type SitePanel } from "../linking/sunlearn-connect-page.js";
import { renderConsentPage } from "./consent-page.js";
import { buildMobileLaunchUrl, getSiteById, listEnabledSites } from "../sunlearn-sites.js";

// GET /authorize, POST /authorize/link, POST /authorize/continue,
// POST /authorize/consent — the OAuth authentication+consent flow.
// Connecting one or more SUNLearn sites (the long external detour through
// Microsoft/SU login) IS how a student authenticates here; consent is a
// short same-session round trip handled by the library's own
// beginConsent/approveConsent/denyConsent afterward.
//
// A single pending session (src/linking/session-store.ts) carries the
// validated AuthRequest across the whole flow. Every not-yet-connected
// site's step dialog is precomputed up front from that one session's
// passport (see panelsForSession) and rendered closed — there is no
// separate "choose a site" server round trip; a student opens whichever
// site's dialog they want with a pure client-side showModal() click. The
// FIRST site a student successfully links establishes their permanent
// identity (the "anchor" — see resolve-config.ts's resolveAnchor); every
// additional site linked in the same flow is just another credential row
// saved under that same identity. The session is only actually consumed
// (single-use) at POST /authorize/continue, not at each individual site
// link — that's what lets a student link several sites before proceeding to
// consent.

// Never a real derivable identity — real ones are always "stemlearn-<hash>".
// Only a placeholder for the row's user_id column until the first site link
// succeeds and setLinkingSessionUserId writes the real derived id.
const OAUTH_SESSION_PLACEHOLDER_USER = "oauth-pending";

function htmlResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function plainTextResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Builds the standard OAuth error redirect (error, error_description, state, iss) for a validated redirect URI. */
function authorizationErrorRedirectUrl(error: AuthorizationError): string {
  const url = new URL(error.redirectUri!);
  url.searchParams.set("error", error.code);
  url.searchParams.set("error_description", error.description);
  if (error.state) url.searchParams.set("state", error.state);
  if (error.issuer) url.searchParams.set("iss", error.issuer);
  return url.toString();
}

/** Per the library's documented rule: redirect only when redirectUri was validated; otherwise render locally, never redirect. */
function renderAuthorizationError(error: AuthorizationError): Response {
  if (error.redirectUri) return Response.redirect(authorizationErrorRedirectUrl(error), 302);
  return plainTextResponse(400, error.description);
}

async function connectedSiteIds(env: Env, userId: string): Promise<Set<string>> {
  if (userId === OAUTH_SESSION_PLACEHOLDER_USER) return new Set();
  const resolver = new D1CredentialResolver(env.DB, () => importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY));
  const baseUrls = new Set((await resolver.resolveAll(userId)).map((c) => c.baseUrl));
  return new Set(listEnabledSites().filter((s) => baseUrls.has(s.baseUrl)).map((s) => s.id));
}

async function siteStatuses(env: Env, userId: string): Promise<ConnectSiteStatus[]> {
  const connected = await connectedSiteIds(env, userId);
  return listEnabledSites().map((s) => ({ id: s.id, name: s.name, connected: connected.has(s.id) }));
}

/** One precomputed, closed-by-default dialog per not-yet-connected site, all sharing this session's one passport. */
function panelsForSession(sites: ConnectSiteStatus[], passport: string): SitePanel[] {
  return sites
    .filter((s) => !s.connected)
    .map((s) => {
      const site = getSiteById(s.id)!;
      return { siteId: site.id, siteName: site.name, launchUrl: buildMobileLaunchUrl(site, passport), formAction: "/authorize/link" };
    });
}

export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauth = oauthHelpers(env);
  let authRequest: AuthRequest;
  try {
    authRequest = await oauth.parseAuthRequest(request);
  } catch (err) {
    if (err instanceof AuthorizationError) return renderAuthorizationError(err);
    throw err;
  }

  const session = await createLinkingSession(env.DB, OAUTH_SESSION_PLACEHOLDER_USER, null, JSON.stringify(authRequest));
  const sites = await siteStatuses(env, OAUTH_SESSION_PLACEHOLDER_USER);
  const panels = panelsForSession(sites, session.passport);
  return htmlResponse(200, renderSunlearnConnectPage({ sites, sessionId: session.sessionId, panels }));
}

async function renderConnectPageForSession(
  env: Env,
  userId: string,
  sessionId: string,
  passport: string,
  errorMessage?: string,
  autoOpenSiteId?: string,
): Promise<Response> {
  const sites = await siteStatuses(env, userId);
  const panels = panelsForSession(sites, passport);
  const canManage = userId !== OAUTH_SESSION_PLACEHOLDER_USER;
  return htmlResponse(
    errorMessage ? 400 : 200,
    renderSunlearnConnectPage({
      sites,
      sessionId,
      panels,
      ...(autoOpenSiteId ? { autoOpenSiteId } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      ...(canManage ? { continueAction: { formAction: "/authorize/continue", sessionId } } : {}),
      // Disconnecting only makes sense once we actually know who "you" are —
      // before that (still the placeholder identity), there's nothing to
      // disconnect anything from yet.
      ...(canManage ? { disconnectFormAction: "/authorize/disconnect" } : {}),
    }),
  );
}

/** POST /authorize/disconnect — remove one connected site's credential, once a real identity is known this flow. */
export async function handleAuthorizeDisconnect(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const sessionId = form ? String(form.get("sessionId") ?? "") : "";
  const siteId = form ? String(form.get("siteId") ?? "") : "";
  if (!sessionId) return plainTextResponse(400, "Invalid request.");

  const session = await loadActiveLinkingSession(env.DB, sessionId);
  if (!session || !session.oauthRequestJson) return plainTextResponse(400, LINK_EXPIRED);
  if (session.userId === OAUTH_SESSION_PLACEHOLDER_USER) {
    return await renderConnectPageForSession(
      env,
      session.userId,
      sessionId,
      session.passport,
      "Connect at least one SUNLearn environment first.",
    );
  }

  const site = getSiteById(siteId);
  if (!site) return await renderConnectPageForSession(env, session.userId, sessionId, session.passport, UNKNOWN_SITE);

  await deleteCredential(env.DB, session.userId, site.baseUrl);
  return await renderConnectPageForSession(env, session.userId, sessionId, session.passport);
}

/** POST /authorize/link — the pasted connection link, tagged with which site's panel it came from. */
export async function handleAuthorizeLink(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const sessionId = form ? String(form.get("sessionId") ?? "") : "";
  const siteId = form ? String(form.get("siteId") ?? "") : "";
  const connectionLink = form ? String(form.get("connectionLink") ?? "") : "";
  if (!sessionId) return plainTextResponse(400, "Invalid request.");

  const session = await loadActiveLinkingSession(env.DB, sessionId);
  if (!session || !session.oauthRequestJson) return plainTextResponse(400, LINK_EXPIRED);

  const site = getSiteById(siteId);
  if (!site || !site.enabled) {
    return await renderConnectPageForSession(env, session.userId, sessionId, session.passport, UNKNOWN_SITE);
  }
  const trustedBaseUrl = site.baseUrl;

  const verified = await verifyConnectionLink(session.passport, connectionLink, trustedBaseUrl);
  if (!verified.ok) {
    // Session survives a bad attempt (see verifyConnectionLink) — re-render
    // with only this one site's dialog reopened, same session, so the
    // student can retry the paste without redoing university login.
    return await renderConnectPageForSession(env, session.userId, sessionId, session.passport, verified.message, site.id);
  }

  const priorCanonicalUserId = session.userId === OAUTH_SESSION_PLACEHOLDER_USER ? null : session.userId;
  const resolution = await resolveCanonicalUserId(env.DB, trustedBaseUrl, verified.moodleUserId, priorCanonicalUserId);
  if (!resolution.ok) {
    return await renderConnectPageForSession(
      env,
      session.userId,
      sessionId,
      session.passport,
      "This SUNLearn account is already connected to a different session. Please start again.",
    );
  }
  const userId = resolution.canonicalUserId;

  if (priorCanonicalUserId === null) {
    const bound = await setLinkingSessionUserId(env.DB, sessionId, userId);
    if (!bound) return plainTextResponse(400, LINK_EXPIRED);
  }

  try {
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, userId, trustedBaseUrl, verified.token);
  } catch {
    return plainTextResponse(500, SOMETHING_WENT_WRONG);
  }

  return await renderConnectPageForSession(env, userId, sessionId, session.passport);
}

/** POST /authorize/continue — proceed from linking to consent, once at least one site is connected. */
export async function handleAuthorizeContinue(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const sessionId = form ? String(form.get("sessionId") ?? "") : "";
  if (!sessionId) return plainTextResponse(400, "Invalid request.");

  const session = await loadActiveLinkingSession(env.DB, sessionId);
  if (!session || !session.oauthRequestJson) return plainTextResponse(400, LINK_EXPIRED);
  if (session.userId === OAUTH_SESSION_PLACEHOLDER_USER) {
    return await renderConnectPageForSession(
      env,
      session.userId,
      sessionId,
      session.passport,
      "Connect at least one SUNLearn environment first.",
    );
  }

  // Only the request that wins this atomic consume may proceed to consent.
  const won = await finalizeLinkingSession(env.DB, sessionId, session.userId);
  if (!won) return plainTextResponse(400, LINK_EXPIRED);

  const authRequest = JSON.parse(session.oauthRequestJson) as AuthRequest;
  const oauth = oauthHelpers(env);
  const details = await describeConsent(oauth, authRequest);
  const consent = await oauth.beginConsent(authRequest);
  const headers = new Headers(consent.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  // Carries the opaque, unguessable (256-bit) session id — NEVER the derived
  // userId itself, which embeds Moodle's small sequential numeric user id
  // and would otherwise let a tampered form field claim someone else's
  // identity. See loadLinkingSessionUserId's doc comment.
  return new Response(renderConsentPage(details, consent.handle, sessionId), { status: 200, headers });
}

export async function handleConsentSubmit(request: Request, env: Env): Promise<Response> {
  const oauth = oauthHelpers(env);
  const form = await request.formData().catch(() => null);
  if (!form) return plainTextResponse(400, "Invalid request.");
  const handle = String(form.get("handle") ?? "");
  const linkingSessionId = String(form.get("sessionId") ?? "");
  const decision = String(form.get("decision") ?? "");
  if (!handle || !linkingSessionId) return plainTextResponse(400, "Invalid request.");

  try {
    if (decision !== "approve") {
      const denied = await oauth.denyConsent(request, handle);
      const headers = new Headers(denied.headers);
      headers.set("Location", denied.redirectTo);
      return new Response(null, { status: 302, headers });
    }

    const userId = await loadLinkingSessionUserId(env.DB, linkingSessionId);
    if (!userId || userId === OAUTH_SESSION_PLACEHOLDER_USER) return plainTextResponse(400, LINK_EXPIRED);

    const scope = form.getAll("scope").map(String);
    const approved = await oauth.approveConsent(request, handle, { scope });
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId,
      metadata: {},
      scope: approved.request.scope,
      props: { userId },
    });
    const headers = new Headers(approved.headers);
    headers.set("Location", redirectTo);
    return new Response(null, { status: 302, headers });
  } catch (err) {
    if (err instanceof AuthorizationError) return plainTextResponse(400, err.description);
    throw err;
  }
}
