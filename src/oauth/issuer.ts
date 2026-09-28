// OAuth issuer/resource identities for the public Worker endpoints. Every
// endpoint this Worker has ever been canonically reachable at keeps its own
// issuer identity indefinitely (see LEGACY_ISSUER_URLS below) so existing
// clients/grants on an older endpoint keep working while new clients use the
// current canonical domain — the same pattern used for the original
// workers.dev -> stemlearn-mcp.kefas.co.za migration, the sunlearn-mcp
// rebrand (stemlearn-mcp.kefas.co.za -> sunlearn-mcp.kefas.co.za), and now
// the Learn MCP rebrand (sunlearn-mcp.kefas.co.za -> learnmcp.kefas.co.za).
//
// learnmcp.kefas.co.za was confirmed live (DNS + SSL auto-provisioned by
// `wrangler deploy` via the wrangler.toml route, health-checked manually)
// before being promoted here. A request's Host must match its provider's
// configured issuer or oauth/provider.ts's OAuthProvider 404s its
// well-known/discovery endpoints (issuer-confusion protection) — so a
// not-yet-reachable or unlisted domain must never be PRIMARY_ISSUER_URL.

export const PRIMARY_ISSUER_URL = "https://learnmcp.kefas.co.za";

/** Every previously-canonical issuer, oldest first — each keeps working as its own issuer identity, never merged into PRIMARY_ISSUER_URL. */
export const LEGACY_ISSUER_URLS = [
  "https://stemlearn-mcp.kefasa112.workers.dev",
  "https://stemlearn-mcp.kefas.co.za",
  "https://sunlearn-mcp.kefas.co.za",
] as const;

/**
 * Uses the current canonical domain for new traffic, but preserves the exact
 * issuer identity for requests that still arrive through any previously
 * canonical endpoint. Request URLs are supplied by the Workers runtime, not
 * by a caller-controlled header.
 */
export function issuerForRequest(requestUrl: string, override?: string): string {
  if (override) return override;
  const origin = new URL(requestUrl).origin;
  return (LEGACY_ISSUER_URLS as readonly string[]).includes(origin) ? origin : PRIMARY_ISSUER_URL;
}
