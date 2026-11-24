local script = "/absolute/path/to/shared-scripts/apple/meeting.applescript"
local modifiers = {"cmd", "ctrl", "shift", "alt"}
local actions = {
    m = "mute",
    u = "unmute",
    c = "camera-on",
    o = "camera-off",
    f = "focus",
    e = "exit",
}

for key, action in pairs(actions) do
    assert(hs.hotkey.bind(modifiers, key, function()
        local task = hs.task.new("/usr/bin/osascript", function(code, _, stderr)
            if code ~= 0 then
                hs.alert.show(("Meeting %s failed (%d): %s"):format(action, code, stderr))
            end
        end, {script, action})
        if not task:start() then
            hs.alert.show("Could not start osascript for meeting action: " .. action)
        end
    end), "Could not bind meeting hotkey: " .. action)
end
