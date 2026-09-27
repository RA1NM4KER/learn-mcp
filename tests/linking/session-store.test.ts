import { describe, expect, it } from "vitest";
import { FakeD1 } from "./fakes/d1.js";
import {
  createLinkingSession,
  finalizeLinkingSession,
  loadActiveLinkingSession,
  loadLinkingSessionUserId,
} from "../../src/linking/session-store.js";

const STEM = "https://stemlearn.sun.ac.za";
const EMS = "https://emslearn.sun.ac.za";

describe("session-store", () => {
  it("creates a session that can be loaded while active", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1", STEM);
    expect(await loadActiveLinkingSession(db, created.sessionId)).toEqual({
      userId: "user1", passport: created.passport, oauthRequestJson: null, moodleBaseUrl: STEM,
    });
  });

  it("binds a session to the site it was started for", async () => {
    const db = new FakeD1();
    const stemSession = await createLinkingSession(db, "user1", STEM);
    const emsSession = await createLinkingSession(db, "user1", EMS);
    expect((await loadActiveLinkingSession(db, stemSession.sessionId))?.moodleBaseUrl).toBe(STEM);
    expect((await loadActiveLinkingSession(db, emsSession.sessionId))?.moodleBaseUrl).toBe(EMS);
  });

  it("round-trips an OAuth request payload for OAuth-flavored sessions", async () => {
    const db = new FakeD1();
    const payload = JSON.stringify({ clientId: "abc", redirectUri: "https://client.example/cb", scope: ["stemlearn:read"] });
    const created = await createLinkingSession(db, "oauth-pending", STEM, payload);
    const loaded = await loadActiveLinkingSession(db, created.sessionId);
    expect(loaded?.oauthRequestJson).toBe(payload);
  });

  it("legacy sessions (no oauthRequestJson) are unaffected", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1", STEM);
    const loaded = await loadActiveLinkingSession(db, created.sessionId);
    expect(loaded?.oauthRequestJson).toBeNull();
  });

  it("never stores the raw session id", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1", STEM);
    for (const row of db.sessions.values()) {
      expect(JSON.stringify(row)).not.toContain(created.sessionId);
    }
  });

  it("generates a fresh random passport and session id each time", async () => {
    const db = new FakeD1();
    const a = await createLinkingSession(db, "user1", STEM);
    const b = await createLinkingSession(db, "user1", STEM);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.passport).not.toBe(b.passport);
  });

  it("loading does not consume the session (can be loaded repeatedly)", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1", STEM);
    await loadActiveLinkingSession(db, created.sessionId);
    expect(await loadActiveLinkingSession(db, created.sessionId)).not.toBeNull();
  });

  it("finalize consumes a session exactly once; a second finalize fails", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1", STEM);
    expect(await finalizeLinkingSession(db, created.sessionId, "user1")).toBe(true);
    expect(await finalizeLinkingSession(db, created.sessionId, "user1")).toBe(false);
  });

  it("finalize writes back the given userId (used to record a derived OAuth identity)", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "oauth-pending", STEM);
    await finalizeLinkingSession(db, created.sessionId, "stemlearn-abc123");
    expect(await loadLinkingSessionUserId(db, created.sessionId)).toBe("stemlearn-abc123");
  });

  it("loadLinkingSessionUserId reads a consumed session's userId (post-consent lookup)", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "oauth-pending", STEM);
    expect(await loadLinkingSessionUserId(db, created.sessionId)).toBe("oauth-pending");
    await finalizeLinkingSession(db, created.sessionId, "stemlearn-def456");
    expect(await loadLinkingSessionUserId(db, created.sessionId)).toBe("stemlearn-def456");
  });

  it("loadLinkingSessionUserId returns null for an unknown session id", async () => {
    const db = new FakeD1();
    expect(await loadLinkingSessionUserId(db, "nonexistent")).toBeNull();
  });

  it("does not load a consumed session (replay protection)", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1", STEM);
    await finalizeLinkingSession(db, created.sessionId, "user1");
    expect(await loadActiveLinkingSession(db, created.sessionId)).toBeNull();
  });

  it("does not load or finalize an expired session", async () => {
    const db = new FakeD1();
    const created = await createLinkingSession(db, "user1", STEM);
    for (const row of db.sessions.values()) row.expires_at = Date.now() - 1000;
    expect(await loadActiveLinkingSession(db, created.sessionId)).toBeNull();
    expect(await finalizeLinkingSession(db, created.sessionId, "user1")).toBe(false);
  });

  it("does not load or finalize an unknown session id", async () => {
    const db = new FakeD1();
    expect(await loadActiveLinkingSession(db, "nonexistent")).toBeNull();
    expect(await finalizeLinkingSession(db, "nonexistent", "user1")).toBe(false);
  });
});
