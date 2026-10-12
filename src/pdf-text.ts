import { getDocumentProxy } from "unpdf";
import { PDF_READ_POLICY } from "./policy.js";
import { truncateText } from "./text.js";

export class PdfReadError extends Error {}

export interface PdfTextPage {
  number: number;
  text: string;
  lowText: boolean;
  truncated: boolean;
}
export interface PdfTextResult {
  totalPages: number;
  pages: PdfTextPage[];
  nextPage: number | null;
}

/** Data only: no URL, scripts, font downloads, OCR, or rendering. */
export async function readPdfText(bytes: Uint8Array, startPage: number, pageCount: number, signal?: AbortSignal): Promise<PdfTextResult> {
  if (bytes.length > PDF_READ_POLICY.maxBytes) throw new PdfReadError("PDF is too large to read safely (maximum 5 MB).");
  if (!Number.isInteger(startPage) || startPage < 1 || !Number.isInteger(pageCount) || pageCount < 1 || pageCount > PDF_READ_POLICY.maxPagesPerRequest) {
    throw new PdfReadError("Invalid PDF page range.");
  }
  if (signal?.aborted) throw new PdfReadError("PDF reading was cancelled.");
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onCancel: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { stopped = true; reject(new PdfReadError("PDF text extraction timed out. Try a smaller page range.")); }, PDF_READ_POLICY.extractionTimeoutMs);
    onCancel = () => { stopped = true; reject(new PdfReadError("PDF reading was cancelled.")); };
    signal?.addEventListener("abort", onCancel, { once: true });
  });
  const operation = async (): Promise<PdfTextResult> => {
    const pdf = await getDocumentProxy(bytes, {
      useSystemFonts: false,
      useWorkerFetch: false,
      disableFontFace: true,
      disableAutoFetch: true,
      disableStream: true,
      maxImageSize: PDF_READ_POLICY.maxImagePixels,
      verbosity: 0,
      stopAtErrors: true,
    });
    try {
      if (stopped) throw new PdfReadError("PDF reading was cancelled.");
      if (pdf.numPages > PDF_READ_POLICY.maxDocumentPages) throw new PdfReadError(`PDF has too many pages to read safely (maximum ${PDF_READ_POLICY.maxDocumentPages}).`);
      if (startPage > pdf.numPages) throw new PdfReadError(`Page ${startPage} is outside this PDF (${pdf.numPages} pages).`);
      const pages: PdfTextPage[] = [];
      const endPage = Math.min(pdf.numPages, startPage + pageCount - 1);
      for (let number = startPage; number <= endPage; number++) {
        if (stopped) throw new PdfReadError("PDF reading was cancelled.");
        const page = await pdf.getPage(number);
        const reader = page.streamTextContent().getReader();
        let text = "";
        let truncated = false;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            // Drain the stream after the cap without retaining more content.
            // Cancelling PDF.js text streams can race their close notification.
            if (truncated || stopped) continue;
            for (const item of chunk.value.items) {
              if (!("str" in item)) continue;
              text += item.str + (item.hasEOL ? "\n" : " ");
              if (text.length > PDF_READ_POLICY.maxPageCharacters) { truncated = true; break; }
            }
          }
        } finally {
          reader.releaseLock();
          page.cleanup();
        }
        // A PDF can print authenticated Moodle URLs as ordinary text too.
        text = text.replace(/(?:https?:\/\/|\/)[^\s<>]*\/pluginfile\.php[^\s<>]*/gi, "[Moodle file link hidden]").trim();
        pages.push({ number, text: truncateText(text, PDF_READ_POLICY.maxPageCharacters), lowText: text.length < PDF_READ_POLICY.lowTextCharacters, truncated });
      }
      return { totalPages: pdf.numPages, pages, nextPage: endPage < pdf.numPages ? endPage + 1 : null };
    } finally {
      await pdf.loadingTask.destroy();
    }
  };
  try {
    return await Promise.race([operation(), interrupted]);
  } catch (error) {
    if (error instanceof PdfReadError) throw error;
    // Parser messages can contain document content. Never forward them.
    throw new PdfReadError("This PDF could not be read. It may be malformed, encrypted, or use unsupported features.");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onCancel) signal?.removeEventListener("abort", onCancel);
  }
}
