// Single source of truth for every supported SUNLearn Moodle instance.
//
// This registry is deliberately the ONLY place that knows these hostnames.
// It doubles as:
//   - the credential host allowlist (moodle-host-allowlist.ts) — nothing is
//     ever treated as a trusted Moodle destination unless it's listed here
//   - the mobile-launch URL builder used by both the legacy and OAuth
//     linking flows
//   - the source of display order/names for any connect/status UI
//
// Do not hardcode a *.sun.ac.za hostname anywhere else in this codebase.

export type SunlearnSiteId = "sunlearn" | "stemlearn" | "emslearn" | "socscilearn" | "fmhslearn";

export interface SunlearnSite {
  readonly id: SunlearnSiteId;
  readonly name: string;
  /** Normalized origin, e.g. "https://stemlearn.sun.ac.za" — no trailing slash, no path. */
  readonly baseUrl: string;
  readonly enabled: boolean;
}

// Order here is display order everywhere (registry-driven, per Phase 4).
export const SUNLEARN_SITES: readonly SunlearnSite[] = [
  { id: "sunlearn", name: "SUNLearn", baseUrl: "https://learn.sun.ac.za", enabled: true },
  { id: "stemlearn", name: "STEMLearn", baseUrl: "https://stemlearn.sun.ac.za", enabled: true },
  { id: "emslearn", name: "EMSLearn", baseUrl: "https://emslearn.sun.ac.za", enabled: true },
  { id: "socscilearn", name: "SocSciLearn", baseUrl: "https://socscilearn.sun.ac.za", enabled: true },
  { id: "fmhslearn", name: "FMHSLearn", baseUrl: "https://fmhslearn.sun.ac.za", enabled: true },
];

export function listEnabledSites(): SunlearnSite[] {
  return SUNLEARN_SITES.filter((site) => site.enabled);
}

export function getSiteById(id: string): SunlearnSite | undefined {
  return SUNLEARN_SITES.find((site) => site.id === id);
}

/** hostname must be exactly the site's own hostname — no subdomain/prefix matching. */
export function getSiteByHost(hostname: string): SunlearnSite | undefined {
  return SUNLEARN_SITES.find((site) => new URL(site.baseUrl).hostname === hostname);
}

/** hostname must be exactly the site's own hostname — no subdomain/prefix matching. */
export function getSiteByBaseUrl(baseUrl: string): SunlearnSite | undefined {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    return undefined;
  }
  return getSiteByHost(hostname);
}

export function isAllowedMoodleHost(hostname: string): boolean {
  const site = getSiteByHost(hostname);
  return site !== undefined && site.enabled;
}

export function buildMobileLaunchUrl(site: SunlearnSite, passport: string): string {
  const url = new URL("/admin/tool/mobile/launch.php", site.baseUrl);
  url.searchParams.set("service", "moodle_mobile_app");
  url.searchParams.set("passport", passport);
  url.searchParams.set("confirmed", "1");
  return url.toString();
}
