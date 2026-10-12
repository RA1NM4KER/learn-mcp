# Issue #8: MCP client and transport compatibility

12 October 2026. Tested production code at `fac90cf` plus the local, uncommitted compatibility harness. No production application source changed. This report distinguishes automated protocol evidence from model/client observations. It is not universal MCP compatibility certification.

## Supported/tested matrix

| Client and version | Transport / authentication | Result | Tested scope |
| --- | --- | --- | --- |
| MCP SDK 1.30.1; Node 22.22.1 | Actual `dist/server.js`, stdio; isolated fixture Moodle token | PASS | Initialization, 22 shared tools plus local save, schemas/annotations, prompts, resource templates, course/text/image/PDF delivery, resource byte fidelity, malformed arguments and handles |
| MCP SDK 1.30.1; Wrangler 4.141.0 workerd | Actual repository `/mcp`, Streamable HTTP; real provider 1.1.0 authorization-code/S256 PKCE using local KV/D1 and fixture Moodle identity | PASS | Same shared surface and content checks; fresh transport reinitialization/schema discovery; existing 50 security/runtime checks also run |
| Claude Code 2.1.296; Claude Sonnet 5 | Live stdio Learn MCP; trusted local process, no client-to-server OAuth/bearer | PASS | Actual student tools, both timetable images visually readable, PDF original/text delivery, page-range reader, calendar, grades, document conflict checks and invalid handle |
| Current Codex connected SUNLearn MCP, host build not exposed | Managed app connection to deployed service; connector manages authentication, exact credential lane not independently inspected | PASS with schema limitation | Live courses, brief, course content/notices, resources, page, both image downloads/visual inspection, PDF byte/text delivery, grades, filtered calendar and invalid handle |
| Fresh interactive ChatGPT conversation, client version unreported | User-reported live connected session; authentication managed by connector | USER-REPORTED PASS with schema limitation | User supplied ChatGPT results: course listing and student brief passed; reader, brief options and full-text notices absent; download description outdated. Not independently observed by Codex |
| Claude Desktop / other client versions | Not available in this test | NOT TESTED | No claim of coverage based on Claude Code or SDK results |

Claude's upstream Moodle credential source was not inspected: an empty client-config env block does not prove the absence of server token-file or inherited environment credentials. Transport classification comes from its safe local configuration inspection; no config, secret, authenticated file URL or private student artifact is included here.

## Reproduce automated checks

Use Node 22 (the CI version), install dependencies, then:

```sh
npm run test:compatibility
npm test
git diff --check
```

The compatibility command builds production TypeScript, typechecks the isolated Worker, runs the security fixture lifecycle and connects real SDK clients to stdio and Streamable HTTP. There is no fake MCP transport or parser. The stdio preload intercepts only outbound Moodle fetches and refuses unknown hosts, tokens, functions and redirect policies. The separate Worker fixture similarly supplies controlled Moodle responses. Neither fixture contacts production Moodle or writes academic data.

Synthetic PNG/PDF fixtures contain no student material. Image and PDF base64 bytes are checked against delivered native image blocks, embedded resources and resource reads. PDF checks cover extracted page numbers, second-page selection and visual-verification warnings. Local `moodle_save_file` discovery is checked; actual disk saving is not performed.

The CI workflow adds this command before deployment validation. Those edits remain local until explicitly shipped. Existing security CI coverage remains enabled. Local tests do not establish that a future deployment's connector metadata has refreshed.

## Automated results

The final run passes **23 compatibility checks**, alongside **50 security integration checks**:

- Actual stdio and workerd HTTP initialization and server identity parity.
- 22 shared tool names, input JSON schemas and annotations match exactly. Stdio alone exposes `moodle_save_file` (23 total). Download descriptions intentionally differ to mention local saving; identical descriptions are not required.
- Prompt discovery and prompt retrieval match; resource-template discovery matches.
- Both lanes: course listing, sealed text download, resource listing and URI reads.
- Both lanes: PNG native image MIME/base64 and resource bytes match; PDF original bytes, embedded resource MIME, page-numbered text, second-page read and warning match.
- Both lanes: invalid sealed handles return tool errors; malformed tool arguments are rejected; repeated discovery is stable.
- Fresh HTTP client/transport reconnect initializes and discovers the same schemas with the existing valid fixture token.
- Stdio diagnostic capture contains neither the fixture credential nor authenticated file URLs.

Security lifecycle negatives, oversized file streams, stalled JSON bodies, cancellation, redirect refusal and malformed RPC checks are reused from issue #7. They use workerd fixture responses, not a native upstream redirect network server. No production reconnect, credential revocation or reauthorization was performed.

## Real student scenarios

Claude Code was prompted in the user's existing Learn MCP pane through Herdr, after verifying the caller was running inside Herdr. It was instructed to use connected tools, avoid academic/account mutations and report only sanitized evidence. This is a real second client; the report below attributes its model-visibility observations rather than pretending they were inspected by Codex itself.

| Scenario | Codex connected client | Claude Code |
| --- | --- | --- |
| Courses | PASS, eight enrolled modules | PASS, same eight modules |
| Account-wide brief | PASS; all courses retained; recent notifications and omission count | PASS; document-specific conflict options also available |
| AM364 Page 139738 | PASS; two referenced images and five other stored attachments | PASS; same distinction; initial count of four corrected to five on follow-up |
| Both referenced timetable images | PASS; native pixels displayed and visually readable | PASS; Claude reported reading both grids/row text |
| SS244 practical PDF | PASS; original embedded PDF plus two pages of text, seven questions and two demo tasks | PASS; download plus separate `moodle_read_file` page text |
| PDF visual warning | PASS; warns diagrams/circuits/formatting not visually verified | PASS; same warning; diagrams not visually checked |
| Practical date disagreement | PASS; PDF body says 22 October while notices/brief say 23 October | PASS; brief with supplied document explicitly reports both source dates |
| Grade reconciliation | PASS; released gradebook mark retained despite assignment API `notgraded`; unknown mark preserved | PASS; gradebook and student workflow calls succeeded |
| Course-filtered calendar | PASS; SS244 assignment event/source tags | PASS; SS244 calendar returned matching event |
| Notifications/bounds | PASS; last-seven-day label, omitted count; notices visibly marked as truncated | PASS; excerpt/resource limits reported; full-text option observed but not exercised |
| Invalid file handle | PASS; generic tool error, no upstream detail | PASS; same denial observed |

The earlier Codex media checks and the new course/brief/grades/calendar/negative checks were performed against the connected deployed service in this same conversation. They are distinct from synthetic SDK media tests. Failed preliminary calls without the required connector `link_id` were caller argument errors, corrected before the authenticated smoke tests; they are not counted as passing server calls or server outages.

The timetable's tutorial row is readable. PDF extraction is enough to inspect questions and textual dates; it is not enough to describe the circuit drawing. Neither model's PDF diagram fidelity is marked PASS.

The quiz metadata disagreement described in the earlier audit persists as upstream inconsistency: structured closure and descriptive availability differ. It is not a new transport/client compatibility defect. No client should infer agreement or actual attempt eligibility from those dates alone.

## Confirmed client difference

**The current Codex app wrapper exposes 21 tools, whereas the server SDK surface exposes 22 remote tools.** `moodle_read_file` is absent. Its `student_brief` schema exposes only account selection, so course/document options cannot be called through the advertised contract. Its notices schema does not expose `fullText`. Its download description still describes binary embedding rather than the current native-image/PDF-text behavior, despite actual live downloads returning the updated blocks.

Claude Code exposes and used the page-range reader and brief document option. The server implementations and fixture SDK schemas therefore support these features. This is a confirmed connector-schema difference, not a reproduced server registration defect. The reason (cache, saved import, release metadata or another client integration layer) remains unconfirmed. Refresh/reimport the client schema through the normal connector UI and compare discovery before declaring this resolved; do not change or rename server tools to compensate blindly.

Resource URIs and byte fidelity are proven with SDK clients. Client UI willingness to render arbitrary `moodle://` links and user interaction with every embedded binary format are not inferred from that.

## Deployment and remaining limits

Production commit `fac90cf` had a successful GitHub CI/deploy run (38248836182), separately verified before this work. Authenticated deployed connector calls worked after the local test changes; since only fixtures, scripts, CI and documentation changed, production application behavior remained the shipped version. New compatibility code has not been deployed or its new CI step run remotely.

Direct shell probes to the custom domain were denied by Cloudflare browser-signature rule 1010 (403). The connected MCP calls succeeded. This is an access-path difference; it does not prove the Worker is down or that the firewall should be weakened. No direct authenticated native HTTP smoke test is claimed.

Other NOT TESTED areas: fresh interactive ChatGPT OAuth UX/reconsent and metadata refresh; real connector reauthorization; natural session/token expiry; large-file save-to-disk; exhaustive host/UI display thresholds; live partial-result injection; scanned-PDF OCR; native network redirect credential-forwarding behavior; additional clients and versions. Existing bounded-output/partial-result unit tests and fixture security checks provide narrower evidence, not these real-client results.

## Verification and classification

Production build, strict fixture compilation, all 460 existing tests (49 files), and `git diff --check` pass. No confirmed application defect was reproduced, so no production source fix was made. The tests and report are ready for review, not committed or pushed under this task's authorization.

Classification: server/protocol parity PASS; media content delivery PASS for tested clients; Codex advertised metadata has a client-integration limitation; upstream date conflict retained; fresh ChatGPT interaction blocked/unverified; universal compatibility NOT TESTED.

## ChatGPT follow-up supplied by the user

After the initial report, the user supplied a fresh ChatGPT compatibility review. It reports two successful authenticated calls (`moodle_list_courses`, `student_brief`) and the same advertised schema omissions observed directly in Codex: missing `moodle_read_file`, missing brief course/document parameters, missing notices `fullText`, and an outdated download description. These are user-supplied client observations; they do not add independently executed checks to the automated counts or establish fresh ChatGPT image/PDF coverage.

This narrows the remaining issue to schema synchronization across the managed connections. Normal student access works in the reported ChatGPT session. Server API changes are not justified by the schema mismatch alone. Next steps: ship the harness/report when explicitly authorized, verify the new CI step, then refresh/reimport the plugin schema through the normal client/plugin management flow and compare tool count, parameters and descriptions. A refresh/reconnect has not yet been performed or verified. If the mismatch persists, investigate plugin-import/release/cache behavior. Do not close #8 based solely on the passing calls.
