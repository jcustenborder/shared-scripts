# Repository guidance

This repository holds scripts shared across machines. Put macOS scripts under `apple/` and document setup, permissions, and usage alongside them. Keep machine-specific paths, credentials, and meeting links out of shared files. Prefer platform tools over new dependencies.

## Meeting shortcuts

- Apple Shortcuts owns the hotkeys. Keep app detection and action logic shared behind one AppleScript entry point.
- Target only an identifiable meeting in Google Meet's installed web app, Microsoft Teams, or Zoom. If the target or control state is unclear, fail with a readable error rather than guessing.
- Mic and camera actions set a specific state; do not send a blind toggle. Exit must target only the identified meeting app. Never quit Google Chrome or fall back to a browser tab.
- For script changes, compile with `osacompile` and run the relevant behavior tests. Use throwaway calls for live checks. When changing Meet exit behavior, verify that Chrome and its ordinary tabs stay open, or report that the check was not run.
