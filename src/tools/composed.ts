import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import type { CourseRefResolver } from "../course-ref-resolver.js";
import { RefSchema, withResolvedCourseListing, type SubRefSealer } from "./tool-ref-helpers.js";
import { listForumsRaw, getDiscussionsRaw } from "./forums.js";
import { getCourseNoticesRaw, hasConflictingNoticeDates } from "./courses.js";
import { ASSIGNMENT_LIST_POLICY, COMPOSED_TASK_POLICY, TEXT_OUTPUT_POLICY, mapWithConcurrency } from "../policy.js";
import { loadAssignments, loadEnrolledCourses, loadGrades, loadSubmissionStatus } from "../moodle-loaders.js";
import type { MoodleAssignment, MoodleCourse } from "../moodle-api.js";
import { truncateText } from "../text.js";
import { formatMoodleDateTime } from "../format-date.js";
import { mapAccountWideSites, type ConnectedSite, type MultiSiteContext } from "../multi-site-context.js";
import { getNotificationsAccountWide } from "./notifications.js";
import { getCalendarEventsAccountWide } from "./calendar.js";
import { readOnlyTool } from "./read-only-tool.js";

// Composed, read-only tools that merge a few raw Moodle calls into one
// normalized, student-shaped answer. Deterministic date/status merging only —
// no NLP/task-planning heuristics. Every raw wsfunction used here is the
// same one the primitive tools already use.

function formatDate(ts: number): string {
  return ts ? formatMoodleDateTime(ts) : "No due date";
}

async function getCourseById(client: MoodleClient, courseId: number) {
  const courses = await loadEnrolledCourses(client);
  return courses.find((c) => c.id === courseId) ?? null;
}

// ---------------------------------------------------------------------------
// course_overview
// ---------------------------------------------------------------------------

export async function courseOverview(client: MoodleClient, courseId: number, sealer: SubRefSealer): Promise<string> {
  const course = await getCourseById(client, courseId);
  if (!course) {
    return `Course ${courseId} not found among your enrolled courses. Use moodle_list_courses to see valid course IDs.`;
  }

  // Echo the exact opaque reference supplied by the caller. Re-sealing the
  // same course creates a different (but valid) nonce-bearing token, which
  // makes an otherwise straightforward tool chain look inconsistent.
  const courseIdLabel = sealer.courseRef ?? await sealer.seal("course", course.id);
  const lines: string[] = [
    `## Course Overview: ${truncateText(course.fullname, TEXT_OUTPUT_POLICY.maxLabelCharacters)} (${truncateText(course.shortname, TEXT_OUTPUT_POLICY.maxLabelCharacters)})`,
    `Course ID: \`${courseIdLabel}\``,
  ];

  if (course.progress != null) {
    lines.push(`Progress: ${Math.round(course.progress)}%`);
  }

  lines.push("", "### Current course notices");
  try {
    const notices = await getCourseNoticesRaw(client, courseId);
    const currentNotices = notices.filter((notice) => notice.classification === "current");
    if (currentNotices.length === 0) {
      lines.push("No current deadline or practical notices found in course-section summaries.");
    } else {
      if (hasConflictingNoticeDates(currentNotices)) {
        lines.push("⚠️ **Conflicting deadline dates appear in current course notices; verify the applicable date with the lecturer.**");
      }
      for (const notice of currentNotices.slice(0, 3)) {
        lines.push(`- **${notice.sectionName}:** ${notice.text}`);
      }
      lines.push("_Use current course notices to verify conflicts with older PDFs or forum posts._");
    }
  } catch {
    lines.push("Current course notices unavailable.");
  }

  // Upcoming assignments/deadlines
  lines.push(``, `### Upcoming assignments`);
  try {
    if (client.supports("mod_assign_get_assignments")) {
      const assignData = await loadAssignments(client, {
        "courseids[0]": courseId,
      });
      const assignments = assignData.courses[0]?.assignments ?? [];
      const now = Math.floor(Date.now() / 1000);
      const upcoming = assignments
        .filter((a) => a.duedate > 0 && a.duedate >= now)
        .sort((a, b) => a.duedate - b.duedate);
      if (upcoming.length === 0) {
        lines.push("No upcoming assignment deadlines.");
      } else {
        for (const a of upcoming.slice(0, ASSIGNMENT_LIST_POLICY.maxRendered)) {
          // Sealed the same way moodle_list_assignments would (SubRefSealer) —
          // a composed tool must never hand out a raw non-anchor assignment id
          // that moodle_get_assignment has no way to route correctly.
          const idLabel = await sealer.seal("assignment", a.id);
          lines.push(`- **${truncateText(a.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}**, due ${formatDate(a.duedate)} (ID: \`${idLabel}\`)`);
        }
        if (upcoming.length > ASSIGNMENT_LIST_POLICY.maxRendered) {
          lines.push(`_Showing the first ${ASSIGNMENT_LIST_POLICY.maxRendered} upcoming assignments._`);
        }
      }
    } else {
      lines.push("Assignments API not available.");
    }
  } catch {
    lines.push("Could not fetch assignments.");
  }

  // Grades
  lines.push(``, `### Grade`);
  try {
    if (client.supports("gradereport_user_get_grade_items")) {
      const report = await loadGrades(client, courseId);
      const items = report.usergrades[0]?.gradeitems ?? [];
      const total = items.find((i) => i.itemtype === "course");
      if (total) {
        lines.push(
          `Course total: ${truncateText(total.gradeformatted, TEXT_OUTPUT_POLICY.maxLabelCharacters)} / ${total.grademax} (${truncateText(total.percentageformatted ?? "N/A", TEXT_OUTPUT_POLICY.maxLabelCharacters)})`,
        );
      } else {
        lines.push("No course total grade available yet.");
      }
    } else {
      lines.push("Grades API not available.");
    }
  } catch {
    lines.push("Could not fetch grades.");
  }

  // Recent announcements. Courses can have more than one News forum (for
  // example, separate language streams), and Moodle versions do not
  // consistently guarantee discussion order. Read a bounded set of News
  // forums, then rank all returned discussions by last activity.
  lines.push(``, `### Recent announcements`);
  try {
    const forums = await listForumsRaw(client, courseId);
    const announcementForums = forums.filter((f) => f.type === "news");
    const selectedForums = (announcementForums.length > 0 ? announcementForums : forums.slice(0, 1))
      .slice(0, COMPOSED_TASK_POLICY.maxAnnouncementForums);
    if (selectedForums.length === 0) {
      lines.push("No forums in this course.");
    } else {
      const pages = await mapWithConcurrency(
        selectedForums,
        COMPOSED_TASK_POLICY.announcementForumConcurrency,
        (forum) => getDiscussionsRaw(client, forum.id, COMPOSED_TASK_POLICY.maxFetchedRecentAnnouncements),
      );
      const discussions = pages.flat().sort((a, b) => b.timemodified - a.timemodified);
      if (discussions.length === 0) {
        lines.push("No recent announcements.");
      } else {
        for (const d of discussions.slice(0, COMPOSED_TASK_POLICY.maxRenderedRecentAnnouncements)) {
          lines.push(`- **${truncateText(d.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}**, ${truncateText(d.userfullname, TEXT_OUTPUT_POLICY.maxLabelCharacters)}, ${formatDate(d.timemodified)}`);
        }
      }
    }
  } catch {
    lines.push("Could not fetch announcements.");
  }

  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

// ---------------------------------------------------------------------------
// upcoming_and_overdue
// ---------------------------------------------------------------------------

const DUE_SOON_SECONDS = 3 * 24 * 60 * 60;

/**
 * Whether an assignment's due date is even compatible with belonging to its
 * course's current run. A real production case: a 2026 course
 * ("Geo-Environmental Science - 154", startdate in the 2026 academic year)
 * still carried a "Prac 1 assignment" due 2024-11-11 with no cutoffdate —
 * content inherited from a reused/reset Moodle course shell whose due dates
 * were never updated, which rendered as a genuinely outstanding 2026
 * obligation.
 *
 * The signal used is course.startdate (from core_enrol_get_users_courses,
 * confirmed present on a real Moodle 4.5.8 server) versus the assignment's
 * own duedate: a due date from BEFORE the course itself started cannot
 * belong to the current run — Moodle courses don't have assignments due
 * before the course exists — so this only ever fires for stale inherited
 * content, never for a long-running course whose real deadlines all fall
 * within (or after) its own start.
 *
 * Deliberately NOT an arbitrary "older than N months" cutoff, and
 * deliberately NOT using enddate (frequently 0/open-ended on real courses,
 * and a genuine final deadline can legitimately land at or after a course's
 * nominal end — using it to exclude anything would risk hiding real
 * outstanding work). Missing/zero startdate metadata is treated as
 * "current": insufficient information to safely call something historical,
 * so it isn't.
 */
export type AssignmentEra = "current" | "historical";

export function classifyAssignmentEra(
  course: Pick<MoodleCourse, "startdate">,
  assignment: Pick<MoodleAssignment, "duedate">,
): AssignmentEra {
  if (!course.startdate || assignment.duedate <= 0) return "current";
  return assignment.duedate < course.startdate ? "historical" : "current";
}

/** Purely date-derived — computed before submission status is known, used only to prioritize which candidates are worth an (expensive) submission-status lookup. */
type TimingBucket = "overdue" | "due_soon" | "upcoming" | "closed";

/** What's actually rendered — takes submission status into account, so successfully submitted work is never shown as outstanding. */
type DisplayState = "overdue" | "due_soon" | "upcoming" | "missed" | "submitted";

interface TaskItem {
  site: ConnectedSite;
  courseIdLabel: number | string;
  courseName: string;
  title: string;
  assignmentIdLabel: number | string;
  dueDate: number;
  dueDateFormatted: string;
  state: DisplayState;
  submissionStatus: string | null;
  submittedLate: boolean;
  gradingStatus: string | null;
}

interface TaskCandidate {
  site: ConnectedSite;
  client: MoodleClient;
  courseId: number;
  courseName: string;
  assignment: MoodleAssignment;
  bucket: TimingBucket;
}

/** A historical candidate never needs a submission-status lookup — it isn't rendered as actionable. */
interface HistoricalItem {
  site: ConnectedSite;
  courseIdLabel: number | string;
  courseName: string;
  title: string;
  assignmentIdLabel: number | string;
  dueDate: number;
  dueDateFormatted: string;
}

function timingBucket(assignment: MoodleAssignment, now: number): TimingBucket {
  if (assignment.cutoffdate > 0 && assignment.cutoffdate < now) return "closed";
  if (assignment.duedate < now) return "overdue";
  return assignment.duedate - now < DUE_SOON_SECONDS ? "due_soon" : "upcoming";
}

/**
 * Folds in submission status: an assignment past its due date (or even past
 * cutoff) that was actually submitted is never "overdue"/"missed" — those
 * labels mean outstanding, actionable work. `taskState()` used to classify
 * purely from dates, so a submitted-on-time assignment whose deadline has
 * since passed still rendered under "🔴 Overdue" (with "submitted" tacked on,
 * which contradicts the heading). This is what upcoming_and_overdue's name
 * promises NOT to do.
 */
function displayState(bucket: TimingBucket, isSubmitted: boolean): DisplayState {
  if (bucket === "closed") return isSubmitted ? "submitted" : "missed";
  if (bucket === "overdue") return isSubmitted ? "submitted" : "overdue";
  return bucket;
}

const DISPLAY_STATE_ORDER: Record<DisplayState, number> = {
  overdue: 0, due_soon: 1, upcoming: 2, missed: 3, submitted: 4,
};
const TIMING_BUCKET_ORDER: Record<TimingBucket, number> = {
  overdue: 0, due_soon: 1, upcoming: 2, closed: 3,
};

export async function upcomingAndOverdue(client: MoodleClient, multiSite?: MultiSiteContext): Promise<string> {
  const { results, unavailable } = await mapAccountWideSites(client, multiSite, async (_site, siteClient) => {
    if (!siteClient.supports("mod_assign_get_assignments")) return { client: siteClient, courses: [] as MoodleCourse[], assignments: null };
    const courses = await loadEnrolledCourses(siteClient);
    if (courses.length === 0) return { client: siteClient, courses, assignments: null };
    const courseIdParams = Object.fromEntries(courses.map((c, i) => [`courseids[${i}]`, c.id]));
    const assignData = await loadAssignments(siteClient, courseIdParams);
    return { client: siteClient, courses, assignments: assignData };
  });

  const totalCourses = results.reduce((sum, r) => sum + r.value.courses.length, 0);
  if (totalCourses === 0) {
    return unavailable.length > 0
      ? `You are not enrolled in any courses.\n\n_Temporarily unavailable: ${unavailable.join(", ")}._`
      : "You are not enrolled in any courses.";
  }

  const now = Math.floor(Date.now() / 1000);
  const candidates: TaskCandidate[] = [];
  const historicalCandidates: TaskCandidate[] = [];
  for (const { site, value } of results) {
    if (!value.assignments) continue;
    const coursesById = new Map(value.courses.map((c) => [c.id, c]));
    for (const c of value.assignments.courses) {
      const course = coursesById.get(c.id);
      for (const assignment of c.assignments) {
        if (assignment.duedate <= 0) continue;
        const candidate: TaskCandidate = {
          site,
          client: value.client,
          courseId: c.id,
          courseName: course?.fullname ?? `Course ${c.id}`,
          assignment,
          bucket: timingBucket(assignment, now),
        };
        if (course && classifyAssignmentEra(course, assignment) === "historical") {
          historicalCandidates.push(candidate);
        } else {
          candidates.push(candidate);
        }
      }
    }
  }
  candidates.sort((a, b) => TIMING_BUCKET_ORDER[a.bucket] - TIMING_BUCKET_ORDER[b.bucket] || a.assignment.duedate - b.assignment.duedate);
  const omittedTasks = Math.max(0, candidates.length - COMPOSED_TASK_POLICY.maxRendered);
  const showSite = Boolean(multiSite && multiSite.additionalSites.length > 0);

  historicalCandidates.sort((a, b) => a.assignment.duedate - b.assignment.duedate);
  const omittedHistorical = Math.max(0, historicalCandidates.length - COMPOSED_TASK_POLICY.maxHistoricalRendered);
  const historicalItems: HistoricalItem[] = [];
  for (const { site, courseId, courseName, assignment } of historicalCandidates.slice(0, COMPOSED_TASK_POLICY.maxHistoricalRendered)) {
    const [courseIdLabel, assignmentIdLabel] = multiSite
      ? await Promise.all([multiSite.seal("course", site.id, courseId), multiSite.seal("assignment", site.id, assignment.id)])
      : [courseId, assignment.id];
    historicalItems.push({
      site,
      courseIdLabel,
      courseName: truncateText(courseName, TEXT_OUTPUT_POLICY.maxLabelCharacters),
      title: truncateText(assignment.name, TEXT_OUTPUT_POLICY.maxLabelCharacters),
      assignmentIdLabel,
      dueDate: assignment.duedate,
      dueDateFormatted: formatDate(assignment.duedate),
    });
  }

  const tasks = await mapWithConcurrency(
    candidates.slice(0, COMPOSED_TASK_POLICY.maxRendered),
    COMPOSED_TASK_POLICY.submissionStatusConcurrency,
    async ({ site, client: siteClient, courseId, courseName, assignment, bucket }): Promise<TaskItem> => {
      let submissionStatus: string | null = null;
      let gradingStatus: string | null = null;
      let submittedLate = false;
      if (siteClient.supports("mod_assign_get_submission_status")) {
        try {
          const status = await loadSubmissionStatus(siteClient, assignment.id);
          submissionStatus = status.lastattempt?.submission?.status ?? "not submitted";
          gradingStatus = status.lastattempt?.gradingstatus ?? null;
          const submittedAt = status.lastattempt?.submission?.timemodified;
          if (submissionStatus === "submitted" && assignment.duedate > 0 && submittedAt && submittedAt > assignment.duedate) {
            submittedLate = true;
          }
        } catch {
          // Leave status null if this particular lookup fails — don't fail the whole tool.
        }
      }

      const [courseIdLabel, assignmentIdLabel] = multiSite
        ? await Promise.all([multiSite.seal("course", site.id, courseId), multiSite.seal("assignment", site.id, assignment.id)])
        : [courseId, assignment.id];

      return {
        site,
        courseIdLabel,
        courseName: truncateText(courseName, TEXT_OUTPUT_POLICY.maxLabelCharacters),
        title: truncateText(assignment.name, TEXT_OUTPUT_POLICY.maxLabelCharacters),
        assignmentIdLabel,
        dueDate: assignment.duedate,
        dueDateFormatted: formatDate(assignment.duedate),
        state: displayState(bucket, submissionStatus === "submitted"),
        submissionStatus,
        submittedLate,
        gradingStatus,
      };
    },
  );

  // Within a state bucket, ascending due date puts the most urgent item
  // first either way: earliest (most overdue) first for "overdue", soonest
  // first for "due_soon"/"upcoming".
  tasks.sort((a, b) => {
    if (DISPLAY_STATE_ORDER[a.state] !== DISPLAY_STATE_ORDER[b.state]) return DISPLAY_STATE_ORDER[a.state] - DISPLAY_STATE_ORDER[b.state];
    return a.dueDate - b.dueDate;
  });

  if (tasks.length === 0 && historicalItems.length === 0) {
    return unavailable.length > 0
      ? `No assignments with due dates found across your courses.\n\n_Temporarily unavailable: ${unavailable.join(", ")}._`
      : "No assignments with due dates found across your courses.";
  }

  const lines: string[] = ["## Upcoming & Overdue\n"];
  if (unavailable.length) lines.push(`_Temporarily unavailable: ${unavailable.join(", ")}._`, "");
  if (omittedTasks) lines.push(`_Showing the highest-priority ${COMPOSED_TASK_POLICY.maxRendered} assignments; ${omittedTasks} additional assignments were omitted._`, "");
  const groups: [DisplayState, string][] = [
    ["overdue", "🔴 Overdue"],
    ["due_soon", "🟡 Due soon (next 3 days)"],
    ["upcoming", "🟢 Upcoming"],
    ["missed", "⚫ Missed (past cutoff, not submitted)"],
    ["submitted", "🔵 Submitted"],
  ];
  for (const [state, heading] of groups) {
    const items = tasks.filter((t) => t.state === state);
    if (items.length === 0) continue;
    lines.push(`### ${heading}`);
    for (const t of items) {
      const late = t.submittedLate ? " (submitted late)" : "";
      const submission = t.submissionStatus ? `, ${truncateText(t.submissionStatus, TEXT_OUTPUT_POLICY.maxLabelCharacters)}${late}` : "";
      const grading = t.gradingStatus ? `, grading: ${truncateText(t.gradingStatus, TEXT_OUTPUT_POLICY.maxLabelCharacters)}` : "";
      const siteLabel = showSite ? `, _${truncateText(t.site.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}_` : "";
      lines.push(
        `- **${t.title}** (${t.courseName})${siteLabel}, due ${t.dueDateFormatted}${submission}${grading}, assignment ID: \`${t.assignmentIdLabel}\`, course ID: \`${t.courseIdLabel}\``,
      );
    }
    lines.push("");
  }

  if (historicalItems.length > 0) {
    lines.push("### 🗄️ Historical course content");
    lines.push(
      "_These due dates fall before their own course's start date, almost certainly content inherited from a reused/reset course shell, not current obligations. Verify with your lecturer if unsure._",
      "",
    );
    for (const h of historicalItems) {
      const siteLabel = showSite ? `, _${truncateText(h.site.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}_` : "";
      lines.push(
        `- **${h.title}** (${h.courseName})${siteLabel}, due ${h.dueDateFormatted}, assignment ID: \`${h.assignmentIdLabel}\`, course ID: \`${h.courseIdLabel}\``,
      );
    }
    if (omittedHistorical) lines.push(`_Showing the ${COMPOSED_TASK_POLICY.maxHistoricalRendered} most recent historical items; ${omittedHistorical} more were omitted._`);
    lines.push("");
  }

  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

/** Compact, student-intent entrypoint. It deliberately composes authoritative
 * deadline state and recent notifications instead of asking an agent to infer
 * urgency from raw Moodle entities. */
export async function studentBrief(client: MoodleClient, multiSite?: MultiSiteContext): Promise<string> {
  const [deadlines, notifications, calendar] = await Promise.all([
    upcomingAndOverdue(client, multiSite),
    multiSite ? getNotificationsAccountWide(client, multiSite, 10) : Promise.resolve("Notifications unavailable."),
    getCalendarEventsAccountWide(client, multiSite, 14),
  ]);
  // References remain available through upcoming_and_overdue; a briefing
  // should spend its limited attention on what requires action, not opaque
  // routing tokens or routine inherited-shell archaeology.
  const actionableDeadlines = deadlines
    .split("### 🗄️ Historical course content")[0]!
    .replace(/, assignment ID: `[^`]+`, course ID: `[^`]+`/g, "");
  const calendarGroups = new Map<string, string[]>();
  let courseHeading = "";
  let includeDetail = false;
  for (const line of calendar.split("\n")) {
    if (line.startsWith("## ")) continue;
    if (line.startsWith("### ")) { courseHeading = line; includeDetail = false; continue; }
    if (line.startsWith("- ")) {
      includeDetail = !/`attendance`|assignment \(authoritative\)/i.test(line);
      if (includeDetail && courseHeading) {
        const group = calendarGroups.get(courseHeading) ?? [];
        group.push(line);
        calendarGroups.set(courseHeading, group);
      }
      continue;
    }
    if (includeDetail && line.startsWith("  ") && courseHeading) calendarGroups.get(courseHeading)?.push(line);
  }
  const calendarOnly = [...calendarGroups.entries()].flatMap(([heading, lines]) => [heading, ...lines]);
  const calendarSection = calendarOnly.length > 0
    ? `\n\n### Quiz and practical closures\n${calendarOnly.join("\n")}`
    : "";
  const notificationBlocks = notifications.split(/\n\s*\n/).filter((block) => block.startsWith("- "));
  const ranked = { urgent: [] as string[], important: [] as string[], routine: [] as string[] };
  for (const block of notificationBlocks) {
    const normalized = block.toLowerCase();
    if (/\b(no lecture|cancelled?|postponed|closed|due (?:today|tomorrow)|deadline (?:today|tomorrow))\b/.test(normalized)) ranked.urgent.push(block);
    else if (/\b(grade released|graded|due|deadline|assignment|schedule|venue|lecture)\b/.test(normalized)) ranked.important.push(block);
    else ranked.routine.push(block);
  }
  const notificationSection = notificationBlocks.length === 0
    ? notifications
    : [
      ranked.urgent.length ? `### Urgent\n${ranked.urgent.join("\n\n")}` : "",
      ranked.important.length ? `### Important\n${ranked.important.join("\n\n")}` : "",
      ranked.routine.length ? `### Routine\n${ranked.routine.join("\n\n")}` : "",
    ].filter(Boolean).join("\n\n");
  return truncateText(`## Student Brief\n\n### Deadlines\n${actionableDeadlines}${calendarSection}\n\n### Notifications\n${notificationSection}`, TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export function registerComposedTools(server: McpServer, client: MoodleClient, courseRefResolver: CourseRefResolver, multiSite?: MultiSiteContext): void {
  readOnlyTool(server,
    "course_overview",
    "One-call summary of a course for the student: identity, upcoming deadlines, course grade total, and recent announcements. Use this instead of chaining moodle_get_course + moodle_list_assignments + moodle_get_grades + moodle_get_forum_discussions when the student just wants 'catch me up on this course'.",
    { courseId: RefSchema.describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => withResolvedCourseListing(courseRefResolver, courseId, courseOverview),
  );

  readOnlyTool(server,
    "upcoming_and_overdue",
    "Cross-course deadline view for the student: every assignment with a due date, across every connected SUNLearn environment, merged and sorted into Overdue / Due soon / Upcoming / Missed / Submitted, with submission and grading status already looked up. Assignments whose due date predates their own course's start (stale content inherited from a reused course shell) are set apart under 'Historical course content' instead of counted as outstanding work. Use this instead of chaining moodle_list_courses + moodle_list_assignments + moodle_get_assignment per course when the student asks 'what's due' or 'am I behind on anything'.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: await upcomingAndOverdue(client, multiSite) }],
    }),
  );

  readOnlyTool(server,
    "student_brief",
    "Compact cross-course catch-up: authoritative deadline state plus recent notifications. Use for 'what should I know?', 'catch me up', or 'what needs my attention?'.",
    {},
    async () => ({ content: [{ type: "text" as const, text: await studentBrief(client, multiSite) }] }),
  );
}
