import { describe, expect, it } from "vitest";
import { isCimdFetchError } from "../../src/oauth/authorize-errors.js";

describe("isCimdFetchError", () => {
  it("recognizes the OAuth provider's documented CIMD error name", () => {
    const error = new Error("metadata fetch failed");
    error.name = "CimdFetchError";

    expect(isCimdFetchError(error)).toBe(true);
  });

  it("does not classify ordinary authorization errors as a metadata outage", () => {
    expect(isCimdFetchError(new Error("invalid redirect URI"))).toBe(false);
    expect(isCimdFetchError(null)).toBe(false);
  });
});
