import { describe, expect, it } from "vitest";
import { handleMarketingRoute } from "../src/marketing-routes.js";
import { PRIVACY_HTML, TERMS_HTML } from "../src/legal-pages.js";

async function textOf(res: Response | null): Promise<string> {
  expect(res).not.toBeNull();
  return res!.text();
}

describe("handleMarketingRoute", () => {
  it("returns null for a non-GET request, leaving it to other routes", () => {
    expect(handleMarketingRoute("/", "POST")).toBeNull();
  });

  it("returns null for an unrecognized path", () => {
    expect(handleMarketingRoute("/docs/nonexistent", "GET")).toBeNull();
  });

  it("serves the landing page at /", async () => {
    const res = handleMarketingRoute("/", "GET");
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toContain("text/html");
    const text = await textOf(res);
    expect(text).toContain("Your SUNLearn.");
    expect(text).toContain("Connect SUNLearn");
    expect(text).toContain('href="/docs/chatgpt"');
    expect(text).toContain('href="/docs/claude"');
    // Internal MCP tool names must never appear on the student-facing page.
    expect(text).not.toContain("upcoming_and_overdue");
    expect(text).not.toContain("course_overview");
  });

  it("serves the docs index at /docs, linking to both platform guides", async () => {
    const text = await textOf(handleMarketingRoute("/docs", "GET"));
    expect(text).toContain('href="/docs/chatgpt"');
    expect(text).toContain('href="/docs/claude"');
    expect(text).not.toContain("upcoming_and_overdue");
  });

  it("never links to /connect anywhere on the public marketing site: it serves the developer-only bearer-key testing page (src/linking/connect-page.ts), not the real student flow", async () => {
    for (const path of ["/", "/docs", "/docs/chatgpt", "/docs/claude"]) {
      const text = await textOf(handleMarketingRoute(path, "GET"));
      expect(text).not.toContain('href="/connect"');
    }
  });

  it("serves the ChatGPT setup guide with the real MCP connector address", async () => {
    const text = await textOf(handleMarketingRoute("/docs/chatgpt", "GET"));
    expect(text).toContain("https://sunlearn-mcp.kefas.co.za/mcp");
    expect(text).toContain("Stellenbosch");
    // No CLI/developer instructions on a page written for non-technical students.
    expect(text).not.toContain("wrangler");
    expect(text).not.toContain("npm ");
  });

  it("serves the Claude setup guide with the real MCP connector address", async () => {
    const text = await textOf(handleMarketingRoute("/docs/claude", "GET"));
    expect(text).toContain("https://sunlearn-mcp.kefas.co.za/mcp");
    expect(text).not.toContain("wrangler");
  });

  it("every rendered page includes the independent-project disclaimer", async () => {
    for (const path of ["/", "/docs", "/docs/chatgpt", "/docs/claude"]) {
      const text = await textOf(handleMarketingRoute(path, "GET"));
      expect(text).toContain("independent student project");
    }
  });

  it("never uses an em dash anywhere in rendered copy (landing, docs, or legal pages)", async () => {
    for (const path of ["/", "/docs", "/docs/chatgpt", "/docs/claude"]) {
      const text = await textOf(handleMarketingRoute(path, "GET"));
      expect(text).not.toContain("—");
    }
    expect(TERMS_HTML).not.toContain("—");
    expect(PRIVACY_HTML).not.toContain("—");
  });
});
