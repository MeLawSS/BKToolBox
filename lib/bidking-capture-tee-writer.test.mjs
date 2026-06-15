import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

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

function buildEPB(size = 32) {
  const blockLen = 32 + Math.ceil(size / 4) * 4;
  const b = Buffer.alloc(blockLen);
  b.writeUInt32LE(0x00000006, 0);
  b.writeUInt32LE(blockLen, 4);
  b.writeUInt32LE(size, 20);
  b.writeUInt32LE(size, 24);
  b.writeUInt32LE(blockLen, blockLen - 4);
  return b;
}

describe('TeeWriter', () => {
  async function makeWriter(opts = {}) {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'tee-writer-'));
    const { TeeWriter } = require('./bidking-capture-tee-writer.js');
    let seq = 0;
    const tee = new TeeWriter({
      outputDir,
      maxFiles: opts.maxFiles ?? 120,
      rotationBytes: opts.rotationBytes ?? 32 * 1024 * 1024,
      now: () => new Date(`2026-01-01T00:00:0${seq++}.000Z`),
      onError: opts.onError ?? (() => {}),
    });
    return { tee, outputDir };
  }

  it('opens the initial file on first writeBlock without prepending headers', async () => {
    const { tee, outputDir } = await makeWriter();
    const rotations = [];
    tee.on('rotate', p => rotations.push(p));

    const shb = buildSHB();
    const idb = buildIDB();
    tee.writeBlock(shb);
    tee.writeBlock(idb);
    await tee.end();

    expect(rotations).toHaveLength(1);
    const files = await readdir(outputDir);
    expect(files.filter(f => f.endsWith('.pcapng'))).toHaveLength(1);

    const content = await readFile(path.join(outputDir, files[0]));
    expect(content.slice(0, 4).readUInt32LE(0)).toBe(0x0A0D0D0A);
    expect(content.length).toBe(shb.length + idb.length);

    await rm(outputDir, { recursive: true, force: true });
  });

  it('rotates at block boundary and prepends SHB+IDB to new file', async () => {
    const { tee, outputDir } = await makeWriter({ rotationBytes: 28 + 20 });
    const rotations = [];
    tee.on('rotate', p => rotations.push(p));

    tee.writeBlock(buildSHB());
    tee.writeBlock(buildIDB());
    const epb = buildEPB(4);
    tee.writeBlock(epb);
    await tee.end();

    expect(rotations).toHaveLength(2);
    const files = (await readdir(outputDir)).filter(f => f.endsWith('.pcapng')).sort();
    expect(files).toHaveLength(2);

    const second = await readFile(path.join(outputDir, files[1]));
    expect(second.slice(0, 4).readUInt32LE(0)).toBe(0x0A0D0D0A);
    expect(second.slice(28, 32).readUInt32LE(0)).toBe(0x00000001);
    expect(second.slice(48, 52).readUInt32LE(0)).toBe(0x00000006);

    await rm(outputDir, { recursive: true, force: true });
  });

  it('deletes the oldest file when maxFiles is exceeded', async () => {
    const { tee, outputDir } = await makeWriter({ maxFiles: 2, rotationBytes: 28 });
    const rotations = [];
    tee.on('rotate', p => rotations.push(p));

    tee.writeBlock(buildSHB());
    tee.writeBlock(buildIDB());
    tee.writeBlock(buildEPB());
    await tee.end();

    const files = (await readdir(outputDir)).filter(f => f.endsWith('.pcapng'));
    expect(files).toHaveLength(2);
    expect(existsSync(rotations[0])).toBe(false);

    await rm(outputDir, { recursive: true, force: true });
  });

  it('sets pendingRotate on write error and next writeBlock opens a new file with headers', async () => {
    const onError = vi.fn();
    const { tee, outputDir } = await makeWriter({ onError });
    const rotations = [];
    tee.on('rotate', p => rotations.push(p));

    tee.writeBlock(buildSHB());
    tee.writeBlock(buildIDB());

    tee._currentStream.destroy(new Error('disk full'));
    tee._currentStream = null;
    tee._pendingRotate = true;

    tee.writeBlock(buildEPB());
    await tee.end();

    expect(rotations).toHaveLength(2);
    const files = (await readdir(outputDir)).filter(f => f.endsWith('.pcapng')).sort();
    const recovered = await readFile(path.join(outputDir, files[files.length - 1]));
    expect(recovered.slice(0, 4).readUInt32LE(0)).toBe(0x0A0D0D0A);

    await rm(outputDir, { recursive: true, force: true });
  });
});
