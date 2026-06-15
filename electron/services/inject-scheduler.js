const ONE_HOUR_MS = 60 * 60 * 1000;

let _enabled = false;
let _timerId = null;
let _nextRunAt = null;
let _runInjection = null;
let _runInProgress = false;

function _notify(notify) {
    if (typeof notify === 'function') notify(getState());
}

function _cancelTimer() {
    if (_timerId !== null) { clearTimeout(_timerId); _timerId = null; }
    _nextRunAt = null;
}

function _scheduleNext(notify) {
    if (_timerId !== null) clearTimeout(_timerId);
    _nextRunAt = Date.now() + ONE_HOUR_MS;
    _timerId = setTimeout(async () => {
        _timerId = null;
        _nextRunAt = null;
        _runInProgress = true;
        try { if (_runInjection) await _runInjection(); } catch (_) {}
        _runInProgress = false;
        if (_enabled) _scheduleNext(notify);
        else _notify(notify);
    }, ONE_HOUR_MS);
    _notify(notify);
}

function _runNowThenSchedule(notify) {
    if (_runInProgress) return;
    _runInProgress = true;
    (async () => {
        try { if (_runInjection) await _runInjection(); } catch (_) {}
        _runInProgress = false;
        if (_enabled) _scheduleNext(notify);
        else _notify(notify);
    })();
}

// Call once at startup to wire in the injection runner.
function init(runFn) {
    _runInjection = runFn;
}

function setEnabled(enabled, notify) {
    const nextEnabled = Boolean(enabled);
    if (nextEnabled && _enabled && (_runInProgress || _timerId !== null)) {
        _notify(notify);
        return;
    }

    _enabled = nextEnabled;
    _cancelTimer();
    if (_enabled) {
        // Run once immediately, then schedule repeating 1-hour intervals.
        _runNowThenSchedule(notify);
        _notify(notify);
    } else {
        _notify(notify);
    }
}

function resetTimer(notify) {
    if (!_enabled) return;
    _cancelTimer();
    if (_runInProgress) {
        _notify(notify);
        return;
    }
    _scheduleNext(notify);
}

function getState() {
    return { enabled: _enabled, nextRunAt: _nextRunAt };
}

function _reset() {
    _cancelTimer();
    _enabled = false;
    _runInjection = null;
    _runInProgress = false;
}

module.exports = { init, setEnabled, resetTimer, getState, _reset };
