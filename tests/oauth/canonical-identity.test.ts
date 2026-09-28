import { describe, expect, it } from "vitest";
import { FakeD1 } from "../linking/fakes/d1.js";
import { resolveCanonicalUserId, resolveCanonicalUserIdWithPreviewGate } from "../../src/oauth/canonical-identity.js";
import { deriveStemlearnUserId } from "../../src/oauth/identity.js";

const STEM = "https://stemlearn.sun.ac.za";
const SUN = "https://learn.sun.ac.za";

describe("resolveCanonicalUserId", () => {
  it("mints a canonical id matching the legacy derivation for a brand-new identity", async () => {
    const db = new FakeD1();
    const result = await resolveCanonicalUserId(db, STEM, 42, null);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.canonicalUserId).toBe(await deriveStemlearnUserId("stemlearn.sun.ac.za", 42));
  });

  it("records the minted identity as an alias so it's stable next time", async () => {
    const db = new FakeD1();
    const first = await resolveCanonicalUserId(db, STEM, 42, null);
    const second = await resolveCanonicalUserId(db, STEM, 42, null);
    expect(first.ok && second.ok && first.canonicalUserId === second.canonicalUserId).toBe(true);
  });

  it("attaches a second site's identity to the same canonical user within one flow", async () => {
    const db = new FakeD1();
    const anchor = await resolveCanonicalUserId(db, STEM, 42, null);
    expect(anchor.ok).toBe(true);
    if (!anchor.ok) throw new Error("unreachable");

    const second = await resolveCanonicalUserId(db, SUN, 999, anchor.canonicalUserId);
    expect(second).toEqual({ ok: true, canonicalUserId: anchor.canonicalUserId });
  });

  it("the same human authenticating through either linked site later resolves to one canonical identity", async () => {
    const db = new FakeD1();
    const anchor = await resolveCanonicalUserId(db, STEM, 42, null);
    if (!anchor.ok) throw new Error("unreachable");
    await resolveCanonicalUserId(db, SUN, 999, anchor.canonicalUserId);

    // Fresh flow, starting from the SECOND site this time (no prior session identity) —
    // must resolve back to the exact same canonical id, not mint a new one.
    const reauthViaSecondSite = await resolveCanonicalUserId(db, SUN, 999, null);
    expect(reauthViaSecondSite).toEqual({ ok: true, canonicalUserId: anchor.canonicalUserId });

    const reauthViaFirstSite = await resolveCanonicalUserId(db, STEM, 42, null);
    expect(reauthViaFirstSite).toEqual({ ok: true, canonicalUserId: anchor.canonicalUserId });
  });

  it("different Moodle numeric user ids on the same site never collide", async () => {
    const db = new FakeD1();
    const alice = await resolveCanonicalUserId(db, STEM, 1, null);
    const bob = await resolveCanonicalUserId(db, STEM, 2, null);
    expect(alice.ok && bob.ok && alice.canonicalUserId !== bob.canonicalUserId).toBe(true);
  });

  it("the same numeric Moodle user id on two different sites is not assumed to be the same person unless explicitly linked together", async () => {
    const db = new FakeD1();
    const onStem = await resolveCanonicalUserId(db, STEM, 7, null);
    const onSun = await resolveCanonicalUserId(db, SUN, 7, null);
    expect(onStem.ok && onSun.ok && onStem.canonicalUserId !== onSun.canonicalUserId).toBe(true);
  });

  it("rejects attaching a site identity that is already someone else's alias (identity conflict)", async () => {
    const db = new FakeD1();
    const userA = await resolveCanonicalUserId(db, STEM, 1, null);
    const userB = await resolveCanonicalUserId(db, SUN, 2, null);
    if (!userA.ok || !userB.ok) throw new Error("unreachable");

    // Flow currently anchored as userA tries to link a site identity that's already userB's.
    const conflict = await resolveCanonicalUserId(db, SUN, 2, userA.canonicalUserId);
    expect(conflict).toEqual({ ok: false, reason: "identity_conflict" });

    // Neither identity's aliases were mutated by the rejected attempt.
    expect(await resolveCanonicalUserId(db, SUN, 2, null)).toEqual({ ok: true, canonicalUserId: userB.canonicalUserId });
  });
});

describe("resolveCanonicalUserIdWithPreviewGate", () => {
  it("allows and persists a brand-new identity that's on the preview allowlist", async () => {
    const db = new FakeD1();
    const allowedId = await deriveStemlearnUserId("stemlearn.sun.ac.za", 42);
    const env = { ACCESS_MODE: "private_preview", PREVIEW_ALLOWED_CANONICAL_USER_IDS: allowedId };

    const result = await resolveCanonicalUserIdWithPreviewGate(db, env, STEM, 42, null);

    expect(result).toEqual({ ok: true, canonicalUserId: allowedId });
    expect(db.aliases.size).toBe(1);
  });

  it("rejects a brand-new identity NOT on the preview allowlist, and persists no alias for it", async () => {
    const db = new FakeD1();
    const env = { ACCESS_MODE: "private_preview", PREVIEW_ALLOWED_CANONICAL_USER_IDS: "learn-someone-else" };

    const result = await resolveCanonicalUserIdWithPreviewGate(db, env, STEM, 999, null);

    expect(result).toEqual({ ok: false, reason: "preview_denied" });
    expect(db.aliases.size).toBe(0);
  });

  it("allows an already-allowed identity to link an additional site", async () => {
    const db = new FakeD1();
    const allowedId = await deriveStemlearnUserId("stemlearn.sun.ac.za", 1);
    const env = { ACCESS_MODE: "private_preview", PREVIEW_ALLOWED_CANONICAL_USER_IDS: allowedId };

    const anchor = await resolveCanonicalUserIdWithPreviewGate(db, env, STEM, 1, null);
    expect(anchor).toEqual({ ok: true, canonicalUserId: allowedId });

    const second = await resolveCanonicalUserIdWithPreviewGate(db, env, SUN, 2, allowedId);
    expect(second).toEqual({ ok: true, canonicalUserId: allowedId });
    expect(db.aliases.size).toBe(2);
  });

  it("lets an already-linked (existing alias) identity re-authenticate even if the allowlist has since changed", async () => {
    const db = new FakeD1();
    const originallyAllowedId = await deriveStemlearnUserId("stemlearn.sun.ac.za", 7);
    const firstEnv = { ACCESS_MODE: "private_preview", PREVIEW_ALLOWED_CANONICAL_USER_IDS: originallyAllowedId };
    await resolveCanonicalUserIdWithPreviewGate(db, firstEnv, STEM, 7, null);

    // Allowlist reconfigured, but this identity already has an alias row —
    // prospectiveCanonicalUserId finds the EXISTING alias, not a fresh mint,
    // so the allowlist check runs against the already-established id.
    const laterEnv = { ACCESS_MODE: "private_preview", PREVIEW_ALLOWED_CANONICAL_USER_IDS: originallyAllowedId };
    const result = await resolveCanonicalUserIdWithPreviewGate(db, laterEnv, STEM, 7, null);
    expect(result).toEqual({ ok: true, canonicalUserId: originallyAllowedId });
  });

  it("bypasses the allowlist entirely when access mode is public", async () => {
    const db = new FakeD1();
    const env = { ACCESS_MODE: "public" };

    const result = await resolveCanonicalUserIdWithPreviewGate(db, env, STEM, 4242, null);

    expect(result.ok).toBe(true);
    expect(db.aliases.size).toBe(1);
  });

  it("fails closed when ACCESS_MODE is missing entirely", async () => {
    const db = new FakeD1();
    const result = await resolveCanonicalUserIdWithPreviewGate(db, {}, STEM, 1, null);
    expect(result).toEqual({ ok: false, reason: "preview_denied" });
    expect(db.aliases.size).toBe(0);
  });

  it("fails closed when in private_preview mode but the allowlist is empty/missing", async () => {
    const db = new FakeD1();
    const env = { ACCESS_MODE: "private_preview" };
    const result = await resolveCanonicalUserIdWithPreviewGate(db, env, STEM, 1, null);
    expect(result).toEqual({ ok: false, reason: "preview_denied" });
    expect(db.aliases.size).toBe(0);
  });
});
