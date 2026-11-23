use framework "Foundation"
use scripting additions

on run (arguments as list)
	-- osascript's first argument is the path to this entry point.
	set sourcePath to (current application's NSProcessInfo's processInfo()'s arguments()'s objectAtIndex:1) as text
	set sourceURL to current application's NSURL's fileURLWithPath:sourcePath
	set sourceFolder to sourceURL's URLByDeletingLastPathComponent()
	set driverURL to sourceFolder's URLByAppendingPathComponent:"meeting-ui.js"
	set driverPath to (driverURL's |path|()) as text
	set commandText to "/usr/bin/osascript -l JavaScript " & quoted form of driverPath
	repeat with argumentText in arguments
		set commandText to commandText & " " & quoted form of (contents of argumentText)
	end repeat
	return do shell script commandText
end run
