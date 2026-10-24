# Contributing to Project-Ops

Start with the [README](README.md#run-from-source) to run the application locally. Use the lockfiles with `npm ci`, and keep development data separate from real client work.

- For a bug, include the commit or package version, reproduction steps, expected and actual behavior, and sanitized logs. Use made-up data in screenshots.
- For a substantial feature, open an issue describing the workflow and proposed scope before investing in implementation.
- Keep pull requests focused. Explain the behavior change, how you checked it, and any setup, migration or compatibility effects.
- Add regression coverage when changing behavior. Permission changes should exercise allowed and denied callers; tenancy changes should exercise workspace isolation.

Run the applicable [development checks](README.md#development): backend lint, build and unit tests; frontend lint and build. The Docker-backed RLS runner is relevant to authentication, membership and database isolation changes. State which checks you ran and which remain untested.

Use placeholders in examples. Do not commit credentials, private infrastructure addresses, real customer records or generated build output. Route vulnerability reports through [SECURITY.md](SECURITY.md).

Contributions are made under the repository's [Apache License 2.0](LICENSE).
