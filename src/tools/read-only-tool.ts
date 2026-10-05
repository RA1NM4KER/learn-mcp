import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

// Every SUNLearn tool only reads. These hints tell clients the tool is safe to
// call without approval. Without them, clients assume a destructive tool and
// block the call.
export const READ_ONLY_TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
};

/** Registers a read-only tool with the shared annotations. Use this, not server.tool, in src/tools. */
export function readOnlyTool<Args extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  schema: Args,
  callback: ToolCallback<Args>,
): void {
  server.tool(name, description, schema, READ_ONLY_TOOL_ANNOTATIONS, callback);
}
