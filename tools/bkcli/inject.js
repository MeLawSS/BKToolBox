'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

function injectAgent(opts = {}) {
    const spawnSyncImpl = opts.spawnSyncImpl || spawnSync;
    const psPath = opts.psPath || path.resolve(__dirname, '../inject/BKPayload64/inject.ps1');
    const dllPath = opts.dllPath || path.resolve(__dirname, '../inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll');

    const result = spawnSyncImpl('pwsh', [
        '-ExecutionPolicy', 'Bypass',
        '-File', psPath,
        '-DllPath', dllPath,
        '-Command', 'AutoOperationAgent',
    ], { encoding: 'utf8', timeout: 15000 });

    if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || 'injection failed').trim());
    }
    return { output: (result.stdout || '').trim() };
}

module.exports = { injectAgent };
