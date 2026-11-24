// Append to meeting-ui.js and run with osascript -l JavaScript.
function run() {
    const shim = 'com.google.Chrome.app.dbpkegghbgplfeaapbejbnfpbgnbjedf';
    const meet = 'https://meet.google.com/';

    expect(appKind(shim, meet), 'Meet', 'installed Meet shim');
    expect(appKind('com.google.Chrome.app.otherinstallation', meet), 'Meet', 'another Meet installation');
    for (const id of ['com.google.Chrome', 'com.google.Chrome.app.', 'com.google.Chrome.helper']) {
        expect(appKind(id, meet), null, 'Chrome is not a Meet shim');
    }
    for (const url of ['https://calendar.google.com/', 'http://meet.google.com/',
        'https://meet.google.com.example.com/', 'https://example.com/meet.google.com',
        'https://meet.google.com@evil.example/', 'https://meet.google.com:8443/']) {
        expect(appKind(shim, url), null, 'not an HTTPS Meet start URL');
    }
    expect(appKind('com.microsoft.teams2', ''), 'Teams', 'Teams desktop');
    expect(appKind('us.zoom.xos', ''), 'Zoom', 'Zoom desktop');

    expect(chooseMeeting([101, 202], 202), 1, 'prefer the frontmost meeting app');
    expect(chooseMeeting([101], 999), 0, 'select the only background meeting');
    refuses(() => chooseMeeting([], 999), 'No supported');
    refuses(() => chooseMeeting([101, 202], 999), 'Multiple');
    refuses(() => chooseMeeting([101, 101], 101), 'Multiple');

    expect(controlDecision(1, 0, true), 'press', 'enabled control can set the requested state');
    expect(controlDecision(0, 1, false), 'unchanged', 'do not reverse an already-correct state');
    refuses(() => controlDecision(0, 0, false), 'verify');
    refuses(() => controlDecision(1, 1, true), 'verify');
    refuses(() => controlDecision(2, 0, true), 'verify');
    refuses(() => controlDecision(1, 0, false), 'disabled');

    expect(labelMatches('Turn on microphone (⌘ + D)', ['turn on microphone']), true, 'accept a shortcut hint');
    expect(labelMatches('Unmute mic', ['mute mic']), false, 'never confuse inverse actions');
    expect(labelMatches('Leave (not a shortcut ⌘)', ['leave']), false, 'ignore unrelated labels');
    expect(requestedAction(['diagnose-zoom']), 'diagnose-zoom', 'accept the read-only Zoom diagnostic');
    expect(requestedAction(['diagnose-teams']), 'diagnose-teams', 'accept the read-only Teams diagnostic');
    for (const args of [[], ['invalid'], ['mute', 'exit']]) refuses(() => requestedAction(args), 'Usage:');

    const chrome = {bundleIdentifier: $('com.google.Chrome'), get terminate() {
        throw new Error('Chrome received a quit request');
    }};
    refuses(() => quitMeeting(chrome, 'Meet'), 'No quit sent');
    testMeetingLock();
    testTeamsWebAccessibility();
    testControlScope();
    testMediaShortcuts();
    return 'Meeting decision tests passed.';
}

function testMeetingLock() {
    const path = ObjC.unwrap($.NSTemporaryDirectory()) + `shared-scripts-meeting-test-${$.NSProcessInfo.processInfo.processIdentifier}.lock`;
    try {
        let microphoneLive = true;
        const press = () => { microphoneLive = !microphoneLive; };
        withMeetingLock(path, () => {
            refuses(() => withMeetingLock(path, press), 'Another meeting shortcut');
            press();
        });
        expect(microphoneLive, false, 'an overlapping mute cannot press the toggle twice');
        refuses(() => withMeetingLock(path, () => { throw new Error('operation failed'); }), 'operation failed');
        expect(withMeetingLock(path, () => 'acquired'), 'acquired', 'an error releases the lock');
    } finally {
        $.NSFileManager.defaultManager.removeItemAtPathError(path, null);
    }
}

function testControlScope() {
    const savedAttribute = attribute;
    attribute = (node, key) => {
        const value = node[key];
        if (Array.isArray(value)) return {count: value.length, objectAtIndex: index => value[index]};
        return value ?? null;
    };
    try {
        const meetCall = {AXRole: 'AXButton', AXTitle: 'Leave call'};
        const idle = {AXRole: 'AXButton', AXTitle: 'Leave'};
        const background = [
            {pid: 101, window: {AXChildren: [meetCall, {AXRole: 'AXButton', AXTitle: 'Turn off camera'}]}},
            {pid: 202, window: {AXChildren: [meetCall]}},
        ];
        const eligible = background.filter(({window}) => isMeetingWindow(window, 'Meet')).map(({pid}) => pid);
        refuses(() => chooseMeeting(eligible, 999), 'Multiple');
        expect(isMeetingWindow(idle, 'Teams'), false, 'a generic Leave button can belong to a team, not a call');
        expect(isMeetingWindow({...idle, AXDOMIdentifier: 'hangup-button'}, 'Teams'), true, 'Teams hangup control proves a call');
        const teams = teamsWindowReport({
            AXRole: 'AXWindow', AXTitle: 'Private meeting title', AXMain: true, AXChildren: [{
                AXRole: 'AXWebArea', AXChildren: [
                    {AXRole: 'AXButton', AXTitle: 'Mute Private Person', AXDOMIdentifier: 'mute-private-person'},
                    {AXRole: 'AXButton', AXTitle: 'Leave (Cmd+Shift+H)', AXDOMIdentifier: 'hangup-button', AXEnabled: true},
                    {AXRole: 'AXButton', AXDescription: 'Turn on camera', AXDOMIdentifier: 'camera-button', AXEnabled: false},
                ],
            }],
        });
        expect(teams.recognized, true, 'diagnose the same Teams call marker as the shortcut');
        expect(teams.roles.AXWebArea, 1, 'report whether the Teams web view is exposed');
        expect(JSON.stringify(teams.controls), JSON.stringify([
            {role: 'AXButton', AXDOMIdentifier: 'camera-button', AXDescription: 'Turn on camera', enabled: false},
            {role: 'AXButton', AXDOMIdentifier: 'hangup-button', AXTitle: 'Leave (Cmd+Shift+H)', enabled: true},
        ]), 'report safe Teams control labels, identifiers, and enabled state');
        expect(JSON.stringify(teams).includes('Private'), false, 'omit private Teams content from the report');

        const participant = {AXRole: 'AXButton', AXTitle: 'Stop video'};
        const ownCamera = {AXRole: 'AXMenuItem', AXTitle: 'Start video', AXEnabled: true};
        const privateItem = {AXRole: 'AXMenuItem', AXTitle: 'Invite Private Person', AXEnabled: true};
        const zoom = {
            kind: 'Zoom',
            window: {AXChildren: [{AXRole: 'AXButton', AXTitle: 'End meeting'}, participant]},
            axApp: {AXMenuBar: {AXChildren: [
                {AXRole: 'AXMenuBarItem', AXTitle: 'Meeting',
                    AXChildren: [{AXRole: 'AXMenu', AXChildren: [ownCamera, privateItem]}]},
            ]}},
        };
        expect(isMeetingWindow(zoom.window, 'Zoom'), true, 'Zoom has a specific call marker');
        expect(zoomWindowReport(zoom.window).recognized, true, 'report an existing Zoom match');
        const unmatched = zoomWindowReport({
            AXRole: 'AXWindow', AXTitle: 'Zoom Meeting: Private meeting title', AXIdentifier: 'ZMMeetingWindow',
            AXMain: true, AXChildren: [
                {AXRole: 'AXButton', AXDescription: 'End (⌘ + W)', AXIdentifier: 'Jane Smith'},
                {AXRole: 'AXButton', AXTitle: 'Leave Jane Smith'},
                {AXRole: 'AXTabGroup', AXDescription: 'Meeting controls'},
            ],
        });
        expect(unmatched.recognized, false, 'diagnostics do not broaden Zoom detection');
        expect(unmatched.titleKind, 'zoom meeting', 'classify a window without sharing its title');
        expect(unmatched.roles.AXButton, 2, 'report even controls that have no known marker');
        expect(unmatched.main, true, 'report whether Zoom considers this its main window');
        expect(JSON.stringify(unmatched.identifiers),
            JSON.stringify([{role: 'AXWindow', identifier: 'ZMMeetingWindow'}]),
            'report a native-style identifier without printing arbitrary identifier text');
        expect(JSON.stringify(unmatched.markers),
            JSON.stringify([
                {role: 'AXTabGroup', field: 'AXDescription', label: 'Meeting controls'},
                {role: 'AXButton', field: 'AXDescription', label: 'End (⌘ + W)'},
            ]),
            'show candidate call markers without including unrelated labels');
        expect(JSON.stringify(unmatched).includes('Private meeting title'), false, 'omit the meeting title');
        expect(JSON.stringify(zoomMenuReport(zoom.axApp)),
            JSON.stringify({itemCount: 2, controls: [{title: 'Start video', enabled: true}]}),
            'diagnose Meeting menu availability and only report known control labels');
        const zoomControls = mediaControls(zoom);
        expect(zoomControls['camera-off'].length, 0, 'ignore another participant’s Stop video');
        expect(zoomControls['camera-on'][0], ownCamera, 'only use Zoom’s own Meeting menu command');

        const tabGroup = {AXRole: 'AXTabGroup'};
        const call = {AXRole: 'AXWindow', AXSubrole: 'AXStandardWindow', AXMain: true,
            AXChildren: [{AXRole: 'AXButton'}, {AXRole: 'AXButton'}, {AXRole: 'AXButton'},
                {AXRole: 'AXButton'}, tabGroup]};
        const mute = {AXRole: 'AXMenuItem', AXTitle: 'Mute audio', AXEnabled: true};
        const menu = zoom.axApp.AXMenuBar.AXChildren[0].AXChildren[0];
        menu.AXChildren.push(mute);
        for (const title of ['Zoom Meeting', 'Weekly sync', undefined]) {
            expect(isMeetingWindow({...call, AXTitle: title}, 'Zoom', zoom.axApp), true,
                'detect a verified Zoom call regardless of its title');
        }
        expect(isMeetingWindow({...call, AXChildren: [...call.AXChildren, {AXRole: 'AXStaticText'}]}, 'Zoom', zoom.axApp),
            true, 'static text does not disqualify a verified Zoom call');
        expect(zoomWindowReport(call, zoom.axApp).recognized, true, 'diagnostics use the same call detection');
        expect(isMeetingWindow({...call, AXMain: false}, 'Zoom', zoom.axApp), false,
            'do not target a secondary window with the same shape');
        const layoutMisses = [];
        expect(isMeetingWindow({...call, AXTitle: 'Private topic',
            AXChildren: [...call.AXChildren, {AXRole: 'AXGroup'}]}, 'Zoom', zoom.axApp, layoutMisses),
            false, 'an active menu does not qualify a window with a different structure');
        expect(JSON.stringify(layoutMisses),
            JSON.stringify([{reason: 'layout', buttons: 4, tabGroups: 1, otherRoles: ['AXGroup']}]),
            'capture the rejected structure without including the meeting title');
        refuses(() => chooseMeeting([], 999, {zoom: layoutMisses}), 'Zoom detection: [{"reason":"layout"');
        expect(isMeetingWindow(call, 'Zoom', {}), false, 'the window structure alone does not prove a call');
        mute.AXEnabled = false;
        const menuMisses = [];
        expect(isMeetingWindow(call, 'Zoom', zoom.axApp, menuMisses), false,
            'a disabled microphone command does not prove a call');
        expect(JSON.stringify(menuMisses),
            JSON.stringify([{reason: 'menu', control: 'microphone', matches: 1, enabled: false}]),
            'distinguish a disabled command from a missing command at the time of rejection');
        mute.AXEnabled = true;
        menu.AXChildren.push({...mute, AXTitle: 'Unmute audio'});
        expect(isMeetingWindow(call, 'Zoom', zoom.axApp), false, 'refuse contradictory Zoom menu controls');
    } finally {
        attribute = savedAttribute;
    }
}

function testTeamsWebAccessibility() {
    const savedAttribute = attribute;
    const savedCreate = $.AXUIElementCreateApplication;
    const savedTimeout = $.AXUIElementSetMessagingTimeout;
    const savedSet = $.AXUIElementSetAttributeValue;
    const savedWait = waitFor;
    const coldWindow = {AXRole: 'AXWindow', AXSubrole: 'AXStandardWindow'};
    const readyWindow = {...coldWindow, AXChildren: [{AXRole: 'AXWebArea', AXChildren: [
        {AXRole: 'AXButton', AXDOMIdentifier: 'hangup-button'},
    ]}]};
    const app = {AXWindows: [coldWindow]};
    const diagnostics = {zoom: [], teams: []};
    const scan = () => meetingWindows({app: {processIdentifier: 123}, kind: 'Teams'}, diagnostics);
    const requests = [];
    let publishWebView = true;
    attribute = (node, key) => {
        const value = node[key];
        return Array.isArray(value) ? {count: value.length, objectAtIndex: index => value[index]} : value ?? null;
    };
    $.AXUIElementCreateApplication = () => app;
    $.AXUIElementSetMessagingTimeout = () => 0;
    $.AXUIElementSetAttributeValue = (target, name, value) => {
        expect(target, app, 'scope the accessibility request to Teams');
        expect(ObjC.unwrap(value), true, 'request accessibility, never turn it off');
        const field = ObjC.unwrap(name);
        requests.push(field);
        return field === 'AXManualAccessibility' ? Number($.kAXErrorAttributeUnsupported) : Number($.kAXErrorNotImplemented);
    };
    waitFor = condition => {
        if (condition()) return true;
        if (publishWebView && requests.includes('AXEnhancedUserInterface')) app.AXWindows = [readyWindow];
        return condition();
    };
    try {
        expect(scan()[0]?.window, readyWindow,
            'reread Teams windows and verify the call when the web view appears after the request');
        expect(JSON.stringify(requests), JSON.stringify(['AXManualAccessibility', 'AXEnhancedUserInterface']),
            'try the Teams fallback even when manual accessibility is unsupported');
        scan();
        app.AXWindows = [{...coldWindow, AXChildren: [{AXRole: 'AXWebArea', AXChildren: [{AXRole: 'AXStaticText'}]}]}];
        expect(scan().length, 0, 'never treat the populated Teams home window as a call');
        expect(requests.length, 2, 'no accessibility write when the web view is already populated');
        publishWebView = false;
        app.AXWindows = [coldWindow];
        expect(scan().length, 0, 'refuse the call if the web view stays missing');
        refuses(() => chooseMeeting([], 999, diagnostics), '"AXEnhancedUserInterface":-25208');
    } finally {
        attribute = savedAttribute;
        $.AXUIElementCreateApplication = savedCreate;
        $.AXUIElementSetMessagingTimeout = savedTimeout;
        $.AXUIElementSetAttributeValue = savedSet;
        waitFor = savedWait;
    }
}

function testMediaShortcuts() {
    const savedAttribute = attribute;
    const savedFocused = focused;
    const savedPress = $.AXUIElementPerformAction;
    const savedPost = $.CGEventPostToPid;
    const target = {kind: 'Meet', pid: 123, window: {}};
    const button = {AXRole: 'AXButton', AXEnabled: true};
    const nodes = [button];
    const events = [];
    let newTitle;
    attribute = (node, key) => node === target.window && key === 'AXChildren'
        ? {count: nodes.length, objectAtIndex: index => nodes[index]}
        : node[key] ?? null;
    focused = () => true;
    $.AXUIElementPerformAction = () => 0; // Reproduce the accepted press with no state change.
    $.CGEventPostToPid = (pid, event) => {
        const type = $.CGEventGetType(event);
        events.push([pid, type, Number($.CGEventGetIntegerValueField(event, $.kCGKeyboardEventKeycode)),
            Number($.CGEventGetFlags(event))]);
        if (type === Number($.kCGEventKeyDown)) button.AXTitle = newTitle;
    };
    try {
        for (const [kind, action, before, after, keyCode, id] of [
            ['Meet', 'mute', 'Turn off microphone', 'Turn on microphone', 2],
            ['Meet', 'unmute', 'Turn on microphone', 'Turn off microphone', 2],
            ['Meet', 'camera-off', 'Turn off camera', 'Turn on camera', 14],
            ['Meet', 'camera-on', 'Turn on camera', 'Turn off camera', 14],
            ['Teams', 'mute', 'Mute mic', 'Unmute mic', 46, 'microphone-button'],
            ['Teams', 'unmute', 'Unmute mic', 'Mute mic', 46, 'microphone-button'],
            ['Teams', 'camera-off', 'Turn camera off', 'Turn camera on', 31, 'video-button'],
            ['Teams', 'camera-on', 'Turn camera on', 'Turn camera off', 31, 'video-button'],
        ]) {
            events.length = 0;
            newTitle = after;
            target.kind = kind;
            button.AXDOMIdentifier = id;
            button.AXTitle = before;
            expect(setControl(target, mediaControls(target), action), `Set: ${action}.`, `confirm changed ${kind} state`);
            expect(setControl(target, mediaControls(target), action), `Already set: ${action}.`, 'do not toggle twice');
            const flags = Number($.kCGEventFlagMaskCommand) | (kind === 'Teams' ? Number($.kCGEventFlagMaskShift) : 0);
            expect(JSON.stringify(events), JSON.stringify([[123, 10, keyCode, flags], [123, 11, keyCode, flags]]),
                `send one ${kind} shortcut to the meeting PID only`);
        }
        events.length = 0;
        nodes.push({AXRole: 'AXButton', AXTitle: 'Unmute mic', AXEnabled: true});
        button.AXDOMIdentifier = 'microphone-button';
        button.AXTitle = 'Mute mic';
        const controls = mediaControls(target);
        expect(controls.unmute.length, 0, 'ignore a Teams control without the own-mic identifier');
        const ambiguous = {...controls, mute: [button, button]};
        refuses(() => setControl(target, ambiguous, 'mute'), 'unique');
        let focusChecks = 0;
        focused = () => ++focusChecks === 1;
        refuses(() => setControl(target, controls, 'mute'), 'Focus changed');
        expect(events.length, 0, 'do not send a shortcut with ambiguous state or lost focus');
    } finally {
        attribute = savedAttribute;
        focused = savedFocused;
        $.AXUIElementPerformAction = savedPress;
        $.CGEventPostToPid = savedPost;
    }
}

/** @param {unknown} actual @param {unknown} expected @param {string} scenario */
function expect(actual, expected, scenario) {
    if (actual !== expected) throw new Error(`${scenario}: expected ${expected}, got ${actual}`);
}

/** @param {() => unknown} operation @param {string} message */
function refuses(operation, message) {
    try {
        operation();
    } catch (error) {
        expect(error.message.includes(message), true, `refusal: ${error.message}`);
        return;
    }
    throw new Error(`Operation should have refused: ${message}`);
}
