import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "./moodle-client.js";
import { registerAllTools } from "./register-tools.js";
import type { MultiSiteContext } from "./multi-site-context.js";
import type { CourseRefResolver } from "./course-ref-resolver.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

// "learn-mcp" is the MCP protocol's self-reported server name/version (what
// an MCP client shows during initialize) — pure presentation, like a
// User-Agent string. Unlike DEFAULT_USER_ID, deriveStemlearnUserId, or any
// AAD/HKDF namespace, nothing cryptographic or storage-keyed depends on this
// exact string, so it renames freely with the rest of the public brand.
export const LEARN_MCP_SERVER_INFO = { name: "learn-mcp", version: "0.1.0" } as const;

/**
 * Build the transport-independent Learn MCP surface. `client` is always
 * this request's single anchor-site MoodleClient. `courseRefResolver` is
 * what every course/assignment/quiz/forum-SCOPED tool uses instead,
 * dispatching a legacy plain numeric id or a sealed multi-site reference to
 * the right site's client (see course-ref-resolver.ts) — always provided,
 * even in single-site/stdio mode (as a resolver with no other sites, via
 * createAnchorOnlyResolver), so every course-scoped tool has exactly one
 * code path regardless of deployment. `multiSite`, when provided, is what
 * every ACCOUNT-WIDE tool (course listing, cross-course deadlines,
 * notifications) uses to additionally fan out across every other connected
 * SUNLearn site (see multi-site-context.ts). `contentEnabled` (default true;
 * the remote Worker passes REMOTE_COURSE_CONTENT_ENABLED) independently gates
 * full file-content retrieval (moodle_download_file, the moodle://files/*
 * resource) without touching any course-metadata tool. `downloadDir`, set only
 * by the local stdio server, enables moodle_save_file for large files.
 */
export function createSunLearnServer(
  client: MoodleClient,
  courseRefResolver: CourseRefResolver,
  multiSite?: MultiSiteContext,
  contentEnabled = true,
  downloadDir?: string,
): McpServer {
  const server = new McpServer(LEARN_MCP_SERVER_INFO);
  registerAllTools(server, client, courseRefResolver, multiSite, contentEnabled, downloadDir);
  registerResources(server, client, contentEnabled);
  registerPrompts(server);
  return server;
}
