const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { run } = require('./lib/solver');
const {
    getValidRoundedAverageCounts,
    getValueRange,
    isValidRoundedAverage,
    prepareItems,
} = require('./lib/solver-inputs');

if (!isMainThread) {
    const { n, total, items, limit } = workerData;
    let found = 0;

    function search(idx, rem, combo) {
        if (found >= limit) return;
        if (combo.length === n) {
            if (rem === 0) {
                const label = combo.map(it => `${it.name}(${it.w}x${it.h})`).join(', ');
                const totalCells = combo.reduce((s, it) => s + it.cells, 0);
                const totalPrice = combo.reduce((s, it) => s + it.price, 0);
                parentPort.postMessage({ type: 'combo', n, label, totalCells, totalPrice });
                found++;
            }
            return;
        }
        const left = n - combo.length;
        for (let i = idx; i < items.length; i++) {
            if (found >= limit) return;
            if (items[i].cells * left > rem) break;
            search(i, rem - items[i].cells, combo.concat(items[i]));
        }
    }

    search(0, total, []);
    parentPort.postMessage({ type: 'done', n, found });
    return;
}

const items = prepareItems(require('./collectibles.json'), x => x.quality === '金', 'cells');
const { min: minCells, max: maxCells } = getValueRange(items, 'cells');

const args = process.argv.slice(2);
if (!args[0]) {
    console.log('Usage: node solve-gold-grid.js <avgCells> [count]');
    process.exit(0);
}

const avgCells = parseFloat(args[0]);
const fixedCount = args[1] ? parseInt(args[1]) : 0;

const opts = {
    headerLabel: (n, total) => `Count=${n}, TotalCells=${total}`,
    lineLabel: msg => `TotalCells=${msg.totalCells}, TotalPrice=${msg.totalPrice}, Count=${msg.n}: [${msg.label}]`,
};

if (fixedCount > 0) {
    const raw = avgCells * fixedCount;
    const total = Math.round(raw);
    if (!isValidRoundedAverage(raw, fixedCount)) { console.log(`No valid total for avgCells=${avgCells} count=${fixedCount}`); process.exit(0); }
    if (total < minCells * fixedCount || total > maxCells * fixedCount) { console.log('Out of range'); process.exit(0); }
    run([{ n: fixedCount, total }], items, __filename, opts);
} else {
    run(getValidRoundedAverageCounts(avgCells, items), items, __filename, opts);
}
