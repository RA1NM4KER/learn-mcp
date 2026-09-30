import { describe, it, expect, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { getCalendarEvents } from "../src/tools/calendar.js";
import { TEXT_OUTPUT_POLICY } from "../src/policy.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

/** Routes each call by wsfunction, regardless of call order. */
function routedFetchMock(routes: Record<string, unknown>) {
  return (_url: string, init: RequestInit) => {
    const body = init.body as URLSearchParams;
    const fn = body.get("wsfunction")!;
    if (!(fn in routes)) throw new Error(`Unexpected wsfunction in test: ${fn}`);
    return jsonResponse(routes[fn]);
  };
}

const ALL_FUNCTIONS = [
  "core_calendar_get_action_events_by_timesort",
  "core_calendar_get_calendar_events",
  "core_enrol_get_users_courses",
];

async function makeClient(functions = ALL_FUNCTIONS) {
  mockFetch.mockResolvedValueOnce(
    jsonResponse({
      userid: 1,
      username: "student",
      sitename: "STEMLearn",
      fullname: "Test Student",
      release: "4.5.8",
      functions: functions.map((name) => ({ name, version: "1" })),
    }),
  );
  return MoodleClient.create({ baseUrl: "https://stemlearn.sun.ac.za", auth: { kind: "token", token: "tok" } });
}

const COURSE = { id: 2722, fullname: "Systems And Signals 244", shortname: "SS244" };

beforeEach(() => vi.clearAllMocks());

describe("getCalendarEvents", () => {
  it("surfaces plain calendar entries (e.g. attendance registers) that action-events omits", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(
      routedFetchMock({
        core_calendar_get_action_events_by_timesort: { events: [] },
        core_enrol_get_users_courses: [COURSE],
        core_calendar_get_calendar_events: {
          events: [
            {
              id: 61873,
              name: "Lecture class attendance register",
              courseid: 2722,
              timestart: 1789974000,
              timeduration: 4200,
              eventtype: "attendance",
              description: "<p>Group 3 lecture class</p>",
            },
          ],
        },
      }),
    );

    const result = await getCalendarEvents(client, undefined, 14);

    expect(result).toContain("Systems And Signals 244");
    expect(result).toContain("Lecture class attendance register");
    expect(result).toContain("Group 3 lecture class");
    expect(result).not.toContain("<p>");
  });

  it("dedupes an event present in both the action-events and plain-calendar responses", async () => {
    const client = await makeClient();
    const shared = {
      id: 42764,
      name: "QUIZ: Metamorphic rocks closes",
      courseid: 2722,
      timestart: 1790175600,
      timeduration: 0,
      eventtype: "close",
    };
    mockFetch.mockImplementation(
      routedFetchMock({
        core_calendar_get_action_events_by_timesort: { events: [shared] },
        core_enrol_get_users_courses: [COURSE],
        core_calendar_get_calendar_events: { events: [shared] },
      }),
    );

    const result = await getCalendarEvents(client, undefined, 14);

    expect(result.match(/QUIZ: Metamorphic rocks closes/g)).toHaveLength(1);
  });

  it("still reports no events when both sources are empty", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(
      routedFetchMock({
        core_calendar_get_action_events_by_timesort: { events: [] },
        core_enrol_get_users_courses: [COURSE],
        core_calendar_get_calendar_events: { events: [] },
      }),
    );

    const result = await getCalendarEvents(client, undefined, 14);

    expect(result).toContain("No upcoming events");
  });

  it("does not return empty when an authoritative assignment deadline falls within the window but Moodle calendar sources omit it", async () => {
    const client = await makeClient([...ALL_FUNCTIONS, "mod_assign_get_assignments", "mod_quiz_get_quizzes_by_courses"]);
    const now = Math.floor(Date.now() / 1000);
    mockFetch.mockImplementation(routedFetchMock({
      core_calendar_get_action_events_by_timesort: { events: [] },
      core_enrol_get_users_courses: [COURSE],
      core_calendar_get_calendar_events: { events: [] },
      mod_assign_get_assignments: { courses: [{ id: COURSE.id, assignments: [{ id: 1, cmid: 1, name: "Practical 2", duedate: now + 3600, grade: 100 }] }] },
      mod_quiz_get_quizzes_by_courses: { quizzes: [] },
    }));

    const result = await getCalendarEvents(client, undefined, 14);

    expect(result).toContain("Practical 2");
    expect(result).toContain("sources: assignment (authoritative)");
    expect(result).not.toContain("No upcoming events");
  });

  it("filters by course before applying the rendered-event cap", async () => {
    const client = await makeClient();
    const otherEvents = Array.from({ length: 100 }, (_, id) => ({
      id: id + 1, name: `Other ${id}`, courseid: 1, timestart: id + 1, timeduration: 0, eventtype: "due",
    }));
    const target = { id: 999, name: "Target course event", courseid: COURSE.id, timestart: 999, timeduration: 0, eventtype: "due" };
    mockFetch.mockImplementation(routedFetchMock({
      core_calendar_get_action_events_by_timesort: { events: [...otherEvents, target] },
      core_enrol_get_users_courses: [COURSE],
      core_calendar_get_calendar_events: { events: [] },
    }));

    const result = await getCalendarEvents(client, COURSE.id, 14);
    expect(result).toContain("Target course event");
  });

  it("renders a real action-event response instead of rejecting it (live Moodle 4.5.8 shape, no top-level courseid)", async () => {
    // Regression for the reported bug: every live moodle_get_calendar_events
    // call failed with "Moodle returned an unexpected response." because
    // core_calendar_get_action_events_by_timesort events have no top-level
    // courseid — only course.id (see moodle-api.test.ts and eventCourseId()).
    const client = await makeClient();
    mockFetch.mockImplementation(
      routedFetchMock({
        core_calendar_get_action_events_by_timesort: {
          events: [{
            id: 39376,
            name: "SS244 Practical 2 - Due 1/10 at 23h59 is due",
            description: "",
            eventtype: "due",
            timestart: 1790891940, // 2026-10-01 23:59 SAST
            timeduration: 0,
            course: { id: 2722, fullname: "Systems And Signals 244", shortname: "SS244" },
          }],
        },
        core_enrol_get_users_courses: [COURSE],
        core_calendar_get_calendar_events: { events: [] },
      }),
    );

    const result = await getCalendarEvents(client, undefined, 14);

    expect(result).toContain("SS244 Practical 2 - Due 1/10 at 23h59 is due");
    expect(result).toContain("Systems And Signals 244");
    // Timezone regression: rendered in Africa/Johannesburg, not the process's own (UTC on the Worker runtime).
    expect(result).toContain("11:59 p.m.");
    expect(result).not.toContain("9:59 p.m.");
  });

  it("filters an action-event (no top-level courseid) by course correctly via eventCourseId", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(
      routedFetchMock({
        core_calendar_get_action_events_by_timesort: {
          events: [
            { id: 1, name: "Target course event", eventtype: "due", timestart: 1, timeduration: 0, course: { id: COURSE.id } },
            { id: 2, name: "Other course event", eventtype: "due", timestart: 1, timeduration: 0, course: { id: 99999 } },
          ],
        },
        core_enrol_get_users_courses: [COURSE],
        core_calendar_get_calendar_events: { events: [] },
      }),
    );

    const result = await getCalendarEvents(client, COURSE.id, 14);
    expect(result).toContain("Target course event");
    expect(result).not.toContain("Other course event");
  });

  it("bounds and sanitizes oversized calendar descriptions", async () => {
    const client = await makeClient();
    mockFetch.mockImplementation(routedFetchMock({
      core_calendar_get_action_events_by_timesort: { events: [{ id: 1, name: "Event", courseid: COURSE.id, timestart: 1, description: `<p>${"x".repeat(TEXT_OUTPUT_POLICY.maxCalendarDescriptionCharacters + 1)}</p>` }] },
      core_enrol_get_users_courses: [COURSE],
      core_calendar_get_calendar_events: { events: [] },
    }));

    const result = await getCalendarEvents(client, COURSE.id, 14);
    expect(result).toContain("Text truncated after");
    expect(result).not.toContain("<p>");
  });

  it("caps aggregate calendar text when many entries contain large descriptions", async () => {
    const client = await makeClient();
    const events = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1, name: `Event ${index}`, courseid: COURSE.id, timestart: index + 1,
      description: `<p>${"x".repeat(TEXT_OUTPUT_POLICY.maxCalendarDescriptionCharacters)}</p>`,
    }));
    mockFetch.mockImplementation(routedFetchMock({
      core_calendar_get_action_events_by_timesort: { events },
      core_enrol_get_users_courses: [COURSE],
      core_calendar_get_calendar_events: { events: [] },
    }));

    const result = await getCalendarEvents(client, COURSE.id, 14);
    expect(result.length).toBeLessThanOrEqual(TEXT_OUTPUT_POLICY.maxMcpResponseCharacters + 100);
    expect(result).toContain("Text truncated after");
  });
});
