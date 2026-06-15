import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
    buildGameTableMetadata,
    buildGameLogPaths,
    parseAppInfo,
    parseAdsPlaybackReference,
    parsePlaybackBuffer,
    summarizePlayback
} from './watch-bidking-game-log.mjs';

function encodeVarint(value) {
    let n = BigInt(value);
    const bytes = [];
    do {
        let byte = Number(n & 0x7fn);
        n >>= 7n;
        if (n) byte |= 0x80;
        bytes.push(byte);
    } while (n);
    return Buffer.from(bytes);
}

function key(field, wireType) {
    return encodeVarint((field << 3) | wireType);
}

function intField(field, value) {
    return Buffer.concat([key(field, 0), encodeVarint(value)]);
}

function float32Field(field, value) {
    const body = Buffer.alloc(4);
    body.writeFloatLE(value, 0);
    return Buffer.concat([key(field, 5), body]);
}

function packedIntField(field, values) {
    const body = Buffer.concat(values.map((value) => encodeVarint(value)));
    return Buffer.concat([key(field, 2), encodeVarint(body.length), body]);
}

function stringField(field, value) {
    const body = Buffer.from(value, 'utf8');
    return Buffer.concat([key(field, 2), encodeVarint(body.length), body]);
}

function messageField(field, body) {
    return Buffer.concat([key(field, 2), encodeVarint(body.length), body]);
}

function writeLengthPrefixed(chunks) {
    const body = Buffer.concat(chunks);
    const length = Buffer.alloc(4);
    length.writeInt32LE(body.length, 0);
    return Buffer.concat([length, body]);
}

function int32LE(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32LE(value, 0);
    return buffer;
}

function int64LE(value) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64LE(BigInt(value), 0);
    return buffer;
}

describe('watch-bidking-game-log helpers', () => {
    it('parses Unity app.info company and product names', () => {
        expect(parseAppInfo('laolin\nBidKing')).toEqual({
            companyName: 'laolin',
            productName: 'BidKing'
        });
    });

    it('builds Windows LocalLow paths from a game root and environment', () => {
        const paths = buildGameLogPaths({
            gameRoot: 'D:\\SteamLibrary\\steamapps\\common\\BidKing',
            appInfo: 'laolin\nBidKing',
            env: {
                LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local'
            },
            platform: 'win32',
            pathModule: path.win32
        });

        expect(paths.persistentDataPath).toBe('C:\\Users\\me\\AppData\\LocalLow\\laolin\\BidKing');
        expect(paths.playerLogPath).toBe('C:\\Users\\me\\AppData\\LocalLow\\laolin\\BidKing\\Player.log');
        expect(paths.playbackPattern).toBe('C:\\Users\\me\\AppData\\LocalLow\\laolin\\BidKing\\*.playback');
    });

    it('parses NTFS ADS playback references from Windows trace paths', () => {
        const reference = parseAdsPlaybackReference(
            'C:\\Users\\Melo\\AppData\\LocalLow\\laolin\\BidKing\\4405:1178745290411251.playback'
        );

        expect(reference).toEqual({
            basePath: 'C:\\Users\\Melo\\AppData\\LocalLow\\laolin\\BidKing\\4405',
            streamName: '1178745290411251.playback',
            sourcePath: 'C:\\Users\\Melo\\AppData\\LocalLow\\laolin\\BidKing\\4405:1178745290411251.playback',
            gameUid: '4405:1178745290411251',
            mapId: 4405
        });

        expect(parseAdsPlaybackReference('C:\\Users\\Melo\\AppData\\LocalLow\\laolin\\BidKing\\1.playback')).toBeNull();
    });

    it('parses playback binary data and summarizes revealed game logs', () => {
        const priceLog = Buffer.concat([intField(1, 2), intField(2, 12345)]);
        const useItemLog = Buffer.concat([intField(1, 1), intField(2, 1061001)]);
        const userLog = Buffer.concat([
            intField(1, 9988),
            stringField(2, 'Alice'),
            intField(3, 101),
            messageField(4, useItemLog),
            messageField(5, priceLog)
        ]);
        const skillLog = Buffer.concat([
            intField(1, 7001),
            intField(4, 1056013),
            intField(6, 2),
            intField(12, 45678)
        ]);
        const gameData = Buffer.concat([
            stringField(1, 'game-1'),
            intField(2, 12),
            intField(3, 3),
            messageField(5, userLog),
            messageField(8, skillLog)
        ]);
        const playback = Buffer.concat([
            writeLengthPrefixed([gameData]),
            int32LE(0),
            int64LE(9988)
        ]);

        const parsed = parsePlaybackBuffer(playback, 'game-1.playback');
        const summary = summarizePlayback(parsed);

        expect(summary.gameUid).toBe('game-1');
        expect(summary.mapId).toBe(12);
        expect(summary.round).toBe(3);
        expect(summary.winnerUid).toBe('9988');
        expect(summary.players[0]).toMatchObject({
            userUid: '9988',
            name: 'Alice',
            heroCid: 101,
            priceLog: [{ round: 2, value: 12345 }],
            useItemLog: [{ round: 1, value: 1061001 }]
        });
        expect(summary.itemSkills[0]).toMatchObject({
            skillCid: 7001,
            itemCid: 1056013,
            castRound: 2,
            hitItemTotalPrice: 45678
        });
    });

    it('parses full item skill reveal fields and enriches hit boxes from game tables', () => {
        const hitBox = Buffer.concat([
            intField(1, 17),
            intField(2, 901234567890123),
            intField(3, 1043008),
            intField(4, 1),
            packedIntField(5, [104]),
            intField(6, 3),
            intField(7, 2363),
            intField(8, 2)
        ]);
        const skillLog = Buffer.concat([
            intField(1, 603),
            intField(4, 100130),
            intField(6, 4),
            intField(7, 2),
            messageField(8, hitBox),
            float32Field(9, 4238.75),
            float32Field(10, 2825.833251953125),
            float32Field(11, 1.5),
            intField(12, 16955),
            intField(13, 720386274725658),
            intField(14, 6),
            packedIntField(15, [104, 108]),
            packedIntField(16, [3, 5])
        ]);
        const gameData = Buffer.concat([
            stringField(1, '4403:961935884974190'),
            intField(2, 4403),
            intField(3, 4),
            messageField(8, skillLog)
        ]);
        const playback = Buffer.concat([
            writeLengthPrefixed([gameData]),
            int32LE(0),
            int64LE(720386274725658)
        ]);
        const metadata = buildGameTableMetadata(
            path.join(process.cwd(), 'Archive', 'BidKing', 'BidKing_Data', 'StreamingAssets', 'Tables')
        );

        const summary = summarizePlayback(parsePlaybackBuffer(playback, '4403.playback'), { metadata });
        const skill = summary.itemSkills[0];

        expect(skill).toMatchObject({
            skillCid: 603,
            itemCid: 100130,
            itemName: '随机抽检（4）',
            castRound: 4,
            hitItemIndex: 2,
            hitItemTotalPrice: 16955,
            uid: '720386274725658',
            totalHitBoxIndex: 6,
            hitItemTypeList: [104, 108],
            hitItemTypeNames: ['武器装备', '交通工具'],
            hitItemQuilityList: [3, 5],
            hitItemQuilityNames: ['蓝', '金']
        });
        expect(skill.allHitItemAvgPrice).toBeCloseTo(4238.75);
        expect(skill.allHitBoxAvgPrice).toBeCloseTo(2825.833251953125);
        expect(skill.allHitItemAvgBoxIndex).toBeCloseTo(1.5);
        expect(skill.hitBoxList[0]).toMatchObject({
            boxId: 17,
            itemUid: '901234567890123',
            itemCid: 1043008,
            itemName: 'C4吸塑炸药',
            itemType: [104],
            itemTypeNames: ['武器装备'],
            itemQuility: 3,
            itemQuilityName: '蓝',
            itemPrice: 2363,
            itemBoxIndex: 2,
            size: { width: 2, height: 1, key: '2x1', cells: 2 }
        });
    });

    it('preserves protobuf default box id zero when the box id field is omitted', () => {
        const hitBox = Buffer.concat([
            intField(2, 901234567890124),
            intField(4, 11)
        ]);
        const skillLog = Buffer.concat([
            intField(1, 1002081),
            messageField(8, hitBox)
        ]);
        const gameData = Buffer.concat([
            stringField(1, '2106:1178745627867965'),
            intField(2, 2106),
            messageField(6, skillLog)
        ]);
        const playback = Buffer.concat([
            writeLengthPrefixed([gameData]),
            int32LE(0),
            int64LE(0)
        ]);

        const summary = summarizePlayback(parsePlaybackBuffer(playback, '2106.playback'));

        expect(summary.heroSkills[0].hitBoxList[0]).toMatchObject({
            boxId: 0,
            itemUid: '901234567890124',
            itemSlotType: 11
        });
    });
});
