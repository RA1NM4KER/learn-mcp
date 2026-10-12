import type { MoodleClient } from "../moodle-client.js";
import type { MultiSiteContext } from "../multi-site-context.js";
import { loadAssignments } from "../moodle-loaders.js";
import { readPdfText } from "../pdf-text.js";
import { FILE_TRANSFER_POLICY, PDF_READ_POLICY, STUDENT_BRIEF_POLICY, TEXT_OUTPUT_POLICY } from "../policy.js";
import { truncateText } from "../text.js";
import { formatMoodleDateOnly, formatMoodleDateTime } from "../format-date.js";
import { withOwningSite } from "./download.js";

/** Explicitly selected documents only; never scan every course file in a brief. */
export async function checkDocumentDeadline(
  anchor: MoodleClient,
  multiSite: MultiSiteContext | undefined,
  assignmentClient: MoodleClient,
  assignmentId: number,
  fileId: string,
): Promise<string> {
  try {
    const result = await withOwningSite(anchor, multiSite, fileId, async owner => {
      const ref = await owner.authorizeFile(fileId);
      if (!ref || owner.baseUrl !== assignmentClient.baseUrl) return null;
      const data = await loadAssignments(owner, { "courseids[0]": ref.courseId });
      const assignment = data.courses.find(c => c.id === ref.courseId)?.assignments.find(a => a.id === assignmentId);
      if (!assignment) return null;
      if (ref.mime !== "application/pdf" || ref.filesize > PDF_READ_POLICY.maxBytes) return "Document deadline not checked: select a PDF within the reading size limit.";
      const downloaded = await owner.downloadFile(ref.fileurl, { maxBytes: PDF_READ_POLICY.maxBytes, timeoutMs: FILE_TRANSFER_POLICY.embedTimeoutMs });
      if (downloaded.mime !== "application/pdf") return "Document deadline not checked: downloaded content is not a PDF.";
      const pdf = await readPdfText(downloaded.bytes, 1, STUDENT_BRIEF_POLICY.deadlineDocumentPages);
      const text = pdf.pages.map(page => page.text).join(" ").replace(/\s+/g, " ");
      // Only explicit English deadline/due phrases with a full date and year.
      // Dates of practical sessions elsewhere in a document are not deadlines.
      const pattern = /\b(?:deadline|due(?:\s+date)?)\s*(?:is\s*)?[:\-]?\s*(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/gi;
      const dates = [...text.matchAll(pattern)].map(match => `${match[1]} ${match[2]} ${match[3]}`);
      const title = truncateText(assignment.name, TEXT_OUTPUT_POLICY.maxLabelCharacters);
      const filename = truncateText(ref.filename, TEXT_OUTPUT_POLICY.maxLabelCharacters);
      const due = assignment.duedate ? formatMoodleDateTime(assignment.duedate) : "no assignment deadline";
      if (!dates.length) return `**${title}:** No explicit supported deadline date found in ${filename}, pages 1–${pdf.pages.length}. This does not verify agreement; other pages, images and date formats were not checked.`;
      const authoritative = assignment.duedate ? formatMoodleDateOnly(assignment.duedate) : null;
      if (!authoritative) return `**${title}:** PDF ${filename} lists ${dates.join(", ")}, but the assignment has no due date; no comparison was possible.`;
      const conflicts = dates.filter(date => {
        const parsed = Date.parse(`${date} 12:00:00 GMT`);
        return Number.isFinite(parsed) && formatMoodleDateOnly(parsed / 1000) !== authoritative;
      });
      const source = `PDF ${filename}, pages 1–${pdf.pages.length}: ${[...new Set(dates)].join(", ")}; Moodle assignment: ${due}.`;
      return conflicts.length
        ? `⚠️ **Conflicting deadline dates — ${title}.** ${source} Verify with the lecturer; no date was selected automatically.`
        : `**${title}:** Calendar dates agree in the checked text. ${source} Submission times, unread pages and diagrams were not verified.`;
    });
    return result ?? "Document deadline not checked: the file and assignment must be currently accessible in the same course and site.";
  } catch { return "Document deadline check unavailable. No agreement was inferred; retry the document and assignment tools."; }
}
