import type { D1Database } from "./d1.js";
import type { Config } from "../config.js";
import { configFromWorkerEnv, normalizeUrl, parseMaxFileMb, parseRequestTimeoutMs } from "../config.js";
import { D1CredentialResolver } from "./credential-store.js";
import { importCredentialKey } from "./credential-crypto.js";
import { getSiteByBaseUrl, type SunlearnSite } from "../sunlearn-sites.js";

/**
 * The single fixed identity behind the legacy, static-bearer lane of this
 * deployment. See AGENTS.md. NEVER used on the OAuth lane — a derived
 * `stemlearn-<hash>` id (src/oauth/identity.ts) is a disjoint namespace from
 * this constant by construction, so the two lanes can never be confused with
 * each other.
 */
export const DEFAULT_USER_ID = "default";

export interface MoodleResolverEnv {
  MOODLE_URL?: string;
  MOODLE_TOKEN?: string;
  MOODLE_MCP_MAX_FILE_MB?: string;
  MOODLE_MCP_REQUEST_TIMEOUT_MS?: string;
  DB: D1Database;
  CREDENTIAL_ENCRYPTION_KEY?: string;
}

/** Thrown by resolveMoodleConfigForOAuthUser when the authenticated OAuth user has no linked Moodle credential yet. */
export class AccountLinkRequiredError extends Error {
  constructor() {
    super("STEMLearn account linking is required before this MCP request can be completed.");
    this.name = "AccountLinkRequiredError";
  }
}

function buildConfig(env: MoodleResolverEnv, baseUrl: string, token: string): Config {
  return {
    baseUrl: normalizeUrl(baseUrl),
    maxFileBytes: Math.floor(parseMaxFileMb(env.MOODLE_MCP_MAX_FILE_MB) * 1024 * 1024),
    requestTimeoutMs: parseRequestTimeoutMs(env.MOODLE_MCP_REQUEST_TIMEOUT_MS),
    auth: { kind: "token", token },
  };
}

function resolver(env: MoodleResolverEnv): D1CredentialResolver {
  return new D1CredentialResolver(env.DB, () => importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY));
}

/**
 * Legacy lane only: resolve this user's anchor-site D1 credential if one
 * exists (the earliest SUNLearn site they linked — see
 * D1CredentialResolver.resolveAnchor), otherwise fall back to this
 * deployment's env-secret mode (unchanged, for backward compatibility with
 * the pre-linking single-user setup). Never call this for the OAuth lane —
 * use resolveMoodleConfigForOAuthUser instead, which never falls back.
 *
 * The resolved baseUrl always comes from the credential row's OWN site (via
 * the registry), never from a caller-supplied value — so a database edit can
 * never redirect a decrypted token to a different host. If a linked
 * credential exists but fails integrity/decryption checks, this throws
 * rather than silently falling back, since that could otherwise run
 * requests as the wrong Moodle identity.
 */
export async function resolveMoodleConfig(userId: string, env: MoodleResolverEnv): Promise<Config> {
  const anchor = await resolver(env).resolveAnchor(userId);
  if (anchor) return buildConfig(env, anchor.baseUrl, anchor.credential.token);
  return configFromWorkerEnv(env);
}

/**
 * OAuth lane only: resolve this user's anchor-site credential (the SUNLearn
 * site whose account established their identity). Throws
 * AccountLinkRequiredError when none exists — this MUST NOT be caught and
 * silently replaced with the env-secret token or DEFAULT_USER_ID's
 * credential; that would run an OAuth-authenticated student's request as
 * someone else's Moodle identity. A broken/tampered credential still fails
 * closed exactly like the legacy resolver.
 *
 * The anchor's own client is what every tool call is transported over by
 * default; course-scoped tools additionally dispatch to OTHER connected
 * sites via resolveMoodleConfigForSite/CourseRefResolver when the caller
 * passes a sealed multi-site reference (see src/course-ref-resolver.ts).
 */
export async function resolveMoodleConfigForOAuthUser(userId: string, env: MoodleResolverEnv): Promise<Config> {
  const anchor = await resolver(env).resolveAnchor(userId);
  if (!anchor) throw new AccountLinkRequiredError();
  return buildConfig(env, anchor.baseUrl, anchor.credential.token);
}

/**
 * OAuth lane only: resolve a Config for exactly one specific SUNLearn site
 * this user has linked, or null if they haven't connected that site (or
 * never linked anything at all). Used by CourseRefResolver to lazily build a
 * client for a non-anchor site named by a sealed course/assignment/quiz/
 * forum reference — never falls back to the env secret or DEFAULT_USER_ID.
 */
export async function resolveMoodleConfigForSite(userId: string, site: SunlearnSite, env: MoodleResolverEnv): Promise<Config | null> {
  const credential = await resolver(env).resolve(userId, site.baseUrl);
  if (!credential) return null;
  return buildConfig(env, site.baseUrl, credential.token);
}

/**
 * OAuth lane only: resolve a Config for EVERY SUNLearn site this user has
 * linked, each paired with its registry entry (for display name / ordering).
 * Used solely by the unified course-listing tool to fan out across all
 * connected instances — never falls back to the env secret or
 * DEFAULT_USER_ID, same rule as resolveMoodleConfigForOAuthUser. Returns an
 * empty array (not a throw) when nothing is linked yet; callers that require
 * at least one linked site should check for that themselves.
 */
export async function resolveAllMoodleConfigsForOAuthUser(
  userId: string,
  env: MoodleResolverEnv,
): Promise<Array<{ site: SunlearnSite; config: Config }>> {
  const all = await resolver(env).resolveAll(userId);
  const out: Array<{ site: SunlearnSite; config: Config }> = [];
  for (const { baseUrl, credential } of all) {
    const site = getSiteByBaseUrl(baseUrl);
    if (!site) continue; // defense in depth; resolveAll already allowlist-checks each row
    out.push({ site, config: buildConfig(env, baseUrl, credential.token) });
  }
  return out;
}
