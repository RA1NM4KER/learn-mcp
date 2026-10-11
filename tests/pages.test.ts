import { beforeEach, describe, expect, it, vi } from "vitest";
import { MoodleClient } from "../src/moodle-client.js";
import { getPage } from "../src/tools/pages.js";
import { PAGE_POLICY } from "../src/policy.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const file = { filename: "schedule.png", mimetype: "image/png", filesize: 123, fileurl: "https://moodle.test/webservice/pluginfile.php/1/mod_page/content/1/schedule.png" };
const page = { id: 9, course: 1, coursemodule: 12, name: "Schedule", content: '<table><tr><th>Date</th><th>Test</th></tr><tr><td>8 October</td><td>Tutorial</td></tr></table><img alt="Term 4 schedule" src="'+file.fileurl+'"><a href="'+file.fileurl+'">PDF</a><a href="https://example.org/reading">Reading</a>', contentfiles: [file] };
let courses: unknown;
let modules: unknown;
let pages: unknown;
async function client() {
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    const fn = (init.body as URLSearchParams).get("wsfunction");
    const data = fn === "core_webservice_get_site_info" ? { userid: 1, sitename: "Test", functions: [{ name: "mod_page_get_pages_by_courses" }] }
      : fn === "core_enrol_get_users_courses" ? courses
      : fn === "core_course_get_contents" ? modules
      : { pages };
    return Promise.resolve({ ok: true, json: async () => data });
  });
  return MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "secret" } });
}
beforeEach(() => {
  fetchMock.mockReset();
  courses = [{ id: 1, fullname: "Test", shortname: "T" }];
  modules = [{ id: 1, modules: [{ id: 12, name: "Schedule", modname: "page" }] }];
  pages = [page];
});
describe("Moodle Pages", () => {
  it("preserves table cells, alt text and external links, and seals media", async () => {
    const moodle = await client();
    const text = await getPage(moodle, 1, 12);
    expect(text).toContain("8 October | Tutorial |");
    expect(text).toContain("Term 4 schedule");
    expect(text).toContain("Reading (https://example.org/reading)");
    expect(text).not.toContain("pluginfile.php");
    expect(text).not.toContain("secret");
    const id = /fileId: `([^`]+)`/.exec(text)?.[1];
    expect(id).toBeTruthy();
    expect(await moodle.authorizeFile(id!)).toMatchObject({ pageModuleId: 12, courseId: 1, filename: "schedule.png" });
    courses = [];
    expect(await moodle.authorizeFile(id!)).toBeNull();
    courses = [{ id: 1, fullname: "Test", shortname: "T" }];
    pages = [{ ...page, contentfiles: [] }];
    expect(await moodle.authorizeFile(id!)).toBeNull();
  });
  it("prioritizes currently referenced images across Moodle revision URLs", async () => {
    pages = [{ ...page, content: `<img src="${file.fileurl.replace('/content/1/', '/content/7/')}">`, contentfiles: [{ ...file, filename: "old.png", fileurl: file.fileurl.replace('schedule.png', 'old.png') }, file] }];
    const text = await getPage(await client(), 1, 12);
    expect(text).toContain("image/png; referenced by this page");
    expect(text).toContain("stored attachment, not referenced by this page");
    expect(text.indexOf("schedule.png")).toBeLessThan(text.indexOf("old.png"));
  });
  it("denies un-enrolled courses and disabled content without reading pages", async () => {
    const moodle = await client();
    expect(await getPage(moodle, 1, 12, false)).toContain("disabled");
    courses = [];
    expect(await getPage(moodle, 1, 12)).toContain("not among");
    expect(fetchMock.mock.calls.some(call => (call[1].body as URLSearchParams).get("wsfunction") === "mod_page_get_pages_by_courses")).toBe(false);
  });
  it("hides raw file URLs and preserves single-quoted and unquoted links", async () => {
    pages = [{ ...page, content: `<a href='https://example.org'>Reading</a><a href=${file.fileurl}>File</a> ${file.fileurl}` }];
    const text = await getPage(await client(), 1, 12);
    expect(text).toContain("Reading (https://example.org)");
    expect(text).not.toContain("pluginfile.php");
  });
  it("handles text-only and unavailable pages", async () => {
    const moodle = await client();
    pages = [{ ...page, content: "<p>Plain page</p>", contentfiles: [] }];
    expect(await getPage(moodle, 1, 12)).toContain("Plain page");
    pages = [];
    expect(await getPage(moodle, 1, 12)).toContain("unavailable");
  });
  it("rejects unsafe media and unsupported types", async () => {
    pages = [{ ...page, contentfiles: [{ ...file, fileurl: "https://evil.test/pluginfile.php/secret" }, { ...file, filename: "bad.svg", mimetype: "image/svg+xml" }] }];
    const text = await getPage(await client(), 1, 12);
    expect(text).toContain("unsafe file link");
    expect(text).toContain("unsupported media type");
    expect(text).not.toContain("fileId:");
    expect(text).not.toContain("evil.test");
  });
  it("bounds page content and media, reporting omissions", async () => {
    pages = [{ ...page, content: "x".repeat(PAGE_POLICY.maxContentCharacters + 1), contentfiles: Array.from({ length: PAGE_POLICY.maxMedia + 2 }, () => file) }];
    const text = await getPage(await client(), 1, 12);
    expect(text).toContain("Text truncated");
    expect(text).toContain("2 media files omitted");
    expect(text.match(/fileId:/g)).toHaveLength(PAGE_POLICY.maxMedia);
  });
});
