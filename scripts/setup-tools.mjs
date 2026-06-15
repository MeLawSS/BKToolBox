#!/usr/bin/env node
/**
 * One-time setup: downloads and extracts WiresharkPortable64 into tools/.
 * Required before `npm run pack`.
 *
 * If tools/WiresharkPortable64_*.paf.exe already exists locally it is used
 * directly (no download). Otherwise the PAF is fetched from the Wireshark CDN.
 *
 * Requirements (Linux / WSL): p7zip-full  →  sudo apt install p7zip-full
 */

import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS_DIR = path.join(ROOT, 'tools');
const WIRESHARK_DIR = path.join(TOOLS_DIR, 'WiresharkPortable64');
const DUMPCAP_CHECK = path.join(WIRESHARK_DIR, 'App', 'Wireshark', 'dumpcap.exe');

const DEFAULT_VERSION = '4.4.16';
const CDN_BASE = 'https://www.wireshark.org/download/win64';

// ── helpers ──────────────────────────────────────────────────────────────────

function findLocalPaf() {
  try {
    const files = readdirSync(TOOLS_DIR)
      .filter((f) => /^WiresharkPortable64_.*\.paf\.exe$/i.test(f))
      .sort();
    if (files.length > 0) return path.join(TOOLS_DIR, files.at(-1));
  } catch {
    // tools/ may not exist yet
  }
  return null;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (target) => {
      https.get(target, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume();
          follow(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} downloading ${target}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const out = createWriteStream(dest);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (total) {
            const pct = Math.round((received / total) * 100);
            process.stdout.write(`\r  ${pct}% (${Math.round(received / 1048576)} MB)`);
          }
        });
        res.pipe(out);
        out.on('finish', () => {
          out.close();
          if (total) process.stdout.write('\n');
          resolve();
        });
        out.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`'${cmd}' not found. Install with: sudo apt install p7zip-full`));
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`'${cmd}' exited with code ${code}`));
    });
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (existsSync(DUMPCAP_CHECK)) {
    console.log('[setup-tools] WiresharkPortable64 already set up, nothing to do.');
    return;
  }

  let pafPath = findLocalPaf();
  let downloaded = false;

  if (pafPath) {
    console.log(`[setup-tools] Found local installer: ${path.basename(pafPath)}`);
  } else {
    const version = process.env.WIRESHARK_VERSION || DEFAULT_VERSION;
    const filename = `WiresharkPortable64_${version}.paf.exe`;
    const url = `${CDN_BASE}/${filename}`;
    pafPath = path.join(TOOLS_DIR, filename);
    console.log(`[setup-tools] Downloading ${filename} from Wireshark CDN...`);
    await mkdir(TOOLS_DIR, { recursive: true });
    await downloadFile(url, pafPath);
    downloaded = true;
    console.log(`[setup-tools] Download complete.`);
  }

  console.log('[setup-tools] Extracting (this may take a minute)...');
  await mkdir(WIRESHARK_DIR, { recursive: true });
  await runCommand('7z', ['x', pafPath, `-o${WIRESHARK_DIR}`, '-y', '-bsp0', '-bd'], ROOT);

  if (!existsSync(DUMPCAP_CHECK)) {
    throw new Error(
      `Extraction finished but dumpcap.exe was not found at:\n  ${DUMPCAP_CHECK}\n` +
      'The PAF archive layout may differ from expected. ' +
      'Check that tools/WiresharkPortable64/App/Wireshark/dumpcap.exe exists.',
    );
  }

  if (downloaded) {
    await rm(pafPath, { force: true });
  }

  console.log('[setup-tools] Done. Run `npm run pack` to build the app.');
}

main().catch((err) => {
  console.error(`\n[setup-tools] Error: ${err.message}`);
  process.exitCode = 1;
});
