import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import type { CourseRefResolver } from "../course-ref-resolver.js";
import { RefSchema, withResolvedCourseListing, withResolvedRef, type SubRefSealer } from "./tool-ref-helpers.js";
import { loadAssignments, loadCourseContents, loadEnrolledCourses, loadSubmissionStatus } from "../moodle-loaders.js";
import { ASSIGNMENT_DETAIL_POLICY, ASSIGNMENT_LIST_POLICY, TEXT_OUTPUT_POLICY } from "../policy.js";
import { stripHtml, truncateText } from "../text.js";
import { formatMoodleDateTime } from "../format-date.js";
import { readOnlyTool } from "./read-only-tool.js";

function formatDate(ts: number): string {
  return ts ? formatMoodleDateTime(ts) : "No due date";
}

export async function listAssignments(client: MoodleClient, courseId: number, sealer?: SubRefSealer): Promise<string> {
  if (!client.supports("mod_assign_get_assignments")) {
    return "Assignments API is not enabled on your Moodle. Ask your admin to enable the mod_assign web service.";
  }

  const [sections, assignData] = await Promise.all([
    loadCourseContents(client, courseId),
    loadAssignments(client, {
      "courseids[0]": courseId,
    }),
  ]);

  const assignments = assignData.courses[0]?.assignments ?? [];
  const byModule = new Map(assignments.map((a) => [a.cmid, a]));

  const lines: string[] = [`## Assignments: Course ${courseId}\n`];
  let hasAny = false;
  let renderedAssignments = 0;
  let omittedAssignments = 0;

  for (const section of sections) {
    const assignMods = section.modules.filter((m) => m.modname === "assign");
    if (assignMods.length === 0) continue;

    const sectionLines: string[] = [];
    for (const mod of assignMods) {
      if (renderedAssignments >= ASSIGNMENT_LIST_POLICY.maxRendered) {
        omittedAssignments++;
        continue;
      }
      renderedAssignments++;
      const detail = byModule.get(mod.id);
      if (!detail) {
        sectionLines.push(`- **${truncateText(mod.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** *(details unavailable)*`);
        continue;
      }
      const due = detail.duedate ? `Due: ${formatDate(detail.duedate)}` : "No due date";
      const maxGrade = detail.grade > 0 ? ` | Max grade: ${detail.grade}` : "";
      const idLabel = sealer ? await sealer.seal("assignment", detail.id) : detail.id;
      sectionLines.push(`- **${truncateText(detail.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}**, ${due}${maxGrade}`);
      sectionLines.push(`  ID: \`${idLabel}\` (use with moodle_get_assignment)`);
    }
    if (sectionLines.length > 0) {
      lines.push(`### ${truncateText(section.name || "General", TEXT_OUTPUT_POLICY.maxLabelCharacters)}`, ...sectionLines, "");
      hasAny = true;
    }
  }

  if (!hasAny) return "No assignments found in this course.";
  if (omittedAssignments) lines.push(`_Showing the first ${ASSIGNMENT_LIST_POLICY.maxRendered} assignments; ${omittedAssignments} additional assignments were omitted._`);
  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export async function getAssignment(client: MoodleClient, assignmentId: number, contentEnabled = true): Promise<string> {
  const lines: string[] = [`## Assignment ${assignmentId}\n`];
  if (contentEnabled && client.supports("mod_assign_get_assignments")) {
    const data = await loadAssignments(client, {});
    const course = data.courses.find(item => item.assignments.some(assignment => assignment.id === assignmentId));
    const assignment = course?.assignments.find(item => item.id === assignmentId);
    if (!course || !assignment) return "This assignment is unavailable or you do not have permission to read it.";
    if (!(await loadEnrolledCourses(client)).some(item => item.id === course.id)) return "This course is not among your enrolled courses.";
    lines.push(`**Name:** ${truncateText(stripHtml(assignment.name), TEXT_OUTPUT_POLICY.maxLabelCharacters)}`, `**Due:** ${formatDate(assignment.duedate)}`, "### Instructions", truncateText(stripHtml(assignment.intro), ASSIGNMENT_DETAIL_POLICY.maxInstructionCharacters) || "No inline instructions provided.", "### Instructor attachments");
    const files = [...new Map([...assignment.introfiles, ...assignment.introattachments].map(file => [file.fileurl, file])).values()];
    for (const file of files.slice(0, ASSIGNMENT_DETAIL_POLICY.maxAttachments)) {
      let safe = false;
      try {
        const url = new URL(file.fileurl);
        safe = url.origin === new URL(client.baseUrl).origin && /\/pluginfile\.php(?:\/|$)/i.test(url.pathname) && !url.username && !url.password;
      } catch { /* Never advertise unsafe upstream file destinations. */ }
      if (!safe) { lines.push("- Attachment unavailable (unsafe file link)."); continue; }
      const fileId = await client.fileIdStore.seal({ userId: client.userId, courseId: course.id, assignmentIntroId: assignment.id, fileurl: file.fileurl, filename: file.filename, filesize: file.filesize, mime: file.mimetype ?? "application/octet-stream" });
      lines.push(`- ${truncateText(stripHtml(file.filename), TEXT_OUTPUT_POLICY.maxLabelCharacters)} (${file.mimetype ?? "application/octet-stream"}), fileId: \`${fileId}\`, resource: \`moodle://files/${fileId}\``);
    }
    if (!files.length) lines.push("No instructor attachments provided.");
    if (files.length > ASSIGNMENT_DETAIL_POLICY.maxAttachments) lines.push(`_${files.length - ASSIGNMENT_DETAIL_POLICY.maxAttachments} attachments omitted._`);
    lines.push("_Use moodle_read_file or moodle_download_file with these handles. Access is checked again when retrieved._");
  }
  if (!client.supports("mod_assign_get_submission_status")) {
    lines.push("Assignment submission status API is not enabled on your Moodle.");
    return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
  }

  const status = await loadSubmissionStatus(client, assignmentId);

  lines.push("### Submission Status");

  const submission = status.lastattempt?.submission;
  if (submission) {
    lines.push(`**Status:** ${truncateText(submission.status, TEXT_OUTPUT_POLICY.maxLabelCharacters)}`);
    if (submission.timemodified) {
      lines.push(`**Last modified:** ${formatDate(submission.timemodified)}`);
    }
  } else {
    lines.push("**Status:** Unknown (submission data unavailable)");
  }

  const graded = status.lastattempt?.graded;
  lines.push(`**Graded (assignment API):** ${graded === undefined ? "Unknown" : graded ? "Yes" : "No"}`);
  const gradingStatus = status.lastattempt?.gradingstatus;
  if (gradingStatus) lines.push(`**Assignment API grading status:** ${truncateText(gradingStatus, TEXT_OUTPUT_POLICY.maxLabelCharacters)}`);
  lines.push("_This assignment API status does not establish whether a separate gradebook mark has been released. Check moodle_get_grades for course marks._");

  if (status.feedback) {
    lines.push(`\n**Grade:** ${truncateText(status.feedback.gradefordisplay ?? "N/A", TEXT_OUTPUT_POLICY.maxLabelCharacters)}`);
  }

  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export function registerAssignmentTools(server: McpServer, courseRefResolver: CourseRefResolver, contentEnabled = true): void {
  readOnlyTool(server,
    "moodle_list_assignments",
    "List all assignments the student has in a course, with due dates and max grades. Use this to answer 'what assignments do I have' or 'when is X due'. Returns assignment IDs for use with moodle_get_assignment.",
    { courseId: RefSchema.describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => withResolvedCourseListing(courseRefResolver, courseId, listAssignments),
  );

  readOnlyTool(server,
    "moodle_get_assignment",
    "Read assignment instructions and instructor attachments as safe file handles, plus the student's own submission status and grade feedback: 'have I submitted this', 'was it graded', 'what feedback did I get'.",
    { assignmentId: RefSchema.describe("Assignment ID from moodle_list_assignments") },
    async ({ assignmentId }) => withResolvedRef(courseRefResolver, "assignment", assignmentId, (client, id) => getAssignment(client, id, contentEnabled)),
  );
}
