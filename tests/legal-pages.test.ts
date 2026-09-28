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
});
