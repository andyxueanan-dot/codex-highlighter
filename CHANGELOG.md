# Changelog

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
