const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { run } = require('./lib/solver');
const {
    findTotalForAveragePrice,
    getValueRange,
} = require('./lib/solver-inputs');

function prepareAllItems(collectibles) {
    return collectibles
        .map(item => ({
            name: item.name,
            quality: item.quality,
            type: item.type,
            price: item.price,
            w: item.size.width,
            h: item.size.height,
            cells: item.size.width * item.size.height,
        }))
        .sort((a, b) => a.price - b.price);
}

if (!isMainThread) {
    const { n, total, items, limit, dedupeGoldRed } = workerData;
    let found = 0;
    const seenGoldRedKeys = new Set();

    function getGoldRedKey(combo) {
        return combo
            .filter(it => it.quality === '金' || it.quality === '红')
            .map(it => `${it.quality}:${it.name}:${it.price}:${it.w}x${it.h}`)
            .sort()
            .join('|');
    }

    function search(idx, rem, combo) {
        if (found >= limit) return;
        if (combo.length === n) {
            if (rem === 0) {
                if (dedupeGoldRed) {
                    const key = getGoldRedKey(combo);
                    if (seenGoldRedKeys.has(key)) return;
                    seenGoldRedKeys.add(key);
                }
                const label = combo
                    .map(it => `${it.name}(${it.quality} ${it.price} ${it.w}x${it.h})`)
                    .join(', ');
                const totalCells = combo.reduce((s, it) => s + it.cells, 0);
                parentPort.postMessage({ type: 'combo', n, label, totalCells, totalPrice: total - rem });
                found++;
            }
            return;
        }

        const left = n - combo.length;
        if (idx >= items.length) return;
        if (items[idx].price * left > rem) return;
        if (items[items.length - 1].price * left < rem) return;

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
    console.log('Usage: node solve-average-price-combo.js <count> <avgPrice> [dedupe-gold-red]');
    process.exit(0);
}

const fixedCount = parseInt(args[0], 10);
const avgPrice = parseFloat(args[1]);
const dedupeGoldRed = args.includes('dedupe-gold-red') || args.includes('--dedupe-gold-red');

if (!Number.isSafeInteger(fixedCount) || fixedCount <= 0) {
    console.log(`Invalid count: ${args[0]}`);
    process.exit(0);
}

if (!Number.isFinite(avgPrice) || avgPrice <= 0) {
    console.log(`Invalid avgPrice: ${args[1]}`);
    process.exit(0);
}

const items = prepareAllItems(require('./collectibles.json'));
const { min: minPrice, max: maxPrice } = getValueRange(items, 'price');
const total = findTotalForAveragePrice(avgPrice, fixedCount);

if (total === null) {
    console.log(`No valid total for avgPrice=${avgPrice} count=${fixedCount}`);
    process.exit(0);
}

if (total < minPrice * fixedCount || total > maxPrice * fixedCount) {
    console.log(`No solution: total=${total} out of range`);
    process.exit(0);
}

run(
    [{ n: fixedCount, total, dedupeGoldRed }],
    items,
    __filename,
    {
        headerLabel: (n, value) => `Count=${n}, TotalPrice=${value}`,
        lineLabel: msg => `TotalCells=${msg.totalCells}, TotalPrice=${msg.totalPrice}, Count=${msg.n}: [${msg.label}]`,
    }
);
