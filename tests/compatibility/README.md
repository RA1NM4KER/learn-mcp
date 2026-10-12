# MCP client/transport compatibility tests

Run `npm run test:compatibility` after `npm ci`.

The runner reuses the issue #7 local workerd/OAuth/KV/D1 fixture lifecycle,
then connects genuine MCP SDK clients to both the actual `dist/server.js`
stdio entry point and the actual provider-protected workerd `/mcp` endpoint.
It compares tool names, JSON input schemas, annotations, prompts, resource
templates, text content, file URIs and typed error behavior. Disk-saving is
intentionally local-only. Moodle is fixture-controlled in both lanes; the
stdio preload refuses all unknown destinations and functions. No production
credentials are needed. Localhost binding must be permitted.

The SDK tests verify protocol and content fidelity, not a model's visual
interpretation. Real-client and production results, and untested coverage,
are recorded in `docs/audits/issue-8-compatibility-2026-10-12.md`.
