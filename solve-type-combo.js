const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { run } = require('./lib/solver');
const {
    findTotalForAveragePrice,
    getValidAveragePriceCounts,
    getValueRange,
    prepareItems,
} = require('./lib/solver-inputs');

if (!isMainThread) {
    const { n, total, items, limit } = workerData;
    let found = 0;

    function search(idx, rem, combo) {
        if (found >= limit) return;
        if (combo.length === n) {
            if (rem === 0) {
                const label = combo.map(it => `${it.name}(${it.price} ${it.w}x${it.h})`).join(', ');
                const totalCells = combo.reduce((s, it) => s + it.cells, 0);
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

const args = process.argv.slice(2);
if (!args[0] || !args[1]) {
    console.log('Usage: node solve-type-combo.js <type> <avgPrice> [count]');
    process.exit(0);
}

const type = args[0];
const avgPrice = parseFloat(args[1]);
const fixedCount = args[2] ? parseInt(args[2]) : 0;

const items = prepareItems(require('./collectibles.json'), x => x.type === type, 'price');

if (items.length === 0) { console.log(`No items found for type: ${type}`); process.exit(0); }

const { min: minPrice, max: maxPrice } = getValueRange(items, 'price');

const opts = {
    headerLabel: (n, total) => `Count=${n}, TotalPrice=${total}`,
    lineLabel: msg => `TotalCells=${msg.totalCells}, TotalPrice=${msg.totalPrice}, Count=${msg.n}: [${msg.label}]`,
};

if (fixedCount > 0) {
    const total = findTotalForAveragePrice(avgPrice, fixedCount);
    if (total === null) { console.log(`No valid total for avgPrice=${avgPrice} count=${fixedCount}`); process.exit(0); }
    if (total < minPrice * fixedCount || total > maxPrice * fixedCount) { console.log('Out of range'); process.exit(0); }
    run([{ n: fixedCount, total }], items, __filename, opts);
} else {
    run(getValidAveragePriceCounts(avgPrice, items), items, __filename, opts);
}
