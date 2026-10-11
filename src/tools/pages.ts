import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import type { CourseRefResolver } from "../course-ref-resolver.js";
import { loadCourseContents, loadEnrolledCourses, loadPages } from "../moodle-loaders.js";
import { PAGE_POLICY, TEXT_OUTPUT_POLICY } from "../policy.js";
import { stripHtml, truncateText } from "../text.js";
import { RefSchema } from "./tool-ref-helpers.js";
import { readOnlyTool } from "./read-only-tool.js";

// Moodle's rendered content uses a revision number; contentfiles can use 0.
// Match the same file across those forms without confusing old unused assets.
function pageFileKey(value: string): string | null {
  try {
    const url = new URL(value.replace(/&amp;/gi, "&"));
    const path = decodeURIComponent(url.pathname).replace("/webservice/pluginfile.php/", "/pluginfile.php/")
      .replace(/(\/mod_page\/content\/)[^/]+(\/)/, "$1$2");
    return `${url.origin}${path}`;
  } catch { return null; }
}

export async function getPage(client: MoodleClient, courseId: number, moduleId: number, contentEnabled = true): Promise<string> {
  if (!contentEnabled) return "Course content access is currently disabled for this deployment.";
  if (!(await loadEnrolledCourses(client)).some(course => course.id === courseId)) return "This course is not among your enrolled courses.";
  const sections = await loadCourseContents(client, courseId);
  if (!sections.some(section => section.modules.some(mod => mod.id === moduleId && mod.modname === "page"))) return "This Page activity is unavailable in the selected course.";
  if (!client.supports("mod_page_get_pages_by_courses")) return "The Moodle Page API is unavailable on this site.";
  const page = (await loadPages(client, courseId)).pages.find(page => page.course === courseId && page.coursemodule === moduleId);
  if (!page) return "This Page activity is unavailable or you do not have permission to read it.";
  const html = page.content
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\b(href|alt)\s*=\s*'([^']*)'/gi, '$1="$2"')
    .replace(/\bhref\s*=\s*([^\s"'>]+)/gi, 'href="$1"')
    .replace(/<img\b[^>]*\balt="([^"]*)"[^>]*>/gi, " [Image: $1] ")
    .replace(/<\/(?:p|div|h[1-6]|tr|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, " | ");
  const lines = [`## ${truncateText(page.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}`, truncateText(stripHtml(html).replace(/https?:\/\/[^\s<>]*\/pluginfile\.php[^\s<>]*/gi, "[Moodle file: use the media handles below]"), PAGE_POLICY.maxContentCharacters), "", "### Page media"];
  const references = new Set([...page.content.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
    .map(match => pageFileKey(match[1] ?? match[2] ?? match[3] ?? "")));
  const isReferenced = (url: string) => {
    const key = pageFileKey(url);
    return key !== null && references.has(key);
  };
  const files = [...page.contentfiles].sort((a, b) => Number(isReferenced(b.fileurl)) - Number(isReferenced(a.fileurl)));
  for (const file of files.slice(0, PAGE_POLICY.maxMedia)) {
    let safe = false;
    try {
      const url = new URL(file.fileurl);
      const base = new URL(client.baseUrl);
      safe = url.origin === base.origin && /\/pluginfile\.php(?:\/|$)/i.test(url.pathname) && !url.username && !url.password;
    } catch { /* unsafe upstream metadata is never exposed */ }
    const name = truncateText(file.filename, TEXT_OUTPUT_POLICY.maxLabelCharacters);
    const mime = file.mimetype ?? "application/octet-stream";
    if (!safe) { lines.push(`- ${name}: unavailable (unsafe file link).`); continue; }
    if (!/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(mime)) { lines.push(`- ${name}: unsupported media type.`); continue; }
    const fileId = await client.fileIdStore.seal({ userId: client.userId, courseId, pageModuleId: moduleId, fileurl: file.fileurl, filename: file.filename, filesize: file.filesize, mime });
    lines.push(`- ${name} (${mime}; ${isReferenced(file.fileurl) ? "referenced by this page" : "stored attachment, not referenced by this page"}), fileId: \`${fileId}\`, resource: \`moodle://files/${fileId}\``);
  }
  if (!page.contentfiles.length) lines.push("No attached media available.");
  if (page.contentfiles.length > PAGE_POLICY.maxMedia) lines.push(`_${page.contentfiles.length - PAGE_POLICY.maxMedia} media files omitted._`);
  lines.push("_Read the file resource or use moodle_download_file to inspect media. File access is checked again when retrieved._");
  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export function registerPageTools(server: McpServer, resolver: CourseRefResolver, contentEnabled: boolean): void {
  readOnlyTool(server, "moodle_get_page", "Read a Moodle Page activity's text, tables and image alt text, with safe file handles for embedded images and PDFs. Get courseId and pageModuleId from moodle_get_course.", {
    courseId: RefSchema, pageModuleId: z.number().int().positive(),
  }, async ({ courseId, pageModuleId }) => {
    const resolved = await resolver.resolve("course", courseId);
    if (!resolved.ok) return { isError: true, content: [{ type: "text" as const, text: resolved.message }] };
    return { content: [{ type: "text" as const, text: await getPage(resolved.client, resolved.id, pageModuleId, contentEnabled) }] };
  });
}
