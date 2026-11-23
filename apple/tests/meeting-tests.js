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
    expect(inCall({leave: [{}], mute: [], unmute: [], 'camera-on': [], 'camera-off': []}),
        false, 'a generic Leave button alone does not identify a call');
    expect(inCall({leave: [{}], mute: [{}], unmute: [], 'camera-on': [], 'camera-off': []}),
        true, 'a Leave button and personal media control identify a call');
    for (const args of [[], ['invalid'], ['mute', 'exit']]) refuses(() => requestedAction(args), 'Usage:');

    const chrome = {bundleIdentifier: $('com.google.Chrome'), terminate: () => {
        throw new Error('Chrome received a quit request');
    }};
    refuses(() => quitMeeting(chrome, 'Meet'), 'No quit sent');
    return 'Meeting decision tests passed.';
}

function expect(actual, expected, scenario) {
    if (actual !== expected) throw new Error(`${scenario}: expected ${expected}, got ${actual}`);
}

function refuses(operation, message) {
    try {
        operation();
    } catch (error) {
        expect(error.message.includes(message), true, `refusal: ${error.message}`);
        return;
    }
    throw new Error(`Operation should have refused: ${message}`);
}
