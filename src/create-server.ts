import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "./moodle-client.js";
import { registerAllTools } from "./register-tools.js";
import type { MultiSiteContext } from "./multi-site-context.js";
import type { CourseRefResolver } from "./course-ref-resolver.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

export const SUNLEARN_SERVER_INFO = { name: "sunlearn-mcp", version: "0.1.0" } as const;

/**
 * Build the transport-independent SUNLearn MCP surface. `client` is always
 * this request's single anchor-site MoodleClient. `courseRefResolver` is
 * what every course/assignment/quiz/forum-SCOPED tool uses instead,
 * dispatching a legacy plain numeric id or a sealed multi-site reference to
 * the right site's client (see course-ref-resolver.ts) — always provided,
 * even in single-site/stdio mode (as a resolver with no other sites, via
 * createAnchorOnlyResolver), so every course-scoped tool has exactly one
 * code path regardless of deployment. `multiSite`, when provided, is what
 * every ACCOUNT-WIDE tool (course listing, cross-course deadlines,
 * notifications) uses to additionally fan out across every other connected
 * SUNLearn site (see multi-site-context.ts).
 */
export function createSunLearnServer(
  client: MoodleClient,
  courseRefResolver: CourseRefResolver,
  multiSite?: MultiSiteContext,
): McpServer {
  const server = new McpServer(SUNLEARN_SERVER_INFO);
  registerAllTools(server, client, courseRefResolver, multiSite);
  registerResources(server, client);
  registerPrompts(server);
  return server;
}
