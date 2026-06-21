# Market Price Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse BidKing trading-page TCP price list packets and expose them as structured realtime events.

**Architecture:** Keep the existing frame parser intact, add a bidirectional summarizer that pairs upstream `msgId=58` requests with downstream `msgId=59` responses by `clientMsgId`. Realtime event extraction will emit `market_price` events alongside existing skill events.

**Tech Stack:** Node.js ESM scripts, protobuf wire parsing helpers already in `scripts/parse-bidking-tcp-pcap.mjs`, Vitest parser tests.

---

### Task 1: Add Failing Market Price Parser Test

**Files:**
- Modify: `scripts/parse-bidking-tcp-pcap.test.mjs`

- [ ] **Step 1: Import the new bidirectional summarizer**

```js
import {
    createBidKingTcpStreamState,
    extractBidKingRealtimeEvents,
    findIpv4PacketOffset,
    parseBidKingTcpPcap,
    summarizeBidKingFrames,
    summarizeBidKingTcp
} from './parse-bidking-tcp-pcap.mjs';
```

- [ ] **Step 2: Add upstream frame and multi-packet pcap helpers**

```js
function buildUpFrame(msgId, payload) {
    const header = Buffer.alloc(12);
    header.writeUInt32BE(header.length + payload.length, 0);
    header.writeUInt32BE(99, 4);
    header.writeUInt32BE(msgId, 8);
    return Buffer.concat([header, payload]);
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
```

- [ ] **Step 3: Add the failing test**

```js
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
```

- [ ] **Step 4: Verify RED**

Run: `npx vitest run scripts/parse-bidking-tcp-pcap.test.mjs -t "pairs market price"`

Expected: FAIL because `summarizeBidKingTcp` is not exported yet.

### Task 2: Implement Market Price Summary and Events

**Files:**
- Modify: `scripts/parse-bidking-tcp-pcap.mjs`
- Modify: `scripts/parse-bidking-tcp-pcap.test.mjs`

- [ ] **Step 1: Add constants and bidirectional summarizer**

```js
const MARKET_PRICE_REQUEST_MSG_ID = 58;
const MARKET_PRICE_RESPONSE_MSG_ID = 59;

export function summarizeBidKingTcp(parsed, { metadata = null } = {}) {
    const marketRequests = buildMarketPriceRequestMap(parsed?.upstream?.frames ?? []);
    return summarizeBidKingFrames(parsed?.downstream?.frames ?? [], { metadata, marketRequests });
}
```

- [ ] **Step 2: Parse request and response payloads**

```js
function buildMarketPriceRequestMap(frames) {
    const requests = new Map();
    for (const frame of frames) {
        if (frame.malformed || frame.msgId !== MARKET_PRICE_REQUEST_MSG_ID) continue;
        const request = parseMarketPriceRequest(frame.payload);
        if (!request) continue;
        requests.set(frame.clientMsgId, request);
    }
    return requests;
}

function parseMarketPriceRequest(payload) {
    const fields = parseEnvelopeFields(payload);
    const requestUid = findVarintField(fields, 1);
    const itemCid = findNumberVarintField(fields, 2);
    if (!requestUid && itemCid === null) return null;
    return { requestUid, itemCid };
}

function parseMarketPriceList(payload) {
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
}
```

- [ ] **Step 3: Emit market summaries in `summarizeFrame`**

```js
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
```

- [ ] **Step 4: Emit market realtime events**

```js
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
```

- [ ] **Step 5: Verify GREEN**

Run: `npx vitest run scripts/parse-bidking-tcp-pcap.test.mjs -t "pairs market price"`

Expected: PASS.

### Task 3: CLI Integration and Regression

**Files:**
- Modify: `scripts/parse-bidking-tcp-pcap.mjs`

- [ ] **Step 1: Use bidirectional summarizer in CLI**

```js
const summaries = summarizeBidKingTcp(parsed, { metadata });
```

- [ ] **Step 2: Print market events in text mode**

```js
if (event.type === 'market_price') return formatMarketPriceEvent(event);
```

- [ ] **Step 3: Run parser test suite**

Run: `npx vitest run scripts/parse-bidking-tcp-pcap.test.mjs`

Expected: all tests pass.

- [ ] **Step 4: Verify real capture**

Run: `node scripts/parse-bidking-tcp-pcap.mjs tmp/market-capture/price-10000-20260528-122437/price-10000.pcapng --port 10000 --event-json`

Expected: includes `market_price` events for `1022001`, `1026002`, and `1093008` if the capture file is present.

- [ ] **Step 5: Commit**

```bash
git add scripts/parse-bidking-tcp-pcap.mjs scripts/parse-bidking-tcp-pcap.test.mjs docs/superpowers/plans/2026-05-28-market-price-parser.md
git commit -m "feat: parse market price tcp events"
```
