import type { D1Database } from "./d1.js";
import { randomHex, sha256Hex } from "./hash.js";

// Short-lived, single-use SUNLearn account-linking sessions, stored in D1
// (not KV: a KV get()-then-delete() is not a real atomic single-use
// guarantee under eventual consistency; D1/SQLite's single-writer semantics
// let one conditional UPDATE decide a race outright). The raw session id is
// never persisted — only its SHA-256 hash — so a leaked row can't be
// replayed as a session id.
//
// Every session is bound to exactly one SUNLearn site's base URL at
// creation. A connection link pasted back must correlate (via its Moodle
// passport hash) against THAT site specifically — see verifyConnectionLink
// in routes.ts — so a link copied from one site's confirmation page can
// never complete a linking session that was started for a different site.

export const LINKING_SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_ID_BYTES = 32;
const PASSPORT_BYTES = 16;

export interface CreatedLinkingSession {
  sessionId: string;
  passport: string;
  expiresAt: number;
}

/**
 * `oauthRequestJson`, when provided, is a validated `AuthRequest` (from the
 * OAuth provider's `parseAuthRequest()`) JSON-serialized verbatim — never
 * reconstructed from client-supplied values. Present only for sessions
 * created from `GET /authorize`; absent (NULL) for the legacy bearer-started
 * flow, which is how completion tells the two apart.
 */
export async function createLinkingSession(
  db: D1Database,
  userId: string,
  siteBaseUrl: string | null,
  oauthRequestJson?: string,
): Promise<CreatedLinkingSession> {
  const sessionId = randomHex(SESSION_ID_BYTES);
  const passport = randomHex(PASSPORT_BYTES);
  const sessionHash = await sha256Hex(sessionId);
  const now = Date.now();
  const expiresAt = now + LINKING_SESSION_TTL_MS;

  await db
    .prepare(
      "INSERT INTO linking_sessions (session_hash, user_id, passport, created_at, expires_at, consumed_at, oauth_request_json, moodle_base_url) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
    )
    .bind(sessionHash, userId, passport, now, expiresAt, oauthRequestJson ?? null, siteBaseUrl)
    .run();

  return { sessionId, passport, expiresAt };
}

/**
 * Read-only lookup of an active (unconsumed, unexpired) session by its raw
 * id. Does NOT consume it — callers must validate the pasted link and verify
 * the Moodle token before calling finalizeLinkingSession, so a correctable
 * mistake (bad paste, transient Moodle hiccup) doesn't burn the session and
 * force the student through university login again.
 *
 * There is no separate caller-supplied identity to check the session against
 * here: /auth/stemlearn/complete is intentionally unauthenticated (see
 * routes.ts) — the session id itself, known only to whoever /start handed it
 * to, IS the proof of who this belongs to. The row's own user_id is the
 * authoritative answer to "for whom." moodleBaseUrl is the authoritative
 * answer to "for which SUNLearn site" — callers must verify a pasted
 * connection link against THIS site, never a caller-supplied one.
 */
export async function loadActiveLinkingSession(
  db: D1Database,
  sessionId: string,
): Promise<{ userId: string; passport: string; oauthRequestJson: string | null; moodleBaseUrl: string | null } | null> {
  const sessionHash = await sha256Hex(sessionId);
  const row = await db
    .prepare(
      "SELECT user_id, passport, oauth_request_json, moodle_base_url FROM linking_sessions WHERE session_hash = ? AND consumed_at IS NULL AND expires_at > ?",
    )
    .bind(sessionHash, Date.now())
    .first<{ user_id: string; passport: string; oauth_request_json: string | null; moodle_base_url: string | null }>();
  return row
    ? { userId: row.user_id, passport: row.passport, oauthRequestJson: row.oauth_request_json, moodleBaseUrl: row.moodle_base_url }
    : null;
}

/**
 * Atomically marks a session consumed, writing `userId` (the legacy flow
 * passes back its own unchanged `session.userId`; the OAuth flow passes the
 * just-derived real Moodle identity, or an already-established anchor
 * identity when linking an additional site). Returns true only for the
 * single call that wins the race (meta.changes === 1) — a concurrent
 * duplicate call, or one that arrives after expiry/consumption, returns
 * false and must not proceed to persist a credential.
 */
export async function finalizeLinkingSession(db: D1Database, sessionId: string, userId: string): Promise<boolean> {
  const sessionHash = await sha256Hex(sessionId);
  const result = await db
    .prepare(
      "UPDATE linking_sessions SET consumed_at = ?, user_id = ? WHERE session_hash = ? AND consumed_at IS NULL AND expires_at > ?",
    )
    .bind(Date.now(), userId, sessionHash, Date.now())
    .run();
  return result.meta.changes === 1;
}

/**
 * Records a just-derived anchor identity on an active session WITHOUT
 * consuming it — used by the OAuth flow the first time a site link
 * succeeds, so the same pending authorization can keep linking additional
 * sites afterward (each subsequent site-link also targets this now-known
 * userId). Only `finalizeLinkingSession`, called once from the "Continue to
 * consent" step, actually consumes the session — that's what prevents the
 * linking step from being replayed after consent has begun.
 */
export async function setLinkingSessionUserId(db: D1Database, sessionId: string, userId: string): Promise<boolean> {
  const sessionHash = await sha256Hex(sessionId);
  const result = await db
    .prepare("UPDATE linking_sessions SET user_id = ? WHERE session_hash = ? AND consumed_at IS NULL AND expires_at > ?")
    .bind(userId, sessionHash, Date.now())
    .run();
  return result.meta.changes === 1;
}

/**
 * Reads back the userId a (consumed) session was finalized under, ignoring
 * expiry/consumption state. Used only for the few seconds between a
 * successful OAuth-linking completion and the immediately following consent
 * submission, to recover the derived identity WITHOUT ever round-tripping it
 * through client-visible form state — Moodle numeric user ids are small,
 * sequential and trivially guessable, so the derived `stemlearn-<hash>`
 * string must never be trusted from a hidden field; only this session id
 * (unguessable, 256-bit) is.
 */
export async function loadLinkingSessionUserId(db: D1Database, sessionId: string): Promise<string | null> {
  const sessionHash = await sha256Hex(sessionId);
  const row = await db
    .prepare("SELECT user_id FROM linking_sessions WHERE session_hash = ?")
    .bind(sessionHash)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}
