const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const defaultTablesDir = path.join(
    projectRoot,
    'Archive',
    'BidKing',
    'BidKing_Data',
    'StreamingAssets',
    'Tables'
);
const outputFiles = [
    path.join(projectRoot, 'collectibles.json'),
    path.join(projectRoot, 'public', 'data', 'collectibles.json')
];

const collectibleTypeStart = 101;
const collectibleTypeEnd = 110;
const qualityById = {
    1: '白',
    2: '绿',
    3: '蓝',
    4: '紫',
    5: '金',
    6: '红'
};

function parseTable(text) {
    const normalized = text.replace(/^\uFEFF/, '').trim();
    if (!normalized) {
        return [];
    }

    return normalized.split(/\r?\n/).map((line) => line.split('\t'));
}

function decodeBase64Table(filePath) {
    const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!content) {
        return [];
    }

    if (content.includes('\t')) {
        return parseTable(content);
    }

    return parseTable(Buffer.from(content, 'base64').toString('utf8'));
}

function parseIdList(value) {
    return [...String(value || '').matchAll(/\d+/g)].map((match) => Number(match[0]));
}

function parseSize(sizeCode, itemId) {
    const normalized = String(sizeCode || '').trim();
    if (!/^\d{2}$/.test(normalized)) {
        throw new Error(`Invalid size code for item ${itemId}: ${sizeCode}`);
    }

    const width = Number(normalized[0]);
    const height = Number(normalized[1]);
    if (!width || !height) {
        throw new Error(`Invalid size dimensions for item ${itemId}: ${sizeCode}`);
    }

    return {
        width,
        height,
        key: `${width}x${height}`
    };
}

function isCollectibleType(typeId) {
    return typeId >= collectibleTypeStart && typeId <= collectibleTypeEnd;
}

function buildTypeMap(typeRows) {
    const typeMap = new Map();

    for (const row of typeRows) {
        const typeId = Number(row[0]);
        if (isCollectibleType(typeId)) {
            typeMap.set(typeId, row[2]);
        }
    }

    const expectedCount = collectibleTypeEnd - collectibleTypeStart + 1;
    if (typeMap.size !== expectedCount) {
        throw new Error(`Expected ${expectedCount} collectible types, found ${typeMap.size}`);
    }

    return typeMap;
}

function itemRowToCollectible(row, typeMap) {
    const id = row[0];
    const primaryTypeId = parseIdList(row[6])[0];
    const type = typeMap.get(primaryTypeId);
    if (!type) {
        return null;
    }

    const quality = qualityById[row[8]];
    if (!quality) {
        throw new Error(`Unknown quality for item ${id}: ${row[8]}`);
    }

    const price = Number(row[9]);
    if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`Invalid price for item ${id}: ${row[9]}`);
    }

    const icon = row[24];
    if (!icon) {
        throw new Error(`Missing icon for item ${id}`);
    }

    return {
        itemCid: Number(id),
        name: row[1],
        quality,
        type,
        price,
        image: `/assets/bidking/icons/${icon}.png`,
        size: parseSize(row[7], id)
    };
}

function extractCollectibles(tablesDir = defaultTablesDir) {
    const typeRows = decodeBase64Table(path.join(tablesDir, 'Item_Type.txt'));
    const itemRows = decodeBase64Table(path.join(tablesDir, 'Item.txt'));
    const typeMap = buildTypeMap(typeRows);

    return itemRows
        .map((row) => itemRowToCollectible(row, typeMap))
        .filter(Boolean);
}

function writeCollectibles(collectibles, files = outputFiles) {
    const content = `${JSON.stringify(collectibles, null, 2)}\n`;
    for (const filePath of files) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
    }
}

function summarizeCollectibles(collectibles) {
    const byType = {};
    const byQuality = {};

    for (const item of collectibles) {
        byType[item.type] = (byType[item.type] || 0) + 1;
        byQuality[item.quality] = (byQuality[item.quality] || 0) + 1;
    }

    return {
        count: collectibles.length,
        byType,
        byQuality
    };
}

function main() {
    const tablesDir = process.argv[2] ? path.resolve(process.argv[2]) : defaultTablesDir;
    const collectibles = extractCollectibles(tablesDir);
    writeCollectibles(collectibles);

    const summary = summarizeCollectibles(collectibles);
    console.log(`Extracted ${summary.count} collectibles from ${tablesDir}`);
    console.log(`Wrote ${outputFiles.map((filePath) => path.relative(projectRoot, filePath)).join(', ')}`);
}

if (require.main === module) {
    main();
}

module.exports = {
    buildTypeMap,
    extractCollectibles,
    itemRowToCollectible,
    parseIdList,
    parseSize,
    parseTable,
    summarizeCollectibles,
    writeCollectibles
};
