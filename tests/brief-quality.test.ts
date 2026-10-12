import { createAnchorOnlyResolver } from "../src/course-ref-resolver.js";
import { afterEach, expect, it, vi } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { getCourseNotices } from "../src/tools/courses.js";
import { registerComposedTools, studentBrief, upcomingAndOverdue } from "../src/tools/composed.js";
import { checkDocumentDeadline } from "../src/tools/deadline-check.js";
import { makePdf } from "./helpers/pdf.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const json = (value: unknown) => new Response(JSON.stringify(value));
const now = Date.parse("2026-10-12T10:00:00Z");
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
async function client() {
  mockFetch.mockResolvedValueOnce(json({ userid: 1, sitename: "Test" }));
  return MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "fixture" } });
}
function routes(data: Record<string, unknown>) {
  mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
    const fn = new URLSearchParams(String(init?.body)).get("wsfunction") ?? "";
    if (!(fn in data)) throw new Error("unexpected fixture request");
    return json(data[fn]);
  });
}
it("excludes old cancellation notifications from the brief while retaining recent notices and omission count", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  const moodle = await client();
  routes({
    core_enrol_get_users_courses: [],
    message_popup_get_popup_notifications: { notifications: [
      { subject: "September cancellation", text: "No lecture today", timecreated: now / 1000 - 20 * 86400 },
      { subject: "New assignment", text: "Assignment released", timecreated: now / 1000 - 86400 },
    ] },
    core_calendar_get_action_events_by_timesort: { events: [] },
  });
  const text = await studentBrief(moodle);
  expect(text).not.toContain("September cancellation");
  expect(text).toContain("New assignment");
  expect(text).toContain("1 fetched notifications");
  expect(text).not.toContain("### Urgent");
});
it("filters deadlines by site and course without removing genuinely overdue selected work", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  const moodle = await client();
  routes({
    core_enrol_get_users_courses: [{ id: 1, fullname: "Signals", shortname: "SS" }, { id: 2, fullname: "Biochemistry", shortname: "BIO" }],
    mod_assign_get_assignments: { courses: [{ id: 1, assignments: [{ id: 10, cmid: 100, name: "Selected overdue task", duedate: now / 1000 - 86400 }] }] },
    mod_assign_get_submission_status: { lastattempt: { submission: { status: "new" } } },
    gradereport_user_get_grade_items: { usergrades: [] },
  });
  const text = await upcomingAndOverdue(moodle, undefined, [{ baseUrl: moodle.baseUrl, id: 1 }]);
  expect(text).toContain("Selected overdue task");
  expect(text).toContain("Overdue");
  expect(text).not.toContain("Biochemistry");
  const assignCall = mockFetch.mock.calls.find(([, init]) => new URLSearchParams(String(init?.body)).get("wsfunction") === "mod_assign_get_assignments");
  expect(new URLSearchParams(String(assignCall?.[1]?.body)).get("courseids[0]")).toBe("1");
  expect(new URLSearchParams(String(assignCall?.[1]?.body)).get("courseids[1]")).toBeNull();
});
it("offers a bounded full notice that recovers information beyond the excerpt", async () => {
  const moodle = await client();
  const notice = `Practical deadline: 23 October 2026. ${"Preparation instructions. ".repeat(100)} Bring the BLUE laboratory notebook.`;
  routes({ core_course_get_contents: [{ id: 1, name: "Week 12", summary: `<p>${notice}</p>`, modules: [] }] });
  const excerpt = await getCourseNotices(moodle, 1);
  expect(excerpt).toContain("fullText: true");
  expect(excerpt).not.toContain("BLUE");
  expect(await getCourseNotices(moodle, 1, true)).toContain("BLUE");
});
it.each([
  { pdf: "Deadline: 22 October 2026 before midnight.", conflict: true },
  { pdf: "Deadline: 23 October 2026 before midnight.", conflict: false },
  { pdf: "Practical sessions 15 and 22 October 2026. No explicit deadline here.", conflict: false },
  { pdf: "Deadline: 22 October 2026.", conflict: false, assignmentId: 99 },
])("compares explicit PDF deadlines with assignment dates: $pdf", async ({ pdf, conflict, assignmentId = 10 }) => {
  const moodle = await client();
  const bytes = makePdf([pdf]);
  const fileurl = "https://moodle.test/pluginfile.php/1/practical.pdf";
  const fileId = await moodle.fileIdStore.seal({ userId: 1, courseId: 1, filename: "Practical 3.pdf", mime: "application/pdf", filesize: bytes.length, fileurl });
  const course = { id: 1, fullname: "Signals", shortname: "SS" };
  const fixtures = {
    core_enrol_get_users_courses: [course],
    core_course_get_contents: [{ id: 1, name: "Files", modules: [{ id: 1, modname: "resource", name: "Practical", contents: [{ type: "file", filename: "Practical 3.pdf", filesize: bytes.length, fileurl }] }] }],
    mod_assign_get_assignments: { courses: [{ id: 1, assignments: [{ id: 10, name: "Practical 3", cmid: 100, duedate: Date.parse("2026-10-23T21:59:00Z") / 1000 }] }] },
  };
  routes(fixtures);
  const routed = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation((url: string, init?: RequestInit) => new URL(url).pathname.includes("pluginfile.php")
    ? new Response(bytes, { headers: { "content-type": "application/pdf" } }) : routed(url, init));
  const text = await checkDocumentDeadline(moodle, undefined, moodle, assignmentId, fileId);
  expect(text.includes("Conflicting deadline dates")).toBe(conflict);
  if (assignmentId === 99) {
    expect(text).toContain("same course and site");
    expect(mockFetch.mock.calls.some(([url]) => new URL(url).pathname.includes("pluginfile.php"))).toBe(false);
  }
  if (conflict) { expect(text).toContain("22 October"); expect(text).toContain("Moodle assignment:"); }
  if (pdf.startsWith("Practical sessions")) expect(text).toContain("does not verify agreement");
});

it("refuses document checks when remote file content is disabled", async () => {
  const moodle = await client();
  routes({ core_enrol_get_users_courses: [], message_popup_get_popup_notifications: { notifications: [] }, core_calendar_get_action_events_by_timesort: { events: [] } });
  type Handler = (args: { deadlineDocuments?: { assignmentId: number; fileId: string }[] }) => Promise<{ content: { type: string; text: string }[] }>;
  let briefHandler: Handler | undefined;
  const server = { tool: (name: string, _description: string, _schema: unknown, _annotations: unknown, handler: Handler) => { if (name === "student_brief") briefHandler = handler; } };
  registerComposedTools(server as never, moodle, createAnchorOnlyResolver(moodle), undefined, false);
  const result = await briefHandler!({ deadlineDocuments: [{ assignmentId: 10, fileId: "invalid-fixture" }] });
  expect(result.content[0]?.text).toContain("file-content retrieval is disabled");
  expect(mockFetch.mock.calls.some(([url]) => new URL(url).pathname.includes("pluginfile.php"))).toBe(false);
});
