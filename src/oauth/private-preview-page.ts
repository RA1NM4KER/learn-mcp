import { PAGE_SHELL_CSS, renderBrandHeader, renderLegalFooter } from "../page-shell.js";
import { PRIVATE_PREVIEW_MESSAGE } from "../preview-access.js";

// Shown instead of the SUNLearn connect page when the private-preview gate
// (src/preview-access.ts) rejects a genuinely new, unauthorized identity —
// deliberately a standalone page, not the multi-site connect page with an
// error banner: that page's per-site "Connect" buttons would otherwise
// invite exactly the retry this gate exists to prevent. No OAuth internals,
// no stack trace, no hint about the allowlist mechanism itself.

export function renderPrivatePreviewPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Private preview: Learn MCP</title>
<style>
${PAGE_SHELL_CSS}
  .preview-card { padding: 32px 30px; text-align: center; }
  .preview-badge {
    display: inline-flex; align-items: center; gap: 6px; background: var(--secondary); color: var(--secondary-foreground);
    border-radius: 999px; padding: 4px 12px; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; margin-bottom: 18px;
  }
  .preview-card h1 { font-size: 1.375rem; margin: 0 0 12px; }
  .preview-card p { color: var(--muted-foreground); font-size: 0.9375rem; line-height: 1.6; margin: 0 0 8px; }
</style>
</head>
<body>
  ${renderBrandHeader()}
  <div class="page">
  <div class="card preview-card">
    <span class="preview-badge">Private preview</span>
    <h1>${PRIVATE_PREVIEW_MESSAGE}</h1>
    <p>Learn MCP is being tested privately before a wider release. If you believe you should have access, reach out to the project directly.</p>
  </div>
  </div>
  ${renderLegalFooter()}
</body>
</html>
`;
}
