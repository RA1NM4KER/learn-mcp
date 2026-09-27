import { describe, expect, it, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { getNotifications, getNotificationsAccountWide } from "../src/tools/notifications.js";
import type { MultiSiteContext } from "../src/multi-site-context.js";
import { getSiteById } from "../src/sunlearn-sites.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) });
}

function siteInfo(sitename: string) {
  return {
    userid: 1, username: "student", sitename, fullname: "Test Student", release: "4.5.8",
    functions: [{ name: "message_popup_get_popup_notifications", version: "1" }],
  };
}

async function makeClient(host = "https://stemlearn.sun.ac.za") {
  mockFetch.mockResolvedValueOnce(jsonResponse(siteInfo("STEMLearn")));
  return MoodleClient.create({ baseUrl: host, maxFileBytes: 1024, requestTimeoutMs: 5000, auth: { kind: "token", token: "stem-tok" } });
}

function multiSite(additionalSiteIds: string[]): MultiSiteContext {
  return {
    anchorSite: { id: "stemlearn", name: "STEMLearn" },
    additionalSites: additionalSiteIds.map((id) => ({
      site: getSiteById(id)!,
      config: { baseUrl: getSiteById(id)!.baseUrl, maxFileBytes: 1024, requestTimeoutMs: 5000, auth: { kind: "token", token: `${id}-tok` } },
    })),
    seal: async (_kind, _siteId, id) => id,
  };
}

/** Routes fetch by hostname + wsfunction. */
function routedFetch(bySite: Record<string, Record<string, unknown>>) {
  return async (url: string, init?: RequestInit) => {
    const host = new URL(String(url)).host;
    const entry = bySite[host];
    if (!entry) throw new Error(`unexpected host in test: ${host}`);
    const bodyStr = init?.body ? String(init.body) : "";
    for (const [wsfunction, data] of Object.entries(entry)) {
      if (bodyStr.includes(`wsfunction=${wsfunction}`)) return jsonResponse(data);
    }
    throw new Error(`unexpected wsfunction in test body for ${host}: ${bodyStr}`);
  };
}

describe("getNotifications (single-site)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders notifications with unread markers", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({
      notifications: [{ subject: "Grade released", text: "You got 80%", timecreated: 1700000000, read: false }],
      unreadcount: 1,
    }));

    const text = await getNotifications(client, 20);
    expect(text).toContain("Grade released");
    expect(text).toContain("🔵");
    expect(text).toContain("(1 unread)");
  });

  it("reports none found cleanly", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ notifications: [], unreadcount: 0 }));
    expect(await getNotifications(client, 20)).toBe("No notifications found.");
  });
});

describe("getNotificationsAccountWide", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates notifications across every connected site, labels each by site, and sorts newest-first", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(
      routedFetch({
        "stemlearn.sun.ac.za": {
          message_popup_get_popup_notifications: {
            notifications: [{ subject: "STEMLearn older", text: "", timecreated: 1000, read: true }],
            unreadcount: 0,
          },
        },
        "emslearn.sun.ac.za": {
          core_webservice_get_site_info: siteInfo("EMSLearn"),
          message_popup_get_popup_notifications: {
            notifications: [{ subject: "EMSLearn newer", text: "", timecreated: 2000, read: false }],
            unreadcount: 1,
          },
        },
      }),
    );

    const text = await getNotificationsAccountWide(client, multiSite(["emslearn"]), 20);

    expect(text).toContain("EMSLearn newer");
    expect(text).toContain("STEMLearn older");
    expect(text).toContain("_EMSLearn_");
    expect(text).toContain("(1 unread)");
    // Newest first across sites, not grouped by site.
    expect(text.indexOf("EMSLearn newer")).toBeLessThan(text.indexOf("STEMLearn older"));
  });

  it("caps the MERGED result to limit rather than returning limit-per-site unbounded", async () => {
    const client = await makeClient();
    const makeNotifs = (prefix: string, count: number, startTs: number) =>
      Array.from({ length: count }, (_, i) => ({ subject: `${prefix} ${i}`, text: "", timecreated: startTs + i, read: true }));

    mockFetch.mockImplementation(
      routedFetch({
        "stemlearn.sun.ac.za": {
          message_popup_get_popup_notifications: { notifications: makeNotifs("stem", 5, 1000), unreadcount: 0 },
        },
        "emslearn.sun.ac.za": {
          core_webservice_get_site_info: siteInfo("EMSLearn"),
          message_popup_get_popup_notifications: { notifications: makeNotifs("ems", 5, 2000), unreadcount: 0 },
        },
      }),
    );

    const text = await getNotificationsAccountWide(client, multiSite(["emslearn"]), 3);
    const renderedCount = (text.match(/\*\*(stem|ems) \d+\*\*/g) ?? []).length;
    expect(renderedCount).toBe(3);
    // Newest-first across the merge: all 3 should be "ems" (higher timestamps).
    expect(text).not.toContain("**stem");
  });

  it("tolerates one unreachable site without failing the whole call", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const host = new URL(String(url)).host;
      if (host === "emslearn.sun.ac.za") throw new Error("simulated network failure");
      const bodyStr = init?.body ? String(init.body) : "";
      if (bodyStr.includes("wsfunction=message_popup_get_popup_notifications")) {
        return jsonResponse({ notifications: [{ subject: "Still works", text: "", timecreated: 1, read: true }], unreadcount: 0 });
      }
      throw new Error(`unexpected request: ${bodyStr}`);
    });

    const text = await getNotificationsAccountWide(client, multiSite(["emslearn"]), 20);
    expect(text).toContain("Still works");
    expect(text).toContain("Temporarily unavailable");
    expect(text).toContain("EMSLearn");
  });

  it("falls back to exactly the single-site rendering when there are no additional connected sites", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse({ notifications: [{ subject: "Solo", text: "", timecreated: 1, read: false }], unreadcount: 1 }));

    const text = await getNotificationsAccountWide(client, multiSite([]), 20);
    expect(text).toContain("Solo");
    expect(text).not.toContain("_STEMLearn_");
  });
});
