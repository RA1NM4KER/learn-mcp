import type { D1Database } from "./d1.js";
import type { MoodleCredential, MoodleCredentialResolver } from "./types.js";
import { decryptCredential, encryptCredential } from "./credential-crypto.js";
import { assertAllowedMoodleBaseUrl } from "./moodle-host-allowlist.js";

// Persists one encrypted Moodle credential per (user, SUNLearn site) pair —
// zero to five rows per user, keyed by (user_id, moodle_base_url) rather than
// user_id alone, so a student can link any subset of the registry
// (src/sunlearn-sites.ts) without one site's credential overwriting another's.
// Every stored moodle_base_url is re-validated against the host allowlist and
// used only to reconstruct the AES-GCM AAD the row was encrypted with — it is
// never trusted as the destination for the decrypted token (see
// resolve-config.ts).

interface CredentialRow {
  moodle_base_url: string;
  encrypted_token: string;
}

interface CredentialRowWithCreatedAt extends CredentialRow {
  created_at: number;
}

export class D1CredentialResolver implements MoodleCredentialResolver {
  /**
   * `getKey` is only invoked once at least one row is actually found — a
   * misconfigured CREDENTIAL_ENCRYPTION_KEY must not block the env-secret
   * fallback for a user who has never linked any account (no row to decrypt
   * in the first place), but must fail closed once a row does exist.
   */
  constructor(
    private readonly db: D1Database,
    private readonly getKey: () => Promise<CryptoKey>,
  ) {}

  /** Resolve the credential for one specific, already-known SUNLearn site. */
  async resolve(userId: string, siteBaseUrl: string): Promise<MoodleCredential | null> {
    const normalizedSiteUrl = assertAllowedMoodleBaseUrl(siteBaseUrl);
    const row = await this.db
      .prepare("SELECT moodle_base_url, encrypted_token FROM moodle_credentials WHERE user_id = ? AND moodle_base_url = ?")
      .bind(userId, normalizedSiteUrl)
      .first<CredentialRow>();
    if (!row) return null;

    // Any failure past this point (missing/invalid key, disallowed host,
    // tampered ciphertext, wrong AAD) throws — callers must fail closed, not
    // treat this as "no credential" and fall back to another config source.
    const key = await this.getKey();
    const baseUrl = assertAllowedMoodleBaseUrl(row.moodle_base_url);
    const token = await decryptCredential(key, userId, baseUrl, row.encrypted_token);
    return { token };
  }

  /** Resolve every site this user has linked, in no particular order. */
  async resolveAll(userId: string): Promise<Array<{ baseUrl: string; credential: MoodleCredential }>> {
    const { results } = await this.db
      .prepare("SELECT moodle_base_url, encrypted_token FROM moodle_credentials WHERE user_id = ?")
      .bind(userId)
      .all<CredentialRow>();
    if (results.length === 0) return [];

    const key = await this.getKey();
    const out: Array<{ baseUrl: string; credential: MoodleCredential }> = [];
    for (const row of results) {
      const baseUrl = assertAllowedMoodleBaseUrl(row.moodle_base_url);
      const token = await decryptCredential(key, userId, baseUrl, row.encrypted_token);
      out.push({ baseUrl, credential: { token } });
    }
    return out;
  }

  /**
   * Resolve this user's "anchor" site — the SUNLearn instance whose account
   * first established their identity (the earliest-linked row, by
   * created_at; re-linking the same site updates updated_at but never
   * created_at, so this stays stable). Every existing single-client MCP tool
   * (everything except the unified course listing) operates against this one
   * site until a full per-tool multi-site dispatch exists — see AGENTS.md.
   */
  async resolveAnchor(userId: string): Promise<{ baseUrl: string; credential: MoodleCredential } | null> {
    const row = await this.db
      .prepare("SELECT moodle_base_url, encrypted_token FROM moodle_credentials WHERE user_id = ? ORDER BY created_at ASC LIMIT 1")
      .bind(userId)
      .first<CredentialRowWithCreatedAt>();
    if (!row) return null;

    const key = await this.getKey();
    const baseUrl = assertAllowedMoodleBaseUrl(row.moodle_base_url);
    const token = await decryptCredential(key, userId, baseUrl, row.encrypted_token);
    return { baseUrl, credential: { token } };
  }
}

export async function saveCredential(
  db: D1Database,
  key: CryptoKey,
  userId: string,
  trustedBaseUrl: string,
  token: string,
): Promise<void> {
  const baseUrl = assertAllowedMoodleBaseUrl(trustedBaseUrl);
  const encryptedToken = await encryptCredential(key, userId, baseUrl, token);
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO moodle_credentials (user_id, moodle_base_url, encrypted_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, moodle_base_url) DO UPDATE SET
         encrypted_token = excluded.encrypted_token,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, baseUrl, encryptedToken, now, now)
    .run();
}

/** Removes exactly one user's credential for exactly one site — never any other connected site. */
export async function deleteCredential(db: D1Database, userId: string, siteBaseUrl: string): Promise<void> {
  const baseUrl = assertAllowedMoodleBaseUrl(siteBaseUrl);
  await db.prepare("DELETE FROM moodle_credentials WHERE user_id = ? AND moodle_base_url = ?").bind(userId, baseUrl).run();
}
