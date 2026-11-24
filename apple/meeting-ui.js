ObjC.import('AppKit');
ObjC.import('ApplicationServices');
ObjC.import('Carbon');
ObjC.bindFunction('open', ['int', ['char *', 'int']]);
ObjC.bindFunction('flock', ['int', ['int', 'int']]);
ObjC.bindFunction('close', ['int', ['int']]);

const meetPrefix = 'com.google.Chrome.app.';
const inverse = {mute: 'unmute', unmute: 'mute', 'camera-on': 'camera-off', 'camera-off': 'camera-on'};
const labels = {
    Meet: {
        leave: ['leave call'],
        mute: ['turn off microphone'], unmute: ['turn on microphone'],
        'camera-on': ['turn on camera'], 'camera-off': ['turn off camera'],
    },
    Teams: {
        leave: ['leave call', 'leave meeting', 'hang up'],
        mute: ['mute mic', 'mute microphone'], unmute: ['unmute mic', 'unmute microphone'],
        'camera-on': ['turn camera on'], 'camera-off': ['turn camera off'],
    },
    Zoom: {
        leave: ['leave meeting', 'end meeting'],
        mute: ['mute audio', 'mute my audio'], unmute: ['unmute audio', 'unmute my audio'],
        'camera-on': ['start video', 'start my video'], 'camera-off': ['stop video', 'stop my video'],
    },
};
const buttonRoles = ['AXButton', 'AXToggleButton', 'AXCheckBox'];
// Only report control-like phrases and shortcut hints, not arbitrary UI text.
const zoomLeaveHint = /^(?:end|leave|quit|hang up|disconnect)(?: (?:or|end|leave|the|this|meeting|call|for|all|everyone|audio|webinar|zoom))*[.!]?(?: \((?:[⌘⌃⌥⇧]\s*\+?\s*)+[a-z0-9]\))?$/i;
const zoomControlHints = [...Object.values(labels.Zoom).flat(), 'join audio', 'join computer audio',
    'leave computer audio', 'meeting controls', 'show meeting controls', 'hide meeting controls',
    'meeting info', 'share screen', 'participants', 'video render'];

/** @param {string[]} args */
function run(args) {
    const action = requestedAction(args);
    if (action === 'diagnose-zoom') return diagnoseZoom();
    const lockPath = ObjC.unwrap($.NSTemporaryDirectory()) + 'shared-scripts-meeting.lock';
    return withMeetingLock(lockPath, () => runAction(action));
}

/** @param {string} path @param {() => string} operation */
function withMeetingLock(path, operation) {
    const files = $.NSFileManager.defaultManager;
    if (!files.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(path, true, $.NSDictionary.dictionary, null)) {
        throw new Error('Could not create the meeting shortcut lock directory.');
    }
    const fd = $.open(path, 0); // O_RDONLY: lock the directory without changing its contents.
    if (fd < 0) throw new Error('Could not open the meeting shortcut lock.');
    try {
        if ($.flock(fd, 2 | 4) !== 0) { // LOCK_EX | LOCK_NB
            throw new Error('Another meeting shortcut is running or the lock is unavailable. Try again shortly.');
        }
        return operation();
    } finally {
        $.close(fd);
    }
}

/** @param {string} action */
function runAction(action) {
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

    const zoomMisses = [];
    const foreground = candidates.find(({app}) => app.processIdentifier === frontPID);
    let meetings = foreground ? meetingWindows(foreground, zoomMisses) : [];
    if (!meetings.length) {
        meetings = candidates.filter(candidate => candidate !== foreground)
            .flatMap(candidate => meetingWindows(candidate, zoomMisses));
    }
    const target = meetings[chooseMeeting(meetings.map(({pid}) => pid), frontPID, zoomMisses)];
    focusWindow(workspace, target);
    if (!isMeetingWindow(target.window, target.kind, target.axApp) || !focused(workspace, target)) {
        throw new Error('The selected call or focus changed before the meeting action.');
    }
    if (action === 'focus') return `Focused ${target.kind}.`;
    if (action === 'exit') return quitMeeting(target.app, target.kind);
    return setControl(target, mediaControls(target), action);
}

/** @param {string[]} args */
function requestedAction(args) {
    if (args.length === 1 && [...Object.keys(inverse), 'focus', 'exit', 'diagnose-zoom'].includes(args[0])) return args[0];
    throw new Error('Usage: osascript meeting.applescript <mute|unmute|camera-on|camera-off|focus|exit|diagnose-zoom>');
}

function diagnoseZoom() {
    const appControl = $.AXIsProcessTrusted();
    const zoomApps = [];
    for (const app of elements($.NSWorkspace.sharedWorkspace.runningApplications)) {
        const bundleID = ObjC.unwrap(app.bundleIdentifier) || '';
        if (app.isTerminated || !/zoom/i.test(bundleID)) continue;
        const result = {bundleID, recognizedBundle: runningKind(app) === 'Zoom'};
        if (!app.bundleURL.isNil()) {
            const bundle = $.NSBundle.bundleWithURL(app.bundleURL);
            result.version = ObjC.unwrap(bundle.objectForInfoDictionaryKey('CFBundleShortVersionString'));
        }
        zoomApps.push(result);
        if (!appControl) continue;
        try {
            const axApp = $.AXUIElementCreateApplication(app.processIdentifier);
            checkAX($.AXUIElementSetMessagingTimeout(axApp, 1), 'set an Accessibility timeout');
            attribute(axApp, 'AXRole');
            const focusedWindow = result.recognizedBundle ? attribute(axApp, 'AXFocusedWindow') : null;
            result.windows = elements(attribute(axApp, 'AXWindows')).map(window => {
                try {
                    return {...zoomWindowReport(window, result.recognizedBundle ? axApp : null),
                        focused: focusedWindow !== null && $.CFEqual(focusedWindow, window)};
                } catch (error) {
                    return {error: error.message};
                }
            });
            if (result.recognizedBundle) result.meetingMenu = zoomMenuReport(axApp);
        } catch (error) {
            result.error = error.message;
        }
    }
    const macOS = ObjC.unwrap($.NSProcessInfo.processInfo.operatingSystemVersionString);
    return JSON.stringify({macOS, appControl, zoomApps});
}

/** @param {object} window Zoom AXUIElement @param {object|null} [axApp] */
function zoomWindowReport(window, axApp = null) {
    const recognized = isMeetingWindow(window, 'Zoom', axApp);
    const markers = [];
    const identifiers = [];
    const roles = Object.create(null);
    for (const item of windowElements(window, 'Zoom')) {
        const role = ObjC.unwrap(attribute(item, 'AXRole'));
        if (role) roles[role] = (roles[role] || 0) + 1;
        const identifier = ObjC.unwrap(attribute(item, 'AXIdentifier'));
        if (typeof identifier === 'string' && /^(?:(?:us|com)\.zoom\.[a-z]|(?:Zoom|ZM|_?NS)[A-Z])[a-zA-Z._-]{0,79}$/.test(identifier)) {
            identifiers.push({role, identifier});
        }
        if (item === window || role === 'AXWindow') continue;
        for (const field of ['AXTitle', 'AXDescription', 'AXHelp']) {
            const label = ObjC.unwrap(attribute(item, field));
            if (typeof label === 'string' && (zoomLeaveHint.test(label.trim()) || labelMatches(label, zoomControlHints))) {
                markers.push({role, field, label});
            }
        }
    }
    const title = ObjC.unwrap(attribute(window, 'AXTitle'));
    const titleKind = typeof title === 'string' && title.trim()
        ? title.trim().match(/^zoom(?: workplace| meeting| webinar)?\b/i)?.[0].toLowerCase() || 'other'
        : null;
    const subrole = ObjC.unwrap(attribute(window, 'AXSubrole'));
    const minimized = ObjC.unwrap(attribute(window, 'AXMinimized'));
    const main = ObjC.unwrap(attribute(window, 'AXMain'));
    return {recognized, titleKind, subrole, minimized, main, roles, identifiers, markers};
}

/** @param {object} axApp AXUIElement for Zoom */
function zoomMenuReport(axApp) {
    const items = zoomMenuItems(axApp);
    const controls = [];
    for (const item of items) {
        if (ObjC.unwrap(attribute(item, 'AXRole')) !== 'AXMenuItem') continue;
        const title = ObjC.unwrap(attribute(item, 'AXTitle'));
        if (typeof title !== 'string' || !(labelMatches(title, zoomControlHints) || zoomLeaveHint.test(title.trim()))) continue;
        controls.push({title, enabled: ObjC.unwrap(attribute(item, 'AXEnabled')) === true});
    }
    return {itemCount: items.length, controls};
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

/** @param {number[]} ownerPIDs @param {number} frontPID @param {object[]} [zoomMisses] */
function chooseMeeting(ownerPIDs, frontPID, zoomMisses = []) {
    if (!ownerPIDs.length) {
        const details = zoomMisses.length ? ` Zoom detection: ${JSON.stringify(zoomMisses)}` : '';
        throw new Error(`No supported in-call window found. Join a meeting in the installed Meet app, Teams, or Zoom.${details}`);
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

/** @param {{app: object, kind: string}} candidate @param {object[]} zoomMisses */
function meetingWindows({app, kind}, zoomMisses) {
    const pid = app.processIdentifier;
    const axApp = $.AXUIElementCreateApplication(pid);
    checkAX($.AXUIElementSetMessagingTimeout(axApp, 1), 'set an Accessibility timeout');
    attribute(axApp, 'AXRole'); // Chrome's web app shim enables web accessibility on this query.
    const windows = elements(attribute(axApp, 'AXWindows'));
    if (kind === 'Zoom' && !windows.length) zoomMisses.push({reason: 'no-windows'});
    return windows
        .filter(window => isMeetingWindow(window, kind, axApp, zoomMisses))
        .map(window => ({app, kind, pid, axApp, window}));
}

/** @param {object} window AXUIElement @param {string} kind @param {object|null} [axApp] @param {object[]|null} [zoomMisses] */
function isMeetingWindow(window, kind, axApp = null, zoomMisses = null) {
    const zoomRoles = kind === 'Zoom' && axApp ? [] : null;
    for (const element of windowElements(window, kind)) {
        const role = ObjC.unwrap(attribute(element, 'AXRole'));
        if (zoomRoles && element !== window) zoomRoles.push(role);
        if (!buttonRoles.includes(role)) continue;
        if (kind === 'Teams' && ObjC.unwrap(attribute(element, 'AXDOMIdentifier')) === 'hangup-button') return true;
        if (elementMatches(element, labels[kind].leave)) return true;
    }
    // shortcut: only accept the observed Zoom window layout without a leave marker; revisit if Zoom exposes a stable identifier.
    if (!zoomRoles) return false;
    const buttons = zoomRoles.filter(role => role === 'AXButton').length;
    const tabGroups = zoomRoles.filter(role => role === 'AXTabGroup').length;
    if (zoomRoles.length !== 5 || buttons !== 4 || tabGroups !== 1) {
        const otherRoles = [...new Set(zoomRoles.filter(role => role !== 'AXButton' && role !== 'AXTabGroup'))];
        zoomMisses?.push({reason: 'layout', buttons, tabGroups, otherRoles});
        return false;
    }
    const subrole = ObjC.unwrap(attribute(window, 'AXSubrole'));
    if (subrole !== 'AXStandardWindow') {
        zoomMisses?.push({reason: 'subrole', subrole});
        return false;
    }
    if (ObjC.unwrap(attribute(window, 'AXMain')) !== true) {
        zoomMisses?.push({reason: 'not-main'});
        return false;
    }
    const controls = mediaControls({kind, axApp});
    for (const [control, matches] of [
        ['microphone', [...controls.mute, ...controls.unmute]],
        ['camera', [...controls['camera-on'], ...controls['camera-off']]],
    ]) {
        const enabled = matches.length === 1 && ObjC.unwrap(attribute(matches[0], 'AXEnabled')) === true;
        if (!enabled) {
            zoomMisses?.push({reason: 'menu', control, matches: matches.length, enabled});
            return false;
        }
    }
    return true;
}

/** @param {object} window AXUIElement @param {string} kind */
function* windowElements(window, kind) {
    const pending = [window];
    const deadline = Date.now() + 2500;
    while (pending.length) {
        if (Date.now() >= deadline) throw new Error(`Timed out reading ${kind}'s meeting window.`);
        const element = pending.pop();
        yield element;
        for (const child of elements(attribute(element, 'AXChildren'))) pending.push(child);
    }
}

/** @param {object} target Selected app and window */
function mediaControls(target) {
    const matches = {mute: [], unmute: [], 'camera-on': [], 'camera-off': []};
    const zoom = target.kind === 'Zoom';
    const available = zoom ? zoomMenuItems(target.axApp) : windowElements(target.window, target.kind);
    const roles = zoom ? ['AXMenuItem'] : buttonRoles;
    for (const element of available) {
        if (!roles.includes(ObjC.unwrap(attribute(element, 'AXRole')))) continue;
        for (const key of Object.keys(matches)) {
            if (elementMatches(element, labels[target.kind][key])
                && !matches[key].some(match => $.CFEqual(match, element))) matches[key].push(element);
        }
    }
    return matches;
}

/** @param {object} axApp AXUIElement for Zoom */
function zoomMenuItems(axApp) {
    // Zoom's window can contain identically named controls for other participants.
    const bar = attribute(axApp, 'AXMenuBar');
    if (!bar) return [];
    const headings = elements(attribute(bar, 'AXChildren')).filter(item =>
        ObjC.unwrap(attribute(item, 'AXRole')) === 'AXMenuBarItem' &&
        labelMatches(ObjC.unwrap(attribute(item, 'AXTitle')), ['meeting']));
    if (headings.length !== 1) return [];
    const menus = elements(attribute(headings[0], 'AXChildren'))
        .filter(item => ObjC.unwrap(attribute(item, 'AXRole')) === 'AXMenu');
    return menus.length === 1 ? elements(attribute(menus[0], 'AXChildren')) : [];
}

/** @param {object} element AXUIElement @param {string[]} expected */
function elementMatches(element, expected) {
    return labelMatches(ObjC.unwrap(attribute(element, 'AXTitle')), expected)
        || labelMatches(ObjC.unwrap(attribute(element, 'AXDescription')), expected);
}

/** @param {string|null} label @param {string[]} expected */
function labelMatches(label, expected) {
    return typeof label === 'string' &&
        expected.includes(label.trim().replace(/\s+\((?:[⌘⌃⌥⇧]\s*\+?\s*)+[a-z0-9]\)$/i, '').toLowerCase());
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
    const workspace = $.NSWorkspace.sharedWorkspace;
    if (!focused(workspace, target)) throw new Error('Focus changed before the meeting action.');
    const opposite = inverse[action];
    const [button] = controls[action];
    const enabled = button && ObjC.unwrap(attribute(button, 'AXEnabled')) === true;
    if (controlDecision(controls[action].length, controls[opposite].length, enabled) === 'unchanged') {
        return `Already set: ${action}.`;
    }
    const options = labels[target.kind];
    if (!elementMatches(button, options[action]) || elementMatches(button, options[opposite])) {
        throw new Error('The meeting control changed before it could be pressed. No press sent.');
    }
    if (target.kind === 'Meet') {
        sendMeetShortcut(workspace, target, action);
    } else {
        checkAX($.AXUIElementPerformAction(button, $('AXPress')), 'press the requested meeting control');
    }

    const sent = target.kind === 'Meet' ? 'Sent the Meet shortcut' : 'Pressed the meeting control';
    const failure = `${sent}, but could not confirm the requested state. Check the app before trying again.`;
    try {
        if (waitFor(() => {
            if (!focused(workspace, target)) throw new Error('Focus changed before confirmation.');
            const after = mediaControls(target);
            return after[action].length === 0 && after[opposite].length === 1;
        }, 1200)) return `Set: ${action}.`;
    } catch (error) {
        throw new Error(`${failure} ${error.message}`);
    }
    throw new Error(failure);
}

/** @param {object} workspace NSWorkspace @param {object} target Selected Meet app and window @param {string} action */
function sendMeetShortcut(workspace, target, action) {
    // Chromium can accept AXPress without activating the web button. Use Meet's shortcut after checking its state.
    const key = action === 'mute' || action === 'unmute' ? $.kVK_ANSI_D : $.kVK_ANSI_E;
    const down = $.CGEventCreateKeyboardEvent(null, Number(key), true);
    const up = $.CGEventCreateKeyboardEvent(null, Number(key), false);
    if (!down || !up) throw new Error('Could not create the Meet shortcut. No key sent.');
    $.CGEventSetFlags(down, Number($.kCGEventFlagMaskCommand));
    $.CGEventSetFlags(up, Number($.kCGEventFlagMaskCommand));
    if (!focused(workspace, target)) throw new Error('Focus changed before sending the Meet shortcut. No key sent.');
    $.CGEventPostToPid(target.pid, down);
    $.CGEventPostToPid(target.pid, up);
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
