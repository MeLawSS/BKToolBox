import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

function getResultCells(output) {
  return [...output.matchAll(/TotalCells=(\d+)/g)].map(match => Number(match[1]));
}

async function runGoldCombo(args) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['solve-gold-combo.js', ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env, LIMIT: '20' },
      timeout: 5000,
    }
  );
  return stdout;
}

describe('gold average price combo solver', () => {
  it('dedupes combinations with the same total cells using real collectible data', async () => {
    const collectibles = JSON.parse(await readFile('public/data/collectibles.json', 'utf8'));

    expect(collectibles.some(item => item.name === '旗舰手机' && item.quality === '金')).toBe(true);
    expect(collectibles.some(item => item.name === '竞技离合器套件' && item.quality === '金')).toBe(true);

    const normal = await runGoldCombo(['22800', '2']);
    const deduped = await runGoldCombo(['22800', '2', 'dedupe-total-cells']);
    const normalCells = getResultCells(normal);
    const dedupedCells = getResultCells(deduped);

    expect(normalCells).toEqual([5, 5, 2]);
    expect(dedupedCells).toEqual([5, 2]);
    expect(new Set(dedupedCells).size).toBe(dedupedCells.length);
  });
});
