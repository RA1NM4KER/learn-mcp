import { describe, expect, it, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import type { Config } from "../src/config.js";
import { CourseRefResolver } from "../src/course-ref-resolver.js";
import { GlobalRefStore } from "../src/global-ref.js";
import { registerGradeTools } from "../src/tools/grades.js";
import { registerAssignmentTools } from "../src/tools/assignments.js";
import { registerFileTools } from "../src/tools/files.js";
import { registerDownloadTool } from "../src/tools/download.js";
import { registerComposedTools } from "../src/tools/composed.js";
import { getSiteById } from "../src/sunlearn-sites.js";
import type { MultiSiteContext } from "../src/multi-site-context.js";

// End-to-end proof that a single opaque course reference — exactly the kind
// moodle_list_courses would hand back for a course on a non-anchor SUNLearn
// site — flows unchanged into every other course-scoped tool and dispatches
// to the right site's Moodle instance, rather than "list gets an opaque id,
// every other tool wants a number" (the inconsistency this refactor exists
// to remove).

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) });
}

function siteInfo(sitename: string, extraFunctions: string[] = []) {
  return {
    userid: 1,
    username: "student",
    sitename,
    fullname: "Test Student",
    release: "4.5.8",
    functions: [
      { name: "core_course_get_contents", version: "1" },
      { name: "gradereport_user_get_grade_items", version: "1" },
      { name: "mod_assign_get_assignments", version: "1" },
      { name: "mod_assign_get_submission_status", version: "1" },
      ...extraFunctions.map((name) => ({ name, version: "1" })),
    ],
  };
}

/** Routes fetch by hostname + wsfunction, so concurrent/interleaved site clients never consume each other's queued responses. */
function routedFetch(bySite: Record<string, Record<string, unknown>>) {
  return async (url: string, init?: RequestInit) => {
    const host = new URL(String(url)).host;
    const bySiteEntry = bySite[host];
    if (!bySiteEntry) throw new Error(`unexpected host in test: ${host}`);
    const bodyStr = init?.body ? String(init.body) : "";
    for (const [wsfunction, data] of Object.entries(bySiteEntry)) {
      if (bodyStr.includes(`wsfunction=${wsfunction}`)) return jsonResponse(data);
    }
    throw new Error(`unexpected wsfunction in test body for ${host}: ${bodyStr}`);
  };
}

function emsConfig(): Config {
  return { baseUrl: "https://emslearn.sun.ac.za", maxFileBytes: 25 * 1024 * 1024, requestTimeoutMs: 20_000, auth: { kind: "token", token: "ems-tok" } };
}

// Minimal fake McpServer that just captures the registered tool handler.
function captureTool() {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>>();
  const server = { tool: (name: string, _desc: string, _schema: unknown, handler: typeof handlers extends Map<string, infer H> ? H : never) => { handlers.set(name, handler); } };
  return { server: server as never, handlers };
}

async function makeResolver() {
  mockFetch.mockResolvedValueOnce(jsonResponse(siteInfo("STEMLearn")));
  const anchorClient = await MoodleClient.create({ baseUrl: "https://stemlearn.sun.ac.za", maxFileBytes: 25 * 1024 * 1024, requestTimeoutMs: 20_000, auth: { kind: "token", token: "stem-tok" } });
  const refStore = new GlobalRefStore("dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1mb3ItdGVzdGluZyEh".replace(/=+$/, ""));
  const resolver = new CourseRefResolver("stemlearn", anchorClient, "user1", refStore, async (siteId) => (siteId === "emslearn" ? emsConfig() : null));
  return { anchorClient, resolver, refStore };
}

describe("opaque course ref flowing from listing into every course-scoped tool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("get_grades dispatches a sealed EMSLearn course ref to EMSLearn, not STEMLearn", async () => {
    const { resolver, refStore } = await makeResolver();
    const sealedRef = await refStore.seal({ userId: "user1", siteId: "emslearn", kind: "course", id: 100 });

    mockFetch.mockImplementation(
      routedFetch({
        "emslearn.sun.ac.za": {
          core_webservice_get_site_info: siteInfo("EMSLearn"),
          gradereport_user_get_grade_items: {
            usergrades: [{ courseid: 100, gradeitems: [{ itemtype: "course", gradeformatted: "78.00", grademax: 100, percentageformatted: "78%" }] }],
          },
        },
      }),
    );

    const { server, handlers } = captureTool();
    registerGradeTools(server, resolver);
    const result = await handlers.get("moodle_get_grades")!({ courseId: sealedRef });

    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain("78.00");
  });

  it("list_assignments dispatches a sealed EMSLearn course ref to EMSLearn", async () => {
    const { resolver, refStore } = await makeResolver();
    const sealedRef = await refStore.seal({ userId: "user1", siteId: "emslearn", kind: "course", id: 100 });

    mockFetch.mockImplementation(
      routedFetch({
        "emslearn.sun.ac.za": {
          core_webservice_get_site_info: siteInfo("EMSLearn"),
          core_course_get_contents: [{ id: 100, name: "Week 1", modules: [{ id: 5, name: "Assignment 1", modname: "assign" }] }],
          mod_assign_get_assignments: { courses: [{ id: 100, assignments: [{ id: 9001, cmid: 5, name: "Assignment 1", duedate: 0, grade: 100 }] }] },
        },
      }),
    );

    const { server, handlers } = captureTool();
    registerAssignmentTools(server, resolver);
    const result = await handlers.get("moodle_list_assignments")!({ courseId: sealedRef });

    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain("Assignment 1");
    // The assignment id itself must ALSO be sealed (non-anchor site) — a plain "9001" would be
    // ambiguous once passed to moodle_get_assignment, which has no idea which site it came from.
    expect(result.content[0]!.text).not.toContain("ID: `9001`");
    expect(result.content[0]!.text).toMatch(/ID: `r_/);
  });

  it("list_resources dispatches a sealed EMSLearn course ref to EMSLearn", async () => {
    const { resolver, refStore } = await makeResolver();
    const sealedRef = await refStore.seal({ userId: "user1", siteId: "emslearn", kind: "course", id: 100 });

    mockFetch.mockImplementation(
      routedFetch({
        "emslearn.sun.ac.za": {
          core_webservice_get_site_info: siteInfo("EMSLearn"),
          core_course_get_contents: [
            {
              id: 100,
              name: "Week 1",
              modules: [{ id: 5, name: "Reading", modname: "resource", contents: [{ type: "file", filename: "reading.pdf", fileurl: "https://emslearn.sun.ac.za/x/1", filesize: 100 }] }],
            },
          ],
        },
      }),
    );

    const { server, handlers } = captureTool();
    registerFileTools(server, resolver);
    const result = await handlers.get("moodle_list_resources")!({ courseId: sealedRef });

    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain("reading.pdf");
    // A non-anchor site mints a real, usable fileId (see the download dispatch tests below).
    expect(result.content[0]!.text).not.toContain("download not yet supported");
    expect(result.content[0]!.text).toMatch(/fileId: `[^`]+`/);
  });

  it("course_overview dispatches a sealed EMSLearn course ref to EMSLearn", async () => {
    const { resolver, refStore, anchorClient } = await makeResolver();
    const sealedRef = await refStore.seal({ userId: "user1", siteId: "emslearn", kind: "course", id: 100 });

    mockFetch.mockImplementation(
      routedFetch({
        "emslearn.sun.ac.za": {
          core_webservice_get_site_info: siteInfo("EMSLearn"),
          core_enrol_get_users_courses: [{ id: 100, fullname: "Financial Accounting 178", shortname: "REK178" }],
          core_course_get_contents: [{ id: 100, name: "Week 1", summary: "", modules: [] }],
          mod_assign_get_assignments: { courses: [{ id: 100, assignments: [] }] },
          gradereport_user_get_grade_items: { usergrades: [{ courseid: 100, gradeitems: [] }] },
        },
      }),
    );

    const { server, handlers } = captureTool();
    registerComposedTools(server, anchorClient, resolver);
    const result = await handlers.get("course_overview")!({ courseId: sealedRef });

    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain("Financial Accounting 178");
  });

  it("course_overview seals a non-anchor assignment id, and that exact ref works unchanged in moodle_get_assignment", async () => {
    // Regression: course_overview used to render `ID: <raw numeric id>` for
    // an upcoming assignment even on a non-anchor site — moodle_get_assignment
    // has no way to know that raw id belongs to a different Moodle instance,
    // so it silently routed it to the anchor and failed. course_overview must
    // seal it exactly like moodle_list_assignments does (same SubRefSealer).
    const { resolver, refStore, anchorClient } = await makeResolver();
    const sealedCourseRef = await refStore.seal({ userId: "user1", siteId: "emslearn", kind: "course", id: 100 });
    const now = Math.floor(Date.now() / 1000);

    mockFetch.mockImplementation(
      routedFetch({
        "emslearn.sun.ac.za": {
          core_webservice_get_site_info: siteInfo("EMSLearn"),
          core_enrol_get_users_courses: [{ id: 100, fullname: "Financial Accounting 178", shortname: "REK178" }],
          core_course_get_contents: [{ id: 100, name: "Week 1", summary: "", modules: [] }],
          mod_assign_get_assignments: {
            courses: [{ id: 100, assignments: [{ id: 6326, cmid: 1, name: "Practical 2", duedate: now + 86400, grade: 100 }] }],
          },
          gradereport_user_get_grade_items: { usergrades: [{ courseid: 100, gradeitems: [] }] },
          mod_assign_get_submission_status: { lastattempt: { submission: { status: "submitted" } } },
        },
      }),
    );

    const { server, handlers } = captureTool();
    registerComposedTools(server, anchorClient, resolver);
    registerAssignmentTools(server, resolver);

    const overview = await handlers.get("course_overview")!({ courseId: sealedCourseRef });
    expect(overview.isError).toBeFalsy();
    const overviewText = overview.content[0]!.text;
    expect(overviewText).toContain("Practical 2");
    // The raw numeric id must never appear unsealed — only an opaque r_... ref.
    expect(overviewText).not.toContain("ID: `6326`");
    // Matches the assignment line's "(ID: `r_...`)" specifically, not the earlier "Course ID: `r_...`" line.
    const sealedAssignmentRef = /\(ID: `(r_[^`]+)`\)/.exec(overviewText)?.[1];
    expect(sealedAssignmentRef).toBeDefined();

    // Also: the "Course ID:" line itself must be a usable ref, not the raw internal Moodle id.
    expect(overviewText).not.toContain("Course ID: `100`");
    expect(overviewText).toMatch(/Course ID: `r_/);

    const assignmentResult = await handlers.get("moodle_get_assignment")!({ assignmentId: sealedAssignmentRef });
    expect(assignmentResult.isError).toBeFalsy();
    expect(assignmentResult.content[0]!.text).toContain("submitted");
  });

  it("the identical numeric course id (100) on two different sites resolves to two different courses", async () => {
    const { resolver, refStore } = await makeResolver();
    const stemRef = 100; // legacy plain number — always the anchor site
    const emsRef = await refStore.seal({ userId: "user1", siteId: "emslearn", kind: "course", id: 100 });

    mockFetch.mockImplementation(
      routedFetch({
        "stemlearn.sun.ac.za": {
          core_webservice_get_site_info: siteInfo("STEMLearn"),
          gradereport_user_get_grade_items: { usergrades: [{ courseid: 100, gradeitems: [{ itemtype: "course", gradeformatted: "55.00", grademax: 100 }] }] },
        },
        "emslearn.sun.ac.za": {
          core_webservice_get_site_info: siteInfo("EMSLearn"),
          gradereport_user_get_grade_items: { usergrades: [{ courseid: 100, gradeitems: [{ itemtype: "course", gradeformatted: "78.00", grademax: 100 }] }] },
        },
      }),
    );

    const { server, handlers } = captureTool();
    registerGradeTools(server, resolver);
    const stemResult = await handlers.get("moodle_get_grades")!({ courseId: stemRef });
    const emsResult = await handlers.get("moodle_get_grades")!({ courseId: emsRef });

    expect(stemResult.content[0]!.text).toContain("55.00");
    expect(emsResult.content[0]!.text).toContain("78.00");
  });

  it("rejects a course ref sealed for a different user", async () => {
    const { resolver, refStore } = await makeResolver();
    const someoneElsesRef = await refStore.seal({ userId: "someone-else", siteId: "emslearn", kind: "course", id: 100 });

    const { server, handlers } = captureTool();
    registerGradeTools(server, resolver);
    const result = await handlers.get("moodle_get_grades")!({ courseId: someoneElsesRef });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/invalid|expired/i);
  });

  it("rejects a course ref for a site the user has since disconnected", async () => {
    const { refStore } = await makeResolver();
    // A fresh resolver whose resolveSiteConfig always reports "not connected".
    mockFetch.mockResolvedValueOnce(jsonResponse(siteInfo("STEMLearn")));
    const anchorClient = await MoodleClient.create({ baseUrl: "https://stemlearn.sun.ac.za", maxFileBytes: 1024, requestTimeoutMs: 20_000, auth: { kind: "token", token: "stem-tok" } });
    const disconnectedResolver = new CourseRefResolver("stemlearn", anchorClient, "user1", refStore, async () => null);
    const ref = await refStore.seal({ userId: "user1", siteId: "emslearn", kind: "course", id: 100 });

    const { server, handlers } = captureTool();
    registerGradeTools(server, disconnectedResolver);
    const result = await handlers.get("moodle_get_grades")!({ courseId: ref });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/isn't connected/i);
  });

  it("rejects a course ref naming a site outside the registry", async () => {
    const { resolver, refStore } = await makeResolver();
    const ref = await refStore.seal({ userId: "user1", siteId: "not-a-real-site", kind: "course", id: 100 });

    const { server, handlers } = captureTool();
    registerGradeTools(server, resolver);
    const result = await handlers.get("moodle_get_grades")!({ courseId: ref });

    expect(result.isError).toBe(true);
  });

  it("accepts a legacy plain numeric STEMLearn course id exactly as before (backward compatibility)", async () => {
    const { resolver } = await makeResolver();
    mockFetch.mockImplementation(
      routedFetch({
        "stemlearn.sun.ac.za": {
          core_webservice_get_site_info: siteInfo("STEMLearn"),
          gradereport_user_get_grade_items: { usergrades: [{ courseid: 2722, gradeitems: [{ itemtype: "course", gradeformatted: "90.00", grademax: 100 }] }] },
        },
      }),
    );

    const { server, handlers } = captureTool();
    registerGradeTools(server, resolver);
    const result = await handlers.get("moodle_get_grades")!({ courseId: 2722 });

    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain("90.00");
    expect(result.content[0]!.text).toContain("Course 2722");
  });

  it("rejects the unknown site registered by getSiteById as a sanity check on the fixture itself", () => {
    expect(getSiteById("emslearn")).toBeDefined();
    expect(getSiteById("not-a-real-site")).toBeUndefined();
  });
});

describe("upcoming_and_overdue against the exact production topology that reproduced the bug", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds deadlines on a secondary site when the anchor account has zero courses", async () => {
    // Regression: registerComposedTools used to pass only the single anchor
    // MoodleClient into upcomingAndOverdue(client). A real account with six
    // courses on a non-anchor SUNLearn environment and zero on the anchor got
    // "You are not enrolled in any courses." even though the courses (and
    // their deadlines) were right there on the other connected site.
    const { resolver, anchorClient } = await makeResolver();
    const now = Math.floor(Date.now() / 1000);
    const multiSite: MultiSiteContext = {
      anchorSite: { id: "stemlearn", name: "STEMLearn" },
      additionalSites: [{ site: getSiteById("emslearn")!, config: emsConfig() }],
      seal: (kind, siteId, id) => resolver.sealIfNeeded(kind, siteId, id),
    };

    mockFetch.mockImplementation(
      routedFetch({
        "stemlearn.sun.ac.za": {
          core_enrol_get_users_courses: [],
        },
        "emslearn.sun.ac.za": {
          core_webservice_get_site_info: siteInfo("EMSLearn", ["mod_assign_get_assignments", "mod_assign_get_submission_status"]),
          core_enrol_get_users_courses: [{ id: 100, fullname: "Financial Accounting 178", shortname: "REK178" }],
          mod_assign_get_assignments: {
            courses: [{ id: 100, assignments: [{ id: 55, cmid: 1, name: "REK178 Test 1", duedate: now - 3600, cutoffdate: 0, grade: 100 }] }],
          },
          mod_assign_get_submission_status: { lastattempt: { submission: { status: "not submitted" } } },
        },
      }),
    );

    const { server, handlers } = captureTool();
    registerComposedTools(server, anchorClient, resolver, multiSite);
    const result = await handlers.get("upcoming_and_overdue")!({});

    expect(result.isError).toBeFalsy();
    const text = result.content[0]!.text;
    expect(text).not.toContain("not enrolled in any courses");
    expect(text).toContain("REK178 Test 1");
    expect(text).toContain("🔴 Overdue");
    expect(text).toContain("_EMSLearn_");
    // Financial Accounting 178's course/assignment ids belong to EMSLearn, not the anchor — must be sealed.
    expect(text).toMatch(/assignment ID: `r_/);
    expect(text).toMatch(/course ID: `r_/);
  });
});

describe("moodle_download_file dispatch across linked sites", () => {
  beforeEach(() => vi.clearAllMocks());

  const emsFileUrl = "https://emslearn.sun.ac.za/pluginfile.php/1/mod_resource/content/1/reading.pdf";
  const stemFileUrl = "https://stemlearn.sun.ac.za/pluginfile.php/1/mod_resource/content/1/notes.txt";
  const contents = (fileurl: string, filename: string, mimetype: string) => [
    { id: 100, name: "Week 1", modules: [{ id: 5, name: "Reading", modname: "resource", contents: [{ type: "file", filename, fileurl, filesize: 4, mimetype }] }] },
  ];

  function fileResponse(mime: string, body: string) {
    return Promise.resolve({ ok: true, headers: new Headers({ "content-type": mime }), arrayBuffer: async () => new TextEncoder().encode(body).buffer });
  }

  /** Routes API calls (POST body) via wsfunction and pluginfile downloads (GET with token) per host. */
  function installRoutes(opts: { emsContents: unknown; emsDownloads?: string[] }) {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname.includes("pluginfile.php")) {
        opts.emsDownloads?.push(`${u.host}${u.pathname}?token=${u.searchParams.get("token")}`);
        return fileResponse("application/pdf", "%PDF");
      }
      return routedFetch({
        "stemlearn.sun.ac.za": { core_webservice_get_site_info: siteInfo("STEMLearn"), core_course_get_contents: [] },
        "emslearn.sun.ac.za": { core_webservice_get_site_info: siteInfo("EMSLearn"), core_course_get_contents: opts.emsContents },
      })(url, init);
    });
  }

  async function setup() {
    const { resolver, refStore, anchorClient } = await makeResolver();
    const multiSite: MultiSiteContext = {
      anchorSite: { id: "stemlearn", name: "STEMLearn" },
      additionalSites: [{ site: getSiteById("emslearn")!, config: emsConfig() }],
      seal: (kind, siteId, id) => resolver.sealIfNeeded(kind, siteId, id),
    };
    const sealedRef = await refStore.seal({ userId: "user1", siteId: "emslearn", kind: "course", id: 100 });
    const { server, handlers } = captureTool();
    registerFileTools(server, resolver);
    registerDownloadTool(server, anchorClient, true, multiSite);
    return { anchorClient, handlers, sealedRef };
  }

  async function listedFileId(handlers: ReturnType<typeof captureTool>["handlers"], courseId: unknown): Promise<string> {
    const listing = await handlers.get("moodle_list_resources")!({ courseId });
    const id = /fileId: `([^`]+)`/.exec(listing.content[0]!.text)?.[1];
    expect(id).toBeDefined();
    return id!;
  }

  it("downloads, via moodle_download_file, a fileId listed for a secondary-site course, using that site's token", async () => {
    const downloads: string[] = [];
    installRoutes({ emsContents: contents(emsFileUrl, "reading.pdf", "application/pdf"), emsDownloads: downloads });
    const { handlers, sealedRef } = await setup();

    const fileId = await listedFileId(handlers, sealedRef);
    const result = await handlers.get("moodle_download_file")!({ fileId });

    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain("reading.pdf");
    expect(result.content[0]!.text).toContain("application/pdf");
    expect(downloads).toEqual(["emslearn.sun.ac.za/pluginfile.php/1/mod_resource/content/1/reading.pdf?token=ems-tok"]);
  });

  it("still lists and downloads anchor-site files through the anchor client", async () => {
    const { handlers } = await setup();
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname.includes("pluginfile.php")) {
        expect(u.searchParams.get("token")).toBe("stem-tok");
        return fileResponse("text/plain", "hello");
      }
      return routedFetch({ "stemlearn.sun.ac.za": { core_course_get_contents: contents(stemFileUrl, "notes.txt", "text/plain") } })(url, init);
    });

    const fileId = await listedFileId(handlers, 100);
    const result = await handlers.get("moodle_download_file")!({ fileId });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain("hello");
  });

  it("rejects a fileId minted by an unrelated site (not the anchor, not a linked site)", async () => {
    installRoutes({ emsContents: contents(emsFileUrl, "reading.pdf", "application/pdf") });
    const { handlers } = await setup();
    const { FileIdStore } = await import("../src/file-id-store.js");
    const foreignId = await new FileIdStore("some-other-site-token").seal({ userId: 1, courseId: 100, fileurl: emsFileUrl, mime: "application/pdf", filename: "reading.pdf", filesize: 4 });

    const result = await handlers.get("moodle_download_file")!({ fileId: foreignId });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/invalid, expired/);
  });

  it("rejects malformed and other-user fileIds without reaching any pluginfile download", async () => {
    const downloads: string[] = [];
    installRoutes({ emsContents: contents(emsFileUrl, "reading.pdf", "application/pdf"), emsDownloads: downloads });
    const { handlers } = await setup();
    const { FileIdStore } = await import("../src/file-id-store.js");
    const otherUserId = await new FileIdStore("ems-tok").seal({ userId: 2, courseId: 100, fileurl: emsFileUrl, mime: "application/pdf", filename: "reading.pdf", filesize: 4 });
    const expired = await new FileIdStore("ems-tok", -1).seal({ userId: 1, courseId: 100, fileurl: emsFileUrl, mime: "application/pdf", filename: "reading.pdf", filesize: 4 });

    for (const fileId of ["bad", otherUserId, expired]) {
      const result = await handlers.get("moodle_download_file")!({ fileId });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toMatch(/invalid, expired/);
    }
    expect(downloads).toEqual([]);
  });

  it("still re-checks current course access on the owning site, and does not fall through to other sites on denial", async () => {
    const downloads: string[] = [];
    installRoutes({ emsContents: contents(emsFileUrl, "reading.pdf", "application/pdf"), emsDownloads: downloads });
    const { handlers, sealedRef } = await setup();
    const fileId = await listedFileId(handlers, sealedRef);

    // Access revoked: the course no longer contains that file.
    installRoutes({ emsContents: [], emsDownloads: downloads });
    const result = await handlers.get("moodle_download_file")!({ fileId });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/invalid, expired/);
    expect(downloads).toEqual([]);
  });
});
