import { describe, expect, it } from "vitest";
import { issuerForRequest, LEGACY_ISSUER_URLS, PRIMARY_ISSUER_URL } from "../../src/oauth/issuer.js";

describe("issuerForRequest", () => {
  it("uses the current canonical domain for new public requests", () => {
    expect(issuerForRequest(`${PRIMARY_ISSUER_URL}/authorize`)).toBe(PRIMARY_ISSUER_URL);
  });

  it("keeps every previously-canonical issuer working as its own identity, for existing clients on any of them", () => {
    for (const legacy of LEGACY_ISSUER_URLS) {
      expect(issuerForRequest(`${legacy}/mcp`)).toBe(legacy);
    }
  });

  it("uses the explicit local-development override", () => {
    expect(issuerForRequest("http://localhost:8787/authorize", "http://localhost:8787")).toBe("http://localhost:8787");
  });
});
