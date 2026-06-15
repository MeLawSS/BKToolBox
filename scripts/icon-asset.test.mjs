import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function parseIcoEntries(buffer) {
  const reserved = buffer.readUInt16LE(0);
  const type = buffer.readUInt16LE(2);
  const count = buffer.readUInt16LE(4);

  if (reserved !== 0 || type !== 1) {
    throw new Error('Not a valid ICO file');
  }

  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + (index * 16);
    const width = buffer.readUInt8(offset) || 256;
    const height = buffer.readUInt8(offset + 1) || 256;
    const bitCount = buffer.readUInt16LE(offset + 6);
    const size = buffer.readUInt32LE(offset + 8);
    const imageOffset = buffer.readUInt32LE(offset + 12);
    entries.push({ width, height, bitCount, size, imageOffset });
  }

  return entries;
}

describe('build/icon.ico', () => {
  it('contains the standard small and large icon sizes used by Windows Explorer', () => {
    const iconPath = path.resolve('build', 'icon.ico');
    const entries = parseIcoEntries(readFileSync(iconPath));
    const sizes = entries.map((entry) => `${entry.width}x${entry.height}`);

    expect(sizes).toEqual(expect.arrayContaining([
      '16x16',
      '32x32',
      '48x48',
      '256x256',
    ]));
    expect(entries.length).toBeGreaterThanOrEqual(4);
  });
});
