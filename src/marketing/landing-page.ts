// The public marketing homepage ("/"). Framework-free, server-rendered HTML,
// built on the same design tokens as the connect/consent flow (see
// page-shell.ts) rather than a separate visual system.
//
// Written for a completely non-technical student: no MCP protocol
// explanation, no developer terminology, no tool names. Those belong in
// /docs's developer-reference section, not here.
//
// Private preview: this page is a product SHOWCASE, not an onboarding
// funnel — see src/brand.ts's PRIVATE_PREVIEW flag and src/preview-access.ts
// for the actual server-side enforcement. It deliberately does not publish
// setup instructions or the MCP endpoint; see src/marketing/docs-page.ts.

import { MARKETING_CSS, PAGE_SHELL_CSS, renderMarketingFooter, renderMarketingHeader } from "../page-shell.js";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "../brand.js";

const PROMPTS = [
  "What do I have due this week?",
  "Did I get any new marks?",
  "Summarise the latest announcements from my lecturers.",
  "Find the material where Fourier transforms were introduced.",
  "What should I prioritise studying this week?",
  "Which assignments are still outstanding?",
];

export function renderLandingPage(): string {
  const promptsHtml = PROMPTS.map((p) => `<div class="mkt-prompt"><p>${p}</p></div>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${PRODUCT_NAME}: ${PRODUCT_TAGLINE}</title>
<meta name="description" content="Connect your learning platform to AI assistants like ChatGPT and Claude and ask naturally about courses, assignments, deadlines, grades and announcements.">
<meta property="og:type" content="website">
<meta property="og:title" content="${PRODUCT_NAME}: ${PRODUCT_TAGLINE}">
<meta property="og:description" content="Connect your learning platform to AI assistants like ChatGPT and Claude and ask naturally about courses, assignments, deadlines, grades and announcements.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${PRODUCT_NAME}: ${PRODUCT_TAGLINE}">
<meta name="twitter:description" content="Connect your learning platform to AI assistants like ChatGPT and Claude and ask naturally about courses, assignments, deadlines, grades and announcements.">
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
        <p class="mkt-eyebrow">For university students</p>
        <h1>${PRODUCT_NAME}.<br>${PRODUCT_TAGLINE}</h1>
        <p class="mkt-hero-sub">Connect your learning platform to the AI assistant you already use and ask about courses, deadlines, assignments, grades and announcements.</p>
        <div class="mkt-hero-ctas">
          <a class="btn btn-default" href="#ask">See what it can do</a>
          <a class="btn btn-outline" href="#how-it-works">How it works</a>
        </div>
      </div>
      <div class="mkt-demo-card" aria-hidden="true">
        <div class="mkt-demo-row mkt-demo-user">
          <span class="mkt-demo-label">You</span>
          <p>What do I have due in the next two weeks?</p>
        </div>
        <div class="mkt-demo-row mkt-demo-assistant">
          <span class="mkt-demo-label">${PRODUCT_NAME}</span>
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

  <section class="mkt-section mkt-section-alt" id="how-it-works">
    <div class="mkt-container">
      <div class="mkt-section-head">
        <h2>Works with the AI assistant you already use.</h2>
        <p class="mkt-section-sub">${PRODUCT_NAME} uses the Model Context Protocol to make your course information available to supported AI assistants when you ask for it. No new app to learn.</p>
      </div>
      <div class="mkt-platforms">
        <div class="mkt-platform-card">
          <h3>ChatGPT</h3>
          <p>Ask ChatGPT about your courses once your account is connected.</p>
        </div>
        <div class="mkt-platform-card">
          <h3>Claude</h3>
          <p>Ask Claude the same questions about your courses once your account is connected.</p>
        </div>
      </div>
      <p class="mkt-compat-note">Currently tested with Stellenbosch University's Moodle learning environments (SUNLearn, STEMLearn, EMSLearn, SocSciLearn and FMHSLearn).</p>
    </div>
  </section>

  <section class="mkt-section" id="privacy">
    <div class="mkt-container">
      <div class="mkt-section-head">
        <h2>Designed with your account in mind.</h2>
        <p class="mkt-section-sub">Here's exactly what that means, with no vague guarantees.</p>
      </div>
      <ul class="mkt-trust-list">
        <li>You sign in through your university's own official login page. ${PRODUCT_NAME} never sees your password.</li>
        <li>Access is read-only. It can't submit assignments, post on your behalf, or change anything in your learning account.</li>
        <li>Your connection is encrypted at rest and scoped to your account only.</li>
        <li>When you use ${PRODUCT_NAME} through an AI assistant, the information needed to answer your question is returned to that assistant, subject to its own terms and your account settings.</li>
        <li>${PRODUCT_NAME} is an independent student project, not an official service of any university.</li>
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
        <details open>
          <summary>Can I connect right now?</summary>
          <p>${PRODUCT_NAME} is currently in private preview. It's being tested with a small group before a wider release, so public connections aren't available yet.</p>
        </details>
        <details>
          <summary>Is ${PRODUCT_NAME} an official university service?</summary>
          <p>No. ${PRODUCT_NAME} is an independent student-built project and is not affiliated with, endorsed by, or an official service of Stellenbosch University.</p>
        </details>
        <details>
          <summary>Can ${PRODUCT_NAME} change anything in my account?</summary>
          <p>No. ${PRODUCT_NAME} is read-only. It only reads information you already have access to; it never submits work, posts on your behalf, or changes anything in your learning account.</p>
        </details>
        <details>
          <summary>Does ${PRODUCT_NAME} get my university password?</summary>
          <p>No. You sign in on your university's own official login page, and ${PRODUCT_NAME} never receives or stores that password.</p>
        </details>
        <details>
          <summary>Where does my course information go?</summary>
          <p>When you ask a question, the information needed to answer it is returned to the AI assistant you're using (for example ChatGPT or Claude). How that assistant handles it afterward is governed by your account settings and that provider's own terms.</p>
        </details>
        <details>
          <summary>Does this replace my university's Moodle?</summary>
          <p>No. ${PRODUCT_NAME} provides an additional, conversational way to access information that already lives in your existing learning platform.</p>
        </details>
        <details>
          <summary>Something isn't working, or I have a question.</summary>
          <p>Reach out via the project's <a href="https://github.com/RA1NM4KER/sunlearn-mcp" target="_blank" rel="noopener">GitHub page</a>.</p>
        </details>
      </div>
    </div>
  </section>

  ${renderMarketingFooter()}
</body>
</html>
`;
}
