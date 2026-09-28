// Legal notices (/terms, /privacy), styled as part of the public marketing
// site (see src/marketing/*.ts, src/page-shell.ts) rather than the old
// connect-flow-only shell — these are reachable from the landing page's nav
// and footer now, not just from /connect. Content is unchanged; only the
// surrounding shell moved.
//
// Deliberately plain-language and short — this is a small independent
// project, not a company with a legal department. Update this copy (contact
// details, hosting specifics) before any public/production launch; it is
// not a substitute for real legal review at that point.

import { MARKETING_CSS, PAGE_SHELL_CSS, renderMarketingFooter, renderMarketingHeader } from "./page-shell.js";
import { PRODUCT_NAME } from "./brand.js";

function legalPageShell(title: string, current: "privacy" | undefined, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${title}: ${PRODUCT_NAME}</title>
<style>
${PAGE_SHELL_CSS}
${MARKETING_CSS}
</style>
</head>
<body class="mkt">
  ${renderMarketingHeader(current ? { current } : {})}
  <main class="mkt-doc-page">
    <h1>${title}</h1>
    <p class="mkt-doc-updated">${PRODUCT_NAME}: an independent, unofficial project.</p>
    ${bodyHtml}
  </main>
  ${renderMarketingFooter()}
</body>
</html>
`;
}

export const TERMS_HTML = legalPageShell(
  "Terms of Use",
  undefined,
  `
  <p>${PRODUCT_NAME} is an independent, student-built tool that gives an AI assistant
  read-only access to your own Moodle-based courses (SUNLearn, STEMLearn, and similar
  Stellenbosch University learning environments), on your explicit request.
  It is <strong>not an official Stellenbosch University service</strong> and is not
  operated, reviewed, or endorsed by the University.</p>

  <h2>What this tool does</h2>
  <p>It reads course content, deadlines, grades, and files that you already have
  access to as a student, using an access grant you create yourself through the
  official Stellenbosch/Microsoft sign-in page. It never performs any write action
  on your behalf and never sees your university password.</p>

  <h2>Your responsibility</h2>
  <p>You are responsible for how you use this tool and for complying with
  Stellenbosch University's own acceptable-use and IT policies. Only connect
  accounts that are yours to connect.</p>

  <h2>No warranty</h2>
  <p>This is provided as-is, with no guarantee of accuracy, availability, or
  fitness for any particular purpose. Course information should always be
  verified against the official Moodle site or your lecturer when it matters.</p>

  <h2>Revoking access</h2>
  <p>You can disconnect any individual site, or delete all of your ${PRODUCT_NAME} data
  outright, at any time from the Connect page. Both actions take effect immediately.</p>

  <h2>Changes</h2>
  <p>These terms may change as the project evolves. Continued use after a change
  means you accept the updated terms.</p>
  `,
);

export const PRIVACY_HTML = legalPageShell(
  "Privacy Notice",
  "privacy",
  `
  <p>This notice explains exactly what ${PRODUCT_NAME} stores about you, what it only
  ever reads live and never stores, and why.</p>

  <h2>What is stored</h2>
  <ul>
    <li>Your Moodle user id and the address (origin) of each Moodle site you connect, for example SUNLearn or STEMLearn.</li>
    <li>An internal, opaque canonical account identifier that links your connected sites together as one account.</li>
    <li>One encrypted access token per site you choose to connect (AES-256-GCM, at rest). This is what lets the tool read your courses on your behalf.</li>
  </ul>

  <h2>What is only ever fetched live, never stored</h2>
  <ul>
    <li>Your course content: courses, assignments, grades, files, announcements, forum posts, and calendar events are fetched from Moodle fresh for each request, not kept in a separate copy.</li>
  </ul>

  <h2>What is never stored or seen</h2>
  <ul>
    <li>Your Stellenbosch/Microsoft password or MFA code. Sign-in happens entirely on official Stellenbosch/Microsoft pages, which ${PRODUCT_NAME} never sees.</li>
  </ul>

  <h2>How it's used</h2>
  <p>Solely to answer your AI assistant's requests about your own enrolled courses,
  deadlines, grades, files, and announcements, read-only, on your behalf, when you
  ask.</p>

  <h2>Sharing with AI providers</h2>
  <p>${PRODUCT_NAME} is not sold to, and does not share data with, advertisers or data
  brokers. When you ask a question through an AI assistant such as ChatGPT or Claude,
  the course information needed to answer it is returned to that assistant so it can
  respond to you. What that provider does with it afterward is governed by your own
  account settings and that provider's own terms, not by ${PRODUCT_NAME}.</p>

  <h2>Deleting your data</h2>
  <p>From the Connect page, you can:</p>
  <ul>
    <li><strong>Disconnect a single site</strong>: immediately removes that site's stored credential, while leaving any other connected sites untouched.</li>
    <li><strong>Delete all my ${PRODUCT_NAME} data</strong>: immediately removes every stored credential and account identifier for your account, across every connected site.</li>
  </ul>
  `,
);
