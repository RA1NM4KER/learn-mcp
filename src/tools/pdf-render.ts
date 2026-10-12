import type { PdfTextResult } from "../pdf-text.js";
import { TEXT_OUTPUT_POLICY } from "../policy.js";
import { truncateText } from "../text.js";

export function renderPdfText(filename: string, pdf: PdfTextResult): string {
  const first = pdf.pages[0]?.number;
  const last = pdf.pages.at(-1)?.number;
  const lines = [`## ${truncateText(filename, TEXT_OUTPUT_POLICY.maxLabelCharacters)}`, `PDF: ${pdf.totalPages} pages. Showing pages ${first}–${last}.`, "Text extraction only. Diagrams, circuit layouts, waveforms and equation formatting are not visually verified; inspect the original PDF before describing them."];
  for (const page of pdf.pages) {
    lines.push(`\n### Page ${page.number}`);
    if (page.lowText) lines.push("_Little or no extractable text: this page may be scanned, image-heavy or blank. No OCR was performed._");
    lines.push(page.text || "[No extractable text]");
    if (page.truncated) lines.push("_Page text was capped. Inspect the original PDF for the omitted content._");
  }
  if (pdf.nextPage) lines.push(`\nMore pages remain. Call moodle_read_file with the same fileId and startPage: ${pdf.nextPage}.`);
  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}
