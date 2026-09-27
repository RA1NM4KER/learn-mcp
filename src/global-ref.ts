// Sealed opaque multi-site resource references.
//
// A bare Moodle numeric id (course id, assignment id, quiz id, forum id) is
// only unique within ONE Moodle instance — once tools aggregate or dispatch
// across several SUNLearn sites, the same number can legitimately mean two
// different things on two different instances. Every id this MCP hands back
// to a caller for a NON-anchor site is therefore an opaque, sealed envelope
// over {userId, siteId, kind, id}, not a reconstructible string — callers
// must never parse or construct one themselves. `kind` prevents a sealed
// course ref from ever being accepted where an assignment/quiz/forum ref was
// expected (or vice versa), even though all four are just numbers
// underneath.
//
// Deliberately NOT a reuse of file-id-store.ts: that store derives its key
// from the live Moodle access token itself (correct for a value that must
// die the moment a token is revoked), and its TTL/lifecycle is tuned for a
// single request's file links. A resource reference needs to keep working
// across many later requests/sessions, so it's HKDF-derived from the same
// CREDENTIAL_ENCRYPTION_KEY secret used for stored credentials, but with its
// own `info` string for domain separation — no new secret to provision, but
// a materially different derived key than credential-crypto.ts's.

import { z } from "zod";

const SafePositiveInteger = z.number().int().positive().refine(Number.isSafeInteger);

export const GLOBAL_REF_KINDS = ["course", "assignment", "quiz", "forum"] as const;
export type GlobalRefKind = (typeof GLOBAL_REF_KINDS)[number];

export const GlobalRefSchema = z.object({
  userId: z.string().min(1),
  siteId: z.string().min(1),
  kind: z.enum(GLOBAL_REF_KINDS),
  id: SafePositiveInteger,
}).strict();
export type GlobalRef = z.infer<typeof GlobalRefSchema>;

const SealedPayloadSchema = GlobalRefSchema.extend({ exp: z.number().finite() }).strict();

const KEY_INFO = "sunlearn-mcp:global-ref:v1";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days: long enough to survive normal use, short enough to bound a leaked id's lifetime.
const ID_PREFIX = "r_";
const IV_BYTES = 12;

function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64u(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const std = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(std);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function deriveKey(rawSecret: string): Promise<CryptoKey> {
  const secretBytes = unb64u(rawSecret);
  if (!secretBytes) throw new Error("Reference encryption key is misconfigured.");
  const master = await crypto.subtle.importKey("raw", secretBytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode(KEY_INFO) },
    master,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export class GlobalRefStore {
  private readonly keyPromise: Promise<CryptoKey>;

  constructor(credentialEncryptionKeyB64Url: string, private readonly ttlMs: number = TTL_MS) {
    this.keyPromise = deriveKey(credentialEncryptionKeyB64Url);
  }

  async seal(ref: GlobalRef): Promise<string> {
    const key = await this.keyPromise;
    const payload = { ...ref, exp: Date.now() + this.ttlMs };
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
    const blob = new Uint8Array(iv.length + ct.length);
    blob.set(iv, 0);
    blob.set(ct, iv.length);
    return ID_PREFIX + b64u(blob);
  }

  /**
   * Returns null for anything that isn't a currently-valid sealed ref of
   * exactly `expectedKind` for exactly `expectedUserId` — never throws, and
   * never reveals which check failed (invalid format, wrong kind, wrong
   * user, tampered, or expired all look identical to the caller).
   */
  async open(id: string, expectedUserId: string, expectedKind: GlobalRefKind): Promise<{ siteId: string; id: number } | null> {
    if (!id.startsWith(ID_PREFIX)) return null;
    const blob = unb64u(id.slice(ID_PREFIX.length));
    if (!blob || blob.length < IV_BYTES + 16) return null;
    const iv = blob.slice(0, IV_BYTES);
    const ct = blob.slice(IV_BYTES);
    try {
      const key = await this.keyPromise;
      const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
      const decoded: unknown = JSON.parse(new TextDecoder().decode(plaintext));
      const parsed = SealedPayloadSchema.safeParse(decoded);
      if (!parsed.success) return null;
      const payload = parsed.data;
      if (payload.exp < Date.now() || payload.userId !== expectedUserId || payload.kind !== expectedKind) return null;
      return { siteId: payload.siteId, id: payload.id };
    } catch {
      return null;
    }
  }
}
