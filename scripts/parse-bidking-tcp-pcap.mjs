#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import heroProfilesModule from '../lib/bidking-hero-profiles.js';
import {
    buildGameTableMetadata,
    enrichSkillData,
    parseGameData,
    parseGameSkillData,
    summarizePlayback
} from './watch-bidking-game-log.mjs';

const { ELSA_MONITOR_PROFILE } = heroProfilesModule;
const DEFAULT_PORT = 10000;
const DOWNSTREAM_HEADER_BYTES = 16;
const UPSTREAM_HEADER_BYTES = 12;
const MARKET_PRICE_REQUEST_MSG_ID = 58;
const MARKET_PRICE_RESPONSE_MSG_ID = 59;
const ELSA_COMPLETE_REVEAL_SKILL_CIDS = new Set(ELSA_MONITOR_PROFILE.completeRevealHeroSkillCids ?? []);
const KNOWN_GAME_DATA_MESSAGES = new Map([
    [33, 'game_start'],
    [37, 'game_next_round'],
    [45, 'game_over'],
    [125, 'sim_game_start'],
    [127, 'sim_game_bid'],
    [129, 'sim_game_use_item'],
    [131, 'sim_game_log'],
    [157, 'sim_game_use_buff_item'],
    [185, 'room_game_start'],
    [191, 'room_game_next_round'],
    [207, 'room_game_over'],
    [229, 'now_game_data'],
    [291, 'test_game_cast_skill']
]);
const SKILL_LIST_MESSAGES = new Map([
    [39, 'game_use_item'],
    [187, 'room_game_use_item'],
    [291, 'test_game_cast_skill']
]);

export function createBidKingTcpStreamState() {
    return {
        downstream: createDirectionStreamState(),
        upstream: createDirectionStreamState()
    };
}

function createDirectionStreamState() {
    return {
        remainderBase64: '',
        nextSequence: null
    };
}

export function parseBidKingTcpPcap(buffer, { port = DEFAULT_PORT, streamState = null } = {}) {
    const normalizedStreamState = streamState ? normalizeBidKingTcpStreamState(streamState) : null;
    const packets = parsePcapngEnhancedPackets(buffer);
    const segments = [];

    for (const [packetIndex, packet] of packets.entries()) {
        const segment = extractTcpPayloadSegment(packet.data, { packetIndex, port });
        if (segment) segments.push(segment);
    }

    const downstream = reassembleDirection(segments, 'downstream');
    const upstream = reassembleDirection(segments, 'upstream');
    const parsedDownstream = splitStreamDirection(downstream, {
        direction: 'downstream',
        directionState: normalizedStreamState?.downstream
    });
    const parsedUpstream = splitStreamDirection(upstream, {
        direction: 'upstream',
        directionState: normalizedStreamState?.upstream
    });

    return {
        packetCount: packets.length,
        segmentCount: segments.length,
        downstream: {
            ...downstream,
            payload: parsedDownstream.payload,
            frames: parsedDownstream.frames
        },
        upstream: {
            ...upstream,
            payload: parsedUpstream.payload,
            frames: parsedUpstream.frames
        }
    };
}

function normalizeBidKingTcpStreamState(streamState) {
    streamState.downstream = normalizeDirectionStreamState(streamState.downstream);
    streamState.upstream = normalizeDirectionStreamState(streamState.upstream);
    return streamState;
}

function normalizeDirectionStreamState(directionState) {
    if (!directionState || typeof directionState !== 'object') return createDirectionStreamState();
    return {
        remainderBase64: typeof directionState.remainderBase64 === 'string' ? directionState.remainderBase64 : '',
        nextSequence: Number.isInteger(directionState.nextSequence) ? directionState.nextSequence >>> 0 : null
    };
}

export function splitStreamDirection(reassembled, { direction, directionState }) {
    if (!directionState) {
        return {
            payload: reassembled.payload,
            frames: splitBidKingFrames(reassembled.payload, { direction })
        };
    }

    const carriedRemainder = decodeRemainder(directionState.remainderBase64);
    const hasCurrentSegments = reassembled.segmentCount > 0;
    const canContinueRemainder = carriedRemainder.length > 0
        && hasCurrentSegments
        && directionState.nextSequence !== null
        && directionState.nextSequence === reassembled.firstSequence;
    const payload = canContinueRemainder
        ? Buffer.concat([carriedRemainder, reassembled.payload])
        : reassembled.payload;

    if (!hasCurrentSegments) {
        return {
            payload,
            frames: []
        };
    }

    const result = splitBidKingFrames(payload, {
        direction,
        preserveIncompleteTail: true
    });
    directionState.remainderBase64 = result.remainder.length ? result.remainder.toString('base64') : '';
    directionState.nextSequence = result.remainder.length ? reassembled.nextSequence : null;

    return {
        payload,
        frames: result.frames
    };
}

function decodeRemainder(remainderBase64) {
    if (!remainderBase64) return Buffer.alloc(0);
    try {
        return Buffer.from(remainderBase64, 'base64');
    } catch {
        return Buffer.alloc(0);
    }
}

export function parsePcapngEnhancedPackets(buffer) {
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const packets = [];
    let offset = 0;

    while (offset + 12 <= data.length) {
        const blockType = data.readUInt32LE(offset);
        const blockLength = data.readUInt32LE(offset + 4);
        if (blockLength < 12 || offset + blockLength > data.length) break;

        if (blockType === 0x00000006 && blockLength >= 32) {
            const capturedLength = data.readUInt32LE(offset + 20);
            const packetOffset = offset + 28;
            if (packetOffset + capturedLength <= offset + blockLength) {
                packets.push({
                    offset,
                    data: data.subarray(packetOffset, packetOffset + capturedLength)
                });
            }
        }

        offset += blockLength;
    }

    return packets;
}

export function findIpv4PacketOffset(packet) {
    const scanLimit = Math.min(80, packet.length - 20);
    for (let offset = 0; offset <= scanLimit; offset += 1) {
        const version = packet[offset] >> 4;
        const headerLength = (packet[offset] & 0x0f) * 4;
        if (version !== 4 || headerLength < 20) continue;

        const totalLength = packet.readUInt16BE(offset + 2);
        if (totalLength < headerLength || offset + totalLength > packet.length) continue;
        if (packet[offset + 9] !== 6) continue;

        return offset;
    }

    return -1;
}

export function splitBidKingFrames(stream, { direction = 'downstream', preserveIncompleteTail = false } = {}) {
    const headerBytes = direction === 'downstream' ? DOWNSTREAM_HEADER_BYTES : UPSTREAM_HEADER_BYTES;
    const msgIdOffset = direction === 'downstream' ? 12 : 8;
    const clientMsgIdOffset = direction === 'downstream' ? 8 : 4;
    const frames = [];
    let offset = 0;
    let remainder = Buffer.alloc(0);

    while (offset + headerBytes <= stream.length) {
        const packetLength = stream.readUInt32BE(offset);
        if (packetLength < headerBytes || packetLength > 1024 * 1024) {
            frames.push({
                direction,
                offset,
                malformed: true,
                packetLength,
                remainingBytes: stream.length - offset
            });
            break;
        }
        if (offset + packetLength > stream.length) {
            if (preserveIncompleteTail) {
                remainder = stream.subarray(offset);
            } else {
                frames.push({
                    direction,
                    offset,
                    malformed: true,
                    packetLength,
                    remainingBytes: stream.length - offset
                });
            }
            break;
        }

        frames.push({
            direction,
            offset,
            packetLength,
            clientMsgId: stream.readUInt32BE(offset + clientMsgIdOffset),
            msgId: stream.readUInt32BE(offset + msgIdOffset),
            payload: stream.subarray(offset + headerBytes, offset + packetLength)
        });
        offset += packetLength;
    }

    if (preserveIncompleteTail && offset < stream.length && remainder.length === 0) {
        remainder = stream.subarray(offset);
    }

    return preserveIncompleteTail ? { frames, remainder } : frames;
}

export function summarizeBidKingFrames(frames, { metadata = null } = {}) {
    return frames
        .filter((frame) => !frame.malformed)
        .map((frame) => summarizeFrame(frame, { metadata }))
        .filter(Boolean);
}

export function summarizeBidKingTcp(parsed, { metadata = null } = {}) {
    const marketRequests = buildMarketPriceRequestMap(parsed?.upstream?.frames ?? []);
    return (parsed?.downstream?.frames ?? [])
        .filter((frame) => !frame.malformed)
        .map((frame) => summarizeFrame(frame, { metadata, marketRequests }))
        .filter(Boolean);
}

export function extractBidKingRealtimeEvents(summaries) {
    const events = [];
    const seen = new Set();

    for (const summary of summaries) {
        const marketPriceEvent = buildMarketPriceEvent(summary);
        if (marketPriceEvent) {
            const dedupKey = getEventDedupKey(marketPriceEvent);
            if (!seen.has(dedupKey)) {
                seen.add(dedupKey);
                events.push(marketPriceEvent);
            }
        }

        const game = summary.gameData ?? {};
        const skillGroups = [];
        if (summary.skill) skillGroups.push(['skill', [summary.skill]]);
        skillGroups.push(
            ['hero', game.heroSkills ?? []],
            ['map', game.mapSkills ?? []],
            ['item', game.itemSkills ?? []]
        );

        for (const [group, skills] of skillGroups) {
            for (const skill of skills) {
                const event = buildSkillEvent(summary, game, group, skill);
                const dedupKey = getEventDedupKey(event);
                if (!event || seen.has(dedupKey)) continue;
                seen.add(dedupKey);
                events.push(event);
            }
        }
    }

    return events;
}

function getEventDedupKey(event) {
    if (!event?.key) return '';
    const scopedKey = event.gameUid ? `${event.gameUid}:${event.key}` : event.key;
    return `${scopedKey}:${buildEventPayloadSignature(event)}`;
}

export function extractTcpPayloadSegment(packet, { packetIndex, port }) {
    const ipOffset = findIpv4PacketOffset(packet);
    if (ipOffset < 0) return null;

    const ip = packet.subarray(ipOffset);
    const ipHeaderLength = (ip[0] & 0x0f) * 4;
    const totalLength = ip.readUInt16BE(2);
    if (ipHeaderLength + 20 > totalLength) return null;

    const tcp = ip.subarray(ipHeaderLength, totalLength);
    const sourcePort = tcp.readUInt16BE(0);
    const destinationPort = tcp.readUInt16BE(2);
    if (sourcePort !== port && destinationPort !== port) return null;

    const tcpHeaderLength = (tcp[12] >> 4) * 4;
    if (tcpHeaderLength < 20 || tcpHeaderLength > tcp.length) return null;

    const payload = tcp.subarray(tcpHeaderLength);
    if (payload.length === 0) return null;

    return {
        packetIndex,
        direction: sourcePort === port ? 'downstream' : 'upstream',
        sourcePort,
        destinationPort,
        sequence: tcp.readUInt32BE(4),
        payload
    };
}

function reassembleDirection(segments, direction) {
    const sorted = segments
        .filter((segment) => segment.direction === direction)
        .sort((left, right) => left.sequence - right.sequence || left.packetIndex - right.packetIndex);
    const chunks = [];
    let expectedSequence = null;
    let firstSequence = null;
    let gaps = 0;
    let duplicates = 0;

    for (const segment of sorted) {
        if (firstSequence === null) firstSequence = segment.sequence;
        if (expectedSequence === null || segment.sequence === expectedSequence) {
            chunks.push(segment.payload);
            expectedSequence = addSequence(segment.sequence, segment.payload.length);
        } else if (isSequenceAfter(segment.sequence, expectedSequence)) {
            gaps += 1;
            chunks.push(segment.payload);
            expectedSequence = addSequence(segment.sequence, segment.payload.length);
        } else {
            duplicates += 1;
        }
    }

    return {
        payload: Buffer.concat(chunks),
        segmentCount: sorted.length,
        firstSequence,
        nextSequence: expectedSequence,
        gaps,
        duplicates
    };
}

function addSequence(sequence, length) {
    return (sequence + length) >>> 0;
}

function isSequenceAfter(sequence, expectedSequence) {
    return ((sequence - expectedSequence) >>> 0) < 0x80000000;
}

function summarizeFrame(frame, { metadata, marketRequests = null }) {
    if (frame.msgId === MARKET_PRICE_RESPONSE_MSG_ID) {
        const marketPrice = parseMarketPriceList(frame.payload);
        if (!marketPrice) return null;
        const request = marketRequests?.get(frame.clientMsgId) ?? {};
        return {
            msgId: frame.msgId,
            kind: 'market_price_list',
            packetLength: frame.packetLength,
            clientMsgId: frame.clientMsgId,
            marketPrice: {
                requestUid: request.requestUid ?? null,
                itemCid: request.itemCid ?? null,
                ...marketPrice
            }
        };
    }

    if (KNOWN_GAME_DATA_MESSAGES.has(frame.msgId)) {
        const fields = parseEnvelopeFields(frame.payload);
        const gameData = findBestGameData(fields);
        if (!gameData) {
            return {
                msgId: frame.msgId,
                kind: KNOWN_GAME_DATA_MESSAGES.get(frame.msgId),
                packetLength: frame.packetLength
            };
        }

        const winnerUid = findVarintField(fields, 1);
        return {
            msgId: frame.msgId,
            kind: KNOWN_GAME_DATA_MESSAGES.get(frame.msgId),
            packetLength: frame.packetLength,
            ...(frame.msgId === 45 || frame.msgId === 207 ? { winnerUid } : {}),
            gameData: summarizeGameData(gameData, { metadata })
        };
    }

    if (SKILL_LIST_MESSAGES.has(frame.msgId)) {
        const fields = parseEnvelopeFields(frame.payload);
        const rawSkill = findBestSkillData(fields);
        const skill = rawSkill && metadata ? enrichSkillData(rawSkill, metadata) : rawSkill;
        if (!skill) return null;
        return {
            msgId: frame.msgId,
            kind: SKILL_LIST_MESSAGES.get(frame.msgId),
            packetLength: frame.packetLength,
            skill
        };
    }

    return null;
}

function buildMarketPriceRequestMap(frames) {
    const requests = new Map();
    for (const frame of frames) {
        if (frame.malformed || frame.msgId !== MARKET_PRICE_REQUEST_MSG_ID) continue;
        const request = parseMarketPriceRequest(frame.payload);
        if (request) requests.set(frame.clientMsgId, request);
    }
    return requests;
}

function parseMarketPriceRequest(payload) {
    try {
        const fields = parseEnvelopeFields(payload);
        const requestUid = findVarintField(fields, 1);
        const itemCid = findNumberVarintField(fields, 2);
        if (!requestUid && itemCid === null) return null;
        return { requestUid, itemCid };
    } catch {
        return null;
    }
}

function parseMarketPriceList(payload) {
    try {
        const fields = parseEnvelopeFields(payload);
        const prices = [];
        for (const field of fields) {
            if (field.fieldNumber !== 2 || field.wireType !== 2) continue;
            const childFields = parseEnvelopeFields(field.value);
            const price = findNumberVarintField(childFields, 1);
            const count = findNumberVarintField(childFields, 2);
            if (price === null || count === null) continue;
            prices.push({ price, count });
        }
        if (!prices.length) return null;
        return {
            prices,
            minPrice: Math.min(...prices.map((entry) => entry.price)),
            maxPrice: Math.max(...prices.map((entry) => entry.price)),
            totalCount: prices.reduce((sum, entry) => sum + entry.count, 0)
        };
    } catch {
        return null;
    }
}

function summarizeGameData(gameData, { metadata }) {
    return summarizePlayback({
        gameData,
        userSkillList: [],
        winnerUid: null,
        sourcePath: ''
    }, { metadata });
}

function buildSkillEvent(summary, game, group, skill) {
    const hitBoxList = skill.hitBoxList ?? [];
    const keepsEmptyElsaCompleteReveal = group === 'hero' && isElsaCompleteRevealSkill(skill);
    const hasUsefulPayload = keepsEmptyElsaCompleteReveal
        || hitBoxList.length > 0
        || skill.totalHitBoxIndex !== undefined
        || skill.hitItemTotalPrice !== undefined
        || skill.allHitItemAvgPrice !== undefined
        || skill.allHitBoxAvgPrice !== undefined
        || skill.allHitItemAvgBoxIndex !== undefined
        || skill.hitItemTypeList?.length
        || skill.hitItemQuilityList?.length;
    if (!hasUsefulPayload) return null;

    const key = skill.uid
        ? `skill:${skill.uid}`
        : `skill:${summary.msgId}:${game.gameUid ?? '-'}:${group}:${skill.skillCid ?? '-'}:${skill.itemCid ?? '-'}:${skill.castRound ?? '-'}:${buildHitBoxSignature(hitBoxList)}`;
    const fullHitBoxCount = hitBoxList.filter((box) => box.itemCid || box.itemName || box.itemPrice !== undefined).length;
    const qualityHitBoxCount = hitBoxList.filter((box) => box.itemQuility !== undefined || box.itemQuilityName).length;

    return {
        type: 'skill',
        key,
        msgId: summary.msgId,
        sourceKind: summary.kind,
        gameUid: game.gameUid ?? null,
        mapId: game.mapId ?? null,
        round: game.round ?? null,
        winnerUid: summary.winnerUid ?? null,
        group,
        skill: {
            ...skill,
            hitBoxCount: hitBoxList.length,
            fullHitBoxCount,
            qualityOnlyHitBoxCount: Math.max(0, qualityHitBoxCount - fullHitBoxCount)
        }
    };
}

function isElsaCompleteRevealSkill(skill) {
    return Number(skill?.heroCid) === 103 && ELSA_COMPLETE_REVEAL_SKILL_CIDS.has(Number(skill?.skillCid));
}

function buildMarketPriceEvent(summary) {
    const marketPrice = summary.marketPrice;
    if (!marketPrice) return null;
    const itemKey = marketPrice.itemCid ?? 'unknown';
    return {
        type: 'market_price',
        key: `market:${itemKey}:${summary.clientMsgId}`,
        msgId: summary.msgId,
        sourceKind: summary.kind,
        clientMsgId: summary.clientMsgId,
        itemCid: marketPrice.itemCid,
        requestUid: marketPrice.requestUid,
        prices: marketPrice.prices,
        minPrice: marketPrice.minPrice,
        maxPrice: marketPrice.maxPrice,
        totalCount: marketPrice.totalCount
    };
}

function buildHitBoxSignature(hitBoxList) {
    return hitBoxList
        .map((box) => [
            box.boxId ?? '',
            box.itemCid ?? '',
            box.itemQuility ?? box.itemQuilityName ?? '',
            box.itemPrice ?? '',
            box.itemBoxIndex ?? ''
        ].join('/'))
        .join(',');
}

function buildEventPayloadSignature(event) {
    if (event?.type === 'market_price') {
        return JSON.stringify({
            clientMsgId: event.clientMsgId ?? '',
            itemCid: event.itemCid ?? '',
            requestUid: event.requestUid ?? '',
            prices: event.prices ?? []
        });
    }

    const skill = event?.skill ?? {};
    return JSON.stringify({
        group: event?.group ?? '',
        round: event?.round ?? '',
        skillCid: skill.skillCid ?? '',
        itemCid: skill.itemCid ?? '',
        castRound: skill.castRound ?? '',
        totalHitBoxIndex: skill.totalHitBoxIndex ?? '',
        hitItemTotalPrice: skill.hitItemTotalPrice ?? '',
        allHitItemAvgPrice: skill.allHitItemAvgPrice ?? '',
        allHitBoxAvgPrice: skill.allHitBoxAvgPrice ?? '',
        allHitItemAvgBoxIndex: skill.allHitItemAvgBoxIndex ?? '',
        hitItemTypeList: skill.hitItemTypeList ?? [],
        hitItemQuilityList: skill.hitItemQuilityList ?? [],
        hitBoxList: (skill.hitBoxList ?? []).map((box) => ({
            boxId: box.boxId ?? null,
            itemCid: box.itemCid ?? null,
            itemName: box.itemName ?? null,
            itemPrice: box.itemPrice ?? box.price ?? null,
            itemSlotType: box.itemSlotType ?? null,
            itemQuility: box.itemQuility ?? box.itemQuality ?? box.qualityId ?? null,
            itemQuilityName: box.itemQuilityName ?? box.itemQualityName ?? box.quality ?? null,
            itemBoxIndex: box.itemBoxIndex ?? null
        }))
    });
}

function findBestGameData(fields) {
    let best = null;
    let bestScore = 0;

    for (const field of fields) {
        if (field.wireType !== 2) continue;
        try {
            const parsed = parseGameData(field.value);
            const score = scoreGameData(parsed);
            if (score > bestScore) {
                best = parsed;
                bestScore = score;
            }
        } catch {
            // Ignore fields that are not GameData.
        }
    }

    return bestScore > 0 ? best : null;
}

function findBestSkillData(fields) {
    let best = null;
    let bestScore = 0;

    for (const field of fields) {
        if (field.wireType !== 2) continue;
        try {
            const parsed = parseGameSkillData(field.value);
            const score = scoreSkillData(parsed);
            if (score > bestScore) {
                best = parsed;
                bestScore = score;
            }
        } catch {
            // Ignore fields that are not GameSkillData.
        }
    }

    return bestScore > 0 ? best : null;
}

function scoreGameData(gameData) {
    return [
        gameData.uid,
        gameData.mapId,
        gameData.round,
        gameData.serverTime,
        gameData.userLog?.length,
        gameData.heroSkillLog?.length,
        gameData.mapSkillLog?.length,
        gameData.itemSkillLog?.length
    ].filter(Boolean).length;
}

function scoreSkillData(skill) {
    return [
        skill.skillCid,
        skill.heroCid,
        skill.mapCid,
        skill.itemCid,
        skill.castRound,
        skill.hitBoxList?.length,
        skill.hitItemTypeList?.length,
        skill.hitItemQuilityList?.length
    ].filter(Boolean).length;
}

function findVarintField(fields, fieldNumber) {
    const field = fields.find((entry) => entry.fieldNumber === fieldNumber && entry.wireType === 0);
    return field ? String(field.value) : null;
}

function findNumberVarintField(fields, fieldNumber) {
    const field = fields.find((entry) => entry.fieldNumber === fieldNumber && entry.wireType === 0);
    if (!field) return null;
    const value = Number(field.value);
    return Number.isSafeInteger(value) ? value : null;
}

function parseEnvelopeFields(buffer) {
    const reader = new ProtoReader(buffer);
    const fields = [];

    while (!reader.done) {
        const tag = Number(reader.readVarint());
        const fieldNumber = tag >> 3;
        const wireType = tag & 7;
        let value;

        if (wireType === 0) {
            value = reader.readVarint();
        } else if (wireType === 1) {
            value = reader.readFixed64();
        } else if (wireType === 2) {
            value = reader.readLengthDelimited();
        } else if (wireType === 5) {
            value = reader.readFixed32();
        } else {
            reader.skip(wireType);
            continue;
        }

        fields.push({ fieldNumber, wireType, value });
    }

    return fields;
}

class ProtoReader {
    constructor(buffer) {
        this.buffer = buffer;
        this.offset = 0;
    }

    get done() {
        return this.offset >= this.buffer.length;
    }

    readVarint() {
        let result = 0n;
        let shift = 0n;
        while (this.offset < this.buffer.length) {
            const byte = this.buffer[this.offset++];
            result |= BigInt(byte & 0x7f) << shift;
            if ((byte & 0x80) === 0) return result;
            shift += 7n;
        }
        throw new Error('Unexpected end of protobuf varint');
    }

    readLengthDelimited() {
        const length = Number(this.readVarint());
        if (this.offset + length > this.buffer.length) {
            throw new Error('Unexpected end of protobuf length-delimited field');
        }
        const bytes = this.buffer.subarray(this.offset, this.offset + length);
        this.offset += length;
        return bytes;
    }

    readFixed64() {
        if (this.offset + 8 > this.buffer.length) throw new Error('Unexpected end of fixed64 field');
        const value = this.buffer.readBigUInt64LE(this.offset);
        this.offset += 8;
        return value;
    }

    readFixed32() {
        if (this.offset + 4 > this.buffer.length) throw new Error('Unexpected end of fixed32 field');
        const value = this.buffer.readUInt32LE(this.offset);
        this.offset += 4;
        return value;
    }

    skip(wireType) {
        if (wireType === 0) this.readVarint();
        else if (wireType === 1) this.offset += 8;
        else if (wireType === 2) this.readLengthDelimited();
        else if (wireType === 5) this.offset += 4;
        else throw new Error(`Unsupported protobuf wire type ${wireType}`);
    }
}

function parseCliArgs(argv) {
    const options = {
        port: DEFAULT_PORT,
        tablesDir: null,
        json: false,
        eventJson: false,
        events: false,
        outputPath: null,
        streamStatePath: null,
        help: false,
        pcapPath: null
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help' || arg === '-h') options.help = true;
        else if (arg === '--port') options.port = Number(argv[++index]);
        else if (arg === '--tables-dir') options.tablesDir = argv[++index];
        else if (arg === '--json') options.json = true;
        else if (arg === '--event-json') options.eventJson = true;
        else if (arg === '--events') options.events = true;
        else if (arg === '--output') options.outputPath = argv[++index];
        else if (arg === '--stream-state') options.streamStatePath = argv[++index];
        else if (!arg.startsWith('-') && !options.pcapPath) options.pcapPath = arg;
        else throw new Error(`Unknown argument: ${arg}`);
    }

    if (!options.help && !options.pcapPath) throw new Error('pcapng path is required');
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
        throw new Error('--port must be a TCP port number');
    }

    return options;
}

function printHelp() {
    console.log(`Usage:
  node scripts/parse-bidking-tcp-pcap.mjs <capture.pcapng> [--port 10000]

Options:
  --port <number>       Game TCP server port, default ${DEFAULT_PORT}
  --tables-dir <path>   Optional StreamingAssets/Tables directory for item name enrichment
  --json                Print parsed summaries as JSON
  --event-json          Print deduped realtime skill events as JSON
  --events              Print only deduped realtime skill events
  --output <path>       Write JSON/text output to a UTF-8 file instead of stdout
  --stream-state <path> Persist TCP reassembly state across parser runs
  --help                Show this help
`);
}

function formatTextReport(parsed, summaries) {
    const lines = [];
    lines.push(`[pcap] packets=${parsed.packetCount} tcpSegments=${parsed.segmentCount}`);
    lines.push(formatDirection('downstream', parsed.downstream));
    lines.push(formatDirection('upstream', parsed.upstream));

    for (const summary of summaries) {
        const game = summary.gameData;
        lines.push(`[${summary.kind}] msgId=${summary.msgId} gameUid=${game?.gameUid ?? '-'} mapId=${game?.mapId ?? '-'} round=${game?.round ?? '-'} winnerUid=${summary.winnerUid ?? '-'}`);
        for (const player of game?.players ?? []) {
            const prices = player.priceLog?.map((entry) => `r${entry.round ?? '-'}=${entry.value ?? '-'}`).join(', ');
            lines.push(`  player ${player.name ?? '-'}(${player.userUid ?? '-'}) hero=${player.heroCid ?? '-'}${prices ? ` bids=${prices}` : ''}`);
        }
        lines.push(...formatSkillGroup('  heroSkills', game?.heroSkills));
        lines.push(...formatSkillGroup('  mapSkills', game?.mapSkills));
        lines.push(...formatSkillGroup('  itemSkills', game?.itemSkills));
        if (summary.skill) lines.push(...formatSkillGroup('  skill', [summary.skill]));
    }

    return lines.join('\n');
}

function formatEventReport(events) {
    return events.flatMap((event) => formatRealtimeEvent(event)).join('\n');
}

function formatRealtimeEvent(event) {
    if (event.type === 'market_price') return formatMarketPriceEvent(event);

    const lines = [];
    const skill = event.skill;
    const parts = [
        `msgId=${event.msgId}`,
        `source=${event.sourceKind}`,
        `gameUid=${event.gameUid ?? '-'}`,
        `round=${event.round ?? '-'}`,
        `group=${event.group}`,
        skill.skillCid ? `skill=${skill.skillCid}` : null,
        skill.itemCid ? `item=${formatCidName(skill.itemCid, skill.itemName)}` : null,
        skill.castRound !== undefined ? `castRound=${skill.castRound}` : null,
        `boxes=${skill.hitBoxCount}`,
        skill.fullHitBoxCount ? `full=${skill.fullHitBoxCount}` : null,
        skill.qualityOnlyHitBoxCount ? `qualityOnly=${skill.qualityOnlyHitBoxCount}` : null,
        skill.totalHitBoxIndex !== undefined ? `hitCells=${skill.totalHitBoxIndex}` : null,
        skill.hitItemTotalPrice !== undefined ? `hitPrice=${skill.hitItemTotalPrice}` : null,
        skill.allHitItemAvgPrice !== undefined ? `avgItemPrice=${formatNumber(skill.allHitItemAvgPrice)}` : null,
        skill.allHitBoxAvgPrice !== undefined ? `avgBoxPrice=${formatNumber(skill.allHitBoxAvgPrice)}` : null,
        skill.allHitItemAvgBoxIndex !== undefined ? `avgCells=${formatNumber(skill.allHitItemAvgBoxIndex)}` : null
    ].filter(Boolean);
    lines.push(`[skill] ${parts.join(' ')}`);

    for (const box of skill.hitBoxList ?? []) {
        const boxParts = [
            box.boxId !== undefined ? `box=${box.boxId}` : null,
            box.itemCid ? `item=${formatCidName(box.itemCid, box.itemName)}` : null,
            box.itemQuilityName ? `quality=${box.itemQuilityName}` : box.itemQuility !== undefined ? `quality=${box.itemQuility}` : null,
            box.itemPrice !== undefined ? `price=${box.itemPrice}` : null,
            box.size ? `size=${box.size.key}` : null,
            box.itemBoxIndex !== undefined ? `cells=${box.itemBoxIndex}` : null
        ].filter(Boolean);
        if (boxParts.length) lines.push(`  hit ${boxParts.join(' ')}`);
    }

    return lines;
}

function formatMarketPriceEvent(event) {
    const parts = [
        `msgId=${event.msgId}`,
        `source=${event.sourceKind}`,
        `clientMsgId=${event.clientMsgId}`,
        event.itemCid ? `item=${event.itemCid}` : 'item=-',
        event.requestUid ? `requestUid=${event.requestUid}` : null,
        event.minPrice !== undefined ? `min=${event.minPrice}` : null,
        event.maxPrice !== undefined ? `max=${event.maxPrice}` : null,
        event.totalCount !== undefined ? `totalCount=${event.totalCount}` : null
    ].filter(Boolean);
    const lines = [`[market_price] ${parts.join(' ')}`];
    for (const entry of event.prices ?? []) {
        lines.push(`  price ${entry.price} x${entry.count}`);
    }
    return lines;
}

function formatDirection(label, direction) {
    const counts = new Map();
    for (const frame of direction.frames) {
        if (!frame.malformed) counts.set(frame.msgId, (counts.get(frame.msgId) ?? 0) + 1);
    }
    const msgIds = [...counts.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([msgId, count]) => `${msgId}:${count}`)
        .join(' ');
    return `[${label}] segments=${direction.segmentCount} frames=${direction.frames.length} gaps=${direction.gaps} duplicates=${direction.duplicates} msgIds=${msgIds || '-'}`;
}

function formatSkillGroup(label, skills = []) {
    if (!skills?.length) return [];
    const lines = [`${label}:`];
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
            skill.hitItemTypeNames?.length ? `types=${skill.hitItemTypeNames.join('/')}` : null,
            skill.hitItemQuilityNames?.length ? `qualities=${skill.hitItemQuilityNames.join('/')}` : null,
            skill.uid ? `uid=${skill.uid}` : null
        ].filter(Boolean);
        lines.push(`    ${parts.join(' ')}`);
        for (const box of skill.hitBoxList ?? []) {
            const boxParts = [
                box.boxId !== undefined ? `box=${box.boxId}` : null,
                box.itemCid ? `item=${formatCidName(box.itemCid, box.itemName)}` : null,
                box.itemQuilityName ? `quality=${box.itemQuilityName}` : box.itemQuility !== undefined ? `quality=${box.itemQuility}` : null,
                box.itemPrice !== undefined ? `price=${box.itemPrice}` : null,
                box.size ? `size=${box.size.key}` : null,
                box.itemBoxIndex !== undefined ? `cells=${box.itemBoxIndex}` : null
            ].filter(Boolean);
            lines.push(`      hit ${boxParts.join(' ')}`);
        }
    }
    return lines;
}

function formatCidName(cid, name) {
    return name ? `${cid}(${name})` : String(cid);
}

export async function main(argv = process.argv.slice(2)) {
    const options = parseCliArgs(argv);
    if (options.help) {
        printHelp();
        return;
    }

    const buffer = fs.readFileSync(options.pcapPath);
    const streamState = readStreamState(options.streamStatePath);
    const parsed = parseBidKingTcpPcap(buffer, { port: options.port, streamState });
    writeStreamState(options.streamStatePath, streamState);
    const metadata = options.tablesDir ? buildGameTableMetadata(path.resolve(options.tablesDir)) : null;
    const summaries = summarizeBidKingTcp(parsed, { metadata });

    if (options.eventJson) {
        writeOutput(JSON.stringify(extractBidKingRealtimeEvents(summaries), null, 2), options.outputPath);
    } else if (options.events) {
        const text = formatEventReport(extractBidKingRealtimeEvents(summaries));
        writeOutput(text, options.outputPath);
    } else if (options.json) {
        writeOutput(JSON.stringify({ parsed: summarizeParsedForJson(parsed), summaries }, null, 2), options.outputPath);
    } else {
        const text = formatTextReport(parsed, summaries);
        writeOutput(text, options.outputPath);
    }
}

function readStreamState(streamStatePath) {
    if (!streamStatePath) return null;
    try {
        if (!fs.existsSync(streamStatePath)) return createBidKingTcpStreamState();
        const parsed = JSON.parse(fs.readFileSync(streamStatePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : createBidKingTcpStreamState();
    } catch {
        return createBidKingTcpStreamState();
    }
}

function writeStreamState(streamStatePath, streamState) {
    if (!streamStatePath || !streamState) return;
    fs.mkdirSync(path.dirname(streamStatePath), { recursive: true });
    fs.writeFileSync(streamStatePath, `${JSON.stringify(streamState, null, 2)}\n`, 'utf8');
}

function writeOutput(text, outputPath) {
    if (outputPath) {
        fs.writeFileSync(outputPath, `${text.replace(/\s+$/u, '')}\n`, 'utf8');
    } else {
        console.log(text);
    }
}

function summarizeParsedForJson(parsed) {
    return {
        packetCount: parsed.packetCount,
        segmentCount: parsed.segmentCount,
        downstream: summarizeDirectionForJson(parsed.downstream),
        upstream: summarizeDirectionForJson(parsed.upstream)
    };
}

function summarizeDirectionForJson(direction) {
    return {
        segmentCount: direction.segmentCount,
        gaps: direction.gaps,
        duplicates: direction.duplicates,
        frames: direction.frames.map((frame) => ({
            direction: frame.direction,
            packetLength: frame.packetLength,
            clientMsgId: frame.clientMsgId,
            msgId: frame.msgId,
            malformed: frame.malformed
        }))
    };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    main().catch((error) => {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    });
}
