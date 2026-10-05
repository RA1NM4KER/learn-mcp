import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDocumentProxy } from "unpdf";
import { MoodleClient, MoodleClientError, MoodleTimeoutError } from "../moodle-client.js";
import type { MultiSiteContext } from "../multi-site-context.js";
import { FILE_TRANSFER_POLICY, PDF_TEXT_POLICY, TEXT_OUTPUT_POLICY } from "../policy.js";
import { truncateText } from "../text.js";
import { withOwningSite } from "./download.js";
import { readOnlyTool } from "./read-only-tool.js";

// Reads a PDF's text page by page, so a large report reaches the model as
// text rather than as bytes. Only a page range is returned per call, and the
// whole PDF never goes into the model's context. Works on the remote Worker,
// which has no local disk.

const PDF_SIGNATURE = "%PDF-";

function errorText(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

function failureText(err: unknown): string {
  if (err instanceof MoodleTimeoutError) return err.message;
  if (err instanceof MoodleClientError && (err.code === "timeout" || err.code === "too-large" || err.code === "cancelled")) return err.message;
  return "Could not read this PDF's text. Please try again.";
}

interface PageRange {
  totalPages: number;
  startPage: number;
  endPage: number;
  pages: { page: number; text: string }[];
}

/** Text of pages startPage..startPage+maxPages-1, capped at the file's own page count. */
export async function readPdfPages(bytes: Uint8Array, startPage: number, maxPages: number): Promise<PageRange> {
  const pdf = await getDocumentProxy(bytes);
  try {
    const totalPages = pdf.numPages;
    const startedAt = Math.min(startPage, totalPages);
    const endPage = Math.min(startedAt + maxPages - 1, totalPages);
    const pages: { page: number; text: string }[] = [];
    for (let page = startedAt; page <= endPage; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
      pages.push({ page, text: truncateText(text, PDF_TEXT_POLICY.maxCharactersPerPage) });
    }
    return { totalPages, startPage: startedAt, endPage, pages };
  } finally {
    // Release the parsed document and its cached objects.
    await pdf.cleanup().catch(() => undefined);
  }
}

export function registerPdfTextTool(
  server: McpServer,
  client: MoodleClient,
  multiSite?: MultiSiteContext,
): void {
  readOnlyTool(server,
    "moodle_read_pdf_text",
    `Read the text of a PDF by page, for example a student's submitted report (from moodle_list_assignment_submissions). Returns up to ${PDF_TEXT_POLICY.maxPagesPerCall} pages per call, starting at startPage, so a large PDF is read in parts. Use the next start page in the output to continue. PDFs up to ${PDF_TEXT_POLICY.maxBytes / 1024 / 1024} MB are supported. The result is text only; scanned pages with no text layer return nothing. Read-only.`,
    {
      fileId: z.string().describe("Opaque fileId for a PDF from moodle_list_resources or moodle_list_assignment_submissions"),
      startPage: z.number().int().min(1).optional().describe("First page to return (default 1)"),
      maxPages: z.number().int().min(1).max(PDF_TEXT_POLICY.maxPagesPerCall).optional()
        .describe(`How many pages to return (default ${PDF_TEXT_POLICY.defaultPagesPerCall}, max ${PDF_TEXT_POLICY.maxPagesPerCall})`),
    },
    async ({ fileId, startPage, maxPages }, extra) => {
      const signal = extra?.signal;
      const wanted = maxPages ?? PDF_TEXT_POLICY.defaultPagesPerCall;
      let result;
      try {
        result = await withOwningSite(client, multiSite, fileId, async (owner) => {
          const ref = await owner.authorizeFile(fileId);
          if (!ref) return null;
          const isPdf = ref.mime.toLowerCase().includes("pdf") || ref.filename.toLowerCase().endsWith(".pdf");
          if (!isPdf) return { notPdf: true as const };
          if (ref.filesize > PDF_TEXT_POLICY.maxBytes) return { tooLarge: true as const, ref };
          const downloaded = await owner.downloadFile(ref.fileurl, {
            maxBytes: PDF_TEXT_POLICY.maxBytes,
            timeoutMs: FILE_TRANSFER_POLICY.saveTimeoutMs,
            signal,
          });
          const head = new TextDecoder("latin1").decode(downloaded.bytes.subarray(0, PDF_SIGNATURE.length));
          if (head !== PDF_SIGNATURE) return { notPdf: true as const };
          const pages = await readPdfPages(downloaded.bytes, startPage ?? 1, wanted);
          return { ref, pages };
        });
      } catch (err) {
        return errorText(failureText(err));
      }
      if (!result) {
        return errorText("fileId is invalid, expired, or was not issued to the current user. Re-run the list tool to get fresh IDs.");
      }
      if ("notPdf" in result) return errorText("This file is not a PDF, so its text cannot be read with this tool.");
      if ("tooLarge" in result) {
        return errorText(`This PDF is ${(result.ref.filesize / 1024 / 1024).toFixed(1)} MB, over the ${PDF_TEXT_POLICY.maxBytes / 1024 / 1024} MB this tool reads. Ask for the file itself instead.`);
      }

      const { ref, pages } = result;
      const name = truncateText(ref.filename, TEXT_OUTPUT_POLICY.maxLabelCharacters);
      const header = `**${name}**: pages ${pages.startPage}-${pages.endPage} of ${pages.totalPages}`;
      const hasText = pages.pages.some((p) => p.text.length > 0);
      const lines = [header, ""];
      if (!hasText) {
        lines.push("No text was found on these pages. The PDF may be scanned images, which this tool cannot read.");
      }
      for (const p of pages.pages) {
        lines.push(`--- page ${p.page} ---`, p.text || "(no text on this page)", "");
      }
      if (pages.endPage < pages.totalPages) {
        lines.push(`More pages remain. Call again with startPage=${pages.endPage + 1} to continue.`);
      }
      return { content: [{ type: "text" as const, text: truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters) }] };
    },
  );
}
