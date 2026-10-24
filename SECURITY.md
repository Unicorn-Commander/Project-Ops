# Security policy

Please report suspected vulnerabilities privately. If GitHub private vulnerability reporting is enabled for this repository, use [Report a vulnerability](https://github.com/Unicorn-Commander/Project-Ops/security/advisories/new).

If that option is unavailable, open a minimal issue asking the maintainers for a private reporting channel. Do not include exploit details, credentials, affected customer names or production records in the public issue.

In the private report, include the affected commit or package version, deployment mode, required role, reproduction steps using synthetic data, expected and observed behavior, and potential impact. Remove tokens, passwords and personal data from logs and screenshots. Coordinate disclosure with the maintainers while a fix is investigated.

The [local Docker profile](README.md#quick-start) is intended for a single workspace and does not install multi-workspace database isolation policies. For an exposed deployment, configure TLS, authentication, trusted proxies, backups and the required tenancy policies for your environment. Keep the generated configuration volume with the database backups and keep both private.
