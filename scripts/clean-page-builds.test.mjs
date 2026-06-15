import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanPageBuilds } from './clean-page-builds.mjs';

describe('cleanPageBuilds', () => {
  it('removes Vite page outputs and preserves non-build public assets', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'page-clean-'));
    await writeFileAt(root, 'public/index.html', 'tools');
    await writeFileAt(root, 'public/home/index.html', 'home');
    await writeFileAt(root, 'public/home/assets/old.js', 'old');
    await writeFileAt(root, 'public/ahmed/index.html', 'ahmed');
    await writeFileAt(root, 'public/ahmed/assets/old.js', 'old');
    await writeFileAt(root, 'public/ahmed/ahmed-core.js', 'keep');
    await writeFileAt(root, 'public/data/collectibles.json', '[]');

    await cleanPageBuilds(root);

    await expect(readFile(path.join(root, 'public/index.html'), 'utf8')).resolves.toBe('tools');
    await expectExists(path.join(root, 'public/home/assets'), false);
    await expectExists(path.join(root, 'public/ahmed/assets'), false);
    await expect(readFile(path.join(root, 'public/ahmed/ahmed-core.js'), 'utf8')).resolves.toBe('keep');
    await expect(readFile(path.join(root, 'public/data/collectibles.json'), 'utf8')).resolves.toBe('[]');

    await rm(root, { recursive: true, force: true });
  });
});

async function writeFileAt(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function expectExists(target, expected) {
  try {
    await stat(target);
    expect(true).toBe(expected);
  } catch (_error) {
    expect(false).toBe(expected);
  }
}
