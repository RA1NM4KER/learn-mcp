import { describe, expect, it } from "vitest";
import { accessMode, isPreviewAllowed, PRIVATE_PREVIEW_MESSAGE } from "../src/preview-access.js";

describe("accessMode", () => {
  it("is public only for the exact literal opt-out value", () => {
    expect(accessMode({ ACCESS_MODE: "public" })).toBe("public");
  });

  it("fails closed to private_preview for anything else, including unset or misspelled", () => {
    expect(accessMode({})).toBe("private_preview");
    expect(accessMode({ ACCESS_MODE: undefined })).toBe("private_preview");
    expect(accessMode({ ACCESS_MODE: "Public" })).toBe("private_preview");
    expect(accessMode({ ACCESS_MODE: "open" })).toBe("private_preview");
    expect(accessMode({ ACCESS_MODE: "" })).toBe("private_preview");
  });
});

describe("isPreviewAllowed", () => {
  it("allows everyone when access mode is public, regardless of the allowlist", () => {
    expect(isPreviewAllowed({ ACCESS_MODE: "public" }, "anyone")).toBe(true);
    expect(isPreviewAllowed({ ACCESS_MODE: "public", PREVIEW_ALLOWED_CANONICAL_USER_IDS: "" }, "anyone")).toBe(true);
  });

  it("allows an id present in the allowlist during private preview", () => {
    const env = { PREVIEW_ALLOWED_CANONICAL_USER_IDS: "learn-abc,learn-def" };
    expect(isPreviewAllowed(env, "learn-abc")).toBe(true);
    expect(isPreviewAllowed(env, "learn-def")).toBe(true);
  });

  it("rejects an id not present in the allowlist during private preview", () => {
    const env = { PREVIEW_ALLOWED_CANONICAL_USER_IDS: "learn-abc" };
    expect(isPreviewAllowed(env, "learn-xyz")).toBe(false);
  });

  it("fails closed (rejects everyone) when the allowlist is missing entirely", () => {
    expect(isPreviewAllowed({}, "learn-abc")).toBe(false);
  });

  it("fails closed (rejects everyone) when the allowlist is present but empty/whitespace", () => {
    expect(isPreviewAllowed({ PREVIEW_ALLOWED_CANONICAL_USER_IDS: "" }, "learn-abc")).toBe(false);
    expect(isPreviewAllowed({ PREVIEW_ALLOWED_CANONICAL_USER_IDS: " , , " }, "learn-abc")).toBe(false);
  });

  it("tolerates surrounding whitespace and extra commas in the allowlist", () => {
    expect(isPreviewAllowed({ PREVIEW_ALLOWED_CANONICAL_USER_IDS: " learn-abc , learn-def ,, " }, "learn-abc")).toBe(true);
  });

  it("exposes a polished, non-technical rejection message with no OAuth/internal jargon", () => {
    expect(PRIVATE_PREVIEW_MESSAGE.toLowerCase()).not.toMatch(/oauth|canonical|token|stack/);
    expect(PRIVATE_PREVIEW_MESSAGE).toContain("private preview");
  });
});
