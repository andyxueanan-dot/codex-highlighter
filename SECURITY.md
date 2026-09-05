# Security

## Security model

The combined launcher starts Codex with a Chrome DevTools Protocol (CDP) endpoint bound to `127.0.0.1`. Normal opens and background watching never restart an existing Codex process. An explicit confirmed reconnect requests a graceful exit only. The helper rejects non-loopback endpoints and does not modify the Codex installation, login state, or API configuration.

While the helper is running, another process under the same local Windows account may be able to connect to that debugging endpoint. Do not use the tool on a shared or untrusted Windows account. Exit Codex Highlighter and restart Codex normally when you do not need highlighting.

Highlight data is stored locally under `%LOCALAPPDATA%\CodexHighlighter`. It is not sent to a server by this project.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting if it is available for the repository. Otherwise, open an issue without publishing exploit details and ask the maintainer for a private contact channel.
