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
    for (const args of [[], ['invalid'], ['mute', 'exit']]) refuses(() => requestedAction(args), 'Usage:');

    const chrome = {bundleIdentifier: $('com.google.Chrome'), get terminate() {
        throw new Error('Chrome received a quit request');
    }};
    refuses(() => quitMeeting(chrome, 'Meet'), 'No quit sent');
    testMeetingLock();
    testControlScope();
    testMeetMediaActions();
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
        expect(zoomWindowReport(call, zoom.axApp).recognized, true, 'diagnostics use the same call detection');
        expect(isMeetingWindow({...call, AXMain: false}, 'Zoom', zoom.axApp), false,
            'do not target a secondary window with the same shape');
        expect(isMeetingWindow({...call, AXChildren: [...call.AXChildren, {AXRole: 'AXGroup'}]}, 'Zoom', zoom.axApp),
            false, 'an active menu does not qualify a window with a different structure');
        expect(isMeetingWindow(call, 'Zoom', {}), false, 'the window structure alone does not prove a call');
        mute.AXEnabled = false;
        expect(isMeetingWindow(call, 'Zoom', zoom.axApp), false, 'a disabled microphone command does not prove a call');
        mute.AXEnabled = true;
        menu.AXChildren.push({...mute, AXTitle: 'Unmute audio'});
        expect(isMeetingWindow(call, 'Zoom', zoom.axApp), false, 'refuse contradictory Zoom menu controls');
    } finally {
        attribute = savedAttribute;
    }
}

function testMeetMediaActions() {
    const savedAttribute = attribute;
    const savedFocused = focused;
    const savedPress = $.AXUIElementPerformAction;
    const savedPost = $.CGEventPostToPid;
    const target = {kind: 'Meet', pid: 123, window: {}};
    const button = {AXRole: 'AXButton', AXEnabled: true};
    const events = [];
    let newTitle;
    attribute = (node, key) => node === target.window && key === 'AXChildren'
        ? {count: 1, objectAtIndex: () => button}
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
        for (const [action, before, after, keyCode] of [
            ['mute', 'Turn off microphone', 'Turn on microphone', 2],
            ['unmute', 'Turn on microphone', 'Turn off microphone', 2],
            ['camera-off', 'Turn off camera', 'Turn on camera', 14],
            ['camera-on', 'Turn on camera', 'Turn off camera', 14],
        ]) {
            events.length = 0;
            newTitle = after;
            button.AXTitle = before;
            expect(setControl(target, mediaControls(target), action), `Set: ${action}.`, 'confirm changed Meet state');
            expect(setControl(target, mediaControls(target), action), `Already set: ${action}.`, 'do not toggle twice');
            const command = Number($.kCGEventFlagMaskCommand);
            expect(JSON.stringify(events), JSON.stringify([[123, 10, keyCode, command], [123, 11, keyCode, command]]),
                'send one Command shortcut to the Meet PID only');
        }
        events.length = 0;
        button.AXTitle = 'Turn off microphone';
        const controls = mediaControls(target);
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
