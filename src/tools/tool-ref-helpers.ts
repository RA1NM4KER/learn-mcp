import { z } from "zod";
import type { MoodleClient } from "../moodle-client.js";
import type { CourseRefResolver } from "../course-ref-resolver.js";
import type { GlobalRefKind } from "../global-ref.js";

// Shared by every course/assignment/quiz/forum-scoped tool registration so
// there is exactly one place that turns a caller-supplied reference into
// {the right client, the real numeric id} (or a safe error), and exactly one
// place that seals a sub-resource id when rendering a listing whose course
// turned out to live on a non-anchor site. See course-ref-resolver.ts.

/** Accepts a legacy plain positive integer (anchor site) or an opaque sealed multi-site reference. */
export const RefSchema = z.union([z.number().int().positive(), z.string().min(1)]);

// The extra index signature matches the MCP SDK's own CallToolResult shape
// (Zod-inferred, extensible) closely enough for TS to accept these helpers'
// return value directly as a server.tool() callback's result — a plain
// {content, isError} interface without it is rejected as an overload
// mismatch when returned through a function boundary like this.
interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function errorResult(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** For tools that operate on one already-known resource (get_course, get_grades, get_assignment, ...). */
export async function withResolvedRef(
  resolver: CourseRefResolver,
  kind: GlobalRefKind,
  ref: number | string,
  render: (client: MoodleClient, id: number) => Promise<string>,
): Promise<ToolResult> {
  const resolved = await resolver.resolve(kind, ref);
  if (!resolved.ok) return errorResult(resolved.message);
  return { content: [{ type: "text", text: await render(resolved.client, resolved.id) }] };
}

/** Seals a sub-resource id belonging to the course just resolved, for embedding in a listing's rendered output. */
export interface SubRefSealer {
  siteId: string;
  /** The exact validated course reference supplied by the caller, for composed views that echo it. */
  courseRef?: number | string;
  seal: (kind: GlobalRefKind, id: number) => Promise<number | string>;
}

/** For course-scoped listing tools (list_assignments, list_quizzes, list_forums, list_resources) whose items carry their own sub-resource ids. */
export async function withResolvedCourseListing(
  resolver: CourseRefResolver,
  courseRef: number | string,
  render: (client: MoodleClient, courseId: number, sealer: SubRefSealer) => Promise<string>,
): Promise<ToolResult> {
  const resolved = await resolver.resolve("course", courseRef);
  if (!resolved.ok) return errorResult(resolved.message);
  const sealer: SubRefSealer = {
    siteId: resolved.siteId,
    courseRef,
    seal: (kind, id) => resolver.sealIfNeeded(kind, resolved.siteId, id),
  };
  return { content: [{ type: "text", text: await render(resolved.client, resolved.id, sealer) }] };
}
