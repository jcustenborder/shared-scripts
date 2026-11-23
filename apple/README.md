# macOS meeting shortcuts

Use the same hotkeys in the installed Google Meet web app, Microsoft Teams, and Zoom. Keep `meeting.applescript` and its `meeting-ui.js` helper together.

## Set up on each Mac

1. Install the desktop apps you use. For Google Meet, install it from Chrome as a web app; an ordinary Meet tab is intentionally unsupported.
2. In **Shortcuts → Settings → Advanced**, enable **Allow Running Scripts**.
3. Create a shortcut named **Mute Meeting** with one **Run Shell Script** action. Use your local absolute path:

   ```sh
   /usr/bin/osascript "/absolute/path/to/shared-scripts/apple/meeting.applescript" mute
   ```

4. In the shortcut's details, use **Add Keyboard Shortcut** to assign a hotkey. Duplicate the shortcut for the other actions, replacing the last word with `unmute`, `camera-on`, `camera-off`, `focus`, or `exit`.
5. With a test meeting open, run **Focus Meeting** once. If it reports a permission error, grant the shortcut runner access under **System Settings → Privacy & Security → Accessibility**. If you're testing from Terminal, Terminal needs its own permission.

## What the actions do

- The script prefers a verified call in the frontmost supported app. If nothing is recognized there, it looks for a single recognized call elsewhere. If several qualify, bring the intended app forward or close the extra meeting windows.
- Mic and camera actions leave an already-correct state alone. If two shortcuts overlap, the second one is refused rather than risking a double toggle. The first version uses English accessibility labels; Zoom's mic and camera actions use its **Meeting** menu, not the participant controls. If the script cannot recognize a control or it is disabled, use the app's own controls rather than retrying blindly.
- `exit` requests a normal quit of the selected meeting app. It may close other windows owned by that app or show its usual confirmation. It does not click an **End for everyone** button, force quit, or send `⌘Q`. For Meet, it targets only the installed web app, never the Chrome browser or its tabs.

## Verify on a new Mac

Try the actions in a throwaway meeting, including running each mic and camera action twice. With an ordinary Chrome window open, exit the installed Meet app and confirm the Chrome window and tabs remain. Then check that a Meet tab alone is not targeted.

For the automated decision tests (no meeting needed), run from the repository root:

```sh
cat apple/meeting-ui.js apple/tests/meeting-tests.js | /usr/bin/osascript -l JavaScript
```
