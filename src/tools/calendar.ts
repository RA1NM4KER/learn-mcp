import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import type { CourseRefResolver } from "../course-ref-resolver.js";
import { RefSchema } from "./tool-ref-helpers.js";
import { sanitizeAndTruncateHtml, truncateText } from "../text.js";
import { CALENDAR_EVENT_POLICY, TEXT_OUTPUT_POLICY, mapWithConcurrency } from "../policy.js";
import { loadActionCalendarEvents, loadAssignments, loadCalendarEvents, loadEnrolledCourses, loadQuizzes } from "../moodle-loaders.js";
import { eventCourseId, type MoodleCalendarEvent } from "../moodle-api.js";
import { formatMoodleDateTime } from "../format-date.js";
import { mapAccountWideSites, type MultiSiteContext } from "../multi-site-context.js";

type CalendarSource = "calendar" | "assignment" | "quiz-open" | "quiz-close";
type CalendarItem = { title: string; courseId: number; timestart: number; description?: string; eventtype?: string; source: CalendarSource };

function sourceLabel(source: CalendarSource): string {
  return source === "calendar" ? "calendar" : source === "assignment" ? "assignment (authoritative)" : "quiz (authoritative)";
}

// core_calendar_get_action_events_by_timesort only returns events with a
// student-facing "action" (submit, attempt, etc). It silently omits plain
// calendar entries with no action — lecture/attendance registers, PRAC
// session close times, quiz close reminders that aren't the primary due
// date — even though those show up on the Moodle dashboard calendar. Pull
// those in too via core_calendar_get_calendar_events, per enrolled course.
async function getPlainCalendarEvents(
  client: MoodleClient,
  courseIds: number[],
  timestart: number,
  timeend: number,
): Promise<MoodleCalendarEvent[]> {
  if (courseIds.length === 0 || !client.supports("core_calendar_get_calendar_events")) return [];
  const params: Record<string, number> = {
    "options[timestart]": timestart,
    "options[timeend]": timeend,
  };
  courseIds.forEach((id, i) => {
    params[`events[courseids][${i}]`] = id;
  });
  const data = await loadCalendarEvents(client, params);
  return data.events;
}

export async function getCalendarEvents(
  client: MoodleClient,
  courseId?: number,
  daysAhead = 30
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const until = now + daysAhead * 86400;
  const courses = await loadEnrolledCourses(client);
  const courseNames = new Map(courses.map((c) => [c.id, c.fullname]));
  const plainCourseIds = courseId ? [courseId] : courses.map((c) => c.id);
  const [actionEvents, plainEvents, assignmentData, quizPages] = await Promise.all([
    client.supports("core_calendar_get_action_events_by_timesort") ? loadActionCalendarEvents(client, now, until).then((data) => data.events) : Promise.resolve([]),
    getPlainCalendarEvents(client, plainCourseIds, now, until),
    client.supports("mod_assign_get_assignments") && plainCourseIds.length > 0
      ? loadAssignments(client, Object.fromEntries(plainCourseIds.map((id, index) => [`courseids[${index}]`, id])))
      : Promise.resolve(null),
    client.supports("mod_quiz_get_quizzes_by_courses")
      ? mapWithConcurrency(plainCourseIds, CALENDAR_EVENT_POLICY.quizFetchConcurrency, (id) => loadQuizzes(client, id))
      : Promise.resolve([]),
  ]);

  const seenCalendarIds = new Set<number>();
  const calendarItems: CalendarItem[] = [...actionEvents, ...plainEvents]
    .filter((event) => !seenCalendarIds.has(event.id) && (seenCalendarIds.add(event.id), true))
    .filter((event) => !courseId || eventCourseId(event) === courseId)
    .map((event) => ({
      title: event.name,
      courseId: eventCourseId(event),
      timestart: event.timestart,
      ...(event.description ? { description: event.description } : {}),
      ...(event.eventtype ? { eventtype: event.eventtype } : {}),
      source: "calendar" as const,
    }));
  const assignmentItems: CalendarItem[] = assignmentData?.courses.flatMap((course) => course.assignments
    .filter((assignment) => assignment.duedate >= now && assignment.duedate <= until)
    .map((assignment) => ({ title: assignment.name, courseId: course.id, timestart: assignment.duedate, eventtype: "due", source: "assignment" as const }))) ?? [];
  const quizItems: CalendarItem[] = [];
  for (const [index, page] of quizPages.entries()) {
    const quizCourseId = plainCourseIds[index];
    if (quizCourseId === undefined) continue;
    for (const quiz of page.quizzes) {
      if (quiz.timeopen >= now && quiz.timeopen <= until) {
        quizItems.push({ title: `${quiz.name} opens`, courseId: quizCourseId, timestart: quiz.timeopen, eventtype: "open", source: "quiz-open" });
      }
      if (quiz.timeclose >= now && quiz.timeclose <= until) {
        quizItems.push({ title: `${quiz.name} closes`, courseId: quizCourseId, timestart: quiz.timeclose, eventtype: "close", source: "quiz-close" });
      }
    }
  }
  const items = [...calendarItems, ...assignmentItems, ...quizItems]
    .sort((a, b) => a.timestart - b.timestart)
    .slice(0, CALENDAR_EVENT_POLICY.maxRendered);

  if (items.length === 0) {
    return courseId
      ? `No upcoming events in the next ${daysAhead} days for course ${courseId}.`
      : `No upcoming events in the next ${daysAhead} days.`;
  }

  // Group by course
  const byCourse = new Map<string, CalendarItem[]>();
  for (const event of items) {
    const key = truncateText(courseNames.get(event.courseId) ?? `Course ${event.courseId}`, TEXT_OUTPUT_POLICY.maxLabelCharacters);
    const courseEvents = byCourse.get(key);
    if (courseEvents) courseEvents.push(event);
    else byCourse.set(key, [event]);
  }

  const lines: string[] = [`## Upcoming Events (next ${daysAhead} days)\n`];

  for (const [courseName, courseEvents] of byCourse) {
    lines.push(`### ${courseName}`);
    for (const e of courseEvents) {
      const type = e.eventtype ? `\`${truncateText(e.eventtype, TEXT_OUTPUT_POLICY.maxLabelCharacters)}\`` : "";
      lines.push(`- **${truncateText(e.title, TEXT_OUTPUT_POLICY.maxLabelCharacters)}**, ${formatMoodleDateTime(e.timestart)} ${type} _source: ${sourceLabel(e.source)}_`);
      const desc = e.description
        ? sanitizeAndTruncateHtml(e.description, TEXT_OUTPUT_POLICY.maxCalendarDescriptionCharacters)
        : "";
      if (desc) lines.push(`  ${desc}`);
    }
    lines.push("");
  }

  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

/** Account-wide calendar aggregation mirrors upcoming_and_overdue: an empty
 * anchor-site calendar must not hide a deadline on another linked SUNLearn site. */
export async function getCalendarEventsAccountWide(
  client: MoodleClient,
  multiSite: MultiSiteContext | undefined,
  daysAhead: number,
): Promise<string> {
  if (!multiSite || multiSite.additionalSites.length === 0) return getCalendarEvents(client, undefined, daysAhead);
  const { results, unavailable } = await mapAccountWideSites(client, multiSite, async (_site, siteClient) =>
    getCalendarEvents(siteClient, undefined, daysAhead),
  );
  const empty = `No upcoming events in the next ${daysAhead} days.`;
  const rendered = results.map((result) => result.value).filter((value) => value !== empty);
  if (rendered.length === 0) {
    return unavailable.length > 0
      ? `${empty}\n\n_Temporarily unavailable: ${unavailable.join(", ")}._`
      : empty;
  }
  const body = rendered.map((value) => value.replace(`## Upcoming Events (next ${daysAhead} days)\n\n`, "")).join("\n");
  const unavailableNote = unavailable.length > 0 ? `\n_Temporarily unavailable: ${unavailable.join(", ")}._` : "";
  return truncateText(`## Upcoming Events (next ${daysAhead} days)\n\n${body}${unavailableNote}`, TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export function registerCalendarTools(server: McpServer, client: MoodleClient, courseRefResolver: CourseRefResolver, multiSite?: MultiSiteContext): void {
  server.tool(
    "moodle_get_calendar_events",
    "Get the student's upcoming deadlines and calendar events: assignments due, quizzes opening/closing, lecture/practical attendance registers, and other course calendar entries, across their courses, optionally filtered to one course. Good for 'what's coming up' / 'what's due this week' / 'what's on the calendar'. Defaults to the next 30 days. Filtering to a course on a non-default SUNLearn environment shows that environment's calendar only, not merged with your default one.",
    {
      courseId: RefSchema.optional().describe("Filter to a specific course ID (optional)"),
      daysAhead: z.number().int().min(1).max(365).optional().describe("How many days ahead to look (default: 30, max: 365)"),
    },
    async ({ courseId, daysAhead }) => {
      if (courseId === undefined) {
        return { content: [{ type: "text" as const, text: await getCalendarEventsAccountWide(client, multiSite, daysAhead ?? 30) }] };
      }
      const resolved = await courseRefResolver.resolve("course", courseId);
      if (!resolved.ok) return { isError: true, content: [{ type: "text" as const, text: resolved.message }] };
      return { content: [{ type: "text" as const, text: await getCalendarEvents(resolved.client, resolved.id, daysAhead) }] };
    },
  );
}
