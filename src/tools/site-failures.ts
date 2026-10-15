import type { MultiSiteContext, SiteFailure } from "../multi-site-context.js";
import { getSiteById } from "../sunlearn-sites.js";
import { moodleReconnectMessage } from "../linking/recovery-message.js";
import { truncateText } from "../text.js";
import { TEXT_OUTPUT_POLICY } from "../policy.js";

export function renderSiteFailures(unavailable: readonly string[], failures: readonly SiteFailure[], context?: MultiSiteContext): string {
  const auth = failures.filter(failure => failure.code === "authentication");
  const other = unavailable.filter(name => !auth.some(failure => failure.site.name === name));
  const lines = other.length ? [`_Temporarily unavailable: ${other.map(name => truncateText(name, TEXT_OUTPUT_POLICY.maxLabelCharacters)).join(", ")}._`] : [];
  for (const failure of auth) {
    const site = getSiteById(failure.site.id);
    lines.push("_" + (site && context?.recoveryOrigin
      ? moodleReconnectMessage(site.baseUrl, context.recoveryOrigin)
      : `Your ${truncateText(failure.site.name, TEXT_OUTPUT_POLICY.maxLabelCharacters)} connection needs reconnecting. Reconnect this environment through your assistant's settings. Your data is kept.`) + "_");
  }
  if (unavailable.length) lines.push("_Results are incomplete for the affected environments; missing items do not mean there is no coursework._");
  return truncateText(lines.join("\n\n"), TEXT_OUTPUT_POLICY.maxMcpResponseCharacters);
}
