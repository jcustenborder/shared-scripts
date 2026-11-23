// Append to meeting-ui.js to diagnose one Meet media action without changing production behavior.
const runMeetingAction = runAction;
/** @param {string} action */
runAction = action => {
    if (!Object.keys(inverse).includes(action)) throw new Error('Trace only supports mute, unmute, camera-on, and camera-off.');
    return runMeetingAction(action);
};

const readMeetingWindows = meetingWindows;
/** @param {{app: object, kind: string}} candidate */
meetingWindows = candidate => candidate.kind === 'Meet' ? readMeetingWindows(candidate) : [];

const readMediaControls = mediaControls;
const traceStart = Date.now();
let tracePhase = 'before press';
/** @param {object} target Selected Meet app and window */
mediaControls = target => {
    const start = Date.now();
    const controls = readMediaControls(target);
    const matches = Object.fromEntries(Object.entries(controls).map(([action, buttons]) => [action, buttons.length]));
    console.log(JSON.stringify({phase: tracePhase, atMs: start - traceStart, readMs: Date.now() - start, matches}));
    return controls;
};

const setMediaControl = setControl;
/** @param {object} target Selected Meet app and window @param {Record<string, object[]>} controls @param {string} action */
setControl = (target, controls, action) => {
    tracePhase = 'after press';
    try {
        return setMediaControl(target, controls, action);
    } catch (error) {
        if (error.message.startsWith('Pressed the meeting control, but could not confirm')) {
            // Leave the original result intact and check once more without pressing again.
            tracePhase = 'delayed read';
            try {
                $.NSThread.sleepForTimeInterval(2);
                if (focused($.NSWorkspace.sharedWorkspace, target)) mediaControls(target);
                else console.log('Skipped delayed read: the Meet window lost focus.');
            } catch (readError) {
                console.log(`Delayed read failed: ${readError.message}`);
            }
        }
        throw error;
    }
};
