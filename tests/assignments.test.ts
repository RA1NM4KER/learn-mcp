import { describe, expect, it, vi } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { getAssignment, listAssignments } from "../src/tools/assignments.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data, text: async () => JSON.stringify(data) });

async function makeClient() {
  mockFetch.mockResolvedValueOnce(jsonResponse({
    userid: 1, sitename: "STEMLearn",
    functions: [{ name: "core_course_get_contents" }, { name: "mod_assign_get_assignments" }],
  }));
  return MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "token" } });
}

describe("listAssignments", () => {
  it("matches an assignment to its course module via cmid, not coursemodule", async () => {
    // Regression: mod_assign_get_assignments names the course-module id
    // "cmid" on a real Moodle server. listAssignments must key its
    // assignment lookup off that real field, or every assignment renders as
    // "details unavailable" even though the API call succeeded.
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse([
      { id: 1, name: "Week 7", modules: [{ id: 92947, name: "Practical 2", modname: "assign" }] },
    ]));
    mockFetch.mockResolvedValueOnce(jsonResponse({
      courses: [{ id: 2722, assignments: [{ id: 6326, cmid: 92947, name: "Practical 2", duedate: 1758830340, grade: 100 }] }],
    }));

    const text = await listAssignments(client, 2722);

    expect(text).not.toContain("details unavailable");
    expect(text).toContain("Practical 2");
    expect(text).toContain("ID: `6326`");
  });
});

describe("getAssignment source status", () => {
  it("reports missing submission and grading fields as unknown", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ userid: 1, sitename: "Test", functions: [{ name: "mod_assign_get_submission_status" }] }));
    const client = await MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "token" } });
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    const text = await getAssignment(client, 1);
    expect(text).toContain("**Status:** Unknown");
    expect(text).toContain("**Graded (assignment API):** Unknown");
    expect(text).not.toContain("Not submitted");
  });
  it("preserves a released source status without claiming gradebook absence", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ userid: 1, sitename: "Test", functions: [{ name: "mod_assign_get_submission_status" }] }));
    const client = await MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "token" } });
    mockFetch.mockResolvedValueOnce(jsonResponse({ lastattempt: { graded: false, gradingstatus: "released" } }));
    const text = await getAssignment(client, 1);
    expect(text).toContain("Assignment API grading status:** released");
    expect(text).toContain("Check moodle_get_grades");
  });
});

describe("assignment instructor attachments", () => {
  const file = { filename: "questions.pdf", fileurl: "https://moodle.test/webservice/pluginfile.php/7/mod_assign/introattachment/0/questions.pdf", filesize: 123, mimetype: "application/pdf" };
  const data = { courses: [{ id: 2, assignments: [{ id: 3, cmid: 4, name: "Assignment 2", intro: '<p>Answer every question.</p><a href="https://moodle.test/pluginfile.php/secret?token=PRIVATE">sheet</a>', introfiles: [file], introattachments: [file] }] }] };
  it("renders instructions and deduplicated sealed files, rechecking membership and current attachment visibility", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse(data));
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 2, fullname: "Course", shortname: "C" }]));
    const text = await getAssignment(client, 3);
    expect(text).toContain("Answer every question.");
    expect(text).not.toContain("pluginfile.php");
    expect(text).not.toContain("PRIVATE");
    expect(text.match(/fileId:/g)).toHaveLength(1);
    const id = text.match(/fileId: `(f_[^`]+)`/)?.[1];
    expect(id).toBeDefined();
    if (!id) throw new Error("Missing file handle");
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 2, fullname: "Course", shortname: "C" }]));
    mockFetch.mockResolvedValueOnce(jsonResponse(data));
    expect((await client.authorizeFile(id))?.assignmentIntroId).toBe(3);
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 2, fullname: "Course", shortname: "C" }]));
    mockFetch.mockResolvedValueOnce(jsonResponse({ courses: [{ id: 2, assignments: [{ id: 3, cmid: 4, name: "Assignment 2" }] }] }));
    expect(await client.authorizeFile(id)).toBeNull();
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    expect(await client.authorizeFile(id)).toBeNull();
  });
  it("bounds instructions and attachments and refuses unsafe destinations", async () => {
    const client = await makeClient();
    const files = Array.from({ length: 35 }, (_, index) => ({ ...file, fileurl: `${file.fileurl}?item=${index}` }));
    files[0] = { ...file, fileurl: "https://evil.test/pluginfile.php/private" };
    mockFetch.mockResolvedValueOnce(jsonResponse({ courses: [{ id: 2, assignments: [{ id: 3, cmid: 4, name: "Assignment", intro: "A".repeat(40000), introattachments: files }] }] }));
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 2, fullname: "Course", shortname: "C" }]));
    const text = await getAssignment(client, 3);
    expect(text).toContain("5 attachments omitted");
    expect(text).toContain("unsafe file link");
    expect(text).not.toContain("evil.test");
    expect(text).not.toContain("A".repeat(30001));
    expect(text.match(/fileId:/g)).toHaveLength(29);
    expect(text.length).toBeLessThanOrEqual(100000);
  });
  it("does not expose attachments when content access is disabled", async () => {
    const client = await makeClient();
    const text = await getAssignment(client, 3, false);
    expect(text).not.toContain("fileId:");
    expect(text).not.toContain("Instructor attachments");
  });
  it("rejects assignment details outside current enrolment", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse(data));
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    expect(await getAssignment(client, 3)).toContain("not among your enrolled courses");
  });
});
