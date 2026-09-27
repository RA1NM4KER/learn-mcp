// Minimal, honest static legal notices, linked from the connect page's
// footer. Deliberately plain-language and short — this is a small
// independent project, not a company with a legal department. Update this
// copy (contact details, hosting specifics) before any public/production
// launch; it is not a substitute for real legal review at that point.

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function legalPageShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)} — SUNLearn MCP</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 640px; margin: 0 auto; padding: 40px 20px 60px; line-height: 1.6; color: #1f2430; background: #fff; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  h2 { font-size: 1.05rem; margin-top: 28px; }
  p, li { color: #444d5e; }
  a { color: #7a2748; }
  .back { display: inline-block; margin-bottom: 24px; font-size: 0.9rem; }
  .updated { color: #8a93a6; font-size: 0.85rem; margin-bottom: 24px; }
</style>
</head>
<body>
  <a class="back" href="/connect">&larr; Back to Connect</a>
  <h1>${escapeHtml(title)}</h1>
  <p class="updated">SUNLearn MCP — an independent, unofficial project.</p>
  ${bodyHtml}
</body>
</html>
`;
}

export const TERMS_HTML = legalPageShell(
  "Terms of Use",
  `
  <p>SUNLearn MCP is an independent, student-built tool that gives an AI assistant
  read-only access to your own SUNLearn/Moodle courses, on your explicit request.
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
  <p>You can disconnect any site at any time from the Connect page, and you can
  revoke this application's access entirely from your Microsoft/Stellenbosch
  account's own security settings.</p>

  <h2>Changes</h2>
  <p>These terms may change as the project evolves. Continued use after a change
  means you accept the updated terms.</p>
  `,
);

export const PRIVACY_HTML = legalPageShell(
  "Privacy Notice",
  `
  <p>This notice explains what SUNLearn MCP stores about you and why.</p>

  <h2>What is stored</h2>
  <ul>
    <li>One encrypted access token per SUNLearn site you choose to connect (AES-256-GCM, at rest). This is what lets the tool read your courses on your behalf.</li>
    <li>An internal, opaque account identifier used to keep your connected sites linked together.</li>
  </ul>

  <h2>What is never stored</h2>
  <ul>
    <li>Your Stellenbosch/Microsoft password or MFA code — sign-in happens entirely on official Stellenbosch/Microsoft pages, which this tool never sees.</li>
    <li>Your course content itself — it is fetched live from Moodle for each request, not kept in a separate copy.</li>
  </ul>

  <h2>How it's used</h2>
  <p>Solely to answer your assistant's requests about your own enrolled courses,
  deadlines, grades, files, and forum posts — read-only, on your behalf, when you
  ask.</p>

  <h2>Sharing</h2>
  <p>Nothing is sold or shared with third parties. Data is not used for
  advertising or analytics.</p>

  <h2>Deleting your data</h2>
  <p>Disconnecting a site from the Connect page removes that site's stored
  credential immediately. Revoking access from your Microsoft account settings
  achieves the same thing from your side.</p>
  `,
);
