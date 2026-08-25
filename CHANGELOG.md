# Changelog

## 1.1.0 - 2026-08-25

- Support text selection in Codex side-chat and secondary transcript panels.
- Add yellow, green, cyan, pink, and purple highlight colors.
- Move the palette away from Codex's native selection action menu.
- Show a direct delete button when hovering highlighted text.
- Allow selecting an existing highlight to recolor or delete it.
- Expand browser regression coverage for multiple transcript surfaces and menu collision.

## 1.0.1 - 2026-08-25

- Add persistent yellow highlighting for Codex transcript text.
- Add selection toolbar and `Ctrl+Shift+H` toggle.
- Restore highlights after renderer updates and app restarts.
- Persist text quote, context, and position anchors locally.
- Support Codex layouts containing multiple `main` regions.
- Use a loopback-only CDP connection and a native RFC 6455 client.
- Cleanly remove injected UI when the tray helper exits.
