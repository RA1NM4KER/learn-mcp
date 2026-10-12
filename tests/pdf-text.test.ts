import { describe, expect, it } from "vitest";
import { readPdfText, PdfReadError } from "../src/pdf-text.js";
import { PDF_READ_POLICY } from "../src/policy.js";
import { makePdf } from "./helpers/pdf.js";

describe("bounded PDF text", () => {
  it("extracts only requested pages and reports total pages and continuation", async () => {
    const result = await readPdfText(makePdf(["first", "Task 2 plots 1/5/10/20-term approximations", "third"]), 2, 1);
    expect(result.totalPages).toBe(3);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({ number: 2, text: "Task 2 plots 1/5/10/20-term approximations", truncated: false });
    expect(result.nextPage).toBe(3);
    expect(await readPdfText(makePdf(["last"]), 1, 5)).toMatchObject({ nextPage: null });
  });
  it("flags empty/scanned pages without pretending to OCR them", async () => {
    const result = await readPdfText(makePdf([""]), 1, 1);
    expect(result.pages[0]).toMatchObject({ text: "", lowText: true });
  });
  it("caps each page and hides printed authenticated Moodle URLs", async () => {
    const result = await readPdfText(makePdf(["https://moodle.test/pluginfile.php/1/file.pdf?token=SECRET", "a".repeat(PDF_READ_POLICY.maxPageCharacters + 100)]), 1, 2);
    expect(result.pages[0]?.text).toBe("[Moodle file link hidden]");
    expect(result.pages[1]?.truncated).toBe(true);
    expect(result.pages[1]?.text.length).toBeLessThan(PDF_READ_POLICY.maxPageCharacters + 100);
  });
  it("rejects malformed files with a generic message, without forwarding parser content", async () => {
    await expect(readPdfText(new TextEncoder().encode("PRIVATE bad PDF"), 1, 1)).rejects.toThrow("This PDF could not be read");
  });
  it("rejects oversized, excessively long, invalid range and cancelled requests", async () => {
    await expect(readPdfText(new Uint8Array(PDF_READ_POLICY.maxBytes + 1), 1, 1)).rejects.toThrow("too large");
    await expect(readPdfText(makePdf(Array.from({ length: PDF_READ_POLICY.maxDocumentPages + 1 }, () => "")), 1, 1)).rejects.toThrow("too many pages");
    await expect(readPdfText(makePdf(["one"]), 2, 1)).rejects.toThrow("outside this PDF");
    await expect(readPdfText(makePdf(["one"]), 0, 1)).rejects.toBeInstanceOf(PdfReadError);
    await expect(readPdfText(makePdf(["one"]), 1, PDF_READ_POLICY.maxPagesPerRequest + 1)).rejects.toThrow("Invalid PDF page range");
    await expect(readPdfText(makePdf(["one"]), 1, 1, AbortSignal.abort())).rejects.toThrow("cancelled");
  });
});
