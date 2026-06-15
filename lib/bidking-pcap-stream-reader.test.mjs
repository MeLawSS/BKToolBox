import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { parsePcapngEnhancedPackets } from '../scripts/parse-bidking-tcp-pcap.mjs';

const require = createRequire(import.meta.url);

function buildSHB() {
  const b = Buffer.alloc(28);
  b.writeUInt32LE(0x0A0D0D0A, 0);
  b.writeUInt32LE(28, 4);
  b.writeUInt32LE(0x1A2B3C4D, 8);
  b.writeUInt16LE(1, 12);
  b.writeUInt16LE(0, 14);
  b.writeBigInt64LE(-1n, 16);
  b.writeUInt32LE(28, 24);
  return b;
}

function buildIDB() {
  const b = Buffer.alloc(20);
  b.writeUInt32LE(0x00000001, 0);
  b.writeUInt32LE(20, 4);
  b.writeUInt16LE(1, 8);
  b.writeUInt16LE(0, 10);
  b.writeUInt32LE(0, 12);
  b.writeUInt32LE(20, 16);
  return b;
}

function buildEPB(payloadBytes) {
  const padded = Math.ceil(payloadBytes.length / 4) * 4;
  const blockLen = 32 + padded;
  const b = Buffer.alloc(blockLen);
  b.writeUInt32LE(0x00000006, 0);
  b.writeUInt32LE(blockLen, 4);
  b.writeUInt32LE(0, 8);
  b.writeUInt32LE(0, 12);
  b.writeUInt32LE(0, 16);
  b.writeUInt32LE(payloadBytes.length, 20);
  b.writeUInt32LE(payloadBytes.length, 24);
  payloadBytes.copy(b, 28);
  b.writeUInt32LE(blockLen, blockLen - 4);
  return b;
}

function buildMinimalPcapng(numPackets = 2) {
  const parts = [buildSHB(), buildIDB()];
  for (let i = 0; i < numPackets; i++) {
    parts.push(buildEPB(Buffer.alloc(20, i)));
  }
  return Buffer.concat(parts);
}

describe('PcapngStreamReader', () => {
  function makeReader() {
    const { PcapngStreamReader } = require('./bidking-pcap-stream-reader.js');
    return new PcapngStreamReader();
  }

  it('emits one block event per pcapng block when fed in one chunk', () => {
    const reader = makeReader();
    const blocks = [];
    const packets = [];
    reader.on('block', b => blocks.push(b));
    reader.on('packet', (data) => packets.push(data));

    const pcapng = buildMinimalPcapng(2);
    reader.push(pcapng);

    expect(blocks).toHaveLength(4); // SHB + IDB + EPB + EPB
    expect(packets).toHaveLength(2);
  });

  it('emits the same blocks when fed one byte at a time', () => {
    const reader = makeReader();
    const blocks = [];
    reader.on('block', b => blocks.push(b));

    const pcapng = buildMinimalPcapng(1);
    for (const byte of pcapng) {
      reader.push(Buffer.from([byte]));
    }

    expect(blocks).toHaveLength(3); // SHB + IDB + EPB
  });

  it('saves SHB and IDB into headerBlocks', () => {
    const reader = makeReader();
    reader.push(buildMinimalPcapng(0));
    expect(reader.headerBlocks).toHaveLength(2);
    expect(reader.headerBlocks[0].readUInt32LE(0)).toBe(0x0A0D0D0A);
    expect(reader.headerBlocks[1].readUInt32LE(0)).toBe(0x00000001);
  });

  it('emits error and clears buffer when block length is below 12', () => {
    const reader = makeReader();
    const errors = [];
    reader.on('error', e => errors.push(e));

    const bad = Buffer.alloc(8);
    bad.writeUInt32LE(0x00000006, 0);
    bad.writeUInt32LE(8, 4);
    reader.push(bad);

    expect(errors).toHaveLength(1);
    expect(reader._buf.length).toBe(0);
  });

  it('emits error when tail length does not match block length', () => {
    const reader = makeReader();
    const errors = [];
    reader.on('error', e => errors.push(e));

    const epb = buildEPB(Buffer.alloc(20));
    epb.writeUInt32LE(9999, epb.length - 4);
    reader.push(Buffer.concat([buildSHB(), buildIDB(), epb]));

    expect(errors).toHaveLength(1);
  });

  it('packet data matches parsePcapngEnhancedPackets for same input', () => {
    const pcapng = buildMinimalPcapng(3);

    const reader = makeReader();
    const streamedPackets = [];
    reader.on('packet', data => streamedPackets.push(data));
    reader.push(pcapng);

    const batchPackets = parsePcapngEnhancedPackets(pcapng).map(p => p.data);
    expect(streamedPackets).toHaveLength(batchPackets.length);
    for (let i = 0; i < batchPackets.length; i++) {
      expect(streamedPackets[i]).toEqual(batchPackets[i]);
    }
  });

  it('emits error when EPB capturedLength exceeds block bounds', () => {
    const reader = makeReader();
    const errors = [];
    reader.on('error', e => errors.push(e));

    // Build an EPB where capturedLength field is larger than the block
    const epb = buildEPB(Buffer.alloc(20));
    // overwrite capturedLength (offset 20) with a huge value
    epb.writeUInt32LE(9999, 20);
    reader.push(Buffer.concat([buildSHB(), buildIDB(), epb]));

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/capturedLength/);
  });
});
