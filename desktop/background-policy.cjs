const BACKGROUND_SWITCHES = Object.freeze([
    "disable-background-timer-throttling",
    "disable-renderer-backgrounding",
    "disable-backgrounding-occluded-windows",
]);
const POWER_SAVE_BLOCKER_TYPE = "prevent-app-suspension";

function appendBackgroundSwitches(commandLine) {
    for (const name of BACKGROUND_SWITCHES) commandLine.appendSwitch(name);
}

function createPowerManagement(powerSaveBlocker, warn) {
    let blockerId = null;

    function start() {
        if (blockerId !== null) return blockerId;

        try {
            const candidateId = powerSaveBlocker.start(POWER_SAVE_BLOCKER_TYPE);
            if (!Number.isInteger(candidateId) || candidateId < 0 || !powerSaveBlocker.isStarted(candidateId)) {
                throw new Error("Electron powerSaveBlocker did not start");
            }
            blockerId = candidateId;
            return blockerId;
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            warn(`Background keepalive unavailable; continuing without suspend prevention: ${detail}`);
            return null;
        }
    }

    function stop() {
        if (blockerId === null) return false;

        const candidateId = blockerId;
        blockerId = null;
        if (!powerSaveBlocker.isStarted(candidateId)) return false;
        powerSaveBlocker.stop(candidateId);
        return true;
    }

    return Object.freeze({ start, stop });
}

module.exports = {
    BACKGROUND_SWITCHES,
    POWER_SAVE_BLOCKER_TYPE,
    appendBackgroundSwitches,
    createPowerManagement,
};
