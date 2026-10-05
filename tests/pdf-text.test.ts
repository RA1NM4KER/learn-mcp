import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MoodleClient } from "../src/moodle-client.js";
import { readPdfPages, registerPdfTextTool } from "../src/tools/pdf-text.js";
import { registerDownloadTool } from "../src/tools/download.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const BASE = "https://moodle.test";
const FILE_URL = `${BASE}/webservice/pluginfile.php/1/assignsubmission_file/submission_files/1/report.pdf`;
const USER = 99;
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureBytes = new Uint8Array(fs.readFileSync(path.join(here, "fixtures", "two-page.pdf")));
// pdf.js transfers the buffer it parses, so each use gets its own copy.
const fixture = () => fixtureBytes.slice();

const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), headers: new Headers() });
const statusWithFile = (filename: string, mimetype: string) => ({
  lastattempt: { submission: { id: 1, userid: 1001, groupid: 0, attemptnumber: 0, status: "submitted", latest: 1, plugins: [{ type: "file", fileareas: [{ area: "submission_files", files: [{ filename, filesize: fixtureBytes.byteLength, mimetype, fileurl: FILE_URL }] }] }] } },
  previousattempts: [],
});
function pdfResponse(bytes: Uint8Array) {
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
  return { ok: true, status: 200, headers: new Headers({ "content-type": "application/pdf" }), body };
}

async function client(): Promise<MoodleClient> {
  mockFetch.mockResolvedValueOnce(json({ userid: USER, sitename: "STEMLearn", functions: [{ name: "mod_assign_get_submission_status" }] }));
  return MoodleClient.create({ baseUrl: BASE, auth: { kind: "token", token: "token" } });
}

const fileCalls = () => mockFetch.mock.calls.filter(([url]) => String(url).includes("pluginfile.php"));

function captureText(c: MoodleClient) {
  let handler: ((args: Record<string, unknown>, extra?: { signal?: AbortSignal }) => Promise<{ isError?: boolean; content: { text: string }[] }>) | undefined;
  registerPdfTextTool({ tool: (_n: string, _d: string, _s: unknown, _a: unknown, h: never) => { handler = h; } } as never, c);
  return handler!;
}

describe("readPdfPages", () => {
  it("returns each page's text and the total page count", async () => {
    const r = await readPdfPages(fixture(), 1, 5);
    expect(r.totalPages).toBe(2);
    expect(r.pages.map((p) => p.text)).toEqual(["ALPHA first page", "BRAVO second page"]);
  });

  it("starts from a later page and clamps to the last page", async () => {
    const r = await readPdfPages(fixture(), 2, 10);
    expect(r.startPage).toBe(2);
    expect(r.endPage).toBe(2);
    expect(r.pages.map((p) => p.page)).toEqual([2]);
  });
});

describe("moodle_read_pdf_text", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("returns one page per call and says where to continue", async () => {
    const c = await client();
    const fileId = await c.fileIdStore.seal({ userId: USER, courseId: 5, fileurl: FILE_URL, mime: "application/pdf", filename: "report.pdf", filesize: fixtureBytes.byteLength, assignmentId: 6326, submitterId: 1001 });
    mockFetch.mockImplementation(async (url: string) => (String(url).includes("pluginfile.php") ? pdfResponse(fixture()) : json(statusWithFile("report.pdf", "application/pdf"))));

    const result = await captureText(c)({ fileId, maxPages: 1 });
    const text = result.content[0]!.text;
    expect(text).toContain("pages 1-1 of 2");
    expect(text).toContain("ALPHA first page");
    expect(text).not.toContain("BRAVO");
    expect(text).toContain("startPage=2");
  });

  it("refuses a file that is not a PDF, without downloading it", async () => {
    const c = await client();
    const fileId = await c.fileIdStore.seal({ userId: USER, courseId: 5, fileurl: FILE_URL, mime: "text/plain", filename: "notes.txt", filesize: 10, assignmentId: 6326, submitterId: 1001 });
    mockFetch.mockImplementation(async () => json(statusWithFile("notes.txt", "text/plain")));
    const result = await captureText(c)({ fileId });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not a PDF");
    expect(fileCalls()).toHaveLength(0);
  });

  it("refuses a PDF over the parse limit from its metadata, without downloading it", async () => {
    const c = await client();
    const fileId = await c.fileIdStore.seal({ userId: USER, courseId: 5, fileurl: FILE_URL, mime: "application/pdf", filename: "huge.pdf", filesize: 200 * 1024 * 1024, assignmentId: 6326, submitterId: 1001 });
    mockFetch.mockImplementation(async () => json(statusWithFile("huge.pdf", "application/pdf")));
    const result = await captureText(c)({ fileId });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("over the 60 MB");
    expect(fileCalls()).toHaveLength(0);
  });
});

describe("download refusals point at the text tool", () => {
  it("names moodle_read_pdf_text when a large file is refused", async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(json({ userid: USER, sitename: "STEMLearn", functions: [{ name: "mod_assign_get_submission_status" }] }));
    const c = await MoodleClient.create({ baseUrl: BASE, auth: { kind: "token", token: "token" } });
    const fileId = await c.fileIdStore.seal({ userId: USER, courseId: 5, fileurl: FILE_URL, mime: "application/pdf", filename: "big.pdf", filesize: 55 * 1024 * 1024, assignmentId: 6326, submitterId: 1001 });
    mockFetch.mockImplementation(async () => json(statusWithFile("big.pdf", "application/pdf")));
    let handler: ((args: { fileId: string }) => Promise<{ isError?: boolean; content: { text: string }[] }>) | undefined;
    registerDownloadTool({ tool: (_n: string, _d: string, _s: unknown, _a: unknown, h: never) => { handler = h; } } as never, c, true, undefined, false);
    const result = await handler!({ fileId });
    expect(result.content[0]!.text).toContain("moodle_read_pdf_text");
  });
});
