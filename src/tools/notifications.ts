import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MoodleClient } from "../moodle-client.js";
import { sanitizeAndTruncateHtml, truncateText } from "../text.js";
import { loadNotifications } from "../moodle-loaders.js";
import { TEXT_OUTPUT_POLICY } from "../policy.js";
import { formatMoodleDateTime } from "../format-date.js";
import { mapAccountWideSites, type ConnectedSite, type MultiSiteContext } from "../multi-site-context.js";
import type { MoodleNotificationsResponse } from "../moodle-api.js";

type MoodleNotification = MoodleNotificationsResponse["notifications"][number];

function renderNotification(n: MoodleNotification, siteLabel: string): string[] {
  const status = n.read ? "" : " 🔵";
  const preview = sanitizeAndTruncateHtml(n.text, TEXT_OUTPUT_POLICY.maxNotificationPreviewCharacters);
  const lines = [`- **${truncateText(n.subject, TEXT_OUTPUT_POLICY.maxLabelCharacters)}**${status}${siteLabel}`, `  ${formatMoodleDateTime(n.timecreated)}`];
  if (preview) lines.push(`  ${preview}`);
  lines.push("");
  return lines;
}

/** Single-site rendering — unchanged output shape for the common (one connected SUNLearn site) case. */
export async function getNotifications(client: MoodleClient, limit = 20): Promise<string> {
  if (!client.supports("message_popup_get_popup_notifications")) {
    return "Notifications API is not enabled on your Moodle.";
  }

  const data = await loadNotifications(client, limit);
  if (data.notifications.length === 0) return "No notifications found.";

  const lines: string[] = [`## Notifications (${data.unreadcount} unread)\n`];
  for (const n of data.notifications) lines.push(...renderNotification(n, ""));
  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

/**
 * Account-wide rendering: merges notifications from every connected SUNLearn
 * site, sorted newest-first, and caps the MERGED result to `limit` — fetching
 * `limit` from each site first (an upper bound, since Moodle itself already
 * paginates within a site) and only then truncating after the global sort,
 * so the final count respects `limit` regardless of how many sites are
 * connected.
 */
export async function getNotificationsAccountWide(
  client: MoodleClient,
  multiSite: MultiSiteContext,
  limit = 20,
): Promise<string> {
  if (multiSite.additionalSites.length === 0) return getNotifications(client, limit);

  const { results, unavailable } = await mapAccountWideSites(client, multiSite, async (_site, siteClient) => {
    if (!siteClient.supports("message_popup_get_popup_notifications")) return null;
    return loadNotifications(siteClient, limit);
  });

  let totalUnread = 0;
  const merged: { site: ConnectedSite; isAnchor: boolean; n: MoodleNotification }[] = [];
  for (const { site, isAnchor, value } of results) {
    if (!value) continue;
    totalUnread += value.unreadcount;
    for (const n of value.notifications) merged.push({ site, isAnchor, n });
  }
  merged.sort((a, b) => b.n.timecreated - a.n.timecreated);
  const capped = merged.slice(0, limit);

  const notes = unavailable.length > 0 ? [`_Temporarily unavailable: ${unavailable.map((n) => truncateText(n, TEXT_OUTPUT_POLICY.maxLabelCharacters)).join(", ")}._`, ""] : [];
  if (capped.length === 0) {
    return notes.length ? `No notifications found.\n\n${notes.join("\n")}` : "No notifications found.";
  }

  const lines: string[] = [`## Notifications (${totalUnread} unread)\n`, ...notes];
  for (const { site, n } of capped) lines.push(...renderNotification(n, ` — _${truncateText(site.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)}_`));
  return truncateText(lines.join("\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}

export function registerNotificationTools(server: McpServer, client: MoodleClient, multiSite?: MultiSiteContext): void {
  server.tool(
    "moodle_get_notifications",
    "Get the student's recent Moodle notifications (grade returns, assignment feedback, forum replies, deadline reminders, etc.) across every connected SUNLearn environment. Unread items are marked with 🔵.",
    { limit: z.number().int().min(1).max(100).optional().describe("Number of notifications to fetch (default: 20, max: 100)") },
    async ({ limit }) => ({
      content: [{
        type: "text" as const,
        text: multiSite ? await getNotificationsAccountWide(client, multiSite, limit) : await getNotifications(client, limit),
      }],
    })
  );
}
