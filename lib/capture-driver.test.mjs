import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CaptureDriverManager,
  findNpcapInstaller,
  findNpcapUninstaller,
} = require('./capture-driver.js');

describe('CaptureDriverManager', () => {
  it('reports usable when dumpcap can list capture interfaces', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dumpcap-runtime-ready-'));
    const dumpcapDir = path.join(root, 'tools', 'dumpcap');
    await mkdir(dumpcapDir, { recursive: true });
    await writeFile(path.join(dumpcapDir, 'dumpcap.exe'), 'dumpcap', 'utf8');
    const manager = new CaptureDriverManager({
      execFileAsync: vi.fn(async () => ({ stdout: '1. Ethernet\n', stderr: '' })),
      runtimeRoot: root,
    });

    await expect(manager.getStatus()).resolves.toMatchObject({
      installed: true,
      usable: true,
      state: 'ready',
    });
    await rm(root, { recursive: true, force: true });
  });

  it('reports missing driver when dumpcap cannot load Npcap', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dumpcap-runtime-missing-'));
    const dumpcapDir = path.join(root, 'tools', 'dumpcap');
    await mkdir(dumpcapDir, { recursive: true });
    await writeFile(path.join(dumpcapDir, 'dumpcap.exe'), 'dumpcap', 'utf8');
    const manager = new CaptureDriverManager({
      execFileAsync: vi.fn(async () => ({
        stdout: '',
        stderr: 'Unable to load Npcap or WinPcap (wpcap.dll)',
      })),
      runtimeRoot: root,
    });

    await expect(manager.getStatus()).resolves.toMatchObject({
      installed: false,
      usable: false,
      state: 'missing',
      message: expect.stringContaining('Npcap'),
    });
    await rm(root, { recursive: true, force: true });
  });

  it('starts the bundled Npcap installer interactively', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'npcap-runtime-'));
    const installerDir = path.join(root, 'tools', 'npcap');
    const installerPath = path.join(installerDir, 'npcap-1.80.exe');
    await mkdir(installerDir, { recursive: true });
    await writeFile(installerPath, 'installer', 'utf8');
    const child = { unref: vi.fn() };
    const spawn = vi.fn(() => child);
    const manager = new CaptureDriverManager({
      execFileAsync: vi.fn(),
      spawn,
      runtimeRoot: root,
    });

    await expect(manager.startInstall()).resolves.toMatchObject({
      started: true,
      path: installerPath,
    });
    expect(spawn).toHaveBeenCalledWith(installerPath, [], expect.objectContaining({
      detached: true,
      windowsHide: false,
    }));
    expect(child.unref).toHaveBeenCalled();

    await rm(root, { recursive: true, force: true });
  });
});

describe('Npcap path helpers', () => {
  it('finds the newest bundled Npcap installer by filename', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'npcap-files-'));
    const dir = path.join(root, 'tools', 'npcap');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'npcap-1.70.exe'), 'old', 'utf8');
    await writeFile(path.join(dir, 'npcap-1.80.exe'), 'new', 'utf8');

    await expect(findNpcapInstaller(root)).resolves.toBe(path.join(dir, 'npcap-1.80.exe'));

    await rm(root, { recursive: true, force: true });
  });

  it('finds an existing Npcap uninstaller from candidate paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'npcap-uninstall-'));
    const uninstaller = path.join(root, 'Npcap', 'uninstall.exe');
    await mkdir(path.dirname(uninstaller), { recursive: true });
    await writeFile(uninstaller, 'uninstall', 'utf8');

    await expect(findNpcapUninstaller([path.join(root, 'missing.exe'), uninstaller]))
      .resolves.toBe(uninstaller);

    await rm(root, { recursive: true, force: true });
  });
});
