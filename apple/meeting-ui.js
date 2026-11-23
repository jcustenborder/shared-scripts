ObjC.import('AppKit');
ObjC.import('ApplicationServices');

const meetPrefix = 'com.google.Chrome.app.';
const inverse = {mute: 'unmute', unmute: 'mute', 'camera-on': 'camera-off', 'camera-off': 'camera-on'};
const labels = {
    Meet: {
        leave: ['leave call'],
        mute: ['turn off microphone'], unmute: ['turn on microphone'],
        'camera-on': ['turn on camera'], 'camera-off': ['turn off camera'],
    },
    Teams: {
        leave: ['leave', 'leave call', 'hang up'],
        mute: ['mute mic', 'mute microphone'], unmute: ['unmute mic', 'unmute microphone'],
        'camera-on': ['turn camera on'], 'camera-off': ['turn camera off'],
    },
    Zoom: {
        leave: ['leave', 'leave meeting', 'end', 'end meeting'],
        mute: ['mute audio', 'mute my audio'], unmute: ['unmute audio', 'unmute my audio'],
        'camera-on': ['start video', 'start my video'], 'camera-off': ['stop video', 'stop my video'],
    },
};

/** @param {string[]} args */
function run(args) {
    const action = requestedAction(args);
    const workspace = $.NSWorkspace.sharedWorkspace;
    const frontPID = workspace.frontmostApplication.processIdentifier;
    const apps = workspace.runningApplications;
    const candidates = [];
    for (let i = 0; i < apps.count; i++) {
        const app = apps.objectAtIndex(i);
        const kind = runningKind(app);
        if (kind) candidates.push({app, kind});
    }
    if (!candidates.length) return chooseMeeting([], frontPID);
    if (!$.AXIsProcessTrusted()) {
        throw new Error('Enable Accessibility for the app running the shortcut in System Settings → Privacy & Security.');
    }

    const foreground = candidates.find(({app}) => app.processIdentifier === frontPID);
    let meetings = foreground ? meetingWindows(foreground) : [];
    if (!meetings.length) {
        meetings = candidates.filter(candidate => candidate !== foreground).flatMap(meetingWindows);
    }
    const target = meetings[chooseMeeting(meetings.map(({pid}) => pid), frontPID)];
    focusWindow(workspace, target);
    const controls = windowControls(target.window, target.kind);
    if (!inCall(controls) || !focused(workspace, target)) {
        throw new Error('The selected call or focus changed before the meeting action.');
    }
    if (action === 'focus') return `Focused ${target.kind}.`;
    if (action === 'exit') return quitMeeting(target.app, target.kind);
    return setControl(target, controls, action);
}

/** @param {string[]} args */
function requestedAction(args) {
    if (args.length === 1 && [...Object.keys(inverse), 'focus', 'exit'].includes(args[0])) return args[0];
    throw new Error('Usage: osascript meeting.applescript <mute|unmute|camera-on|camera-off|focus|exit>');
}

/** @param {string} bundleID @param {string} startURL */
function appKind(bundleID, startURL) {
    if (bundleID === 'com.microsoft.teams2') return 'Teams';
    if (bundleID === 'us.zoom.xos') return 'Zoom';
    if (!bundleID.startsWith(meetPrefix) || bundleID === meetPrefix) return null;
    const url = $.NSURLComponents.componentsWithString(startURL);
    if (url.isNil()) return null;
    const scheme = (ObjC.unwrap(url.scheme) || '').toLowerCase();
    const host = (ObjC.unwrap(url.host) || '').toLowerCase();
    const port = ObjC.unwrap(url.port);
    return scheme === 'https' && host === 'meet.google.com' && (port == null || port === 443) ? 'Meet' : null;
}

/** @param {object} app NSRunningApplication */
function runningKind(app) {
    if (app.isTerminated) return null;
    const bundleID = ObjC.unwrap(app.bundleIdentifier) || '';
    let startURL = '';
    if (bundleID.startsWith(meetPrefix) && !app.bundleURL.isNil()) {
        const bundle = $.NSBundle.bundleWithURL(app.bundleURL);
        startURL = ObjC.unwrap(bundle.objectForInfoDictionaryKey('CrAppModeShortcutURL')) || '';
    }
    return appKind(bundleID, startURL);
}

/** @param {number[]} ownerPIDs @param {number} frontPID */
function chooseMeeting(ownerPIDs, frontPID) {
    if (!ownerPIDs.length) {
        throw new Error('No supported in-call window found. Join a meeting in the installed Meet app, Teams, or Zoom.');
    }
    if (ownerPIDs.length === 1) return 0;
    const frontIndex = ownerPIDs.indexOf(frontPID);
    if (frontIndex !== -1 && frontIndex === ownerPIDs.lastIndexOf(frontPID)) return frontIndex;
    throw new Error('Multiple supported meeting windows found. Bring the intended meeting app to the front and try again.');
}

/** @param {object} element AXUIElement @param {string} name */
function attribute(element, name) {
    const out = Ref();
    const code = $.AXUIElementCopyAttributeValue(element, $(name), out);
    if (code === Number($.kAXErrorNoValue) || code === Number($.kAXErrorAttributeUnsupported)) return null;
    checkAX(code, `read ${name}`);
    return ObjC.castRefToObject(out[0]);
}

/** @param {number} code @param {string} operation */
function checkAX(code, operation) {
    if (code !== 0) throw new Error(`Couldn't ${operation} via Accessibility (error ${code}).`);
}

/** @param {object} array CFArray, or null for an unavailable attribute */
function elements(array) {
    return Array.from({length: array ? array.count : 0}, (_, index) => array.objectAtIndex(index));
}

/** @param {{app: object, kind: string}} candidate */
function meetingWindows({app, kind}) {
    const pid = app.processIdentifier;
    const axApp = $.AXUIElementCreateApplication(pid);
    checkAX($.AXUIElementSetMessagingTimeout(axApp, 1), 'set an Accessibility timeout');
    attribute(axApp, 'AXRole'); // Chrome's web app shim enables web accessibility on this query.
    return elements(attribute(axApp, 'AXWindows'))
        .filter(window => inCall(windowControls(window, kind)))
        .map(window => ({app, kind, pid, axApp, window}));
}

/** @param {object} window AXUIElement @param {string} kind */
function windowControls(window, kind) {
    const matches = {leave: [], mute: [], unmute: [], 'camera-on': [], 'camera-off': []};
    const pending = [window];
    const deadline = Date.now() + 2500;
    while (pending.length) {
        if (Date.now() >= deadline) throw new Error(`Timed out reading ${kind}'s meeting window.`);
        const element = pending.pop();
        const role = ObjC.unwrap(attribute(element, 'AXRole'));
        if (['AXButton', 'AXToggleButton', 'AXCheckBox'].includes(role)) {
            const title = ObjC.unwrap(attribute(element, 'AXTitle'));
            const description = ObjC.unwrap(attribute(element, 'AXDescription'));
            for (const key of Object.keys(matches)) {
                if ((labelMatches(title, labels[kind][key]) || labelMatches(description, labels[kind][key]))
                    && !matches[key].some(match => $.CFEqual(match, element))) matches[key].push(element);
            }
        }
        for (const child of elements(attribute(element, 'AXChildren'))) pending.push(child);
    }
    return matches;
}

/** @param {string|null} label @param {string[]} expected */
function labelMatches(label, expected) {
    return typeof label === 'string' &&
        expected.includes(label.trim().replace(/\s+\((?:[⌘⌃⌥⇧]\s*\+?\s*)+[a-z0-9]\)$/i, '').toLowerCase());
}

/** @param {Record<string, object[]>} controls */
function inCall(controls) {
    return controls.leave.length === 1 && Object.keys(inverse).some(action => controls[action].length === 1);
}

/** @param {object} workspace NSWorkspace @param {object} target Selected app and window */
function focusWindow(workspace, target) {
    if (focused(workspace, target)) return;
    if (ObjC.unwrap(attribute(target.window, 'AXMinimized')) === true) {
        checkAX($.AXUIElementSetAttributeValue(target.window, $('AXMinimized'), $(false)), 'restore the meeting window');
    }
    if (workspace.frontmostApplication.processIdentifier !== target.pid) {
        checkAX($.AXUIElementSetAttributeValue(target.axApp, $('AXFrontmost'), $(true)), 'activate the meeting app');
    }
    checkAX($.AXUIElementPerformAction(target.window, $('AXRaise')), 'raise the meeting window');
    if (!waitFor(() => focused(workspace, target), 1000)) {
        throw new Error('Could not bring the selected meeting window to the front.');
    }
}

/** @param {object} workspace NSWorkspace @param {object} target Selected app and window */
function focused(workspace, target) {
    if (workspace.frontmostApplication.processIdentifier !== target.pid || target.app.isTerminated) return false;
    const current = attribute(target.axApp, 'AXFocusedWindow');
    return current !== null && $.CFEqual(current, target.window);
}

/** @param {object} target Selected app and window @param {Record<string, object[]>} controls @param {string} action */
function setControl(target, controls, action) {
    const opposite = inverse[action];
    const [button] = controls[action];
    const enabled = button && ObjC.unwrap(attribute(button, 'AXEnabled')) === true;
    if (controlDecision(controls[action].length, controls[opposite].length, enabled) === 'unchanged') {
        return `Already set: ${action}.`;
    }
    const title = ObjC.unwrap(attribute(button, 'AXTitle'));
    const description = ObjC.unwrap(attribute(button, 'AXDescription'));
    const options = labels[target.kind];
    if (!(labelMatches(title, options[action]) || labelMatches(description, options[action]))
        || labelMatches(title, options[opposite]) || labelMatches(description, options[opposite])) {
        throw new Error('The meeting control changed before it could be pressed. No press sent.');
    }
    checkAX($.AXUIElementPerformAction(button, $('AXPress')), 'press the requested meeting control');

    const failure = 'Pressed the meeting control, but could not confirm the requested state. Check the app before trying again.';
    try {
        if (waitFor(() => {
            const after = windowControls(target.window, target.kind);
            return inCall(after) && after[action].length === 0 && after[opposite].length === 1;
        }, 1200)) return `Set: ${action}.`;
    } catch (error) {
        throw new Error(`${failure} ${error.message}`);
    }
    throw new Error(failure);
}

/** @param {number} requestedCount @param {number} inverseCount @param {boolean} enabled */
function controlDecision(requestedCount, inverseCount, enabled) {
    if (requestedCount === 0 && inverseCount === 1) return 'unchanged';
    if (requestedCount !== 1 || inverseCount !== 0) throw new Error('Could not verify a unique microphone or camera state.');
    if (!enabled) throw new Error('The requested microphone or camera control is disabled.');
    return 'press';
}

/** @param {object} app NSRunningApplication @param {string} kind */
function quitMeeting(app, kind) {
    if (runningKind(app) !== kind) throw new Error('Meeting app identity changed. No quit sent.');
    if (!app.terminate) throw new Error(`${kind} did not accept a normal quit request.`);
    if (waitFor(() => app.isTerminated, 3000)) return `Quit ${kind}.`;
    throw new Error(`Quit was requested for ${kind}, but it is still running. Look for a confirmation in the app.`);
}

/** @param {() => boolean} condition @param {number} timeoutMs */
function waitFor(condition, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    do {
        if (condition()) return true;
        // AppKit updates focus and termination state on the run loop.
        $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.075));
    } while (Date.now() < deadline);
    return false;
}
