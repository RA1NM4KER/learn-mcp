import { describe, expect, it } from "vitest";
import { FakeD1 } from "./fakes/d1.js";
import { randomKeyB64Url } from "./fakes/key.js";
import { D1CredentialResolver, deleteCredential, saveCredential } from "../../src/linking/credential-store.js";
import { importCredentialKey } from "../../src/linking/credential-crypto.js";

const STEM = "https://stemlearn.sun.ac.za";
const SUN = "https://learn.sun.ac.za";
const EMS = "https://emslearn.sun.ac.za";

describe("D1CredentialResolver / saveCredential / deleteCredential", () => {
  it("returns null when no credential is linked", async () => {
    const db = new FakeD1();
    const resolver = new D1CredentialResolver(db, () => importCredentialKey(randomKeyB64Url()));
    expect(await resolver.resolve("user1", STEM)).toBeNull();
  });

  it("does not need a valid encryption key when no row exists", async () => {
    const db = new FakeD1();
    const resolver = new D1CredentialResolver(db, () => importCredentialKey(undefined));
    expect(await resolver.resolve("user1", STEM)).toBeNull();
    expect(await resolver.resolveAll("user1")).toEqual([]);
    expect(await resolver.resolveAnchor("user1")).toBeNull();
  });

  it("saves then resolves a credential for the site it was saved under", async () => {
    const db = new FakeD1();
    const keyB64 = randomKeyB64Url();
    const key = await importCredentialKey(keyB64);
    await saveCredential(db, key, "user1", STEM, "moodle-token-value");
    const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
    expect(await resolver.resolve("user1", STEM)).toEqual({ token: "moodle-token-value" });
  });

  it("never stores the plaintext token", async () => {
    const db = new FakeD1();
    const key = await importCredentialKey(randomKeyB64Url());
    await saveCredential(db, key, "user1", STEM, "super-secret-marker-xyz");
    for (const row of db.credentials.values()) {
      expect(row.encrypted_token).not.toContain("super-secret-marker-xyz");
    }
  });

  it("fails closed (throws) if a row is copied to another user (AAD binding)", async () => {
    const db = new FakeD1();
    const keyB64 = randomKeyB64Url();
    const key = await importCredentialKey(keyB64);
    await saveCredential(db, key, "user1", STEM, "user1-token");
    const row = db.credentials.get("user1\u0000" + STEM)!;
    db.credentials.set("user2\u0000" + STEM, { ...row, user_id: "user2" });

    const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
    await expect(resolver.resolve("user2", STEM)).rejects.toThrow();
    expect(await resolver.resolve("user1", STEM)).toEqual({ token: "user1-token" });
  });

  it("rejects saving to a disallowed Moodle host", async () => {
    const db = new FakeD1();
    const key = await importCredentialKey(randomKeyB64Url());
    await expect(saveCredential(db, key, "user1", "https://evil.example.com", "token")).rejects.toThrow();
  });

  it("fails closed if the stored host is tampered to a disallowed value", async () => {
    const db = new FakeD1();
    const keyB64 = randomKeyB64Url();
    const key = await importCredentialKey(keyB64);
    await saveCredential(db, key, "user1", STEM, "token");
    db.credentials.get("user1\u0000" + STEM)!.moodle_base_url = "https://evil.example.com";

    const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
    await expect(resolver.resolve("user1", STEM)).rejects.toThrow();
  });

  it("deletes a credential for one site only", async () => {
    const db = new FakeD1();
    const keyB64 = randomKeyB64Url();
    const key = await importCredentialKey(keyB64);
    await saveCredential(db, key, "user1", STEM, "token");
    await deleteCredential(db, "user1", STEM);

    const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
    expect(await resolver.resolve("user1", STEM)).toBeNull();
  });

  it("disconnecting one user leaves other users' credentials untouched", async () => {
    const db = new FakeD1();
    const keyB64 = randomKeyB64Url();
    const key = await importCredentialKey(keyB64);
    await saveCredential(db, key, "user1", STEM, "user1-token");
    await saveCredential(db, key, "user2", STEM, "user2-token");
    await deleteCredential(db, "user1", STEM);

    const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
    expect(await resolver.resolve("user1", STEM)).toBeNull();
    expect(await resolver.resolve("user2", STEM)).toEqual({ token: "user2-token" });
  });

  describe("multi-site", () => {
    it("lets one user hold credentials for several sites at once, isolated from each other", async () => {
      const db = new FakeD1();
      const keyB64 = randomKeyB64Url();
      const key = await importCredentialKey(keyB64);
      await saveCredential(db, key, "user1", STEM, "stem-token");
      await saveCredential(db, key, "user1", SUN, "sun-token");

      const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
      expect(await resolver.resolve("user1", STEM)).toEqual({ token: "stem-token" });
      expect(await resolver.resolve("user1", SUN)).toEqual({ token: "sun-token" });
      expect(await resolver.resolve("user1", EMS)).toBeNull();
    });

    it("disconnecting one site removes only that site's credential", async () => {
      const db = new FakeD1();
      const keyB64 = randomKeyB64Url();
      const key = await importCredentialKey(keyB64);
      await saveCredential(db, key, "user1", STEM, "stem-token");
      await saveCredential(db, key, "user1", SUN, "sun-token");
      await deleteCredential(db, "user1", STEM);

      const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
      expect(await resolver.resolve("user1", STEM)).toBeNull();
      expect(await resolver.resolve("user1", SUN)).toEqual({ token: "sun-token" });
    });

    it("resolveAll returns every connected site for a user", async () => {
      const db = new FakeD1();
      const keyB64 = randomKeyB64Url();
      const key = await importCredentialKey(keyB64);
      await saveCredential(db, key, "user1", STEM, "stem-token");
      await saveCredential(db, key, "user1", SUN, "sun-token");
      await saveCredential(db, key, "user2", EMS, "ems-token");

      const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
      const all = await resolver.resolveAll("user1");
      expect(all).toHaveLength(2);
      expect(new Set(all.map((r) => r.baseUrl))).toEqual(new Set([STEM, SUN]));
      expect(new Set(all.map((r) => r.credential.token))).toEqual(new Set(["stem-token", "sun-token"]));
    });

    it("resolveAnchor returns the earliest-linked site and is stable across re-linking", async () => {
      const db = new FakeD1();
      const keyB64 = randomKeyB64Url();
      const key = await importCredentialKey(keyB64);
      await saveCredential(db, key, "user1", STEM, "stem-token-v1");
      await saveCredential(db, key, "user1", SUN, "sun-token");
      // Re-linking STEM must not make SUN the anchor, and must not lose the update.
      await saveCredential(db, key, "user1", STEM, "stem-token-v2");

      const resolver = new D1CredentialResolver(db, () => importCredentialKey(keyB64));
      const anchor = await resolver.resolveAnchor("user1");
      expect(anchor).toEqual({ baseUrl: STEM, credential: { token: "stem-token-v2" } });
    });
  });
});
