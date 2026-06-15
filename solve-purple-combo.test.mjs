import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

function getResultCells(output) {
  return [...output.matchAll(/TotalCells=(\d+)/g)].map(match => Number(match[1]));
}

async function runPurpleCombo(args) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['solve-purple-combo.js', ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env, LIMIT: '20' },
      timeout: 5000,
    }
  );
  return stdout;
}

describe('purple average price combo solver', () => {
  it('dedupes combinations with the same total cells using real collectible data', async () => {
    const collectibles = JSON.parse(await readFile('public/data/collectibles.json', 'utf8'));

    expect(collectibles.some(item => item.name === '青金石盒' && item.quality === '紫')).toBe(true);
    expect(collectibles.some(item => item.name === '数位屏' && item.quality === '紫')).toBe(true);

    const normal = await runPurpleCombo(['10380', '2']);
    const deduped = await runPurpleCombo(['10380', '2', 'dedupe-total-cells']);
    const normalCells = getResultCells(normal);
    const dedupedCells = getResultCells(deduped);

    expect(normalCells).toEqual([5, 8, 8]);
    expect(dedupedCells).toEqual([5, 8]);
    expect(new Set(dedupedCells).size).toBe(dedupedCells.length);
  });

  it('keeps the solver output streaming in discovery order', async () => {
    const output = await runPurpleCombo(['5400', '2', 'dedupe-total-cells']);

    expect(getResultCells(output)).toEqual([3, 5, 4]);
  });
});
