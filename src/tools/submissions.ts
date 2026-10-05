import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MoodleClient, MoodleClientError, MoodleTimeoutError } from "../moodle-client.js";
import type { CourseRefResolver } from "../course-ref-resolver.js";
import type { MoodleAssignParticipant, MoodleAssignSubmission } from "../moodle-api.js";
import {
  loadAssignmentGroups,
  loadAssignmentParticipants,
  loadAssignmentSubmissionStatus,
  loadAssignments,
  loadUsersByIdNumber,
} from "../moodle-loaders.js";
import { RefSchema } from "./tool-ref-helpers.js";
import { mapWithConcurrency, SUBMISSION_POLICY, TEXT_OUTPUT_POLICY } from "../policy.js";
import { truncateText } from "../text.js";
import { formatMoodleDateTime } from "../format-date.js";

// Read-only TA/grader access to assignment submissions. Nothing here calls a
// Moodle write API. Every fileId is issued from a server response and bound
// to this account, and MoodleClient.authorizeFile re-checks it before a
// download. See the tool descriptions below for the caller-facing contract.

type Group = { id: number; name: string };
type SubmissionFile = MoodleAssignSubmission["plugins"][number]["fileareas"][number]["files"][number];

interface AssignmentContext {
  client: MoodleClient;
  courseId: number;
  assignmentId: number;
  assignmentName: string;
  /** Course-module ID, used to build the grader page link. */
  courseModuleId: number;
  teamSubmission: boolean;
  groups: Group[];
  contentEnabled: boolean;
}

interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const PERMISSION_MESSAGE =
  "Moodle refused this request. Your account may not have grading access to this assignment.";
const NOT_ENABLED_MESSAGE =
  "The assignment submissions API is not enabled on this Moodle. Ask your admin to enable mod_assign web services.";
const NO_FILE_DOWNLOADS_NOTE =
  "File downloads are not enabled on this deployment, so no file IDs are issued.";

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  draft: "Draft (not submitted for grading)",
  new: "No submission yet",
  reopened: "Reopened",
};

function errorResult(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** A Moodle request timed out during one named step of the lookup. */
class SubmissionStepTimeoutError extends Error {
  constructor(readonly step: string, readonly elapsedMs: number) {
    super(
      `Moodle did not answer in time while ${step} (waited ${elapsedMs} ms). ` +
        "Try again. If it keeps happening, raise MOODLE_MCP_REQUEST_TIMEOUT_MS (up to 120000).",
    );
    this.name = "SubmissionStepTimeoutError";
  }
}

/**
 * Runs one Moodle step and logs its duration to stderr (never stdout, which
 * carries the MCP stream). Logs the step name and milliseconds only, no
 * student data, tokens, or URLs. A timeout is re-thrown with the step named,
 * so the caller can say which request stalled.
 */
async function timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    console.error(`[submissions] ${step}: ${Date.now() - started} ms`);
    return result;
  } catch (err) {
    const elapsed = Date.now() - started;
    console.error(`[submissions] ${step}: failed after ${elapsed} ms (${err instanceof Error ? err.name : "unknown error"})`);
    if (err instanceof MoodleTimeoutError) throw new SubmissionStepTimeoutError(step, elapsed);
    throw err;
  }
}

async function loadContext(
  resolver: CourseRefResolver,
  courseRef: number | string,
  assignmentRef: number | string,
  contentEnabled: boolean,
): Promise<{ ok: true; ctx: AssignmentContext } | { ok: false; message: string }> {
  const course = await resolver.resolve("course", courseRef);
  if (!course.ok) return { ok: false, message: course.message };
  const assignment = await resolver.resolve("assignment", assignmentRef);
  if (!assignment.ok) return { ok: false, message: assignment.message };
  if (assignment.siteId !== course.siteId) {
    return { ok: false, message: "The course and assignment must come from the same SUNLearn environment." };
  }

  const client = course.client;
  if (!client.supports("mod_assign_get_submissions")) return { ok: false, message: NOT_ENABLED_MESSAGE };

  const assignments = await timed("loading the assignment list", () => loadAssignments(client, { "courseids[0]": course.id }));
  const found = (assignments.courses[0]?.assignments ?? []).find((a) => a.id === assignment.id);
  if (!found) {
    return { ok: false, message: "That assignment was not found in this course, or your account cannot access it." };
  }

  // core_group_get_activity_allowed_groups applies the assignment's grouping
  // restriction, so the groups returned here are the only ones this tool will
  // accept as a filter.
  const allowed = await timed("loading the allowed groups", () => loadAssignmentGroups(client, found.cmid));
  return {
    ok: true,
    ctx: {
      client,
      courseId: course.id,
      assignmentId: found.id,
      assignmentName: found.name,
      courseModuleId: found.cmid,
      teamSubmission: found.teamsubmission === 1,
      groups: allowed.groups,
      contentEnabled,
    },
  };
}

function resolveGroup(groups: Group[], group: number | string): { ok: true; group: Group } | { ok: false; message: string } {
  if (typeof group === "number") {
    const found = groups.find((g) => g.id === group);
    return found
      ? { ok: true, group: found }
      : { ok: false, message: `Group ${group} is not available for this assignment. Run moodle_list_assignment_groups to see the allowed groups.` };
  }
  const needle = group.trim().toLowerCase();
  const matches = groups.filter((g) => g.name.trim().toLowerCase() === needle);
  if (matches.length === 0) {
    return { ok: false, message: "No group with that name is available for this assignment. Run moodle_list_assignment_groups to see the names." };
  }
  if (matches.length > 1) return { ok: false, message: "More than one group has that name. Pass its group ID instead." };
  return { ok: true, group: matches[0]! };
}

/**
 * The assignment roster in one call. With a group, only that group's
 * members are returned. `fullDetails` is needed for group listings, where
 * student numbers are shown; number lookups only need IDs and names. Bounded
 * by SUBMISSION_POLICY.maxRosterSize, and `truncated` says when entries were dropped.
 */
async function loadRoster(
  client: MoodleClient,
  assignmentId: number,
  groupId: number | undefined,
  fullDetails: boolean,
): Promise<{ participants: MoodleAssignParticipant[]; truncated: boolean }> {
  const all = await loadAssignmentParticipants(client, assignmentId, groupId ?? 0, !fullDetails);
  const truncated = all.length > SUBMISSION_POLICY.maxRosterSize;
  return { participants: all.slice(0, SUBMISSION_POLICY.maxRosterSize), truncated };
}

/** One submission owner: an individual student, or a group whose submission is shared by its members. */
interface Unit {
  key: string;
  label: string;
  shared: boolean;
  attempts: MoodleAssignSubmission[];
  /** The bench group's Moodle group ID, for team submissions only. */
  groupId?: number;
}

/** One student's submissions, from mod_assign_get_submission_status (cheap, per student). */
interface StudentSubmissions {
  individual: MoodleAssignSubmission[];
  /** The group's latest submission on a team assignment. Earlier group attempts are not listed. */
  team: MoodleAssignSubmission | undefined;
}

async function fetchStudentSubmissions(ctx: AssignmentContext, participant: MoodleAssignParticipant): Promise<StudentSubmissions> {
  const status = await loadAssignmentSubmissionStatus(ctx.client, ctx.assignmentId, participant.id);
  const candidates = [status.lastattempt?.submission, ...status.previousattempts.map((attempt) => attempt.submission)];
  const seen = new Set<number>();
  const individual: MoodleAssignSubmission[] = [];
  for (const submission of candidates) {
    if (!submission || seen.has(submission.id)) continue;
    seen.add(submission.id);
    individual.push(submission);
  }
  return { individual, team: status.lastattempt?.teamsubmission };
}

function unitFor(ctx: AssignmentContext, participant: MoodleAssignParticipant, own: StudentSubmissions): Unit {
  if (ctx.teamSubmission) {
    const team = own.team;
    if (!team || team.groupid === 0) return { key: `none:${participant.id}`, label: "Student", shared: false, attempts: [] };
    const groupId = team.groupid;
    const name = participant.groups.find((g) => g.id === groupId)?.name
      ?? ctx.groups.find((g) => g.id === groupId)?.name
      ?? `group ${groupId}`;
    return {
      key: `group:${groupId}`,
      label: truncateText(name, TEXT_OUTPUT_POLICY.maxLabelCharacters),
      shared: true,
      attempts: [team],
      groupId,
    };
  }
  return {
    key: `user:${participant.id}`,
    label: "Student",
    shared: false,
    attempts: own.individual,
  };
}

function formatWhen(ts: number): string {
  return ts ? formatMoodleDateTime(ts) : "unknown time";
}

async function sealFile(ctx: AssignmentContext, submitterId: number, file: SubmissionFile): Promise<string> {
  return ctx.client.fileIdStore.seal({
    userId: ctx.client.userId,
    courseId: ctx.courseId,
    fileurl: file.fileurl,
    mime: file.mimetype || "application/octet-stream",
    filename: file.filename,
    filesize: file.filesize,
    assignmentId: ctx.assignmentId,
    submitterId,
  });
}

/** Every attempt is shown, newest first, up to a cap. Nothing is selected silently. */
async function renderAttempts(ctx: AssignmentContext, attempts: MoodleAssignSubmission[], submitterId: number): Promise<string[]> {
  if (attempts.length === 0) return ["- Not submitted"];

  const lines: string[] = [];
  const newestFirst = [...attempts].sort((a, b) => b.attemptnumber - a.attemptnumber);
  for (const attempt of newestFirst.slice(0, SUBMISSION_POLICY.maxAttemptsPerSubmission)) {
    const status = STATUS_LABELS[attempt.status] ?? truncateText(attempt.status || "Unknown", TEXT_OUTPUT_POLICY.maxLabelCharacters);
    const latest = attempt.latest ? ", latest" : "";
    const modified = attempt.timemodified ? `, modified ${formatWhen(attempt.timemodified)}` : "";
    lines.push(`- Attempt ${attempt.attemptnumber}${latest}: ${status}${modified}`);

    const files = attempt.plugins
      .filter((p) => p.type === "file")
      .flatMap((p) => p.fileareas.flatMap((area) => area.files));
    if (files.length === 0) {
      lines.push("  - No file attachments on this attempt");
      continue;
    }
    for (const file of files.slice(0, SUBMISSION_POLICY.maxFilesPerAttempt)) {
      const name = truncateText(file.filename, TEXT_OUTPUT_POLICY.maxLabelCharacters);
      const mime = file.mimetype || "application/octet-stream";
      const idPart = ctx.contentEnabled
        ? ` · fileId \`${await sealFile(ctx, submitterId, file)}\``
        : "";
      lines.push(`  - ${name} (${mime}, ${file.filesize} bytes)${idPart}`);
    }
    if (files.length > SUBMISSION_POLICY.maxFilesPerAttempt) {
      lines.push(`  - ${files.length - SUBMISSION_POLICY.maxFilesPerAttempt} more file(s) omitted`);
    }
  }
  if (attempts.length > SUBMISSION_POLICY.maxAttemptsPerSubmission) {
    lines.push(`- ${attempts.length - SUBMISSION_POLICY.maxAttemptsPerSubmission} older attempt(s) omitted`);
  }
  return lines;
}

/** Renders a unit's attempts once. A later member of the same shared group gets a pointer instead of duplicate file IDs. */
async function renderUnit(ctx: AssignmentContext, unit: Unit, submitterId: number, rendered: Set<string>): Promise<string[]> {
  if (rendered.has(unit.key)) {
    return [`  - Shared group submission (${unit.label}), listed above`];
  }
  rendered.add(unit.key);
  const heading = unit.shared ? `  - Shared group submission for ${unit.label}:` : "  Submission:";
  const body = (await renderAttempts(ctx, unit.attempts, submitterId)).map((line) => `    ${line}`);
  return [heading, ...body];
}

function describeParticipant(p: MoodleAssignParticipant): string {
  const name = truncateText(p.fullname || p.username || "Unnamed student", TEXT_OUTPUT_POLICY.maxLabelCharacters);
  const number = p.idnumber?.trim();
  const numberPart = number ? `student number \`${number}\`` : "student number not returned by Moodle";
  return `${name}, ${numberPart}, Moodle user ID ${p.id}`;
}

function moodlePage(ctx: AssignmentContext, query: Record<string, string>): string {
  const url = new URL("/mod/assign/view.php", ctx.client.baseUrl);
  url.searchParams.set("id", String(ctx.courseModuleId));
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * The Moodle page for one bench group on a team assignment. Uses the
 * course-module ID and the group ID. Grader links by student user ID redirect
 * on team assignments; group links are the ones that work.
 */
export function groupUrl(ctx: AssignmentContext, groupId: number): string {
  return moodlePage(ctx, { group: String(groupId) });
}

/**
 * The grader page for one student on an individual assignment. Built from the
 * course-module ID and the Moodle user ID. It holds no token and no file URL.
 * On a team assignment the group page is used instead.
 */
function gradingUrl(ctx: AssignmentContext, userId: number): string {
  return moodlePage(ctx, { action: "grader", userid: String(userId) });
}

function linkFor(ctx: AssignmentContext, participant: MoodleAssignParticipant, unit: Unit): string {
  if (ctx.teamSubmission && unit.groupId !== undefined) return groupUrl(ctx, unit.groupId);
  return gradingUrl(ctx, participant.id);
}

function renderGroupList(ctx: AssignmentContext): string {
  const lines = [`## Groups for ${truncateText(ctx.assignmentName, TEXT_OUTPUT_POLICY.maxLabelCharacters)}\n`];
  if (ctx.groups.length === 0) {
    lines.push("No groups are available to your account for this assignment.");
  } else {
    for (const group of ctx.groups) {
      lines.push(`- **${truncateText(group.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}**, group ID \`${group.id}\``);
      lines.push(`  Group page: ${groupUrl(ctx, group.id)}`);
    }
  }
  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

/**
 * One bench group on a team assignment: its group page link, its members with
 * student numbers, and its one shared submission with the files listed once.
 */
async function renderTeamGroupBlock(
  ctx: AssignmentContext,
  group: Group,
  members: MoodleAssignParticipant[],
): Promise<string[]> {
  const name = truncateText(group.name, TEXT_OUTPUT_POLICY.maxLabelCharacters);
  const lines: string[] = [`### Bench group ${name} (group ID ${group.id})`, `Group page: ${groupUrl(ctx, group.id)}`];
  if (members.length === 0) {
    lines.push("No members were returned for this group.");
    return lines;
  }

  const ordered = [...members].sort((a, b) => (a.fullname || a.username).localeCompare(b.fullname || b.username));
  const shown = ordered.slice(0, SUBMISSION_POLICY.maxRenderedRows);
  lines.push(`Members (${members.length}):`);
  for (const member of shown) lines.push(`- ${describeParticipant(member)}`);
  if (members.length > shown.length) lines.push(`_${members.length - shown.length} more member(s) omitted._`);

  const representative = ordered[0]!;
  const own = await timed("loading submission status", () => fetchStudentSubmissions(ctx, representative));
  const unit = unitFor(ctx, representative, own);
  if (unit.attempts.length === 0) {
    lines.push("Submission: not submitted");
    return lines;
  }
  lines.push("Submission:");
  for (const line of await renderAttempts(ctx, unit.attempts, representative.id)) lines.push(`  ${line}`);
  return lines;
}

async function renderSubmissionReport(
  ctx: AssignmentContext,
  options: { numbers: string[]; group: Group | undefined },
): Promise<string> {
  const lookingUpNumbers = options.numbers.length > 0;
  const roster = await timed("loading the participant list", () =>
    loadRoster(ctx.client, ctx.assignmentId, options.group?.id, !lookingUpNumbers));

  const title = truncateText(ctx.assignmentName, TEXT_OUTPUT_POLICY.maxLabelCharacters);
  const lines: string[] = [`## Submissions: ${title} (assignment ${ctx.assignmentId})\n`];
  if (options.group) lines.push(`Group filter: **${truncateText(options.group.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}**`);
  lines.push(`Participants in this assignment: ${roster.participants.length}${roster.truncated ? " (roster limit reached; results may be incomplete)" : ""}`);
  if (options.group && roster.participants.length === 0) {
    lines.push("Moodle returned no participants for this group. Moodle also returns nothing for groups hidden from this account, so this does not prove the group has no students.");
  }
  if (!ctx.contentEnabled) lines.push(`_${NO_FILE_DOWNLOADS_NOTE}_`);
  lines.push("");

  if (ctx.teamSubmission && options.group && !lookingUpNumbers) {
    // One block per bench group. Its members share one submission, so one status call covers the group.
    lines.push(...(await renderTeamGroupBlock(ctx, options.group, roster.participants)));
    return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
  }

  const rosterIds = new Set(roster.participants.map((p) => p.id));
  const rosterById = new Map(roster.participants.map((p) => [p.id, p]));

  // Decide who is shown first, so only those students' submission status is fetched.
  type NumberResult =
    | { number: string; kind: "unmatched" }
    | { number: string; kind: "ambiguous"; matches: MoodleAssignParticipant[] }
    | { number: string; kind: "matched"; participant: MoodleAssignParticipant };
  let numberResults: NumberResult[] = [];
  let listed: MoodleAssignParticipant[] = [];
  let omittedParticipants = 0;

  if (lookingUpNumbers) {
    // One exact idnumber lookup for every requested number. Users Moodle does
    // not return are not visible to this account, or do not exist. Either way,
    // "unmatched" is the honest result.
    const users = await timed("looking up student numbers", () => loadUsersByIdNumber(ctx.client, options.numbers));
    numberResults = options.numbers.map((number): NumberResult => {
      const candidates = users.filter((u) => u.idnumber?.trim() === number && rosterIds.has(u.id));
      if (candidates.length === 0) return { number, kind: "unmatched" };
      if (candidates.length > 1) {
        return {
          number,
          kind: "ambiguous",
          matches: candidates.map((u) => ({ id: u.id, fullname: u.fullname, username: "", idnumber: number, groups: [] })),
        };
      }
      const user = candidates[0]!;
      const rosterEntry = rosterById.get(user.id);
      return {
        number,
        kind: "matched",
        participant: { id: user.id, fullname: rosterEntry?.fullname || user.fullname, username: "", idnumber: number, groups: rosterEntry?.groups ?? [] },
      };
    });
    listed = numberResults.flatMap((r) => (r.kind === "matched" ? [r.participant] : []));
  } else {
    // Group listing with no number lookup, bounded by maxRenderedRows.
    const ordered = [...roster.participants].sort((a, b) => (a.fullname || a.username).localeCompare(b.fullname || b.username));
    listed = ordered.slice(0, SUBMISSION_POLICY.maxRenderedRows);
    omittedParticipants = ordered.length - listed.length;
  }

  const fetched = new Map<number, StudentSubmissions>();
  await timed("loading submission status", () => mapWithConcurrency(listed, SUBMISSION_POLICY.statusConcurrency, async (p) => {
    fetched.set(p.id, await fetchStudentSubmissions(ctx, p));
  }));

  const rendered = new Set<string>();
  const unitOf = (p: MoodleAssignParticipant) => unitFor(ctx, p, fetched.get(p.id) ?? { individual: [], team: undefined });

  if (lookingUpNumbers) {
    lines.push("### Student number lookups\n");
    for (const result of numberResults) {
      const { number } = result;
      switch (result.kind) {
        case "unmatched":
          lines.push(`- \`${number}\`: **unmatched**. No participant of this assignment has this student number, or your account cannot see one.`);
          break;
        case "ambiguous": {
          const ids = result.matches.map((p) => p.id).join(", ");
          lines.push(`- \`${number}\`: **ambiguous**, ${result.matches.length} participants share this student number (Moodle user IDs ${ids}). Nothing was selected or downloaded.`);
          break;
        }
        case "matched":
          lines.push(`- \`${number}\`: **matched**, ${describeParticipant(result.participant)}`);
          lines.push(`  - Grading page: ${linkFor(ctx, result.participant, unitOf(result.participant))}`);
          lines.push(...(await renderUnit(ctx, unitOf(result.participant), result.participant.id, rendered)));
          break;
      }
    }
    lines.push("");
  } else {
    const label = options.group ? truncateText(options.group.name, TEXT_OUTPUT_POLICY.maxLabelCharacters) : "all participants";
    lines.push(`### Participants in ${label}\n`);
    for (const participant of listed) {
      lines.push(`- ${describeParticipant(participant)}`);
      lines.push(`  - Grading page: ${linkFor(ctx, participant, unitOf(participant))}`);
      lines.push(...(await renderUnit(ctx, unitOf(participant), participant.id, rendered)));
    }
    if (omittedParticipants > 0) {
      lines.push(`_${omittedParticipants} more participant(s) omitted; narrow the group filter or request specific student numbers._`);
    }
  }

  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

/** Maps Moodle failures to explicit messages without forwarding upstream text. */
async function runTool(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SubmissionStepTimeoutError) return errorResult(err.message);
    if (err instanceof MoodleTimeoutError) return errorResult(err.message);
    if (err instanceof MoodleClientError && err.code === "api") return errorResult(PERMISSION_MESSAGE);
    if (err instanceof MoodleClientError) return errorResult(err.message);
    return errorResult("Could not read submissions from Moodle. Please try again.");
  }
}

export function registerSubmissionTools(
  server: McpServer,
  courseRefResolver: CourseRefResolver,
  contentEnabled = true,
): void {
  server.tool(
    "moodle_list_assignment_groups",
    "List the groups a teaching assistant can filter an assignment's submissions by. Returns group names and IDs. The list respects the assignment's grouping restrictions. Read-only.",
    {
      courseId: RefSchema.describe("Course ID from moodle_list_courses"),
      assignmentId: RefSchema.describe("Assignment ID from moodle_list_assignments"),
    },
    async ({ courseId, assignmentId }) => runTool(async () => {
      const loaded = await loadContext(courseRefResolver, courseId, assignmentId, contentEnabled);
      if (!loaded.ok) return errorResult(loaded.message);
      return { content: [{ type: "text", text: renderGroupList(loaded.ctx) }] };
    }),
  );

  server.tool(
    "moodle_list_assignment_submissions",
    "Find an assignment's submissions for a teaching assistant. Look up students by exact student number (up to 25 per call) and/or filter by group name or group ID. Returns each student's submission status, every attempt (nothing is selected silently), attachment names, MIME types, sizes, opaque fileIds for moodle_download_file, and a Moodle grader page link for each student (the TA opens it to enter marks). Shared group submissions are listed once. Read-only: no grades are written.",
    {
      courseId: RefSchema.describe("Course ID from moodle_list_courses"),
      assignmentId: RefSchema.describe("Assignment ID from moodle_list_assignments"),
      studentNumbers: z.array(z.string().trim().min(1).max(32))
        .max(SUBMISSION_POLICY.maxStudentNumbers)
        .optional()
        .describe("Exact student numbers, kept as text so leading zeros are preserved"),
      group: z.union([z.number().int().positive(), z.string().trim().min(1).max(200)])
        .optional()
        .describe("Group ID or exact group name from moodle_list_assignment_groups"),
    },
    async ({ courseId, assignmentId, studentNumbers, group }) => runTool(async () => {
      const numbers = [...new Set((studentNumbers ?? []).map((n) => n.trim()).filter((n) => n.length > 0))];
      if (numbers.length === 0 && group === undefined) {
        return errorResult("Provide at least one student number, a group, or both.");
      }
      if (numbers.length > SUBMISSION_POLICY.maxStudentNumbers) {
        return errorResult(`Look up at most ${SUBMISSION_POLICY.maxStudentNumbers} student numbers per call.`);
      }

      const loaded = await loadContext(courseRefResolver, courseId, assignmentId, contentEnabled);
      if (!loaded.ok) return errorResult(loaded.message);

      let selectedGroup: Group | undefined;
      if (group !== undefined) {
        const resolved = resolveGroup(loaded.ctx.groups, group);
        if (!resolved.ok) return errorResult(resolved.message);
        selectedGroup = resolved.group;
      }

      const text = await renderSubmissionReport(loaded.ctx, { numbers, group: selectedGroup });
      return { content: [{ type: "text", text }] };
    }),
  );
}
