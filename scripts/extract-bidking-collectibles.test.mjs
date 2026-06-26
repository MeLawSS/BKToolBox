import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
    buildTypeMap,
    extractCollectibles,
    itemRowToCollectible,
    parseIdList,
    parseSize,
    parseTable,
    summarizeCollectibles
} = require('./extract-bidking-collectibles.js');

describe('extract-bidking-collectibles helpers', () => {
    function createItemRow({
        itemCid,
        name,
        typeId,
        sizeCode,
        qualityId,
        price
    }) {
        const row = [];
        row[0] = String(itemCid);
        row[1] = name;
        row[6] = `[${typeId}]`;
        row[7] = sizeCode;
        row[8] = String(qualityId);
        row[9] = String(price);
        row[24] = `icon_${itemCid}`;
        return row.join('\t');
    }

    it('parses base table rows and bracket id lists', () => {
        expect(parseTable('1\tItem\r\n2\tOther\n')).toEqual([
            ['1', 'Item'],
            ['2', 'Other']
        ]);
        expect(parseIdList('[106,101]')).toEqual([106, 101]);
    });

    it('converts collectible item rows using the game table columns', () => {
        const typeRows = Array.from({ length: 10 }, (_, index) => {
            const id = 101 + index;
            return [String(id), 'Item', `Type ${id}`];
        });
        const typeMap = buildTypeMap(typeRows);
        const row = [];
        row[0] = '1011001';
        row[1] = '数据线';
        row[6] = '[101,107]';
        row[7] = '11';
        row[8] = '1';
        row[9] = '160';
        row[24] = 'icon_1011001';

        expect(itemRowToCollectible(row, typeMap)).toEqual({
            itemCid: 1011001,
            name: '数据线',
            quality: '白',
            type: 'Type 101',
            price: 160,
            image: '/assets/bidking/icons/icon_1011001.png',
            size: {
                width: 1,
                height: 1,
                key: '1x1'
            }
        });
    });

    it('skips non-collectible rows and summarizes generated data', () => {
        const typeRows = Array.from({ length: 10 }, (_, index) => {
            const id = 101 + index;
            return [String(id), 'Item', `Type ${id}`];
        });
        const typeMap = buildTypeMap(typeRows);
        const row = [];
        row[0] = '1';
        row[6] = '[1]';

        expect(itemRowToCollectible(row, typeMap)).toBeNull();
        expect(
            summarizeCollectibles([
                { type: '家居日用', quality: '白' },
                { type: '家居日用', quality: '白' },
                { type: '医疗用品', quality: '绿' }
            ])
        ).toEqual({
            count: 3,
            byType: {
                家居日用: 2,
                医疗用品: 1
            },
            byQuality: {
                白: 2,
                绿: 1
            }
        });
    });

    it('rejects invalid size codes', () => {
        expect(parseSize('31', 'item')).toEqual({
            width: 3,
            height: 1,
            key: '3x1'
        });
        expect(() => parseSize('0', 'item')).toThrow(/Invalid size code/);
        expect(() => parseSize('10', 'item')).toThrow(/Invalid size dimensions/);
    });

    it('extracts the latest collectibles added by the current game tables', () => {
        const tablesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-collectibles-latest-'));
        const typeRows = Array.from({ length: 10 }, (_, index) => {
            const id = 101 + index;
            return `${id}\tItem\tType ${id}`;
        }).join('\n');
        const itemRows = [
            createItemRow({ itemCid: 1016007, name: '白藏品', typeId: 101, sizeCode: '11', qualityId: 1, price: 100 }),
            createItemRow({ itemCid: 1036006, name: '蓝藏品 A', typeId: 103, sizeCode: '12', qualityId: 3, price: 200 }),
            createItemRow({ itemCid: 1036007, name: '蓝藏品 B', typeId: 103, sizeCode: '21', qualityId: 3, price: 300 }),
            createItemRow({ itemCid: 1036008, name: '蓝藏品 C', typeId: 103, sizeCode: '22', qualityId: 3, price: 400 }),
            createItemRow({ itemCid: 1076007, name: '武器藏品', typeId: 107, sizeCode: '31', qualityId: 5, price: 500 })
        ].join('\n');

        try {
            fs.writeFileSync(path.join(tablesDir, 'Item_Type.txt'), `${typeRows}\n`);
            fs.writeFileSync(path.join(tablesDir, 'Item.txt'), `${itemRows}\n`);

            const collectibles = extractCollectibles(tablesDir);
            const itemCids = new Set(collectibles.map((item) => Number(item.itemCid)));

            expect(itemCids.has(1016007)).toBe(true);
            expect(itemCids.has(1036006)).toBe(true);
            expect(itemCids.has(1036007)).toBe(true);
            expect(itemCids.has(1036008)).toBe(true);
            expect(itemCids.has(1076007)).toBe(true);
        } finally {
            fs.rmSync(tablesDir, { recursive: true, force: true });
        }
    });

    it('extracts collectibles from raw TSV tables without base64 wrapping', () => {
        const tablesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-collectibles-raw-'));
        const typeRows = Array.from({ length: 10 }, (_, index) => {
            const id = 101 + index;
            return `${id}\tItem\tType ${id}`;
        }).join('\n');
        const row = [];
        row[0] = '1011001';
        row[1] = '数据线';
        row[6] = '[101,107]';
        row[7] = '11';
        row[8] = '1';
        row[9] = '160';
        row[24] = 'icon_1011001';
        const itemRows = `${row.join('\t')}\n`;

        try {
            fs.writeFileSync(path.join(tablesDir, 'Item_Type.txt'), `${typeRows}\n`);
            fs.writeFileSync(path.join(tablesDir, 'Item.txt'), itemRows);

            expect(extractCollectibles(tablesDir)).toEqual([
                {
                    itemCid: 1011001,
                    name: '数据线',
                    quality: '白',
                    type: 'Type 101',
                    price: 160,
                    image: '/assets/bidking/icons/icon_1011001.png',
                    size: {
                        width: 1,
                        height: 1,
                        key: '1x1'
                    }
                }
            ]);
        } finally {
            fs.rmSync(tablesDir, { recursive: true, force: true });
        }
    });
});
