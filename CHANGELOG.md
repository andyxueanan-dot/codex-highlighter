# Changelog

## 1.2.0 - 2026-08-28

- Reduce healthy CDP monitoring from every 1.8 seconds to every 15 seconds.
- Use fast 5-second checks only while disconnected or waiting for Codex.
- Collapse version, revision, timestamp, and count checks into one lightweight renderer call.
- Import or export JSON only when the revision changed; unchanged data is no longer transferred.
- Inject only the main Codex renderer and skip the avatar overlay window.
- Cache renderer targets and inject only when a target is new or its runtime version changed.
- Observe transcript surfaces instead of the entire document.
- Debounce streaming DOM mutations for one second and schedule re-anchoring during browser idle time.
- Build scope hash and semantic-identity indexes before matching anchors.
- Limit expensive fallback matching to the initial load and anchors previously resolved on screen.
- Remove synchronous full re-anchoring from ordinary text selection.
- Throttle hover hit-testing to once every 80 ms.
- Add renderer diagnostics and a 600-anchor / 25-mutation performance regression test.

## 1.1.2 - 2026-08-27

- Start the tray host automatically for the current Windows user after installation.
- Add a silent `--startup` watch mode that waits when Codex is closed instead of launching it at sign-in.
- Automatically recover highlighting when Codex is later opened or restarted without the CDP flags.
- Require three consecutive endpoint failures before recovery to avoid reacting to brief renderer stalls.
- Back off after failed recovery and collapse repeated timeout logging.
- Remove both Start menu and startup shortcuts during uninstall.
- Add installer regression coverage for shortcut creation, startup arguments, cleanup, and data preservation.

## 1.1.1 - 2026-08-27

- Prevent short highlights such as “four” or “四个” from migrating to later duplicate words.
- Require the original scope fingerprint or reliable surrounding context before re-anchoring.
- Normalize layout whitespace so genuine React re-renders still restore the original highlight.
- Exclude text boxes, content-editable regions, Lexical editors, and other composer surfaces from highlight restoration.
- Add regression coverage for duplicate short words, removed source nodes, restored source nodes, and editable composers.

## 1.1.0 - 2026-08-25

- Support text selection in Codex side-chat and secondary transcript panels.
- Add yellow, green, cyan, pink, and purple highlight colors.
- Move the palette away from Codex's native selection action menu.
- Show a direct delete button when hovering highlighted text.
- Allow selecting an existing highlight to recolor or delete it.
- Add a native tray data manager with search, delete, clear, import, and export.
- Add current-user install and uninstall scripts with data-preserving defaults.
- Add reproducible release packaging and SHA-256 checksum generation.
- Add a verified compatibility matrix and bounded 2 MiB log rotation.
- Reduce the palette and hover controls for high-DPI displays.
- Expand browser regression coverage for multiple transcript surfaces and menu collision.

## 1.0.1 - 2026-08-25

- Add persistent yellow highlighting for Codex transcript text.
- Add selection toolbar and `Ctrl+Shift+H` toggle.
- Restore highlights after renderer updates and app restarts.
- Persist text quote, context, and position anchors locally.
- Support Codex layouts containing multiple `main` regions.
- Use a loopback-only CDP connection and a native RFC 6455 client.
- Cleanly remove injected UI when the tray helper exits.
