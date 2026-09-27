import { describe, expect, it } from "vitest";
import { issuerForRequest, LEGACY_ISSUER_URL, PRIMARY_ISSUER_URL } from "../../src/oauth/issuer.js";

describe("issuerForRequest", () => {
  it("uses the custom domain for new public requests", () => {
    expect(issuerForRequest(`${PRIMARY_ISSUER_URL}/authorize`)).toBe(PRIMARY_ISSUER_URL);
  });

  it("keeps the legacy issuer for existing workers.dev clients", () => {
    expect(issuerForRequest(`${LEGACY_ISSUER_URL}/mcp`)).toBe(LEGACY_ISSUER_URL);
  });

  it("uses the explicit local-development override", () => {
    expect(issuerForRequest("http://localhost:8787/authorize", "http://localhost:8787")).toBe("http://localhost:8787");
  });
});
