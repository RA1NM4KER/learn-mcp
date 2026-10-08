# Learn MCP

**Ask Claude or ChatGPT about your Stellenbosch University courses — deadlines, grades, announcements and files.**

[![License](https://img.shields.io/github/license/RA1NM4KER/sunlearn-mcp)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/RA1NM4KER/sunlearn-mcp)](https://github.com/RA1NM4KER/sunlearn-mcp/releases/latest)

Learn MCP is a **read-only** [MCP](https://modelcontextprotocol.io) server built for Stellenbosch
University's Moodle sites — **SUNLearn, STEMLearn, EMSLearn, SocSciLearn and FMHSLearn**. Run it on
your own machine with your own Moodle token and any MCP client can answer questions like
"what is due this week?" or "what did I score on the last quiz?".

- **Built for SU** — sign-in goes through the university's SSO, and several SU sites can be linked to one account.
- **Read-only** — it never submits, edits or deletes anything in Moodle.
- **Local first** — in stdio mode your token stays in `.auth/token.json` on your machine.
- **Other Moodle sites** — it speaks the standard Moodle web service API, so local mode can be pointed at another Moodle with `MOODLE_URL` and `MOODLE_TOKEN`, but only the SU sites are tested and supported.

An independent student project, not operated or endorsed by Stellenbosch University.

### Supported sites

| Site | Host | Faculties |
| --- | --- | --- |
| SUNLearn | `learn.sun.ac.za` | University main site |
| STEMLearn | `stemlearn.sun.ac.za` | |
| EMSLearn | `emslearn.sun.ac.za` | Economic & Management Science, Military Science |
| SocSciLearn | `socscilearn.sun.ac.za` | Education, Law, Arts & Social Sciences, Theology |
| FMHSLearn | `fmhslearn.sun.ac.za` | Medicine & Health Sciences |

```bash
npm install && npx playwright install chromium
npm run auth && npm run build      # sign in once through your institution's SSO
claude mcp add learn -- node /absolute/path/to/learn-mcp/dist/server.js
```

It covers courses, assignments, deadlines, grades, announcements, calendar events, quizzes,
forums and course files. The codebase is not otherwise Stellenbosch-specific (it speaks the
standard Moodle web service API), but the SU sites are the only ones tested and supported.
Learn MCP is not operated, reviewed or endorsed by Stellenbosch University or any other institution.

**Status:** the hosted remote server (`sunlearn-mcp.kefas.co.za`) is
currently in **private preview** (see [Access control](#access-control)
below). The local stdio mode described below has no such restriction: it
runs entirely under your own Moodle token.

## Two deployment modes, one MCP server

Both modes register the same tools/resources/prompts via
`createSunLearnServer()` (`src/create-server.ts`); only the transport and
identity model differ.

### Local (stdio): primary supported mode

Runs on your own machine over stdio, using a Moodle token you generate
yourself. No account linking, no OAuth, no multi-user concerns: it is your
token, on your machine, for your MCP client.

```bash
npm install
npx playwright install chromium
npm run auth      # opens your institution's SSO flow, saves .auth/token.json
npm run build
```

`npm run auth` saves the resulting Moodle token to `.auth/token.json` with
restrictive file permissions; the server reads it automatically. For CI or
manual configuration, `MOODLE_URL` and `MOODLE_TOKEN` env vars are also
supported (Moodle URLs must be HTTPS, except `localhost`/`127.0.0.1`/`::1`
development addresses).

Register the built server with an MCP client:

```bash
claude mcp add learn -- node /absolute/path/to/learn-mcp/dist/server.js
```

### Remote (Cloudflare Worker, Streamable HTTP)

`src/worker.ts` exposes `POST /mcp` and `GET /health`, protected by
**OAuth 2.1** (authorization code + PKCE S256, via
`@cloudflare/workers-oauth-provider`): a standards-compliant MCP client
discovers `/.well-known/oauth-protected-resource/mcp` and
`/.well-known/oauth-authorization-server`, registers via Dynamic Client
Registration (`/oauth/register`) or a Client ID Metadata Document, and
completes `/authorize`. `/authorize` runs the real student account-linking
flow as its authentication step: the student signs in on their
institution's own SU/Microsoft page, then pastes back a resulting
connection link, which is verified (including a live
`core_webservice_get_site_info` call) before anything is persisted. The
Moodle token is stored AES-256-GCM-encrypted in D1, never in plaintext, and
the tool never returns it, a raw file URL, or a filesystem path to the MCP
client.

Multi-site identity: each verified (Moodle site, Moodle user id) pair
resolves to one durable **canonical user id**
(`src/oauth/canonical-identity.ts`), so a student can link several of their
institution's Moodle sites (e.g. SUNLearn and STEMLearn) and have them
aggregated under one MCP account, re-authenticating from any of them later
without losing that identity. A legacy static-bearer lane
(`Authorization: Bearer <MCP_ACCESS_TOKEN>`, constant-time compared) is
preserved alongside OAuth during migration, resolving only a single fixed
legacy identity; the two lanes are deliberately kept disjoint and never
share identity semantics (see `src/linking/resolve-config.ts`).

From the account-linking page, a student can **disconnect** any one
connected site, or **delete all of their Learn MCP data** outright (every
credential and identity record for their account, across every site);
see `src/linking/credential-store.ts`'s `deleteAllUserData`.

Required secrets (`wrangler secret put <NAME>`): `MOODLE_URL`,
`MOODLE_TOKEN`, `MCP_ACCESS_TOKEN`, `CREDENTIAL_ENCRYPTION_KEY`. Optional
tunables: `MOODLE_MCP_MAX_FILE_MB`, `MOODLE_MCP_REQUEST_TIMEOUT_MS`. Requires
a D1 database bound as `DB` (`wrangler.toml`, `migrations/*.sql`) and a KV
namespace bound as `OAUTH_KV` (used only by the OAuth provider library for
its own codes/tokens/clients/grants, separate from our own D1 linking data).
Deploy with `npm run deploy` (`wrangler deploy`).

#### Access control

Two independent flags gate the remote deployment, both fail closed (missing
or invalid config is always the more restrictive behavior):

- **`ACCESS_MODE`** (`src/preview-access.ts`): anything other than the
  literal `"public"` puts the deployment in `private_preview`. In that mode,
  a brand-new (site, Moodle user id) identity is rejected before any D1 write
  happens: no credential is persisted, no canonical account is minted, and
  the student sees a plain "private preview" page instead of an internal
  error. `PREVIEW_ALLOWED_CANONICAL_USER_IDS` (comma-separated canonical user
  ids, set as a Worker secret) lists who may onboard during preview; an
  already-allowed identity keeps working (including linking additional
  sites) even if the allowlist changes later, since the gate only applies to
  minting a *new* canonical identity.
- **`REMOTE_COURSE_CONTENT_ENABLED`** (`src/tools/download.ts`,
  `src/resources/index.ts`): enabled by default; only the literal `"false"`
  disables the two higher-risk file/content-retrieval surfaces
  (`moodle_download_file`, the `moodle://files/{fileId}` resource) without
  affecting lower-risk metadata tools (courses, assignments, grades,
  calendar, notifications, `moodle_list_resources` listing). When disabled,
  the tool/resource is not registered at all, rather than registered and
  erroring.

### Continuous deployment

Pushes to `main` run `.github/workflows/deploy.yml`: install locked
dependencies with `npm ci`, build, test, a minified Wrangler dry run, then
deploy only if every earlier step succeeds. It can also be run manually via
GitHub Actions' **Run workflow** control. Pull requests do not deploy.

Repository secrets required (GitHub → **Settings → Secrets and variables →
Actions**): `CLOUDFLARE_API_TOKEN` (narrowly scoped to this Worker's
deploy/edit permissions) and `CLOUDFLARE_ACCOUNT_ID`. GitHub Actions never
receives Moodle credentials, `CREDENTIAL_ENCRYPTION_KEY`, or
`MCP_ACCESS_TOKEN`; those remain Worker secrets set with
`wrangler secret put`.

## MCP surface

Tools cover enrolled courses and their structure, files, assignments,
grades, calendar events, quizzes, forums, notifications, site information,
and the composed `course_overview` and `upcoming_and_overdue` views (the
remote deployment aggregates the latter two across every site a student has
linked).

`moodle_list_resources` returns bounded file listings with an opaque,
encrypted `fileId` and a matching `moodle://files/{fileId}` URI. Use either
that URI as an MCP resource or `moodle_download_file`; both re-check current
Moodle access before downloading. File IDs expire after 24 hours and are
bound to the authenticated user and token.

### Teaching assistant access to submissions

`moodle_list_assignment_groups` and `moodle_list_assignment_submissions` let a
teaching assistant or grader look up an assignment's submissions, read-only.
Typical workflow:

1. `moodle_list_assignments` with the course ID, to get the assignment ID.
2. `moodle_list_assignment_groups` with the course and assignment IDs, to see
   the groups the assignment allows (grouping restrictions are applied).
3. `moodle_list_assignment_submissions` with either exact student numbers
   (up to 25 per call, kept as text so leading zeros survive), a group name or
   group ID, or both.
4. `moodle_download_file` for files up to 5 MB (returned in the response), or
   `moodle_save_file` on the local server for larger files (saved to
   `MOODLE_MCP_DOWNLOAD_DIR`, default `~/Downloads/learn-mcp`).
5. Open the `Grading page` link from step 3 in your own browser to enter marks
   there. On a team assignment this is the bench group page
   (`view.php?id={courseModuleId}&group={groupId}`), because grader links by
   student user ID redirect there. The server never writes grades, and the
   links hold no token.

On team assignments, a bench group is one block: its group page, its members
with student numbers, and its one shared submission with the files listed
once. Each `Group page` link comes from `moodle_list_assignment_groups`.

Example calls:

```text
moodle_list_assignment_submissions(courseId, assignmentId, studentNumbers=["00123", "00456"])
moodle_list_assignment_submissions(courseId, assignmentId, group="Prac 3 Wednesday 14:00 Bench 4-31")
moodle_download_file(fileId="f_...")
```

Each student number gets an explicit result: `matched`, `not submitted`
(matched, no attempt), `unmatched` (no participant of this assignment has the
number, or your account cannot see one), or `ambiguous` (several participants
share the number; nothing is selected). Every attempt is listed, newest first, and no attempt is
chosen automatically. A shared group submission is listed once, with a pointer
for other members, so its files are not downloaded twice. Drafts are labelled
as not submitted for grading.

Moodle web services used (all read-only):

- `mod_assign_get_assignments`: assignment ID to course module ID, and the
  team-submission flag.
- `core_group_get_activity_allowed_groups`: groups the account may filter by.
- `mod_assign_list_participants`: the roster, fetched in one call with no
  limit. Moodle rebuilds the whole roster on every call, so paging repeats that
  work. Used for group filtering and to scope student-number matches.
- `core_user_get_users_by_field` (field `idnumber`): one exact lookup for all
  requested student numbers, sent as text so leading zeros are kept. Moodle
  returns only users whose student number this account may see. Matches are
  then limited to this assignment's roster.
- `mod_assign_get_submission_status`: one student's submission, earlier
  attempts, and attachments. Used for every student the list shows, and to
  re-check each submission `fileId` before download. Calls are per student, so
  a large assignment is not fetched whole.
- `mod_assign_get_submissions` is only used to check `fileId`s minted before
  per-student checks existed. Those expire within 24 hours; re-run the list
  to get fresh IDs.

The account needs grading capability on the assignment (for example, the
Teacher or Grader role on the course). No admin credentials are used, and no
browser automation is involved. If a web service is not enabled, or the
account lacks grading access, the tool says so explicitly.

Limitations:

- Student-number lookups depend on Moodle showing `idnumber` to the account.
  If it doesn't, numbers report `unmatched`. That can't be told apart from a
  student who isn't in the assignment.
- An empty group can mean the group is hidden from the account, not that it
  has no students. The tool says so when a group returns no participants.
- The roster is capped at 5,000 entries per call. If it is hit, results say so.
- Submission `fileId`s expire after 24 hours, like course file IDs. Run the
  list again to get fresh ones.
- Online-text submissions are not rendered; only file attachments are listed.
- Team assignments show the group's latest submission only. Earlier group
  attempts are not listed yet.
- If a lookup times out, the error names the step that stalled. Raise
  `MOODLE_MCP_REQUEST_TIMEOUT_MS` (up to 120000) to allow slower Moodle
  responses. Each step's duration is logged to stderr as
  `[submissions] <step>: <ms>`.
- Live verification against STEMLearn has not been performed for this tool
  set. The Moodle function parameters above follow Moodle's documented
  web-service shapes and are covered by mocked tests only.
- After deploying, reconnect the MCP client so it picks up the new tool list.

Prompts: `summarize-course`, `whats-due`, `build-study-notes`, `exam-prep`,
and `search-notes`. Prompts that read files use the URI returned by
`moodle_list_resources` rather than constructing one.

## Operational limits

Network requests time out after 20 seconds by default; set
`MOODLE_MCP_REQUEST_TIMEOUT_MS` (1000-120000) to change it. File downloads
default to 100 MB (`MOODLE_MCP_MAX_FILE_MB`). Files over 5 MB are not embedded in
responses; the local server saves them with `moodle_save_file` into the folder
set by `MOODLE_MCP_DOWNLOAD_DIR` (default `~/Downloads/learn-mcp`). The reply
gives the name, size, and SHA-256, not the path. Listings are bounded (for
example, 25 files by default and 100 maximum) to avoid oversized MCP
responses. Rendered Moodle text is also bounded per field; oversized text and
text-file reads include a truncation notice. Binary resources over 5 MB are
not embedded into MCP responses.

The server never calls Moodle write APIs and never returns Moodle tokens,
raw file URLs, or filesystem paths.

## Development

```bash
npm test
npm run build
```
