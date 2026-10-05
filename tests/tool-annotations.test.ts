import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MoodleClient } from "../src/moodle-client.js";
import { createAnchorOnlyResolver } from "../src/course-ref-resolver.js";
import { createSunLearnServer } from "../src/create-server.js";
import { READ_ONLY_TOOL_ANNOTATIONS } from "../src/tools/read-only-tool.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("published tool descriptors", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("marks every SUNLearn tool read-only, so clients do not demand approval for it", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Headers(),
      json: async () => ({ userid: 1, sitename: "STEMLearn", functions: [] }),
      text: async () => "",
    });
    const moodle = await MoodleClient.create({ baseUrl: "https://moodle.test", auth: { kind: "token", token: "token" } });
    const server = createSunLearnServer(moodle, createAnchorOnlyResolver(moodle), undefined, true, "/tmp/learn-mcp-test");

    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await server.connect(serverSide);
    await client.connect(clientSide);

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(20);
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    }
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["moodle_list_assignment_submissions", "moodle_read_pdf_text", "moodle_download_file"]));
    await client.close();
  });

  it("keeps every tool module on the annotated helper, not the raw server.tool call", () => {
    const toolFiles = fs.readdirSync(new URL("../src/tools", import.meta.url)).filter((f) => f.endsWith(".ts"));
    for (const file of toolFiles) {
      if (file === "read-only-tool.ts") continue;
      const source = fs.readFileSync(new URL(`../src/tools/${file}`, import.meta.url), "utf8");
      // Code only: a line that starts with server.tool( is a raw registration; comments do not count.
      expect(source, file).not.toMatch(/^\s*(?!\/\/)[^\n]*\bserver\.tool\(/m);
    }
  });

  it("defines the read-only annotations once", () => {
    expect(READ_ONLY_TOOL_ANNOTATIONS).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true });
  });
});
