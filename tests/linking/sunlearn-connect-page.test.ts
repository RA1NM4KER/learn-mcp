import { describe, expect, it } from "vitest";
import { renderSunlearnConnectPage, type SitePanel } from "../../src/linking/sunlearn-connect-page.js";

const SITES = [
  { id: "stemlearn", name: "STEMLearn", connected: true },
  { id: "sunlearn", name: "SUNLearn", connected: false },
];

const PANELS: SitePanel[] = [
  { siteId: "sunlearn", siteName: "SUNLearn", launchUrl: "https://learn.sun.ac.za/admin/tool/mobile/launch.php", formAction: "/authorize/link" },
];

describe("renderSunlearnConnectPage — disconnect", () => {
  it("explains why the Moodle link must not be opened before showing that warning", () => {
    const html = renderSunlearnConnectPage({ sites: SITES, sessionId: "s1", panels: PANELS });
    expect(html.indexOf("Moodle's confirmation page shows")).toBeLessThan(html.indexOf("Don't click the link on that page"));
  });

  it("shows no disconnect action when disconnectFormAction is not provided", () => {
    const html = renderSunlearnConnectPage({ sites: SITES, sessionId: "s1", panels: PANELS });
    expect(html).not.toContain(">Disconnect<");
    expect(html).toContain('class="badge badge-success">Connected<');
  });

  it("shows a Disconnect action only on connected sites once disconnectFormAction is provided", () => {
    const html = renderSunlearnConnectPage({ sites: SITES, sessionId: "s1", panels: PANELS, disconnectFormAction: "/authorize/disconnect" });
    expect(html).toContain(">Disconnect<");
    expect(html.match(/>Disconnect</g)).toHaveLength(1); // only the one connected site (STEMLearn)

    const disconnectFormIndex = html.indexOf('action="/authorize/disconnect"');
    expect(disconnectFormIndex).toBeGreaterThan(-1);
    // The disconnect form for the connected tile carries that site's own id, not the other one.
    const nearby = html.slice(disconnectFormIndex, disconnectFormIndex + 300);
    expect(nearby).toContain('value="stemlearn"');
    expect(nearby).not.toContain('value="sunlearn"');
  });

  it("never shows a disconnect action on a not-yet-connected site", () => {
    const html = renderSunlearnConnectPage({ sites: SITES, sessionId: "s1", panels: PANELS, disconnectFormAction: "/authorize/disconnect" });
    const sunlearnTileStart = html.indexOf('site-name">SUNLearn');
    const sunlearnTileHtml = html.slice(sunlearnTileStart, sunlearnTileStart + 300);
    expect(sunlearnTileHtml).not.toContain("Disconnect");
  });

  it("never auto-opens any dialog, and never emits a showModal script, on a bare render (no autoOpenSiteId)", () => {
    const html = renderSunlearnConnectPage({ sites: SITES, sessionId: "s1", panels: PANELS });
    expect(html).not.toContain("showModal()</script>");
    expect(html).not.toContain(".showModal();</script>");

    const dialogStart = html.indexOf('id="panel-sunlearn"');
    expect(html.slice(dialogStart, dialogStart + 40)).not.toContain(" open");
  });

  it("auto-opens only the failed site's dialog, via a real showModal() script, when autoOpenSiteId is set", () => {
    const html = renderSunlearnConnectPage({
      sites: SITES,
      sessionId: "s1",
      panels: PANELS,
      autoOpenSiteId: "sunlearn",
      errorMessage: "This connection link isn't valid.",
    });

    const dialogStart = html.indexOf('id="panel-sunlearn"');
    expect(html.slice(dialogStart, dialogStart + 40)).toContain(" open");
    expect(html).toContain('document.getElementById("panel-sunlearn").showModal();');
  });
});
