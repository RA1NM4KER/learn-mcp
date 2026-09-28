// Shared design tokens + primitives (shadcn/ui's "zinc" palette, hand-authored
// in plain CSS — no React/Tailwind/build step) for every framework-free HTML
// page this Worker renders to a real person: the SUNLearn connect flow
// (src/linking/sunlearn-connect-page.ts), the OAuth consent screen
// (src/oauth/consent-page.ts), and the public marketing site
// (src/marketing/*.ts). One token/component set, so every screen actually
// looks like the same product instead of hand-copied palettes drifting apart.

import { PRODUCT_NAME } from "./brand.js";

export const PAGE_SHELL_CSS = `
  :root {
    color-scheme: light;
    --background: #ffffff; --foreground: #09090b;
    --muted: #f4f4f5; --muted-foreground: #71717a;
    --border: #e4e4e7; --card: #ffffff;
    /* A single, deliberately restrained accent: Learn MCP's own identity,
       not Stellenbosch's maroon/gold. Used everywhere a brand color is
       needed; there is no second accent color layered on top of it. */
    --primary: #1e3a5f; --primary-hover: #16293f; --primary-foreground: #fafafa;
    --secondary: #f4f4f5; --secondary-foreground: #18181b;
    --success: #dcfce7; --success-foreground: #166534;
    --destructive: #ef4444; --destructive-foreground: #fef2f2; --destructive-border: #fecaca;
    --ring: #1e3a5f;
    --radius: 0.5rem; --radius-lg: 0.75rem;
    --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
    --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06);
    /* Marketing-only addition (unused by the transactional connect/consent/legal
       pages above, so their existing layout is unaffected): a subtle warm
       off-white for alternating sections. */
    --warm-bg: #faf8f5;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  a:focus-visible, button:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }
  }
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
  .badge-success { background: var(--success); color: var(--success-foreground); }

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
    <div class="brand"><span class="brand-name">${PRODUCT_NAME}</span></div>
    <p class="disclaimer">This is an independent, unofficial student project. It is not operated, reviewed, or endorsed by Stellenbosch University.</p>
  </header>`;
}

export function renderLegalFooter(): string {
  return `<footer class="site-footer">
    <a href="/terms">Terms of Use</a><span class="sep">&middot;</span><a href="/privacy">Privacy Notice</a>
  </footer>`;
}

// ---------------------------------------------------------------------------
// Marketing site (src/marketing/*.ts): the public landing page and docs.
// Deliberately a separate CSS block from PAGE_SHELL_CSS above rather than
// appended there — the transactional pages (connect/consent/legal) never
// load this, so their payload stays exactly as small as it already was.
// Both blocks share the same :root tokens (PAGE_SHELL_CSS must always be
// included first wherever MARKETING_CSS is used).
// ---------------------------------------------------------------------------

export const MARKETING_CSS = `
  body.mkt { font-size: 15px; }
  .mkt-container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }

  /* Nav */
  .mkt-nav { border-bottom: 1px solid var(--border); position: sticky; top: 0; background: rgb(255 255 255 / 0.86); backdrop-filter: blur(8px); z-index: 20; }
  .mkt-nav-inner { max-width: 1080px; margin: 0 auto; padding: 0 24px; height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .mkt-brand { display: flex; align-items: baseline; text-decoration: none; color: var(--foreground); font-weight: 600; font-size: 1.0625rem; letter-spacing: -0.02em; }
  .mkt-nav-links { display: flex; align-items: center; gap: 28px; flex: 1; justify-content: center; }
  .mkt-nav-links a { color: var(--muted-foreground); text-decoration: none; font-size: 0.875rem; font-weight: 500; padding: 4px 2px; border-bottom: 2px solid transparent; }
  .mkt-nav-links a:hover { color: var(--foreground); }
  .mkt-nav-links a[aria-current="page"] { color: var(--foreground); border-bottom-color: var(--primary); }
  .mkt-nav-toggle { display: none; }
  .mkt-preview-badge {
    flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; font-weight: 600;
    color: var(--foreground); background: var(--secondary); border-radius: 999px; padding: 5px 12px 5px 10px; text-decoration: none;
  }
  .mkt-preview-badge::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: var(--primary); }
  .mkt-preview-badge:hover { background: var(--border); }

  /* Hero */
  /* No overflow:hidden here: body is a column flexbox with a definite height (see
     html,body{height:100%} above), so any flex-item section with overflow != visible
     gets an automatic minimum size of 0 instead of its content height, and silently
     collapses under flex-shrink while its overflow:visible siblings don't. The
     pattern ::before below is already inset:0 (exactly the parent's box), so nothing
     needs clipping anyway. */
  .mkt-hero { position: relative; background: var(--warm-bg); border-bottom: 1px solid var(--border); }
  .mkt-hero::before {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M0 40 L40 0' stroke='%231e3a5f' stroke-opacity='0.05' stroke-width='1'/%3E%3C/svg%3E");
    background-repeat: repeat; mask-image: linear-gradient(to bottom, black, transparent 85%);
  }
  .mkt-hero-inner { position: relative; max-width: 1080px; margin: 0 auto; padding: 88px 24px 96px; display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
  .mkt-eyebrow { font-size: 0.8125rem; font-weight: 600; color: var(--primary); letter-spacing: 0.01em; margin: 0 0 16px; }
  .mkt-hero h1 { font-size: 2.75rem; line-height: 1.1; letter-spacing: -0.03em; font-weight: 600; color: var(--foreground); margin: 0 0 20px; }
  .mkt-hero-sub { font-size: 1.0625rem; line-height: 1.6; color: var(--muted-foreground); margin: 0 0 32px; max-width: 46ch; }
  .mkt-hero-ctas { display: flex; gap: 12px; flex-wrap: wrap; }
  .mkt-hero-ctas .btn { height: 42px; padding: 0 20px; font-size: 0.875rem; }

  /* Hero demo conversation */
  .mkt-demo-card { position: relative; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); overflow: hidden; }
  .mkt-demo-card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--primary); }
  .mkt-demo-row { padding: 18px 22px; }
  .mkt-demo-row + .mkt-demo-row { border-top: 1px solid var(--border); }
  .mkt-demo-label { display: block; font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); margin-bottom: 8px; }
  .mkt-demo-user p { margin: 0; font-size: 0.9375rem; color: var(--foreground); font-weight: 500; }
  .mkt-demo-assistant { background: var(--muted); }
  .mkt-demo-assistant .mkt-demo-label { color: var(--primary); }
  .mkt-demo-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 9px; }
  .mkt-demo-list li { font-size: 0.875rem; color: var(--foreground); line-height: 1.5; padding-left: 14px; position: relative; }
  .mkt-demo-list li::before { content: ""; position: absolute; left: 0; top: 0.55em; width: 5px; height: 5px; border-radius: 999px; background: var(--primary); }
  .mkt-demo-list .mkt-demo-meta { color: var(--muted-foreground); font-weight: 400; }

  /* Sections */
  .mkt-section { padding: 88px 0; }
  .mkt-section-head { max-width: 640px; margin: 0 0 44px; }
  .mkt-section h2 { font-size: 1.875rem; letter-spacing: -0.02em; font-weight: 600; color: var(--foreground); margin: 0 0 12px; }
  .mkt-section-sub { font-size: 1rem; color: var(--muted-foreground); margin: 0; line-height: 1.6; }
  .mkt-section-alt { background: var(--warm-bg); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }

  /* Ask SUNLearn prompts */
  .mkt-prompts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .mkt-prompt { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 20px 22px; background: var(--card); transition: background-color 0.12s ease, border-color 0.12s ease; }
  .mkt-prompt:hover { background: var(--muted); border-color: #d4d4d8; }
  .mkt-prompt p { margin: 0; font-size: 0.9375rem; color: var(--foreground); line-height: 1.55; }
  .mkt-prompt p::before { content: "\\201C"; }
  .mkt-prompt p::after { content: "\\201D"; }

  /* Platform cards */
  .mkt-platforms { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .mkt-platform-card { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 28px 30px; background: var(--card); }
  .mkt-platform-card h3 { font-size: 1.125rem; font-weight: 600; margin: 0 0 10px; color: var(--foreground); }
  .mkt-platform-card p { color: var(--muted-foreground); font-size: 0.9375rem; line-height: 1.6; margin: 0 0 16px; }
  .mkt-platform-card a.mkt-link { color: var(--primary); font-weight: 500; font-size: 0.9375rem; text-decoration: none; }
  .mkt-platform-card a.mkt-link:hover { text-decoration: underline; }
  .mkt-compat-note { margin: 28px 0 0; font-size: 0.8125rem; color: var(--muted-foreground); }

  /* Trust / privacy */
  .mkt-trust-list { list-style: none; margin: 0 0 24px; padding: 0; display: flex; flex-direction: column; gap: 16px; max-width: 640px; }
  .mkt-trust-list li { padding-left: 26px; position: relative; font-size: 0.9375rem; line-height: 1.6; color: var(--foreground); }
  .mkt-trust-list li::before { content: ""; position: absolute; left: 0; top: 0.35em; width: 14px; height: 14px; border-radius: 4px; border: 1.5px solid var(--primary); }

  /* FAQ */
  .mkt-faq { max-width: 720px; display: flex; flex-direction: column; }
  .mkt-faq details { border-bottom: 1px solid var(--border); padding: 18px 0; }
  .mkt-faq summary { cursor: pointer; font-weight: 500; font-size: 0.9375rem; color: var(--foreground); list-style: none; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .mkt-faq summary::-webkit-details-marker { display: none; }
  .mkt-faq summary::after { content: "+"; font-size: 1.25rem; color: var(--muted-foreground); font-weight: 400; flex-shrink: 0; }
  .mkt-faq details[open] summary::after { content: "\\2212"; }
  .mkt-faq p { margin: 12px 0 0; color: var(--muted-foreground); font-size: 0.9375rem; line-height: 1.6; }

  /* Screenshot placeholder */
  .mkt-shot {
    border: 1px dashed var(--border); border-radius: var(--radius-lg); background: var(--muted);
    aspect-ratio: 16 / 10; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; margin: 18px 0 0; padding: 24px; text-align: center;
  }
  .mkt-shot svg { color: var(--muted-foreground); opacity: 0.6; }
  .mkt-shot-caption { margin: 0; font-size: 0.8125rem; color: var(--muted-foreground); }
  .mkt-shot-caption strong { color: var(--foreground); font-weight: 500; }

  /* Docs steps */
  .mkt-steps { list-style: none; margin: 0; padding: 0; counter-reset: mkt-step; max-width: 640px; }
  .mkt-steps > li { counter-increment: mkt-step; padding: 0 0 40px 52px; position: relative; }
  .mkt-steps > li:last-child { padding-bottom: 0; }
  .mkt-steps > li::before {
    content: counter(mkt-step); position: absolute; left: 0; top: 0; width: 34px; height: 34px; border-radius: 999px;
    background: var(--primary); color: var(--primary-foreground); display: flex; align-items: center; justify-content: center;
    font-size: 0.875rem; font-weight: 600;
  }
  .mkt-steps > li::after { content: ""; position: absolute; left: 16px; top: 34px; bottom: 0; width: 1px; background: var(--border); }
  .mkt-steps > li:last-child::after { display: none; }
  .mkt-steps h3 { margin: 4px 0 8px; font-size: 1.0625rem; font-weight: 600; color: var(--foreground); }
  .mkt-steps p { margin: 0; color: var(--muted-foreground); font-size: 0.9375rem; line-height: 1.6; }

  /* Docs index */
  .mkt-doc-groups { display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px; max-width: 780px; }
  .mkt-doc-group h3 { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted-foreground); margin: 0 0 14px; }
  .mkt-doc-group ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .mkt-doc-group a { color: var(--foreground); text-decoration: none; font-size: 0.9375rem; }
  .mkt-doc-group a:hover { color: var(--primary); text-decoration: underline; }
  .mkt-doc-group span.mkt-soon { color: var(--muted-foreground); font-size: 0.9375rem; }

  /* Shared narrow reading column: /docs, /docs/chatgpt, /docs/claude, /terms, /privacy */
  .mkt-doc-page { max-width: 720px; margin: 0 auto; padding: 56px 24px 96px; }
  .mkt-doc-page h1 { font-size: 2rem; letter-spacing: -0.02em; font-weight: 600; margin: 0 0 12px; }
  .mkt-doc-intro { font-size: 1.0625rem; color: var(--muted-foreground); line-height: 1.6; margin: 0 0 40px; }
  .mkt-doc-page code { font-family: ui-monospace, SFMono-Regular, monospace; background: var(--muted); padding: 2px 6px; border-radius: 4px; font-size: 0.875em; color: var(--foreground); }
  .mkt-doc-page a { color: var(--primary); text-underline-offset: 2px; }
  .mkt-doc-page h2 { font-size: 1.125rem; font-weight: 600; letter-spacing: -0.01em; color: var(--foreground); margin: 40px 0 10px; }
  .mkt-doc-page p, .mkt-doc-page li { font-size: 0.9375rem; line-height: 1.65; color: var(--muted-foreground); }
  .mkt-doc-page ul { padding-left: 20px; margin: 8px 0; }
  .mkt-doc-page li { margin: 4px 0; }
  .mkt-doc-page li::marker { color: var(--border); }
  .mkt-doc-updated { font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 40px; }
  /* Declared after the generic .mkt-doc-page a rule above so equal-specificity cascade order keeps the crumb muted, not maroon. */
  .mkt-doc-crumb { font-size: 0.8125rem; color: var(--muted-foreground); margin: 0 0 16px; }
  .mkt-doc-crumb a { color: var(--muted-foreground); }

  .mkt-platform-switch { display: flex; gap: 8px; margin: 0 0 40px; }
  .mkt-platform-switch a { font-size: 0.8125rem; font-weight: 500; padding: 6px 14px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted-foreground); text-decoration: none; }
  .mkt-platform-switch a[aria-current="page"] { background: var(--primary); border-color: var(--primary); color: var(--primary-foreground); }

  /* Footer */
  .mkt-footer { border-top: 1px solid var(--border); padding: 40px 0; }
  .mkt-footer-inner { max-width: 1080px; margin: 0 auto; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
  .mkt-footer-brand { font-weight: 600; font-size: 0.9375rem; color: var(--foreground); }
  .mkt-footer-links { display: flex; gap: 22px; }
  .mkt-footer-links a { color: var(--muted-foreground); text-decoration: none; font-size: 0.875rem; }
  .mkt-footer-links a:hover { color: var(--foreground); }
  .mkt-footer-note { max-width: 1080px; margin: 16px auto 0; padding: 0 24px; font-size: 0.8125rem; color: var(--muted-foreground); }

  @media (max-width: 860px) {
    .mkt-hero-inner { grid-template-columns: 1fr; padding: 48px 24px 56px; gap: 36px; }
    .mkt-hero h1 { font-size: 2.125rem; }
    .mkt-nav-links { display: none; }
    .mkt-prompts { grid-template-columns: 1fr; }
    .mkt-platforms { grid-template-columns: 1fr; }
    .mkt-doc-groups { grid-template-columns: 1fr; gap: 28px; }
    .mkt-section { padding: 56px 0; }
  }
`;

export interface MarketingNavOptions {
  current?: "product" | "docs" | "privacy";
}

export function renderMarketingHeader(options: MarketingNavOptions = {}): string {
  const isCurrent = (key: string) => (options.current === key ? ' aria-current="page"' : "");
  return `<header class="mkt-nav">
    <div class="mkt-nav-inner">
      <a href="/" class="mkt-brand">${PRODUCT_NAME}</a>
      <nav class="mkt-nav-links" aria-label="Main">
        <a href="/"${isCurrent("product")}>Product</a>
        <a href="/docs"${isCurrent("docs")}>Docs</a>
        <a href="/privacy"${isCurrent("privacy")}>Privacy</a>
        <a href="https://github.com/RA1NM4KER/sunlearn-mcp" target="_blank" rel="noopener">GitHub</a>
      </nav>
      <a class="mkt-preview-badge" href="/#faq">Private preview</a>
    </div>
  </header>`;
}

export function renderMarketingFooter(): string {
  return `<footer class="mkt-footer">
    <div class="mkt-footer-inner">
      <span class="mkt-footer-brand">${PRODUCT_NAME}</span>
      <nav class="mkt-footer-links" aria-label="Footer">
        <a href="/docs">Docs</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="https://github.com/RA1NM4KER/sunlearn-mcp" target="_blank" rel="noopener">GitHub</a>
      </nav>
    </div>
    <p class="mkt-footer-note">${PRODUCT_NAME} is an independent student project. It is not operated, reviewed, or endorsed by Stellenbosch University.</p>
  </footer>`;
}

/** A labeled placeholder for a not-yet-supplied screenshot — never a fabricated image. */
export function renderShotPlaceholder(caption: string): string {
  return `<div class="mkt-shot" role="img" aria-label="Screenshot placeholder: ${caption.replace(/<[^>]+>/g, "")}">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5-9 9"/></svg>
    <p class="mkt-shot-caption">${caption}</p>
  </div>`;
}
