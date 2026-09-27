import { describe, expect, it } from "vitest";
import {
  SUNLEARN_SITES,
  buildMobileLaunchUrl,
  getSiteByBaseUrl,
  getSiteByHost,
  getSiteById,
  isAllowedMoodleHost,
  listEnabledSites,
} from "../src/sunlearn-sites.js";

describe("sunlearn-sites registry", () => {
  it("lists exactly the five SUNLearn environments", () => {
    const ids = listEnabledSites().map((s) => s.id).sort();
    expect(ids).toEqual(["emslearn", "fmhslearn", "socscilearn", "stemlearn", "sunlearn"]);
  });

  it("every site is a normalized HTTPS *.sun.ac.za origin with no path", () => {
    for (const site of SUNLEARN_SITES) {
      const url = new URL(site.baseUrl);
      expect(url.protocol).toBe("https:");
      expect(url.hostname.endsWith(".sun.ac.za")).toBe(true);
      expect(site.baseUrl).toBe(url.origin);
    }
  });

  it("getSiteById finds a known site and returns undefined for an unknown one", () => {
    expect(getSiteById("stemlearn")?.name).toBe("STEMLearn");
    expect(getSiteById("not-a-real-site")).toBeUndefined();
  });

  it("getSiteByHost / getSiteByBaseUrl round-trip each registry entry", () => {
    for (const site of SUNLEARN_SITES) {
      expect(getSiteByHost(new URL(site.baseUrl).hostname)?.id).toBe(site.id);
      expect(getSiteByBaseUrl(site.baseUrl)?.id).toBe(site.id);
    }
  });

  it("does not match a lookalike subdomain (no prefix/substring matching)", () => {
    expect(getSiteByHost("evil-stemlearn.sun.ac.za")).toBeUndefined();
    expect(getSiteByHost("stemlearn.sun.ac.za.evil.example")).toBeUndefined();
    expect(isAllowedMoodleHost("evil-stemlearn.sun.ac.za")).toBe(false);
  });

  it("isAllowedMoodleHost rejects an unknown host", () => {
    expect(isAllowedMoodleHost("moodle.example.com")).toBe(false);
    expect(isAllowedMoodleHost("stemlearn.sun.ac.za")).toBe(true);
  });

  it("getSiteByBaseUrl returns undefined for a malformed URL rather than throwing", () => {
    expect(getSiteByBaseUrl("not a url")).toBeUndefined();
  });

  it("buildMobileLaunchUrl produces the exact launch endpoint with service/passport/confirmed params", () => {
    const site = getSiteById("emslearn")!;
    const url = new URL(buildMobileLaunchUrl(site, "deadbeef"));
    expect(url.origin + url.pathname).toBe("https://emslearn.sun.ac.za/admin/tool/mobile/launch.php");
    expect(url.searchParams.get("service")).toBe("moodle_mobile_app");
    expect(url.searchParams.get("passport")).toBe("deadbeef");
    expect(url.searchParams.get("confirmed")).toBe("1");
  });
});
