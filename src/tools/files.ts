import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import type { CourseRefResolver } from "../course-ref-resolver.js";
import { RefSchema } from "./tool-ref-helpers.js";
import { RESOURCE_LIST_POLICY, TEXT_OUTPUT_POLICY } from "../policy.js";
import { loadCourseContents } from "../moodle-loaders.js";
import { isMoodleFileContent } from "../moodle-api.js";
import { truncateText } from "../text.js";

const FILE_MODS = new Set(["resource", "url", "folder"]);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function listResources(
  client: MoodleClient,
  courseId: number,
  isAnchor: boolean,
  filenameFilter?: string,
  limit: number = RESOURCE_LIST_POLICY.defaultEntries,
): Promise<string> {
  const sections = await loadCourseContents(client, courseId);

  const needle = filenameFilter?.toLowerCase();

  const lines: string[] = [`## Files — Course ${courseId}\n`];
  let hasEntries = false;
  let entryCount = 0;
  let omitted = 0;

  for (const section of sections) {
    const fileMods = section.modules.filter((m) => FILE_MODS.has(m.modname));
    if (fileMods.length === 0) continue;

    const sectionLines: string[] = [];

    for (const mod of fileMods) {
      if (mod.modname === "url") {
        if (needle && !mod.name.toLowerCase().includes(needle)) continue;
        if (entryCount >= limit) { omitted++; continue; }
        sectionLines.push(`- 🔗 **${truncateText(mod.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** *(external link; not downloadable)*`);
        entryCount++;
        continue;
      }
      if (!mod.contents || mod.contents.length === 0) {
        if (needle && !mod.name.toLowerCase().includes(needle)) continue;
        if (entryCount >= limit) { omitted++; continue; }
        sectionLines.push(`- 📁 **${truncateText(mod.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** *(empty)*`);
        entryCount++;
        continue;
      }
      for (const file of mod.contents) {
        if (!isMoodleFileContent(file)) continue;
        if (needle && !file.filename.toLowerCase().includes(needle)) continue;
        if (entryCount >= limit) { omitted++; continue; }
        const size = formatSize(file.filesize);
        entryCount++;
        const mime = file.mimetype ?? "application/octet-stream";
        if (!isAnchor) {
          // moodle_download_file only dispatches to the anchor site so far (see download.ts) —
          // don't hand out a fileId that would just fail there.
          sectionLines.push(`- 📄 **${truncateText(file.filename, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** *(${size})* — download not yet supported for this environment`);
          continue;
        }
        const fileId = await client.fileIdStore.seal({ userId: client.userId, courseId, fileurl: file.fileurl, mime, filename: file.filename, filesize: file.filesize });
        sectionLines.push(`- 📄 **${truncateText(file.filename, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** *(${size})* — fileId: \`${fileId}\` — resource: \`moodle://files/${fileId}\``);
      }
    }

    if (sectionLines.length === 0) continue;
    lines.push(`### ${truncateText(section.name || "General", TEXT_OUTPUT_POLICY.maxLabelCharacters)}`, ...sectionLines, "");
    hasEntries = true;
  }

  if (!hasEntries) {
    return needle
      ? `No files matching "${filenameFilter}" found in this course.`
      : "No downloadable files found in this course.";
  }

  if (omitted) lines.push(`_Showing the first ${limit} matching files. Refine filenameFilter to find other materials._`);
  lines.push("_Use a listed fileId with `moodle_download_file`, or read its `moodle://files/{fileId}` resource URI._");
  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export function registerFileTools(server: McpServer, courseRefResolver: CourseRefResolver): void {
  server.tool(
    "moodle_list_resources",
    "List course materials grouped by their Moodle sections. Downloadable files include an opaque fileId and matching moodle://files/{fileId} resource URI; use either with the server, never a Moodle URL. External links are identified by name only and are not downloadable. Results are bounded; use filenameFilter to refine them.",
    {
      courseId: RefSchema.describe("Course ID from moodle_list_courses"),
      filenameFilter: z
        .string()
        .optional()
        .describe("Substring to match against file/link names (case-insensitive)."),
      limit: z.number().int().min(1).max(RESOURCE_LIST_POLICY.maxEntries).optional().describe("Maximum material entries to return (default: 25, max: 100)."),
    },
    async ({ courseId, filenameFilter, limit }) => {
      const resolved = await courseRefResolver.resolve("course", courseId);
      if (!resolved.ok) return { isError: true, content: [{ type: "text" as const, text: resolved.message }] };
      return {
        content: [{ type: "text" as const, text: await listResources(resolved.client, resolved.id, resolved.isAnchor, filenameFilter, limit) }],
      };
    },
  );
}
