// The public docs experience: /docs, /docs/chatgpt, /docs/claude. Same
// design system as landing-page.ts (see page-shell.ts): a natural
// continuation of the marketing site, not a separate "developer docs"
// product.
//
// Setup guides are written for a non-technical student: one action per step,
// plain language, no CLI, no MCP protocol explanation. Internal MCP tool
// names (e.g. upcoming_and_overdue) deliberately never appear here; see the
// "Using SUNLearn" capability descriptions below, which use plain concepts
// instead.

import { MARKETING_CSS, PAGE_SHELL_CSS, renderMarketingFooter, renderMarketingHeader, renderShotPlaceholder } from "../page-shell.js";

const MCP_URL = "https://sunlearn-mcp.kefas.co.za/mcp";

function docsShell(title: string, description: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${title}: SUNLearn MCP</title>
<meta name="description" content="${description}">
<style>
${PAGE_SHELL_CSS}
${MARKETING_CSS}
</style>
</head>
<body class="mkt">
  ${renderMarketingHeader({ current: "docs" })}
  <main class="mkt-doc-page">
    ${bodyHtml}
  </main>
  ${renderMarketingFooter()}
</body>
</html>
`;
}

const CAPABILITIES: { name: string; description: string }[] = [
  { name: "Courses", description: "List everything you're enrolled in, across every connected Stellenbosch Moodle site." },
  { name: "Assignments", description: "See what's due, when, and whether you've already submitted." },
  { name: "Grades", description: "Check marks per course, per item, without opening Moodle." },
  { name: "Announcements", description: "Catch up on what a lecturer posted, summarised in plain language." },
  { name: "Files and course material", description: "Find and read course files and readings by describing what you're looking for." },
  { name: "Calendar", description: "See what's coming up: due dates, quiz windows, and other course events." },
  { name: "Quizzes", description: "Check what's open, what's closed, and your past attempt history." },
];

export function renderDocsIndexPage(): string {
  const capabilitiesHtml = CAPABILITIES.map(
    (c) => `<li><strong>${c.name}.</strong> ${c.description}</li>`,
  ).join("\n");

  const body = `
    <h1>Documentation</h1>
    <p class="mkt-doc-intro">Everything you need to connect SUNLearn and start asking questions about your courses.</p>

    <div class="mkt-doc-groups">
      <div class="mkt-doc-group">
        <h3>Getting started</h3>
        <ul>
          <li><a href="/docs/chatgpt">Set up ChatGPT</a></li>
          <li><a href="/docs/claude">Set up Claude</a></li>
        </ul>
      </div>
      <div class="mkt-doc-group">
        <h3>Help</h3>
        <ul>
          <li><a href="#troubleshooting">Troubleshooting</a></li>
          <li><a href="/#faq">FAQ</a></li>
          <li><a href="/privacy">Privacy notice</a></li>
        </ul>
      </div>
    </div>

    <h2 style="font-size: 1.25rem; font-weight: 600; margin: 56px 0 8px;">What you can ask</h2>
    <p style="color: var(--muted-foreground); font-size: 0.9375rem; margin: 0 0 20px;">Once connected, SUNLearn can answer questions across these areas of your courses.</p>
    <ul style="list-style: none; padding: 0; margin: 0 0 56px; display: flex; flex-direction: column; gap: 14px;">
      ${capabilitiesHtml.replace(/<li>/g, '<li style="font-size: 0.9375rem; line-height: 1.6; color: var(--foreground);">')}
    </ul>

    <h2 id="troubleshooting" style="font-size: 1.25rem; font-weight: 600; margin: 0 0 20px;">Troubleshooting</h2>
    <div class="mkt-faq" style="max-width: none;">
      <details>
        <summary>ChatGPT or Claude can't find SUNLearn as a connector</summary>
        <p>Double-check you pasted the full address, <code>${MCP_URL}</code>, exactly as shown, with no extra spaces.</p>
      </details>
      <details>
        <summary>It asks me to sign in every time</summary>
        <p>This can happen if you denied access previously, or if your session expired. Redo the setup steps for <a href="/docs/chatgpt">ChatGPT</a> or <a href="/docs/claude">Claude</a> and sign in again.</p>
      </details>
      <details>
        <summary>It says my course isn't found</summary>
        <p>Make sure the SUNLearn environment that course lives on is connected. Some Stellenbosch faculties use a separate Moodle site; you can connect it from the same sign-in screen shown when you set up ChatGPT or Claude.</p>
      </details>
      <details>
        <summary>I want to see the technical/developer reference</summary>
        <p>The underlying MCP tools and integration details are documented in the project's <a href="https://github.com/RA1NM4KER/sunlearn-mcp" target="_blank" rel="noopener">GitHub repository</a>.</p>
      </details>
    </div>
  `;

  return docsShell(
    "Documentation",
    "Set up SUNLearn MCP with ChatGPT or Claude, and see what you can ask once connected.",
    body,
  );
}

function platformSwitch(current: "chatgpt" | "claude"): string {
  const link = (key: "chatgpt" | "claude", label: string) =>
    `<a href="/docs/${key}"${current === key ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<div class="mkt-platform-switch">${link("chatgpt", "ChatGPT")}${link("claude", "Claude")}</div>`;
}

export function renderChatGptDocsPage(): string {
  const body = `
    <p class="mkt-doc-crumb"><a href="/docs">Docs</a> / ChatGPT</p>
    <h1>Set up SUNLearn in ChatGPT</h1>
    <p class="mkt-doc-intro">Takes about a minute. You'll sign in through Stellenbosch's own login page. SUNLearn MCP never sees your password.</p>
    ${platformSwitch("chatgpt")}

    <ol class="mkt-steps">
      <li>
        <h3>Open Connectors in ChatGPT settings</h3>
        <p>In ChatGPT, open <strong>Settings</strong>, then <strong>Connectors</strong>.</p>
        ${renderShotPlaceholder("ChatGPT Settings, with Connectors highlighted in the sidebar")}
      </li>
      <li>
        <h3>Add a custom connector</h3>
        <p>Choose <strong>Advanced settings</strong>, then <strong>Add custom connector</strong>.</p>
        ${renderShotPlaceholder('The "Add custom connector" screen')}
      </li>
      <li>
        <h3>Paste the SUNLearn address</h3>
        <p>Paste this address into the connector URL field: <code>${MCP_URL}</code></p>
        ${renderShotPlaceholder("The connector form with the SUNLearn address pasted in")}
      </li>
      <li>
        <h3>Sign in with your Stellenbosch account</h3>
        <p>ChatGPT will open Stellenbosch's official sign-in page. Sign in as you normally would, then connect the SUNLearn sites you use.</p>
        ${renderShotPlaceholder("The Stellenbosch sign-in / Connect SUNLearn screen")}
      </li>
      <li>
        <h3>Ask something</h3>
        <p>Start a new chat and ask, for example: <em>"What do I have due this week?"</em></p>
        ${renderShotPlaceholder("A ChatGPT conversation using SUNLearn")}
      </li>
    </ol>
  `;

  return docsShell(
    "Set up ChatGPT",
    "Step-by-step guide to connecting SUNLearn to ChatGPT.",
    body,
  );
}

export function renderClaudeDocsPage(): string {
  const body = `
    <p class="mkt-doc-crumb"><a href="/docs">Docs</a> / Claude</p>
    <h1>Set up SUNLearn in Claude</h1>
    <p class="mkt-doc-intro">Takes about a minute. You'll sign in through Stellenbosch's own login page. SUNLearn MCP never sees your password.</p>
    ${platformSwitch("claude")}

    <ol class="mkt-steps">
      <li>
        <h3>Open Connectors in Claude settings</h3>
        <p>In Claude, open <strong>Settings</strong>, then <strong>Connectors</strong>.</p>
        ${renderShotPlaceholder("Claude Settings, with Connectors highlighted")}
      </li>
      <li>
        <h3>Add a custom connector</h3>
        <p>Choose <strong>Add custom connector</strong>.</p>
        ${renderShotPlaceholder('The "Add custom connector" screen in Claude')}
      </li>
      <li>
        <h3>Paste the SUNLearn address</h3>
        <p>Paste this address into the connector URL field: <code>${MCP_URL}</code></p>
        ${renderShotPlaceholder("The connector form with the SUNLearn address pasted in")}
      </li>
      <li>
        <h3>Sign in with your Stellenbosch account</h3>
        <p>Claude will open Stellenbosch's official sign-in page. Sign in as you normally would, then connect the SUNLearn sites you use.</p>
        ${renderShotPlaceholder("The Stellenbosch sign-in / Connect SUNLearn screen")}
      </li>
      <li>
        <h3>Ask something</h3>
        <p>Start a new conversation and ask, for example: <em>"What do I have due this week?"</em></p>
        ${renderShotPlaceholder("A Claude conversation using SUNLearn")}
      </li>
    </ol>
  `;

  return docsShell(
    "Set up Claude",
    "Step-by-step guide to connecting SUNLearn to Claude.",
    body,
  );
}
