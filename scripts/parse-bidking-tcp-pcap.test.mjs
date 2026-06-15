import { describe, expect, it } from 'vitest';
import {
    createBidKingTcpStreamState,
    extractBidKingRealtimeEvents,
    findIpv4PacketOffset,
    parseBidKingTcpPcap,
    summarizeBidKingFrames,
    summarizeBidKingTcp
} from './parse-bidking-tcp-pcap.mjs';

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

function stringField(field, value) {
    const body = Buffer.from(value, 'utf8');
    return Buffer.concat([key(field, 2), encodeVarint(body.length), body]);
}

function messageField(field, body) {
    return Buffer.concat([key(field, 2), encodeVarint(body.length), body]);
}

function buildDownFrame(msgId, payload) {
    const header = Buffer.alloc(16);
    header.writeUInt32BE(header.length + payload.length, 0);
    header.writeUInt32BE(7, 4);
    header.writeUInt32BE(99, 8);
    header.writeUInt32BE(msgId, 12);
    return Buffer.concat([header, payload]);
}

function buildUpFrame(msgId, payload) {
    const header = Buffer.alloc(12);
    header.writeUInt32BE(header.length + payload.length, 0);
    header.writeUInt32BE(99, 4);
    header.writeUInt32BE(msgId, 8);
    return Buffer.concat([header, payload]);
}

function buildIpTcpPacket({
    prefixLength,
    sourcePort = 10000,
    destinationPort = 51111,
    sequence = 1,
    payload
}) {
    const prefix = Buffer.alloc(prefixLength, 0xa5);
    const ipHeader = Buffer.alloc(20);
    const tcpHeader = Buffer.alloc(20);
    const totalLength = ipHeader.length + tcpHeader.length + payload.length;

    ipHeader[0] = 0x45;
    ipHeader.writeUInt16BE(totalLength, 2);
    ipHeader[8] = 64;
    ipHeader[9] = 6;
    ipHeader[12] = 8;
    ipHeader[13] = 133;
    ipHeader[14] = 195;
    ipHeader[15] = 27;
    ipHeader[16] = 192;
    ipHeader[17] = 168;
    ipHeader[18] = 5;
    ipHeader[19] = 66;

    tcpHeader.writeUInt16BE(sourcePort, 0);
    tcpHeader.writeUInt16BE(destinationPort, 2);
    tcpHeader.writeUInt32BE(sequence, 4);
    tcpHeader[12] = 0x50;
    tcpHeader[13] = 0x18;

    return Buffer.concat([prefix, ipHeader, tcpHeader, payload]);
}

function buildEnhancedPacketBlock(packetData) {
    const paddedLength = Math.ceil(packetData.length / 4) * 4;
    const body = Buffer.alloc(20 + paddedLength);
    body.writeUInt32LE(0, 0);
    body.writeUInt32LE(0, 4);
    body.writeUInt32LE(0, 8);
    body.writeUInt32LE(packetData.length, 12);
    body.writeUInt32LE(packetData.length, 16);
    packetData.copy(body, 20);
    return block(0x00000006, body);
}

function block(type, body) {
    const length = 12 + body.length;
    const buffer = Buffer.alloc(length);
    buffer.writeUInt32LE(type, 0);
    buffer.writeUInt32LE(length, 4);
    body.copy(buffer, 8);
    buffer.writeUInt32LE(length, length - 4);
    return buffer;
}

function buildPcapng(packetData) {
    const section = block(0x0a0d0d0a, Buffer.from([
        0x4d, 0x3c, 0x2b, 0x1a,
        1, 0, 0, 0,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff
    ]));
    const interfaceDescription = block(0x00000001, Buffer.from([
        1, 0, 0, 0,
        0xff, 0xff, 0, 0
    ]));
    return Buffer.concat([section, interfaceDescription, buildEnhancedPacketBlock(packetData)]);
}

function buildPcapngPackets(packetDatas) {
    const section = block(0x0a0d0d0a, Buffer.from([
        0x4d, 0x3c, 0x2b, 0x1a,
        1, 0, 0, 0,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff
    ]));
    const interfaceDescription = block(0x00000001, Buffer.from([
        1, 0, 0, 0,
        0xff, 0xff, 0, 0
    ]));
    return Buffer.concat([
        section,
        interfaceDescription,
        ...packetDatas.map((packetData) => buildEnhancedPacketBlock(packetData))
    ]);
}

describe('BidKing TCP pcap parser', () => {
    it('pairs market price requests and responses as realtime events', () => {
        const requestPayload = Buffer.concat([
            intField(1, 1247189784563310n),
            intField(2, 1022001)
        ]);
        const responsePayload = Buffer.concat([
            messageField(2, Buffer.concat([intField(1, 1155), intField(2, 105)])),
            messageField(2, Buffer.concat([intField(1, 1194), intField(2, 9)])),
            messageField(2, Buffer.concat([intField(1, 1232), intField(2, 167)]))
        ]);
        const pcap = buildPcapngPackets([
            buildIpTcpPacket({
                prefixLength: 32,
                sourcePort: 51111,
                destinationPort: 10000,
                sequence: 1000,
                payload: buildUpFrame(58, requestPayload)
            }),
            buildIpTcpPacket({
                prefixLength: 32,
                sourcePort: 10000,
                destinationPort: 51111,
                sequence: 2000,
                payload: buildDownFrame(59, responsePayload)
            })
        ]);

        const parsed = parseBidKingTcpPcap(pcap);
        const summaries = summarizeBidKingTcp(parsed);
        const events = extractBidKingRealtimeEvents(summaries);

        expect(summaries).toMatchObject([
            {
                msgId: 59,
                kind: 'market_price_list',
                clientMsgId: 99,
                marketPrice: {
                    requestUid: '1247189784563310',
                    itemCid: 1022001,
                    prices: [
                        { price: 1155, count: 105 },
                        { price: 1194, count: 9 },
                        { price: 1232, count: 167 }
                    ],
                    minPrice: 1155,
                    maxPrice: 1232,
                    totalCount: 281
                }
            }
        ]);
        expect(events).toMatchObject([
            {
                type: 'market_price',
                key: 'market:1022001:99',
                msgId: 59,
                sourceKind: 'market_price_list',
                itemCid: 1022001,
                requestUid: '1247189784563310',
                minPrice: 1155,
                maxPrice: 1232,
                totalCount: 281
            }
        ]);
    });

    it('keeps repeated skill uids when they belong to different games', () => {
        const summaries = [
            {
                msgId: 33,
                kind: 'game_start',
                gameData: {
                    gameUid: 'game-1',
                    heroSkills: [{
                        uid: 'reused-start',
                        skillCid: 1002081,
                        hitBoxList: [{ boxId: 0, itemSlotType: 11 }]
                    }]
                }
            },
            {
                msgId: 33,
                kind: 'game_start',
                gameData: {
                    gameUid: 'game-2',
                    heroSkills: [{
                        uid: 'reused-start',
                        skillCid: 1002081,
                        hitBoxList: [{ boxId: 19, itemSlotType: 11 }]
                    }]
                }
            }
        ];

        const events = extractBidKingRealtimeEvents(summaries);

        expect(events.map((event) => event.gameUid)).toEqual(['game-1', 'game-2']);
        expect(events.map((event) => event.key)).toEqual(['skill:reused-start', 'skill:reused-start']);
    });

    it('keeps repeated skill uid updates when later payload reveals exact item data', () => {
        const summaries = [
            {
                msgId: 37,
                kind: 'game_next_round',
                gameData: {
                    gameUid: 'game-1',
                    itemSkills: [{
                        uid: 'same-skill',
                        skillCid: 200022,
                        hitBoxList: [{ boxId: 25, itemSlotType: 22, itemQuility: 3, itemQuilityName: '蓝' }]
                    }]
                }
            },
            {
                msgId: 37,
                kind: 'game_next_round',
                gameData: {
                    gameUid: 'game-1',
                    itemSkills: [{
                        uid: 'same-skill',
                        skillCid: 200022,
                        hitBoxList: [{
                            boxId: 25,
                            itemCid: 1033001,
                            itemSlotType: 22,
                            itemQuility: 3,
                            itemQuilityName: '蓝',
                            itemPrice: 3851
                        }]
                    }]
                }
            }
        ];

        const events = extractBidKingRealtimeEvents(summaries);

        expect(events).toHaveLength(2);
        expect(events.map((event) => event.key)).toEqual(['skill:same-skill', 'skill:same-skill']);
        expect(events[1].skill.hitBoxList[0]).toMatchObject({
            itemCid: 1033001,
            itemPrice: 3851
        });
    });

    it('scans pktmon-prefixed packets for the IPv4 header', () => {
        const packet = buildIpTcpPacket({
            prefixLength: 34,
            payload: Buffer.from('payload')
        });

        expect(findIpv4PacketOffset(packet)).toBe(34);
    });

    it('reassembles downlink frames and summarizes game start and over payloads', () => {
        const user = Buffer.concat([
            intField(1, 242511033854034n),
            stringField(2, 'melo'),
            intField(3, 204),
            messageField(5, intField(2, 66667))
        ]);
        const gameData = Buffer.concat([
            stringField(1, '2101:1178745395783897'),
            intField(2, 2101),
            messageField(5, user)
        ]);
        const startPayload = messageField(1, gameData);
        const overPayload = Buffer.concat([
            intField(1, 242511033854034n),
            messageField(2, gameData)
        ]);
        const tcpPayload = Buffer.concat([
            buildDownFrame(33, startPayload),
            buildDownFrame(45, overPayload)
        ]);
        const pcap = buildPcapng(buildIpTcpPacket({
            prefixLength: 32,
            sequence: 1000,
            payload: tcpPayload
        }));

        const parsed = parseBidKingTcpPcap(pcap);
        const summary = summarizeBidKingFrames(parsed.downstream.frames);

        expect(parsed.packetCount).toBe(1);
        expect(parsed.downstream.frames.map((frame) => frame.msgId)).toEqual([33, 45]);
        expect(parsed.downstream.gaps).toBe(0);
        expect(summary).toMatchObject([
            {
                msgId: 33,
                kind: 'game_start',
                gameData: {
                    gameUid: '2101:1178745395783897',
                    mapId: 2101,
                    players: [{ name: 'melo', userUid: '242511033854034' }]
                }
            },
            {
                msgId: 45,
                kind: 'game_over',
                winnerUid: '242511033854034',
                gameData: {
                    gameUid: '2101:1178745395783897',
                    players: [{ priceLog: [{ value: 66667 }] }]
                }
            }
        ]);
    });

    it('reassembles a downstream frame split across parser batches', () => {
        const skill = Buffer.concat([
            intField(1, 702),
            intField(4, 100136),
            intField(13, 1173316373699955n)
        ]);
        const frame = buildDownFrame(187, messageField(2, skill));
        const splitAt = 20;
        const state = createBidKingTcpStreamState();
        const firstBatch = buildPcapng(buildIpTcpPacket({
            prefixLength: 32,
            sequence: 1000,
            payload: frame.subarray(0, splitAt)
        }));
        const secondBatch = buildPcapng(buildIpTcpPacket({
            prefixLength: 32,
            sequence: 1000 + splitAt,
            payload: frame.subarray(splitAt)
        }));

        const firstParsed = parseBidKingTcpPcap(firstBatch, { streamState: state });
        const firstSummaries = summarizeBidKingFrames(firstParsed.downstream.frames);
        const firstRemainder = state.downstream.remainderBase64;
        const secondParsed = parseBidKingTcpPcap(secondBatch, { streamState: state });
        const secondSummaries = summarizeBidKingFrames(secondParsed.downstream.frames);

        expect(firstParsed.downstream.frames).toEqual([]);
        expect(firstSummaries).toEqual([]);
        expect(firstRemainder).not.toBe('');
        expect(secondParsed.downstream.frames.map((frameItem) => frameItem.msgId)).toEqual([187]);
        expect(state.downstream.remainderBase64).toBe('');
        expect(secondSummaries).toMatchObject([
            {
                msgId: 187,
                kind: 'room_game_use_item',
                skill: {
                    skillCid: 702,
                    itemCid: 100136,
                    uid: '1173316373699955'
                }
            }
        ]);
    });

    it('extracts unique realtime skill events from cumulative game data summaries', () => {
        const hitBox = Buffer.concat([
            intField(1, 7),
            intField(3, 1095004),
            intField(6, 5),
            intField(7, 12600),
            intField(8, 1)
        ]);
        const skill = Buffer.concat([
            intField(1, 702),
            intField(4, 100136),
            intField(6, 2),
            messageField(8, hitBox),
            intField(13, 1173316373699955n)
        ]);
        const gameData = Buffer.concat([
            stringField(1, '4401:1178745399131755'),
            intField(2, 4401),
            intField(3, 2),
            messageField(8, skill)
        ]);
        const pcap = buildPcapng(buildIpTcpPacket({
            prefixLength: 32,
            sequence: 1000,
            payload: Buffer.concat([
                buildDownFrame(37, messageField(1, gameData)),
                buildDownFrame(45, Buffer.concat([
                    intField(1, 1054294212084328n),
                    messageField(2, gameData)
                ]))
            ])
        }));

        const parsed = parseBidKingTcpPcap(pcap);
        const summaries = summarizeBidKingFrames(parsed.downstream.frames);
        const events = extractBidKingRealtimeEvents(summaries);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            type: 'skill',
            key: 'skill:1173316373699955',
            msgId: 37,
            sourceKind: 'game_next_round',
            gameUid: '4401:1178745399131755',
            round: 2,
            group: 'item',
            skill: {
                skillCid: 702,
                itemCid: 100136,
                castRound: 2,
                hitBoxCount: 1,
                fullHitBoxCount: 1,
                qualityOnlyHitBoxCount: 0
            }
        });
        expect(events[0].skill.hitBoxList[0]).toMatchObject({
            boxId: 7,
            itemCid: 1095004,
            itemQuility: 5,
            itemPrice: 12600,
            itemBoxIndex: 1
        });
    });

    it('summarizes room item skill callbacks with the room msgId kind', () => {
        const skill = Buffer.concat([
            intField(1, 702),
            intField(4, 100136),
            intField(13, 1173316373699955n)
        ]);
        const pcap = buildPcapng(buildIpTcpPacket({
            prefixLength: 32,
            sequence: 1000,
            payload: buildDownFrame(187, messageField(2, skill))
        }));

        const parsed = parseBidKingTcpPcap(pcap);
        const summaries = summarizeBidKingFrames(parsed.downstream.frames);

        expect(summaries).toMatchObject([
            {
                msgId: 187,
                kind: 'room_game_use_item',
                skill: {
                    skillCid: 702,
                    itemCid: 100136,
                    uid: '1173316373699955'
                }
            }
        ]);
    });

    it('extracts realtime item skill events that only contain aggregate average cells', () => {
        const skill = Buffer.concat([
            intField(1, 303),
            intField(4, 100112),
            intField(6, 1),
            float32Field(11, 2.5),
            intField(13, 1173178965153866n)
        ]);
        const gameData = Buffer.concat([
            stringField(1, '2103:1178745632081515'),
            intField(2, 2103),
            intField(3, 3),
            messageField(8, skill)
        ]);
        const pcap = buildPcapng(buildIpTcpPacket({
            prefixLength: 32,
            sequence: 1000,
            payload: buildDownFrame(45, Buffer.concat([
                intField(1, 242511033854034n),
                messageField(2, gameData)
            ]))
        }));

        const parsed = parseBidKingTcpPcap(pcap);
        const summaries = summarizeBidKingFrames(parsed.downstream.frames);
        const events = extractBidKingRealtimeEvents(summaries);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            type: 'skill',
            key: 'skill:1173178965153866',
            msgId: 45,
            sourceKind: 'game_over',
            gameUid: '2103:1178745632081515',
            round: 3,
            group: 'item',
            skill: {
                skillCid: 303,
                itemCid: 100112,
                castRound: 1,
                allHitItemAvgBoxIndex: 2.5,
                hitBoxCount: 0,
                fullHitBoxCount: 0,
                qualityOnlyHitBoxCount: 0
            }
        });
    });
});
