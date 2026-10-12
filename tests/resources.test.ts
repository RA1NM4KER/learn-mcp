import { describe, expect, it, vi } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { RESOURCE_LIST_POLICY } from "../src/policy.js";
import { registerResources } from "../src/resources/index.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data, text: async () => JSON.stringify(data) });

describe("MCP resource enumeration", () => {
  it("applies a deterministic global resource cap without concurrent mutation", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ userid: 1, username: "student", sitename: "STEMLearn", fullname: "Student", release: "4" }));
    const client = await MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "token" } });
    const courses = [{ id: 1, fullname: "One", shortname: "ONE" }, { id: 2, fullname: "Two", shortname: "TWO" }];
    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams;
      if (body.get("wsfunction") === "core_enrol_get_users_courses") return jsonResponse(courses);
      const courseId = Number(body.get("courseid"));
      const files = Array.from({ length: 75 }, (_, i) => ({ type: "file", filename: `${courseId}-${i}`, fileurl: `https://moodle.test/pluginfile.php/${courseId}/${i}`, filesize: 1 }));
      return jsonResponse([{ id: courseId, name: "General", modules: [{ id: courseId, name: "Files", modname: "folder", contents: files }] }]);
    });

    let template: { listCallback: () => Promise<{ resources: { name: string }[] }> } | undefined;
    const server = { resource: (_name: string, resourceTemplate: typeof template, _handler: unknown) => { template = resourceTemplate; } };
    registerResources(server as never, client);
    const result = await template!.listCallback();

    expect(result.resources).toHaveLength(RESOURCE_LIST_POLICY.maxEntries);
    expect(result.resources[0]!.name).toContain("ONE");
    expect(result.resources.at(-1)!.name).toContain("TWO");
  });
});

it("reads secondary-site handles through their owner and rechecks current access", async () => {
  const config = { baseUrl: "https://emslearn.sun.ac.za", auth: { kind: "token" as const, token: "secondary" }, maxFileBytes: 1024, requestTimeoutMs: 1000 };
  mockFetch.mockResolvedValueOnce(jsonResponse({ userid: 1, sitename: "Anchor" }));
  const anchor = await MoodleClient.create({ ...config, baseUrl: "https://stemlearn.sun.ac.za", auth: { kind: "token", token: "anchor" } });
  mockFetch.mockResolvedValueOnce(jsonResponse({ userid: 2, sitename: "Secondary" }));
  const owner = await MoodleClient.create(config);
  const url = "https://emslearn.sun.ac.za/pluginfile.php/1/notes.txt";
  const id = await owner.fileIdStore.seal({ userId: 2, courseId: 3, fileurl: url, mime: "text/plain", filename: "notes.txt", filesize: 5 });
  let allowed = true;
  mockFetch.mockImplementation((request: string, init?: RequestInit) => {
    const parsed = new URL(request);
    expect(parsed.host).toBe("emslearn.sun.ac.za");
    if (parsed.pathname.includes("pluginfile.php")) {
      expect(parsed.searchParams.get("token")).toBe("secondary");
      return new Response("hello", { headers: { "content-type": "text/plain" } });
    }
    const fn = new URLSearchParams(String(init?.body)).get("wsfunction");
    if (fn === "core_webservice_get_site_info") return jsonResponse({ userid: 2, sitename: "Secondary" });
    if (fn === "core_enrol_get_users_courses") return jsonResponse([{ id: 3, fullname: "Course", shortname: "C" }]);
    return jsonResponse([{ id: 1, name: "General", modules: [{ id: 1, name: "Notes", modname: "resource", contents: allowed ? [{ type: "file", filename: "notes.txt", fileurl: url, filesize: 5 }] : [] }] }]);
  });
  let read: ((uri: URL, args: { fileId: string }) => Promise<unknown>) | undefined;
  const server = { resource: (_name: string, _template: unknown, handler: typeof read) => { read = handler; } };
  registerResources(server as never, anchor, true, {
    anchorSite: { id: "stemlearn", name: "Anchor" },
    additionalSites: [{ site: { id: "emslearn", name: "Secondary", baseUrl: config.baseUrl, enabled: true }, config }],
    seal: async (_kind, _site, value) => value,
  });
  expect(await read!(new URL(`moodle://files/${id}`), { fileId: id })).toMatchObject({ contents: [{ text: "hello" }] });
  allowed = false;
  await expect(read!(new URL(`moodle://files/${id}`), { fileId: id })).rejects.toThrow("File access denied");
});
