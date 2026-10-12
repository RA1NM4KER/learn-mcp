import { expect, it, vi, afterEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { studentBrief, upcomingAndOverdue } from "../src/tools/composed.js";
import * as calendar from "../src/tools/calendar.js";
import * as notifications from "../src/tools/notifications.js";

afterEach(() => vi.restoreAllMocks());
it("keeps available sections and reads single-site notifications when calendar fails", async () => {
  vi.spyOn(calendar, "getCalendarEventsAccountWide").mockRejectedValue(new Error("private upstream"));
  const notificationRead = vi.spyOn(notifications, "getNotifications").mockResolvedValue("- **Lecture notice**\n  Hello");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ userid: 1, sitename: "Test" }))));
  const client = await MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "fixture" } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]")));
  const result = await studentBrief(client);
  expect(notificationRead).toHaveBeenCalledWith(client, 10);
  expect(result).toContain("Lecture notice");
  expect(result).toContain("Calendar unavailable");
  expect(result).not.toContain("private upstream");
});
it("does not call an unsupported assignment API or claim no enrollment", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ userid: 1, sitename: "Test", functions: [{ name: "core_enrol_get_users_courses" }] })))
    .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 1, shortname: "C", fullname: "Course" }])));
  vi.stubGlobal("fetch", fetchMock);
  const client = await MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "fixture" } });
  const text = await upcomingAndOverdue(client);
  expect(text).not.toContain("not enrolled");
  expect(text).toContain("assignment API");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
