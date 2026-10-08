# Contributing

Thanks for helping improve Learn MCP.

## Before you start

- Search existing issues before opening a new one.
- Keep the server read-only with respect to Moodle, and keep tokens out of logs and tool output.
- Do not submit real tokens, course content, grades, or screenshots containing student data.
- Learn MCP is an independent project; keep institution branding claims accurate.

## Local development

```bash
npm install
npm test
npm run build
```

## Pull requests

1. Create a focused branch from `main`.
2. Add or update tests for logic changes.
3. Run `npm test` and `npm run build` before opening the PR.
4. Confirm fixtures and logs contain only synthetic data.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
