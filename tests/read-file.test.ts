import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MoodleClient } from "../src/moodle-client.js";
import { createSunLearnServer } from "../src/create-server.js";
import { createAnchorOnlyResolver } from "../src/course-ref-resolver.js";
import { FileIdStore } from "../src/file-id-store.js";
import { makePdf } from "./helpers/pdf.js";
import { PDF_READ_POLICY } from "../src/policy.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const fileurl = "https://moodle.test/pluginfile.php/1/course/content/0/test.pdf";
let allowed = true;
let bytes: Uint8Array;
let mime = "application/pdf";
const text = (result: CallToolResult) => result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
async function setup(contentEnabled = true) {
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    if (init.body) {
      const fn = (init.body as URLSearchParams).get("wsfunction");
      const data = fn === "core_webservice_get_site_info" ? { userid: 1, sitename: "Test", functions: [] }
        : allowed ? [{ id: 1, modules: [{ id: 2, modname: "resource", name: "Test", contents: [{ type: "file", fileurl, filename: "test.pdf", filesize: bytes.length, mimetype: mime }] }] }] : [];
      return Promise.resolve({ ok: true, json: async () => data });
    }
    return Promise.resolve({ ok: true, headers: new Headers({ "content-type": mime }), arrayBuffer: async () => bytes.slice().buffer });
  });
  const moodle = await MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "SECRET" } });
  const server = createSunLearnServer(moodle, createAnchorOnlyResolver(moodle), undefined, contentEnabled);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await server.connect(b);
  await client.connect(a);
  const fileId = await moodle.fileIdStore.seal({ userId: 1, courseId: 5, fileurl, mime, filename: "test.pdf", filesize: bytes.length });
  return { client, moodle, fileId };
}
beforeEach(() => {
  fetchMock.mockReset(); allowed = true; mime = "application/pdf";
  bytes = makePdf(["Task 1 calculates a sawtooth Fourier series", "Task 2 plots 1/5/10/20 terms", "Task 3 uses a band-pass filter, MATLAB and SPICE"]);
});
describe("PDF and image MCP responses", () => {
  it("returns page-numbered readable PDF content over the real MCP protocol and keeps binary downloads", async () => {
    const { client, fileId } = await setup();
    try {
      const result = await client.callTool({ name: "moodle_read_file", arguments: { fileId, pageCount: 2 } }) as CallToolResult;
      expect(result.isError).not.toBe(true);
      expect(text(result)).toContain("PDF: 3 pages. Showing pages 1–2");
      expect(text(result)).toContain("### Page 1\n");
      expect(text(result)).toContain("sawtooth Fourier series");
      expect(text(result)).toContain("startPage: 3");
      expect(text(result)).toContain("not visually verified");
      expect(text(result)).not.toContain("pluginfile.php");
      expect(text(result)).not.toContain("SECRET");
      const binary = await client.callTool({ name: "moodle_download_file", arguments: { fileId } }) as CallToolResult;
      expect(text(binary)).toContain("sawtooth Fourier series");
      expect(binary.content[1]).toMatchObject({ type: "resource", resource: { mimeType: "application/pdf", blob: Buffer.from(bytes).toString("base64") } });
    } finally { await client.close(); }
  });
  it("returns native image content containing the downloaded bytes", async () => {
    mime = "image/png";
    bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0ZkAAAAASUVORK5CYII=", "base64"));
    const { client, fileId } = await setup();
    try {
      const result = await client.callTool({ name: "moodle_download_file", arguments: { fileId } }) as CallToolResult;
      expect(result.content[1]).toEqual({ type: "image", mimeType: "image/png", data: Buffer.from(bytes).toString("base64") });
      const unsupported = await client.callTool({ name: "moodle_read_file", arguments: { fileId } }) as CallToolResult;
      expect(unsupported.isError).toBe(true);
      expect(text(unsupported)).toContain("PDF files only");
    } finally { await client.close(); }
  });
  it("rejects expired, cross-user, cross-token and revoked handles without fetching bytes", async () => {
    const { client, fileId, moodle } = await setup();
    try {
      const ref = { userId: 1, courseId: 5, fileurl, mime, filename: "test.pdf", filesize: bytes.length };
      const bad = ["invalid", await new FileIdStore("SECRET", -1).seal(ref), await moodle.fileIdStore.seal({ ...ref, userId: 2 }), await new FileIdStore("other-account").seal(ref)];
      for (const id of bad) {
        const result = await client.callTool({ name: "moodle_read_file", arguments: { fileId: id } }) as CallToolResult;
        expect(result.isError).toBe(true);
        expect(text(result)).toContain("File access denied");
      }
      allowed = false;
      const revoked = await client.callTool({ name: "moodle_read_file", arguments: { fileId } }) as CallToolResult;
      expect(text(revoked)).toContain("File access denied");
      expect(fetchMock.mock.calls.filter(call => !call[1].body)).toHaveLength(0);
    } finally { await client.close(); }
  });
  it("reports low-text, invalid ranges, malformed PDFs and size limits explicitly", async () => {
    bytes = makePdf([""]);
    const { client, fileId, moodle } = await setup();
    try {
      const empty = await client.callTool({ name: "moodle_read_file", arguments: { fileId } }) as CallToolResult;
      expect(text(empty)).toContain("No OCR was performed");
      expect(text(empty)).toContain("No extractable text");
      const range = await client.callTool({ name: "moodle_read_file", arguments: { fileId, startPage: 2 } }) as CallToolResult;
      expect(range.isError).toBe(true); expect(text(range)).toContain("outside this PDF");
      bytes = new TextEncoder().encode("PRIVATE bad PDF");
      const malformed = await client.callTool({ name: "moodle_read_file", arguments: { fileId } }) as CallToolResult;
      expect(malformed.isError).toBe(true); expect(text(malformed)).not.toContain("PRIVATE");
      const bigId = await moodle.fileIdStore.seal({ userId: 1, courseId: 5, fileurl, mime, filename: "big.pdf", filesize: PDF_READ_POLICY.maxBytes + 1 });
      expect(text(await client.callTool({ name: "moodle_read_file", arguments: { fileId: bigId } }) as CallToolResult)).toContain("too large");
    } finally { await client.close(); }
  });
  it("does not publish PDF reading when course content is disabled", async () => {
    const { client } = await setup(false);
    try { expect((await client.listTools()).tools.map(tool => tool.name)).not.toContain("moodle_read_file"); }
    finally { await client.close(); }
  });
});
