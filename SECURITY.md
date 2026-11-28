# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue.

Never include real access tokens, passwords, or authenticated URLs in a report. Replace them with placeholders.

## In scope

- Leaks of access tokens, passwords, or authenticated URLs, in a URL, log, event, or diagnostic
- Any request that carries a credential to an origin other than the signed-in server
- Weaknesses in server address, link, or credential validation
- Supply-chain issues in released builds

## Supported versions

Only `main` and the latest release receive fixes. The tags `react-native-final` and `desktop-tauri-final` are not maintained.
