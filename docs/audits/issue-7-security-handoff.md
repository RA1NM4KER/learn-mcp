# Issue #7 security integration — session handoff

Updated: 12 October 2026. Repository: `/Users/kefasmanda/repos/learn-mcp`.

## Objective and authorization

The user asked to implement GitHub issue #7: **Security: validate OAuth provider, account isolation and runtime boundaries end-to-end**. They then requested this handoff to continue in another Codex session because of usage limits. Stop this session after preparing the handoff. No commit or push was authorized for this task. Do not stage, commit, push, close the issue, or deploy without an explicit instruction. Follow the repository AGENTS.md.

## Current result

A new executable harness passes **50 security integration checks**, using the real repository OAuth provider, authorization/link/consent routes, MCP transport, encryption, workerd, local KV, and local D1 with actual migrations. Moodle HTTP responses are controlled fixtures: this is not a production smoke test or an interactive Microsoft/SU login test. No confirmed production defect was found; no production application source was changed.

Verified commands in this session:

- `npm run test:security`: PASS, 50 checks, including strict TypeScript compilation of the fixture worker.
- `npm run build`: PASS.
- `npm test`: PASS, 460 tests across 49 files.
- `git diff --check`: still needs running after final documentation edits.
- Production Worker deployment dry run: not run for this task yet.

Installed versions: OAuth provider 1.1.0, MCP SDK 1.30.1, Wrangler 4.141.0. No dependencies added.

## Files changed

- **Untracked** `tests/security/worker.ts`: local-only entry point importing the real provider. Replaces global outbound fetch with a strict Moodle fixture dispatcher; rejects unknown credentials/hosts/functions, records sanitized request metadata, simulates redirects, oversized file streams, stalled bodies and private upstream errors. Fixture-only control endpoints manipulate local permissions, grants and stored token expiry/audience. These endpoints are not wired into production.
- **Untracked** `tests/security/wrangler.json`: separate local fixture KV/D1 bindings and actual repository migrations. Production `wrangler.toml` untouched. Runner uses a temporary persistence directory and never applies remote migrations.
- **Untracked** `tests/security/tsconfig.json`: inherits strict repository compiler settings and typechecks fixture worker without emitting files.
- **Untracked** `tests/security/run.mjs`: allocates a free local port, applies local migrations, starts Wrangler/workerd, performs real DCR and authorization-code/S256-PKCE exchanges, drives linking and browser-bound consent, calls `/mcp`, asserts response/log redaction, and cleans up process/temp persistence. Prints only case names and safe failure messages; do not dump response/token/log objects when debugging.
- `package.json`: adds `test:security` (`tsc -p tests/security/tsconfig.json && node tests/security/run.mjs`).
- `.github/workflows/deploy.yml`: adds local real-provider security integration check before deployment dry run/deploy. This change is only local, not shipped.
- `docs/audits/learn-mcp-end-to-end-audit-2026-10.md`: **pre-existing unstaged change from the previous quiz metadata investigation**. Preserve it. It is not part of the new issue #7 harness.
- This handoff document.

## PASS evidence matrix

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

## NOT TESTED / limits to preserve in the final audit

- Interactive official SU/Microsoft login and real account linking with production credentials; fixture linking uses generated mobile connection links and verified fixture site-info.
- Production deployment, production KV/D1 consistency, real ChatGPT connector session and real upstream Moodle behavior.
- Native network redirect behavior against an actual HTTP upstream: global outbound fetch is replaced by fixture responses. Runtime code executes in workerd, but redirect refusal/host checks are exercised against the dispatcher, not a real redirecting network server. Do not claim full native network verification.
- Natural passage of access-token/file TTL or eventual KV expiry: fixture expiry is injected into local stored records; file expiry uses a negative fixture TTL. Real provider expiry validation is tested.
- Refresh-token expiry/rotation/reuse semantics beyond successful renewal, wrong-resource denial and revoked-grant denial.
- Forged/mismatched browser-binding cookies and application-specific invalid state beyond missing cookie, handle replay and client-state round-trip. OAuth client state validation belongs to the client; do not misdescribe echoed client state as server validation.
- Oversized incoming MCP JSON payloads / upstream JSON byte limits; oversized streaming files are tested.
- Browser end-user consent UX, production rate limits and denial-of-service exhaustiveness.

## Important discoveries while developing the harness

These were fixture/test expectation mistakes, not confirmed server defects:

1. The provider redirects invalid PKCE authorization requests to a **registered** callback with an OAuth error (302), instead of always returning 400. An unregistered callback must never be used and is rejected directly.
2. The real provider's `completeAuthorization` revokes previous matching grants by default. A sacrificial authorization-code-replay login must run **before** the main Alice login, otherwise the test itself revokes Alice's working grant. Reconnect invalidation is now explicitly asserted.
3. Canonical identities must be resolved through the existing alias table. Deriving an ID from the full URL produced the wrong fixture disconnect target (the minting path uses the host); the fixture now calls actual `lookupAlias`.
4. TA rendered handles use `fileId \`…\`` without the colon used by course resource rendering; the harness regex now matches that actual format.

## Next session work

1. Read AGENTS.md and this handoff; inspect `git status` and current issue #7 through `gh issue view 7` in this repo. Do not discard the earlier quiz audit doc change.
2. Review the new harness and CI step for maintainability and containment. Decide whether native HTTP boundary checks, expired refresh grant and additional malformed/oversized request tests are needed to satisfy the exact issue. Add only useful bounded checks; do not invent production bugs or modify source without reproduction.
3. Turn this evidence into a final security audit report under `docs/audits/` with PASS/FAIL/NOT TESTED and specific limitations. This handoff currently carries the result matrix, but the final report/review remains unfinished.
4. Run `npm run build`, `npm test`, `npm run test:security` if harness/source changed; run production deployment dry run if appropriate and `git diff --check` after all edits. Required checks already passed before this handoff, as recorded above.
5. Report the outcome honestly. Do not call the whole system flawless/audited based on these fixtures. No confirmed application defect in the checks so far.
6. Leave changes unstaged/uncommitted unless user explicitly asks to ship. Never change the `v0.1.0` tag. Do not close issue #7 without user authorization and satisfying its acceptance criteria.

## Resumed session update

The user asked this session to continue. Final report: `docs/audits/issue-7-security-audit-2026-10-12.md`. Build and all 460 tests passed again; production Worker dry run completed with exit 0 (default Wrangler log-file write was sandbox-denied). The current sandbox forbids localhost binding, so the final harness rerun is NOT TESTED, although the prior 50-check run passed. Runner now catches localhost startup errors, cleans up and uses explicit `--local`; strict typecheck and syntax passed. `gh issue view 7` was blocked by restricted network. Preserve these qualifications when reporting or shipping. Nothing staged, committed, pushed or deployed.

## Shipping update

The user explicitly authorized pushing. Permissions were restored and the final `npm run test:security` rerun passed all 50 checks, including the updated startup handling and explicit `--local`. The earlier sandbox limitation is historical, not the final test status. The audit report now records the successful final rerun.
