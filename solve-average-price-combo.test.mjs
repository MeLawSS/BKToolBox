import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

function countResultLines(output) {
  return (output.match(/TotalCells=/g) || []).length;
}

async function runAveragePriceCombo(args) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['solve-average-price-combo.js', ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env, LIMIT: '5' },
      timeout: 5000,
    }
  );
  return stdout;
}

describe('all-item average price combo solver', () => {
  it('dedupes combinations with the same gold and red item multiset', async () => {
    const normal = await runAveragePriceCombo(['2', '107']);
    const deduped = await runAveragePriceCombo(['2', '107', 'dedupe-gold-red']);

    expect(countResultLines(normal)).toBe(3);
    expect(countResultLines(deduped)).toBe(1);
    expect(deduped).toContain('粗陶泥偶');
  });
});
