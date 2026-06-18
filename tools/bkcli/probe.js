'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sendCommand, PIPE_NAME } = require('./pipe.js');

function toWslPath(winPath) {
    return winPath
        .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
        .replace(/\\/g, '/');
}

function compileProbeDll(cppPath, opts = {}) {
    const spawnSyncImpl = opts.spawnSyncImpl || spawnSync;
    const hash = crypto.createHash('sha1').update(cppPath).digest('hex').slice(0, 8);
    const outDll = opts.outPath || path.join(
        process.env.TEMP || 'C:\\Windows\\Temp',
        `bkprobe_${hash}.dll`
    );
    const scriptPath = path.resolve(
        __dirname, '../../inject/AutoOperation/BKProbeTemplate/build_probe.sh'
    );

    const result = spawnSyncImpl('wsl', [
        '-e', 'bash',
        toWslPath(scriptPath),
        toWslPath(cppPath),
        toWslPath(outDll),
    ], { encoding: 'utf8', timeout: 60000 });

    if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || '').trim();
        const err = new Error('compile failed');
        err.detail = detail;
        throw err;
    }
    return outDll;
}

async function execProbe(cppPath, opts = {}) {
    const dllPath = compileProbeDll(cppPath, opts);
    try {
        const resp = await sendCommand(
            PIPE_NAME,
            'LoadProbe',
            { dllPath, argsJson: opts.argsJson || '{}' },
            opts.timeoutMs || 15000,
            opts.netImpl
        );
        if (resp.ok === false) {
            throw new Error(resp.error || 'LoadProbe failed');
        }
        return resp.result || {};
    } finally {
        if (!opts.keep) {
            try { fs.unlinkSync(dllPath); } catch (_) {}
        }
    }
}

module.exports = { toWslPath, compileProbeDll, execProbe };
