import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import type { CourseRefResolver } from "../course-ref-resolver.js";
import { RefSchema, withResolvedCourseListing, withResolvedRef, type SubRefSealer } from "./tool-ref-helpers.js";
import { QUIZ_ATTEMPT_POLICY, QUIZ_LIST_POLICY, TEXT_OUTPUT_POLICY } from "../policy.js";
import { loadCourseContents, loadQuizAttempts, loadQuizzes } from "../moodle-loaders.js";
import { truncateText } from "../text.js";

function formatDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(seconds: number): string {
  if (!seconds) return "No limit";
  const m = Math.floor(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export async function listQuizzes(client: MoodleClient, courseId: number, sealer?: SubRefSealer): Promise<string> {
  if (!client.supports("mod_quiz_get_quizzes_by_courses")) {
    return "Quiz API is not enabled on your Moodle. Ask your admin to enable mod_quiz web services.";
  }

  const [sections, quizData] = await Promise.all([
    loadCourseContents(client, courseId),
    loadQuizzes(client, courseId),
  ]);

  const byModule = new Map(quizData.quizzes.map((q) => [q.coursemodule, q]));
  const lines: string[] = [`## Quizzes — Course ${courseId}\n`];
  let hasAny = false;
  let renderedQuizzes = 0;
  let omittedQuizzes = 0;

  for (const section of sections) {
    const quizMods = section.modules.filter((m) => m.modname === "quiz");
    if (quizMods.length === 0) continue;

    const sectionLines: string[] = [];
    for (const mod of quizMods) {
      if (renderedQuizzes >= QUIZ_LIST_POLICY.maxRendered) {
        omittedQuizzes++;
        continue;
      }
      renderedQuizzes++;
      const q = byModule.get(mod.id);
      if (!q) {
        sectionLines.push(`- **${truncateText(mod.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}** *(details unavailable)*`);
        continue;
      }
      const idLabel = sealer ? await sealer.seal("quiz", q.id) : q.id;
      sectionLines.push(`- **${truncateText(q.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}**`);
      sectionLines.push(`  ID: \`${idLabel}\` | Time limit: ${formatDuration(q.timelimit)} | Attempts: ${q.attempts === 0 ? "Unlimited" : q.attempts}`);
      if (q.timeopen) sectionLines.push(`  Opens: ${formatDate(q.timeopen)}`);
      if (q.timeclose) sectionLines.push(`  Closes: ${formatDate(q.timeclose)}`);
    }
    if (sectionLines.length > 0) {
      lines.push(`### ${truncateText(section.name || "General", TEXT_OUTPUT_POLICY.maxLabelCharacters)}`, ...sectionLines, "");
      hasAny = true;
    }
  }

  if (!hasAny) return "No quizzes found in this course.";
  if (omittedQuizzes) lines.push(`_Showing the first ${QUIZ_LIST_POLICY.maxRendered} quizzes; ${omittedQuizzes} additional quizzes were omitted._`);
  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export async function getQuizAttempts(client: MoodleClient, quizId: number): Promise<string> {
  if (!client.supports("mod_quiz_get_user_attempts")) {
    return "Quiz attempts API is not enabled on your Moodle.";
  }

  const data = await loadQuizAttempts(client, quizId);

  const attempts = data.attempts ?? [];
  if (attempts.length === 0) return `No attempts found for quiz ${quizId}.`;

  const lines: string[] = [`## Quiz ${quizId} — Your Attempts\n`];
  lines.push("| # | State | Started | Finished | Grade |");
  lines.push("|---|-------|---------|----------|-------|");

  for (const a of attempts.slice(0, QUIZ_ATTEMPT_POLICY.maxRendered)) {
    const finished = a.timefinish ? formatDate(a.timefinish) : "In progress";
    const grade = a.sumgrades != null ? String(a.sumgrades) : "—";
    lines.push(`| ${a.attempt} | ${truncateText(a.state, TEXT_OUTPUT_POLICY.maxLabelCharacters)} | ${formatDate(a.timestart)} | ${finished} | ${grade} |`);
  }

  if (attempts.length > QUIZ_ATTEMPT_POLICY.maxRendered) {
    lines.push(`\n_Showing the first ${QUIZ_ATTEMPT_POLICY.maxRendered} attempts._`);
  }

  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export function registerQuizTools(server: McpServer, courseRefResolver: CourseRefResolver): void {
  server.tool(
    "moodle_list_quizzes",
    "List the quizzes in one of the student's courses, with time limits, allowed attempts, and open/close dates.",
    { courseId: RefSchema.describe("Course ID from moodle_list_courses") },
    async ({ courseId }) => withResolvedCourseListing(courseRefResolver, courseId, listQuizzes),
  );

  server.tool(
    "moodle_get_quiz_attempts",
    "Get the student's own past attempt history for one quiz — grades, states, and timing.",
    { quizId: RefSchema.describe("Quiz ID from moodle_list_quizzes") },
    async ({ quizId }) => withResolvedRef(courseRefResolver, "quiz", quizId, getQuizAttempts),
  );
}
