// Public product identity — deliberately separate from every internal
// compatibility-sensitive identifier (DEFAULT_USER_ID, deriveStemlearnUserId,
// AAD/HKDF namespaces, OAuth scope, issuer URLs, database/table names). This
// is the ONLY place the public-facing name/tagline/status is defined; every
// rendered page imports it from here rather than hardcoding "Learn MCP" —
// see AGENTS.md for why the internal identifiers above are retained as-is.

export const PRODUCT_NAME = "Learn MCP";
export const PRODUCT_TAGLINE = "Ask your courses anything.";

/**
 * Learn MCP is publicly demonstrated but not yet publicly onboardable (see
 * src/preview-access.ts for the actual server-side enforcement — this flag
 * only controls what the STATIC marketing/docs pages say and show; it is not
 * itself a security control). Flip to false when a wider release is
 * approved, which re-enables the real setup instructions in
 * src/marketing/docs-page.ts without needing to rebuild them.
 */
export const PRIVATE_PREVIEW = true;

/** The canonical remote MCP endpoint, shown in setup docs once PRIVATE_PREVIEW is false. */
export const MCP_ENDPOINT_URL = "https://learnmcp.kefas.co.za/mcp";
