# Learn MCP end-to-end audit — 12 October 2026

Scope: [issue #6](https://github.com/RA1NM4KER/learn-mcp/issues/6). This is a source review, fixture-based regression audit, and a live student workflow check, not a penetration-test certification. No Moodle writes were performed. Student names, marks, tokens, file handles and authenticated URLs are excluded from this report.

## Assessment

Confidence is high for the specific PDF, page-media, grading-source and account-routing cases exercised below; moderate for the wider product. Passing fixtures do not prove universal Moodle/client compatibility. The changes in this audit are local until separately committed and deployed. Live connected-tool checks exercised the previously deployed server, not these new local fixes.

The architecture remains config/auth → Moodle transport → Zod boundary validation → loaders → tools/resources → MCP rendering. Both transports register through `createSunLearnServer`. Local filesystem saving is the intentional transport difference. File handles are sealed, user/site-bound and expiring; retrieval rechecks current upstream access. OAuth users and the legacy fixed identity use distinct credential resolvers.

## Status and incident ownership

| Status | Case | Evidence and practical limit |
| --- | --- | --- |
| Verified fixed locally | Secondary-site file resource reads | `resources.test.ts`: secondary handle reads using its owning site's token; removing the current attachment denies a subsequent read. Tools already routed correctly; resources did not. |
| Verified fixed locally | Absent assignment status incorrectly displayed as unsubmitted/ungraded | `assignments.test.ts`: missing fields now say unknown; explicit assignment API status stays separate from gradebook release. |
| Verified fixed locally | Authenticated file-link text leakage | `text.test.ts`: single/unquoted hrefs, numeric HTML entities, plain URLs and fragment URLs are hidden; ordinary external links remain actionable. PDF text uses the same redaction helper. |
| Verified fixed locally | API/login deadline ended at response headers | `moodle-client.test.ts`: a stalled JSON body for either auth lane aborts with a safe timeout. Credential-bearing API/login/file requests now refuse redirects. |
| Verified fixed locally | File-path prefix accepted and already-cancelled download started | `moodle-client.test.ts`: `pluginfile.php.evil` is refused; pre-aborted transfer is refused before fetching. |
| Verified fixed locally | Brief omitted single-site notifications and failed wholesale when calendar failed | `brief-partial.test.ts`: notifications read in single-site mode; available sections survive failure with explicit coverage warning and no upstream-error disclosure. |
| Verified fixed locally | Unsupported assignment API implied no enrollment | `brief-partial.test.ts`: actual enrollment is retained; unavailable assignment API is reported. |
| Verified fixed locally | Calendar cap silently omitted returned events | `calendar.test.ts`: 103 returned events yield 100 displayed and an explicit 3-event omission notice. |
| Verified working | AM364 referenced versus stored images | Live `moodle_get_page(139738)` labels two images referenced and five attachments unreferenced. Both referenced images downloaded as native MCP image blocks and visually read. |
| Verified working | SS244 Practical 3 PDF | Live connector returns text/resource/text: 325,345 original bytes plus both numbered pages, questions 1–7 and demo tasks; explicit diagram/equation caveat. Live local SDK/stdio `moodle_read_file` also reads both pages. |
| Verified working with fixture scope | #4 grade-source reconciliation | `composed.test.ts` covers visible gradebook marks despite assignment `notgraded`, zero grades, hidden marks and unmatched items. Missing grade data remains unknown. |
| Model-side | Assistant previously inspected only the weekly timetable | Academic image shows TT10 on 15 October. Skipping it is not retrieval failure. Tool output cannot force exhaustive model inspection. |
| Model-side | Week 11 practical chronology | Live SS244 notices contain the beginning-of-practical wording. A summary calling it a continuation contradicts accessible evidence. |
| Upstream | Practical 3 deadline disagreement | Live PDF says 22 October 2026, 23:59; live course notice says 23 October. Preserve both with their source; lecturer clarification is needed for a definitive deadline. |
| Untested | Fresh ChatGPT interactive conversation after local fixes | This audit has connector calls and visual inspection in Codex, plus the supplied ChatGPT incident record. It does not claim a new ChatGPT UI conversation or universal host support. |
| Untested | Fresh real OAuth login, token refresh, PKCE and audience attack cases | Resolver fixtures and code review cover identity isolation, but they are not a substitute for exercising the actual provider library/browser/token exchange. See gaps below. |
| Untested | Live TA access | No TA identity was used; fixture tests cover the constrained workflow. |

## Findings and reproduction

Severity here describes potential impact, not an observed compromise.

1. **High — MCP rendering: authenticated URL disclosure.** Before this change, `stripHtml` handled only double-quoted anchors. A single-quoted anchor whose label was its token-bearing file URL survived stripping, as did bare file URLs. Reproduce with the string fixtures in `tests/text.test.ts`; no real secret is required. Fix: parse supported href quoting, decode named/numeric entities, remove script/style bodies, hide pluginfile links in labels/plain text, retain useful external hrefs. Verified by rendered-string assertions. This is targeted sanitization, not a general browser HTML parser; unusual malformed markup and arbitrary encodings are not exhaustively covered.
2. **Medium — MCP resources: multi-site ownership mismatch.** A handle sealed by a secondary site's client could be downloaded by the tool but not read through its advertised resource URI. Fix: resource reads use the same owner resolution helper as download/read tools, then reauthorize normally. Regression verifies the actual resource callback, correct host/token and revoked attachment denial. Resource enumeration remains a bounded anchor-site catalogue; secondary files are discoverable through course tools.
3. **Medium — MCP semantics: missing data treated as a negative result.** `getAssignment` rendered absent `graded` as “No” and absent submission as “Not submitted”. Fix: unknown fields remain unknown, grading source is explicit, and the output directs users to course grades for separately recorded marks. No extra gradebook scan or API change.
4. **Medium — transport: stalled bodies exceeded request deadline.** The old timer cleared after `fetch` resolved, before `json`/login body consumption. Fixture responses return headers immediately and stall until aborted. Fix: one timer covers fetch and JSON reading for login and API requests; errors stay typed and generic. File downloads already bounded body consumption; early cancellation now also works.
5. **High defense-in-depth — transport credential forwarding.** Default redirect following on token/password-bearing requests permits an upstream redirect to choose another destination. Source-confirmed risk; no live malicious redirect was attempted. Fix: `redirect: "manual"` with non-success response rejection on API/login and both file-fetch paths. Regression asserts API/login policy, existing file-transfer tests exercise fetching. Compatibility tradeoff: installations requiring redirects must use the correct canonical origin rather than forwarding credentials. No production exploit is asserted.
6. **Low — file authorization path precision.** Substring matching accepted lookalike endpoints. Fix: require a complete `pluginfile.php` path segment. Same host/protocol checks remain; no arbitrary URL capability is introduced.
7. **Medium — composed workflow reliability.** Single-site briefs deliberately substituted “Notifications unavailable” without calling the available API, and a calendar failure rejected all sections. Fix: call the single-site API, settle the three independent sections, retain available content and explicitly report failed coverage. The assignment-list unsupported case now retains enrollment instead of claiming no courses.
8. **Low — output completeness.** Calendar sliced a merged collection without reporting omissions. Fix: retain the returned collection count and report omitted events. This count does not represent unseen upstream pages.

## Every-tool audit matrix

All tools are registered through `readOnlyTool` with read-only annotations; schemas are Zod-based. Course/subresource references dispatch through the resolver; metadata does not enable file retrieval when content is disabled. Collections and final text are bounded, but the remaining completeness gaps listed below prevent describing every listing as exhaustive. “Fixture” means existing tests were inspected and rerun, not a live role/API test.

| Tool | Contract / output checked | Evidence / remaining scope |
| --- | --- | --- |
| `moodle_list_courses` | Account-wide sites, usable opaque course references, current/historical distinctions, partial site failures | Live connector and multi-site/courses fixtures; no all-site live outage experiment |
| `moodle_get_course` | Sections/modules/descriptions, page module IDs, bounded text | Courses/global cap fixtures; links sanitized centrally |
| `moodle_get_course_notices` | Section notices, week/date classifications and conflicting-date warning | Live SS244 chronology and date; courses fixtures; preview completeness remains limited |
| `moodle_get_page` | Enrolled-course/module checks, text/tables/alt text, ordered media and referenced labels | Live AM364 plus pages fixtures: both current images and unrelated stored media distinguished |
| `moodle_list_resources` | Filename filter/limit, resource URI plus opaque handle, external link names | Live Practical 3, files/file-access/multi-site fixtures; refine filter after capped output |
| `moodle_download_file` | Reauthorization, native images, original PDF and text preview, MIME/byte cap/errors | Live both referenced images and PDF; file-transfer/read-file fixtures; host consumption varies |
| `moodle_read_file` | PDF MIME checks, start/page count bounds, pagination, low-text warning, no OCR | Live SDK/stdio; read-file/pdf-text/pdf-timeout fixtures |
| `moodle_save_file` | Local only, safe name, bounded stream, checksum, no full path in output | File-transfer fixtures; concurrent destination collision review remains deferred |
| `moodle_list_assignments` | Module `cmid` matching, dates, max grade, opaque assignment references, cap | Assignments/global-output fixtures; metadata does not establish submission/grade status |
| `moodle_get_assignment` | Own submission/feedback, explicit assignment API grading source | New absent/released-source regressions; no assertion that separate gradebook is empty |
| `moodle_list_assignment_groups` | Authorized grader context, selectable group identifiers | Submissions fixtures; live TA untested; group omission reporting deferred |
| `moodle_list_assignment_submissions` | Constrained group/student lookup, shared units, attempts, opaque attachments | Submissions and file-access fixtures; denies broad unconstrained lookup and unauthorized file access |
| `moodle_get_grades` | Gradebook items, display/feedback, bounded output | Live SS244 and grades fixtures; grading visibility/source tests in composed suite |
| `moodle_get_calendar_events` | Action plus plain entries, assignment/quiz sources, date bounds, merges and caps | Calendar fixtures plus new omission-count regression; source failure currently can fail this primitive |
| `moodle_list_quizzes` | Course quizzes and open/close metadata | Quizzes/global-output fixtures; no live attempt added |
| `moodle_get_quiz_attempts` | Own attempts, grade/state | Quizzes fixtures; no start/submit attempt capability |
| `moodle_list_forums` | Course forums and usable references | Forums/multi-site fixtures |
| `moodle_get_forum_discussions` | Bounded posts/HTML/link output | Forums/global-output fixtures; not a complete forum archive |
| `moodle_get_notifications` | Boolean WS encoding, recent previews and account-wide aggregation | Notifications/multi-site fixtures; upstream pagination/omission reporting gaps below |
| `moodle_get_site_info` | User/site/API availability metadata | Client fixtures/source review; advertised calendar availability only checks one API path |
| `course_overview` | Course details, notices, assignments, recent announcements | Composed/multi-site fixtures; bounded preview, not complete syllabus/schedule |
| `upcoming_and_overdue` | Submission-aware timing, historical shells, gradebook reconciliation, partial sites | Composed fixtures; new unsupported API regression; grade failure means unknown |
| `student_brief` | Deadline triage, calendar closures, ranked notification previews | Composed plus new partial failure/single-site fixture; ranking is a text heuristic, not proof of current urgency |

Resources: `moodle://files/{fileId}` uses the same authorization model; text is bounded and binaries capped. Owner routing now handles secondary sites. Enumeration has a deterministic global cap and does not claim a complete file archive. Prompts (`summarize-course`, `whats-due`, `build-study-notes`, `exam-prep`, `search-notes`) are registered once; their success still depends on the caller reading all relevant evidence.

## Security, transport and operational coverage

| Boundary | Evidence | Limit |
| --- | --- | --- |
| Opaque handles: integrity, expiry, user/site binding | file-access, global-ref, course-ref-resolver and multi-site tests | No cryptographic implementation certification |
| Current course/file and TA submission access | file-access/pages/submissions tests; revoked-secondary-resource regression | Moodle's permissions remain the authority; no live TA role |
| Trusted credential destinations, OAuth no legacy/env fallback | linking resolve-config, credential-store/crypto, canonical-identity and mcp-handler tests | Never use stored base URL as decrypted-token destination; configured/registry hosts only |
| Colon-free canonical identity | oauth identity/canonical-identity tests | Required by provider token encoding; retained unchanged |
| Legacy auth versus OAuth identity | legacy-routes and mcp-handler tests, provider source review | Handler tests inject authenticated context; they do not prove provider protocol validation |
| OAuth PKCE/redirect/audience enforcement | Existing provider configuration and library boundary reviewed; unchanged | Full provider-driven negative tests remain untested; do not claim all boundaries covered |
| Moodle write prohibition | Loaders/wsfunctions and exposed surface reviewed; tool annotations rerun | No write endpoint added or executed; OAuth/account-linking storage is separate from Moodle |
| Safe errors, invalid API data, timeout/byte bounds | moodle-api/client/file-transfer/pdf-timeout tests | API JSON parsing has a time cap but no explicit byte cap; large-body amplification remains a gap |
| stdio/Worker registration parity | create-server regression compares sets with local save as sole exception; Worker bundle dry-run | Registration parity is not identical host rendering |
| MCP serialization/client usability | Real SDK stdio calls; real connected MCP image/PDF content blocks | No separate fresh ChatGPT UI or Claude/Desktop trial |
| Deployment | CI: npm ci, build, tests, Worker dry-run, deploy; dry-run succeeds locally | CI currently triggers on main push/manual dispatch, not PRs; no production deploy for this audit |
| Performance/staleness | Bounded collection fan-out, sequential resource enumeration and extraction caps reviewed | No load test, 429/backoff experiment, or retry feature added; reads recheck permissions, course evidence may itself be stale |

## Deferred findings and untested acceptance items

These remain explicit follow-up work rather than being concealed by a passing suite:

- **Medium, source-review finding: local concurrent save collision.** `freeName` checks before `rename`; concurrent saves can choose the same destination and overwrite. Existing sequential collision fixtures do not exercise this race. Defer pending a deterministic concurrency reproduction and atomic no-overwrite publication test; avoid claiming safe parallel saves.
- **Low, confirmed preview limits:** course notices slice their raw collection, TA group listing relies on final text truncation, and notifications trust upstream limit/omit counts in some aggregate paths. Calendar is fixed here; broader omission/pagination consistency needs focused changes and regression fixtures. Current output should be treated as bounded previews. Resource enumeration cannot expose a text omission notice through its current list callback.
- **Low:** site-info calendar capability checks only action-calendar support, although other APIs supply useful events. Tool discovery itself is authoritative; availability summary needs a focused fixture.
- **Medium:** `student_brief` calendar filtering and notification ranking can discard source coverage notes or treat old cancellation language as urgent. New section failures are explicit, but semantic relevance and partial notices still require a more careful fixture set. No speculative NLP replacement added.
- **Medium:** JSON responses lack an explicit byte cap; page extraction caps text but may still consume large parser streams. Test body size/cancellation under the actual runtimes before adding new transport limits.
- **Untested security acceptance:** run real provider integration tests for missing/wrong PKCE verifier, unregistered redirect URI, wrong resource/audience, refresh/revocation and unauthenticated `/mcp`. Existing identity/resolver tests cannot stand in for these. Interactive SU/Microsoft login and destructive revocation were not performed in this student read-only audit.
- **Untested operational acceptance:** upstream 429, retry safety, sustained concurrency/load, scanned handwritten mathematics, encrypted real PDFs, live TA identity, and fresh ChatGPT UI behavior after these local fixes. Fixture malformed/low-text/timeout cases are covered; no OCR or automatic circuit interpretation is promised.

Accordingly, issue #6's “all security/authorization boundaries covered” acceptance item is **not fully satisfied**. The report and targeted fixes are delivered, but the issue should remain open for the provider integration coverage and deferred items. No follow-up issues were created without instruction.

## Verification log

- Baseline: `npm run build`; `npm test` — 47 files, 435 tests passed.
- Focused regressions: text, assignments, Moodle client, resources, PDF extraction, calendar, server registration and partial brief suites passed.
- Live connected MCP: course list → AM364 Page 139738 → both referenced image downloads → visual reading; Practical 3 listing → PDF download → both text pages plus original resource. Stored unrelated attachments were also inspected but are not treated as current page evidence.
- Independent real SDK stdio client: initialized built `dist/server.js`, discovered 23 tools (including read/page/local save), read SS244 notices/grades/resources and both Practical 3 pages. Responses successful; beginning notice, 23 October notice date, 22 October PDF date, question 7 and demo task 2 checked without logging private data.
- `npx wrangler deploy --dry-run --minify` succeeded; approximately 2,292 KiB bundle / 697 KiB gzip. No production deployment performed.
- Final `npm run build` passed; `npm test` passed **48 files / 451 tests**; `git diff --check` passed.

Previous issues: #3 page media and #5 PDF regression suites pass; #4 grade-source cases pass; #1 file authorization remains covered by file-access/transfer suites. #2 public-directory submission is separate from this audit and unchanged.


## Post-deployment regression — Cloudflare redirect mode

The first audit deployment (`f617e24`) broke remote calls: course listing, student brief and page retrieval all reproduced connector internal errors, with matching Worker HTTP 502 responses. The audit's `redirect: "error"` protection was valid in Node but unsupported in Workers. A real local workerd probe against the public Moodle origin returned 200 with `manual`, while `error` threw “Invalid redirect value”. This is a confirmed server/runtime regression introduced by the audit, not a ChatGPT session problem.

Correction: use Workers-supported `manual`; existing non-success response checks refuse redirects without sending credentials to their destinations. Regression asserts supported mode and refusal of a 307 response with no second request. The initial build, Node tests and bundle dry-run did not detect this runtime incompatibility. Worker-runtime and live connected smoke checks are necessary before declaring the remote deployment healthy.


## Student experience follow-up

After the redirect fix, the user reported a successful fresh ChatGPT test of
seven operations, including both timetable images and the Practical 3 PDF.
Follow-up work adds optional selected-course briefs, a seven-day notification
window, bounded full notice text, and explicit PDF/assignment deadline checks.
Live SDK stdio verification with the real SS244/AM364 courses returned a focused
brief without Biochemistry or September announcements, prominently flagged the
Practical 3 PDF/assignment date conflict, and retrieved 13,248 characters of full
SS244 notices. PDF checks require caller-selected document pairs and cover only
two text pages and supported full English dates; they do not infer universal
agreement. Regression fixtures cover recency, omission notes, selected overdue
work, full-text recovery, date agreement/conflict, session-date exclusion and
mismatched assignment/file authorization.

The same focused brief, real PDF conflict and full-notice retrieval were also
verified in a local workerd runtime with production compatibility flags: HTTP
200, conflict detected, focused course output and 13,248 notice characters.
This runtime check complements Node tests and the bundle dry-run; it does not
substitute for a fresh ChatGPT tool-schema refresh.

## Biochemistry Tutorial Test 4 availability investigation

Live read-only checks on 12 October 2026 reproduce an upstream discrepancy:

| Source | Observed value (Africa/Johannesburg) |
| --- | --- |
| Quiz API `timeopen` | 5 October 2026, 09:00 |
| Quiz API `timeclose` | 12 October 2026, 17:00 (Unix 1791817200) |
| Plain calendar close event `timestart` | 12 October 2026, 17:00 (same Unix timestamp) |
| Plain calendar description | “Available from Monday 5 October until Friday 9 October 17:00.” |
| Course-module description | Same 5–9 October availability statement, also repeated in Afrikaans |
| Action-calendar response for the inspected window | No matching event; this does not prove the quiz is unavailable |

Method: connected tools course listing → quiz listing and course-filtered
calendar → student brief; independently, the local authorized Moodle client used
validated loaders for quizzes, plain/action calendar and course contents. Raw
URLs, credentials and student identifiers were not recorded. No attempt was
started, submitted or modified.

The actual calendar and brief both retain the configured 12 October close time
and the descriptive 9 October cutoff. The server has not transformed the text's
9 October date into 12 October. This is **verified upstream disagreement**, not a
confirmed date-conversion/merge defect. An extended quiz close time with an
unchanged description is plausible but unverified. Access rules, user/group
overrides and actual attempt availability were not independently checked.

The label `quiz (authoritative)` identifies the structured quiz settings source;
it must not be interpreted as proof that every student may currently attempt
the quiz, or that the lecturer's intended deadline was changed. An assistant
should present both dates with their source and recommend checking the quiz
page or lecturer before drawing an availability conclusion. No date was chosen
or overwritten, and no application code was changed for this investigation.
