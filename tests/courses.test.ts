import { describe, it, expect, vi } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { getCourse, getCourseNotices, hasConflictingNoticeDates, listCourses } from "../src/tools/courses.js";
import { TEXT_OUTPUT_POLICY } from "../src/policy.js";
import { getSiteById } from "../src/sunlearn-sites.js";
import type { MultiSiteContext } from "../src/multi-site-context.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

const SITE_INFO_FIXTURE = {
  userid: 1,
  username: "student",
  sitename: "STEMLearn",
  fullname: "Test Student",
  release: "4.5.8",
  functions: [{ name: "core_course_get_contents", version: "1" }],
};

async function makeClient() {
  mockFetch.mockResolvedValueOnce(jsonResponse(SITE_INFO_FIXTURE));
  return MoodleClient.create({ baseUrl: "https://stemlearn.sun.ac.za", auth: { kind: "token", token: "tok" } });
}

describe("getCourse", () => {
  it("renders a section's summary text alongside its modules", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 10,
          name: "Week 7",
          summary: "<p>Practical 2 begins this week. <strong>Report due 25 Sept.</strong></p>",
          modules: [{ id: 1, name: "Practical 2 2026.pdf", modname: "resource", url: "https://x/1" }],
        },
      ]),
    );

    const result = await getCourse(client, 2722);

    expect(result).toContain("### Week 7");
    expect(result).toContain("Practical 2 begins this week. Report due 25 Sept.");
    expect(result).not.toContain("<p>");
    expect(result).not.toContain("<strong>");
    expect(result).toContain("Practical 2 2026.pdf");
  });

  it("still shows a section with only a summary and no modules", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        { id: 11, name: "Week 8", summary: "<p>Continue Practical 2 this week.</p>", modules: [] },
      ]),
    );

    const result = await getCourse(client, 2722);

    expect(result).toContain("### Week 8");
    expect(result).toContain("Continue Practical 2 this week.");
  });

  it("skips sections with neither summary nor modules", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(
      jsonResponse([{ id: 12, name: "Week 9", summary: "", modules: [] }]),
    );

    const result = await getCourse(client, 2722);

    expect(result).toBe("This course has no content.");
  });

  it("bounds oversized section summaries", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 13, name: "Week", summary: `<p>${"x".repeat(TEXT_OUTPUT_POLICY.maxCourseSummaryCharacters + 1)}</p>`, modules: [] }]));

    const result = await getCourse(client, 2722);
    expect(result).toContain("Text truncated after");
    expect(result).not.toContain("<p>");
  });
});

describe("getCourseNotices", () => {
  it("surfaces current section notices as the deadline-verification source", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse([
      {
        id: 10,
        name: "Week 7",
        summary: "<p><strong>Practical 2</strong>: the final submission deadline is 25 September at 23:59.</p>",
        modules: [],
      },
    ]));

    const result = await getCourseNotices(client, 2722);
    expect(result).toContain("25 September at 23:59");
    expect(result).toContain("current course-section notices");
  });

  it("prioritizes a later deadline sentence over an earlier practical introduction", async () => {
    const client = await makeClient();
    const introduction = "Practical 2 introduces the assignment. ".repeat(30);
    mockFetch.mockResolvedValueOnce(jsonResponse([
      {
        id: 10,
        name: "Week 7",
        summary: `<p>${introduction}The final submission deadline is 25 September at 23:59.</p>`,
        modules: [],
      },
    ]));

    const result = await getCourseNotices(client, 2722);
    expect(result).toContain("25 September at 23:59");
  });

  it("flags conflicting deadline dates from different section notices", () => {
    expect(hasConflictingNoticeDates([
      { sectionName: "Week 7", text: "The final submission deadline for Practical 2 is 25 September at 23:59." },
      { sectionName: "Week 8", text: "The deadline for Practical 2 report is Thursday, 1 October before 23:59." },
    ])).toBe(true);
  });

  it("does not treat dates for different practicals as a conflict", () => {
    expect(hasConflictingNoticeDates([
      { sectionName: "Week 5", text: "The final deadline for Practical 1 is 27 August at 23:59." },
      { sectionName: "Week 8", text: "The deadline for Practical 2 is 1 October at 23:59." },
    ])).toBe(false);
  });
});

describe("listCourses", () => {
  it("renders exactly the single-site format when there is nothing else connected", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 1, fullname: "Geology 101", shortname: "GEO101" }]));

    const result = await listCourses(client);
    expect(result).toContain("## Your Courses");
    expect(result).toContain("**Geology 101** (GEO101) — ID: `1`");
    expect(result).not.toContain("_STEMLearn_");
  });

  it("says so when the student has no courses and nothing else is connected", async () => {
    const client = await makeClient();
    mockFetch.mockResolvedValueOnce(jsonResponse([]));
    expect(await listCourses(client)).toBe("You are not enrolled in any courses.");
  });

  function routedFetch(bySite: Record<string, { siteInfo?: unknown; courses?: unknown; fail?: "siteInfo" | "courses" }>) {
    return async (url: string, init?: RequestInit) => {
      const host = new URL(String(url)).host;
      const entry = bySite[host];
      if (!entry) throw new Error(`unexpected host in test: ${host}`);
      const bodyStr = init?.body ? String(init.body) : "";
      if (bodyStr.includes("wsfunction=core_webservice_get_site_info")) {
        if (entry.fail === "siteInfo") throw new Error("simulated network failure");
        return jsonResponse(entry.siteInfo);
      }
      if (bodyStr.includes("wsfunction=core_enrol_get_users_courses")) {
        if (entry.fail === "courses") throw new Error("simulated network failure");
        return jsonResponse(entry.courses);
      }
      throw new Error(`unexpected wsfunction in test body: ${bodyStr}`);
    };
  }

  function multiSite(additionalSiteIds: string[], sealed: Record<string, string> = {}): MultiSiteContext {
    return {
      anchorSite: { id: "stemlearn", name: "STEMLearn" },
      additionalSites: additionalSiteIds.map((id) => ({
        site: getSiteById(id)!,
        config: { baseUrl: getSiteById(id)!.baseUrl, maxFileBytes: 1024, requestTimeoutMs: 5000, auth: { kind: "token", token: `${id}-token` } },
      })),
      seal: async (_kind, siteId, courseId) => sealed[`${siteId}:${courseId}`] ?? `sealed-${siteId}-${courseId}`,
    };
  }

  it("aggregates courses across the anchor and every additional connected site", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(
      routedFetch({
        "stemlearn.sun.ac.za": { courses: [{ id: 1, fullname: "Geology 101", shortname: "GEO101" }] },
        "emslearn.sun.ac.za": {
          siteInfo: { ...SITE_INFO_FIXTURE, sitename: "EMSLearn" },
          courses: [{ id: 1, fullname: "Accounting 101", shortname: "ACC101" }],
        },
      }),
    );

    const result = await listCourses(client, multiSite(["emslearn"]));
    expect(result).toContain("**Geology 101** (GEO101) — _STEMLearn_ — ID: `1`");
    expect(result).toContain("**Accounting 101** (ACC101) — _EMSLearn_ — ID: `sealed-emslearn-1`");
    // Same numeric Moodle courseId (1) on two different sites must render with distinct IDs.
    expect(result.match(/ID: `1`/g)).toHaveLength(1);
  });

  it("reports an unavailable additional site without failing the whole response", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(
      routedFetch({
        "stemlearn.sun.ac.za": { courses: [{ id: 1, fullname: "Geology 101", shortname: "GEO101" }] },
        "emslearn.sun.ac.za": { fail: "siteInfo" },
      }),
    );

    const result = await listCourses(client, multiSite(["emslearn"]));
    expect(result).toContain("Geology 101");
    expect(result).toContain("_Temporarily unavailable: EMSLearn._");
  });

  it("tells the student every ID shown works directly with every other tool (no longer the stale 'only works with this listing' message)", async () => {
    // Regression: sealed non-anchor refs already work in grades, assignments,
    // course_overview, etc. (see multi-site-course-ref.integration.test.ts) —
    // the old footer claiming otherwise was stale and actively misleading.
    const client = await makeClient();
    mockFetch.mockImplementation(
      routedFetch({
        "stemlearn.sun.ac.za": { courses: [] },
        "emslearn.sun.ac.za": {
          siteInfo: { ...SITE_INFO_FIXTURE, sitename: "EMSLearn" },
          courses: [{ id: 5, fullname: "Marketing 101", shortname: "MKT101" }],
        },
      }),
    );

    const result = await listCourses(client, multiSite(["emslearn"]));
    expect(result).not.toContain("currently only work with this listing");
    expect(result).toContain("can be passed directly into any other tool");
  });
});
