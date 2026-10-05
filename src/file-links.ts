import { z } from "zod";
import { FileRefSchema, type FileRef } from "./file-id-store.js";
import { MoodleClient } from "./moodle-client.js";
import { resolveMoodleConfigForOAuthUser, type MoodleResolverEnv } from "./linking/resolve-config.js";
import { FILE_LINK_POLICY } from "./policy.js";

// Signed, expiring download links for large files on the remote Worker.
// ChatGPT cannot receive a large file inline, so the tool returns one of these
// links and the user opens it in a browser. The link carries the owner's user
// ID and the file reference, sealed with a key derived from the Worker's
// credential secret. It holds no Moodle token and no raw Moodle URL. On each
// request the Worker re-checks the user's current Moodle access with that
// user's own credential, then streams the bytes. Nothing is stored.

const LINK_KEY_INFO = "learn-mcp:file-link:v1";
const IV_BYTES = 12;
const PATH_PREFIX = "/files/";

const LinkPayloadSchema = FileRefSchema.extend({
  v: z.literal(1),
  /** The OAuth user this file was issued to (a derived stemlearn id). The link only works for that user. */
  ownerId: z.string().min(1),
  /** The Moodle site the file lives on. Checked against the user's own credential. */
  baseUrl: z.string().url(),
  exp: z.number().finite(),
}).strict();
export type FileLinkPayload = z.infer<typeof LinkPayloadSchema>;

function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64u(s: string): Uint8Array | null {
  try {
    const std = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob(std);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** AES-GCM key derived from the Worker's credential secret, with its own info label so it never matches any other key. */
export async function deriveFileLinkKey(rawSecret: string): Promise<CryptoKey> {
  const master = await crypto.subtle.importKey("raw", new TextEncoder().encode(rawSecret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode(LINK_KEY_INFO) },
    master,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealFileLink(key: CryptoKey, ref: FileRef, ownerId: string, baseUrl: string, ttlMs: number, now: number = Date.now()): Promise<string> {
  const payload: FileLinkPayload = { ...ref, v: 1, ownerId, baseUrl, exp: now + ttlMs };
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload))));
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv, 0);
  blob.set(ct, iv.length);
  return b64u(blob);
}

/** The payload if the token is genuine and unexpired, otherwise null. Every failure looks the same to the caller. */
export async function openFileLink(key: CryptoKey, token: string, now: number = Date.now()): Promise<FileLinkPayload | null> {
  const blob = unb64u(token);
  if (!blob || blob.length < IV_BYTES + 16) return null;
  try {
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, IV_BYTES) }, key, blob.slice(IV_BYTES)));
    const parsed = LinkPayloadSchema.safeParse(JSON.parse(new TextDecoder().decode(plaintext)));
    if (!parsed.success || parsed.data.exp < now) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Builds the absolute link for a file, given the Worker's own origin. */
export function fileLinkUrl(origin: string, token: string): string {
  return `${origin}${PATH_PREFIX}${token}`;
}

const NOT_AVAILABLE = "This link is invalid, has expired, or the file is no longer available.";

function notFound(): Response {
  return new Response(NOT_AVAILABLE, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/** RFC 6266 filename: an ASCII fallback plus the UTF-8 form. Strips path separators and control characters. */
export function contentDisposition(filename: string): string {
  const base = (filename.split(/[\\/]/).pop() ?? "").replace(/[\x00-\x1f\x7f]/g, "").trim() || "file";
  const ascii = base.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`;
}

/**
 * GET /files/<token>. Serves a file a user was given a link for. The owner's
 * current Moodle credential is resolved here, so an unlinked or disconnected
 * account gets the same 404 as a bad token.
 */
export async function handleFileLinkRequest(request: Request, env: MoodleResolverEnv & { CREDENTIAL_ENCRYPTION_KEY?: string }): Promise<Response> {
  const token = new URL(request.url).pathname.slice(PATH_PREFIX.length);
  if (!token || request.method !== "GET" || !env.CREDENTIAL_ENCRYPTION_KEY) return notFound();

  const key = await deriveFileLinkKey(env.CREDENTIAL_ENCRYPTION_KEY);
  const link = await openFileLink(key, token);
  if (!link) return notFound();

  let client: MoodleClient;
  try {
    const config = await resolveMoodleConfigForOAuthUser(link.ownerId, env);
    // A link is only honoured against the same Moodle site it was issued for.
    if (config.baseUrl !== link.baseUrl) return notFound();
    client = await MoodleClient.create(config);
  } catch {
    // No linked account, a disconnected site, or a credential that fails closed all look the same as a bad link.
    return notFound();
  }

  const { v: _v, ownerId: _ownerId, baseUrl: _baseUrl, exp: _exp, ...ref } = link;
  const current = await client.authorizeRef(ref);
  if (!current) return notFound();

  let upstream: Response;
  try {
    upstream = await client.openFileStream(current.fileurl, FILE_LINK_POLICY.openTimeoutMs);
  } catch {
    return notFound();
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": current.mime || "application/octet-stream",
      "Content-Disposition": contentDisposition(current.filename),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
