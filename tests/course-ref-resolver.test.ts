import { describe, expect, it, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { CourseRefResolver, createAnchorOnlyResolver } from "../src/course-ref-resolver.js";
import { GlobalRefStore } from "../src/global-ref.js";
import { randomKeyB64Url } from "./linking/fakes/key.js";
import type { Config } from "../src/config.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) });
}

const SITE_INFO = {
  userid: 1,
  username: "student",
  sitename: "Test",
  fullname: "Test Student",
  release: "4.5.8",
  functions: [{ name: "core_course_get_contents", version: "1" }],
};

async function makeAnchorClient() {
  mockFetch.mockResolvedValueOnce(jsonResponse(SITE_INFO));
  return MoodleClient.create({ baseUrl: "https://stemlearn.sun.ac.za", auth: { kind: "token", token: "anchor-tok" } });
}

function emsConfig(): Config {
  return { baseUrl: "https://emslearn.sun.ac.za", maxFileBytes: 1024, requestTimeoutMs: 5000, auth: { kind: "token", token: "ems-tok" } };
}

describe("CourseRefResolver", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a legacy plain number against the anchor site", async () => {
    const client = await makeAnchorClient();
    const resolver = new CourseRefResolver("stemlearn", client, "user1", undefined, async () => null);
    const result = await resolver.resolve("course", 2722);
    expect(result).toEqual({ ok: true, client, id: 2722, siteId: "stemlearn", isAnchor: true });
  });

  it("resolves a sealed ref pointing at the anchor site without building a new client", async () => {
    const client = await makeAnchorClient();
    const store = new GlobalRefStore(randomKeyB64Url());
    const resolver = new CourseRefResolver("stemlearn", client, "user1", store, async () => null);
    const sealed = await store.seal({ userId: "user1", siteId: "stemlearn", kind: "course", id: 42 });

    const result = await resolver.resolve("course", sealed);
    expect(result).toEqual({ ok: true, client, id: 42, siteId: "stemlearn", isAnchor: true });
  });

  it("resolves a sealed ref for a connected non-anchor site by building its own client", async () => {
    const anchorClient = await makeAnchorClient();
    const store = new GlobalRefStore(randomKeyB64Url());
    const resolver = new CourseRefResolver("stemlearn", anchorClient, "user1", store, async (siteId) =>
      siteId === "emslearn" ? emsConfig() : null,
    );
    const sealed = await store.seal({ userId: "user1", siteId: "emslearn", kind: "course", id: 100 });

    mockFetch.mockResolvedValueOnce(jsonResponse({ ...SITE_INFO, sitename: "EMSLearn" }));
    const result = await resolver.resolve("course", sealed);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.id).toBe(100);
    expect(result.siteId).toBe("emslearn");
    expect(result.isAnchor).toBe(false);
    expect(result.client).not.toBe(anchorClient);
  });

  it("caches a non-anchor site's client across multiple resolve calls in the same resolver", async () => {
    const anchorClient = await makeAnchorClient();
    const store = new GlobalRefStore(randomKeyB64Url());
    const resolver = new CourseRefResolver("stemlearn", anchorClient, "user1", store, async () => emsConfig());
    const sealedA = await store.seal({ userId: "user1", siteId: "emslearn", kind: "course", id: 1 });
    const sealedB = await store.seal({ userId: "user1", siteId: "emslearn", kind: "assignment", id: 2 });

    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce(jsonResponse(SITE_INFO));
    const first = await resolver.resolve("course", sealedA);
    const second = await resolver.resolve("assignment", sealedB);
    expect(first.ok && second.ok && first.client === second.client).toBe(true);
    // Only one site-info round trip for the shared client, despite two resolves.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a ref for a site the user has disconnected", async () => {
    const anchorClient = await makeAnchorClient();
    const store = new GlobalRefStore(randomKeyB64Url());
    const resolver = new CourseRefResolver("stemlearn", anchorClient, "user1", store, async () => null);
    const sealed = await store.seal({ userId: "user1", siteId: "emslearn", kind: "course", id: 1 });

    const result = await resolver.resolve("course", sealed);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("isn't connected") });
  });

  it("rejects a ref naming a site outside the registry", async () => {
    const anchorClient = await makeAnchorClient();
    const store = new GlobalRefStore(randomKeyB64Url());
    const resolver = new CourseRefResolver("stemlearn", anchorClient, "user1", store, async () => null);
    const sealed = await store.seal({ userId: "user1", siteId: "not-a-real-site", kind: "course", id: 1 });

    const result = await resolver.resolve("course", sealed);
    expect(result.ok).toBe(false);
  });

  it("rejects a ref sealed for a different user", async () => {
    const anchorClient = await makeAnchorClient();
    const store = new GlobalRefStore(randomKeyB64Url());
    const resolver = new CourseRefResolver("stemlearn", anchorClient, "user1", store, async () => emsConfig());
    const sealed = await store.seal({ userId: "someone-else", siteId: "emslearn", kind: "course", id: 1 });

    const result = await resolver.resolve("course", sealed);
    expect(result.ok).toBe(false);
  });

  it("rejects a sealed ref when no ref store is configured (e.g. stdio/legacy without a key)", async () => {
    const client = await makeAnchorClient();
    const resolver = new CourseRefResolver("stemlearn", client, "user1", undefined, async () => null);
    const result = await resolver.resolve("course", "r_whatever");
    expect(result.ok).toBe(false);
  });

  it("sealIfNeeded passes anchor-site ids through as plain numbers", async () => {
    const client = await makeAnchorClient();
    const store = new GlobalRefStore(randomKeyB64Url());
    const resolver = new CourseRefResolver("stemlearn", client, "user1", store, async () => null);
    expect(await resolver.sealIfNeeded("course", "stemlearn", 42)).toBe(42);
  });

  it("sealIfNeeded seals a non-anchor site's id, and it round-trips back through resolve", async () => {
    const anchorClient = await makeAnchorClient();
    const store = new GlobalRefStore(randomKeyB64Url());
    const resolver = new CourseRefResolver("stemlearn", anchorClient, "user1", store, async () => emsConfig());
    const sealed = await resolver.sealIfNeeded("course", "emslearn", 100);
    expect(typeof sealed).toBe("string");

    mockFetch.mockResolvedValueOnce(jsonResponse(SITE_INFO));
    const result = await resolver.resolve("course", sealed as string);
    expect(result.ok && result.id === 100 && result.siteId === "emslearn").toBe(true);
  });
});

describe("createAnchorOnlyResolver", () => {
  it("treats every reference as a legacy plain number against the given client", async () => {
    const client = await makeAnchorClient();
    const resolver = createAnchorOnlyResolver(client);
    const result = await resolver.resolve("course", 2722);
    expect(result).toEqual({ ok: true, client, id: 2722, siteId: "anchor", isAnchor: true });
  });

  it("rejects a sealed-looking string ref (no multi-site support in this mode)", async () => {
    const client = await makeAnchorClient();
    const resolver = createAnchorOnlyResolver(client);
    const result = await resolver.resolve("course", "r_anything");
    expect(result.ok).toBe(false);
  });
});
