import type { D1Database } from "../linking/d1.js";
import { deriveStemlearnUserId } from "./identity.js";
import { isPreviewAllowed, type PreviewAccessEnv } from "../preview-access.js";

// Resolves the stable, canonical MCP identity for a student, independent of
// which SUNLearn site they happen to authenticate through on any given day.
// See migrations/0004_canonical_identity.sql for the full rationale.

export type CanonicalIdentityResolution =
  | { ok: true; canonicalUserId: string }
  | { ok: false; reason: "identity_conflict" };

interface AliasRow {
  canonical_user_id: string;
}

/**
 * Read-only: what canonical identity a (site, Moodle user id) pair WOULD
 * resolve to, without writing anything — safe to call before a private-
 * preview access check, since (unlike resolveCanonicalUserId) it never mints
 * or persists a new alias for an identity that check might go on to reject.
 */
export async function lookupAlias(db: D1Database, normalizedBaseUrl: string, moodleUserId: number): Promise<string | null> {
  const row = await db
    .prepare("SELECT canonical_user_id FROM moodle_identity_aliases WHERE moodle_base_url = ? AND moodle_user_id = ?")
    .bind(normalizedBaseUrl, moodleUserId)
    .first<AliasRow>();
  return row?.canonical_user_id ?? null;
}

async function insertAlias(db: D1Database, normalizedBaseUrl: string, moodleUserId: number, canonicalUserId: string): Promise<void> {
  await db
    .prepare("INSERT INTO moodle_identity_aliases (moodle_base_url, moodle_user_id, canonical_user_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(normalizedBaseUrl, moodleUserId, canonicalUserId, Date.now())
    .run();
}

/**
 * Resolves the canonical MCP user id for a just-verified (site, Moodle user
 * id) pair, given the canonical identity already established earlier in the
 * SAME linking flow, if any (`sessionCanonicalUserId` — null for the very
 * first site linked in a fresh flow).
 *
 * Resolution order:
 *  1. An existing alias for this exact (site, Moodle user id) always wins —
 *     this is what makes re-authenticating through any previously-linked
 *     site resolve back to the same human, regardless of flow order. If the
 *     current flow already has a DIFFERENT established canonical identity,
 *     that's a genuine conflict (this Moodle account is already someone
 *     else's alias) and is rejected rather than silently merged.
 *  2. No alias yet, but this flow already has an established identity (an
 *     earlier site succeeded first) — attach this new (site, id) as another
 *     alias of that SAME identity. Never mints a new one.
 *  3. No alias, no identity yet this flow — this is the first time this
 *     Moodle account has ever been seen. Mint a canonical id with
 *     deriveStemlearnUserId, the SAME formula used before this table
 *     existed, so an already-linked production user's very next login
 *     reproduces their existing identity exactly (preserving their existing
 *     OAuth grants and credential rows) rather than minting a new one.
 */
export async function resolveCanonicalUserId(
  db: D1Database,
  normalizedBaseUrl: string,
  moodleUserId: number,
  sessionCanonicalUserId: string | null,
): Promise<CanonicalIdentityResolution> {
  const existingAlias = await lookupAlias(db, normalizedBaseUrl, moodleUserId);
  if (existingAlias) {
    if (sessionCanonicalUserId && existingAlias !== sessionCanonicalUserId) {
      return { ok: false, reason: "identity_conflict" };
    }
    return { ok: true, canonicalUserId: existingAlias };
  }

  if (sessionCanonicalUserId) {
    await insertAlias(db, normalizedBaseUrl, moodleUserId, sessionCanonicalUserId);
    return { ok: true, canonicalUserId: sessionCanonicalUserId };
  }

  const mintedId = await deriveStemlearnUserId(new URL(normalizedBaseUrl).host, moodleUserId);
  await insertAlias(db, normalizedBaseUrl, moodleUserId, mintedId);
  return { ok: true, canonicalUserId: mintedId };
}

/**
 * Read-only mirror of resolveCanonicalUserId's resolution order, WITHOUT the
 * insertAlias side effect on the "brand new identity" path — deriving what id
 * a (site, Moodle user id) pair WOULD resolve to is a pure hash
 * (deriveStemlearnUserId), so this never needs to write anything to compute
 * it. Used by the private-preview gate (src/preview-access.ts) in
 * oauth/routes.ts to check an identity BEFORE resolveCanonicalUserId would
 * otherwise mint and persist a new alias for it — a rejected new user must
 * never get a database row, not even this one.
 */
export async function prospectiveCanonicalUserId(
  db: D1Database,
  normalizedBaseUrl: string,
  moodleUserId: number,
  sessionCanonicalUserId: string | null,
): Promise<string> {
  const existingAlias = await lookupAlias(db, normalizedBaseUrl, moodleUserId);
  if (existingAlias) return existingAlias;
  if (sessionCanonicalUserId) return sessionCanonicalUserId;
  return deriveStemlearnUserId(new URL(normalizedBaseUrl).host, moodleUserId);
}

export type GatedCanonicalIdentityResolution =
  | { ok: true; canonicalUserId: string }
  | { ok: false; reason: "identity_conflict" }
  | { ok: false; reason: "preview_denied" };

/**
 * Composes prospectiveCanonicalUserId + the private-preview allowlist check +
 * resolveCanonicalUserId into the exact sequence oauth/routes.ts's
 * handleAuthorizeLink needs, as ONE function with no dependency on
 * @cloudflare/workers-oauth-provider — that package's real (non-type)
 * exports pull in a `cloudflare:workers` import that plain Vitest can't
 * resolve, which is why oauth/routes.ts itself can't be unit-tested directly
 * (see mcp-handler.test.ts's comment on the same constraint for
 * oauth/provider.ts). Extracting the actual access-control DECISION here
 * keeps it fully covered by ordinary unit tests even though the thin
 * HTTP-handler wiring around it isn't.
 */
export async function resolveCanonicalUserIdWithPreviewGate(
  db: D1Database,
  env: PreviewAccessEnv,
  normalizedBaseUrl: string,
  moodleUserId: number,
  sessionCanonicalUserId: string | null,
): Promise<GatedCanonicalIdentityResolution> {
  const prospectiveUserId = await prospectiveCanonicalUserId(db, normalizedBaseUrl, moodleUserId, sessionCanonicalUserId);
  if (!isPreviewAllowed(env, prospectiveUserId)) return { ok: false, reason: "preview_denied" };
  return resolveCanonicalUserId(db, normalizedBaseUrl, moodleUserId, sessionCanonicalUserId);
}
