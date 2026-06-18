'use strict';
const net = require('net');

const PIPE_NAME = '\\\\.\\pipe\\BKAutoOp';
const MAX_FRAME = 262144;
const DEFAULT_TIMEOUT_MS = 5000;

function encodeFrame(jsonStr) {
    const body = Buffer.from(jsonStr, 'utf8');
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32LE(body.length, 0);
    return Buffer.concat([header, body]);
}

function decodeFrame(buf) {
    if (buf.length < 4) return null;
    const length = buf.readUInt32LE(0);
    if (buf.length < 4 + length) return null;
    const json = buf.subarray(4, 4 + length).toString('utf8');
    const remaining = buf.subarray(4 + length);
    return { json, remaining };
}

function sendCommand(pipeName, cmd, args, timeoutMs, netImpl, id) {
    const netModule = netImpl || net;
    const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const messageId = id || String(Date.now());
    const payload = JSON.stringify({ id: messageId, cmd, args: args || {} });

    return new Promise((resolve, reject) => {
        const socket = netModule.createConnection({ path: pipeName });
        let chunks = Buffer.alloc(0);
        let settled = false;

        function finish(err, value) {
            if (settled) return;
            settled = true;
            socket.destroy?.();
            if (err) reject(err);
            else resolve(value);
        }

        socket.setTimeout?.(timeout, () => finish(new Error(`command timeout: ${cmd}`)));
        socket.once?.('connect', () => socket.write(encodeFrame(payload)));
        socket.on?.('data', (chunk) => {
            chunks = Buffer.concat([chunks, chunk]);
            for (;;) {
                const frame = decodeFrame(chunks);
                if (!frame) break;
                chunks = frame.remaining;
                try {
                    const msg = JSON.parse(frame.json);
                    if (msg?.id === messageId) { finish(null, msg); return; }
                } catch (e) {
                    finish(e); return;
                }
            }
        });
        socket.once?.('error', finish);
        socket.once?.('close', () => {
            if (!settled) finish(new Error('pipe not available — run: node bkcli.js inject'));
        });
    });
}

async function waitForPipe(pipeName, timeoutMs, pollMs, sendCommandImpl) {
    const timeout = timeoutMs ?? 8000;
    const poll = pollMs ?? 500;
    const send = sendCommandImpl || ((p) => sendCommand(p, 'Ping', {}, 1000));
    const deadline = Date.now() + timeout;
    let lastErr = null;

    while (Date.now() <= deadline) {
        try {
            await send(pipeName);
            return;
        } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, poll));
        }
    }
    throw lastErr || new Error(`agent pipe not ready after ${timeout}ms`);
}

module.exports = { encodeFrame, decodeFrame, sendCommand, waitForPipe, PIPE_NAME };
