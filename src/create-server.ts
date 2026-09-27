import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "./moodle-client.js";
import { registerAllTools } from "./register-tools.js";
import type { MultiSiteCourseListing } from "./tools/courses.js";
import type { CourseRefResolver } from "./course-ref-resolver.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

export const STEMLEARN_SERVER_INFO = { name: "stemlearn-mcp", version: "0.1.0" } as const;

/**
 * Build the transport-independent STEMLearn MCP surface. `client` is always
 * this request's single anchor-site MoodleClient — non-course-scoped tools
 * (site info, notifications, ...) operate on it alone. `courseRefResolver`
 * is what every course/assignment/quiz/forum-scoped tool uses instead,
 * dispatching a legacy plain numeric id or a sealed multi-site reference to
 * the right site's client (see course-ref-resolver.ts) — always provided,
 * even in single-site/stdio mode (as a resolver with no other sites, via
 * createAnchorOnlyResolver), so every course-scoped tool has exactly one
 * code path regardless of deployment. `multiSiteCourses`, when provided,
 * additionally lets course listing aggregate across every other connected
 * SUNLearn site (see tools/courses.ts).
 */
export function createStemLearnServer(
  client: MoodleClient,
  courseRefResolver: CourseRefResolver,
  multiSiteCourses?: MultiSiteCourseListing,
): McpServer {
  const server = new McpServer(STEMLEARN_SERVER_INFO);
  registerAllTools(server, client, courseRefResolver, multiSiteCourses);
  registerResources(server, client);
  registerPrompts(server);
  return server;
}
