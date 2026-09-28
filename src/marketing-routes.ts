import { renderLandingPage } from "./marketing/landing-page.js";
import { renderChatGptDocsPage, renderClaudeDocsPage, renderDocsIndexPage } from "./marketing/docs-page.js";

// The public marketing site: "/", "/docs", "/docs/chatgpt", "/docs/claude".
// Static, framework-free HTML (see src/marketing/*.ts, src/page-shell.ts) —
// no Env/D1/auth dependency, unlike the connect/consent flow. Lives
// alongside legacy-routes.ts in the OAuthProvider's defaultHandler
// (src/oauth/provider.ts) but kept in its own module since it isn't legacy.

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** Returns a Response for any marketing route it recognizes, or null if the caller should try other routes. */
export function handleMarketingRoute(pathname: string, method: string): Response | null {
  if (method !== "GET") return null;

  if (pathname === "/") return htmlResponse(renderLandingPage());
  if (pathname === "/docs") return htmlResponse(renderDocsIndexPage());
  if (pathname === "/docs/chatgpt") return htmlResponse(renderChatGptDocsPage());
  if (pathname === "/docs/claude") return htmlResponse(renderClaudeDocsPage());

  return null;
}
