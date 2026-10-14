import { getSiteByBaseUrl } from "../sunlearn-sites.js";

export const MOODLE_RELINK_MESSAGE = "SUNLearn rejected the saved Moodle credential. Reconnect your first-linked SUNLearn environment and paste a fresh connection link. You do not need to delete your Learn MCP data.";

export function moodleReconnectMessage(baseUrl: string | undefined, requestUrl: string, legacy = false): string {
  const site = baseUrl ? getSiteByBaseUrl(baseUrl) : undefined;
  if (!site) return MOODLE_RELINK_MESSAGE;
  const url = new URL(legacy ? "/connect" : "/reconnect", requestUrl);
  if (!legacy) url.searchParams.set("site", site.id);
  return `Your ${site.name} connection needs reconnecting. [Reconnect ${site.name}](${url.href}). Sign in to the same university account, then return to this chat and ask me to retry. Your Learn MCP data and other connections are kept.`;
}

