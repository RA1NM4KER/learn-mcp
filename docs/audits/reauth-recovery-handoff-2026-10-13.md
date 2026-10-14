# Reauthorization recovery investigation

## Problem

Multiple authenticated Learn MCP calls failed with generic internal errors. Live Worker tail confirmed requests reached `/mcp` and returned HTTP 502. A separate local Moodle credential was rejected as invalid or expired. Normal reauthorization reportedly did not recover access; deleting account data and linking again did.

The original remote Moodle rejection cause is not proven. In particular, rejection is not evidence of token expiration. No incident credential should be deleted or exposed to investigate this.

## Confirmed recovery and diagnostic gaps

- The OAuth linking page treats stored credentials as connected, even without checking their current validity.
- Saved sites have no reconnect action, and their replacement dialogs are omitted. Starting another authorization and linking a different site can therefore retain the old credential.
- Every MCP request authenticates the earliest-linked site's credential before dispatching any tool. A rejected anchor credential blocks the connection even if another site is healthy. Automatically changing the anchor would change numeric-reference semantics and should not be done casually.
- Bootstrap failures are reduced to generic HTTP 502 responses without safe stage diagnostics. Clients may show only internal errors.

The credential-store upsert itself works: controlled tests demonstrate replacement without account deletion. These findings explain a plausible recovery failure, not the exact historical sequence.

## Fix prepared locally

Implementation prepared for shipping on 14 October 2026:

- Render connect/reconnect dialogs for every OAuth site and offer **Reconnect** on saved sites.
- Label persisted credentials **Saved**, avoiding an unverified health claim.
- Reuse the verified linking/upsert path, preserving identity, other sites and existing account data.
- Give valid `tools/call` requests a normal MCP `isError` response with reconnection instructions when Moodle rejects the credential. Do not incorrectly expire the OAuth grant.
- Give discovery/bootstrap failures a specific `moodle_relink_required` response code.
- Log only allowlisted failure stage, typed error code and auth lane; never upstream messages, tokens, URLs or user identities.

Files: `src/linking/sunlearn-connect-page.ts`, `src/oauth/routes.ts`, `src/mcp-handler.ts`, and related unit/security tests.

## Validation completed

- `npm run build`: passed.
- `npm test`: 466 tests across 49 files passed.
- `npm run test:compatibility`: 54 real-provider/workerd security checks and 23 SDK stdio/HTTP compatibility checks passed (fixture Moodle; local KV/D1).
- `git diff --check`: passed.
- New real-provider regression: reject a saved Moodle credential, replace it via the normal authorization linking route, and successfully call MCP using the original OAuth access token. No disconnect/delete operation is used; other accounts remain isolated.
- Regressions cover the reconnect dialog, sanitized recovery errors, and preservation of another linked site's credential on replacement.

## Remaining before closure

- Commit/push and deployment verification are authorized on 14 October; the closing issue comment records the resulting commit and CI run.
- Run a production reconnect and verify the connected client's error/recovery experience without deleting data.
- If the failure recurs, use safe stage/code diagnostics to determine whether Moodle rejected the remote credential or another bootstrap stage failed.
- Determine the original rejection cause if evidence becomes available; do not claim expiration or that the historical root cause is resolved.
