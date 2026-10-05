import { describe, expect, it, vi, beforeEach } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { FileIdStore } from "../src/file-id-store.js";
import { contentDisposition, deriveFileLinkKey, fileLinkUrl, handleFileLinkRequest, openFileLink, sealFileLink } from "../src/file-links.js";
import { registerDownloadTool } from "../src/tools/download.js";

const resolveConfig = vi.fn();
vi.mock("../src/linking/resolve-config.js", () => ({
  resolveMoodleConfigForSite: (...args: unknown[]) => resolveConfig(...args),
  resolveMoodleConfigForOAuthUser: (...args: unknown[]) => resolveConfig(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const BASE = "https://stemlearn.sun.ac.za";
const FILE_URL = `${BASE}/webservice/pluginfile.php/1/assignsubmission_file/submission_files/1/report.pdf`;
const SECRET = "test-credential-secret";
const OWNER = "stemlearn-owner";
const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), headers: new Headers() });
const FUNCTIONS = [{ name: "mod_assign_get_submission_status" }];
const PDF = new TextEncoder().encode("%PDF-1.7 link test body");

function statusWith(fileurl: string) {
  return { lastattempt: { submission: { id: 1, userid: 1001, groupid: 0, attemptnumber: 0, status: "submitted", latest: 1, plugins: [{ type: "file", fileareas: [{ area: "submission_files", files: [{ filename: "report.pdf", filesize: PDF.byteLength, mimetype: "application/pdf", fileurl }] }] }] } }, previousattempts: [] };
}

function streamOf(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
}

async function refFor() {
  const store = new FileIdStore("moodle-token-for-test");
  return { userId: 1001, courseId: 5, fileurl: FILE_URL, mime: "application/pdf", filename: "report.pdf", filesize: PDF.byteLength, assignmentId: 6326, submitterId: 1001 } as const;
}

async function linkFor(now = Date.now(), ttl = 60_000) {
  const key = await deriveFileLinkKey(SECRET);
  return sealFileLink(key, await refFor(), OWNER, BASE, ttl, now);
}

const env = { CREDENTIAL_ENCRYPTION_KEY: SECRET } as never;
const get = (token: string) => new Request(`https://learn.test/files/${token}`, { method: "GET" });

describe("signed file links", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resolveConfig.mockReset();
    resolveConfig.mockResolvedValue({ baseUrl: BASE, auth: { kind: "token", token: "owner-token" }, maxFileBytes: 100 * 1024 * 1024, requestTimeoutMs: 20_000 });
  });

  it("opens a genuine, unexpired link and returns its payload", async () => {
    const key = await deriveFileLinkKey(SECRET);
    const token = await linkFor();
    const payload = await openFileLink(key, token);
    expect(payload).toMatchObject({ ownerId: OWNER, baseUrl: BASE, filename: "report.pdf", assignmentId: 6326 });
  });

  it("rejects an expired link", async () => {
    const key = await deriveFileLinkKey(SECRET);
    const token = await linkFor(Date.now() - 120_000, 60_000);
    expect(await openFileLink(key, token)).toBeNull();
  });

  it("rejects a tampered link", async () => {
    const key = await deriveFileLinkKey(SECRET);
    const token = await linkFor();
    const mid = Math.floor(token.length / 2);
    const tampered = token.slice(0, mid) + (token[mid] === "A" ? "B" : "A") + token.slice(mid + 1);
    expect(await openFileLink(key, tampered)).toBeNull();
  });

  it("rejects a link sealed with a different secret", async () => {
    const otherKey = await deriveFileLinkKey("some-other-secret");
    expect(await openFileLink(otherKey, await linkFor())).toBeNull();
  });

  it("does not put a Moodle token or a raw Moodle URL in the link", async () => {
    const token = await linkFor();
    expect(token).not.toContain("stemlearn.sun.ac.za");
    expect(token).not.toContain("owner-token");
    expect(fileLinkUrl("https://learn.test", token)).toBe(`https://learn.test/files/${token}`);
  });

  it("streams the file with a safe attachment name and no-store caching", async () => {
    const token = await linkFor();
    mockFetch.mockImplementation(async (url: string, init?: { body?: URLSearchParams }) => {
      if (String(url).includes("pluginfile.php")) return { ok: true, status: 200, headers: new Headers({ "content-type": "application/pdf" }), body: streamOf(PDF) };
      if (init?.body?.get("wsfunction") === "core_webservice_get_site_info") return json({ userid: 1001, sitename: "STEMLearn", functions: FUNCTIONS });
      return json(statusWith(FILE_URL));
    });
    const res = await handleFileLinkRequest(get(token), env);
    expect(res.status).toBe(200);
    // Regression: the credential must come from the file's own site, not the anchor site.
    expect(resolveConfig).toHaveBeenCalledWith(OWNER, expect.objectContaining({ id: "stemlearn" }), expect.anything());
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="report.pdf"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
  });

  it("returns the same 404 for a tampered link, a link for another site, and a removed file", async () => {
    const token = await linkFor();
    const mid = Math.floor(token.length / 2);
    const tampered = token.slice(0, mid) + (token[mid] === "A" ? "B" : "A") + token.slice(mid + 1);
    expect((await handleFileLinkRequest(get(tampered), env)).status).toBe(404);

    resolveConfig.mockResolvedValueOnce({ baseUrl: "https://other.edu", auth: { kind: "token", token: "x" }, maxFileBytes: 1, requestTimeoutMs: 1 });
    expect((await handleFileLinkRequest(get(token), env)).status).toBe(404);

    mockFetch.mockImplementation(async (_url: string, init?: { body?: URLSearchParams }) =>
      init?.body?.get("wsfunction") === "core_webservice_get_site_info"
        ? json({ userid: 1001, sitename: "STEMLearn", functions: FUNCTIONS })
        : json({ previousattempts: [] }));
    const removed = await handleFileLinkRequest(get(token), env);
    expect(removed.status).toBe(404);
    expect(await removed.text()).toContain("invalid, has expired");
  });

  it("returns 404 when the credential secret is not configured", async () => {
    expect((await handleFileLinkRequest(get(await linkFor()), {} as never)).status).toBe(404);
  });

  it("cleans filenames for the attachment header", () => {
    expect(contentDisposition("../../evil.pdf")).toContain('filename="evil.pdf"');
    expect(contentDisposition("a\"b.pdf")).toContain('filename="a_b.pdf"');
  });

  it("the download tool gives the user a link instead of a refusal when a link can be issued", async () => {
    mockFetch.mockResolvedValueOnce(json({ userid: 1001, sitename: "STEMLearn", functions: FUNCTIONS }));
    const client = await MoodleClient.create({ baseUrl: BASE, auth: { kind: "token", token: "t" } });
    const store = new FileIdStore("t");
    const fileId = await client.fileIdStore.seal({ userId: 1001, courseId: 5, fileurl: FILE_URL, mime: "application/pdf", filename: "big.pdf", filesize: 55 * 1024 * 1024, assignmentId: 6326, submitterId: 1001 });
    mockFetch.mockImplementation(async () => json(statusWith(FILE_URL)));
    let handler: ((args: { fileId: string }) => Promise<{ isError?: boolean; content: { text: string }[] }>) | undefined;
    registerDownloadTool({ tool: (_n: string, _d: string, _s: unknown, _a: unknown, h: never) => { handler = h; } } as never, client, true, undefined, false, async (ref, siteBaseUrl) => fileLinkUrl("https://learn.test", await sealFileLink(await deriveFileLinkKey(SECRET), ref, OWNER, siteBaseUrl, 60_000)));
    const result = await handler!({ fileId });
    expect(result.content[0]!.text).toContain("https://learn.test/files/");
    expect(result.content[0]!.text).toContain("works for one hour");
    expect(store).toBeDefined();
  });
});
