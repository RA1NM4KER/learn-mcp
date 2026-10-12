import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MoodleClient, MoodleClientError } from "../moodle-client.js";
import type { MultiSiteContext } from "../multi-site-context.js";
import { PDF_READ_POLICY, FILE_TRANSFER_POLICY } from "../policy.js";
import { readPdfText, PdfReadError } from "../pdf-text.js";
import { renderPdfText } from "./pdf-render.js";
import { withOwningSite } from "./download.js";
import { readOnlyTool } from "./read-only-tool.js";

export function registerReadFileTool(server: McpServer, client: MoodleClient, contentEnabled = true, multiSite?: MultiSiteContext): void {
  if (!contentEnabled) return;
  readOnlyTool(server, "moodle_read_file", "Read PDF text from an authorized opaque fileId. Use this for questions about PDF contents instead of relying on binary attachment processing. Returns page-numbered text, total pages, low-text warnings and nextPage. Equations, tables and diagrams may not survive extraction: use moodle_download_file for the original PDF and explicitly request visual inspection. No OCR. For timetable image files use moodle_download_file, which returns native image content.", {
    fileId: z.string().min(1).describe("Opaque fileId from moodle_list_resources, moodle_get_page or assignment submissions"),
    startPage: z.number().int().positive().optional().describe("First PDF page, starting at 1 (default: 1)"),
    pageCount: z.number().int().min(1).max(PDF_READ_POLICY.maxPagesPerRequest).optional().describe("Number of pages (default/max: 5)"),
  }, async ({ fileId, startPage = 1, pageCount = PDF_READ_POLICY.defaultPages }, extra) => {
    try {
      const result = await withOwningSite(client, multiSite, fileId, async owner => {
        const ref = await owner.authorizeFile(fileId);
        if (!ref) return null;
        if (ref.mime !== "application/pdf") throw new PdfReadError("This tool reads PDF files only. Use moodle_download_file for images and other file types.");
        if (ref.filesize > PDF_READ_POLICY.maxBytes) throw new PdfReadError("PDF is too large to read safely (maximum 5 MB).");
        const downloaded = await owner.downloadFile(ref.fileurl, {
          maxBytes: PDF_READ_POLICY.maxBytes,
          timeoutMs: FILE_TRANSFER_POLICY.embedTimeoutMs,
          signal: extra?.signal,
        });
        if (downloaded.mime !== "application/pdf") throw new PdfReadError("The downloaded file is not a PDF. No text was extracted.");
        return { ref, pdf: await readPdfText(downloaded.bytes, startPage, pageCount, extra?.signal) };
      });
      if (!result) return { isError: true, content: [{ type: "text" as const, text: "File access denied. The fileId may be invalid, expired, or unavailable to this account. Obtain a fresh fileId from the listing tool." }] };
      return { content: [{ type: "text" as const, text: renderPdfText(result.ref.filename, result.pdf) }] };
    } catch (error) {
      const message = error instanceof PdfReadError ? error.message
        : error instanceof MoodleClientError && ["timeout", "too-large", "cancelled"].includes(error.code) ? error.message
        : "PDF reading failed. Check access and try again.";
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  });
}
