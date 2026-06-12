# Security Policy

## Supported Versions

Security fixes are provided for the latest published version of `@calypsohq/soccer-rag-mcp-server`.

## Reporting a Vulnerability

Please report suspected vulnerabilities through GitHub Security Advisories for this repository, or contact the Calypso maintainers through the support channel listed in the project documentation.

Include:

- affected package version
- MCP client and operating system
- reproduction steps
- whether an API key, uploaded file, or local `filePath` was involved

Do not include real API keys, customer files, or private knowledge-base content in the report.

## API Keys

By default, this server authenticates to Calypso with a public World Cup demo MCP bearer that is intentionally safe to embed because AIcore locks it to read-only demo responses. BYOK mode authenticates with `CALYPSO_API_KEY` or the `--api-key` CLI flag. Treat BYOK values as secrets:

- prefer environment variables or client secret stores over hard-coded config
- do not commit `.env` files or copied desktop MCP configs containing real keys
- rotate the key if it is exposed in logs, shell history, screenshots, or support tickets

The server does not intentionally log API keys. Error messages should be reviewed before sharing publicly because upstream API responses may include request-specific context.

## Local File Access

The upload tools accept either `contentBase64` or `filePath`.

- `filePath` is preferred for local MCP installs, including Claude Desktop and Cursor configs that launch this server with a local command such as `npx`, when the Calypso MCP process is allowed to read the selected path on its own filesystem.
- `contentBase64` is the safest default for hosted or remote MCP clients, including Smithery-hosted servers, browser/cloud runtimes, and agent containers, because the MCP process receives the file bytes directly.
- Hosted attachment paths such as `/mnt/user-data/uploads/...` are usually visible to the requester agent but not to a local Calypso MCP process. Send those files as `contentBase64` unless this MCP server runs in that same sandbox.

Only provide `filePath` values for files you intend to upload to Calypso. MCP clients should ask for user confirmation before calling upload tools with local paths.

## Upload Behavior

Knowledge upload tools create upload sessions with the configured Calypso API base URL, upload file bytes directly to the returned storage URL, then finalize the session with Calypso. The upload transport uses JSON session requests plus signed binary `PUT`s, not multipart form uploads. Treat returned upload URLs as short-lived bearer capabilities and do not log them.

Before using a self-hosted `CALYPSO_API_BASE_URL`, verify that it is trusted and ends in `/v1`.

## Logging

Operational logging should never include API keys or file contents. When adding logs, prefer event names, statuses, IDs, byte counts, and redacted URLs.
