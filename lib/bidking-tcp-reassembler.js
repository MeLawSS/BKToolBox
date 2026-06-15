'use strict';

const { pathToFileURL } = require('url');
const { EventEmitter } = require('events');
const { getRuntimePath } = require('../runtime-paths.js');

class TcpStreamReassembler extends EventEmitter {
  constructor({ port, tablesDir = null } = {}) {
    super();
    this._port = port;
    this._tablesDir = tablesDir;
    this._packetIndex = 0;
    this._streamState = null;
    this._fns = null;
    this._metadata = null;
  }

  async init() {
    const mod = await import(pathToFileURL(getRuntimePath('scripts', 'parse-bidking-tcp-pcap.mjs')).href);
    this._fns = {
      extractTcpPayloadSegment: mod.extractTcpPayloadSegment,
      splitStreamDirection: mod.splitStreamDirection,
      createBidKingTcpStreamState: mod.createBidKingTcpStreamState,
      summarizeBidKingTcp: mod.summarizeBidKingTcp,
      extractBidKingRealtimeEvents: mod.extractBidKingRealtimeEvents,
    };
    this._streamState = this._fns.createBidKingTcpStreamState();
    this._upstreamFrames = [];

    if (this._tablesDir) {
      try {
        const { buildGameTableMetadata } = await import(pathToFileURL(getRuntimePath('scripts', 'watch-bidking-game-log.mjs')).href);
        this._metadata = buildGameTableMetadata(this._tablesDir);
      } catch {
        // tables dir unavailable; metadata stays null
      }
    }
  }

  resetStreamState() {
    this._streamState = this._fns.createBidKingTcpStreamState();
    this._upstreamFrames = [];
  }

  _resetDirection(direction) {
    this._streamState[direction] = { remainderBase64: '', nextSequence: null };
  }

  pushPacket(packetData) {
    const { extractTcpPayloadSegment, splitStreamDirection, summarizeBidKingTcp, extractBidKingRealtimeEvents } = this._fns;
    const packetIndex = this._packetIndex++;

    const segment = extractTcpPayloadSegment(packetData, { packetIndex, port: this._port });
    if (!segment || !segment.payload || segment.payload.length === 0) return;

    const { direction, sequence, payload } = segment;
    const dirState = this._streamState[direction];

    if (dirState.nextSequence !== null && sequence !== dirState.nextSequence) {
      const isForwardGap = ((sequence - dirState.nextSequence) >>> 0) < 0x80000000;
      if (isForwardGap) {
        this.emit('gap', { direction, expected: dirState.nextSequence, got: sequence });
        this._resetDirection(direction);
      } else {
        // retransmit or duplicate — skip without resetting state
        return;
      }
    }

    // Always re-read after potential reset
    const currentDirState = this._streamState[direction];

    const nextSeq = (sequence + payload.length) >>> 0;
    const reassembled = {
      payload,
      segmentCount: 1,
      firstSequence: sequence,
      nextSequence: nextSeq,
      gaps: 0,
      duplicates: 0,
    };

    const result = splitStreamDirection(reassembled, {
      direction,
      directionState: currentDirState,
    });

    if (!result.frames || result.frames.length === 0) return;

    if (direction === 'upstream' && result.frames.length > 0) {
      this._upstreamFrames.push(...result.frames);
    }

    const parsed = {
      packetCount: 1,
      segmentCount: 1,
      downstream: direction === 'downstream'
        ? { frames: result.frames, segmentCount: 1, gaps: 0, duplicates: 0, payload: reassembled.payload }
        : { frames: [], segmentCount: 0, gaps: 0, duplicates: 0, payload: Buffer.alloc(0) },
      upstream: direction === 'upstream'
        ? { frames: result.frames, segmentCount: 1, gaps: 0, duplicates: 0, payload: reassembled.payload }
        : { frames: this._upstreamFrames, segmentCount: this._upstreamFrames.length, gaps: 0, duplicates: 0, payload: Buffer.alloc(0) },
    };

    const summaries = summarizeBidKingTcp(parsed, { metadata: this._metadata });
    const events = extractBidKingRealtimeEvents(summaries);
    for (const event of events) {
      this.emit('event', event);
    }
  }
}

module.exports = { TcpStreamReassembler };
