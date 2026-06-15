const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { run } = require('./lib/solver');
const {
    findTotalForAveragePrice,
    getValidAveragePriceCounts,
    getValueRange,
    prepareItems,
} = require('./lib/solver-inputs');

if (!isMainThread) {
    const { n, total, items, limit, dedupeTotalCells } = workerData;
    let found = 0;
    const seenTotalCells = new Set();

    function search(idx, rem, combo) {
        if (found >= limit) return;
        if (combo.length === n) {
            if (rem === 0) {
                const totalCells = combo.reduce((s, it) => s + it.cells, 0);
                if (dedupeTotalCells) {
                    if (seenTotalCells.has(totalCells)) return;
                    seenTotalCells.add(totalCells);
                }
                const label = combo.map(it => `${it.name}(${it.price} ${it.w}x${it.h})`).join(', ');
                parentPort.postMessage({ type: 'combo', n, label, totalCells, totalPrice: total - rem });
                found++;
            }
            return;
        }
        const left = n - combo.length;
        for (let i = idx; i < items.length; i++) {
            if (found >= limit) return;
            if (items[i].price * left > rem) break;
            search(i, rem - items[i].price, combo.concat(items[i]));
        }
    }

    search(0, total, []);
    parentPort.postMessage({ type: 'done', n, found });
    return;
}

const items = prepareItems(require('./collectibles.json'), x => x.quality === '紫', 'price');
const { min: minPrice, max: maxPrice } = getValueRange(items, 'price');

const args = process.argv.slice(2);
if (!args[0]) {
    console.log('Usage: node solve-purple-combo.js <avgPrice> [count] [dedupe-total-cells]');
    process.exit(0);
}

const avgPrice = parseFloat(args[0]);
const fixedCount = args[1] ? parseInt(args[1]) : 0;
const dedupeTotalCells = args.includes('dedupe-total-cells') || args.includes('--dedupe-total-cells');

const opts = {
    headerLabel: (n, total) => `Count=${n}, TotalPrice=${total}`,
    lineLabel: msg => `TotalCells=${msg.totalCells}, TotalPrice=${msg.totalPrice}, Count=${msg.n}: [${msg.label}]`,
};

if (fixedCount > 0) {
    const total = findTotalForAveragePrice(avgPrice, fixedCount);
    if (total === null) { console.log(`No valid total for avgPrice=${avgPrice} count=${fixedCount}`); process.exit(0); }
    if (total < minPrice * fixedCount || total > maxPrice * fixedCount) { console.log(`No solution: total=${total} out of range`); process.exit(0); }
    run([{ n: fixedCount, total, dedupeTotalCells }], items, __filename, opts);
} else {
    run(
        getValidAveragePriceCounts(avgPrice, items).map(entry => ({ ...entry, dedupeTotalCells })),
        items,
        __filename,
        opts
    );
}
