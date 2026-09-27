// Shared design tokens + primitives (shadcn/ui's "zinc" palette, hand-authored
// in plain CSS — no React/Tailwind/build step) for every framework-free HTML
// page this Worker renders to a real person: the SUNLearn connect flow
// (src/linking/sunlearn-connect-page.ts) and the OAuth consent screen
// (src/oauth/consent-page.ts). One token/component set, so both screens in
// the same flow actually look like the same product instead of two
// hand-copied palettes drifting apart.

export const PAGE_SHELL_CSS = `
  :root {
    color-scheme: light;
    --background: #ffffff; --foreground: #09090b;
    --muted: #f4f4f5; --muted-foreground: #71717a;
    --border: #e4e4e7; --card: #ffffff;
    --primary: #7a2748; --primary-hover: #5d1d37; --primary-foreground: #fafafa;
    --secondary: #f4f4f5; --secondary-foreground: #18181b;
    --destructive: #ef4444; --destructive-foreground: #fef2f2; --destructive-border: #fecaca;
    --ring: #7a2748;
    --radius: 0.5rem; --radius-lg: 0.75rem;
    --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
    --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased; margin: 0; padding: 0; line-height: 1.5;
    color: var(--foreground); background: var(--background); font-size: 14px;
    display: flex; flex-direction: column; min-height: 100vh;
  }
  .page { max-width: 560px; margin: 0 auto; padding: 0 24px 20px; flex: 1 0 auto; width: 100%; }
  header.site-header { padding: 40px 24px 0; max-width: 560px; margin: 0 auto; }
  .brand { display: flex; align-items: center; margin-bottom: 14px; }
  .brand-name { font-weight: 600; font-size: 1.25rem; letter-spacing: -0.02em; color: var(--foreground); }
  .disclaimer { font-size: 0.8rem; color: var(--muted-foreground); margin: 0 0 32px; }
  h1 { font-size: 1.5rem; font-weight: 600; letter-spacing: -0.02em; color: var(--foreground); margin: 0 0 6px; }
  h2 { font-size: 1rem; font-weight: 600; letter-spacing: -0.01em; color: var(--foreground); margin: 0 0 10px; }
  p.intro { color: var(--muted-foreground); margin: 0 0 24px; font-size: 0.875rem; }

  /* Card */
  .card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }

  /* Button (shadcn conventions: default = solid primary, outline/ghost = secondary actions) */
  .btn, button {
    display: inline-flex; align-items: center; justify-content: center; white-space: nowrap;
    font-family: inherit; font-size: 0.8125rem; font-weight: 500; cursor: pointer;
    border-radius: var(--radius); border: 1px solid transparent; transition: background-color 0.12s ease, color 0.12s ease;
    text-decoration: none;
  }
  .btn-sm, button { height: 32px; padding: 0 14px; }
  .btn-default, button { background: var(--primary); color: var(--primary-foreground); }
  .btn-default:hover, button:hover { background: var(--primary-hover); }
  .btn-ghost { background: transparent; color: var(--muted-foreground); border-color: transparent; }
  .btn-ghost:hover { background: var(--muted); color: var(--foreground); }
  .btn-outline { background: transparent; color: var(--primary); border-color: var(--primary); }
  .btn-outline:hover { background: var(--muted); }

  /* Badge */
  .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 10px; font-size: 0.75rem; font-weight: 600; line-height: 1.6; }
  .badge-secondary { background: var(--secondary); color: var(--secondary-foreground); }

  /* Alert (destructive variant) */
  .error { color: #b91c1c; background: #fef2f2; border: 1px solid var(--destructive-border); border-radius: var(--radius); padding: 10px 14px; margin-bottom: 16px; font-size: 0.85rem; }
  .muted { font-size: 0.8rem; color: var(--muted-foreground); }

  footer.site-footer { max-width: 560px; margin: 16px auto 0; padding: 0 24px 24px; text-align: center; }
  footer.site-footer a { color: var(--muted-foreground); text-decoration: none; font-size: 0.8rem; }
  footer.site-footer a:hover { color: var(--foreground); text-decoration: underline; }
  footer.site-footer .sep { color: var(--border); margin: 0 10px; }
`;

export function renderBrandHeader(): string {
  return `<header class="site-header">
    <div class="brand"><span class="brand-name">SUNLearn MCP</span></div>
    <p class="disclaimer">This is an independent, unofficial student project. It is not operated, reviewed, or endorsed by Stellenbosch University.</p>
  </header>`;
}

export function renderLegalFooter(): string {
  return `<footer class="site-footer">
    <a href="/terms">Terms of Use</a><span class="sep">&middot;</span><a href="/privacy">Privacy Notice</a>
  </footer>`;
}
