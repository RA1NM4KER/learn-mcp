// The public marketing homepage ("/"). Framework-free, server-rendered HTML,
// built on the same design tokens as the connect/consent flow (see
// page-shell.ts) rather than a separate visual system.
//
// Written for a completely non-technical student, per design brief: no MCP
// protocol explanation, no developer terminology, no tool names. Those
// belong in /docs's developer-reference section, not here.

import { MARKETING_CSS, PAGE_SHELL_CSS, renderMarketingFooter, renderMarketingHeader } from "../page-shell.js";

const PROMPTS = [
  "What do I have due this week?",
  "Did I get any new marks?",
  "Summarise the latest announcements from my lecturers.",
  "Find the slides where Fourier transforms were introduced.",
  "What should I prioritise studying this week?",
  "What's overdue?",
];

export function renderLandingPage(): string {
  const promptsHtml = PROMPTS.map((p) => `<div class="mkt-prompt"><p>${p}</p></div>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>SUNLearn MCP: Your SUNLearn. Now you can just ask.</title>
<meta name="description" content="Connect your Stellenbosch University courses to ChatGPT or Claude and ask about assignments, deadlines, grades, announcements, and course content.">
<style>
${PAGE_SHELL_CSS}
${MARKETING_CSS}
</style>
</head>
<body class="mkt">
  ${renderMarketingHeader({ current: "product" })}

  <section class="mkt-hero">
    <div class="mkt-hero-inner">
      <div>
        <p class="mkt-eyebrow">For Stellenbosch University students</p>
        <h1>Your SUNLearn.<br>Now you can just ask.</h1>
        <p class="mkt-hero-sub">Connect your Stellenbosch courses to ChatGPT or Claude and ask about assignments, deadlines, grades, announcements, and course content.</p>
        <div class="mkt-hero-ctas">
          <a class="btn btn-default" href="/docs">Connect SUNLearn</a>
          <a class="btn btn-outline" href="/docs/chatgpt">Set up ChatGPT</a>
        </div>
      </div>
      <div class="mkt-demo-card" aria-hidden="true">
        <div class="mkt-demo-row mkt-demo-user">
          <span class="mkt-demo-label">You</span>
          <p>What do I have due in the next two weeks?</p>
        </div>
        <div class="mkt-demo-row mkt-demo-assistant">
          <span class="mkt-demo-label">SUNLearn</span>
          <ul class="mkt-demo-list">
            <li>Practical 2 <span class="mkt-demo-meta">(Systems &amp; Signals 244, due Thursday)</span></li>
            <li>Literature review draft <span class="mkt-demo-meta">(Research Methods 310, due Friday)</span></li>
            <li>Problem set 4 <span class="mkt-demo-meta">(Linear Algebra 214, due in 9 days)</span></li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section class="mkt-section" id="ask">
    <div class="mkt-container">
      <div class="mkt-section-head">
        <h2>Just ask.</h2>
        <p class="mkt-section-sub">Plain questions. Real answers, pulled from your own courses.</p>
      </div>
      <div class="mkt-prompts">
        ${promptsHtml}
      </div>
    </div>
  </section>

  <section class="mkt-section mkt-section-alt">
    <div class="mkt-container">
      <div class="mkt-section-head">
        <h2>Works with the AI you already use.</h2>
        <p class="mkt-section-sub">No new app to learn. SUNLearn shows up inside the assistant you already have open.</p>
      </div>
      <div class="mkt-platforms">
        <div class="mkt-platform-card">
          <h3>ChatGPT</h3>
          <p>Connect SUNLearn and access your course information from your ChatGPT conversations.</p>
          <a class="mkt-link" href="/docs/chatgpt">Set up ChatGPT →</a>
        </div>
        <div class="mkt-platform-card">
          <h3>Claude</h3>
          <p>Add SUNLearn through Claude's MCP integration and ask the same questions about your courses.</p>
          <a class="mkt-link" href="/docs/claude">Set up Claude →</a>
        </div>
      </div>
    </div>
  </section>

  <section class="mkt-section" id="privacy">
    <div class="mkt-container">
      <div class="mkt-section-head">
        <h2>Designed with your account in mind.</h2>
        <p class="mkt-section-sub">Here's exactly what that means, with no vague guarantees.</p>
      </div>
      <ul class="mkt-trust-list">
        <li>You sign in through Stellenbosch's own official login page. SUNLearn MCP never sees your password.</li>
        <li>Access is read-only. It can't submit assignments, post on your behalf, or change anything in Moodle.</li>
        <li>Your connection is encrypted at rest and scoped to your account only.</li>
        <li>You can disconnect a site any time you reconnect through ChatGPT or Claude, or revoke access entirely from your Microsoft account settings.</li>
        <li>SUNLearn MCP is an independent student project, not an official Stellenbosch University service.</li>
      </ul>
      <a class="mkt-link" href="/privacy" style="color: var(--primary); font-weight: 500; text-decoration: none; font-size: 0.9375rem;">Read the full privacy notice →</a>
    </div>
  </section>

  <section class="mkt-section mkt-section-alt" id="faq">
    <div class="mkt-container">
      <div class="mkt-section-head">
        <h2>Frequently asked questions</h2>
      </div>
      <div class="mkt-faq">
        <details>
          <summary>Is this an official Stellenbosch University service?</summary>
          <p>No. SUNLearn MCP is an independent student project. It is not operated, reviewed, or endorsed by Stellenbosch University.</p>
        </details>
        <details>
          <summary>Can SUNLearn MCP submit assignments or change anything in my account?</summary>
          <p>No. It only reads information you already have access to. It never submits work, posts on your behalf, or changes anything in Moodle.</p>
        </details>
        <details>
          <summary>Does it work with multiple Stellenbosch Moodle sites?</summary>
          <p>Yes. If you have accounts on more than one Stellenbosch Moodle environment (for example SUNLearn and a faculty-specific site), you can connect each one, and your assistant will see courses from all of them.</p>
        </details>
        <details>
          <summary>Do I need to understand how any of this works technically?</summary>
          <p>No. Connect your account once, then just ask questions in ChatGPT or Claude like you would ask a classmate.</p>
        </details>
        <details>
          <summary>How do I disconnect?</summary>
          <p>Reconnect through ChatGPT or Claude to disconnect an individual site with one click, or revoke access entirely from your Microsoft/Stellenbosch account security settings.</p>
        </details>
        <details>
          <summary>Something isn't working. What should I do?</summary>
          <p>Check the <a href="/docs">setup guide</a> for your assistant first. If it's still not working, reach out via the project's <a href="https://github.com/RA1NM4KER/sunlearn-mcp" target="_blank" rel="noopener">GitHub page</a>.</p>
        </details>
      </div>
    </div>
  </section>

  ${renderMarketingFooter()}
</body>
</html>
`;
}
