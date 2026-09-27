import { MoodleClient } from "./moodle-client.js";
import type { Config } from "./config.js";
import type { SunlearnSite } from "./sunlearn-sites.js";
import type { GlobalRefKind } from "./global-ref.js";
import { MULTI_SITE_POLICY, mapWithConcurrency } from "./policy.js";

export interface ConnectedSite {
  readonly id: string;
  readonly name: string;
}

/**
 * Every OTHER SUNLearn site (beyond the anchor client a tool registration
 * already receives) the student has linked, plus a way to seal a
 * sub-resource id belonging to one of them. Shared by every ACCOUNT-WIDE
 * tool (moodle_list_courses, upcoming_and_overdue, moodle_get_notifications)
 * via mapAccountWideSites() below, so none of them hand-rolls its own
 * secondary-site loop — see AGENTS.md's architecture-review note on this.
 *
 * Course/assignment/quiz/forum-SCOPED tools never need this: they stay on
 * CourseRefResolver, which builds at most one non-anchor client per call,
 * lazily, from the single ref the caller passed in.
 */
export interface MultiSiteContext {
  readonly anchorSite: ConnectedSite;
  readonly additionalSites: readonly { site: SunlearnSite; config: Config }[];
  /** A passthrough for the anchor site — same contract as CourseRefResolver.sealIfNeeded, which this is always backed by. */
  seal(kind: GlobalRefKind, siteId: string, id: number): Promise<number | string>;
}

export interface SiteMapResult<T> {
  readonly results: { site: ConnectedSite; isAnchor: boolean; value: T }[];
  /** Display names of sites that couldn't be reached — a failure here never fails the whole call. */
  readonly unavailable: string[];
}

/**
 * Runs `fn` once per connected site — the anchor (reusing the client the
 * caller already built) plus every additional linked site, each constructed
 * lazily and ONLY here, only when an aggregate operation actually runs — with
 * bounded concurrency. A site whose client can't be built, or whose `fn`
 * throws, is recorded by name in `unavailable` instead of failing the whole
 * aggregate; every other site's result still comes back.
 */
export async function mapAccountWideSites<T>(
  anchorClient: MoodleClient,
  multiSite: MultiSiteContext | undefined,
  fn: (site: ConnectedSite, client: MoodleClient, isAnchor: boolean) => Promise<T>,
): Promise<SiteMapResult<T>> {
  const anchorSite: ConnectedSite = multiSite?.anchorSite ?? { id: "anchor", name: "Moodle" };
  const targets: { site: ConnectedSite; isAnchor: boolean; getClient: () => Promise<MoodleClient> }[] = [
    { site: anchorSite, isAnchor: true, getClient: () => Promise.resolve(anchorClient) },
    ...(multiSite?.additionalSites ?? []).map(({ site, config }) => ({
      site: { id: site.id, name: site.name },
      isAnchor: false,
      getClient: () => MoodleClient.create(config),
    })),
  ];

  type SiteResult = { site: ConnectedSite; isAnchor: boolean; value: T };
  const unavailable: string[] = [];
  const settled = await mapWithConcurrency<typeof targets[number], SiteResult | null>(targets, MULTI_SITE_POLICY.fanOutConcurrency, async (target) => {
    try {
      const client = await target.getClient();
      return { site: target.site, isAnchor: target.isAnchor, value: await fn(target.site, client, target.isAnchor) };
    } catch {
      unavailable.push(target.site.name);
      return null;
    }
  });

  return { results: settled.filter((r): r is SiteResult => r !== null), unavailable };
}
