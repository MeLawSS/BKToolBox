const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { getRuntimePath, getRuntimeRoot } = require('../runtime-paths');

const execFileAsyncDefault = promisify(execFile);
const DEFAULT_UNINSTALLER_CANDIDATES = [
  'C:\\Program Files\\Npcap\\uninstall.exe',
  'C:\\Program Files (x86)\\Npcap\\uninstall.exe',
];

class CaptureDriverManager {
  constructor(deps = {}) {
    this.execFileAsync = deps.execFileAsync || execFileAsyncDefault;
    this.spawn = deps.spawn || spawn;
    this.runtimeRoot = deps.runtimeRoot || getRuntimeRoot();
    this.uninstallerCandidates = deps.uninstallerCandidates || DEFAULT_UNINSTALLER_CANDIDATES;
  }

  async getStatus() {
    const dumpcapPath = resolveDumpcapPath(this.runtimeRoot);
    const installerPath = await findNpcapInstaller(this.runtimeRoot);
    const uninstallerPath = await findNpcapUninstaller(this.uninstallerCandidates);
    if (!dumpcapPath) {
      return {
        state: 'dumpcapMissing',
        installed: Boolean(uninstallerPath),
        usable: false,
        message: 'Bundled dumpcap.exe was not found. Install tools/WiresharkPortable64 and run npm run prepare:dumpcap.',
        dumpcapPath: '',
        installerPath,
        uninstallerPath,
      };
    }

    try {
      const result = await this.execFileAsync(dumpcapPath, ['-D'], {
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      });
      const text = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
      if (isMissingNpcapOutput(text)) {
        return buildMissingStatus(text, dumpcapPath, installerPath, uninstallerPath);
      }
      return {
        state: 'ready',
        installed: true,
        usable: true,
        message: text,
        dumpcapPath,
        installerPath,
        uninstallerPath,
      };
    } catch (error) {
      const text = `${error?.message || ''}\n${error?.stdout || ''}\n${error?.stderr || ''}`.trim();
      if (isMissingNpcapOutput(text)) {
        return buildMissingStatus(text, dumpcapPath, installerPath, uninstallerPath);
      }
      return {
        state: 'error',
        installed: Boolean(uninstallerPath),
        usable: false,
        message: text || String(error),
        dumpcapPath,
        installerPath,
        uninstallerPath,
      };
    }
  }

  async startInstall() {
    const installerPath = await findNpcapInstaller(this.runtimeRoot);
    if (!installerPath) {
      throw new Error('Npcap installer was not found in the prepared runtime. Put an npcap-*.exe under tools/WiresharkPortable64 before running npm run prepare:dumpcap.');
    }
    return this.startInteractiveProcess(installerPath);
  }

  async startUninstall() {
    const uninstallerPath = await findNpcapUninstaller(this.uninstallerCandidates);
    if (!uninstallerPath) {
      throw new Error('Npcap uninstaller was not found.');
    }
    return this.startInteractiveProcess(uninstallerPath);
  }

  startInteractiveProcess(filePath) {
    const child = this.spawn(filePath, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref?.();
    return { started: true, path: filePath };
  }
}

function buildMissingStatus(message, dumpcapPath, installerPath, uninstallerPath) {
  return {
    state: 'missing',
    installed: false,
    usable: false,
    message,
    dumpcapPath,
    installerPath,
    uninstallerPath,
  };
}

function isMissingNpcapOutput(text) {
  return /Unable to load Npcap|Unable to load WinPcap|wpcap\.dll|Npcap or WinPcap must be installed/i.test(text || '');
}

function resolveDumpcapPath(runtimeRoot = getRuntimeRoot()) {
  const bundled = path.join(runtimeRoot, 'tools', 'dumpcap', 'dumpcap.exe');
  if (isFileSync(bundled)) return bundled;
  const fallback = getRuntimePath('tools', 'dumpcap', 'dumpcap.exe');
  return isFileSync(fallback) ? fallback : '';
}

async function findNpcapInstaller(runtimeRoot = getRuntimeRoot()) {
  const candidatesDir = path.join(runtimeRoot, 'tools', 'npcap');
  if (!isDirectorySync(candidatesDir)) return '';
  const entries = await fs.promises.readdir(candidatesDir);
  const installers = entries
    .filter((entry) => /^npcap.*\.exe$/i.test(entry))
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }));
  return installers.length ? path.join(candidatesDir, installers[0]) : '';
}

async function findNpcapUninstaller(candidates = DEFAULT_UNINSTALLER_CANDIDATES) {
  for (const candidate of candidates) {
    if (isFileSync(candidate)) return candidate;
  }
  return '';
}

function isFileSync(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (_error) {
    return false;
  }
}

function isDirectorySync(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch (_error) {
    return false;
  }
}

module.exports = {
  CaptureDriverManager,
  findNpcapInstaller,
  findNpcapUninstaller,
  isMissingNpcapOutput,
};
