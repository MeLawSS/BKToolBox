#!/usr/bin/env node
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// Set before any spawn so all child processes (npm run build:pages,
// electron-builder, etc.) inherit the Electron download mirror.
process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');

function toCliPath(targetPath) {
  return String(targetPath).replaceAll('\\', '/');
}

export function resolveNativeCommand(command, platform = process.platform) {
  if (platform !== 'win32') {
    return command;
  }
  if (path.extname(command)) {
    return command;
  }
  return `${command}.cmd`;
}

export function buildNativeSpawnSpec(command, args, platform = process.platform, env = process.env) {
  const resolvedCommand = resolveNativeCommand(command, platform);

  if (platform !== 'win32' || path.extname(resolvedCommand).toLowerCase() !== '.cmd') {
    return {
      command: resolvedCommand,
      args,
    };
  }

  return {
    command: env.ComSpec || env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', resolvedCommand, ...args],
  };
}

export function isNativeWindowsEnvironment(platform = process.platform) {
  return platform === 'win32';
}

export function isWslEnvironment(env = { platform: process.platform, release: os.release() }) {
  return env.platform === 'linux'
    && String(env.release || '').toLowerCase().includes('microsoft');
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

function readGlibcVersion(processReport = process.report) {
  return processReport?.getReport?.()?.header?.glibcVersionRuntime ?? '';
}

function createPackEnv(processObject = process, osModule = os) {
  return {
    platform: processObject.platform,
    release: osModule.release(),
    arch: processObject.arch,
    glibcVersionRuntime: readGlibcVersion(processObject.report),
  };
}

export function resolvePackProfile(platform = process.platform) {
  if (platform === 'win32') {
    return 'windows-native';
  }
  if (platform === 'linux') {
    return 'linux-native';
  }
  throw new Error(`Unsupported pack host platform: ${platform}`);
}

export function assertSupportedPackHost(env, deps = {}) {
  if (env.platform !== 'linux') return;

  if (env.arch !== 'x64') {
    throw new Error('linux-native pack requires x64 GNU Node runtime');
  }
  if (!env.glibcVersionRuntime) {
    throw new Error('linux-native pack requires glibc runtime');
  }
  const hasBinding = deps.hasLinuxRolldownBinding ?? hasLinuxRolldownBinding;
  if (!hasBinding(deps.projectRoot ?? projectRoot, deps)) {
    throw new Error('linux-native pack requires @rolldown/binding-linux-x64-gnu before build starts');
  }
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

function logPackContext(context, deps = {}) {
  const logInfo = deps.logInfo ?? console.log;
  if (isWslEnvironment(context.env)) {
    logInfo('pack host: WSL');
  }
  logInfo(`pack profile: ${context.profile}`);
}

function padTimestampSegment(value) {
  return String(value).padStart(2, '0');
}

export function validateAppDirName(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error('--app-dir-name cannot be empty');
  }
  if (
    trimmed === '.'
    || trimmed === '..'
    || trimmed.includes('/')
    || trimmed.includes('\\')
    || trimmed.includes('..')
  ) {
    throw new Error('--app-dir-name must be a single directory name');
  }
  return trimmed;
}

export function parsePackArgs(argv) {
  const options = {
    appDirName: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--app-dir-name') {
      index += 1;
      if (index >= argv.length) {
        throw new Error('--app-dir-name requires a value');
      }
      options.appDirName = validateAppDirName(argv[index]);
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export function formatTimestampAppDirName(date = new Date()) {
  return [
    String(date.getFullYear()),
    padTimestampSegment(date.getMonth() + 1),
    padTimestampSegment(date.getDate()),
    padTimestampSegment(date.getHours()),
    padTimestampSegment(date.getMinutes()),
    padTimestampSegment(date.getSeconds()),
  ].join('');
}

export function resolvePackOptions(options = {}, date = new Date()) {
  return {
    ...options,
    appDirName: options.appDirName
      ? validateAppDirName(options.appDirName)
      : formatTimestampAppDirName(date),
  };
}

export function getPackPaths(rootDir, options) {
  const distDir = path.join(rootDir, 'dist');
  const defaultAppDir = path.join(distDir, 'win-unpacked');
  const builderOutputDir = options.appDirName
    ? path.join(distDir, `.pack-output-${options.appDirName}`)
    : distDir;
  const builtAppDir = path.join(builderOutputDir, 'win-unpacked');
  return {
    distDir,
    builderOutputDir,
    defaultAppDir,
    builtAppDir,
    finalAppDir: options.appDirName ? path.join(distDir, options.appDirName) : defaultAppDir,
  };
}

export function getElectronBuilderArgs(paths, formatPath = toCliPath) {
  if (paths.builderOutputDir === paths.distDir) {
    return ['--win', '--dir'];
  }
  return ['--win', '--dir', `--config.directories.output=${formatPath(paths.builderOutputDir)}`];
}

function printUsage() {
  console.log(`Usage: node scripts/pack-win-dir.mjs [options]

Build the Windows unpacked app.

By default, writes the unpacked app to dist/<YYYYMMDDHHMMSS>.

Options:
  --app-dir-name <name>   Use dist/<name> instead of the default timestamp directory
  -h, --help              Show this help

Examples:
  npm run pack
  npm run pack -- --app-dir-name BKToolBox-dev
`);
}

async function runNativeCommand(command, args, cwd = projectRoot, deps = {}) {
  const spawnImpl = deps.spawn ?? spawn;
  const spawnSpec = buildNativeSpawnSpec(command, args);
  const child = spawnImpl(spawnSpec.command, spawnSpec.args, {
    cwd,
    stdio: 'inherit',
  });
  await waitForChild(child, spawnSpec.command);
}

async function renameDefaultAppDir(paths) {
  if (paths.builtAppDir === paths.finalAppDir) return;
  await fs.rm(paths.finalAppDir, { recursive: true, force: true });
  await fs.rename(paths.builtAppDir, paths.finalAppDir);
  if (paths.builderOutputDir !== paths.distDir) {
    await fs.rm(paths.builderOutputDir, { recursive: true, force: true });
  }
}

export async function runBuildPagesStage(context, deps = {}) {
  const runNative = deps.runNativeCommand ?? runNativeCommand;
  const env = context.env;
  if (
    env.platform === 'linux'
    && !(deps.hasLinuxRolldownBinding ?? hasLinuxRolldownBinding)(context.projectRoot, deps)
  ) {
    throw new Error('build:pages cannot run natively on Linux: missing @rolldown/binding-linux-x64-gnu');
  }
  await runNative('npm', ['run', 'build:pages'], context.projectRoot, deps);
}

export async function runPrepareDumpcapStage(context, deps = {}) {
  const runNative = deps.runNativeCommand ?? runNativeCommand;
  await runNative('npm', ['run', 'prepare:dumpcap'], context.projectRoot, deps);
}

export async function runBuildAgentDllStage(context, deps = {}) {
  const runNative = deps.runNativeCommand ?? runNativeCommand;
  await runNative('npm', ['run', 'build:agent-dll'], context.projectRoot, deps);
}

export async function runElectronBuilderStage(context, deps = {}) {
  const runNative = deps.runNativeCommand ?? runNativeCommand;
  await runNative('electron-builder', getElectronBuilderArgs(context.paths), context.projectRoot, deps);
}

export async function runPatchIconsStage(context, deps = {}) {
  if (context.profile !== 'windows-native') {
    return;
  }
  const runNative = deps.runNativeCommand ?? runNativeCommand;
  await runNative(
    context.execPath ?? process.execPath,
    [path.join(context.projectRoot, 'scripts', 'patch-win-icons.js'), context.paths.finalAppDir],
    context.projectRoot,
    deps,
  );
}

export async function runPack(options, deps = {}) {
  const rootDir = deps.projectRoot ?? projectRoot;
  const env = deps.env ?? createPackEnv(process, os);
  const profile = resolvePackProfile(env.platform);
  const execPath = deps.execPath ?? process.execPath;
  const renameDefaultAppDirImpl = deps.renameDefaultAppDir ?? renameDefaultAppDir;

  assertSupportedPackHost(env, { ...deps, projectRoot: rootDir });

  const resolvedOptions = resolvePackOptions(options);
  const paths = getPackPaths(rootDir, resolvedOptions);
  const context = { projectRoot: rootDir, paths, env, execPath, profile };

  logPackContext(context, deps);
  await runBuildAgentDllStage(context, deps);
  await runBuildPagesStage(context, deps);
  await runPrepareDumpcapStage(context, deps);
  await runElectronBuilderStage(context, deps);
  await renameDefaultAppDirImpl(paths);
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

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`[pack-win-dir] ${error.message}`);
    process.exitCode = 1;
  });
}
