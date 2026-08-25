# Codex Highlighter

English | [简体中文](README.md)

> An unofficial community project. It is not affiliated with or endorsed by OpenAI. Codex updates may change internal UI structure and temporarily break compatibility.

Codex Highlighter adds one focused feature to the Windows Codex desktop app: select transcript text, click the yellow marker, and keep a persistent highlight.

It does not add translation, summarization, AI prompts, or a system-wide screen overlay.

## Usage

1. Run `build.ps1` or download a release build.
2. Start `Start-Codex-Highlighter.cmd`.
3. Approve the one-time Codex restart when prompted.
4. Select text inside the Codex transcript and click the yellow marker.
5. Select highlighted text and click the marker again to remove it.

`Ctrl+Shift+H` also toggles the current selection.

## How it works

The helper launches Codex with a Chrome DevTools Protocol endpoint bound to `127.0.0.1`, then injects the highlighting runtime into the real Chromium renderer. Highlights use the CSS Highlights API, so the tool does not wrap or rewrite React-managed transcript nodes.

Anchors include the exact quote, nearby text, position, message fingerprint, and page context. A mutation observer re-anchors highlights after virtualized or React-rendered content changes.

Local highlight data is stored at:

```text
%LOCALAPPDATA%\CodexHighlighter\highlights.json
```

## Build

The native tray helper builds with the .NET Framework C# compiler included with Windows:

```powershell
.\build.ps1
```

Output:

```text
dist\CodexHighlighter.exe
```

## Tests

The test suite checks JavaScript syntax, embedded resources, data validation, Codex discovery, loopback ports, and real Chromium behavior for add, re-anchor, adjacent selections, and remove.

```powershell
.\tests\run-tests.ps1
```

The browser test needs Node.js, Playwright, and Chrome or Edge. The native integration self-test expects Codex to be installed and running.

## Security

While the helper is running, another process under the same Windows account may be able to access the local debugging endpoint. Do not use it on an untrusted shared account. See [SECURITY.md](SECURITY.md).

## Uninstall

Exit the yellow tray icon, delete the project or installed executable, and optionally delete `%LOCALAPPDATA%\CodexHighlighter` to remove saved highlights. The tool creates no startup task or registry installation entry.

## License

[MIT](LICENSE). See [third-party notices](licenses/THIRD_PARTY_NOTICES.md) for the CodeFace and Hypothesis projects that informed the implementation.
