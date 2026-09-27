import { z } from "zod";
import type { D1Database } from "./d1.js";
import { DEFAULT_MAX_FILE_MB, DEFAULT_REQUEST_TIMEOUT_MS } from "../config.js";
import { MoodleClient } from "../moodle-client.js";
import { parseConnectionLink } from "./connection-link.js";
import { createLinkingSession, finalizeLinkingSession, loadActiveLinkingSession, LINKING_SESSION_TTL_MS } from "./session-store.js";
import { D1CredentialResolver, deleteCredential, saveCredential } from "./credential-store.js";
import { importCredentialKey } from "./credential-crypto.js";
import { md5 } from "./md5.js";
import { DEFAULT_USER_ID } from "./resolve-config.js";
import { buildMobileLaunchUrl, getSiteById, listEnabledSites, type SunlearnSite } from "../sunlearn-sites.js";

// User-facing linking endpoints. Every failure path here returns one of a
// fixed set of plain-language messages — never a Moodle error, never any
// part of the pasted link, never base64/hash/token terminology. See
// AGENTS.md's "never leak raw upstream error text" invariant, extended here
// to the linking flow's own inputs.

export interface LinkingEnv {
  DB: D1Database;
  CREDENTIAL_ENCRYPTION_KEY?: string;
}

export const LINK_ISNT_VALID = "This connection link isn't valid. Please copy the full link from SUNLearn.";
export const LINK_EXPIRED = "This connection link has expired. Start again to connect this SUNLearn site.";
export const COULD_NOT_VERIFY = "We couldn't verify your SUNLearn account. Please try signing in again.";
export const DIFFERENT_ATTEMPT = "This connection link was created for a different sign-in attempt. Start again.";
export const SOMETHING_WENT_WRONG = "Something went wrong. Please try again.";
export const UNKNOWN_SITE = "That SUNLearn environment isn't supported.";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fail(status: number, message: string): Response {
  return jsonResponse(status, { connected: false, error: message });
}

export type ConnectionLinkVerificationResult =
  | { ok: true; token: string; moodleUserId: number }
  | { ok: false; status: number; message: string };

/**
 * Shared by both the legacy and OAuth linking-completion handlers: parse the
 * pasted link, verify the Moodle passport correlation against this session's
 * OWN bound site (never a caller-supplied one — see session-store.ts), then
 * verify the token actually works against live Moodle (reusing the existing
 * Zod-validated site-info path — no new Moodle-calling code). Returns the
 * verified token AND the real Moodle numeric user id (needed to derive OAuth
 * identity), or a safe, generic failure to render.
 */
export async function verifyConnectionLink(
  passport: string,
  connectionLink: string,
  trustedBaseUrl: string,
): Promise<ConnectionLinkVerificationResult> {
  const parsedLink = parseConnectionLink(connectionLink);
  if (!parsedLink.ok) return { ok: false, status: 400, message: LINK_ISNT_VALID };

  // Moodle computes md5($CFG->wwwroot . $passport); wwwroot's trailing slash
  // is not guaranteed, so check both normalized forms (verified live). This
  // is what makes a link copied from the wrong SUNLearn site fail here
  // rather than silently linking the wrong instance.
  const expected = [trustedBaseUrl, `${trustedBaseUrl}/`].map((root) => md5(root + passport));
  if (!expected.includes(parsedLink.value.siteHash)) {
    return { ok: false, status: 400, message: DIFFERENT_ATTEMPT };
  }

  try {
    const client = await MoodleClient.create({
      baseUrl: trustedBaseUrl,
      maxFileBytes: DEFAULT_MAX_FILE_MB * 1024 * 1024,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      auth: { kind: "token", token: parsedLink.value.token },
    });
    return { ok: true, token: parsedLink.value.token, moodleUserId: client.userId };
  } catch {
    return { ok: false, status: 400, message: COULD_NOT_VERIFY };
  }
}

export const CompleteRequestSchema = z.object({
  sessionId: z.string().min(1).max(128),
  connectionLink: z.string().min(1).max(4096),
}).strict();

/** Every registry site paired with whether DEFAULT_USER_ID (the legacy single-user lane) has it connected. */
export async function loadLegacyConnectionStatus(env: LinkingEnv): Promise<Array<{ site: SunlearnSite; connected: boolean }>> {
  const resolver = new D1CredentialResolver(env.DB, () => importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY));
  const connected = new Set((await resolver.resolveAll(DEFAULT_USER_ID)).map((c) => c.baseUrl));
  return listEnabledSites().map((site) => ({ site, connected: connected.has(site.baseUrl) }));
}

export async function handleLinkStart(env: LinkingEnv, siteId: string): Promise<Response> {
  const site = getSiteById(siteId);
  if (!site || !site.enabled) return fail(400, UNKNOWN_SITE);

  try {
    const session = await createLinkingSession(env.DB, DEFAULT_USER_ID, site.baseUrl);
    return jsonResponse(200, {
      sessionId: session.sessionId,
      url: buildMobileLaunchUrl(site, session.passport),
      siteId: site.id,
      siteName: site.name,
      expiresInSeconds: Math.floor(LINKING_SESSION_TTL_MS / 1000),
    });
  } catch {
    return fail(500, SOMETHING_WENT_WRONG);
  }
}

export async function handleLinkComplete(request: Request, env: LinkingEnv): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return fail(400, LINK_ISNT_VALID);
  }
  const parsedBody = CompleteRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) return fail(400, LINK_ISNT_VALID);
  const { sessionId, connectionLink } = parsedBody.data;

  const session = await loadActiveLinkingSession(env.DB, sessionId);
  if (!session) return fail(400, LINK_EXPIRED);
  // Defense in depth: a session created by GET /authorize belongs to the
  // OAuth completion endpoint (src/oauth/routes.ts), never this one.
  if (session.oauthRequestJson) return fail(400, LINK_ISNT_VALID);
  // Every session created by handleLinkStart is site-bound; a NULL here
  // would only occur for a row that predates multi-site (migration leaves
  // old rows' moodle_base_url NULL) and has no safe site to verify against.
  if (!session.moodleBaseUrl) return fail(400, LINK_EXPIRED);
  const trustedBaseUrl = session.moodleBaseUrl;

  // A malformed paste or a transient Moodle hiccup leaves the session
  // untouched below, so the student can just try again without redoing SSO.
  const verified = await verifyConnectionLink(session.passport, connectionLink, trustedBaseUrl);
  if (!verified.ok) return fail(verified.status, verified.message);

  // Only the request that wins this atomic consume may persist a credential.
  // Legacy sessions always finalize under the same DEFAULT_USER_ID they were
  // created with — this write-back only matters for the OAuth flow, which
  // doesn't know its real userId until this point.
  const won = await finalizeLinkingSession(env.DB, sessionId, session.userId);
  if (!won) return fail(400, LINK_EXPIRED);

  try {
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, session.userId, trustedBaseUrl, verified.token);
  } catch {
    return fail(500, SOMETHING_WENT_WRONG);
  }

  return jsonResponse(200, { connected: true });
}

export async function handleLinkDisconnect(env: LinkingEnv, siteId: string): Promise<Response> {
  const site = getSiteById(siteId);
  if (!site) return fail(400, UNKNOWN_SITE);
  try {
    await deleteCredential(env.DB, DEFAULT_USER_ID, site.baseUrl);
    return jsonResponse(200, { disconnected: true });
  } catch {
    return fail(500, SOMETHING_WENT_WRONG);
  }
}
