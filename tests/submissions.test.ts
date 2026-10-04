import { describe, expect, it, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { createAnchorOnlyResolver } from "../src/course-ref-resolver.js";
import { registerSubmissionTools } from "../src/tools/submissions.js";
import { FileIdStore } from "../src/file-id-store.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const BASE = "https://moodle.test";
const FILE_URL = `${BASE}/webservice/pluginfile.php/1/assignsubmission_file/submission_files/1/prac3.pdf`;
const TA_USER_ID = 99;

const FUNCTIONS = [
  "mod_assign_get_assignments",
  "mod_assign_get_submissions",
  "mod_assign_list_participants",
  "core_group_get_activity_allowed_groups",
  "core_webservice_get_site_info",
].map((name) => ({ name }));

const WEDNESDAY = { id: 11, name: "Prac 3 Wednesday 14:00 Bench 4-31" };
const FRIDAY = { id: 12, name: "Prac 3 Friday Bench 1" };

type Handler = (body: URLSearchParams) => unknown;
type Overrides = Partial<Record<string, unknown | Handler>>;

const json = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
  text: async () => JSON.stringify(data),
  headers: new Headers(),
});

/** Routes each mocked fetch by wsfunction name, so call order does not matter. */
function wire(overrides: Overrides = {}, assignment: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    core_webservice_get_site_info: { userid: TA_USER_ID, sitename: "STEMLearn", functions: FUNCTIONS },
    mod_assign_get_assignments: {
      courses: [{ id: 2722, assignments: [{ id: 6326, cmid: 92947, name: "Practical 3 Submission", grade: 100, teamsubmission: 0, ...assignment }] }],
    },
    core_group_get_activity_allowed_groups: { groups: [WEDNESDAY, FRIDAY] },
    mod_assign_list_participants: () => participants(),
    mod_assign_get_submissions: { assignments: [{ assignmentid: 6326, submissions: submissions() }], warnings: [] },
    ...overrides,
  };
  mockFetch.mockImplementation(async (url: string, init: { body?: URLSearchParams }) => {
    if (url.includes("pluginfile.php")) {
      return { ok: true, status: 200, headers: new Headers({ "content-type": "application/pdf" }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    }
    const fn = init.body?.get("wsfunction") ?? "";
    const entry = defaults[fn];
    if (entry === undefined) return json({ exception: "moodle_exception", errorcode: "nofunction", message: "not mocked" });
    const data = typeof entry === "function" ? (entry as Handler)(init.body!) : entry;
    return json(data);
  });
}

function participants() {
  return [
    { id: 1001, fullname: "Alice Ndlovu", username: "alice", idnumber: "00123", groups: [WEDNESDAY] },
    { id: 1002, fullname: "Bob Mokoena", username: "bob", idnumber: "123", groups: [FRIDAY] },
    { id: 1003, fullname: "Carol Dube", username: "carol", idnumber: "00555", groups: [] },
    { id: 1004, fullname: "Dan Khumalo", username: "dan", idnumber: "00555", groups: [] },
    { id: 1005, fullname: "Eve Naidoo", username: "eve", idnumber: "00777", groups: [] },
  ];
}

function fileAttachment(filename = "prac3.pdf") {
  return {
    type: "file",
    fileareas: [{ area: "submission_files", files: [{ filename, filesize: 2048, mimetype: "application/pdf", fileurl: FILE_URL }] }],
  };
}

function submissions() {
  return [
    { id: 1, userid: 1001, groupid: 0, attemptnumber: 0, status: "submitted", latest: 0, timemodified: 1700000000, plugins: [fileAttachment()] },
    { id: 2, userid: 1001, groupid: 0, attemptnumber: 1, status: "submitted", latest: 1, timemodified: 1700003600, plugins: [fileAttachment("prac3-v2.pdf")] },
    { id: 3, userid: 1002, groupid: 0, attemptnumber: 0, status: "draft", latest: 1, timemodified: 1700000500, plugins: [{ type: "file", fileareas: [{ area: "submission_files", files: [] }] }] },
  ];
}

async function client(): Promise<MoodleClient> {
  mockFetch.mockResolvedValueOnce(json({ userid: TA_USER_ID, sitename: "STEMLearn", functions: FUNCTIONS }));
  return MoodleClient.create({ baseUrl: BASE, auth: { kind: "token", token: "token" } });
}

function capture(c: MoodleClient, contentEnabled = true) {
  const tools = new Map<string, (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: { text: string }[] }>>();
  const server = {
    tool: (name: string, _description: string, _schema: unknown, handler: never) => { tools.set(name, handler); },
  };
  registerSubmissionTools(server as never, createAnchorOnlyResolver(c), contentEnabled);
  return tools;
}

async function run(
  c: MoodleClient,
  tool: "moodle_list_assignment_submissions" | "moodle_list_assignment_groups",
  args: Record<string, unknown>,
  contentEnabled = true,
) {
  const handler = capture(c, contentEnabled).get(tool)!;
  return handler({ courseId: 2722, assignmentId: 6326, ...args });
}

const textOf = (result: { content: { text: string }[] }) => result.content.map((c) => c.text).join("\n");
const fileIdsIn = (text: string) => text.match(/f_[A-Za-z0-9_-]+/g) ?? [];

describe("moodle_list_assignment_submissions: exact student-number matching", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("keeps leading zeros significant so 00123 and 123 are different students", async () => {
    wire();
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["00123", "123"] }));

    expect(text).toContain("`00123`: **matched**, Alice Ndlovu");
    expect(text).toContain("`123`: **matched**, Bob Mokoena");
  });

  it("reports unmatched numbers explicitly", async () => {
    wire();
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["99999"] }));
    expect(text).toContain("`99999`: **unmatched**");
  });

  it("refuses to pick one of several participants sharing a student number", async () => {
    wire();
    const c = await client();
    const result = await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["00555"] });
    const text = textOf(result);

    expect(text).toContain("`00555`: **ambiguous**, 2 participants");
    expect(text).toContain("Nothing was selected or downloaded");
    expect(fileIdsIn(text)).toHaveLength(0);
  });

  it("marks a matched student with no submission as not submitted", async () => {
    wire();
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["00777"] }));
    expect(text).toContain("`00777`: **matched**, Eve Naidoo");
    expect(text).toContain("- Not submitted");
  });

  it("reports inaccessible, not unmatched, when Moodle returns no student numbers", async () => {
    wire({
      mod_assign_list_participants: () => participants().map((p) => ({ ...p, idnumber: null })),
    });
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["00123"] }));
    expect(text).toContain("`00123`: **inaccessible**");
    expect(text).not.toContain("unmatched");
  });

  it("does not claim a number is absent when the participant scan hit its page cap", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: 5000 + i, fullname: `Student ${i}`, idnumber: `N${i}`, groups: [] }));
    wire({ mod_assign_list_participants: () => fullPage });
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["NOPE"] }));

    expect(text).toContain("**not found** within the scanned participants (scan limit reached)");
    expect(text).toContain("scan limit reached; results may be incomplete");
    expect(text).not.toContain("**unmatched**");
  });

  it("pages participants in bounded batches with explicit offsets", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: 5000 + i, fullname: `S${i}`, idnumber: `N${i}`, groups: [] }));
    wire({ mod_assign_list_participants: () => fullPage });
    const c = await client();
    await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["N5"] });

    const skips = mockFetch.mock.calls
      .map(([, init]) => (init as { body: URLSearchParams }).body)
      .filter((body) => body.get("wsfunction") === "mod_assign_list_participants")
      .map((body) => body.get("skip"));
    expect(skips.length).toBe(20);
    expect(skips.slice(0, 3)).toEqual(["0", "100", "200"]);
  });

  it("refuses more than 25 student numbers per call", async () => {
    wire();
    const c = await client();
    const numbers = Array.from({ length: 26 }, (_, i) => `N${i}`);
    const result = await run(c, "moodle_list_assignment_submissions", { studentNumbers: numbers });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("at most 25");
  });

  it("requires a student number, a group, or both", async () => {
    wire();
    const c = await client();
    const result = await run(c, "moodle_list_assignment_submissions", {});
    expect(result.isError).toBe(true);
  });
});

describe("moodle_list_assignment_submissions: groups", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("filters by exact group name and passes the resolved group ID to Moodle", async () => {
    wire();
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { group: WEDNESDAY.name }));

    const groupCalls = mockFetch.mock.calls
      .map(([, init]) => (init as { body: URLSearchParams }).body)
      .filter((body) => body.get("wsfunction") === "mod_assign_list_participants")
      .map((body) => body.get("groupid"));
    expect(groupCalls[0]).toBe("11");
    expect(text).toContain("Group filter: **Prac 3 Wednesday 14:00 Bench 4-31**");
  });

  it("rejects a group ID that the assignment's restrictions do not allow", async () => {
    wire();
    const c = await client();
    const result = await run(c, "moodle_list_assignment_submissions", { group: 999 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Group 999 is not available");
  });

  it("refuses an ambiguous group name instead of guessing", async () => {
    wire({ core_group_get_activity_allowed_groups: { groups: [{ id: 21, name: "Bench 1" }, { id: 22, name: "bench 1" }] } });
    const c = await client();
    const result = await run(c, "moodle_list_assignment_submissions", { group: "Bench 1" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("More than one group");
  });

  it("lists allowed groups with their IDs", async () => {
    wire();
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_groups", {}));
    expect(text).toContain(`group ID \`11\``);
    expect(text).toContain(`group ID \`12\``);
  });
});

describe("moodle_list_assignment_submissions: attempts, drafts, shared groups", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("shows every attempt newest first and does not silently pick one", async () => {
    wire();
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["00123"] }));

    expect(text).toContain("- Attempt 1, latest: Submitted");
    expect(text).toContain("- Attempt 0: Submitted");
    expect(text.indexOf("Attempt 1")).toBeLessThan(text.indexOf("Attempt 0"));
    expect(fileIdsIn(text)).toHaveLength(2);
  });

  it("labels drafts as not submitted for grading", async () => {
    wire();
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["123"] }));
    expect(text).toContain("Draft (not submitted for grading)");
    expect(text).toContain("No file attachments on this attempt");
  });

  it("lists each shared group submission once, so its file is not issued twice", async () => {
    const teamParticipants = [
      { id: 2001, fullname: "Member One", idnumber: "A100", groups: [WEDNESDAY] },
      { id: 2002, fullname: "Member Two", idnumber: "A101", groups: [WEDNESDAY] },
    ];
    wire({
      mod_assign_list_participants: () => teamParticipants,
      mod_assign_get_submissions: {
        assignments: [{ assignmentid: 6326, submissions: [
          { id: 9, userid: 0, groupid: 11, attemptnumber: 0, status: "submitted", latest: 1, timemodified: 1700000000, plugins: [fileAttachment()] },
        ] }],
      },
    }, { teamsubmission: 1 });
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["A100", "A101"] }));

    expect(text).toContain("`A100`: **matched**, Member One");
    expect(text).toContain("`A101`: **matched**, Member Two");
    expect(text).toContain("Shared group submission for Prac 3 Wednesday 14:00 Bench 4-31");
    expect(text).toContain("Shared group submission (Prac 3 Wednesday 14:00 Bench 4-31), listed above");
    expect(fileIdsIn(text)).toHaveLength(1);
  });

  it("says when a student has no group submission on a team assignment", async () => {
    wire({
      mod_assign_list_participants: () => [{ id: 3001, fullname: "Loner", idnumber: "L1", groups: [] }],
      mod_assign_get_submissions: { assignments: [{ assignmentid: 6326, submissions: [] }] },
    }, { teamsubmission: 1 });
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["L1"] }));
    expect(text).toContain("`L1`: **matched**, Loner");
    expect(text).toContain("- Not submitted");
  });
});

describe("moodle_list_assignment_submissions: fileIds and permissions", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("issues fileIds bound to this account and this assignment", async () => {
    wire();
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["00123"] }));
    const [sealed] = fileIdsIn(text);

    const ref = await c.fileIdStore.open(sealed!, TA_USER_ID);
    expect(ref).toMatchObject({ fileurl: FILE_URL, mime: "application/pdf", filename: "prac3-v2.pdf", assignmentId: 6326, courseId: 2722 });
    expect(await c.fileIdStore.open(sealed!, 1)).toBeNull();
  });

  it("omits fileIds and says so when downloads are disabled on the deployment", async () => {
    wire();
    const c = await client();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["00123"] }, false));
    expect(fileIdsIn(text)).toHaveLength(0);
    expect(text).toContain("File downloads are not enabled on this deployment");
    expect(text).toContain("prac3.pdf");
  });

  it("returns an explicit permission message without forwarding upstream text", async () => {
    wire({
      mod_assign_get_submissions: { exception: "required_capability_exception", errorcode: "nopermissions", message: "Sorry, you do not have permission secret-detail" },
    });
    const c = await client();
    const result = await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["00123"] });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("grading access");
    expect(textOf(result)).not.toContain("secret-detail");
  });

  it("returns not-found for an assignment outside the course", async () => {
    wire({ mod_assign_get_assignments: { courses: [{ id: 2722, assignments: [] }] } });
    const c = await client();
    const result = await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["00123"] });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not found in this course");
  });
});

describe("submission fileIds in moodle_download_file (authorizeFile)", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  async function sealedFileId(c: MoodleClient): Promise<string> {
    wire();
    const text = textOf(await run(c, "moodle_list_assignment_submissions", { studentNumbers: ["00123"] }));
    return fileIdsIn(text)[0]!;
  }

  it("authorises and downloads a submission file that is still in the assignment", async () => {
    const c = await client();
    const sealed = await sealedFileId(c);
    wire();
    const result = await c.downloadAuthorizedFile(sealed);
    expect(result?.ref.fileurl).toBe(FILE_URL);
    expect(Array.from(result!.downloaded.bytes)).toEqual([1, 2, 3]);
  });

  it("denies a submission file that has been removed from the assignment", async () => {
    const c = await client();
    const sealed = await sealedFileId(c);
    wire({ mod_assign_get_submissions: { assignments: [{ assignmentid: 6326, submissions: [] }] } });
    expect(await c.authorizeFile(sealed)).toBeNull();
  });

  it("denies a submission file when Moodle refuses the grading lookup", async () => {
    const c = await client();
    const sealed = await sealedFileId(c);
    wire({ mod_assign_get_submissions: { exception: "required_capability_exception", errorcode: "nopermissions", message: "no" } });
    expect(await c.authorizeFile(sealed)).toBeNull();
  });

  it("denies a submission fileId issued to a different account or token", async () => {
    const c = await client();
    const sealed = await sealedFileId(c);
    // Same user ID, different token: the sealing key is token-derived, so it must not open.
    expect(await new FileIdStore("another-account-token").open(sealed, TA_USER_ID)).toBeNull();
    expect(await c.fileIdStore.open(sealed, TA_USER_ID + 1)).toBeNull();
  });
});
