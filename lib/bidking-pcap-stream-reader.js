'use strict';

const { EventEmitter } = require('events');

const MAX_BLOCK_SIZE = 64 * 1024 * 1024;
const SHB_TYPE = 0x0A0D0D0A;
const IDB_TYPE = 0x00000001;
const EPB_TYPE = 0x00000006;

class PcapngStreamReader extends EventEmitter {
  constructor() {
    super();
    this._buf = Buffer.alloc(0);
    this._packetIndex = 0;
    this.headerBlocks = [];
  }

  push(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    this._processBlocks();
  }

  _processBlocks() {
    while (true) {
      if (this._buf.length < 8) break;

      const blockLength = this._buf.readUInt32LE(4);

      if (blockLength < 12 || blockLength > MAX_BLOCK_SIZE) {
        this._buf = Buffer.alloc(0);
        this.emit('error', new Error(`invalid pcapng block length: ${blockLength}`));
        return;
      }

      if (this._buf.length < blockLength) break;

      const block = this._buf.subarray(0, blockLength);

      const tailLength = block.readUInt32LE(blockLength - 4);
      if (tailLength !== blockLength) {
        this._buf = Buffer.alloc(0);
        this.emit('error', new Error(`pcapng block tail mismatch: expected ${blockLength}, got ${tailLength}`));
        return;
      }

      this._buf = this._buf.subarray(blockLength);

      const blockType = block.readUInt32LE(0);

      if (blockType === SHB_TYPE || blockType === IDB_TYPE) {
        this.headerBlocks.push(block);
      }

      if (blockType === EPB_TYPE && blockLength >= 32) {
        const capturedLength = block.readUInt32LE(20);
        if (28 + capturedLength + 4 > blockLength) {
          this._buf = Buffer.alloc(0);
          this.emit('error', new Error(`EPB capturedLength ${capturedLength} exceeds block bounds`));
          return;
        }
        const packetData = block.subarray(28, 28 + capturedLength);
        this.emit('block', block);
        this.emit('packet', packetData, this._packetIndex++);
      } else {
        this.emit('block', block);
      }
    }
  }
}

module.exports = { PcapngStreamReader };
