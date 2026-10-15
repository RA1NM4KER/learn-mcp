import { afterEach, describe, expect, it, vi } from "vitest";
import { MoodleClient, MoodleTimeoutError } from "../src/moodle-client.js";
import { mapAccountWideSites, type MultiSiteContext } from "../src/multi-site-context.js";
import { getSiteById } from "../src/sunlearn-sites.js";
import { listCourses } from "../src/tools/courses.js";
import { getNotificationsAccountWide } from "../src/tools/notifications.js";
import { getCalendarEventsAccountWide } from "../src/tools/calendar.js";
import { studentBrief, upcomingAndOverdue } from "../src/tools/composed.js";
import { renderSiteFailures } from "../src/tools/site-failures.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function setup(rejected = true) {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const fn = new URLSearchParams(String(init?.body)).get("wsfunction");
    if (new URL(input).host === "stemlearn.sun.ac.za" && rejected) return Response.json({ exception: "moodle_exception", errorcode: "invalidtoken", message: "SECRET upstream details" });
    if (fn === "core_webservice_get_site_info") return Response.json({ userid: 1, sitename: "Test", functions: [{ name: "core_enrol_get_users_courses" }, { name: "message_popup_get_popup_notifications" }] });
    if (fn === "core_enrol_get_users_courses") return Response.json([{ id: 1, fullname: "Healthy course", shortname: "HC" }]);
    if (fn === "message_popup_get_popup_notifications") return Response.json({ notifications: [], unreadcount: 0 });
    throw new Error("Unexpected fixture function");
  }));
  const anchor = await MoodleClient.create({ baseUrl: "https://learn.sun.ac.za", auth: { kind: "token", token: "SECRET" } });
  const site = getSiteById("stemlearn");
  if (!site) throw new Error("Missing fixture site");
  const context: MultiSiteContext = { anchorSite: { id: "sunlearn", name: "SUNLearn" }, additionalSites: [{ site, config: { baseUrl: site.baseUrl, auth: { kind: "token", token: "SECRET" }, maxFileBytes: 1024, requestTimeoutMs: 100 } }], recoveryOrigin: "https://learnmcp.kefas.co.za/mcp", seal: async (_kind, _site, id) => String(id) };
  return { anchor, context };
}

describe("account-wide partial failures", () => {
  it.each(["courses", "notifications", "calendar", "deadlines", "brief"])("preserves reconnect instructions in %s", async workflow => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { anchor, context } = await setup();
    const text = workflow === "courses" ? await listCourses(anchor, context)
      : workflow === "notifications" ? await getNotificationsAccountWide(anchor, context)
      : workflow === "calendar" ? await getCalendarEventsAccountWide(anchor, context, 14)
      : workflow === "deadlines" ? await upcomingAndOverdue(anchor, context)
      : await studentBrief(anchor, context);
    expect(text).toContain("[Reconnect STEMLearn](https://learnmcp.kefas.co.za/reconnect?site=stemlearn)");
    expect(text).toContain("Results are incomplete");
    expect(text).not.toContain("Temporarily unavailable: STEMLearn");
    expect(text).not.toContain("SECRET");
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
    if (workflow === "courses") expect(text).toContain("Healthy course");
    if (workflow === "calendar") expect(text).not.toContain("No upcoming events");
    if (workflow === "notifications") expect(text).not.toContain("No notifications found");
  });

  it("keeps timeout failures distinct from authentication and retains healthy results", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { anchor, context } = await setup(false);
    const result = await mapAccountWideSites(anchor, context, async (_site, _client, isAnchor) => {
      if (!isAnchor) throw new MoodleTimeoutError();
      return "healthy";
    });
    expect(result.results.map(row => row.value)).toEqual(["healthy"]);
    expect(result.failures).toEqual([{ site: { id: "stemlearn", name: "STEMLearn" }, code: "timeout" }]);
    const text = renderSiteFailures(result.unavailable, result.failures, context);
    expect(text).toContain("Temporarily unavailable: STEMLearn");
    expect(text).not.toContain("Reconnect");
  });
});
