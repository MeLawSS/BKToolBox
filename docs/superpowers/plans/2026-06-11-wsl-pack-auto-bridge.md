# WSL Pack Auto-Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current WSL whole-script Windows relaunch with per-stage automatic dispatch in `npm run pack`, while keeping `build:pages` native in WSL whenever the Linux `rolldown` binding is actually installed.

**Architecture:** Keep `scripts/pack-win-dir.mjs` as the single pack orchestrator, but add explicit helper layers for platform detection, path conversion, Windows tool resolution, binding detection, and per-stage dispatch. Remove the legacy `WINDOWS_NODE_EXE` / `BK_PACK_WINDOWS_RELAUNCHED` relaunch path entirely, and unit-test the new bridge behavior through injected filesystem/process dependencies instead of the real machine `PATH`.

**Tech Stack:** Node ESM, `node:os`, `node:path`, `node:fs`, `node:child_process`, Vitest, npm, electron-builder

Reference spec: `docs/superpowers/specs/2026-06-11-wsl-pack-bridge-design.md`

---

## File Structure

- **Modify** `scripts/pack-win-dir.mjs` - replace the whole-script WSL relaunch with helper-driven stage dispatch, Windows bridge contracts, and injected process/filesystem seams for tests.
- **Modify** `scripts/pack-win-dir.test.mjs` - replace the legacy relaunch tests with helper-contract tests, stage-decision tests, and failure-path coverage from the approved spec.
- **Modify** `docs/Documentation.md` - update current-state bullets and verification notes from “relaunch the whole pack to Windows” to “per-stage auto-bridge”.

### Task 1: Lock the bridge helper contracts and remove the legacy relaunch surface

**Files:**
- Modify: `scripts/pack-win-dir.test.mjs`
- Modify: `scripts/pack-win-dir.mjs`

- [ ] **Step 1: Rewrite the helper-layer tests to match the approved contract**

Replace the old `buildWindowsRelaunchCommand()` coverage in `scripts/pack-win-dir.test.mjs` with the helper tests below:

```js
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  hasLinuxRolldownBinding,
  hasWindowsRolldownBinding,
  isNativeWindowsEnvironment,
  isWslEnvironment,
  resolveWindowsNodeToolchain,
  resolveWindowsTool,
  runWindowsBridgedCommand,
  toWindowsPath,
  toWslPath,
} from './pack-win-dir.mjs';

describe('WSL bridge helpers', () => {
  it('detects native Windows and WSL explicitly', () => {
    expect(isNativeWindowsEnvironment('win32')).toBe(true);
    expect(isNativeWindowsEnvironment('linux')).toBe(false);
    expect(isWslEnvironment({ platform: 'linux', release: '6.6.87.2-microsoft-standard-WSL2' })).toBe(true);
    expect(isWslEnvironment({ platform: 'linux', release: '6.6.87.2-generic' })).toBe(false);
  });

  it('converts paths between WSL and Windows forms', () => {
    expect(toWindowsPath('/mnt/c/tools/bidking')).toBe('C:\\tools\\bidking');
    expect(toWindowsPath('/mnt/d/work/foo/bar.cmd')).toBe('D:\\work\\foo\\bar.cmd');
    expect(toWslPath('C:\\Program Files\\nodejs\\node.exe')).toBe('/mnt/c/Program Files/nodejs/node.exe');
    expect(toWslPath('D:\\work\\foo\\bar.cmd')).toBe('/mnt/d/work/foo/bar.cmd');
  });

  it('checks the real rolldown native module files instead of package directories', () => {
    const existsSync = vi.fn((targetPath) => targetPath.endsWith('rolldown-binding.win32-x64-msvc.node'));

    expect(hasLinuxRolldownBinding('/repo', { existsSync })).toBe(false);
    expect(hasWindowsRolldownBinding('/repo', { existsSync })).toBe(true);
    expect(existsSync).toHaveBeenCalledWith(path.join(
      '/repo',
      'node_modules',
      '@rolldown',
      'binding-linux-x64-gnu',
      'rolldown-binding.linux-x64-gnu.node',
    ));
    expect(existsSync).toHaveBeenCalledWith(path.join(
      '/repo',
      'node_modules',
      '@rolldown',
      'binding-win32-x64-msvc',
      'rolldown-binding.win32-x64-msvc.node',
    ));
  });

  it('resolves Windows tools from injected where output instead of hardcoded install paths', () => {
    const runWhere = vi.fn((toolName) => {
      if (toolName === 'node') return 'C:\\Program Files\\nodejs\\node.exe\r\n';
      if (toolName === 'npm') return 'C:\\Program Files\\nodejs\\npm.cmd\r\n';
      throw new Error(`where ${toolName} returned no result`);
    });

    expect(resolveWindowsTool('npm', {
      projectRoot: '/mnt/c/tools/bidking',
      runWhere,
    })).toEqual({
      windowsPath: 'C:\\Program Files\\nodejs\\npm.cmd',
      wslPath: '/mnt/c/Program Files/nodejs/npm.cmd',
      viaCmd: true,
    });

    expect(resolveWindowsNodeToolchain({
      projectRoot: '/mnt/c/tools/bidking',
      runWhere,
    })).toEqual({
      node: {
        windowsPath: 'C:\\Program Files\\nodejs\\node.exe',
        wslPath: '/mnt/c/Program Files/nodejs/node.exe',
        viaCmd: false,
      },
      npm: {
        windowsPath: 'C:\\Program Files\\nodejs\\npm.cmd',
        wslPath: '/mnt/c/Program Files/nodejs/npm.cmd',
        viaCmd: true,
      },
    });
  });

  it('falls back to node_modules/.bin/electron-builder.cmd when where cannot find electron-builder', () => {
    const runWhere = vi.fn(() => {
      throw new Error('where electron-builder returned no result');
    });
    const existsSync = vi.fn((targetPath) => targetPath === '/mnt/c/tools/bidking/node_modules/.bin/electron-builder.cmd');

    expect(resolveWindowsTool('electron-builder', {
      projectRoot: '/mnt/c/tools/bidking',
      runWhere,
      existsSync,
    })).toEqual({
      windowsPath: 'C:\\tools\\bidking\\node_modules\\.bin\\electron-builder.cmd',
      wslPath: '/mnt/c/tools/bidking/node_modules/.bin/electron-builder.cmd',
      viaCmd: true,
    });
  });

  it('wraps .cmd tools with cmd.exe /d /c instead of spawning them directly', async () => {
    const calls = [];
    const child = {
      on(event, handler) {
        if (event === 'close') handler(0);
      },
    };

    await runWindowsBridgedCommand({
      kind: 'cmd',
      wslExecutable: 'cmd.exe',
      windowsCommand: 'C:\\Program Files\\nodejs\\npm.cmd',
      args: ['run', 'build:pages'],
      windowsCwd: 'C:\\tools\\bidking',
    }, {
      spawn(command, args, options) {
        calls.push({ command, args, options });
        return child;
      },
    });

    expect(calls).toEqual([{
      command: 'cmd.exe',
      args: ['/d', '/c', 'C:\\Program Files\\nodejs\\npm.cmd', 'run', 'build:pages'],
      options: {
        cwd: 'C:\\tools\\bidking',
        shell: false,
        stdio: 'inherit',
      },
    }]);
  });
});
```

- [ ] **Step 2: Run the helper test file and confirm it fails against the legacy implementation**

Run: `npx vitest run scripts/pack-win-dir.test.mjs`

Expected: FAIL because `isNativeWindowsEnvironment`, `toWslPath`, `resolveWindowsTool`, `resolveWindowsNodeToolchain`, `runWindowsBridgedCommand`, and the `.node`-file binding checks do not exist yet, while the old relaunch helpers still do.

- [ ] **Step 3: Implement the helper surface and delete the whole-pack relaunch path**

In `scripts/pack-win-dir.mjs`, add the helper exports below and delete the obsolete WSL relaunch code:

```js
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

export function isNativeWindowsEnvironment(platform = process.platform) {
  return platform === 'win32';
}

export function isWslEnvironment(env = { platform: process.platform, release: os.release() }) {
  return env.platform === 'linux'
    && String(env.release || '').toLowerCase().includes('microsoft');
}

export function toWindowsPath(targetPath) {
  const normalized = String(targetPath).replaceAll('\\', '/');
  const driveMatch = normalized.match(/^\/mnt\/([a-z])\/(.*)$/i);
  if (!driveMatch) return path.win32.normalize(normalized);
  const [, drive, rest] = driveMatch;
  return `${drive.toUpperCase()}:\\${rest.replace(/\//g, '\\')}`;
}

export function toWslPath(targetPath) {
  const normalized = String(targetPath).replaceAll('/', '\\');
  const driveMatch = normalized.match(/^([A-Za-z]):\\(.*)$/);
  if (!driveMatch) return String(targetPath).replaceAll('\\', '/');
  const [, drive, rest] = driveMatch;
  return `/mnt/${drive.toLowerCase()}/${rest.replaceAll('\\', '/')}`;
}

export function hasLinuxRolldownBinding(rootDir = projectRoot, deps = {}) {
  const existsSync = deps.existsSync ?? fsSync.existsSync;
  return existsSync(path.join(
    rootDir,
    'node_modules',
    '@rolldown',
    'binding-linux-x64-gnu',
    'rolldown-binding.linux-x64-gnu.node',
  ));
}

export function hasWindowsRolldownBinding(rootDir = projectRoot, deps = {}) {
  const existsSync = deps.existsSync ?? fsSync.existsSync;
  return existsSync(path.join(
    rootDir,
    'node_modules',
    '@rolldown',
    'binding-win32-x64-msvc',
    'rolldown-binding.win32-x64-msvc.node',
  ));
}

function runWhereDefault(toolName) {
  return execFileSync('cmd.exe', ['/d', '/c', 'where', toolName], {
    encoding: 'utf8',
  });
}

function normalizeWhereResult(output) {
  const firstLine = String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    throw new Error('where returned no result');
  }
  return firstLine;
}

export function resolveWindowsTool(name, deps = {}) {
  const projectRootForLookup = deps.projectRoot ?? projectRoot;
  const runWhere = deps.runWhere ?? runWhereDefault;
  const existsSync = deps.existsSync ?? fsSync.existsSync;

  try {
    const windowsPath = normalizeWhereResult(runWhere(name));
    return {
      windowsPath,
      wslPath: toWslPath(windowsPath),
      viaCmd: windowsPath.toLowerCase().endsWith('.cmd'),
    };
  } catch (error) {
    if (name === 'electron-builder') {
      const wslPath = path.join(projectRootForLookup, 'node_modules', '.bin', 'electron-builder.cmd');
      if (existsSync(wslPath)) {
        return {
          windowsPath: toWindowsPath(wslPath),
          wslPath,
          viaCmd: true,
        };
      }
    }
    throw error;
  }
}

export function resolveWindowsNodeToolchain(deps = {}) {
  return {
    node: resolveWindowsTool('node', deps),
    npm: resolveWindowsTool('npm', deps),
  };
}

function waitForChild(child, label) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

export async function runWindowsBridgedCommand(commandSpec, deps = {}) {
  const spawnImpl = deps.spawn ?? spawn;
  const command = commandSpec.kind === 'cmd'
    ? 'cmd.exe'
    : commandSpec.wslExecutable;
  const args = commandSpec.kind === 'cmd'
    ? ['/d', '/c', commandSpec.windowsCommand, ...commandSpec.args]
    : commandSpec.args;
  const label = commandSpec.kind === 'cmd'
    ? commandSpec.windowsCommand
    : commandSpec.wslExecutable;

  const child = spawnImpl(command, args, {
    cwd: commandSpec.windowsCwd,
    shell: false,
    stdio: 'inherit',
  });
  await waitForChild(child, label);
}
```

Delete these legacy symbols in the same edit:

```js
const WINDOWS_NODE_EXE = 'C:\\Program Files\\nodejs\\node.exe';
export function buildWindowsRelaunchCommand() {}
async function relaunchViaWindows() {}
if (!process.env.BK_PACK_WINDOWS_RELAUNCHED && isWslEnvironment(...)) {}
```

- [ ] **Step 4: Re-run the helper test file**

Run: `npx vitest run scripts/pack-win-dir.test.mjs`

Expected: PASS for the helper tests, while the stage-dispatch expectations are still not present yet.

- [ ] **Step 5: Commit the helper-contract round**

```bash
git add scripts/pack-win-dir.mjs scripts/pack-win-dir.test.mjs
git commit -m "refactor: add WSL bridge helper contracts"
```

### Task 2: Implement the per-stage dispatch table from the approved spec

**Files:**
- Modify: `scripts/pack-win-dir.test.mjs`
- Modify: `scripts/pack-win-dir.mjs`

- [ ] **Step 1: Add failing tests for the stage decision table and error contracts**

Append these tests to `scripts/pack-win-dir.test.mjs`:

```js
import path from 'node:path';
import {
  getPackPaths,
  runBuildPagesStage,
  runElectronBuilderStage,
  runPack,
  runPatchIconsStage,
  runPrepareDumpcapStage,
} from './pack-win-dir.mjs';

describe('pack stage dispatch', () => {
  const projectRoot = '/mnt/c/tools/bidking';
  const env = { platform: 'linux', release: '6.6.87.2-microsoft-standard-WSL2' };
  const paths = getPackPaths(projectRoot, { appDirName: 'BKToolBox-dev' });

  it('runs build:pages natively in WSL when the Linux binding exists', async () => {
    const nativeCalls = [];
    const bridgeCalls = [];

    await runBuildPagesStage(
      { projectRoot, paths, env },
      {
        hasLinuxRolldownBinding: () => true,
        hasWindowsRolldownBinding: () => false,
        runNativeCommand: async (command, args) => nativeCalls.push({ command, args }),
        runWindowsBridgedCommand: async (commandSpec) => bridgeCalls.push(commandSpec),
      },
    );

    expect(nativeCalls).toEqual([{ command: 'npm', args: ['run', 'build:pages'] }]);
    expect(bridgeCalls).toEqual([]);
  });

  it('bridges build:pages to Windows npm when the Linux binding is missing', async () => {
    const bridgeCalls = [];

    await runBuildPagesStage(
      { projectRoot, paths, env },
      {
        hasLinuxRolldownBinding: () => false,
        hasWindowsRolldownBinding: () => true,
        resolveWindowsNodeToolchain: () => ({
          node: {
            windowsPath: 'C:\\Program Files\\nodejs\\node.exe',
            wslPath: '/mnt/c/Program Files/nodejs/node.exe',
            viaCmd: false,
          },
          npm: {
            windowsPath: 'C:\\Program Files\\nodejs\\npm.cmd',
            wslPath: '/mnt/c/Program Files/nodejs/npm.cmd',
            viaCmd: true,
          },
        }),
        runNativeCommand: async () => {
          throw new Error('native build should not run');
        },
        runWindowsBridgedCommand: async (commandSpec) => bridgeCalls.push(commandSpec),
      },
    );

    expect(bridgeCalls).toEqual([expect.objectContaining({
      kind: 'cmd',
      windowsCommand: 'C:\\Program Files\\nodejs\\npm.cmd',
      args: ['run', 'build:pages'],
      windowsCwd: 'C:\\tools\\bidking',
    })]);
  });

  it('fails build:pages with a stage-specific error when no native or Windows path is available', async () => {
    await expect(runBuildPagesStage(
      { projectRoot, paths, env },
      {
        hasLinuxRolldownBinding: () => false,
        hasWindowsRolldownBinding: () => false,
        resolveWindowsNodeToolchain: () => {
          throw new Error('where node returned no result');
        },
      },
    )).rejects.toThrow('build:pages cannot run natively in WSL: missing @rolldown/binding-linux-x64-gnu');
  });

  it('always keeps prepare:dumpcap native in WSL', async () => {
    const nativeCalls = [];

    await runPrepareDumpcapStage(
      { projectRoot, paths, env },
      { runNativeCommand: async (command, args) => nativeCalls.push({ command, args }) },
    );

    expect(nativeCalls).toEqual([{ command: 'npm', args: ['run', 'prepare:dumpcap'] }]);
  });

  it('always bridges electron-builder in WSL and converts output args to Windows paths', async () => {
    const bridgeCalls = [];

    await runElectronBuilderStage(
      { projectRoot, paths, env },
      {
        resolveWindowsTool: () => ({
          windowsPath: 'C:\\tools\\bidking\\node_modules\\.bin\\electron-builder.cmd',
          wslPath: '/mnt/c/tools/bidking/node_modules/.bin/electron-builder.cmd',
          viaCmd: true,
        }),
        runWindowsBridgedCommand: async (commandSpec) => bridgeCalls.push(commandSpec),
      },
    );

    expect(bridgeCalls).toEqual([expect.objectContaining({
      kind: 'cmd',
      windowsCommand: 'C:\\tools\\bidking\\node_modules\\.bin\\electron-builder.cmd',
      args: [
        '--win',
        '--dir',
        '--config.directories.output=C:\\tools\\bidking\\dist\\.pack-output-BKToolBox-dev',
      ],
      windowsCwd: 'C:\\tools\\bidking',
    })]);
  });

  it('keeps patch-win-icons native in WSL', async () => {
    const nativeCalls = [];

    await runPatchIconsStage(
      { projectRoot, paths, env },
      { runNativeCommand: async (command, args) => nativeCalls.push({ command, args }) },
    );

    expect(nativeCalls).toEqual([{
      command: process.execPath,
      args: [path.join(projectRoot, 'scripts', 'patch-win-icons.js'), paths.finalAppDir],
    }]);
  });

  it('fails non-WSL Linux before any stage starts', async () => {
    const nativeCalls = [];
    const bridgeCalls = [];

    await expect(runPack({ appDirName: 'BKToolBox-dev' }, {
      projectRoot,
      env: { platform: 'linux', release: '6.6.87.2-generic' },
      runNativeCommand: async (...args) => nativeCalls.push(args),
      runWindowsBridgedCommand: async (...args) => bridgeCalls.push(args),
    })).rejects.toThrow('npm run pack can only build Windows output on native Windows or WSL');

    expect(nativeCalls).toEqual([]);
    expect(bridgeCalls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the stage decision tests and confirm they fail**

Run: `npx vitest run scripts/pack-win-dir.test.mjs`

Expected: FAIL because `runBuildPagesStage`, `runPrepareDumpcapStage`, `runElectronBuilderStage`, `runPatchIconsStage`, and the new `runPack()` behavior do not exist yet.

- [ ] **Step 3: Implement the stage helpers and replace the old main-path logic**

Add the stage helpers below in `scripts/pack-win-dir.mjs`, and route `runPack()` through them:

```js
function toCliPath(targetPath) {
  return String(targetPath).replaceAll('\\', '/');
}

export function getElectronBuilderArgs(paths, formatPath = toCliPath) {
  if (paths.builderOutputDir === paths.distDir) {
    return ['--win', '--dir'];
  }
  return [
    '--win',
    '--dir',
    `--config.directories.output=${formatPath(paths.builderOutputDir)}`,
  ];
}

async function runNativeCommand(command, args, cwd = projectRoot, deps = {}) {
  const spawnImpl = deps.spawn ?? spawn;
  const child = spawnImpl(command, args, {
    cwd,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  await waitForChild(child, command);
}

export async function runBuildPagesStage(context, deps = {}) {
  const runNative = deps.runNativeCommand ?? runNativeCommand;
  const runBridge = deps.runWindowsBridgedCommand ?? runWindowsBridgedCommand;
  const env = context.env;
  const isWindows = isNativeWindowsEnvironment(env.platform);
  const isWsl = isWslEnvironment(env);

  if (isWindows || !isWsl) {
    await runNative('npm', ['run', 'build:pages'], context.projectRoot, deps);
    return;
  }

  if ((deps.hasLinuxRolldownBinding ?? hasLinuxRolldownBinding)(context.projectRoot, deps)) {
    await runNative('npm', ['run', 'build:pages'], context.projectRoot, deps);
    return;
  }

  if (!(deps.hasWindowsRolldownBinding ?? hasWindowsRolldownBinding)(context.projectRoot, deps)) {
    throw new Error('build:pages cannot run natively in WSL: missing @rolldown/binding-linux-x64-gnu; Windows fallback is unavailable because @rolldown/binding-win32-x64-msvc is also missing');
  }

  let toolchain;
  try {
    toolchain = (deps.resolveWindowsNodeToolchain ?? resolveWindowsNodeToolchain)({
      projectRoot: context.projectRoot,
      runWhere: deps.runWhere,
      existsSync: deps.existsSync,
    });
  } catch (error) {
    throw new Error(`build:pages fallback to Windows bridge failed: ${error.message}`);
  }

  await runBridge({
    kind: toolchain.npm.viaCmd ? 'cmd' : 'exe',
    wslExecutable: toolchain.npm.wslPath,
    windowsCommand: toolchain.npm.windowsPath,
    args: ['run', 'build:pages'],
    windowsCwd: toWindowsPath(context.projectRoot),
  }, deps);
}

export async function runPrepareDumpcapStage(context, deps = {}) {
  const runNative = deps.runNativeCommand ?? runNativeCommand;
  await runNative('npm', ['run', 'prepare:dumpcap'], context.projectRoot, deps);
}

export async function runElectronBuilderStage(context, deps = {}) {
  const env = context.env;
  const runNative = deps.runNativeCommand ?? runNativeCommand;
  const runBridge = deps.runWindowsBridgedCommand ?? runWindowsBridgedCommand;

  if (!isWslEnvironment(env)) {
    await runNative('electron-builder', getElectronBuilderArgs(context.paths), context.projectRoot, deps);
    return;
  }

  let builderTool;
  try {
    builderTool = (deps.resolveWindowsTool ?? resolveWindowsTool)('electron-builder', {
      projectRoot: context.projectRoot,
      runWhere: deps.runWhere,
      existsSync: deps.existsSync,
    });
  } catch (error) {
    throw new Error(`electron-builder Windows bridge is unavailable: ${error.message}`);
  }

  await runBridge({
    kind: builderTool.viaCmd ? 'cmd' : 'exe',
    wslExecutable: builderTool.wslPath,
    windowsCommand: builderTool.windowsPath,
    args: getElectronBuilderArgs(context.paths, toWindowsPath),
    windowsCwd: toWindowsPath(context.projectRoot),
  }, deps);
}

export async function runPatchIconsStage(context, deps = {}) {
  const runNative = deps.runNativeCommand ?? runNativeCommand;
  await runNative(
    process.execPath,
    [path.join(context.projectRoot, 'scripts', 'patch-win-icons.js'), context.paths.finalAppDir],
    context.projectRoot,
    deps,
  );
}

export async function runPack(options, deps = {}) {
  const rootDir = deps.projectRoot ?? projectRoot;
  const env = deps.env ?? { platform: process.platform, release: os.release() };

  if (env.platform === 'linux' && !isWslEnvironment(env)) {
    throw new Error('npm run pack can only build Windows output on native Windows or WSL');
  }

  const resolvedOptions = resolvePackOptions(options);
  const paths = getPackPaths(rootDir, resolvedOptions);
  const context = { projectRoot: rootDir, paths, env };

  await runBuildPagesStage(context, deps);
  await runPrepareDumpcapStage(context, deps);
  await runElectronBuilderStage(context, deps);
  await renameDefaultAppDir(paths);
  await runPatchIconsStage(context, deps);
}

async function main(argv = process.argv.slice(2)) {
  const options = parsePackArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }
  await runPack(options);
}
```

This round must remove the old whole-script relaunch path completely:

```js
- WINDOWS_NODE_EXE
- BK_PACK_WINDOWS_RELAUNCHED
- buildWindowsRelaunchCommand()
- relaunchViaWindows()
- the WSL relaunch guard at the top of main()
```

- [ ] **Step 4: Re-run the stage-decision test file**

Run: `npx vitest run scripts/pack-win-dir.test.mjs`

Expected: PASS with the new helper-contract and dispatch tests all green.

- [ ] **Step 5: Commit the dispatch round**

```bash
git add scripts/pack-win-dir.mjs scripts/pack-win-dir.test.mjs
git commit -m "fix: auto-bridge WSL pack stages"
```

### Task 3: Update current-state docs and run the regression checks

**Files:**
- Modify: `docs/Documentation.md`

- [ ] **Step 1: Replace the old “whole relaunch” documentation with the per-stage bridge behavior**

Update the `npm run pack` bullets in `docs/Documentation.md` so they read like this:

```md
- `npm run pack` 现在默认输出到 `dist/<YYYYMMDDHHMMSS>`；如需固定目录名，继续显式传 `--app-dir-name <name>`
- `npm run pack` 在 WSL 下会按阶段自动分派：
  - `build:pages` 优先原生执行；只有缺失 `node_modules/@rolldown/binding-linux-x64-gnu/rolldown-binding.linux-x64-gnu.node` 时才回退到 Windows `npm`
  - `prepare:dumpcap` 保持 WSL 原生执行
  - `electron-builder --win --dir` 始终桥接到 Windows
  - `patch-win-icons.js` 继续走现有的 `WSL -> rcedit.exe` 原生链路
- `npm run deploy:game-pc` 为了保持默认部署路径稳定，内部仍显式执行 `npm run pack -- --app-dir-name win-unpacked`
```

Replace the stale verification note for `2026-06-11` with this one:

```md
- 2026-06-11：`npx vitest run scripts/pack-win-dir.test.mjs scripts/deploy-unpacked-app.test.mjs package-config.test.mjs` 通过；覆盖 WSL helper 合约、`.cmd` 包装、`build:pages` 原生/桥接分派、`electron-builder` Windows 桥接、`prepare:dumpcap` / `patch-win-icons` 原生分派，以及非 WSL Linux 的前置失败分支。
```

- [ ] **Step 2: Run the regression verification chain**

Run: `npx vitest run scripts/pack-win-dir.test.mjs scripts/deploy-unpacked-app.test.mjs package-config.test.mjs`

Expected: PASS

Run: `git diff --check`

Expected: no output

- [ ] **Step 3: Commit the docs/verification round**

```bash
git add docs/Documentation.md
git commit -m "docs: record WSL pack auto-bridge behavior"
```

## Self-Review

- **Spec coverage**
  - Platform split (`Windows`, `WSL`, non-WSL Linux upfront fail): Task 2
  - Exact `.node` binding detection: Task 1
  - Windows tool lookup via injected `where`: Task 1
  - `.cmd` wrapper rule via `cmd.exe /d /c`: Task 1
  - `electron-builder` path-argument Windows conversion: Task 2
  - Old relaunch path removal (`WINDOWS_NODE_EXE`, `BK_PACK_WINDOWS_RELAUNCHED`, `buildWindowsRelaunchCommand`, `relaunchViaWindows`, `main()` guard): Task 1 + Task 2
  - Current-state doc replacement from “whole relaunch” to “per-stage auto-bridge”: Task 3

- **Placeholder scan**
  - No `TODO`, `TBD`, “handle appropriately”, or “similar to Task N” placeholders remain.

- **Type/name consistency**
  - Helper contracts consistently use `windowsPath`, `wslPath`, `viaCmd`, `windowsCommand`, `windowsCwd`, `projectRoot`, `paths`, and `env`.
  - Stage helpers consistently use `runBuildPagesStage`, `runPrepareDumpcapStage`, `runElectronBuilderStage`, `runPatchIconsStage`, and `runPack`.
