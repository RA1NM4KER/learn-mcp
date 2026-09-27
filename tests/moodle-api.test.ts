import { describe, expect, it } from "vitest";
import {
  MoodleAssignmentSchema,
  MoodleAssignmentsResponseSchema,
  MoodleCalendarResponseSchema,
  MoodleCourseContentsSchema,
  MoodleDiscussionsResponseSchema,
  MoodleGradeReportSchema,
  MoodleNotificationsResponseSchema,
  MoodleQuizAttemptsResponseSchema,
  MoodleQuizzesResponseSchema,
  eventCourseId,
} from "../src/moodle-api.js";

describe("Moodle course-content schema", () => {
  it("accepts file entries with the metadata needed for secure file access", () => {
    const result = MoodleCourseContentsSchema.safeParse([{ id: 1, modules: [{
      id: 2, name: "Notes", modname: "resource", contents: [{
        type: "file", filename: "notes.pdf", fileurl: "https://moodle.test/pluginfile.php/1/notes.pdf", filesize: 42,
      }],
    }] }]);

    expect(result.success).toBe(true);
  });

  it("accepts non-file content without file metadata and supports mixed content arrays", () => {
    const result = MoodleCourseContentsSchema.safeParse([{ id: 1, modules: [{
      id: 2,
      name: "Resources",
      modname: "folder",
      contents: [
        { type: "folder", filepath: "/week-1" },
        { type: "file", filename: "notes.pdf", fileurl: "https://moodle.test/pluginfile.php/1/notes.pdf", filesize: 42 },
      ],
    }] }]);

    expect(result.success).toBe(true);
  });

  it("rejects a file entry missing required file metadata", () => {
    const result = MoodleCourseContentsSchema.safeParse([{ id: 1, modules: [{
      id: 2, name: "Broken", modname: "resource", contents: [{ type: "file", filename: "notes.pdf" }],
    }] }]);

    expect(result.success).toBe(false);
  });
});

describe("critical Moodle collection responses", () => {
  it("accepts explicit empty collections while rejecting missing endpoint collections", () => {
    const collections = [
      [MoodleAssignmentsResponseSchema, { courses: [] }],
      [MoodleGradeReportSchema, { usergrades: [] }],
      [MoodleQuizzesResponseSchema, { quizzes: [] }],
      [MoodleQuizAttemptsResponseSchema, { attempts: [] }],
      [MoodleDiscussionsResponseSchema, { discussions: [] }],
      [MoodleCalendarResponseSchema, { events: [] }],
      [MoodleNotificationsResponseSchema, { notifications: [] }],
    ] as const;
    for (const [schema, valid] of collections) {
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse({}).success).toBe(false);
    }
  });

  it("keeps legitimately optional nested assignment and notification fields tolerant", () => {
    expect(MoodleAssignmentsResponseSchema.safeParse({ courses: [{ id: 1 }] }).success).toBe(true);
    expect(MoodleNotificationsResponseSchema.safeParse({ notifications: [] }).success).toBe(true);
  });
});

describe("Moodle assignment schema", () => {
  it("accepts the real mod_assign_get_assignments course-module field name (cmid)", () => {
    // Regression: mod_assign_get_assignments names the course-module id
    // "cmid" — confirmed against a real Moodle server (4.5.8). This differs
    // from mod_quiz_get_quizzes_by_courses, which genuinely uses
    // "coursemodule". A schema requiring "coursemodule" here rejected every
    // real assignment response outright, breaking moodle_list_assignments
    // and upcoming_and_overdue against a live Moodle.
    const result = MoodleAssignmentSchema.safeParse({
      id: 6326, cmid: 92947, course: 2722, name: "Practical 2",
      duedate: 1758830340, cutoffdate: 0, grade: 100,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an assignment missing cmid", () => {
    expect(MoodleAssignmentSchema.safeParse({ id: 6326, name: "Practical 2" }).success).toBe(false);
  });
});

describe("Moodle calendar event schema", () => {
  // Trimmed but otherwise verbatim shape of a real
  // core_calendar_get_action_events_by_timesort response (Moodle 4.5.8,
  // captured live against a real STEMLearn assignment due 2026-10-01 23:59
  // SAST). This wsfunction's events carry NO top-level `courseid` at all —
  // only `course.id` — which is why every live moodle_get_calendar_events
  // call failed with the generic "Moodle returned an unexpected response.".
  const liveActionEvent = {
    id: 39376,
    name: "SS244 Practical 2 - Due 1/10 at 23h59 is due",
    description: "",
    descriptionformat: 1,
    component: "mod_assign",
    modulename: "assign",
    instance: 132553,
    eventtype: "due",
    timestart: 1790891940,
    timeduration: 0,
    timesort: 1790891940,
    overdue: false,
    course: {
      id: 2722,
      fullname: "Systems And Signals  / Stelsels en seine - 244",
      shortname: "2026-46779-244",
    },
  };

  // A core_calendar_get_calendar_events entry, by contrast, genuinely has a
  // top-level courseid (also captured live) — the schema must keep accepting that too.
  const livePlainEvent = {
    id: 61873,
    name: "Lecture class attendance register",
    description: "",
    courseid: 2722,
    modulename: "attendance",
    instance: 4821,
    eventtype: "attendance",
    timestart: 1789974000,
    timeduration: 4200,
  };

  it("accepts a real action-event response with no top-level courseid", () => {
    const result = MoodleCalendarResponseSchema.safeParse({ events: [liveActionEvent] });
    expect(result.success).toBe(true);
  });

  it("accepts a real plain-calendar-event response with a top-level courseid", () => {
    const result = MoodleCalendarResponseSchema.safeParse({ events: [livePlainEvent] });
    expect(result.success).toBe(true);
  });

  it("eventCourseId falls back to course.id when courseid is absent", () => {
    const parsed = MoodleCalendarResponseSchema.parse({ events: [liveActionEvent] });
    expect(eventCourseId(parsed.events[0]!)).toBe(2722);
  });

  it("eventCourseId prefers the top-level courseid when both are present", () => {
    const parsed = MoodleCalendarResponseSchema.parse({ events: [livePlainEvent] });
    expect(eventCourseId(parsed.events[0]!)).toBe(2722);
  });

  it("still rejects an event missing both courseid and course.id", () => {
    const parsed = MoodleCalendarResponseSchema.parse({
      events: [{ id: 1, name: "Orphan event", timestart: 1 }],
    });
    expect(eventCourseId(parsed.events[0]!)).toBe(0);
  });
});

describe("Moodle grade-report schema", () => {
  const liveGradeItemShape = {
    itemtype: "course",
    itemname: null,
    itemmodule: null,
    categoryid: 10,
    gradeformatted: "75.00",
    feedback: "",
  };

  it("accepts a null itemmodule for a core course or category grade item", () => {
    // Regression: Moodle 4.5.8's gradereport_user_get_grade_items returns
    // null, rather than omitting itemmodule, for grade items without a
    // backing activity module.
    const result = MoodleGradeReportSchema.safeParse({
      usergrades: [{ courseid: 3062, gradeitems: [liveGradeItemShape] }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.usergrades[0]?.gradeitems[0]?.itemmodule).toBeNull();
    }
  });

  it("still rejects a non-string, non-null itemmodule", () => {
    const result = MoodleGradeReportSchema.safeParse({
      usergrades: [{ courseid: 3062, gradeitems: [{ ...liveGradeItemShape, itemmodule: 42 }] }],
    });

    expect(result.success).toBe(false);
  });
});
