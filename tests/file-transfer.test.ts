import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { MoodleClient, FileTransferCancelledError, FileTransferTimeoutError, MoodleClientError } from "../src/moodle-client.js";
import { registerDownloadTool } from "../src/tools/download.js";
import { registerSaveTool, safeFileName } from "../src/tools/save.js";
import { TEXT_OUTPUT_POLICY } from "../src/policy.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const BASE = "https://moodle.test";
const FILE_URL = `${BASE}/webservice/pluginfile.php/1/assignsubmission_file/submission_files/1/report.pdf`;
const USER = 99;
const FUNCTIONS = ["mod_assign_get_submission_status", "core_course_get_contents"].map((name) => ({ name }));
const EMBED = TEXT_OUTPUT_POLICY.maxEmbeddedBinaryFileBytes;

const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), headers: new Headers() });

/** A body that yields the given chunks. It errors with AbortError if the request signal fires first. */
function streamingResponse(chunks: Uint8Array[], signal: AbortSignal | undefined, contentLength?: number) {
  const headers = new Headers({ "content-type": "application/pdf" });
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      for (const chunk of chunks) controller.enqueue(chunk);
      if (chunks.length > 0) controller.close();
    },
  });
  return { ok: true, status: 200, headers, body };
}

/** A body that never sends a byte, so only the deadline can end the transfer. */
function stalledResponse(signal: AbortSignal | undefined) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal?.addEventListener("abort", () => controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    },
  });
  return { ok: true, status: 200, headers: new Headers({ "content-type": "application/pdf" }), body };
}

async function client(): Promise<MoodleClient> {
  mockFetch.mockResolvedValueOnce(json({ userid: USER, sitename: "STEMLearn", functions: FUNCTIONS }));
  return MoodleClient.create({ baseUrl: BASE, auth: { kind: "token", token: "token" } });
}

/** A mod_assign_get_submission_status response whose latest attempt has one file. */
function statusWithFile(fileurl: string, filename = "report.pdf") {
  return {
    lastattempt: { submission: { id: 1, userid: 1001, groupid: 0, attemptnumber: 0, status: "submitted", latest: 1, plugins: [{ type: "file", fileareas: [{ area: "submission_files", files: [{ filename, filesize: 1, mimetype: "application/pdf", fileurl }] }] }] } },
    previousattempts: [],
  };
}

const fileCalls = () => mockFetch.mock.calls.filter(([url]) => String(url).includes("pluginfile.php"));

describe("file transfer deadlines and caps", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("ends a stalled body read with a timeout that names the duration", async () => {
    const c = await client();
    mockFetch.mockImplementation(async (_url: string, init: { signal?: AbortSignal }) => stalledResponse(init.signal));
    const error = await c.downloadFile(FILE_URL, { timeoutMs: 30 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FileTransferTimeoutError);
    expect((error as Error).message).toContain("did not finish downloading within 1 second");
  });

  it("reports cancellation as cancelled, not as a timeout", async () => {
    const c = await client();
    const controller = new AbortController();
    mockFetch.mockImplementation(async (_url: string, init: { signal?: AbortSignal }) => {
      setTimeout(() => controller.abort(), 5);
      return stalledResponse(init.signal);
    });
    const error = await c.downloadFile(FILE_URL, { signal: controller.signal, timeoutMs: 5_000 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FileTransferCancelledError);
    expect((error as MoodleClientError).code).toBe("cancelled");
  });

  it("stops streaming as soon as the byte cap is passed, without buffering the rest", async () => {
    const c = await client();
    const chunk = new Uint8Array(1024 * 1024);
    mockFetch.mockImplementation(async (_url: string, init: { signal?: AbortSignal }) =>
      streamingResponse(Array.from({ length: 10 }, () => chunk), init.signal));
    const error = await c.downloadFile(FILE_URL, { maxBytes: 3 * 1024 * 1024 }).catch((e: unknown) => e);
    expect((error as MoodleClientError).code).toBe("too-large");
    expect((error as Error).message).toContain("limit for this request is 3 MB");
  });

  it("refuses an oversized content-length before reading any body", async () => {
    const c = await client();
    mockFetch.mockImplementation(async (_url: string, init: { signal?: AbortSignal }) =>
      streamingResponse([], init.signal, 60 * 1024 * 1024));
    const error = await c.downloadFile(FILE_URL, { maxBytes: EMBED }).catch((e: unknown) => e);
    expect((error as MoodleClientError).code).toBe("too-large");
  });

  it("streams chunks to the caller and returns no buffered bytes", async () => {
    const c = await client();
    const payload = new TextEncoder().encode("%PDF-1.4 hello");
    mockFetch.mockImplementation(async (_url: string, init: { signal?: AbortSignal }) =>
      streamingResponse([payload.slice(0, 5), payload.slice(5)], init.signal));
    const received: number[] = [];
    const result = await c.downloadFile(FILE_URL, { onChunk: async (chunk) => { received.push(chunk.byteLength); } });
    expect(received.reduce((a, b) => a + b, 0)).toBe(payload.byteLength);
    expect(result.size).toBe(payload.byteLength);
    expect(result.bytes.byteLength).toBe(0);
  });
});

describe("moodle_download_file size handling", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  function captureDownload(c: MoodleClient) {
    let handler: ((args: { fileId: string }, extra?: { signal?: AbortSignal }) => Promise<{ isError?: boolean; content: { text: string }[] }>) | undefined;
    registerDownloadTool({ tool: (_n: string, _d: string, _s: unknown, _a: unknown, h: never) => { handler = h; } } as never, c, true, undefined, true);
    return handler!;
  }

  it("refuses a file that is too large to embed from its metadata, without fetching it", async () => {
    const c = await client();
    const fileId = await c.fileIdStore.seal({ userId: USER, courseId: 5, fileurl: FILE_URL, mime: "application/pdf", filename: "big.pdf", filesize: 55 * 1024 * 1024, assignmentId: 6326, submitterId: 1001 });
    mockFetch.mockImplementation(async () => json(statusWithFile(FILE_URL)));
    const handler = captureDownload(c);
    const result = await handler({ fileId });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("55.0 MB");
    expect(result.content[0]!.text).toContain("moodle_save_file");
    expect(fileCalls()).toHaveLength(0);
  });
});

describe("moodle_save_file", () => {
  let dir: string;
  beforeEach(() => {
    mockFetch.mockReset();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "learn-mcp-save-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function captureSave(c: MoodleClient) {
    let handler: ((args: { fileId: string }, extra?: { signal?: AbortSignal }) => Promise<{ isError?: boolean; content: { text: string }[] }>) | undefined;
    registerSaveTool({ tool: (_n: string, _d: string, _s: unknown, _a: unknown, h: never) => { handler = h; } } as never, c, dir);
    return handler!;
  }

  it("saves the file, reports size and SHA-256, and does not print the path", async () => {
    const c = await client();
    const payload = new TextEncoder().encode("%PDF-1.7 report body");
    const fileId = await c.fileIdStore.seal({ userId: USER, courseId: 5, fileurl: FILE_URL, mime: "application/pdf", filename: "2026-09-30 21-13.pdf", filesize: payload.byteLength, assignmentId: 6326, submitterId: 1001 });
    mockFetch.mockImplementation(async (url: string, init: { signal?: AbortSignal }) => {
      if (String(url).includes("pluginfile.php")) return streamingResponse([payload], init.signal);
      return json(statusWithFile(FILE_URL));
    });
    const result = await captureSave(c)({ fileId });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text;
    expect(text).toContain('Saved "2026-09-30 21-13.pdf"');
    expect(text).toContain(`SHA-256: ${createHash("sha256").update(payload).digest("hex")}`);
    expect(text).toContain("starts with a PDF signature");
    expect(text).not.toContain(dir);
    expect(fs.readFileSync(path.join(dir, "2026-09-30 21-13.pdf"))).toEqual(Buffer.from(payload));
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".part"))).toHaveLength(0);
  });

  it("leaves no partial file when the transfer fails part-way", async () => {
    const c = await client();
    const big = new Uint8Array(EMBED);
    const fileId = await c.fileIdStore.seal({ userId: USER, courseId: 5, fileurl: FILE_URL, mime: "application/pdf", filename: "cut.pdf", filesize: 1, assignmentId: 6326, submitterId: 1001 });
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("pluginfile.php")) {
        // The connection drops after the first chunk has been written to disk.
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(big);
            controller.error(new Error("connection reset"));
          },
        });
        return { ok: true, status: 200, headers: new Headers({ "content-type": "application/pdf" }), body };
      }
      return json(statusWithFile(FILE_URL, "cut.pdf"));
    });
    const result = await captureSave(c)({ fileId });
    expect(result.isError).toBe(true);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });
});

describe("safeFileName", () => {
  it("reduces a Moodle file name to one safe segment", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("a\\b:c*.pdf")).toBe("b_c_.pdf");
    expect(safeFileName("..hidden.pdf")).toBe("hidden.pdf");
    expect(safeFileName("   ")).toBe("file");
    expect(safeFileName("x".repeat(300) + ".pdf").length).toBe(120);
  });
});
