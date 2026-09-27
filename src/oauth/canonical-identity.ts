import type { D1Database } from "../linking/d1.js";
import { deriveStemlearnUserId } from "./identity.js";

// Resolves the stable, canonical MCP identity for a student, independent of
// which SUNLearn site they happen to authenticate through on any given day.
// See migrations/0004_canonical_identity.sql for the full rationale.

export type CanonicalIdentityResolution =
  | { ok: true; canonicalUserId: string }
  | { ok: false; reason: "identity_conflict" };

interface AliasRow {
  canonical_user_id: string;
}

async function lookupAlias(db: D1Database, normalizedBaseUrl: string, moodleUserId: number): Promise<string | null> {
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
