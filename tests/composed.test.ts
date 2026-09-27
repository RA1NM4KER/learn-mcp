import { describe, it, expect, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { classifyAssignmentEra, courseOverview, upcomingAndOverdue } from "../src/tools/composed.js";
import { COMPOSED_TASK_POLICY } from "../src/policy.js";
import type { SubRefSealer } from "../src/tools/tool-ref-helpers.js";

/** Anchor-site passthrough — every test here has exactly one (anchor) site, so a seal is always a no-op. */
const ANCHOR_SEALER: SubRefSealer = { siteId: "anchor", seal: async (_kind, id) => id };

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

/** Routes each call by wsfunction, regardless of call order (composed tools issue concurrent calls). */
function routedFetchMock(routes: Record<string, unknown>) {
  return (_url: string, init: RequestInit) => {
    const body = init.body as URLSearchParams;
    const fn = body.get("wsfunction")!;
    if (!(fn in routes)) throw new Error(`Unexpected wsfunction in test: ${fn}`);
    return jsonResponse(routes[fn]);
  };
}

const ALL_FUNCTIONS = [
  "core_enrol_get_users_courses",
  "mod_assign_get_assignments",
  "mod_assign_get_submission_status",
  "gradereport_user_get_grade_items",
  "mod_forum_get_forums_by_courses",
  "mod_forum_get_forum_discussions",
];

async function makeClient() {
  mockFetch.mockResolvedValueOnce(
    jsonResponse({
      userid: 1,
      username: "student",
      sitename: "STEMLearn",
      fullname: "Test Student",
      release: "4.5.8",
      functions: ALL_FUNCTIONS.map((name) => ({ name, version: "1" })),
    }),
  );
  return MoodleClient.create({ baseUrl: "https://stemlearn.sun.ac.za", auth: { kind: "token", token: "tok" } });
}

const COURSE = { id: 2722, fullname: "Intro to Widgets", shortname: "WIDG101", progress: 8.3 };

describe("classifyAssignmentEra", () => {
  // Real production case: "Geo-Environmental Science - 154", a 2026 course
  // (shortname 2026-64165-154), still carrying a "Prac 1 assignment" due
  // 2024-11-11 with no cutoffdate — content inherited from a reused/reset
  // course shell whose due dates were never updated.
  const course2026 = { startdate: Date.UTC(2026, 0, 1) / 1000 };
  const staleAssignment2024 = { duedate: Date.UTC(2024, 10, 11) / 1000 };

  it("classifies an assignment due before its own course's start date as historical", () => {
    expect(classifyAssignmentEra(course2026, staleAssignment2024)).toBe("historical");
  });

  it("classifies an assignment due within the course's active period as current", () => {
    const dueDuringCourse = { duedate: Date.UTC(2026, 5, 1) / 1000 };
    expect(classifyAssignmentEra(course2026, dueDuringCourse)).toBe("current");
  });

  it("classifies an assignment due yesterday in a current course as current (genuinely overdue)", () => {
    const now = Math.floor(Date.now() / 1000);
    const longAgoStart = { startdate: now - 365 * 86400 };
    const dueYesterday = { duedate: now - 86400 };
    expect(classifyAssignmentEra(longAgoStart, dueYesterday)).toBe("current");
  });

  it("falls back to current when the course has no startdate metadata (conservative — never unsafely filters)", () => {
    expect(classifyAssignmentEra({ startdate: 0 }, staleAssignment2024)).toBe("current");
  });

  it("keeps valid deadlines from a legitimate long-running/multi-year course as current", () => {
    const longRunningCourse = { startdate: Date.UTC(2020, 0, 1) / 1000 };
    const dueIn2024 = { duedate: Date.UTC(2024, 5, 1) / 1000 }; // after the course's own 2020 start
    expect(classifyAssignmentEra(longRunningCourse, dueIn2024)).toBe("current");
  });

  it("treats a zero/missing duedate as current (not this helper's concern — callers already filter those out)", () => {
    expect(classifyAssignmentEra(course2026, { duedate: 0 })).toBe("current");
  });
});

describe("courseOverview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merges course identity, upcoming assignments, grade total, and announcements into one view", async () => {
    const client = await makeClient();
    const now = Math.floor(Date.now() / 1000);

    mockFetch.mockImplementation(
      routedFetchMock({
        core_enrol_get_users_courses: [COURSE],
        mod_assign_get_assignments: {
          courses: [
            {
              id: 2722,
              assignments: [{ id: 6326, cmid: 1, name: "Practical 2", duedate: now + 86400, grade: 100 }],
            },
          ],
        },
        gradereport_user_get_grade_items: {
          usergrades: [
            {
              courseid: 2722,
              gradeitems: [
                // Moodle serializes course/category grade items without a
                // backing activity module as itemmodule: null.
                { itemtype: "course", itemmodule: null, gradeformatted: "75.00", grademax: 100, percentageformatted: "75%" },
              ],
            },
          ],
        },
        mod_forum_get_forums_by_courses: [{ id: 4445, cmid: 92947, course: 2722, name: "Announcements", type: "news" }],
        mod_forum_get_forum_discussions: {
          discussions: [
            { id: 1, discussion: 1, name: "Welcome post", userfullname: "Prof X", numreplies: 0, timemodified: now, pinned: false },
          ],
        },
      }),
    );

    const text = await courseOverview(client, 2722, ANCHOR_SEALER);

    expect(text).toContain("Intro to Widgets");
    expect(text).toContain("Practical 2");
    expect(text).toContain("75.00 / 100");
    expect(text).toContain("Welcome post");
    // Regression: the real Moodle field is `userfullname`, not `firstuserfullname`
    // (the latter doesn't exist and rendered "undefined" — confirmed against
    // a real server's mod_forum_get_forum_discussions response).
    expect(text).toContain("Prof X");
    expect(text).not.toContain("undefined");
  });

  it("reports course not found without throwing when courseId isn't in the student's enrolled courses", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(routedFetchMock({ core_enrol_get_users_courses: [COURSE] }));
    const text = await courseOverview(client, 9999, ANCHOR_SEALER);
    expect(text).toContain("not found");
  });
});

describe("upcomingAndOverdue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("classifies assignments into overdue vs upcoming and sorts most-overdue first", async () => {
    const client = await makeClient();
    const now = Math.floor(Date.now() / 1000);

    mockFetch.mockImplementation(
      routedFetchMock({
        core_enrol_get_users_courses: [COURSE],
        mod_assign_get_assignments: {
          courses: [
            {
              id: 2722,
              assignments: [
                { id: 1, cmid: 1, name: "Very overdue", duedate: now - 10 * 86400, grade: 100 },
                { id: 2, cmid: 2, name: "Slightly overdue", duedate: now - 86400, grade: 100 },
                { id: 3, cmid: 3, name: "Far future", duedate: now + 30 * 86400, grade: 100 },
                { id: 4, cmid: 4, name: "No due date", duedate: 0, grade: 100 },
              ],
            },
          ],
        },
        // Not submitted: these must stay genuinely "overdue" for this ordering test.
        // Submission status folding into the final state is covered separately below.
        mod_assign_get_submission_status: { lastattempt: { submission: { status: "not submitted" } } },
      }),
    );

    const text = await upcomingAndOverdue(client);

    // "No due date" excluded entirely — this tool is a deadline view.
    expect(text).not.toContain("No due date");

    const overdueSection = text.split("### 🟢")[0];
    const veryIdx = overdueSection.indexOf("Very overdue");
    const slightIdx = overdueSection.indexOf("Slightly overdue");
    expect(veryIdx).toBeGreaterThan(-1);
    expect(slightIdx).toBeGreaterThan(-1);
    expect(veryIdx).toBeLessThan(slightIdx); // most overdue listed first

    expect(text).toContain("Far future");
    expect(text).toContain("not submitted");
  });

  it("never labels a successfully submitted past-due assignment as overdue or missed", async () => {
    // Regression: taskState() used to classify purely from due/cutoff dates,
    // before submission status was known, so an assignment submitted on time
    // whose deadline has since passed still rendered under "🔴 Overdue" (with
    // "submitted" tacked on beside it) — contradicting what "overdue" means
    // for a tool literally named upcoming_and_overdue.
    const client = await makeClient();
    const now = Math.floor(Date.now() / 1000);

    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams;
      const fn = body.get("wsfunction")!;
      if (fn === "core_enrol_get_users_courses") return jsonResponse([COURSE]);
      if (fn === "mod_assign_get_assignments") {
        return jsonResponse({
          courses: [{
            id: 2722,
            assignments: [
              { id: 1, cmid: 1, name: "Submitted on time", duedate: now - 86400, cutoffdate: 0, grade: 100 },
              { id: 2, cmid: 2, name: "Submitted after cutoff passed", duedate: now - 20 * 86400, cutoffdate: now - 19 * 86400, grade: 100 },
              { id: 3, cmid: 3, name: "Still outstanding", duedate: now - 86400, cutoffdate: 0, grade: 100 },
            ],
          }],
        });
      }
      if (fn === "mod_assign_get_submission_status") {
        const assignid = body.get("assignid");
        if (assignid === "3") return jsonResponse({ lastattempt: { submission: { status: "not submitted" } } });
        return jsonResponse({ lastattempt: { submission: { status: "submitted", timemodified: now - 90000 } }, gradingstatus: "graded" });
      }
      throw new Error(`Unexpected wsfunction in test: ${fn}`);
    });

    const text = await upcomingAndOverdue(client);

    expect(text).toContain("### 🔴 Overdue");
    const overdueSection = text.split("### 🔴 Overdue")[1]!.split("###")[0]!;
    expect(overdueSection).toContain("Still outstanding");
    expect(overdueSection).not.toContain("Submitted on time");
    expect(overdueSection).not.toContain("Submitted after cutoff passed");

    expect(text).toContain("### 🔵 Submitted");
    const submittedSection = text.split("### 🔵 Submitted")[1]!;
    expect(submittedSection).toContain("Submitted on time");
    expect(submittedSection).toContain("Submitted after cutoff passed");
    expect(text).not.toContain("### ⚫ Missed");
  });

  it("does not fail the whole aggregate when one site's assignment data is malformed — reports it unavailable instead", async () => {
    // Regression: a single malformed record used to throw MoodleValidationError
    // and crash the entire tool. Per the multi-site fault-tolerance requirement
    // ("one unavailable Moodle site should not make the entire aggregate tool
    // fail"), this must now degrade gracefully instead.
    const client = await makeClient();
    mockFetch.mockImplementation(routedFetchMock({
      core_enrol_get_users_courses: [COURSE],
      mod_assign_get_assignments: {
        courses: [{ id: COURSE.id, assignments: [{ id: "bad", cmid: 1, name: "Broken" }] }],
      },
    }));

    const text = await upcomingAndOverdue(client);
    expect(text).toContain("Temporarily unavailable");
  });

  it("moves assignments past their cutoffdate into Missed instead of Overdue", async () => {
    const client = await makeClient();
    const now = Math.floor(Date.now() / 1000);

    mockFetch.mockImplementation(
      routedFetchMock({
        core_enrol_get_users_courses: [COURSE],
        mod_assign_get_assignments: {
          courses: [
            {
              id: 2722,
              assignments: [
                // A leftover from a reused course shell: due and cutoff both
                // long past — this is what showed up as a live-looking
                // "Overdue" item in practice (a Nov 2024 assignment).
                {
                  id: 1,
                  cmid: 1,
                  name: "Ancient prac",
                  duedate: now - 400 * 86400,
                  cutoffdate: now - 399 * 86400,
                  grade: 100,
                },
                // Genuinely overdue: due date passed but still submittable
                // (no cutoff, or cutoff still ahead).
                {
                  id: 2,
                  cmid: 2,
                  name: "Still submittable",
                  duedate: now - 86400,
                  cutoffdate: 0,
                  grade: 100,
                },
              ],
            },
          ],
        },
        mod_assign_get_submission_status: { lastattempt: { submission: { status: "not submitted" } } },
      }),
    );

    const text = await upcomingAndOverdue(client);

    const overdueSection = text.split("### ⚫")[0];
    expect(overdueSection).not.toContain("Ancient prac");
    expect(overdueSection).toContain("Still submittable");
    expect(text).toContain("⚫ Missed");
    expect(text).toContain("Ancient prac");
  });

  it("reports no courses cleanly rather than erroring", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(routedFetchMock({ core_enrol_get_users_courses: [] }));
    const text = await upcomingAndOverdue(client);
    expect(text).toContain("not enrolled in any courses");
  });

  it("caps tasks and bounds concurrent submission-status requests", async () => {
    const client = await makeClient();
    const now = Math.floor(Date.now() / 1000);
    const assignments = Array.from({ length: COMPOSED_TASK_POLICY.maxRendered + 5 }, (_, i) => ({
      id: i + 1, cmid: i + 1, name: `Task ${i + 1}`, duedate: now + i + 1, cutoffdate: 0, grade: 100,
    }));
    let active = 0;
    let peak = 0;
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      const fn = (init.body as URLSearchParams).get("wsfunction");
      if (fn === "core_enrol_get_users_courses") return jsonResponse([COURSE]);
      if (fn === "mod_assign_get_assignments") return jsonResponse({ courses: [{ id: COURSE.id, assignments }] });
      if (fn === "mod_assign_get_submission_status") {
        active++;
        peak = Math.max(peak, active);
        return new Promise((resolve) => setTimeout(() => {
          active--;
          resolve(jsonResponse({ lastattempt: { submission: { status: "submitted" } } }));
        }, 2));
      }
      throw new Error(`Unexpected wsfunction: ${fn}`);
    });

    const text = await upcomingAndOverdue(client);
    expect(peak).toBeLessThanOrEqual(COMPOSED_TASK_POLICY.submissionStatusConcurrency);
    expect((text.match(/assignment ID:/g) ?? [])).toHaveLength(COMPOSED_TASK_POLICY.maxRendered);
    expect(text).toContain("additional assignments were omitted");
  });

  describe("stale assignments from reused Moodle course shells", () => {
    // Production case: "Geo-Environmental Science / Geo-omgewingswetenskap -
    // 154" (shortname 2026-64165-154) is a 2026 course whose active run
    // begins in 2026, but still carried "Prac 1 assignment" due 2024-11-11
    // with no cutoffdate — inherited from a reused/reset course shell. This
    // rendered as a genuinely outstanding 2026 obligation.
    const COURSE_2026 = { id: 3062, fullname: "Geo-Environmental Science / Geo-omgewingswetenskap - 154", shortname: "2026-64165-154", startdate: Date.UTC(2026, 0, 1) / 1000 };
    const STALE_ASSIGNMENT = { id: 501, cmid: 1, name: "Prac 1 assignment", duedate: Date.UTC(2024, 10, 11) / 1000, cutoffdate: 0, grade: 100 };

    it("1: does not show a 2024-due assignment in a 2026 course (no cutoffdate) under Overdue", async () => {
      const client = await makeClient();
      mockFetch.mockImplementation(routedFetchMock({
        core_enrol_get_users_courses: [COURSE_2026],
        mod_assign_get_assignments: { courses: [{ id: COURSE_2026.id, assignments: [STALE_ASSIGNMENT] }] },
      }));

      const text = await upcomingAndOverdue(client);

      expect(text).not.toContain("### 🔴 Overdue");
      expect(text).toContain("Historical course content");
      expect(text).toContain("Prac 1 assignment");
      expect(text).toContain(COURSE_2026.fullname);
    });

    it("2: a current assignment due yesterday in the same 2026 course still shows as Overdue", async () => {
      const client = await makeClient();
      const now = Math.floor(Date.now() / 1000);
      const currentAssignment = { id: 502, cmid: 2, name: "Prac 2 assignment", duedate: now - 86400, cutoffdate: 0, grade: 100 };
      mockFetch.mockImplementation(routedFetchMock({
        core_enrol_get_users_courses: [COURSE_2026],
        mod_assign_get_assignments: { courses: [{ id: COURSE_2026.id, assignments: [STALE_ASSIGNMENT, currentAssignment] }] },
        mod_assign_get_submission_status: { lastattempt: { submission: { status: "not submitted" } } },
      }));

      const text = await upcomingAndOverdue(client);

      expect(text).toContain("### 🔴 Overdue");
      const overdueSection = text.split("### 🔴 Overdue")[1]!.split("###")[0]!;
      expect(overdueSection).toContain("Prac 2 assignment");
      expect(overdueSection).not.toContain("Prac 1 assignment");
      expect(text).toContain("Historical course content");
    });

    it("3: a submitted stale/historical assignment is never actionable overdue", async () => {
      const client = await makeClient();
      mockFetch.mockImplementation(routedFetchMock({
        core_enrol_get_users_courses: [COURSE_2026],
        mod_assign_get_assignments: { courses: [{ id: COURSE_2026.id, assignments: [STALE_ASSIGNMENT] }] },
        // Even if a submission somehow exists for it, it must never surface as overdue.
        mod_assign_get_submission_status: { lastattempt: { submission: { status: "submitted" } } },
      }));

      const text = await upcomingAndOverdue(client);

      expect(text).not.toContain("### 🔴 Overdue");
      expect(text).not.toContain("### ⚫ Missed");
      expect(text).toContain("Historical course content");
      expect(text).toContain("Prac 1 assignment");
    });

    it("4: a course with no start/end metadata falls back conservatively — the old assignment still shows as Overdue", async () => {
      const client = await makeClient();
      const courseNoMetadata = { id: 3063, fullname: "Legacy Course With No Dates", shortname: "LEGACY", startdate: 0 };
      mockFetch.mockImplementation(routedFetchMock({
        core_enrol_get_users_courses: [courseNoMetadata],
        mod_assign_get_assignments: { courses: [{ id: courseNoMetadata.id, assignments: [STALE_ASSIGNMENT] }] },
        mod_assign_get_submission_status: { lastattempt: { submission: { status: "not submitted" } } },
      }));

      const text = await upcomingAndOverdue(client);

      expect(text).not.toContain("Historical course content");
      expect(text).toContain("### 🔴 Overdue");
      expect(text).toContain("Prac 1 assignment");
    });

    it("5: a legitimate long-running/multi-year course keeps its valid deadlines visible", async () => {
      const client = await makeClient();
      const now = Math.floor(Date.now() / 1000);
      const longRunningCourse = { id: 3064, fullname: "Long-Running Diploma Course", shortname: "DIPLOMA", startdate: now - 3 * 365 * 86400 };
      const validRecentAssignment = { id: 503, cmid: 3, name: "Year 3 assignment", duedate: now - 86400, cutoffdate: 0, grade: 100 };
      mockFetch.mockImplementation(routedFetchMock({
        core_enrol_get_users_courses: [longRunningCourse],
        mod_assign_get_assignments: { courses: [{ id: longRunningCourse.id, assignments: [validRecentAssignment] }] },
        mod_assign_get_submission_status: { lastattempt: { submission: { status: "not submitted" } } },
      }));

      const text = await upcomingAndOverdue(client);

      expect(text).not.toContain("Historical course content");
      expect(text).toContain("### 🔴 Overdue");
      expect(text).toContain("Year 3 assignment");
    });

    it("6: a reused shell with several stale assignments alongside current work prioritizes current work cleanly", async () => {
      const client = await makeClient();
      const now = Math.floor(Date.now() / 1000);
      const staleAssignments = Array.from({ length: 4 }, (_, i) => ({
        id: 600 + i, cmid: 10 + i, name: `Old Prac ${i + 1}`, duedate: Date.UTC(2024, i, 15) / 1000, cutoffdate: 0, grade: 100,
      }));
      const currentAssignment = { id: 700, cmid: 20, name: "Prac 1 (2026)", duedate: now - 3600, cutoffdate: 0, grade: 100 };
      mockFetch.mockImplementation(routedFetchMock({
        core_enrol_get_users_courses: [COURSE_2026],
        mod_assign_get_assignments: { courses: [{ id: COURSE_2026.id, assignments: [...staleAssignments, currentAssignment] }] },
        mod_assign_get_submission_status: { lastattempt: { submission: { status: "not submitted" } } },
      }));

      const text = await upcomingAndOverdue(client);

      expect(text).toContain("### 🔴 Overdue");
      const overdueSection = text.split("### 🔴 Overdue")[1]!.split("###")[0]!;
      expect(overdueSection).toContain("Prac 1 (2026)");
      for (const stale of staleAssignments) expect(overdueSection).not.toContain(stale.name);

      expect(text).toContain("Historical course content");
      for (const stale of staleAssignments) expect(text).toContain(stale.name);
    });
  });
});
