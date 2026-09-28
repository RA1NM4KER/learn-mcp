// Private-preview access control. Learn MCP is publicly demonstrated but not
// yet publicly onboardable: only explicitly allowed canonical identities (see
// oauth/canonical-identity.ts) may complete account linking. This gates
// EXACTLY ONE moment — first-time credential persistence during
// src/oauth/routes.ts's handleAuthorizeLink — not every /mcp request. Once a
// tester has legitimately linked, day-to-day use is never re-checked against
// this list; only *new* onboarding is gated. See AGENTS.md for the full
// rationale.
//
// The legacy bearer-gated lane (DEFAULT_USER_ID, gated by this deployment's
// own MCP_ACCESS_TOKEN secret) is NEVER subject to this gate — anyone able to
// present that bearer token is by construction already an authorized
// operator of this deployment, not an arbitrary public user.

export type AccessMode = "public" | "private_preview";

export interface PreviewAccessEnv {
  ACCESS_MODE?: string;
  PREVIEW_ALLOWED_CANONICAL_USER_IDS?: string;
}

export const PRIVATE_PREVIEW_MESSAGE =
  "Learn MCP is currently in private preview. Public connections are not available yet.";

function parseAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

/**
 * "public" only for the exact literal opt-out value. Anything else —
 * including unset or misspelled — fails closed to private_preview, per the
 * "fail closed" requirement: an operator error should never silently open
 * onboarding to the public.
 */
export function accessMode(env: PreviewAccessEnv): AccessMode {
  return env.ACCESS_MODE === "public" ? "public" : "private_preview";
}

/**
 * Whether `canonicalUserId` may complete onboarding right now. Always true
 * outside private-preview mode. Fails closed (denies) on a missing, empty, or
 * unparsable allowlist while in private-preview mode — a misconfigured
 * secret must never silently admit everyone.
 */
export function isPreviewAllowed(env: PreviewAccessEnv, canonicalUserId: string): boolean {
  if (accessMode(env) === "public") return true;
  return parseAllowlist(env.PREVIEW_ALLOWED_CANONICAL_USER_IDS).has(canonicalUserId);
}
