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

  const courseIdLabel = await sealer.seal("course", course.id);
  const lines: string[] = [
    `## Course Overview — ${truncateText(course.fullname, TEXT_OUTPUT_POLICY.maxLabelCharacters)} (${truncateText(course.shortname, TEXT_OUTPUT_POLICY.maxLabelCharacters)})`,
    `Course ID: \`${courseIdLabel}\``,
  ];

  if (course.progress != null) {
    lines.push(`Progress: ${Math.round(course.progress)}%`);
  }

  lines.push("", "### Current course notices");
  try {
    const notices = await getCourseNoticesRaw(client, courseId);
    if (notices.length === 0) {
      lines.push("No current deadline or practical notices found in course-section summaries.");
    } else {
      if (hasConflictingNoticeDates(notices)) {
        lines.push("⚠️ **Conflicting deadline dates appear in current course notices; verify the applicable date with the lecturer.**");
      }
      for (const notice of notices.slice(0, 3)) {
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
          lines.push(`- **${truncateText(a.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** — due ${formatDate(a.duedate)} (ID: \`${idLabel}\`)`);
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
          `Course total: ${truncateText(total.gradeformatted, TEXT_OUTPUT_POLICY.maxLabelCharacters)} / ${total.grademax} (${truncateText(total.percentageformatted ?? "—", TEXT_OUTPUT_POLICY.maxLabelCharacters)})`,
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

  // Recent announcements (cheap: one forum lookup + up to 3 discussions)
  lines.push(``, `### Recent announcements`);
  try {
    const forums = await listForumsRaw(client, courseId);
    const announcementsForum = forums.find((f) => f.type === "news") ?? forums[0];
    if (!announcementsForum) {
      lines.push("No forums in this course.");
    } else {
      const discussions = await getDiscussionsRaw(client, announcementsForum.id, 3);
      if (discussions.length === 0) {
        lines.push("No recent announcements.");
      } else {
        for (const d of discussions) {
          lines.push(`- **${truncateText(d.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** — ${truncateText(d.userfullname, TEXT_OUTPUT_POLICY.maxLabelCharacters)}, ${formatDate(d.timemodified)}`);
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
  for (const { site, value } of results) {
    if (!value.assignments) continue;
    const courseNames = new Map(value.courses.map((c) => [c.id, c.fullname]));
    for (const c of value.assignments.courses) {
      for (const assignment of c.assignments) {
        if (assignment.duedate <= 0) continue;
        candidates.push({
          site,
          client: value.client,
          courseId: c.id,
          courseName: courseNames.get(c.id) ?? `Course ${c.id}`,
          assignment,
          bucket: timingBucket(assignment, now),
        });
      }
    }
  }
  candidates.sort((a, b) => TIMING_BUCKET_ORDER[a.bucket] - TIMING_BUCKET_ORDER[b.bucket] || a.assignment.duedate - b.assignment.duedate);
  const omittedTasks = Math.max(0, candidates.length - COMPOSED_TASK_POLICY.maxRendered);
  const showSite = Boolean(multiSite && multiSite.additionalSites.length > 0);

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

  if (tasks.length === 0) {
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
    ["missed", "⚫ Missed (past cutoff — not submitted)"],
    ["submitted", "🔵 Submitted"],
  ];
  for (const [state, heading] of groups) {
    const items = tasks.filter((t) => t.state === state);
    if (items.length === 0) continue;
    lines.push(`### ${heading}`);
    for (const t of items) {
      const late = t.submittedLate ? " (submitted late)" : "";
      const submission = t.submissionStatus ? ` — ${truncateText(t.submissionStatus, TEXT_OUTPUT_POLICY.maxLabelCharacters)}${late}` : "";
      const grading = t.gradingStatus ? `, grading: ${truncateText(t.gradingStatus, TEXT_OUTPUT_POLICY.maxLabelCharacters)}` : "";
      const siteLabel = showSite ? ` — _${truncateText(t.site.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}_` : "";
      lines.push(
        `- **${t.title}** (${t.courseName})${siteLabel} — due ${t.dueDateFormatted}${submission}${grading} — assignment ID: \`${t.assignmentIdLabel}\`, course ID: \`${t.courseIdLabel}\``,
      );
    }
    lines.push("");
  }

  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export function registerComposedTools(server: McpServer, client: MoodleClient, courseRefResolver: CourseRefResolver, multiSite?: MultiSiteContext): void {
  server.tool(
    "course_overview",
    "One-call summary of a course for the student: identity, upcoming deadlines, course grade total, and recent announcements. Use this instead of chaining moodle_get_course + moodle_list_assignments + moodle_get_grades + moodle_get_forum_discussions when the student just wants 'catch me up on this course'.",
    { courseId: RefSchema.describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => withResolvedCourseListing(courseRefResolver, courseId, courseOverview),
  );

  server.tool(
    "upcoming_and_overdue",
    "Cross-course deadline view for the student: every assignment with a due date, across every connected SUNLearn environment, merged and sorted into Overdue / Due soon / Upcoming / Missed / Submitted, with submission and grading status already looked up. Use this instead of chaining moodle_list_courses + moodle_list_assignments + moodle_get_assignment per course when the student asks 'what's due' or 'am I behind on anything'.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: await upcomingAndOverdue(client, multiSite) }],
    }),
  );
}
