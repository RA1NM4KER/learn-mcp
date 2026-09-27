// OAuth issuer/resource identities for the public Worker endpoints. Keep the
// legacy workers.dev endpoint during the custom-domain migration so existing
// clients and grants keep working while new clients use the stable domain.

export const PRIMARY_ISSUER_URL = "https://stemlearn-mcp.kefas.co.za";
export const LEGACY_ISSUER_URL = "https://stemlearn-mcp.kefasa112.workers.dev";

/**
 * Uses the canonical custom domain for new traffic, but preserves the exact
 * old issuer for requests that still arrive through workers.dev. Request URLs
 * are supplied by the Workers runtime, not by a caller-controlled header.
 */
export function issuerForRequest(requestUrl: string, override?: string): string {
  if (override) return override;
  return new URL(requestUrl).origin === LEGACY_ISSUER_URL ? LEGACY_ISSUER_URL : PRIMARY_ISSUER_URL;
}
