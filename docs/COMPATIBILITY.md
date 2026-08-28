# Compatibility matrix

Last verified: 2026-08-28

| Platform | Codex Desktop | Chromium | Status | Evidence |
| --- | --- | --- | --- | --- |
| Windows 11 Pro x64, build 26200 | `26.820.9563.0` | `151.0.7922.170` | ✅ Verified | v1.2.1 real-app palette latency was 5.2 ms with 173 stored highlights; selection did not increment the re-anchor count. |
| Windows 11 Pro x64, build 26200 | `26.820.9563.0` | `151.0.7922.170` | ✅ Verified | Full v1.2.0 regression suite plus real 175-anchor idle sampling: host CPU reduced from 5.3% to 0.21%; 23 streaming mutation batches coalesced into one indexed pass with zero historical fallback anchors. |
| Windows 11 Pro x64, build 26200 | `26.818.5229.0` | `151.0.7922.170` | ✅ Verified | Full launch, CDP injection, main transcript, side chat, five colors, persistence, recoloring, hover delete, data manager, installer and browser regression tests. |
| Windows 10 x64 | Current Store build | Chromium with CSS Highlights API | 🟡 Expected, not yet verified | The host uses .NET Framework and Windows APIs available on Windows 10, but no end-to-end machine has been tested yet. |
| macOS | Any | Any | ❌ Unsupported | The native launcher, process discovery, installer and tray workflow are Windows-specific. |
| Linux | Any | Any | ❌ Unsupported | The official Windows Codex package and launcher flow are required. |
| Codex CLI / IDE extension | Any | N/A | N/A | This project targets the Codex desktop transcript renderer only. |

## What “verified” means

A verified row has passed all of the following on a real Codex installation:

- restart Codex with a loopback-only CDP endpoint;
- inject and health-check the renderer runtime;
- highlight main and side-chat transcript text;
- persist and re-anchor highlights after DOM replacement;
- keep short-word anchors isolated when duplicate words appear later or inside editable composers;
- display the palette without synchronously re-anchoring even when 120 resolved Ranges became stale;
- add, recolor and delete all five colors;
- show direct hover deletion and avoid the native selection menu;
- export, import, search, delete and clear records in the native manager;
- install, update, preserve data, uninstall and purge in a temporary user directory;
- start from the current-user Windows Startup folder, wait for Codex, and automatically recover a normally launched Codex session.

## Codex update policy

Codex Desktop is updated independently and may change its renderer structure. Codex Highlighter avoids fixed generated class names where practical, uses semantic and text anchors, and disables unsafe operations when required elements are missing. Compatibility with an unlisted Codex version is not guaranteed.

After a Codex update:

1. Open the tray menu and check the connection status.
2. Try **Reload highlighting**.
3. Run `tests\run-tests.ps1` from a source checkout if the issue persists.
4. Open a GitHub issue with the Codex package version, Windows build, reproduction steps and the sanitized tail of `%LOCALAPPDATA%\CodexHighlighter\CodexHighlighter.log`.

Do not attach `highlights.json` to a public issue unless you have reviewed and removed private conversation text.
