import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MoodleClient } from "../moodle-client.js";
import type { Config } from "../config.js";
import type { SunlearnSite } from "../sunlearn-sites.js";
import type { CourseRefResolver } from "../course-ref-resolver.js";
import { RefSchema, withResolvedRef } from "./tool-ref-helpers.js";
import { sanitizeAndTruncateHtml, truncateText } from "../text.js";
import { COURSE_NOTICE_POLICY, COURSE_STRUCTURE_POLICY, TEXT_OUTPUT_POLICY, mapWithConcurrency } from "../policy.js";
import { loadCourseContents, loadEnrolledCourses } from "../moodle-loaders.js";

/** Enables moodle_list_courses to aggregate across every SUNLearn site a user has connected, beyond the anchor `client`. */
export interface MultiSiteCourseListing {
  additionalSites: readonly { site: SunlearnSite; config: Config }[];
  anchorSiteName: string;
  sealCourseId: (siteId: string, courseId: number) => Promise<string>;
}

const ADDITIONAL_SITE_CONCURRENCY = 4;

export interface CourseNotice {
  sectionName: string;
  text: string;
  activity?: string;
}

const NOTICE_TERMS = /\b(deadline|due|submit|submission|demonstration|rsvp|practical|test)\b/i;
const PRIORITY_NOTICE_TERMS = /\b(deadline|due|submit|submission|rsvp)\b/i;
const NOTICE_DATE = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday,?\s+)?(\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december))\b/gi;
const NOTICE_ACTIVITY = /\b(?:practical|assignment|test)\s*\d+\b/i;

function noticeExcerpt(text: string): string {
  const priority = /\b(deadline|due|rsvp)\b/i.exec(text) ?? PRIORITY_NOTICE_TERMS.exec(text);
  if (!priority || priority.index === undefined) {
    return truncateText(text, TEXT_OUTPUT_POLICY.maxCourseNoticeCharacters);
  }
  const sentenceStart = text.lastIndexOf(".", priority.index) + 1;
  const sentenceEnd = text.indexOf(".", priority.index);
  const excerpt = text.slice(sentenceStart, sentenceEnd === -1 ? undefined : sentenceEnd + 1).trim();
  return truncateText(excerpt || text, TEXT_OUTPUT_POLICY.maxCourseNoticeCharacters);
}

export function hasConflictingNoticeDates(notices: readonly CourseNotice[]): boolean {
  const datesByActivity = new Map<string, Set<string>>();
  for (const notice of notices) {
    if (!PRIORITY_NOTICE_TERMS.test(notice.text)) continue;
    const activity = notice.activity ?? NOTICE_ACTIVITY.exec(notice.text)?.[0]?.toLowerCase();
    if (!activity) continue;
    const dates = datesByActivity.get(activity) ?? new Set<string>();
    datesByActivity.set(activity, dates);
    for (const match of notice.text.matchAll(NOTICE_DATE)) {
      const date = match[1];
      if (date) dates.add(date.toLowerCase());
    }
  }
  return [...datesByActivity.values()].some((dates) => dates.size > 1);
}

export async function listCourses(client: MoodleClient, multiSite?: MultiSiteCourseListing): Promise<string> {
  const anchorCourses = await loadEnrolledCourses(client);

  // Exactly today's single-site rendering when there is nothing else connected —
  // zero behavior change for the common (single SUNLearn site) case.
  if (!multiSite || multiSite.additionalSites.length === 0) {
    if (anchorCourses.length === 0) return "You are not enrolled in any courses.";
    const displayed = anchorCourses.slice(0, 100);
    const lines = displayed.map(
      (c) => `- **${truncateText(c.fullname, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** (${truncateText(c.shortname, TEXT_OUTPUT_POLICY.maxLabelCharacters)}) — ID: \`${c.id}\``
    );
    return truncateText(`## Your Courses\n\n${lines.join("\n")}${anchorCourses.length > displayed.length ? "\n\n_Showing the first 100 courses._" : ""}`, TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
  }

  type Row = { siteName: string; fullname: string; shortname: string; idLabel: string };
  const rows: Row[] = [];
  for (const c of anchorCourses) {
    rows.push({ siteName: multiSite.anchorSiteName, fullname: c.fullname, shortname: c.shortname, idLabel: String(c.id) });
  }

  const unavailable: string[] = [];
  const perSiteResults = await mapWithConcurrency(multiSite.additionalSites, ADDITIONAL_SITE_CONCURRENCY, async ({ site, config }) => {
    try {
      const siteClient = await MoodleClient.create(config);
      const courses = await loadEnrolledCourses(siteClient);
      return { site, courses };
    } catch {
      return { site, courses: null };
    }
  });
  for (const { site, courses } of perSiteResults) {
    if (courses === null) {
      unavailable.push(site.name);
      continue;
    }
    for (const c of courses) {
      const idLabel = await multiSite.sealCourseId(site.id, c.id);
      rows.push({ siteName: site.name, fullname: c.fullname, shortname: c.shortname, idLabel });
    }
  }

  if (rows.length === 0 && unavailable.length === 0) return "You are not enrolled in any courses.";

  const displayed = rows.slice(0, 100);
  const lines = displayed.map(
    (r) =>
      `- **${truncateText(r.fullname, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** (${truncateText(r.shortname, TEXT_OUTPUT_POLICY.maxLabelCharacters)}) — _${truncateText(r.siteName, TEXT_OUTPUT_POLICY.maxLabelCharacters)}_ — ID: \`${r.idLabel}\``,
  );
  const notes = [
    rows.length > displayed.length ? "_Showing the first 100 courses._" : "",
    unavailable.length > 0 ? `_Temporarily unavailable: ${unavailable.map((n) => truncateText(n, TEXT_OUTPUT_POLICY.maxLabelCharacters)).join(", ")}._` : "",
    `_IDs from ${multiSite.anchorSiteName} work with every other tool; IDs from other environments currently only work with this listing._`,
  ].filter(Boolean);
  return truncateText(`## Your Courses\n\n${lines.join("\n")}${notes.length ? `\n\n${notes.join("\n")}` : ""}`, TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export async function getCourse(client: MoodleClient, courseId: number): Promise<string> {
  const sections = await loadCourseContents(client, courseId);
  if (sections.length === 0) return "This course has no content.";
  const lines: string[] = [];
  let renderedModules = 0;
  let omittedModules = 0;
  let omittedSections = 0;
  for (const [sectionIndex, section] of sections.entries()) {
    if (sectionIndex >= COURSE_STRUCTURE_POLICY.maxRenderedSections) {
      omittedSections++;
      omittedModules += section.modules.length;
      continue;
    }
    const summary = section.summary
      ? sanitizeAndTruncateHtml(section.summary, TEXT_OUTPUT_POLICY.maxCourseSummaryCharacters)
      : "";
    const rendered = section.modules.filter(() => {
      if (renderedModules >= COURSE_STRUCTURE_POLICY.maxRenderedModules) {
        omittedModules++;
        return false;
      }
      renderedModules++;
      return true;
    });
    if (rendered.length === 0 && !summary) continue;
    lines.push(`### ${truncateText(section.name || "General", TEXT_OUTPUT_POLICY.maxLabelCharacters)}`);
    if (summary) lines.push(summary, "");
    for (const mod of rendered) {
      lines.push(`- \`${truncateText(mod.modname, TEXT_OUTPUT_POLICY.maxLabelCharacters)}\` **${truncateText(mod.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}**`);
    }
  }
  if (omittedModules || omittedSections) {
    lines.push(`_Showing up to ${COURSE_STRUCTURE_POLICY.maxRenderedSections} sections and ${COURSE_STRUCTURE_POLICY.maxRenderedModules} activities; ${omittedSections} sections and ${omittedModules} activities were omitted._`);
  }
  return lines.length ? truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters) : "This course has no content.";
}

/** Current section summaries are lecturer-maintained notices, not attachment metadata. */
export async function getCourseNoticesRaw(client: MoodleClient, courseId: number): Promise<CourseNotice[]> {
  const sections = await loadCourseContents(client, courseId);
  return sections.flatMap((section) => {
    const text = sanitizeAndTruncateHtml(section.summary ?? "", TEXT_OUTPUT_POLICY.maxCourseSummaryCharacters);
    if (!text || !NOTICE_TERMS.test(text)) return [];
    const activity = NOTICE_ACTIVITY.exec(text)?.[0]?.toLowerCase();
    return [{
      sectionName: truncateText(section.name || "General", TEXT_OUTPUT_POLICY.maxLabelCharacters),
      text: noticeExcerpt(text),
      ...(activity ? { activity } : {}),
    }];
  }).slice(0, COURSE_NOTICE_POLICY.maxRendered);
}

export async function getCourseNotices(client: MoodleClient, courseId: number): Promise<string> {
  const notices = await getCourseNoticesRaw(client, courseId);
  if (notices.length === 0) return "No current deadline or practical notices were found in course-section summaries.";
  const lines = [`## Current Course Notices — Course ${courseId}`, ""];
  if (hasConflictingNoticeDates(notices)) {
    lines.push("⚠️ **Conflicting deadline dates appear in course-section notices.** The notices below are shown with their section source; verify the applicable date with the lecturer before relying on an older PDF or post.", "");
  }
  for (const notice of notices) lines.push(`### ${notice.sectionName}`, notice.text, "");
  lines.push("_These are current course-section notices. If an attachment or forum post has a conflicting date, verify with the lecturer._");
  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export function registerCourseTools(
  server: McpServer,
  client: MoodleClient,
  courseRefResolver: CourseRefResolver,
  multiSite?: MultiSiteCourseListing,
): void {
  server.tool(
    "moodle_list_courses",
    "List all courses the student is currently enrolled in, across every connected SUNLearn environment. Usually the first call to make — gives the course IDs every other tool needs.",
    {},
    async () => ({ content: [{ type: "text" as const, text: await listCourses(client, multiSite) }] })
  );

  server.tool(
    "moodle_get_course",
    "Get the full structure of one course — its sections/weeks and every activity/resource in them. Use moodle_list_courses first to get the course ID.",
    { courseId: RefSchema.describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => withResolvedRef(courseRefResolver, "course", courseId, getCourse),
  );

  server.tool(
    "moodle_get_course_notices",
    "Read current course-section notices relevant to deadlines, submissions, practicals, demonstrations, and tests. Use this to verify a deadline when a PDF, forum post, or calendar entry conflicts with the current course page.",
    { courseId: RefSchema.describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => withResolvedRef(courseRefResolver, "course", courseId, getCourseNotices),
  );
}
