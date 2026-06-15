import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  prepareDumpcapRuntime,
  resolveDumpcapSourcePath,
} from './prepare-dumpcap-runtime.mjs';

async function createPortableSource(root, options = {}) {
  const sourceDir = path.join(root, 'WiresharkPortable64');
  const wiresharkDir = path.join(sourceDir, 'App', 'Wireshark');
  await mkdir(wiresharkDir, { recursive: true });
  await writeFile(path.join(wiresharkDir, 'dumpcap.exe'), options.dumpcapText || 'dumpcap', 'utf8');
  await writeFile(path.join(wiresharkDir, 'wiretap.dll'), options.dllText || 'wiretap', 'utf8');
  await mkdir(path.join(wiresharkDir, 'imageformats'), { recursive: true });
  await writeFile(path.join(wiresharkDir, 'imageformats', 'qsvg.dll'), 'nested-dll', 'utf8');
  if (options.npcapName) {
    await writeFile(path.join(sourceDir, options.npcapName), options.npcapText || 'npcap', 'utf8');
  }
  return { sourceDir, wiresharkDir };
}

describe('prepare-dumpcap-runtime', () => {
  it('requires a WiresharkPortable64 directory instead of archive fallbacks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dumpcap-source-only-dir-'));
    await writeFile(path.join(root, 'WiresharkPortable-v4.10.0.zip'), 'zip', 'utf8');

    await expect(resolveDumpcapSourcePath(undefined, undefined, [root]))
      .rejects
      .toThrow('WiresharkPortable64');

    await rm(root, { recursive: true, force: true });
  });

  it('copies runtime files from WiresharkPortable64 and refreshes stale outputs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dumpcap-refresh-from-portable-'));
    const outputDir = path.join(root, 'out');
    const npcapOutputDir = path.join(root, 'npcap-out');
    const { sourceDir } = await createPortableSource(root, {
      dumpcapText: 'new-dumpcap',
      dllText: 'new-dll',
      npcapName: 'npcap-1.99.exe',
      npcapText: 'new-npcap',
    });
    await mkdir(outputDir, { recursive: true });
    await mkdir(npcapOutputDir, { recursive: true });
    await writeFile(path.join(outputDir, 'dumpcap.exe'), 'old-dumpcap', 'utf8');
    await writeFile(path.join(outputDir, 'legacy.dll'), 'legacy', 'utf8');
    await writeFile(path.join(npcapOutputDir, 'npcap-1.88.exe'), 'old-npcap', 'utf8');
    await writeFile(path.join(outputDir, 'source.json'), JSON.stringify({
      source: 'WiresharkPortable64',
      copiedAt: '2026-01-01T00:00:00.000Z',
      files: ['dumpcap.exe'],
      npcapInstallers: ['npcap-1.88.exe'],
    }), 'utf8');

    const result = await prepareDumpcapRuntime({
      sourcePath: sourceDir,
      outputDir,
      npcapOutputDir,
    });

    expect(result.skipped).toBe(false);
    await expect(readFile(path.join(outputDir, 'dumpcap.exe'), 'utf8')).resolves.toBe('new-dumpcap');
    await expect(readFile(path.join(outputDir, 'wiretap.dll'), 'utf8')).resolves.toBe('new-dll');
    await expect(readFile(path.join(outputDir, 'legacy.dll'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(outputDir, 'qsvg.dll'), 'utf8')).rejects.toThrow();
    await expect(readFile(path.join(npcapOutputDir, 'npcap-1.99.exe'), 'utf8')).resolves.toBe('new-npcap');
    await expect(readFile(path.join(npcapOutputDir, 'npcap-1.88.exe'), 'utf8')).rejects.toThrow();

    const sourceInfo = JSON.parse(await readFile(path.join(outputDir, 'source.json'), 'utf8'));
    expect(sourceInfo).toMatchObject({
      source: 'WiresharkPortable64',
      files: ['dumpcap.exe', 'wiretap.dll'],
      npcapInstallers: ['npcap-1.99.exe'],
    });
    expect(sourceInfo).not.toHaveProperty('copiedAt');

    await rm(root, { recursive: true, force: true });
  });

  it('supports a portable runtime directory without a bundled Npcap installer', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dumpcap-no-npcap-installer-'));
    const outputDir = path.join(root, 'out');
    const npcapOutputDir = path.join(root, 'npcap-out');
    const { sourceDir } = await createPortableSource(root);

    const result = await prepareDumpcapRuntime({
      sourcePath: sourceDir,
      outputDir,
      npcapOutputDir,
    });

    expect(result.skipped).toBe(false);
    expect(result.npcapInstallers).toEqual([]);
    await expect(readFile(path.join(outputDir, 'dumpcap.exe'), 'utf8')).resolves.toBe('dumpcap');
    expect(await readdir(npcapOutputDir)).toEqual([]);

    await rm(root, { recursive: true, force: true });
  });
});
