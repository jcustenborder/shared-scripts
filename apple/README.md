# macOS meeting shortcuts

Use the same hotkeys in the installed Google Meet web app, Microsoft Teams, and Zoom. Keep `meeting.applescript` and its `meeting-ui.js` helper together.

## Set up with Apple Shortcuts

1. Install the desktop apps you use. For Google Meet, install it from Chrome as a web app; an ordinary Meet tab is intentionally unsupported.
2. In **Shortcuts → Settings → Advanced**, enable **Allow Running Scripts**.
3. Create a shortcut named **Mute Meeting** with one **Run Shell Script** action. Use your local absolute path:

   ```sh
   /usr/bin/osascript "/absolute/path/to/shared-scripts/apple/meeting.applescript" mute
   ```

4. In the shortcut's details, use **Add Keyboard Shortcut** to assign a hotkey. Duplicate the shortcut for the other actions, replacing the last word with `unmute`, `camera-on`, `camera-off`, `focus`, or `exit`.
5. With a test meeting open, run **Focus Meeting** once. If it reports a permission error, grant **Shortcuts** access in the [macOS permissions panel](#macos-permissions). If you're testing from Terminal, Terminal needs its own permission.

## Set up with Hammerspoon

Use this alternative if the shortcut works from the Shortcuts editor but fails with its global hotkey. Hammerspoon runs `meeting.applescript` directly.

1. Install [Hammerspoon](https://www.hammerspoon.org/) (`brew install --cask hammerspoon`) and open it. Grant **Hammerspoon** access in the [macOS permissions panel](#macos-permissions).
2. Copy [`hammerspoon/init.lua`](hammerspoon/init.lua) to `~/.hammerspoon/init.lua`. If you already have a config, append the template instead of overwriting it.
3. Edit `local script` to point to the absolute path of `meeting.applescript` on this Mac. Leave `meeting-ui.js` beside the AppleScript.
4. Remove any conflicting Apple Shortcuts hotkeys, then choose **Reload Config** from the Hammerspoon menu. With a throwaway meeting open, try **Focus meeting** from another app.

`MetaLeft` is the Windows key on a PC keyboard and maps to **Command** on macOS. `AltLeft` maps to **Option**. The table uses left-side key names for remapping tools; Hammerspoon accepts either side.

| Action | Script argument | Key combination |
| --- | --- | --- |
| Mute | `mute` | `MetaLeft+ControlLeft+ShiftLeft+AltLeft+KeyM` |
| Unmute | `unmute` | `MetaLeft+ControlLeft+ShiftLeft+AltLeft+KeyU` |
| Camera on | `camera-on` | `MetaLeft+ControlLeft+ShiftLeft+AltLeft+KeyC` |
| Camera off | `camera-off` | `MetaLeft+ControlLeft+ShiftLeft+AltLeft+KeyO` |
| Focus meeting | `focus` | `MetaLeft+ControlLeft+ShiftLeft+AltLeft+KeyF` |
| Exit meeting | `exit` | `MetaLeft+ControlLeft+ShiftLeft+AltLeft+KeyE` |

## macOS permissions

In **System Settings → Privacy & Security**, enable the launcher you use, not Chrome or the meeting app:

- **macOS Tahoe 26:** **Accessibility**.
- **macOS Golden Gate 27.0–27.2:** **Device Control and Data Access**.
- **macOS Golden Gate 27.3 beta 2 and later:** Apple [split that setting](https://developer.apple.com/news/?id=oqng0zjk). Look under **System & App Protection Override** for app control.

## What the actions do

- The script prefers a verified call in the frontmost supported app. If nothing is recognized there, it looks for a single recognized call elsewhere. If several qualify, bring the intended app forward or close the extra meeting windows.
- Zoom call detection does not use window titles. When there is no accessible leave button, it also accepts the observed Zoom 7.1.9 main-window layout with enabled, unambiguous mic and camera commands in Zoom's **Meeting** menu. Other window layouts without a leave button are not recognized.
- When Teams hasn't exposed its web controls, the shortcut asks Teams to enable web accessibility and checks again. This doesn't enable VoiceOver or change macOS settings. The shortcut still requires a verified call before it acts.
- Mic and camera actions leave an already-correct state alone. If two shortcuts overlap, the second one is refused rather than risking a double toggle. The first version uses English accessibility labels; Zoom's mic and camera actions use its **Meeting** menu, not the participant controls. If the script cannot recognize a control or it is disabled, use the app's own controls rather than retrying blindly.
- After checking the current state, the installed Meet app gets its built-in ⌘D (mic) or ⌘E (camera) shortcut directly. The script checks the resulting state and does not retry the keypress.
- `exit` requests a normal quit of the selected meeting app. It may close other windows owned by that app or show its usual confirmation. It does not click an **End for everyone** button, force quit, or send `⌘Q`. For Meet, it targets only the installed web app, never the Chrome browser or its tabs.

## Verify on a new Mac

Try the actions in a throwaway meeting, including running each mic and camera action twice. With an ordinary Chrome window open, exit the installed Meet app and confirm the Chrome window and tabs remain. Then check that a Meet tab alone is not targeted.

If a Zoom call isn't detected, check the `Zoom detection:` details in the error. For a separate snapshot, run this from the repository root while Zoom is in the call:

```sh
/usr/bin/osascript apple/meeting.applescript diagnose-zoom
```

For Microsoft Teams, run this while the call is open:

```sh
/usr/bin/osascript apple/meeting.applescript diagnose-teams
```

These commands report app-control permission, running apps, window structure, and known call controls without changing focus or clicking anything. They do not print meeting titles. If `appControl` is `false`, grant Terminal app-control permission or run the same action from a launcher that already has it.

For the automated decision tests (no meeting needed), run from the repository root:

```sh
cat apple/meeting-ui.js apple/tests/meeting-tests.js | /usr/bin/osascript -l JavaScript
```
