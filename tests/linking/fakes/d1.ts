import type { D1AllResult, D1Database, D1PreparedStatement, D1RunResult } from "../../../src/linking/d1.js";

export interface FakeCredentialRow {
  user_id: string;
  moodle_base_url: string;
  encrypted_token: string;
  created_at: number;
  updated_at: number;
}

export interface FakeSessionRow {
  session_hash: string;
  user_id: string;
  passport: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  oauth_request_json: string | null;
  moodle_base_url: string | null;
}

export interface FakeAliasRow {
  moodle_base_url: string;
  moodle_user_id: number;
  canonical_user_id: string;
  created_at: number;
}

function credentialKey(userId: string, baseUrl: string): string {
  return `${userId}\u0000${baseUrl}`;
}

function aliasKey(baseUrl: string, moodleUserId: number): string {
  return `${baseUrl}\u0000${moodleUserId}`;
}

/**
 * A minimal in-memory stand-in for the real D1 binding, pattern-matching on
 * the exact statements src/linking/* issues (this repo's query surface is
 * small and fixed, so a full SQL engine isn't needed). Sufficient to exercise
 * real single-use/atomicity/isolation logic without a live Cloudflare D1.
 * Credentials are keyed by (user_id, moodle_base_url) — one row per site a
 * user has linked, matching the real composite-primary-key schema.
 */
export class FakeD1 implements D1Database {
  credentials = new Map<string, FakeCredentialRow>();
  sessions = new Map<string, FakeSessionRow>();
  aliases = new Map<string, FakeAliasRow>();

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql);
  }
}

class FakeStatement implements D1PreparedStatement {
  private args: unknown[] = [];
  constructor(private readonly db: FakeD1, private readonly sql: string) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.args = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes("FROM moodle_identity_aliases")) {
      const [baseUrl, moodleUserId] = this.args as [string, number];
      const row = this.db.aliases.get(aliasKey(baseUrl, moodleUserId));
      return row ? ({ canonical_user_id: row.canonical_user_id } as unknown as T) : null;
    }
    if (this.sql.includes("FROM moodle_credentials") && this.sql.includes("ORDER BY created_at")) {
      const [userId] = this.args as [string];
      const rows = [...this.db.credentials.values()].filter((r) => r.user_id === userId);
      rows.sort((a, b) => a.created_at - b.created_at);
      const row = rows[0];
      if (!row) return null;
      return { moodle_base_url: row.moodle_base_url, encrypted_token: row.encrypted_token, created_at: row.created_at } as unknown as T;
    }
    if (this.sql.includes("FROM moodle_credentials")) {
      const [userId, baseUrl] = this.args as [string, string];
      const row = this.db.credentials.get(credentialKey(userId, baseUrl));
      if (!row) return null;
      return { moodle_base_url: row.moodle_base_url, encrypted_token: row.encrypted_token } as unknown as T;
    }
    if (this.sql.includes("FROM linking_sessions") && this.sql.includes("consumed_at IS NULL")) {
      const [sessionHash, now] = this.args as [string, number];
      const row = this.db.sessions.get(sessionHash);
      if (!row || row.consumed_at !== null || row.expires_at <= now) return null;
      return {
        user_id: row.user_id, passport: row.passport, oauth_request_json: row.oauth_request_json,
        moodle_base_url: row.moodle_base_url,
      } as unknown as T;
    }
    if (this.sql.includes("FROM linking_sessions")) {
      // Plain lookup (loadLinkingSessionUserId): no active/expiry filter.
      const [sessionHash] = this.args as [string];
      const row = this.db.sessions.get(sessionHash);
      return row ? ({ user_id: row.user_id } as unknown as T) : null;
    }
    throw new Error(`FakeD1: unhandled first() query: ${this.sql}`);
  }

  async all<T>(): Promise<D1AllResult<T>> {
    if (this.sql.includes("FROM moodle_credentials")) {
      const [userId] = this.args as [string];
      const rows = [...this.db.credentials.values()]
        .filter((r) => r.user_id === userId)
        .map((r) => ({ moodle_base_url: r.moodle_base_url, encrypted_token: r.encrypted_token }) as unknown as T);
      return { results: rows };
    }
    throw new Error(`FakeD1: unhandled all() query: ${this.sql}`);
  }

  async run(): Promise<D1RunResult> {
    if (this.sql.startsWith("INSERT INTO moodle_identity_aliases")) {
      const [baseUrl, moodleUserId, canonicalUserId, createdAt] = this.args as [string, number, string, number];
      this.db.aliases.set(aliasKey(baseUrl, moodleUserId), {
        moodle_base_url: baseUrl, moodle_user_id: moodleUserId, canonical_user_id: canonicalUserId, created_at: createdAt,
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("INSERT INTO linking_sessions")) {
      const [sessionHash, userId, passport, createdAt, expiresAt, oauthRequestJson, moodleBaseUrl] = this.args as [
        string, string, string, number, number, string | null, string | null,
      ];
      this.db.sessions.set(sessionHash, {
        session_hash: sessionHash, user_id: userId, passport, created_at: createdAt, expires_at: expiresAt,
        consumed_at: null, oauth_request_json: oauthRequestJson ?? null, moodle_base_url: moodleBaseUrl ?? null,
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE linking_sessions SET moodle_base_url")) {
      const [siteBaseUrl, sessionHash, now] = this.args as [string, string, number];
      const row = this.db.sessions.get(sessionHash);
      if (!row || row.consumed_at !== null || row.expires_at <= now) return { meta: { changes: 0 } };
      row.moodle_base_url = siteBaseUrl;
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE linking_sessions SET user_id")) {
      const [userId, sessionHash, now] = this.args as [string, string, number];
      const row = this.db.sessions.get(sessionHash);
      if (!row || row.consumed_at !== null || row.expires_at <= now) return { meta: { changes: 0 } };
      row.user_id = userId;
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("UPDATE linking_sessions")) {
      const [consumedAt, userId, sessionHash, now] = this.args as [number, string, string, number];
      const row = this.db.sessions.get(sessionHash);
      if (!row || row.consumed_at !== null || row.expires_at <= now) return { meta: { changes: 0 } };
      row.consumed_at = consumedAt;
      row.user_id = userId;
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("INSERT INTO moodle_credentials")) {
      const [userId, baseUrl, encryptedToken, createdAt, updatedAt] = this.args as [string, string, string, number, number];
      const key = credentialKey(userId, baseUrl);
      const existing = this.db.credentials.get(key);
      this.db.credentials.set(key, {
        user_id: userId, moodle_base_url: baseUrl, encrypted_token: encryptedToken,
        created_at: existing ? existing.created_at : createdAt, updated_at: updatedAt,
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM moodle_credentials")) {
      const [userId, baseUrl] = this.args as [string, string];
      const existed = this.db.credentials.delete(credentialKey(userId, baseUrl));
      return { meta: { changes: existed ? 1 : 0 } };
    }
    throw new Error(`FakeD1: unhandled run() query: ${this.sql}`);
  }
}
/** A fresh, valid base64url-encoded 32-byte CREDENTIAL_ENCRYPTION_KEY for tests. */
export function randomKeyB64Url(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
