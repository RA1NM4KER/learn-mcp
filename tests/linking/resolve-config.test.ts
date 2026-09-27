import { describe, expect, it } from "vitest";
import { FakeD1 } from "./fakes/d1.js";
import { randomKeyB64Url } from "./fakes/key.js";
import { saveCredential } from "../../src/linking/credential-store.js";
import { importCredentialKey } from "../../src/linking/credential-crypto.js";
import {
  AccountLinkRequiredError,
  resolveAllMoodleConfigsForOAuthUser,
  resolveMoodleConfig,
  resolveMoodleConfigForOAuthUser,
  resolveMoodleConfigForSite,
} from "../../src/linking/resolve-config.js";
import type { MoodleResolverEnv } from "../../src/linking/resolve-config.js";
import { getSiteById } from "../../src/sunlearn-sites.js";

const STEM = "https://stemlearn.sun.ac.za";
const SUN = "https://learn.sun.ac.za";

function makeEnv(overrides: Partial<MoodleResolverEnv> = {}): MoodleResolverEnv & { DB: FakeD1 } {
  return { DB: new FakeD1(), CREDENTIAL_ENCRYPTION_KEY: randomKeyB64Url(), ...overrides };
}

describe("resolveMoodleConfigForOAuthUser", () => {
  it("throws AccountLinkRequiredError when nothing is linked", async () => {
    const env = makeEnv();
    await expect(resolveMoodleConfigForOAuthUser("user1", env)).rejects.toThrow(AccountLinkRequiredError);
  });

  it("resolves the anchor (earliest-linked) site's own base URL and token", async () => {
    const env = makeEnv();
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, "user1", STEM, "stem-token");
    await saveCredential(env.DB, key, "user1", SUN, "sun-token");

    const config = await resolveMoodleConfigForOAuthUser("user1", env);
    expect(config.baseUrl).toBe(STEM);
    expect(config.auth).toEqual({ kind: "token", token: "stem-token" });
  });

  it("never falls back to another user's credential", async () => {
    const env = makeEnv();
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, "user2", STEM, "user2-token");
    await expect(resolveMoodleConfigForOAuthUser("user1", env)).rejects.toThrow(AccountLinkRequiredError);
  });
});

describe("resolveAllMoodleConfigsForOAuthUser", () => {
  it("returns an empty array when nothing is linked", async () => {
    const env = makeEnv();
    expect(await resolveAllMoodleConfigsForOAuthUser("user1", env)).toEqual([]);
  });

  it("returns a Config paired with the registry site for every linked site", async () => {
    const env = makeEnv();
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, "user1", STEM, "stem-token");
    await saveCredential(env.DB, key, "user1", SUN, "sun-token");

    const all = await resolveAllMoodleConfigsForOAuthUser("user1", env);
    expect(all).toHaveLength(2);
    const bySite = Object.fromEntries(all.map((r) => [r.site.id, r.config]));
    expect(bySite["stemlearn"]?.baseUrl).toBe(STEM);
    expect(bySite["stemlearn"]?.auth).toEqual({ kind: "token", token: "stem-token" });
    expect(bySite["sunlearn"]?.baseUrl).toBe(SUN);
    expect(bySite["sunlearn"]?.auth).toEqual({ kind: "token", token: "sun-token" });
  });

  it("isolates users from each other", async () => {
    const env = makeEnv();
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, "user1", STEM, "user1-token");
    await saveCredential(env.DB, key, "user2", SUN, "user2-token");

    const user1All = await resolveAllMoodleConfigsForOAuthUser("user1", env);
    expect(user1All.map((r) => r.site.id)).toEqual(["stemlearn"]);
  });
});

describe("resolveMoodleConfig (legacy lane)", () => {
  it("falls back to the env secret when DEFAULT_USER_ID has no linked credential", async () => {
    const env = makeEnv({ MOODLE_URL: STEM, MOODLE_TOKEN: "env-secret-token" });
    const config = await resolveMoodleConfig("default", env);
    expect(config.baseUrl).toBe(STEM);
    expect(config.auth).toEqual({ kind: "token", token: "env-secret-token" });
  });

  it("prefers a linked anchor credential over the env secret", async () => {
    const env = makeEnv({ MOODLE_URL: STEM, MOODLE_TOKEN: "env-secret-token" });
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, "default", SUN, "linked-token");

    const config = await resolveMoodleConfig("default", env);
    expect(config.baseUrl).toBe(SUN);
    expect(config.auth).toEqual({ kind: "token", token: "linked-token" });
  });
});

describe("resolveMoodleConfigForSite", () => {
  it("returns null when the user hasn't connected that site", async () => {
    const env = makeEnv();
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, "user1", STEM, "stem-token");

    expect(await resolveMoodleConfigForSite("user1", getSiteById("emslearn")!, env)).toBeNull();
  });

  it("returns that site's own config when connected", async () => {
    const env = makeEnv();
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, "user1", STEM, "stem-token");
    await saveCredential(env.DB, key, "user1", SUN, "sun-token");

    const config = await resolveMoodleConfigForSite("user1", getSiteById("sunlearn")!, env);
    expect(config?.baseUrl).toBe(SUN);
    expect(config?.auth).toEqual({ kind: "token", token: "sun-token" });
  });

  it("never returns another user's credential", async () => {
    const env = makeEnv();
    const key = await importCredentialKey(env.CREDENTIAL_ENCRYPTION_KEY);
    await saveCredential(env.DB, key, "user2", STEM, "user2-token");
    expect(await resolveMoodleConfigForSite("user1", getSiteById("stemlearn")!, env)).toBeNull();
  });
});
