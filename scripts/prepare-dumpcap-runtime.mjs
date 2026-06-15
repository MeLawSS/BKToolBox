import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export const WIRESHARK_PORTABLE_DIR_NAME = 'WiresharkPortable64';
export const DUMPCAP_SOURCE_DIR = path.join(projectRoot, 'tools', WIRESHARK_PORTABLE_DIR_NAME);
export const RUNTIME_CAPTURE_ROOT = path.join(projectRoot, 'build', 'runtime-capture');
export const DUMPCAP_OUTPUT_DIR = path.join(RUNTIME_CAPTURE_ROOT, 'dumpcap');
export const NPCAP_OUTPUT_DIR = path.join(RUNTIME_CAPTURE_ROOT, 'npcap');

async function main() {
  await prepareDumpcapRuntime();
}

export async function prepareDumpcapRuntime(options = {}) {
  const outputDir = options.outputDir || DUMPCAP_OUTPUT_DIR;
  const npcapOutputDir = options.npcapOutputDir || NPCAP_OUTPUT_DIR;
  const sourcePath = await resolveDumpcapSourcePath(
    options.sourcePath,
    undefined,
    options.candidateRoots,
  );
  const wiresharkDir = await findWiresharkRuntimeDir(sourcePath);

  await clearPreparedOutputDir(outputDir);
  await clearPreparedOutputDir(npcapOutputDir);

  const copied = await copyDumpcapRuntimeFiles(wiresharkDir, outputDir);
  const npcapInstallers = await copyNpcapInstallers(sourcePath, npcapOutputDir);

  await writeFile(path.join(outputDir, 'source.json'), JSON.stringify({
    source: path.basename(sourcePath),
    files: copied.map((filePath) => path.basename(filePath)).sort(),
    npcapInstallers: npcapInstallers.map((filePath) => path.basename(filePath)).sort(),
  }, null, 2), 'utf8');

  console.log(`[dumpcap] prepared ${copied.length} files from ${sourcePath}`);
  if (npcapInstallers.length > 0) {
    console.log(`[dumpcap] prepared ${npcapInstallers.length} bundled Npcap installer(s)`);
  }

  return {
    skipped: false,
    outputDir,
    dumpcapPath: path.join(outputDir, 'dumpcap.exe'),
    npcapOutputDir,
    npcapInstallers,
    source: sourcePath,
    copied,
  };
}

export async function resolveDumpcapSourcePath(
  explicitPath,
  _unusedArchiveName,
  candidateRoots = [projectRoot, path.join(projectRoot, 'tools')],
) {
  if (explicitPath) {
    const resolved = path.resolve(String(explicitPath));
    if (await hasDumpcapRuntime(resolved)) {
      return resolved;
    }
    throw new Error(
      `Missing ${WIRESHARK_PORTABLE_DIR_NAME}/App/Wireshark/dumpcap.exe under ${resolved}. ` +
      `Install WiresharkPortable64 to tools/${WIRESHARK_PORTABLE_DIR_NAME} before building.`,
    );
  }

  for (const root of candidateRoots) {
    const candidate = path.join(root, WIRESHARK_PORTABLE_DIR_NAME);
    if (await hasDumpcapRuntime(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Missing tools/${WIRESHARK_PORTABLE_DIR_NAME}/App/Wireshark/dumpcap.exe. ` +
    `Install WiresharkPortable64 to tools/${WIRESHARK_PORTABLE_DIR_NAME} before building.`,
  );
}

async function findWiresharkRuntimeDir(root) {
  const candidates = await findFiles(root, 'dumpcap.exe');
  const runtimeDir = candidates
    .map((filePath) => path.dirname(filePath))
    .find((dir) => /[\\/]App[\\/]Wireshark$/i.test(dir) || /[\\/]Wireshark$/i.test(dir));
  if (!runtimeDir) {
    throw new Error(`Could not find App/Wireshark/dumpcap.exe under ${root}`);
  }
  return runtimeDir;
}

async function copyDumpcapRuntimeFiles(sourceDir, outputDir) {
  const files = await findTopLevelRuntimeFiles(sourceDir);
  if (!files.some((filePath) => path.basename(filePath).toLowerCase() === 'dumpcap.exe')) {
    throw new Error(`dumpcap.exe is missing from ${sourceDir}`);
  }
  await mkdir(outputDir, { recursive: true });
  const copied = [];
  for (const from of files) {
    const to = path.join(outputDir, path.basename(from));
    await writeFile(to, await readFile(from));
    copied.push(to);
  }
  return copied;
}

async function copyNpcapInstallers(sourceRoot, outputDir) {
  await mkdir(outputDir, { recursive: true });
  const installers = (await findMatchingFiles(sourceRoot, /^npcap.*\.exe$/i))
    .sort(compareNpcapCandidatesDesc);
  if (installers.length === 0) {
    return [];
  }
  const selected = installers[0];
  const to = path.join(outputDir, path.basename(selected));
  await writeFile(to, await readFile(selected));
  return [to];
}

async function findTopLevelRuntimeFiles(sourceDir) {
  const results = [];
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (lower === 'dumpcap.exe' || lower.endsWith('.dll')) {
      results.push(path.join(sourceDir, entry.name));
    }
  }
  return results;
}

async function clearPreparedOutputDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    await rm(path.join(dirPath, entry.name), { recursive: true, force: true });
  }
}

async function findFiles(root, targetName) {
  return findMatchingFiles(root, new RegExp(`^${escapeRegExp(targetName)}$`, 'i'));
}

async function findMatchingFiles(root, pattern) {
  if (!await isDirectory(root)) {
    return [];
  }
  const results = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function compareNpcapCandidatesDesc(left, right) {
  return compareVersionSegments(getVersionSegments(path.basename(right)), getVersionSegments(path.basename(left)))
    || path.basename(right).localeCompare(path.basename(left), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
}

function compareVersionSegments(leftSegments, rightSegments) {
  const max = Math.max(leftSegments.length, rightSegments.length);
  for (let index = 0; index < max; index += 1) {
    const left = leftSegments[index] ?? 0;
    const right = rightSegments[index] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

function getVersionSegments(name) {
  const match = String(name).match(/(\d+(?:\.\d+)+)/);
  if (!match) return [];
  return match[1].split('.').map((value) => Number.parseInt(value, 10) || 0);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function hasDumpcapRuntime(root) {
  try {
    await findWiresharkRuntimeDir(root);
    return true;
  } catch (_error) {
    return false;
  }
}

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch (_error) {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
