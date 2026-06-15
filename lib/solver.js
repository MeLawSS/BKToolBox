const { Worker } = require('worker_threads');
const os = require('os');

/**
 * @param {Array<{n: number, total: number, [key: string]: unknown}>} validCounts
 * @param {Array} items
 * @param {string} workerFile  __filename of the calling script
 * @param {{headerLabel: (n,total)=>string, lineLabel: (msg)=>string}} opts
 */
function parseGlobalLimit(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseConcurrency(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function run(validCounts, items, workerFile, opts, deps = {}) {
    const log = deps.log || console.log;
    const exit = deps.exit || process.exit;
    const WorkerImpl = deps.Worker || Worker;
    const env = deps.env || process.env;
    const envConcurrency = parseConcurrency(env.SOLVER_CONCURRENCY);
    const concurrency = deps.concurrency || envConcurrency || os.cpus().length;
    const globalLimit = deps.globalLimit !== undefined ? deps.globalLimit : parseGlobalLimit(env.LIMIT);
    const getLimit = deps.getLimit || ((n) => (globalLimit !== null ? globalLimit : (n <= 15 ? 60 : 10)));

    if (validCounts.length === 0) { log('No valid count found.'); exit(0); return; }

    const state = {};
    validCounts.forEach(({ n }) => state[n] = { done: false, found: 0, buffer: [] });

    let printIdx = 0;
    const headerPrinted = new Set();
    let hadWorkerFailure = false;

    function printHeader(n, total) {
        if (!headerPrinted.has(n)) {
            log(`\x1b[36m${opts.headerLabel(n, total)}\x1b[0m`);
            headerPrinted.add(n);
        }
    }

    function tryAdvance() {
        while (printIdx < validCounts.length) {
            const { n, total } = validCounts[printIdx];
            const s = state[n];
            if (s.buffer.length > 0) {
                printHeader(n, total);
                while (s.buffer.length > 0) log(`  ${s.buffer.shift()}`);
            }
            if (!s.done) break;
            if (s.found === 0 && !headerPrinted.has(n)) {
                printHeader(n, total);
                log('  (no combination found)');
            }
            printIdx++;
        }
        if (printIdx >= validCounts.length) exit(hadWorkerFailure ? 1 : 0);
    }

    function markFailure(n, errorText) {
        const s = state[n];
        if (!s) return;
        hadWorkerFailure = true;
        if (errorText) {
            s.buffer.push(errorText);
        }
        s.done = true;
    }

    function onMessage(msg) {
        const { n } = msg;
        const s = state[n];
        if (!s || printIdx >= validCounts.length) {
            return;
        }
        const currentN = validCounts[printIdx].n;
        if (msg.type === 'combo') {
            s.found++;
            const line = opts.lineLabel(msg);
            if (n === currentN) { printHeader(n, validCounts[printIdx].total); log(`  ${line}`); }
            else s.buffer.push(line);
        } else if (msg.type === 'done') {
            s.done = true;
            if (n === currentN) tryAdvance();
        }
    }

    let running = 0, queueIdx = 0;
    function startNext() {
        while (running < concurrency && queueIdx < validCounts.length) {
            const { n, total, ...workerOptions } = validCounts[queueIdx++];
            const limit = getLimit(n);
            running++;
            const w = new WorkerImpl(workerFile, { workerData: { n, total, items, limit, ...workerOptions } });
            let settled = false;
            function finishWorker(errorText = null, markFailed = false) {
                if (settled) return;
                settled = true;
                if (markFailed) {
                    markFailure(n, errorText);
                }
                running--;
                startNext();
                tryAdvance();
            }
            w.on('message', onMessage);
            w.on('error', (error) => {
                finishWorker(`  [worker error] ${error.message}`, true);
            });
            w.on('exit', (code) => {
                if (code !== 0) {
                    finishWorker(`  [worker exited with code ${code}]`, true);
                    return;
                }
                finishWorker();
            });
        }
    }
    startNext();
}

module.exports = { run };
