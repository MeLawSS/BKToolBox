#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const DEFAULT_INTERVAL_MS = 1000;
const execFileAsync = promisify(execFile);
const QUALITY_BY_ID = {
    1: '白',
    2: '绿',
    3: '蓝',
    4: '紫',
    5: '金',
    6: '红'
};

export function parseAppInfo(text) {
    const lines = String(text ?? '')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length < 2) {
        throw new Error('app.info must contain company name and product name on the first two non-empty lines');
    }

    return {
        companyName: lines[0],
        productName: lines[1]
    };
}

export function buildGameLogPaths({
    gameRoot = process.cwd(),
    appInfo,
    env = process.env,
    platform = process.platform,
    pathModule = path
} = {}) {
    const parsedAppInfo = typeof appInfo === 'string' ? parseAppInfo(appInfo) : appInfo;
    if (!parsedAppInfo?.companyName || !parsedAppInfo?.productName) {
        throw new Error('appInfo with companyName and productName is required');
    }

    const persistentDataPath = getPersistentDataPath({
        companyName: parsedAppInfo.companyName,
        productName: parsedAppInfo.productName,
        env,
        platform,
        pathModule
    });

    return {
        gameRoot,
        appInfo: parsedAppInfo,
        persistentDataPath,
        playerLogPath: pathModule.join(persistentDataPath, 'Player.log'),
        playbackDir: persistentDataPath,
        playbackPattern: pathModule.join(persistentDataPath, '*.playback')
    };
}

export function parsePlaybackBuffer(buffer, sourcePath = '') {
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    let offset = 0;

    const gameFrame = readLengthPrefixedFrame(data, offset, 'GameData');
    offset = gameFrame.nextOffset;

    if (offset + 4 > data.length) {
        throw new Error(`Invalid playback ${sourcePath}: missing skill log count`);
    }

    const userSkillCount = data.readInt32LE(offset);
    offset += 4;

    if (userSkillCount < 0) {
        throw new Error(`Invalid playback ${sourcePath}: negative skill log count`);
    }

    const userSkillList = [];
    for (let index = 0; index < userSkillCount; index += 1) {
        const frame = readLengthPrefixedFrame(data, offset, `GameUserSkillLogData[${index}]`);
        userSkillList.push({
            raw: frame.bytes,
            fields: parseGenericMessage(frame.bytes)
        });
        offset = frame.nextOffset;
    }

    if (offset + 8 > data.length) {
        throw new Error(`Invalid playback ${sourcePath}: missing winner uid`);
    }

    const winnerUid = data.readBigInt64LE(offset).toString();

    return {
        sourcePath,
        gameData: parseGameData(gameFrame.bytes),
        userSkillList,
        winnerUid
    };
}

export function summarizePlayback(parsed, { metadata = null } = {}) {
    const gameData = parsed.gameData ?? {};

    const summary = {
        sourcePath: parsed.sourcePath,
        gameUid: gameData.uid ?? null,
        mapId: gameData.mapId ?? null,
        round: gameData.round ?? null,
        winnerUid: parsed.winnerUid ?? null,
        nextRoundTime: gameData.nextRoundTime ?? null,
        serverTime: gameData.serverTime ?? null,
        players: gameData.userLog ?? [],
        heroSkills: gameData.heroSkillLog ?? [],
        mapSkills: gameData.mapSkillLog ?? [],
        itemSkills: gameData.itemSkillLog ?? [],
        userSkillCount: parsed.userSkillList?.length ?? 0
    };

    return metadata ? enrichPlaybackSummary(summary, metadata) : summary;
}

export function parseAdsPlaybackReference(sourcePath) {
    const normalized = String(sourcePath ?? '');
    const separatorIndex = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
    const parent = separatorIndex >= 0 ? normalized.slice(0, separatorIndex + 1) : '';
    const leaf = separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
    const match = leaf.match(/^(\d+):([^\\/:]+\.playback)$/i);
    if (!match) return null;

    const mapId = Number(match[1]);
    const streamName = match[2];
    const gameUidTail = streamName.replace(/\.playback$/i, '');
    const basePath = `${parent}${match[1]}`;

    return {
        basePath,
        streamName,
        sourcePath: `${basePath}:${streamName}`,
        gameUid: `${match[1]}:${gameUidTail}`,
        mapId
    };
}

export function buildGameTableMetadata(tablesDir) {
    const typeRows = decodeBase64Table(path.join(tablesDir, 'Item_Type.txt'));
    const itemRows = decodeBase64Table(path.join(tablesDir, 'Item.txt'));
    const typeNames = new Map();
    const items = new Map();

    for (const row of typeRows) {
        const typeId = Number(row[0]);
        if (Number.isFinite(typeId) && row[2]) {
            typeNames.set(typeId, row[2]);
        }
    }

    for (const row of itemRows) {
        const cid = Number(row[0]);
        if (!Number.isFinite(cid)) continue;

        const typeIds = parseIntegerList(row[6]);
        const qualityId = Number(row[8]);
        const price = Number(row[9]);
        const size = parseItemSize(row[7]);
        items.set(cid, {
            cid,
            name: row[1] || String(cid),
            description: row[2] || '',
            typeIds,
            typeNames: typeIds.map((typeId) => typeNames.get(typeId) || String(typeId)),
            qualityId: Number.isFinite(qualityId) ? qualityId : null,
            qualityName: QUALITY_BY_ID[qualityId] || null,
            price: Number.isFinite(price) ? price : null,
            size
        });
    }

    return { typeNames, items, qualityNames: new Map(Object.entries(QUALITY_BY_ID).map(([key, value]) => [Number(key), value])) };
}

export function enrichPlaybackSummary(summary, metadata) {
    return {
        ...summary,
        heroSkills: summary.heroSkills.map((skill) => enrichSkillData(skill, metadata)),
        mapSkills: summary.mapSkills.map((skill) => enrichSkillData(skill, metadata)),
        itemSkills: summary.itemSkills.map((skill) => enrichSkillData(skill, metadata))
    };
}

function decodeBase64Table(filePath) {
    const encoded = fs.readFileSync(filePath, 'utf8').trim();
    const text = Buffer.from(encoded, 'base64').toString('utf8').replace(/^\uFEFF/, '').trim();
    return text ? text.split(/\r?\n/).map((line) => line.split('\t')) : [];
}

function parseIntegerList(value) {
    return [...String(value || '').matchAll(/\d+/g)].map((match) => Number(match[0]));
}

function parseItemSize(value) {
    const normalized = String(value || '').trim();
    if (!/^\d{2}$/.test(normalized)) return null;

    const width = Number(normalized[0]);
    const height = Number(normalized[1]);
    if (!width || !height) return null;

    return {
        width,
        height,
        key: `${width}x${height}`,
        cells: width * height
    };
}

export function enrichSkillData(skill, metadata) {
    const item = metadata.items.get(skill.itemCid);
    const enriched = {
        ...skill,
        ...(item ? {
            itemName: item.name,
            itemTypeNames: item.typeNames,
            itemQuilityName: item.qualityName,
            itemPrice: item.price,
            itemSize: item.size
        } : {})
    };

    if (skill.hitItemTypeList) {
        enriched.hitItemTypeNames = skill.hitItemTypeList.map((typeId) => metadata.typeNames.get(typeId) || String(typeId));
    }
    if (skill.hitItemQuilityList) {
        enriched.hitItemQuilityNames = skill.hitItemQuilityList.map((qualityId) => QUALITY_BY_ID[qualityId] || String(qualityId));
    }
    if (skill.hitBoxList) {
        enriched.hitBoxList = skill.hitBoxList.map((box) => enrichBoxInfoData(box, metadata));
    }

    return enriched;
}

function enrichBoxInfoData(box, metadata) {
    const item = metadata.items.get(box.itemCid);
    return {
        ...box,
        itemTypeNames: box.itemType?.map((typeId) => metadata.typeNames.get(typeId) || String(typeId)) ?? [],
        itemQuilityName: QUALITY_BY_ID[box.itemQuility] || null,
        ...(item ? {
            itemName: item.name,
            tableTypeNames: item.typeNames,
            tableQuilityName: item.qualityName,
            tablePrice: item.price,
            size: item.size
        } : {})
    };
}

function getPersistentDataPath({ companyName, productName, env, platform, pathModule }) {
    if (platform === 'win32') {
        const localLow = env.LOCALLOWAPPDATA || deriveLocalLowFromWindowsEnv(env, pathModule);
        if (!localLow) {
            throw new Error('Cannot locate Windows LocalLow path; set LOCALAPPDATA or USERPROFILE');
        }
        return pathModule.join(localLow, companyName, productName);
    }

    if (platform === 'darwin') {
        const home = env.HOME || env.USERPROFILE;
        if (!home) {
            throw new Error('Cannot locate home directory for Unity data path');
        }
        return pathModule.join(home, 'Library', 'Application Support', companyName, productName);
    }

    const configRoot = env.XDG_CONFIG_HOME || (env.HOME ? pathModule.join(env.HOME, '.config') : null);
    if (!configRoot) {
        throw new Error('Cannot locate XDG config directory for Unity data path');
    }
    return pathModule.join(configRoot, 'unity3d', companyName, productName);
}

function deriveLocalLowFromWindowsEnv(env, pathModule) {
    if (env.LOCALAPPDATA) {
        return env.LOCALAPPDATA.replace(/[\\/]Local$/i, `${pathModule.sep}LocalLow`);
    }
    if (env.USERPROFILE) {
        return pathModule.join(env.USERPROFILE, 'AppData', 'LocalLow');
    }
    return null;
}

function readLengthPrefixedFrame(buffer, offset, label) {
    if (offset + 4 > buffer.length) {
        throw new Error(`Invalid playback: missing ${label} length`);
    }

    const length = buffer.readInt32LE(offset);
    const bodyOffset = offset + 4;
    const nextOffset = bodyOffset + length;

    if (length < 0 || nextOffset > buffer.length) {
        throw new Error(`Invalid playback: ${label} length ${length} exceeds buffer`);
    }

    return {
        bytes: buffer.subarray(bodyOffset, nextOffset),
        nextOffset
    };
}

class ProtoReader {
    constructor(buffer) {
        this.buffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
        this.offset = 0;
    }

    get done() {
        return this.offset >= this.buffer.length;
    }

    readByte() {
        if (this.offset >= this.buffer.length) {
            throw new Error('Unexpected end of protobuf buffer');
        }
        const value = this.buffer[this.offset];
        this.offset += 1;
        return value;
    }

    readVarint() {
        let value = 0n;
        let shift = 0n;

        for (let index = 0; index < 10; index += 1) {
            const byte = this.readByte();
            value |= BigInt(byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) {
                return value;
            }
            shift += 7n;
        }

        throw new Error('Invalid protobuf varint');
    }

    readLengthDelimited() {
        const length = Number(this.readVarint());
        const end = this.offset + length;
        if (length < 0 || end > this.buffer.length) {
            throw new Error('Invalid protobuf length-delimited field');
        }
        const bytes = this.buffer.subarray(this.offset, end);
        this.offset = end;
        return bytes;
    }

    readFixed32() {
        if (this.offset + 4 > this.buffer.length) {
            throw new Error('Unexpected end of protobuf fixed32');
        }
        const value = this.buffer.readUInt32LE(this.offset);
        this.offset += 4;
        return value;
    }

    readFloat32() {
        if (this.offset + 4 > this.buffer.length) {
            throw new Error('Unexpected end of protobuf float32');
        }
        const value = this.buffer.readFloatLE(this.offset);
        this.offset += 4;
        return value;
    }

    readFixed64() {
        if (this.offset + 8 > this.buffer.length) {
            throw new Error('Unexpected end of protobuf fixed64');
        }
        const value = this.buffer.readBigUInt64LE(this.offset);
        this.offset += 8;
        return value;
    }

    skip(wireType) {
        switch (wireType) {
            case 0:
                this.readVarint();
                return;
            case 1:
                this.readFixed64();
                return;
            case 2:
                this.readLengthDelimited();
                return;
            case 5:
                this.readFixed32();
                return;
            default:
                throw new Error(`Unsupported protobuf wire type ${wireType}`);
        }
    }
}

function readTag(reader) {
    const tag = Number(reader.readVarint());
    return {
        fieldNumber: tag >> 3,
        wireType: tag & 0x7
    };
}

function varintToNumber(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value.toString();
}

function parseGenericMessage(buffer) {
    const reader = new ProtoReader(buffer);
    const fields = {};

    while (!reader.done) {
        const { fieldNumber, wireType } = readTag(reader);
        let value;
        if (wireType === 0) {
            value = varintToNumber(reader.readVarint());
        } else if (wireType === 1) {
            value = reader.readFixed64().toString();
        } else if (wireType === 2) {
            const bytes = reader.readLengthDelimited();
            value = bytes.toString('hex');
        } else if (wireType === 5) {
            value = reader.readFixed32();
        } else {
            reader.skip(wireType);
            continue;
        }

        if (fields[fieldNumber] === undefined) {
            fields[fieldNumber] = value;
        } else if (Array.isArray(fields[fieldNumber])) {
            fields[fieldNumber].push(value);
        } else {
            fields[fieldNumber] = [fields[fieldNumber], value];
        }
    }

    return fields;
}

export function parseGameData(buffer) {
    const reader = new ProtoReader(buffer);
    const gameData = {
        userLog: [],
        heroSkillLog: [],
        mapSkillLog: [],
        itemSkillLog: []
    };

    while (!reader.done) {
        const { fieldNumber, wireType } = readTag(reader);

        if (wireType === 0) {
            const value = varintToNumber(reader.readVarint());
            if (fieldNumber === 2) gameData.mapId = value;
            else if (fieldNumber === 3) gameData.round = value;
            else if (fieldNumber === 9) gameData.nextRoundTime = String(value);
            else if (fieldNumber === 20) gameData.serverTime = String(value);
            continue;
        }

        if (wireType === 2) {
            const bytes = reader.readLengthDelimited();
            if (fieldNumber === 1) gameData.uid = bytes.toString('utf8');
            else if (fieldNumber === 5) gameData.userLog.push(parseGameUserData(bytes));
            else if (fieldNumber === 6) gameData.heroSkillLog.push(parseGameSkillData(bytes));
            else if (fieldNumber === 7) gameData.mapSkillLog.push(parseGameSkillData(bytes));
            else if (fieldNumber === 8) gameData.itemSkillLog.push(parseGameSkillData(bytes));
            continue;
        }

        reader.skip(wireType);
    }

    return gameData;
}

function parseGameUserData(buffer) {
    const reader = new ProtoReader(buffer);
    const user = {
        useItemLog: [],
        priceLog: []
    };

    while (!reader.done) {
        const { fieldNumber, wireType } = readTag(reader);

        if (wireType === 0) {
            const value = reader.readVarint();
            if (fieldNumber === 1) user.userUid = value.toString();
            else if (fieldNumber === 3) user.heroCid = varintToNumber(value);
            else if (fieldNumber === 6) user.isStandDown = value !== 0n;
            else if (fieldNumber === 7) user.isQuit = value !== 0n;
            else if (fieldNumber === 9) user.heroSkinCid = varintToNumber(value);
            continue;
        }

        if (wireType === 2) {
            const bytes = reader.readLengthDelimited();
            if (fieldNumber === 2) user.name = bytes.toString('utf8');
            else if (fieldNumber === 4) user.useItemLog.push(parseRoundValue(bytes));
            else if (fieldNumber === 5) user.priceLog.push(parseRoundValue(bytes));
            continue;
        }

        reader.skip(wireType);
    }

    return user;
}

function parseRoundValue(buffer) {
    const reader = new ProtoReader(buffer);
    const entry = {};

    while (!reader.done) {
        const { fieldNumber, wireType } = readTag(reader);
        if (wireType === 0) {
            const value = varintToNumber(reader.readVarint());
            if (fieldNumber === 1) entry.round = value;
            else if (fieldNumber === 2) entry.value = value;
            continue;
        }
        reader.skip(wireType);
    }

    return entry;
}

export function parseGameSkillData(buffer) {
    const reader = new ProtoReader(buffer);
    const skill = {
        hitBoxList: [],
        hitItemTypeList: [],
        hitItemQuilityList: []
    };

    while (!reader.done) {
        const { fieldNumber, wireType } = readTag(reader);

        if (wireType === 0) {
            const value = varintToNumber(reader.readVarint());
            if (fieldNumber === 1) skill.skillCid = value;
            else if (fieldNumber === 2) skill.heroCid = value;
            else if (fieldNumber === 3) skill.mapCid = value;
            else if (fieldNumber === 4) skill.itemCid = value;
            else if (fieldNumber === 5) skill.castTime = String(value);
            else if (fieldNumber === 6) skill.castRound = value;
            else if (fieldNumber === 7) skill.hitItemIndex = value;
            else if (fieldNumber === 12) skill.hitItemTotalPrice = value;
            else if (fieldNumber === 13) skill.uid = String(value);
            else if (fieldNumber === 14) skill.totalHitBoxIndex = value;
            else if (fieldNumber === 15) skill.hitItemTypeList.push(value);
            else if (fieldNumber === 16) skill.hitItemQuilityList.push(value);
            continue;
        }

        if (wireType === 2) {
            const bytes = reader.readLengthDelimited();
            if (fieldNumber === 8) skill.hitBoxList.push(parseBoxInfoData(bytes));
            else if (fieldNumber === 15) skill.hitItemTypeList.push(...parsePackedVarints(bytes));
            else if (fieldNumber === 16) skill.hitItemQuilityList.push(...parsePackedVarints(bytes));
            continue;
        }

        if (wireType === 5) {
            const value = reader.readFloat32();
            if (fieldNumber === 9) skill.allHitItemAvgPrice = value;
            else if (fieldNumber === 10) skill.allHitBoxAvgPrice = value;
            else if (fieldNumber === 11) skill.allHitItemAvgBoxIndex = value;
            continue;
        }

        reader.skip(wireType);
    }

    if (skill.hitBoxList.length === 0) delete skill.hitBoxList;
    if (skill.hitItemTypeList.length === 0) delete skill.hitItemTypeList;
    if (skill.hitItemQuilityList.length === 0) delete skill.hitItemQuilityList;
    return skill;
}

function parseBoxInfoData(buffer) {
    const reader = new ProtoReader(buffer);
    const box = {
        boxId: 0,
        itemType: []
    };

    while (!reader.done) {
        const { fieldNumber, wireType } = readTag(reader);

        if (wireType === 0) {
            const value = varintToNumber(reader.readVarint());
            if (fieldNumber === 1) box.boxId = value;
            else if (fieldNumber === 2) box.itemUid = String(value);
            else if (fieldNumber === 3) box.itemCid = value;
            else if (fieldNumber === 4) box.itemSlotType = value;
            else if (fieldNumber === 5) box.itemType.push(value);
            else if (fieldNumber === 6) box.itemQuility = value;
            else if (fieldNumber === 7) box.itemPrice = value;
            else if (fieldNumber === 8) box.itemBoxIndex = value;
            continue;
        }

        if (wireType === 2) {
            const bytes = reader.readLengthDelimited();
            if (fieldNumber === 5) box.itemType.push(...parsePackedVarints(bytes));
            continue;
        }

        reader.skip(wireType);
    }

    if (box.itemType.length === 0) delete box.itemType;
    return box;
}

function parsePackedVarints(buffer) {
    const reader = new ProtoReader(buffer);
    const values = [];
    while (!reader.done) {
        values.push(varintToNumber(reader.readVarint()));
    }
    return values;
}

function findAppInfoPath(gameRoot) {
    const candidates = [
        path.join(gameRoot, 'BidKing_Data', 'app.info'),
        path.join(gameRoot, 'app.info')
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function parseCliArgs(argv) {
    const options = {
        gameRoot: null,
        dataDir: null,
        intervalMs: DEFAULT_INTERVAL_MS,
        once: false,
        ads: process.platform === 'win32',
        playerLog: true,
        help: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--game-root') {
            options.gameRoot = argv[++index];
        } else if (arg === '--data-dir') {
            options.dataDir = argv[++index];
        } else if (arg === '--interval') {
            options.intervalMs = Number(argv[++index]);
        } else if (arg === '--once') {
            options.once = true;
        } else if (arg === '--ads') {
            options.ads = true;
        } else if (arg === '--no-ads') {
            options.ads = false;
        } else if (arg === '--no-player-log') {
            options.playerLog = false;
        } else if (!arg.startsWith('-') && !options.gameRoot) {
            options.gameRoot = arg;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!Number.isFinite(options.intervalMs) || options.intervalMs < 100) {
        throw new Error('--interval must be a number >= 100');
    }

    return options;
}

function resolveDefaultGameRoot() {
    const archiveRoot = path.resolve(process.cwd(), 'Archive', 'BidKing');
    return fs.existsSync(archiveRoot) ? archiveRoot : process.cwd();
}

function resolvePaths(options) {
    const gameRoot = path.resolve(options.gameRoot || resolveDefaultGameRoot());
    const appInfoPath = findAppInfoPath(gameRoot);
    const appInfoText = fs.readFileSync(appInfoPath, 'utf8');
    const paths = buildGameLogPaths({ gameRoot, appInfo: appInfoText });

    if (options.dataDir) {
        const dataDir = path.resolve(options.dataDir);
        paths.persistentDataPath = dataDir;
        paths.playerLogPath = path.join(dataDir, 'Player.log');
        paths.playbackDir = dataDir;
        paths.playbackPattern = path.join(dataDir, '*.playback');
    }

    return {
        ...paths,
        appInfoPath
    };
}

function findTablesDir(gameRoot) {
    const candidates = [
        path.join(gameRoot, 'BidKing_Data', 'StreamingAssets', 'Tables'),
        path.join(gameRoot, 'StreamingAssets', 'Tables'),
        path.join(gameRoot, 'Tables')
    ];
    return candidates.find((candidate) => {
        return fs.existsSync(path.join(candidate, 'Item.txt')) && fs.existsSync(path.join(candidate, 'Item_Type.txt'));
    }) ?? null;
}

function tryBuildGameTableMetadata(gameRoot) {
    const tablesDir = findTablesDir(gameRoot);
    if (!tablesDir) return null;
    return buildGameTableMetadata(tablesDir);
}

async function listPlaybackFiles(playbackDir) {
    let entries;
    try {
        entries = await fs.promises.readdir(playbackDir, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }

    const files = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.playback')) continue;
        const filePath = path.join(playbackDir, entry.name);
        const stats = await fs.promises.stat(filePath);
        files.push({ filePath, stats });
    }

    files.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
    return files;
}

async function listAdsPlaybackStreams(playbackDir) {
    if (process.platform !== 'win32') return [];

    const script = buildAdsEnumerationScript(playbackDir);
    const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script
    ], {
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true
    });

    return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .map((record) => {
            const sourcePath = `${record.basePath}:${record.streamName}`;
            const parsed = parseAdsPlaybackReference(sourcePath);
            if (!parsed) return null;
            return {
                ...parsed,
                size: Number(record.size) || 0,
                lastWriteTicks: String(record.lastWriteTicks ?? ''),
                signature: `${record.size}:${record.lastWriteTicks}`
            };
        })
        .filter(Boolean)
        .sort(compareAdsStreamsByLastWriteDesc);
}

function compareAdsStreamsByLastWriteDesc(a, b) {
    const left = BigInt(a.lastWriteTicks || '0');
    const right = BigInt(b.lastWriteTicks || '0');
    if (right > left) return 1;
    if (right < left) return -1;
    return b.size - a.size;
}

function buildAdsEnumerationScript(playbackDir) {
    const quotedPlaybackDir = quotePowerShellString(playbackDir);

    return `
$ErrorActionPreference = 'Stop'
$DataDir = ${quotedPlaybackDir}
$source = @"
using System;
using System.Runtime.InteropServices;

public static class BidKingAdsEnum {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct WIN32_FIND_STREAM_DATA {
        public long StreamSize;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 296)]
        public string cStreamName;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr FindFirstStreamW(string lpFileName, int InfoLevel, out WIN32_FIND_STREAM_DATA lpFindStreamData, int dwFlags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool FindNextStreamW(IntPtr hFindStream, out WIN32_FIND_STREAM_DATA lpFindStreamData);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool FindClose(IntPtr hFindFile);
}
"@
Add-Type -TypeDefinition $source
$invalidHandle = [IntPtr]::new(-1)
Get-ChildItem -LiteralPath $DataDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\\d+$' } |
    ForEach-Object {
        $basePath = $_.FullName
        $lastWriteTicks = $_.LastWriteTimeUtc.Ticks
        $streamData = New-Object BidKingAdsEnum+WIN32_FIND_STREAM_DATA
        $handle = [BidKingAdsEnum]::FindFirstStreamW($basePath, 0, [ref]$streamData, 0)
        if ($handle -ne [IntPtr]::Zero -and $handle -ne $invalidHandle) {
            try {
                do {
                    if ($streamData.cStreamName -match '^:(.+\\.playback):\\$DATA$') {
                        [pscustomobject]@{
                            basePath = $basePath
                            streamName = $matches[1]
                            size = $streamData.StreamSize
                            lastWriteTicks = $lastWriteTicks
                        } | ConvertTo-Json -Compress
                    }
                    $streamData = New-Object BidKingAdsEnum+WIN32_FIND_STREAM_DATA
                    $hasNext = [BidKingAdsEnum]::FindNextStreamW($handle, [ref]$streamData)
                } while ($hasNext)
            } finally {
                [void][BidKingAdsEnum]::FindClose($handle)
            }
        }
    }
`;
}

function quotePowerShellString(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

async function readLogAppend(logPath, state) {
    let stats;
    try {
        stats = await fs.promises.stat(logPath);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }

    if (state.offset === null || stats.size < state.offset) {
        state.offset = stats.size;
        return [];
    }

    if (stats.size === state.offset) return [];

    const handle = await fs.promises.open(logPath, 'r');
    try {
        const length = stats.size - state.offset;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, state.offset);
        state.offset = stats.size;
        return buffer
            .toString('utf8')
            .split(/\r?\n/)
            .filter((line) => line.length > 0);
    } finally {
        await handle.close();
    }
}

async function pollOnce(paths, state) {
    const playbackFiles = await listPlaybackFiles(paths.playbackDir);
    if (playbackFiles.length === 0 && !state.reportedNoPlayback) {
        console.log(`[waiting] no playback file under ${paths.playbackDir}`);
        state.reportedNoPlayback = true;
    }

    const filesToRead = [];
    if (!state.playbackInitialized) {
        for (const { filePath, stats } of playbackFiles) {
            state.playbackSignatures.set(filePath, `${stats.mtimeMs}:${stats.size}`);
        }
        if (playbackFiles[0]) filesToRead.push(playbackFiles[0]);
        state.playbackInitialized = playbackFiles.length > 0;
    } else {
        for (const file of playbackFiles) {
            const { filePath, stats } = file;
            const signature = `${stats.mtimeMs}:${stats.size}`;
            if (state.playbackSignatures.get(filePath) === signature) continue;
            state.playbackSignatures.set(filePath, signature);
            filesToRead.push(file);
        }
    }

    for (const { filePath } of filesToRead) {
        try {
            const buffer = await fs.promises.readFile(filePath);
            const summary = summarizePlayback(parsePlaybackBuffer(buffer, filePath), { metadata: state.metadata });
            printPlaybackSummary(summary);
        } catch (error) {
            console.warn(`[playback] ${path.basename(filePath)} is not readable yet: ${error.message}`);
        }
    }

    if (state.adsEnabled) {
        await pollAdsPlaybackStreams(paths, state);
    }

    if (state.playerLogEnabled) {
        const logLines = await readLogAppend(paths.playerLogPath, state.playerLog);
        for (const line of logLines) {
            console.log(`[Player.log] ${line}`);
        }
    }
}

async function pollAdsPlaybackStreams(paths, state) {
    let streams;
    try {
        streams = await listAdsPlaybackStreams(paths.playbackDir);
    } catch (error) {
        if (!state.reportedAdsError) {
            console.warn(`[ads] cannot enumerate playback streams: ${error.message}`);
            state.reportedAdsError = true;
        }
        return;
    }

    if (streams.length === 0 && !state.reportedNoAdsPlayback) {
        console.log(`[waiting] no ADS playback stream under ${paths.playbackDir}`);
        state.reportedNoAdsPlayback = true;
    }

    const streamsToRead = [];
    if (!state.adsInitialized) {
        for (const stream of streams) {
            state.adsSignatures.set(stream.sourcePath, stream.signature);
        }
        if (streams[0]) streamsToRead.push(streams[0]);
        state.adsInitialized = streams.length > 0;
    } else {
        for (const stream of streams) {
            if (state.adsSignatures.get(stream.sourcePath) === stream.signature) continue;
            streamsToRead.push(stream);
        }
    }

    for (const stream of streamsToRead) {
        try {
            const buffer = await fs.promises.readFile(stream.sourcePath);
            const summary = summarizePlayback(parsePlaybackBuffer(buffer, stream.sourcePath), { metadata: state.metadata });
            printPlaybackSummary(summary);
            state.adsSignatures.set(stream.sourcePath, stream.signature);
        } catch (error) {
            console.warn(`[ads] ${stream.sourcePath} is not readable yet: ${error.message}`);
        }
    }
}

function printPlaybackSummary(summary) {
    const sourceName = summary.sourcePath ? path.basename(summary.sourcePath) : '(buffer)';
    console.log(`[playback] ${sourceName}`);
    console.log(`  gameUid=${summary.gameUid ?? '-'} mapId=${summary.mapId ?? '-'} round=${summary.round ?? '-'} winnerUid=${summary.winnerUid ?? '-'}`);

    for (const player of summary.players) {
        const label = player.name ? `${player.name}(${player.userUid ?? '-'})` : player.userUid ?? '-';
        const flags = [
            player.heroCid ? `hero=${player.heroCid}` : null,
            player.isStandDown ? 'standDown=true' : null,
            player.isQuit ? 'quit=true' : null
        ].filter(Boolean);
        console.log(`  player ${label}${flags.length ? ` ${flags.join(' ')}` : ''}`);
        printRoundValues('    bids', player.priceLog);
        printRoundValues('    items', player.useItemLog);
    }

    printSkills('  heroSkills', summary.heroSkills);
    printSkills('  mapSkills', summary.mapSkills);
    printSkills('  itemSkills', summary.itemSkills);
}

function printRoundValues(label, values = []) {
    if (!values.length) return;
    const text = values.map((entry) => `r${entry.round ?? '-'}=${entry.value ?? '-'}`).join(', ');
    console.log(`${label}: ${text}`);
}

function printSkills(label, skills = []) {
    if (!skills.length) return;
    console.log(`${label}:`);
    for (const skill of skills) {
        const parts = [
            skill.skillCid ? `skill=${skill.skillCid}` : null,
            skill.heroCid ? `hero=${skill.heroCid}` : null,
            skill.mapCid ? `map=${skill.mapCid}` : null,
            skill.itemCid ? `item=${formatCidName(skill.itemCid, skill.itemName)}` : null,
            skill.castRound ? `round=${skill.castRound}` : null,
            skill.hitItemIndex !== undefined ? `hitIndex=${skill.hitItemIndex}` : null,
            skill.hitItemTotalPrice !== undefined ? `hitPrice=${skill.hitItemTotalPrice}` : null,
            skill.totalHitBoxIndex !== undefined ? `hitCells=${skill.totalHitBoxIndex}` : null,
            skill.allHitItemAvgPrice !== undefined ? `avgPrice=${formatNumber(skill.allHitItemAvgPrice)}` : null,
            skill.allHitBoxAvgPrice !== undefined ? `avgCellPrice=${formatNumber(skill.allHitBoxAvgPrice)}` : null,
            skill.allHitItemAvgBoxIndex !== undefined ? `avgCells=${formatNumber(skill.allHitItemAvgBoxIndex)}` : null,
            skill.hitItemTypeNames?.length ? `types=${skill.hitItemTypeNames.join('/')}` : null,
            skill.hitItemQuilityNames?.length ? `qualities=${skill.hitItemQuilityNames.join('/')}` : null,
            skill.uid ? `uid=${skill.uid}` : null
        ].filter(Boolean);
        console.log(`    ${parts.join(' ')}`);
        if (skill.hitBoxList?.length) {
            for (const box of skill.hitBoxList) {
                const boxParts = [
                    box.boxId !== undefined ? `box=${box.boxId}` : null,
                    box.itemUid ? `uid=${box.itemUid}` : null,
                    box.itemCid ? `item=${formatCidName(box.itemCid, box.itemName)}` : null,
                    box.itemQuilityName ? `quality=${box.itemQuilityName}` : box.itemQuility !== undefined ? `quality=${box.itemQuility}` : null,
                    box.itemPrice !== undefined ? `price=${box.itemPrice}` : null,
                    box.size ? `size=${box.size.key}` : null,
                    box.itemBoxIndex !== undefined ? `cells=${box.itemBoxIndex}` : null,
                    box.itemTypeNames?.length ? `types=${box.itemTypeNames.join('/')}` : null
                ].filter(Boolean);
                console.log(`      hit ${boxParts.join(' ')}`);
            }
        }
    }
}

function formatCidName(cid, name) {
    return name ? `${cid}(${name})` : String(cid);
}

function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function printHelp() {
    console.log(`Usage:
  node scripts/watch-bidking-game-log.mjs --game-root <BidKing root> [--interval 1000]
  node scripts/watch-bidking-game-log.mjs <BidKing root> --data-dir <LocalLow data dir>

Options:
  --game-root <path>  BidKing install root, or a BidKing_Data directory
  --data-dir <path>   Override Unity persistent data directory
  --interval <ms>     Poll interval, default ${DEFAULT_INTERVAL_MS}
  --once              Print current known playback data once and exit
  --ads               Monitor Windows NTFS ADS .playback streams (default on Windows)
  --no-ads            Disable NTFS ADS stream monitoring
  --no-player-log     Do not print Player.log append lines
  --help              Show this help
`);
}

export async function main(argv = process.argv.slice(2)) {
    const options = parseCliArgs(argv);
    if (options.help) {
        printHelp();
        return;
    }

    const paths = resolvePaths(options);
    console.log(`[watch] gameRoot=${paths.gameRoot}`);
    console.log(`[watch] appInfo=${paths.appInfoPath}`);
    console.log(`[watch] dataDir=${paths.persistentDataPath}`);
    console.log(`[watch] playerLog=${paths.playerLogPath}`);
    console.log(`[watch] playback=${paths.playbackPattern}`);
    console.log(`[watch] adsPlayback=${options.ads ? 'enabled' : 'disabled'}`);
    console.log(`[watch] playerLogTail=${options.playerLog ? 'enabled' : 'disabled'}`);

    const state = {
        adsEnabled: options.ads,
        playerLogEnabled: options.playerLog,
        metadata: tryBuildGameTableMetadata(paths.gameRoot),
        reportedNoPlayback: false,
        reportedNoAdsPlayback: false,
        reportedAdsError: false,
        playbackInitialized: false,
        adsInitialized: false,
        playbackSignatures: new Map(),
        adsSignatures: new Map(),
        playerLog: {
            offset: null
        }
    };

    await pollOnce(paths, state);
    if (options.once) return;

    setInterval(() => {
        pollOnce(paths, state).catch((error) => {
            console.error(`[watch] ${error.stack || error.message}`);
        });
    }, options.intervalMs);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    });
}
