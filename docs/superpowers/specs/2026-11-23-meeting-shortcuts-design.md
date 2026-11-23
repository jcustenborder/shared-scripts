# macOS meeting shortcuts

Use the same hotkeys on multiple Macs to control a call in the installed Google Meet web app, Microsoft Teams, or Zoom. Apple Shortcuts owns the global key bindings; the shared AppleScript and setup instructions live under `apple/`.

## Behavior

- Expose `mute`, `unmute`, `camera-on`, `camera-off`, `focus`, and `exit` through one AppleScript. No dependencies beyond macOS and the supported apps.
- Act on an identifiable in-call window. Prefer a recognized meeting in the frontmost supported app; otherwise use the sole recognized meeting window. Report no target or ambiguity without acting; do not start an app or join a meeting.
- Bring the chosen window forward. For mic and camera actions, inspect the current state using the window's accessibility controls and press only the control for the requested change. If the state is already correct, do nothing. If it is unknown, disabled, or ambiguous, report the failure instead of toggling blindly. The initial selectors support English app interfaces.
- For `exit`, request a normal quit of the chosen app, not an end-for-everyone action. Never quit Google Chrome, send a global quit keystroke, or fall back to a normal browser tab. The installed Meet web app has a separate macOS app identity; use its Chrome web-app bundle metadata, not a display-name guess or a single Mac's bundle ID.

## Approaches

Use app-scoped accessibility controls and a normal quit addressed to the selected running process. This supports explicit on/off actions and keeps Chrome out of the exit path. Global keyboard simulation is shorter but its toggle shortcuts cannot guarantee the resulting state, and a focus change could send quit to the wrong app. Supporting regular Meet browser tabs would require separate tab targeting; this version instead uses the installed Meet web app, as confirmed on the user's Mac.

## Acceptance

Check the six actions in throwaway meetings, including issuing each mic/camera command twice. Check that unsupported, missing, and ambiguous targets are refused. With both the installed Meet app and ordinary Chrome windows open, verify that `exit` closes Meet and leaves the Chrome process and its tabs intact. A normal Chrome Meet tab by itself must not be targeted. Report any live checks that couldn't be run.
