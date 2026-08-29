# Codex Highlighter

English | [简体中文](README.zh-CN.md)

<p align="center">
  <img src="assets/hero.png" alt="Codex Highlighter — persistent five-color highlights for desktop transcripts" width="100%">
</p>

<p align="center"><strong>Keep the important parts of your Codex conversations visible.</strong></p>

<p align="center">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows">
  <img alt="Version" src="https://img.shields.io/badge/version-1.2.4-ffca28">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-2ea44f">
</p>

> An unofficial community project. It is not affiliated with or endorsed by OpenAI. Codex updates may change internal UI structure and temporarily break compatibility.

Codex Highlighter adds one focused feature to the Windows Codex desktop app: select transcript text, choose a color, and keep a persistent highlight.

It does not add translation, summarization, AI prompts, or a system-wide screen overlay.

## Highlights

| Feature | What it does |
| --- | --- |
| Five colors | Yellow, green, cyan, pink, and purple for different kinds of notes. |
| Main + side chat | Works across the primary transcript and secondary conversation panels. |
| Persistent anchors | Re-finds highlighted text after React updates, scrolling, and app restarts. |
| Hover delete | Move the pointer over a highlight and remove it without selecting it again. |
| Native-menu avoidance | Places the palette away from Codex's own selection actions. |
| Local-first | Stores highlight records on your device; no project server is involved. |
| Data manager | Search, delete, clear, import, and export highlights from the tray menu. |
| Performance-aware | Incremental revision sync, indexed anchors, local observers, and idle-time re-anchoring. |
| Literal text support | Highlights plain-text cards and syntax-highlighted code spanning multiple DOM nodes. |
| Table support | Highlights native tables and ARIA grids with stable row/cell identities. |

## See it in action

<p align="center">
  <img src="assets/demo-palette.png" alt="Five-color palette working in a main transcript and side chat" width="100%">
</p>

<details>
  <summary><strong>Hover to delete</strong></summary>
  <br>
  <img src="assets/demo-hover-delete.png" alt="A delete button appearing above highlighted text on hover" width="100%">
</details>

> The screenshots are rendered by the actual injection script on a privacy-safe local demo fixture. They contain no personal Codex conversations.

## Quick start

Requirements: Windows 10 or 11 and the Codex desktop app.

### Install a release

1. Download `codex-highlighter-v1.2.4-windows-x64.zip` from [GitHub Releases](https://github.com/andyxueanan-dot/codex-highlighter/releases/latest).
2. Extract the archive.
3. Run `install.ps1` in PowerShell. The installer uses the current user account and does not require administrator access.

### Build from source

```powershell
git clone https://github.com/andyxueanan-dot/codex-highlighter.git
cd codex-highlighter
.\build.ps1
.\Start-Codex-Highlighter.cmd
```

1. Approve the one-time Codex restart when prompted.
2. Select text in the main transcript or side chat.
3. Choose yellow, green, cyan, pink, or purple.
4. Hover highlighted text and click the trash button to remove it.

Selecting an existing highlight also lets you recolor or delete it. The palette prefers a position below the selection and avoids Codex's native selection action menu.

`Ctrl+Shift+H` also toggles the current selection.

Open the yellow tray icon and choose **Manage highlight data** to search records, delete selected rows, clear all data, or import/export JSON backups.

The installer also creates a current-user startup shortcut. It starts only the tray watcher at sign-in, waits quietly while Codex is closed, and restores highlighting automatically after Codex is opened or restarted.

The installer starts the tray watcher independently through Windows, so restarting Codex or switching Codex accounts does not terminate it with the Codex process tree. An account switch may briefly restart Codex again if the new process did not retain the loopback debugging port; highlights remain stored locally throughout recovery.

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

The test suite checks JavaScript syntax, embedded resources, data validation, Codex discovery, loopback ports, and real Chromium behavior for main/side transcript selection, five colors, native-menu avoidance, re-anchoring, adjacent selections, recoloring, and hover deletion.

```powershell
.\tests\run-tests.ps1
```

The browser test needs Node.js, Playwright, and Chrome or Edge. The native integration self-test expects Codex to be installed and running.

## Security

While the helper is running, another process under the same Windows account may be able to access the local debugging endpoint. Do not use it on an untrusted shared account. See [SECURITY.md](SECURITY.md).

See the [compatibility matrix](docs/COMPATIBILITY.md) for verified Codex, Chromium, and Windows versions.

## Uninstall

Exit the yellow tray icon, delete the project or installed executable, and optionally delete `%LOCALAPPDATA%\CodexHighlighter` to remove saved highlights. The tool creates no startup task or registry installation entry.

## License

[MIT](LICENSE). See [third-party notices](licenses/THIRD_PARTY_NOTICES.md) for the CodeFace and Hypothesis projects that informed the implementation.
