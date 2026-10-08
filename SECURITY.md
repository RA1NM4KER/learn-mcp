# Security Policy

## Supported versions

Security fixes are applied to the latest release and the `main` branch.

## Reporting a vulnerability

Please do not disclose security vulnerabilities in a public issue. Use **Security → Report a vulnerability** to submit a private report:

https://github.com/RA1NM4KER/learn-mcp/security/advisories/new

Include the affected version, whether you use local (stdio) or remote mode, reproduction steps, and impact.

## Sensitive data

Learn MCP handles Moodle tokens. Never attach any of the following to an issue or pull request:

- `.auth/token.json`, `.dev.vars`, or any `MOODLE_TOKEN` / `MCP_ACCESS_TOKEN` value
- signed Moodle file links or connection links
- course content, grades, or screenshots showing real student data

If a token is exposed, revoke it in your Moodle security keys page and report it privately.
