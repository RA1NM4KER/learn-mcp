import { describe, expect, it } from "vitest";
import { createSunLearnServer, LEARN_MCP_SERVER_INFO } from "../src/create-server.js";
import { createAnchorOnlyResolver } from "../src/course-ref-resolver.js";
import type { MoodleClient } from "../src/moodle-client.js";

type RegisteredSurface = {
  _registeredTools: Record<string, unknown>;
  _registeredPrompts: Record<string, unknown>;
  _registeredResourceTemplates: Record<string, unknown>;
};

describe("shared MCP server factory", () => {
  it("builds the complete transport-independent Learn MCP surface", () => {
    const client = {} as MoodleClient;
    const server = createSunLearnServer(client, createAnchorOnlyResolver(client)) as unknown as RegisteredSurface;

    expect(LEARN_MCP_SERVER_INFO).toEqual({ name: "learn-mcp", version: "0.1.0" });
    expect(Object.keys(server._registeredTools)).toContain("moodle_list_courses");
    expect(Object.keys(server._registeredTools)).toContain("moodle_download_file");
    expect(Object.keys(server._registeredTools)).toContain("upcoming_and_overdue");
    expect(Object.keys(server._registeredTools)).toContain("student_brief");
    expect(Object.keys(server._registeredPrompts)).toEqual(expect.arrayContaining([
      "summarize-course", "whats-due", "build-study-notes", "exam-prep", "search-notes",
    ]));
    expect(Object.keys(server._registeredResourceTemplates)).toContain("moodle-course-files");
  });

  it("does not register file-content tools/resources when content retrieval is disabled, but metadata tools are unaffected", () => {
    const client = {} as MoodleClient;
    const server = createSunLearnServer(client, createAnchorOnlyResolver(client), undefined, false) as unknown as RegisteredSurface;

    expect(Object.keys(server._registeredTools)).not.toContain("moodle_download_file");
    expect(Object.keys(server._registeredResourceTemplates)).not.toContain("moodle-course-files");
    expect(Object.keys(server._registeredTools)).toContain("moodle_list_resources");
    expect(Object.keys(server._registeredTools)).toContain("moodle_list_courses");
  });
});
