import { describe, expect, it } from "vitest";
import { PRIVACY_HTML, TERMS_HTML } from "../src/legal-pages.js";

describe("legal pages", () => {
  it("share the marketing site's nav and footer, not the old connect-only shell", () => {
    for (const html of [TERMS_HTML, PRIVACY_HTML]) {
      expect(html).toContain('class="mkt-nav"');
      expect(html).toContain('class="mkt-footer"');
      expect(html).not.toContain("Back to Connect");
    }
  });

  it("Privacy is marked current in the nav; Terms (not in the nav) is not", () => {
    expect(PRIVACY_HTML).toContain('href="/privacy" aria-current="page"');
    // Terms isn't a primary nav item at all, so none of the four nav links should be marked current.
    for (const href of ['href="/"', 'href="/docs"', 'href="/privacy"']) {
      expect(TERMS_HTML).toContain(`${href}>`); // present, but plain — not immediately followed by aria-current
    }
    expect(TERMS_HTML).not.toContain('href="/privacy" aria-current="page"');
  });

  it("preserves the actual legal content", () => {
    expect(TERMS_HTML).toContain("not an official Stellenbosch University service");
    expect(TERMS_HTML).toContain("Revoking access");
    expect(PRIVACY_HTML).toContain("AES-256-GCM");
    expect(PRIVACY_HTML).toContain("Deleting your data");
  });

  it("every legal page includes the independent-project disclaimer", () => {
    expect(TERMS_HTML).toContain("independent, unofficial project");
    expect(PRIVACY_HTML).toContain("independent, unofficial project");
  });

  it("does not make an unqualified 'never shared with third parties' claim, and discloses AI-provider sharing instead", () => {
    expect(PRIVACY_HTML).not.toContain("Nothing is sold or shared with third parties");
    expect(PRIVACY_HTML).toContain("ChatGPT or Claude");
    expect(PRIVACY_HTML).toContain("that provider's own terms");
  });

  it("does not claim access can be revoked from the Microsoft/Stellenbosch account settings", () => {
    expect(TERMS_HTML).not.toContain("Microsoft/Stellenbosch\n  account's own security settings");
    expect(TERMS_HTML).not.toContain("revoke this application's access entirely from your Microsoft");
  });

  it("distinguishes disconnecting one site from deleting all data", () => {
    expect(PRIVACY_HTML).toContain("Disconnect a single site");
    expect(PRIVACY_HTML).toContain("Delete all my");
  });

  it("describes what is actually stored in D1: Moodle user id, site origin, canonical identity, encrypted token", () => {
    expect(PRIVACY_HTML).toContain("Moodle user id");
    expect(PRIVACY_HTML).toContain("address (origin)");
    expect(PRIVACY_HTML).toContain("canonical account identifier");
  });
});
