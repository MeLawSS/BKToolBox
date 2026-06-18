import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import patchWinIconsModule from './patch-win-icons.js';
import * as packWinDirModule from './pack-win-dir.mjs';

const { resolveExecutableTargets } = patchWinIconsModule;
const {
  assertSupportedPackHost,
  buildNativeSpawnSpec,
  getElectronBuilderArgs,
  getPackPaths,
  hasLinuxRolldownBinding,
  isWslEnvironment,
  parsePackArgs,
  resolveNativeCommand,
  resolvePackProfile,
  runBuildPagesStage,
  runElectronBuilderStage,
  runPack,
  runPatchIconsStage,
  runPrepareDumpcapStage,
} = packWinDirModule;

describe('pack-win-dir', () => {
  it('defaults pack output to a timestamp app dir name when no app dir name is provided', () => {
    const options = parsePackArgs([]);
    const sampleTime = new Date(2026, 5, 5, 15, 32, 45);

    expect(typeof packWinDirModule.resolvePackOptions).toBe('function');

    const resolvedOptions = packWinDirModule.resolvePackOptions?.(options, sampleTime);
    const paths = getPackPaths('/repo', resolvedOptions);

    expect(options.appDirName).toBe('');
    expect(resolvedOptions.appDirName).toBe('20260605153245');
    expect(paths.builderOutputDir).toBe(path.join('/repo', 'dist', '.pack-output-20260605153245'));
    expect(paths.defaultAppDir).toBe(path.join('/repo', 'dist', 'win-unpacked'));
    expect(paths.builtAppDir).toBe(path.join('/repo', 'dist', '.pack-output-20260605153245', 'win-unpacked'));
    expect(paths.finalAppDir).toBe(path.join('/repo', 'dist', '20260605153245'));
    expect(getElectronBuilderArgs(paths)).toEqual([
      '--win',
      '--dir',
      '--config.directories.output=/repo/dist/.pack-output-20260605153245',
    ]);
  });

  it('parses --app-dir-name and points the final app dir under dist', () => {
    const options = parsePackArgs(['--app-dir-name', 'BKToolBox-dev']);
    const sampleTime = new Date(2026, 5, 5, 15, 32, 45);
    const resolvedOptions = packWinDirModule.resolvePackOptions?.(options, sampleTime);
    const paths = getPackPaths('/repo', resolvedOptions);

    expect(options.appDirName).toBe('BKToolBox-dev');
    expect(resolvedOptions.appDirName).toBe('BKToolBox-dev');
    expect(paths.builderOutputDir).toBe(path.join('/repo', 'dist', '.pack-output-BKToolBox-dev'));
    expect(paths.builtAppDir).toBe(path.join('/repo', 'dist', '.pack-output-BKToolBox-dev', 'win-unpacked'));
    expect(paths.finalAppDir).toBe(path.join('/repo', 'dist', 'BKToolBox-dev'));
    expect(getElectronBuilderArgs(paths)).toEqual([
      '--win',
      '--dir',
      '--config.directories.output=/repo/dist/.pack-output-BKToolBox-dev',
    ]);
  });

  it('rejects missing or invalid app dir names', () => {
    expect(() => parsePackArgs(['--app-dir-name'])).toThrow('--app-dir-name requires a value');
    expect(() => parsePackArgs(['--app-dir-name', '   '])).toThrow('--app-dir-name cannot be empty');
    expect(() => parsePackArgs(['--app-dir-name', '../escape'])).toThrow('--app-dir-name must be a single directory name');
    expect(() => parsePackArgs(['--app-dir-name', 'dir/name'])).toThrow('--app-dir-name must be a single directory name');
    expect(() => parsePackArgs(['--app-dir-name', 'dir\\name'])).toThrow('--app-dir-name must be a single directory name');
  });

  it('detects WSL environments from platform and os release', () => {
    expect(isWslEnvironment({ platform: 'linux', release: '6.6.87.2-microsoft-standard-WSL2' })).toBe(true);
    expect(isWslEnvironment({ platform: 'linux', release: '6.6.87.2-generic' })).toBe(false);
    expect(isWslEnvironment({ platform: 'win32', release: '10.0.26100' })).toBe(false);
  });

  it('resolves Windows-native commands without relying on shell wrapping', () => {
    expect(resolveNativeCommand('npm', 'win32')).toBe('npm.cmd');
    expect(resolveNativeCommand('electron-builder', 'win32')).toBe('electron-builder.cmd');
    expect(resolveNativeCommand('/custom/node.exe', 'win32')).toBe('/custom/node.exe');
    expect(resolveNativeCommand('npm', 'linux')).toBe('npm');
  });

  it('wraps Windows cmd scripts through cmd.exe instead of spawning them directly', () => {
    expect(buildNativeSpawnSpec('npm', ['run', 'build:pages'], 'win32', {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    })).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd', 'run', 'build:pages'],
    });

    expect(buildNativeSpawnSpec('electron-builder', ['--win', '--dir'], 'win32', {})).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', 'electron-builder.cmd', '--win', '--dir'],
    });
  });

  it('keeps real executables direct on Windows', () => {
    expect(buildNativeSpawnSpec('C:\\Program Files\\nodejs\\node.exe', ['script.js'], 'win32')).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['script.js'],
    });
  });
});

describe('runPack', () => {
  describe('pack host preflight', () => {
    it('resolves exact pack profiles by platform', () => {
      expect(resolvePackProfile('win32')).toBe('windows-native');
      expect(resolvePackProfile('linux')).toBe('linux-native');
      expect(() => resolvePackProfile('darwin')).toThrow('Unsupported pack host platform: darwin');
    });

    it('keeps the env helpers internal to the module surface', () => {
      expect(packWinDirModule.readGlibcVersion).toBeUndefined();
      expect(packWinDirModule.createPackEnv).toBeUndefined();
    });

    it('fails fast on unsupported platforms before any stage runs', async () => {
      const runNativeCommand = vi.fn(async () => {});
      const runWindowsBridgedCommand = vi.fn(async () => {});

      await expect(runPack({ appDirName: 'BKToolBox-dev' }, {
        env: { platform: 'darwin', release: '23.5.0', arch: 'arm64', glibcVersionRuntime: '' },
        projectRoot: '/repo',
        runNativeCommand,
        runWindowsBridgedCommand,
      })).rejects.toThrow('Unsupported pack host platform: darwin');

      expect(runNativeCommand).not.toHaveBeenCalled();
      expect(runWindowsBridgedCommand).not.toHaveBeenCalled();
    });

    it('handles a missing process.report header without throwing from the env reader', async () => {
      const runNativeCommand = vi.fn(async () => {});

      await expect(runPack({ appDirName: 'BKToolBox-dev' }, {
        env: { platform: 'linux', release: '5.15.0-generic', arch: 'x64', glibcVersionRuntime: '' },
        projectRoot: '/repo',
        hasLinuxRolldownBinding: () => true,
        runNativeCommand,
      })).rejects.toThrow('linux-native pack requires glibc runtime');

      expect(runNativeCommand).not.toHaveBeenCalled();
    });

    it('rejects Linux x64 GNU contract failures before the build starts', () => {
      expect(() => assertSupportedPackHost({
        platform: 'linux',
        release: '6.6.87.2-generic',
        arch: 'arm64',
        glibcVersionRuntime: '2.39',
      }, {
        projectRoot: '/repo',
        hasLinuxRolldownBinding: () => true,
      })).toThrow('linux-native pack requires x64 GNU Node runtime');

      expect(() => assertSupportedPackHost({
        platform: 'linux',
        release: '6.6.87.2-generic',
        arch: 'x64',
        glibcVersionRuntime: '',
      }, {
        projectRoot: '/repo',
        hasLinuxRolldownBinding: () => true,
      })).toThrow('linux-native pack requires glibc runtime');

      expect(() => assertSupportedPackHost({
        platform: 'linux',
        release: '6.6.87.2-generic',
        arch: 'x64',
        glibcVersionRuntime: '2.39',
      }, {
        projectRoot: '/repo',
        hasLinuxRolldownBinding: () => false,
      })).toThrow('linux-native pack requires @rolldown/binding-linux-x64-gnu before build starts');
    });

    it('skips Linux-only host checks on non-Linux hosts', () => {
      const hasLinuxRolldownBinding = vi.fn(() => {
        throw new Error('should not run');
      });

      expect(assertSupportedPackHost({
        platform: 'win32',
        release: '10.0.26100',
        arch: 'arm64',
        glibcVersionRuntime: '',
      }, {
        projectRoot: '/repo',
        hasLinuxRolldownBinding,
      })).toBeUndefined();

      expect(hasLinuxRolldownBinding).not.toHaveBeenCalled();
    });
  });

  it('logs WSL host diagnostics before the profile line', async () => {
    const logInfo = vi.fn();
    const runNativeCommand = vi.fn(async () => {});
    const renameDefaultAppDir = vi.fn(async () => {});

    await runPack({ appDirName: 'BKToolBox-dev' }, {
      env: { platform: 'linux', release: '6.6.87.2-microsoft-standard-WSL2', arch: 'x64', glibcVersionRuntime: '2.39' },
      projectRoot: '/mnt/c/tools/bidking',
      hasLinuxRolldownBinding: () => true,
      logInfo,
      runNativeCommand,
      renameDefaultAppDir,
    });

    expect(logInfo.mock.calls).toEqual([
      ['pack host: WSL'],
      ['pack profile: linux-native'],
    ]);
    expect(runNativeCommand).toHaveBeenCalledTimes(3);
  });

  it('logs the native Windows profile and still patches icons', async () => {
    const logInfo = vi.fn();
    const runNativeCommand = vi.fn(async () => {});
    const renameDefaultAppDir = vi.fn(async () => {});

    await runPack({ appDirName: 'BKToolBox-dev' }, {
      env: { platform: 'win32', release: '10.0.26100', arch: 'x64', glibcVersionRuntime: '2.39' },
      projectRoot: '/repo',
      execPath: '/custom-node',
      logInfo,
      runNativeCommand,
      renameDefaultAppDir,
    });

    expect(logInfo.mock.calls).toEqual([
      ['pack profile: windows-native'],
    ]);
    expect(runNativeCommand).toHaveBeenNthCalledWith(1, 'npm', ['run', 'build:pages'], '/repo', expect.any(Object));
    expect(runNativeCommand).toHaveBeenNthCalledWith(2, 'npm', ['run', 'prepare:dumpcap'], '/repo', expect.any(Object));
    expect(runNativeCommand).toHaveBeenNthCalledWith(3, 'electron-builder', [
      '--win',
      '--dir',
      '--config.directories.output=/repo/dist/.pack-output-BKToolBox-dev',
    ], '/repo', expect.any(Object));
    expect(runNativeCommand).toHaveBeenNthCalledWith(4, '/custom-node', [
      path.join('/repo', 'scripts', 'patch-win-icons.js'),
      path.join('/repo', 'dist', 'BKToolBox-dev'),
    ], '/repo', expect.any(Object));
    expect(renameDefaultAppDir).toHaveBeenCalledWith({
      distDir: path.join('/repo', 'dist'),
      builderOutputDir: path.join('/repo', 'dist', '.pack-output-BKToolBox-dev'),
      defaultAppDir: path.join('/repo', 'dist', 'win-unpacked'),
      builtAppDir: path.join('/repo', 'dist', '.pack-output-BKToolBox-dev', 'win-unpacked'),
      finalAppDir: path.join('/repo', 'dist', 'BKToolBox-dev'),
    });
  });
});

describe('pack stage dispatch', () => {
  const projectRoot = '/mnt/c/tools/bidking';
  const env = { platform: 'linux', release: '6.6.87.2-microsoft-standard-WSL2' };
  const paths = getPackPaths(projectRoot, { appDirName: 'BKToolBox-dev' });

  it('runs build:pages natively in WSL when the Linux binding exists', async () => {
    const nativeCalls = [];

    await runBuildPagesStage(
      { projectRoot, paths, env },
      {
        hasLinuxRolldownBinding: () => true,
        runNativeCommand: async (command, args) => nativeCalls.push({ command, args }),
      },
    );

    expect(nativeCalls).toEqual([{ command: 'npm', args: ['run', 'build:pages'] }]);
  });

  it('fails build:pages natively in WSL when the Linux binding is missing and never bridges to Windows', async () => {
    await expect(runBuildPagesStage(
      { projectRoot, paths, env },
      {
        hasLinuxRolldownBinding: () => false,
      },
    )).rejects.toThrow('build:pages cannot run natively on Linux: missing @rolldown/binding-linux-x64-gnu');
  });

  it('always keeps prepare:dumpcap native in WSL', async () => {
    const nativeCalls = [];

    await runPrepareDumpcapStage(
      { projectRoot, paths, env },
      { runNativeCommand: async (command, args) => nativeCalls.push({ command, args }) },
    );

    expect(nativeCalls).toEqual([{ command: 'npm', args: ['run', 'prepare:dumpcap'] }]);
  });

  it('keeps electron-builder native in WSL and preserves POSIX output args', async () => {
    const nativeCalls = [];

    await runElectronBuilderStage(
      { projectRoot, paths, env },
      {
        runNativeCommand: async (command, args) => nativeCalls.push({ command, args }),
      },
    );

    expect(nativeCalls).toEqual([{
      command: 'electron-builder',
      args: [
        '--win',
        '--dir',
        '--config.directories.output=/mnt/c/tools/bidking/dist/.pack-output-BKToolBox-dev',
      ],
    }]);
  });

  it('skips patch-win-icons outside native Windows', async () => {
    const nativeCalls = [];

    await runPatchIconsStage(
      { projectRoot, paths, env, execPath: '/custom-node' },
      { runNativeCommand: async (command, args) => nativeCalls.push({ command, args }) },
    );

    expect(nativeCalls).toEqual([]);
  });

  it('keeps non-WSL Linux native without any bridge', async () => {
    const runNativeCommand = vi.fn(async () => {});
    const renameDefaultAppDir = vi.fn(async () => {});

    await runPack({ appDirName: 'BKToolBox-dev' }, {
      projectRoot,
      env: { platform: 'linux', release: '6.6.87.2-generic', arch: 'x64', glibcVersionRuntime: '2.39' },
      hasLinuxRolldownBinding: () => true,
      runNativeCommand,
      renameDefaultAppDir,
    });

    expect(runNativeCommand).toHaveBeenNthCalledWith(1, 'npm', ['run', 'build:pages'], projectRoot, expect.any(Object));
    expect(runNativeCommand).toHaveBeenNthCalledWith(2, 'npm', ['run', 'prepare:dumpcap'], projectRoot, expect.any(Object));
    expect(runNativeCommand).toHaveBeenNthCalledWith(3, 'electron-builder', [
      '--win',
      '--dir',
      '--config.directories.output=/mnt/c/tools/bidking/dist/.pack-output-BKToolBox-dev',
    ], projectRoot, expect.any(Object));
    expect(renameDefaultAppDir).toHaveBeenCalledWith({
      distDir: path.join(projectRoot, 'dist'),
      builderOutputDir: path.join(projectRoot, 'dist', '.pack-output-BKToolBox-dev'),
      defaultAppDir: path.join(projectRoot, 'dist', 'win-unpacked'),
      builtAppDir: path.join(projectRoot, 'dist', '.pack-output-BKToolBox-dev', 'win-unpacked'),
      finalAppDir: path.join(projectRoot, 'dist', 'BKToolBox-dev'),
    });
  });
});

describe('patch-win-icons target resolution', () => {
  it('supports the legacy dist root input', () => {
    const distDir = path.resolve('/repo', 'dist');
    expect(resolveExecutableTargets('/repo/dist')).toEqual([
      path.join(distDir, 'win-unpacked', 'BKToolBox.exe'),
    ]);
  });

  it('supports a direct app directory input', () => {
    const appDir = path.resolve('/repo', 'dist', 'BKToolBox-dev');
    expect(resolveExecutableTargets('/repo/dist/BKToolBox-dev')).toEqual([
      path.join(appDir, 'BKToolBox.exe'),
    ]);
  });

  it('prefers packaged executables in the dist root before win-unpacked', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'bk-pack-win-dir-'));
    const distDir = path.join(tempDir, 'dist');
    await mkdir(distDir, { recursive: true });
    await mkdir(path.join(distDir, 'win-unpacked'), { recursive: true });
    await writeFile(path.join(distDir, 'BKToolBox Portable.exe'), '');
    await writeFile(path.join(distDir, 'win-unpacked', 'BKToolBox.exe'), '');

    try {
      expect(resolveExecutableTargets(distDir)).toEqual([
        path.join(distDir, 'BKToolBox Portable.exe'),
        path.join(distDir, 'win-unpacked', 'BKToolBox.exe'),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps direct app-dir semantics for non-dist inputs even when win-unpacked exists', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'bk-pack-win-dir-'));
    const appDir = path.join(tempDir, 'BKToolBox-dev');
    await mkdir(path.join(appDir, 'win-unpacked'), { recursive: true });
    await writeFile(path.join(appDir, 'BKToolBox.exe'), '');
    await writeFile(path.join(appDir, 'win-unpacked', 'BKToolBox.exe'), '');

    try {
      expect(resolveExecutableTargets(appDir)).toEqual([
        path.join(appDir, 'BKToolBox.exe'),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
