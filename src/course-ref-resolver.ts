import { MoodleClient } from "./moodle-client.js";
import type { Config } from "./config.js";
import { GlobalRefStore, type GlobalRefKind } from "./global-ref.js";
import { getSiteById } from "./sunlearn-sites.js";

// The single place every course-scoped tool (moodle_get_course,
// moodle_get_grades, moodle_list_assignments, moodle_get_assignment, ...)
// goes to turn a caller-supplied course/assignment/quiz/forum reference into
// {the right MoodleClient, the real Moodle numeric id} — whether that
// reference is a legacy plain number (always the anchor site, for backward
// compatibility) or an opaque sealed ref naming any other connected SUNLearn
// site (src/global-ref.ts). No tool constructs or inspects a ref directly.

export type ResolvedRef =
  | { ok: true; client: MoodleClient; id: number; siteId: string; isAnchor: boolean }
  | { ok: false; message: string };

const INVALID_REF_MESSAGE =
  "This reference is invalid, expired, or wasn't issued to this account. Re-run the corresponding list tool (e.g. moodle_list_courses) to get a fresh one.";
const SITE_NOT_CONNECTED_MESSAGE = "That SUNLearn environment isn't connected to your account anymore.";

export class CourseRefResolver {
  private readonly siteClients = new Map<string, Promise<MoodleClient | null>>();

  constructor(
    private readonly anchorSiteId: string,
    private readonly anchorClient: MoodleClient,
    private readonly canonicalUserId: string,
    private readonly refStore: GlobalRefStore | undefined,
    private readonly resolveSiteConfig: (siteId: string) => Promise<Config | null>,
  ) {}

  private clientForSite(siteId: string): Promise<MoodleClient | null> {
    if (siteId === this.anchorSiteId) return Promise.resolve(this.anchorClient);
    let pending = this.siteClients.get(siteId);
    if (!pending) {
      pending = (async () => {
        if (!getSiteById(siteId)) return null;
        const config = await this.resolveSiteConfig(siteId);
        if (!config) return null;
        try {
          return await MoodleClient.create(config);
        } catch {
          return null;
        }
      })();
      this.siteClients.set(siteId, pending);
    }
    return pending;
  }

  /** Accepts a legacy plain numeric id (always the anchor site) OR a sealed multi-site ref of `kind`. */
  async resolve(kind: GlobalRefKind, ref: number | string): Promise<ResolvedRef> {
    if (typeof ref === "number") {
      return { ok: true, client: this.anchorClient, id: ref, siteId: this.anchorSiteId, isAnchor: true };
    }
    if (!this.refStore) return { ok: false, message: INVALID_REF_MESSAGE };
    const decoded = await this.refStore.open(ref, this.canonicalUserId, kind);
    if (!decoded) return { ok: false, message: INVALID_REF_MESSAGE };
    const client = await this.clientForSite(decoded.siteId);
    if (!client) return { ok: false, message: SITE_NOT_CONNECTED_MESSAGE };
    return { ok: true, client, id: decoded.id, siteId: decoded.siteId, isAnchor: decoded.siteId === this.anchorSiteId };
  }

  /** Seals an id known to belong to `siteId` for use in rendered tool output — a plain passthrough for the anchor site. */
  async sealIfNeeded(kind: GlobalRefKind, siteId: string, id: number): Promise<number | string> {
    if (siteId === this.anchorSiteId || !this.refStore) return id;
    return this.refStore.seal({ userId: this.canonicalUserId, siteId, kind, id });
  }
}

/** A resolver with no other connected sites — every ref is a legacy plain number against the single client. Used by stdio and any single-site deployment. */
export function createAnchorOnlyResolver(client: MoodleClient): CourseRefResolver {
  return new CourseRefResolver("anchor", client, "anchor", undefined, async () => null);
}
