import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "./moodle-client.js";
import type { CourseRefResolver } from "./course-ref-resolver.js";
import type { MultiSiteContext } from "./multi-site-context.js";
import { registerCourseTools } from "./tools/courses.js";
import { registerFileTools } from "./tools/files.js";
import { registerDownloadTool } from "./tools/download.js";
import { registerAssignmentTools } from "./tools/assignments.js";
import { registerGradeTools } from "./tools/grades.js";
import { registerCalendarTools } from "./tools/calendar.js";
import { registerQuizTools } from "./tools/quizzes.js";
import { registerForumTools } from "./tools/forums.js";
import { registerNotificationTools } from "./tools/notifications.js";
import { registerSiteInfoTool } from "./tools/siteinfo.js";
import { registerComposedTools } from "./tools/composed.js";

export function registerAllTools(
  server: McpServer,
  client: MoodleClient,
  courseRefResolver: CourseRefResolver,
  multiSite?: MultiSiteContext,
): void {
  registerCourseTools(server, client, courseRefResolver, multiSite);
  registerFileTools(server, courseRefResolver);
  registerDownloadTool(server, client);
  registerAssignmentTools(server, courseRefResolver);
  registerGradeTools(server, courseRefResolver);
  registerCalendarTools(server, client, courseRefResolver);
  registerQuizTools(server, courseRefResolver);
  registerForumTools(server, courseRefResolver);
  registerNotificationTools(server, client, multiSite);
  registerSiteInfoTool(server, client);
  registerComposedTools(server, client, courseRefResolver, multiSite);
}
