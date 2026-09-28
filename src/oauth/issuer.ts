// OAuth issuer/resource identities for the public Worker endpoints. Every
// endpoint this Worker has ever been canonically reachable at keeps its own
// issuer identity indefinitely (see LEGACY_ISSUER_URLS below) so existing
// clients/grants on an older endpoint keep working while new clients use the
// current canonical domain — the same pattern used for the original
// workers.dev -> stemlearn-mcp.kefas.co.za migration, extended for the
// sunlearn-mcp rebrand (stemlearn-mcp.kefas.co.za -> sunlearn-mcp.kefas.co.za).
//
// learnmcp.kefas.co.za (src/brand.ts's MCP_ENDPOINT_URL, and now a route in
// wrangler.toml) is the intended next canonical domain for the Learn MCP
// rebrand, but is NOT YET provisioned/live as a Cloudflare custom domain —
// that requires a deploy, deliberately left for the user to trigger once
// they've verified DNS/SSL for it. Do not make it PRIMARY_ISSUER_URL until
// then: a not-yet-reachable primary issuer would break every new OAuth
// registration from the moment this deploys. Once it's confirmed live,
// promote it to PRIMARY_ISSUER_URL and move sunlearn-mcp.kefas.co.za down
// into LEGACY_ISSUER_URLS, following this same pattern.

export const PRIMARY_ISSUER_URL = "https://sunlearn-mcp.kefas.co.za";

/** Every previously-canonical issuer, oldest first — each keeps working as its own issuer identity, never merged into PRIMARY_ISSUER_URL. */
export const LEGACY_ISSUER_URLS = [
  "https://stemlearn-mcp.kefasa112.workers.dev",
  "https://stemlearn-mcp.kefas.co.za",
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
