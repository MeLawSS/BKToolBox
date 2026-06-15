const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { run } = require('./lib/solver');
const {
    getValidTotalValueCounts,
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
                parentPort.postMessage({ type: 'combo', n, label, totalCells, totalPrice: total });
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

const items = prepareItems(require('./collectibles.json'), x => x.quality === '金', 'price');

const args = process.argv.slice(2);
if (!args[0]) {
    console.log('Usage: node solve-gold-total.js <totalPrice>');
    process.exit(0);
}

const totalPrice = parseInt(args[0]);

const opts = {
    headerLabel: (n, total) => `Count=${n}, TotalPrice=${total}`,
    lineLabel: msg => `TotalCells=${msg.totalCells}, TotalPrice=${msg.totalPrice}, Count=${msg.n}: [${msg.label}]`,
};

run(getValidTotalValueCounts(totalPrice, items), items, __filename, opts);
