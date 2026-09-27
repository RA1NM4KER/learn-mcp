import { describe, expect, it } from "vitest";
import { GlobalRefStore } from "../src/global-ref.js";
import { randomKeyB64Url } from "./linking/fakes/key.js";

describe("GlobalRefStore", () => {
  it("round-trips a sealed course reference", async () => {
    const store = new GlobalRefStore(randomKeyB64Url());
    const sealed = await store.seal({ userId: "user1", siteId: "stemlearn", kind: "course", id: 3062 });
    expect(sealed.startsWith("r_")).toBe(true);
    expect(await store.open(sealed, "user1", "course")).toEqual({ siteId: "stemlearn", id: 3062 });
  });

  it("round-trips every ref kind", async () => {
    const store = new GlobalRefStore(randomKeyB64Url());
    for (const kind of ["course", "assignment", "quiz", "forum"] as const) {
      const sealed = await store.seal({ userId: "user1", siteId: "emslearn", kind, id: 7 });
      expect(await store.open(sealed, "user1", kind)).toEqual({ siteId: "emslearn", id: 7 });
    }
  });

  it("rejects a ref opened as the wrong kind", async () => {
    const store = new GlobalRefStore(randomKeyB64Url());
    const sealed = await store.seal({ userId: "user1", siteId: "stemlearn", kind: "course", id: 42 });
    expect(await store.open(sealed, "user1", "assignment")).toBeNull();
  });

  it("keeps the same numeric id distinct across two different sites", async () => {
    const store = new GlobalRefStore(randomKeyB64Url());
    const stem = await store.seal({ userId: "user1", siteId: "stemlearn", kind: "course", id: 100 });
    const ems = await store.seal({ userId: "user1", siteId: "emslearn", kind: "course", id: 100 });
    expect(stem).not.toBe(ems);
    expect(await store.open(stem, "user1", "course")).toEqual({ siteId: "stemlearn", id: 100 });
    expect(await store.open(ems, "user1", "course")).toEqual({ siteId: "emslearn", id: 100 });
  });

  it("rejects a sealed ref opened by the wrong user", async () => {
    const store = new GlobalRefStore(randomKeyB64Url());
    const sealed = await store.seal({ userId: "user1", siteId: "stemlearn", kind: "course", id: 42 });
    expect(await store.open(sealed, "user2", "course")).toBeNull();
  });

  it("rejects a tampered envelope", async () => {
    const store = new GlobalRefStore(randomKeyB64Url());
    const sealed = await store.seal({ userId: "user1", siteId: "stemlearn", kind: "course", id: 42 });
    const tampered = sealed.slice(0, -2) + (sealed.at(-2) === "a" ? "b" : "a") + sealed.at(-1);
    expect(await store.open(tampered, "user1", "course")).toBeNull();
  });

  it("rejects garbage input without throwing", async () => {
    const store = new GlobalRefStore(randomKeyB64Url());
    expect(await store.open("not-a-sealed-id", "user1", "course")).toBeNull();
    expect(await store.open("", "user1", "course")).toBeNull();
  });

  it("rejects an expired sealed ref", async () => {
    const store = new GlobalRefStore(randomKeyB64Url(), -1000);
    const sealed = await store.seal({ userId: "user1", siteId: "stemlearn", kind: "course", id: 42 });
    expect(await store.open(sealed, "user1", "course")).toBeNull();
  });

  it("a store derived from a different secret cannot open another store's refs", async () => {
    const storeA = new GlobalRefStore(randomKeyB64Url());
    const storeB = new GlobalRefStore(randomKeyB64Url());
    const sealed = await storeA.seal({ userId: "user1", siteId: "stemlearn", kind: "course", id: 42 });
    expect(await storeB.open(sealed, "user1", "course")).toBeNull();
  });

  it("never leaks the raw id, siteId, or kind as plaintext in the sealed string", async () => {
    const store = new GlobalRefStore(randomKeyB64Url());
    const sealed = await store.seal({ userId: "user1", siteId: "stemlearn", kind: "course", id: 3062 });
    expect(sealed).not.toContain("3062");
    expect(sealed.toLowerCase()).not.toContain("stemlearn");
    expect(sealed.toLowerCase()).not.toContain("course");
  });
});
