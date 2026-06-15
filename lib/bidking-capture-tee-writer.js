'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const SHB_TYPE = 0x0A0D0D0A;
const IDB_TYPE = 0x00000001;

let _globalFileSeq = 0;

class TeeWriter extends EventEmitter {
  constructor({ outputDir, maxFiles = 120, rotationBytes = 32 * 1024 * 1024, now = () => new Date(), onError = () => {} }) {
    super();
    this._outputDir = outputDir;
    this._maxFiles = maxFiles;
    this._rotationBytes = rotationBytes;
    this._now = now;
    this._onError = onError;
    this._currentStream = null;
    this._currentBytes = 0;
    this._pendingRotate = false;
    this._files = [];
    this._headerBlocks = [];
  }

  writeBlock(block) {
    const blockType = block.readUInt32LE(0);
    if (blockType === SHB_TYPE || blockType === IDB_TYPE) {
      this._headerBlocks.push(block);
    }

    if (!this._currentStream) {
      if (this._pendingRotate) {
        this._pendingRotate = false;
        this._rotate();
      } else {
        this._openInitialFile();
      }
    } else if (this._currentBytes >= this._rotationBytes) {
      this._rotate();
    }

    this._currentStream.write(block);
    this._currentBytes += block.length;
  }

  _openInitialFile() {
    const filePath = this._newFilePath();
    // Ensure file exists immediately by opening it synchronously
    const fd = fs.openSync(filePath, 'w');
    this._currentStream = fs.createWriteStream(filePath, { fd, autoClose: true });
    this._currentStream.on('error', (err) => this._handleWriteError(err));
    this._currentBytes = 0;
    this._addFile(filePath);
    this.emit('rotate', filePath);
  }

  _rotate() {
    if (this._currentStream) {
      this._currentStream.end();
      this._currentStream = null;
    }
    const filePath = this._newFilePath();
    // Ensure file exists immediately by opening it synchronously
    const fd = fs.openSync(filePath, 'w');
    this._currentStream = fs.createWriteStream(filePath, { fd, autoClose: true });
    this._currentStream.on('error', (err) => this._handleWriteError(err));
    let headerBytes = 0;
    for (const hb of this._headerBlocks) {
      this._currentStream.write(hb);
      headerBytes += hb.length;
    }
    this._currentBytes = headerBytes;
    this._addFile(filePath);
    this.emit('rotate', filePath);
  }

  _handleWriteError(err) {
    if (this._currentStream) {
      try { this._currentStream.destroy(); } catch (_) {}
      this._currentStream = null;
    }
    this._pendingRotate = true;
    this._onError(err);
  }

  _addFile(filePath) {
    this._files.push(filePath);
    if (this._files.length > this._maxFiles) {
      const old = this._files.shift();
      try {
        fs.unlinkSync(old);
      } catch (_) {
        // ignore errors during cleanup
      }
    }
  }

  _newFilePath() {
    const stamp = formatTimestamp(this._now());
    const seq = _globalFileSeq++;
    return path.join(this._outputDir, `tcp-live-dumpcap-${stamp}-${seq}.pcapng`);
  }

  end() {
    return new Promise((resolve) => {
      if (!this._currentStream) {
        resolve();
        return;
      }
      const stream = this._currentStream;
      this._currentStream = null;
      stream.end(resolve);
    });
  }
}

function formatTimestamp(date) {
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

module.exports = { TeeWriter };
