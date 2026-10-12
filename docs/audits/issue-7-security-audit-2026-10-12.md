# Issue #7: OAuth, account isolation and runtime security evidence

Date: 12 October 2026.

## Outcome

**50 executable security checks passed in local workerd, including a fresh rerun of the final runner revision after permissions were restored. No application vulnerability was reproduced by these checks.** The implementation adds a repeatable real-provider integration harness and a CI gate; it does not change production authentication, tools or file access.

This is evidence for the scenarios below, not a complete security certification. Moodle and outbound HTTP are fixture-controlled. Official login, deployed infrastructure and the live ChatGPT connector are not tested here. Keep the issue open for any acceptance criteria requiring those environments or the additional cases listed below.

## Reproduce

```sh
npm ci
npm run build
npm test
npm run test:security
git diff --check
```

`test:security` first typechecks `tests/security/worker.ts` with the repository's strict compiler settings, then runs `tests/security/run.mjs`. It needs permission to bind a localhost port and run Wrangler/workerd. It requires no production Moodle credentials, Cloudflare deployment credentials, or remote database access. The runner applies the repository migrations to temporary local D1 storage, uses local KV, and removes temporary persistence when it exits. Production `wrangler.toml` is not the fixture configuration. Do not deploy `tests/security/wrangler.json`.

The fixture entry point imports the actual repository provider and routes. Account credentials are linked using fixture mobile connection links and site-info responses; public clients register through the real provider endpoint. Authorization, browser-bound consent, code exchange, refresh, revocation and MCP requests use real HTTP endpoints on workerd. Only outbound Moodle fetches and explicitly marked test controls are fixtures. Test controls exist solely in the separate fixture worker and are never registered by production.

The CI workflow runs this suite before its existing deployment validation and deployment steps. That workflow modification is local and has not been pushed.

## Verification history

| Check | Result | Qualification |
| --- | --- | --- |
| Local real-provider/workerd harness | PASS | 50 checks in the initial unrestricted session |
| Strict fixture TypeScript compilation | PASS | Passed again in the resumed restricted session |
| Production TypeScript build | PASS | Passed again in the resumed restricted session |
| Existing tests | PASS | 460 tests, 49 files; passed again in the resumed restricted session |
| Production Worker deployment dry run | PASS | Bundle completed, exit 0; sandbox refused Wrangler's default external log-file write. No deployment occurred |
| Intermediate harness rerun under restricted permissions | NOT TESTED | Local listener refused with `listen EPERM`; no integration assertions executed |
| Final harness rerun after permissions restored | PASS | All 50 checks passed with startup error handling and explicit `--local` |
| Runner startup failure handling | PASS | Permission failure now exits cleanly with a concise failure and cleans temporary persistence |
| GitHub issue refresh | NOT TESTED | Restricted network could not reach api.github.com; requirements were retained from the earlier issue read |

After the successful 50-check run, only the runner's startup error handling and explicit `--local` flag were changed. The scenario assertions and fixture worker were unchanged. Syntax and TypeScript checks passed; a subsequent runtime rerun of that final runner revision passed all 50 checks after permissions were restored.

Installed versions used: `@cloudflare/workers-oauth-provider` 1.1.0, MCP SDK 1.30.1, Wrangler 4.141.0. Compatibility date and flags match the fixture configuration. No dependencies added.

## Scenario matrix


All rows below passed in the final harness run. Some rows group multiple executable checks; the runner prints the individual 50 labels.

| Area | Result | Evidence |
| --- | --- | --- |
| Real provider + transport | PASS | Discovery, public-client DCR, successful genuine PKCE token exchange and authenticated MCP initialize |
| Unauthorized access | PASS | Missing/invalid bearer returns 401 |
| PKCE | PASS | Missing challenge, plain method, missing verifier and wrong verifier rejected |
| Redirects | PASS | Unregistered authorization redirect rejected; token-exchange redirect mismatch rejected |
| Client state / consent | PASS | Client state echoed unchanged; missing browser-binding cookie rejected; used consent handle rejected |
| Resource/audience | PASS | Wrong resource at code exchange and refresh rejected; stored token with wrong audience rejected at MCP |
| Code replay | PASS | Reused authorization code rejected and its issued access token invalidated |
| Cross-user/site isolation | PASS | Alice sees her STEM and EMS courses; Bob sees only his own; Bob cannot use Alice's secondary-site course reference |
| Legacy lane | PASS | Static bearer resolves Legacy identity only; disconnected OAuth Bob cannot fall back to legacy/env credential |
| Token lifecycle | PASS | Refresh works; disconnect denies MCP; reconnect restores Bob and invalidates older grant; actual provider grant revocation denies access and refresh; stored expired access token denied |
| Course files | PASS | Own file and secondary-site file accessible; another account, tampered/malformed/expired handles denied; current course permission revocation denies existing handle |
| File allowlist | PASS | Foreign host, wrong protocol and pluginfile path-prefix spoof denied |
| Grader constraints | PASS | Unconstrained lookup denied; upstream grading permission denial enforced; disallowed group denied; exact student number cannot escape visible roster |
| Submission files | PASS | Authorized TA retrieves sealed attachment; another account denied; revoked upstream submission permission denies existing handle |
| Redirect protection | PASS | Credential-bearing API and file redirect fixture responses refused; dispatcher rejects unknown destinations |
| Runtime bounds | PASS | Streaming oversized file rejected; stalled JSON body hits deadline; active file transfer cancellation works; malformed JSON returns parse error |
| Redaction | PASS | Authenticated authored file links hidden; private upstream error sanitized; responses and captured runtime logs checked against fixture/issued credentials and authenticated URLs |
| Read-only boundary | PASS | Sanitized outbound ledger contains only explicitly approved read functions/file hosts |

## Remaining coverage and limitations


- Interactive official SU/Microsoft login and real account linking with production credentials; fixture linking uses generated mobile connection links and verified fixture site-info.
- Production deployment, production KV/D1 consistency, real ChatGPT connector session and real upstream Moodle behavior.
- Native network redirect behavior against an actual HTTP upstream: global outbound fetch is replaced by fixture responses. Runtime code executes in workerd, but redirect refusal/host checks are exercised against the dispatcher, not a real redirecting network server. Do not claim full native network verification.
- Natural passage of access-token/file TTL or eventual KV expiry: fixture expiry is injected into local stored records; file expiry uses a negative fixture TTL. Real provider expiry validation is tested.
- Refresh-token expiry/rotation/reuse semantics beyond successful renewal, wrong-resource denial and revoked-grant denial.
- Forged/mismatched browser-binding cookies and application-specific invalid state beyond missing cookie, handle replay and client-state round-trip. OAuth client state validation belongs to the client; do not misdescribe echoed client state as server validation.
- Oversized incoming MCP JSON payloads / upstream JSON byte limits; oversized streaming files are tested.
- Browser end-user consent UX, production rate limits and denial-of-service exhaustiveness.


## Assessment

There are no FAIL findings from the completed scenario run. An intermediate rerun was blocked by the execution environment; the final rerun passed after permissions were restored. A failed CI invocation must still block deployment rather than silently skipping the harness.

Token expiry and audience negatives mutate local fixture records to exercise the real provider's checks. Revocation uses the real provider helper. Disconnect deletes only a fixture credential. Reconnect goes through the genuine authorization/link/consent routes and demonstrates the provider's default superseded-grant revocation. No production data is altered.

Client `state` is round-tripped and asserted unchanged; this does not demonstrate validation of a client's own expected state. Browser binding is separately checked with missing consent cookie and used-handle denial. Additional forged-cookie cases remain untested.

Redirect fixtures confirm the application's manual-redirect policy and refusal of redirect responses, with a dispatcher that fails closed on unknown destinations. They cannot establish native network credential forwarding behavior by themselves. Streaming body oversize, stalled reads and cancellation do execute under workerd.

The output/log checks scan the tested responses and captured runtime logs for known fixture Moodle credentials, issued successful-login credentials and authenticated Moodle URLs. They do not prove absence of every possible sensitive string across every code path.

No source fix was needed for the passing scenarios. Remaining coverage should be expanded using fixtures or authorized live checks rather than weakening authentication, guessing at a vulnerability, or declaring the whole system flawless.
