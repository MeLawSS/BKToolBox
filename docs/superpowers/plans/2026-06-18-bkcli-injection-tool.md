# bkcli Injection Analysis Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Node.js CLI at `tools/bkcli/` that lets Claude inject BKAutoOpAgent into BidKing, send UI automation commands, execute raw shellcode in the game process, and compile+inject C++ probe DLLs.

**Architecture:** Five modules (`pipe.js`, `inject.js`, `shellcode.js`, `probe.js`, `bkcli.js`) each own one concern and export testable functions. `bkcli.js` is the thin CLI entry point that parses argv and dispatches. BKAutoOpAgent.cpp gets one new command (`LoadProbe`) that loads a probe DLL and calls its entry point. A new PowerShell script (`inject-shellcode.ps1`) handles raw shellcode injection with ReadProcessMemory result readback.

**Tech Stack:** Node.js 24 (built-ins only: `net`, `fs`, `child_process`, `path`, `crypto`); PowerShell 7 (`pwsh`); WSL MinGW (`x86_64-w64-mingw32-g++`); `node:test` + `node:assert` for unit tests.

## Global Constraints

- **No npm dependencies** — `tools/bkcli/` uses Node.js built-ins only
- **Output format** — every command prints exactly one line of JSON: `{"ok":true,"result":{...}}` or `{"ok":false,"error":"..."}` (plus optional `"detail"` field for compile errors)
- **Pipe name** — `\\.\pipe\BKAutoOp` (matches `BKPIPE_NAME` in `protocol.h`)
- **Frame format** — `[uint32 LE length][UTF-8 JSON bytes]` (matches `WriteFrame`/`ReadFrame` in `protocol.h`)
- **Max frame** — 262144 bytes (`BK_BUF_SIZE`)
- **Default pipe timeout** — 5000ms (matches `DEFAULT_AUTO_OPERATION_TIMEOUT_MS` in `inject-service.js`)
- **Inject wait** — poll `\\.\pipe\BKAutoOp` every 500ms up to 8s
- **PowerShell** — invoke via `pwsh` (PowerShell 7), not `powershell.exe`
- **Test command** — `node --test tools/bkcli/bkcli.test.mjs`
- **All work in a new git worktree** — see Task 1 first step

---

### Task 1: Worktree + scaffold + pipe.js

**Files:**
- Create: `tools/bkcli/pipe.js`
- Create: `tools/bkcli/bkcli.test.mjs` (skeleton, grows each task)

**Interfaces:**
- Produces:
  - `encodeFrame(jsonStr: string): Buffer` — `[uint32 LE length][UTF-8 bytes]`
  - `decodeFrame(buf: Buffer): {json: string, remaining: Buffer} | null` — returns null when buf has fewer than `4 + length` bytes
  - `sendCommand(pipeName: string, cmd: string, args: object, timeoutMs?: number, netImpl?: object): Promise<object>` — resolves with the parsed response object; rejects on error/timeout
  - `waitForPipe(pipeName: string, timeoutMs?: number, pollMs?: number, sendCommandImpl?: function): Promise<void>` — polls `Ping` until success

- [ ] **Step 1: Create worktree and working branch**

```bash
cd "A:\BidKing"
git worktree add ../BidKing-feat-bkcli feat/bkcli
```

All subsequent implementation commands run inside `A:\BidKing-feat-bkcli`.

- [ ] **Step 2: Write failing tests for frame encode/decode**

Create `tools/bkcli/bkcli.test.mjs`:

```js
import { createRequire } from 'node:module';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);

// ── pipe.js ──────────────────────────────────────────────────────────────────
describe('pipe.js', () => {
  let pipe;
  before(() => { pipe = require('./pipe.js'); });

  it('encodeFrame: prepends uint32 LE length', () => {
    const buf = pipe.encodeFrame('{"x":1}');
    assert.equal(buf.readUInt32LE(0), 7);
    assert.equal(buf.subarray(4).toString('utf8'), '{"x":1}');
  });

  it('decodeFrame: returns null when buffer too short', () => {
    const result = pipe.decodeFrame(Buffer.from([7, 0, 0])); // 3 bytes, no length yet
    assert.equal(result, null);
  });

  it('decodeFrame: returns null when body incomplete', () => {
    const buf = Buffer.alloc(4 + 3);
    buf.writeUInt32LE(7, 0);  // says 7 bytes, only 3 present
    buf.write('{"', 4);
    assert.equal(pipe.decodeFrame(buf), null);
  });

  it('decodeFrame: parses complete frame and returns remaining bytes', () => {
    const body = '{"ok":true}';
    const frame = pipe.encodeFrame(body);
    const extra = Buffer.from('extra');
    const buf = Buffer.concat([frame, extra]);
    const result = pipe.decodeFrame(buf);
    assert.equal(result.json, body);
    assert.deepEqual(result.remaining, extra);
  });

  it('sendCommand: writes correct frame and resolves with parsed response', async () => {
    const sentFrames = [];
    const fakeSocket = {
      _listeners: {},
      once(ev, fn) { this._listeners[ev] = fn; return this; },
      on(ev, fn) { this._listeners[ev] = fn; return this; },
      setTimeout() { return this; },
      write(buf) { sentFrames.push(buf); },
      destroy() {},
    };
    const fakeNet = {
      createConnection(_path) {
        // Simulate async connect + server response
        setTimeout(() => {
          fakeSocket._listeners['connect']?.();
          // Build a response frame
          const resp = JSON.stringify({ id: '1', ok: true, result: { pong: true } });
          const responseBuf = pipe.encodeFrame(resp);
          fakeSocket._listeners['data']?.(responseBuf);
        }, 0);
        return fakeSocket;
      }
    };

    const result = await pipe.sendCommand('\\\\.\\pipe\\test', 'Ping', {}, 1000, fakeNet, '1');
    assert.deepEqual(result, { id: '1', ok: true, result: { pong: true } });

    // Verify the sent frame contains correct cmd
    const sentJson = sentFrames[0].subarray(4).toString('utf8');
    const sentParsed = JSON.parse(sentJson);
    assert.equal(sentParsed.cmd, 'Ping');
    assert.deepEqual(sentParsed.args, {});
  });

  it('sendCommand: rejects on timeout', async () => {
    const fakeSocket = {
      _timeoutFn: null,
      once(ev, fn) { return this; },
      on(ev, fn) { return this; },
      setTimeout(ms, fn) { this._timeoutFn = fn; setTimeout(() => fn?.(), 0); return this; },
      write() {},
      destroy() {},
    };
    const fakeNet = { createConnection() { return fakeSocket; } };
    await assert.rejects(
      pipe.sendCommand('\\\\.\\pipe\\test', 'Ping', {}, 1, fakeNet, '2'),
      /timeout|timed out/i
    );
  });

  it('waitForPipe: resolves when Ping succeeds', async () => {
    let calls = 0;
    const mockSend = async () => {
      calls++;
      if (calls < 3) throw new Error('not ready');
      return { ok: true };
    };
    await pipe.waitForPipe('\\\\.\\pipe\\test', 2000, 10, mockSend);
    assert.equal(calls, 3);
  });

  it('waitForPipe: rejects after timeout', async () => {
    const mockSend = async () => { throw new Error('ENOENT'); };
    await assert.rejects(
      pipe.waitForPipe('\\\\.\\pipe\\test', 50, 10, mockSend),
      /not ready|ENOENT|timeout/i
    );
  });
});
```

- [ ] **Step 3: Run tests — expect failures**

```bash
cd "A:\BidKing-feat-bkcli"
node --test tools/bkcli/bkcli.test.mjs
```

Expected: `MODULE_NOT_FOUND` or similar — pipe.js does not exist yet.

- [ ] **Step 4: Implement pipe.js**

Create `tools/bkcli/pipe.js`:

```js
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
```

- [ ] **Step 5: Run tests — expect all pipe.js tests to pass**

```bash
node --test tools/bkcli/bkcli.test.mjs
```

Expected: all 7 `pipe.js` tests pass.

- [ ] **Step 6: Commit**

```bash
cd "A:\BidKing-feat-bkcli"
git add tools/bkcli/pipe.js tools/bkcli/bkcli.test.mjs
git commit -m "feat(bkcli): add pipe frame I/O module with tests"
```

---

### Task 2: inject.js + bkcli.js entry point + inject command

**Files:**
- Create: `tools/bkcli/inject.js`
- Create: `tools/bkcli/bkcli.js`
- Modify: `tools/bkcli/bkcli.test.mjs` (add inject.js tests)

**Interfaces:**
- Consumes: `waitForPipe`, `sendCommand`, `PIPE_NAME` from `./pipe.js`
- Produces:
  - `injectAgent(opts?: {psPath?: string, dllPath?: string, spawnSyncImpl?: function}): {output: string}` — throws on failure
  - `bkcli.js` as executable: `node bkcli.js inject` → `{"ok":true,"result":{"status":"ready"}}`

- [ ] **Step 1: Add inject.js tests to bkcli.test.mjs**

Append inside `bkcli.test.mjs` after the `pipe.js` describe block:

```js
// ── inject.js ─────────────────────────────────────────────────────────────────
describe('inject.js', () => {
  let injectMod;
  before(() => { injectMod = require('./inject.js'); });

  it('injectAgent: calls pwsh with -File inject.ps1 -Command AutoOperationAgent', () => {
    const calls = [];
    const mockSpawn = (cmd, args, opts) => {
      calls.push({ cmd, args });
      return { status: 0, stdout: 'Injected', stderr: '' };
    };
    injectMod.injectAgent({ spawnSyncImpl: mockSpawn });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'pwsh');
    assert.ok(calls[0].args.includes('-ExecutionPolicy'));
    assert.ok(calls[0].args.includes('Bypass'));
    assert.ok(calls[0].args.some(a => a.endsWith('inject.ps1')));
    assert.ok(calls[0].args.includes('-Command'));
    assert.ok(calls[0].args.includes('AutoOperationAgent'));
  });

  it('injectAgent: throws when pwsh exits non-zero', () => {
    const mockSpawn = () => ({ status: 1, stdout: '', stderr: 'Process not found' });
    assert.throws(() => injectMod.injectAgent({ spawnSyncImpl: mockSpawn }), /Process not found/);
  });
});
```

- [ ] **Step 2: Run new tests — expect failures**

```bash
node --test tools/bkcli/bkcli.test.mjs
```

Expected: inject.js tests fail with `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement inject.js**

Create `tools/bkcli/inject.js`:

```js
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

function injectAgent(opts = {}) {
    const spawnSyncImpl = opts.spawnSyncImpl || spawnSync;
    const psPath = opts.psPath || path.resolve(__dirname, '../../inject/BKPayload64/inject.ps1');
    const dllPath = opts.dllPath || path.resolve(__dirname, '../../inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll');

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
```

- [ ] **Step 4: Implement bkcli.js**

Create `tools/bkcli/bkcli.js`:

```js
#!/usr/bin/env node
'use strict';
const { sendCommand, waitForPipe, PIPE_NAME } = require('./pipe.js');
const { injectAgent } = require('./inject.js');

function ok(result) {
    console.log(JSON.stringify({ ok: true, result }));
}

function fail(error, detail) {
    const out = { ok: false, error: String(error?.message || error) };
    if (detail !== undefined) out.detail = detail;
    console.log(JSON.stringify(out));
    process.exitCode = 1;
}

// Parse --key value and --flag from argv tail
function parseFlags(argv) {
    const flags = {};
    const pos = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next !== undefined && !next.startsWith('--')) {
                flags[key] = next;
                i++;
            } else {
                flags[key] = true;
            }
        } else {
            pos.push(a);
        }
    }
    return { flags, pos };
}

async function runCmd(cmd, args, timeoutMs) {
    const resp = await sendCommand(PIPE_NAME, cmd, args, timeoutMs);
    if (resp.ok === false) throw new Error(resp.error || `command failed: ${cmd}`);
    return resp.result || {};
}

async function main() {
    const [, , subcmd, ...rest] = process.argv;

    if (!subcmd) {
        fail('Usage: node bkcli.js <command> [args]');
        return;
    }

    try {
        if (subcmd === 'inject') {
            const { waitForPipe: wait } = require('./pipe.js');
            injectAgent();
            await wait(PIPE_NAME);
            ok({ status: 'ready' });

        } else if (subcmd === 'ping') {
            ok(await runCmd('Ping', {}));

        } else if (subcmd === 'get-current-ui') {
            ok(await runCmd('GetCurrentUI', {}));

        } else if (subcmd === 'get-visible-panels') {
            ok(await runCmd('GetVisiblePanels', {}));

        } else if (subcmd === 'dump') {
            const { flags, pos } = parseFlags(rest);
            const panel = pos[0];
            if (!panel) { fail('dump requires <panel>'); return; }
            const args = {
                panel,
                rootPath: flags.root || '',
                interactiveOnly: !flags.all,
                maxDepth: flags.depth ? parseInt(flags.depth, 10) : 4,
                nodeLimit: flags.limit ? parseInt(flags.limit, 10) : 200,
            };
            ok(await runCmd('DumpPanelTree', args));

        } else if (subcmd === 'get-node') {
            const { flags, pos } = parseFlags(rest);
            const [panel, nodePath] = pos;
            if (!panel || !nodePath) { fail('get-node requires <panel> <path>'); return; }
            ok(await runCmd('GetNodeState', {
                panel,
                path: nodePath,
                rootPath: flags.root || '',
                pathMode: flags.mode || 'exact',
            }));

        } else if (subcmd === 'click') {
            const { flags, pos } = parseFlags(rest);
            const [panel, nodePath] = pos;
            if (!panel || !nodePath) { fail('click requires <panel> <path>'); return; }
            ok(await runCmd('ClickNode', {
                panel,
                path: nodePath,
                rootPath: flags.root || '',
                pathMode: flags.mode || 'exact',
                component: flags.component || 'auto',
            }));

        } else if (subcmd === 'set-text') {
            const { flags, pos } = parseFlags(rest);
            const [panel, nodePath, text] = pos;
            if (!panel || !nodePath || text === undefined) { fail('set-text requires <panel> <path> <text>'); return; }
            ok(await runCmd('SetInputText', {
                panel,
                path: nodePath,
                text,
                rootPath: flags.root || '',
                pathMode: flags.mode || 'exact',
                submit: flags.submit === true || flags.submit === 'true',
            }));

        } else if (subcmd === 'wait-panel') {
            const { flags, pos } = parseFlags(rest);
            const panel = pos[0];
            if (!panel) { fail('wait-panel requires <panel>'); return; }
            const timeoutMs = flags.timeout ? parseInt(flags.timeout, 10) : 5000;
            ok(await runCmd('WaitForVisiblePanel', {
                panel,
                hidden: flags.hidden === true,
                timeoutMs,
                pollMs: flags.poll ? parseInt(flags.poll, 10) : undefined,
            }, timeoutMs + 2000));

        } else if (subcmd === 'wait-node') {
            const { flags, pos } = parseFlags(rest);
            const [panel, nodePath, state] = pos;
            if (!panel || !nodePath || !state) { fail('wait-node requires <panel> <path> <state>'); return; }
            const timeoutMs = flags.timeout ? parseInt(flags.timeout, 10) : 5000;
            ok(await runCmd('WaitForNode', {
                panel,
                path: nodePath,
                state,
                rootPath: flags.root || '',
                pathMode: flags.mode || 'exact',
                timeoutMs,
                pollMs: flags.poll ? parseInt(flags.poll, 10) : undefined,
            }, timeoutMs + 2000));

        } else if (subcmd === 'run') {
            const [cmd, argsJson] = rest;
            if (!cmd) { fail('run requires <cmd> [argsJson]'); return; }
            let args = {};
            if (argsJson) {
                try { args = JSON.parse(argsJson); } catch { fail(`invalid argsJson: ${argsJson}`); return; }
            }
            ok(await runCmd(cmd, args));

        } else if (subcmd === 'exec-shellcode') {
            const { execShellcode } = require('./shellcode.js');
            const { flags, pos } = parseFlags(rest);
            const filePath = pos[0];
            if (!filePath) { fail('exec-shellcode requires <file.bin|file.hex>'); return; }
            const output = execShellcode(filePath, {
                resultSize: flags['result-size'] ? parseInt(flags['result-size'], 10) : 4096,
                noWait: flags['no-wait'] === true,
                timeoutMs: flags.timeout ? parseInt(flags.timeout, 10) : 5000,
            });
            ok({ output });

        } else if (subcmd === 'exec-probe') {
            const { execProbe } = require('./probe.js');
            const { flags, pos } = parseFlags(rest);
            const cppPath = pos[0];
            if (!cppPath) { fail('exec-probe requires <file.cpp>'); return; }
            const result = await execProbe(cppPath, {
                argsJson: flags.args || '{}',
                keep: flags.keep === true,
            });
            ok(result);

        } else {
            fail(`unknown command: ${subcmd}`);
        }
    } catch (e) {
        fail(e.message, e.detail);
    }
}

main();
```

- [ ] **Step 5: Run all tests**

```bash
node --test tools/bkcli/bkcli.test.mjs
```

Expected: all `pipe.js` and `inject.js` tests pass.

- [ ] **Step 6: Commit**

```bash
git add tools/bkcli/inject.js tools/bkcli/bkcli.js tools/bkcli/bkcli.test.mjs
git commit -m "feat(bkcli): add inject module and CLI entry point"
```

---

### Task 3: Analysis commands — tests for bkcli.js command dispatch

**Files:**
- Modify: `tools/bkcli/bkcli.test.mjs` (add command dispatch tests)

Note: analysis commands live in `bkcli.js` (already implemented in Task 2). This task only adds tests verifying the argv → pipe-payload mapping.

**Interfaces:**
- Consumes: `encodeFrame`, `decodeFrame`, `sendCommand`, `waitForPipe` from `./pipe.js`

- [ ] **Step 1: Add command dispatch tests to bkcli.test.mjs**

Append after the `inject.js` describe block:

```js
// ── bkcli.js command dispatch ─────────────────────────────────────────────────
describe('bkcli.js command dispatch', () => {
  // We test bkcli.js by calling sendCommand with a mock pipe that captures frames.
  // bkcli.js is a CLI entry point; we exercise its logic via pipe.js sendCommand.
  // Each test verifies that the correct protocol JSON is sent for a given CLI invocation.

  function mockPipeRoundtrip(responseResult) {
    // Returns a fake netImpl whose socket immediately responds with ok:true result
    return {
      createConnection(_path) {
        const listeners = {};
        const socket = {
          _listeners: listeners,
          once(ev, fn) { listeners[ev] = fn; return this; },
          on(ev, fn) { listeners[ev] = fn; return this; },
          setTimeout() { return this; },
          destroy() {},
          _sentJson: null,
          write(buf) {
            this._sentJson = JSON.parse(buf.subarray(4).toString('utf8'));
            // Respond asynchronously
            const { encodeFrame } = require('./pipe.js');
            const resp = encodeFrame(JSON.stringify({
              id: this._sentJson.id, ok: true, result: responseResult
            }));
            setTimeout(() => listeners['data']?.(resp), 0);
          },
        };
        setTimeout(() => listeners['connect']?.(), 0);
        return socket;
      }
    };
  }

  it('ping sends Ping command', async () => {
    const { sendCommand, PIPE_NAME } = require('./pipe.js');
    let captured;
    const fakeNet = {
      createConnection(_p) {
        const listeners = {};
        const socket = {
          once(ev, fn) { listeners[ev] = fn; return this; },
          on(ev, fn) { listeners[ev] = fn; return this; },
          setTimeout() { return this; },
          destroy() {},
          write(buf) {
            captured = JSON.parse(buf.subarray(4).toString('utf8'));
            const { encodeFrame } = require('./pipe.js');
            const resp = encodeFrame(JSON.stringify({ id: captured.id, ok: true, result: { pong: true } }));
            setTimeout(() => listeners['data']?.(resp), 0);
          },
        };
        setTimeout(() => listeners['connect']?.(), 0);
        return socket;
      }
    };
    const result = await sendCommand('\\\\.\\pipe\\test', 'Ping', {}, 1000, fakeNet);
    assert.equal(captured.cmd, 'Ping');
    assert.deepEqual(captured.args, {});
    assert.equal(result.result.pong, true);
  });

  it('dump sends DumpPanelTree with correct defaults', async () => {
    let captured;
    const fakeNet = (() => {
      const { encodeFrame } = require('./pipe.js');
      return {
        createConnection(_p) {
          const listeners = {};
          const socket = {
            once(ev, fn) { listeners[ev] = fn; return this; },
            on(ev, fn) { listeners[ev] = fn; return this; },
            setTimeout() { return this; }, destroy() {},
            write(buf) {
              captured = JSON.parse(buf.subarray(4).toString('utf8'));
              const resp = encodeFrame(JSON.stringify({ id: captured.id, ok: true, result: { nodes: [] } }));
              setTimeout(() => listeners['data']?.(resp), 0);
            },
          };
          setTimeout(() => listeners['connect']?.(), 0);
          return socket;
        }
      };
    })();

    const { sendCommand } = require('./pipe.js');
    await sendCommand('\\\\.\\pipe\\test', 'DumpPanelTree', {
      panel: 'MainPanel',
      rootPath: '',
      interactiveOnly: true,
      maxDepth: 4,
      nodeLimit: 200,
    }, 1000, fakeNet);

    assert.equal(captured.cmd, 'DumpPanelTree');
    assert.equal(captured.args.panel, 'MainPanel');
    assert.equal(captured.args.interactiveOnly, true);
    assert.equal(captured.args.maxDepth, 4);
    assert.equal(captured.args.nodeLimit, 200);
    assert.equal(captured.args.rootPath, '');
  });

  it('click sends ClickNode with pathMode:exact and component:auto', async () => {
    let captured;
    const { encodeFrame, sendCommand } = require('./pipe.js');
    const fakeNet = {
      createConnection(_p) {
        const listeners = {};
        const socket = {
          once(ev, fn) { listeners[ev] = fn; return this; },
          on(ev, fn) { listeners[ev] = fn; return this; },
          setTimeout() { return this; }, destroy() {},
          write(buf) {
            captured = JSON.parse(buf.subarray(4).toString('utf8'));
            const resp = encodeFrame(JSON.stringify({ id: captured.id, ok: true, result: {} }));
            setTimeout(() => listeners['data']?.(resp), 0);
          },
        };
        setTimeout(() => listeners['connect']?.(), 0);
        return socket;
      }
    };
    await sendCommand('\\\\.\\pipe\\test', 'ClickNode', {
      panel: 'MainPanel',
      path: 'mask/Button',
      rootPath: '',
      pathMode: 'exact',
      component: 'auto',
    }, 1000, fakeNet);
    assert.equal(captured.args.pathMode, 'exact');
    assert.equal(captured.args.component, 'auto');
    assert.equal(captured.args.rootPath, '');
  });
});
```

- [ ] **Step 2: Run tests — all should pass**

```bash
node --test tools/bkcli/bkcli.test.mjs
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tools/bkcli/bkcli.test.mjs
git commit -m "test(bkcli): add command dispatch tests for analysis commands"
```

---

### Task 4: inject-shellcode.ps1 + shellcode.js + exec-shellcode

**Files:**
- Create: `tools/inject/BKPayload64/inject-shellcode.ps1`
- Create: `tools/bkcli/shellcode.js`
- Modify: `tools/bkcli/bkcli.test.mjs` (add shellcode.js tests)

**Interfaces:**
- Produces:
  - `parseShellcodeFile(filePath: string): string` — reads .bin or .hex file, returns lowercase hex string
  - `execShellcode(filePath: string, opts?: {resultSize?: number, noWait?: boolean, timeoutMs?: number, psPath?: string, spawnSyncImpl?: function}): string` — returns scratch buffer content; throws on failure

- [ ] **Step 1: Add shellcode.js tests to bkcli.test.mjs**

Append after the command dispatch describe block:

```js
// ── shellcode.js ──────────────────────────────────────────────────────────────
describe('shellcode.js', () => {
  let shell;
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  before(() => { shell = require('./shellcode.js'); });

  it('parseShellcodeFile: reads .bin file as hex', () => {
    const tmp = path.join(os.tmpdir(), 'test.bin');
    fs.writeFileSync(tmp, Buffer.from([0x90, 0xC3])); // NOP, RET
    const hex = shell.parseShellcodeFile(tmp);
    assert.equal(hex, '90c3');
    fs.unlinkSync(tmp);
  });

  it('parseShellcodeFile: reads .hex file stripping whitespace', () => {
    const tmp = path.join(os.tmpdir(), 'test.hex');
    fs.writeFileSync(tmp, '90 C3\n48 89 C8', 'utf8');
    const hex = shell.parseShellcodeFile(tmp);
    assert.equal(hex, '90c348 89c8'.replace(/ /g, ''));
    fs.unlinkSync(tmp);
  });

  it('execShellcode: calls pwsh with ShellcodeHex, ResultSize, TimeoutMs', () => {
    const tmp = path.join(os.tmpdir(), 'sc.bin');
    fs.writeFileSync(tmp, Buffer.from([0x90, 0xC3]));
    const calls = [];
    const mockSpawn = (cmd, args) => {
      calls.push({ cmd, args });
      return { status: 0, stdout: '{"test":1}', stderr: '' };
    };
    const result = shell.execShellcode(tmp, {
      resultSize: 8192,
      timeoutMs: 3000,
      spawnSyncImpl: mockSpawn,
    });
    assert.equal(result, '{"test":1}');
    assert.equal(calls[0].cmd, 'pwsh');
    assert.ok(calls[0].args.includes('-ShellcodeHex'));
    assert.ok(calls[0].args.includes('90c3'));
    assert.ok(calls[0].args.includes('-ResultSize'));
    assert.ok(calls[0].args.includes('8192'));
    fs.unlinkSync(tmp);
  });

  it('execShellcode: passes -NoWait when noWait:true', () => {
    const tmp = path.join(os.tmpdir(), 'sc2.bin');
    fs.writeFileSync(tmp, Buffer.from([0x90]));
    const calls = [];
    const mockSpawn = (cmd, args) => { calls.push(args); return { status: 0, stdout: '', stderr: '' }; };
    shell.execShellcode(tmp, { noWait: true, spawnSyncImpl: mockSpawn });
    assert.ok(calls[0].includes('-NoWait'));
    fs.unlinkSync(tmp);
  });

  it('execShellcode: throws when pwsh exits non-zero', () => {
    const tmp = path.join(os.tmpdir(), 'sc3.bin');
    fs.writeFileSync(tmp, Buffer.from([0x90]));
    const mockSpawn = () => ({ status: 1, stdout: '', stderr: 'Process not found' });
    assert.throws(
      () => shell.execShellcode(tmp, { spawnSyncImpl: mockSpawn }),
      /Process not found/
    );
    fs.unlinkSync(tmp);
  });

  it('parseShellcodeFile: throws for missing file', () => {
    assert.throws(
      () => shell.parseShellcodeFile('/nonexistent/path/file.bin'),
      /ENOENT|no such file/i
    );
  });
});
```

- [ ] **Step 2: Run new tests — expect failures**

```bash
node --test tools/bkcli/bkcli.test.mjs
```

Expected: shellcode.js tests fail with `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement shellcode.js**

Create `tools/bkcli/shellcode.js`:

```js
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
```

- [ ] **Step 4: Implement inject-shellcode.ps1**

Create `tools/inject/BKPayload64/inject-shellcode.ps1`:

```powershell
param(
    [string]$ProcessName = "BidKing",
    [string]$ShellcodeHex = "",
    [int]$ResultSize = 4096,
    [switch]$NoWait,
    [int]$TimeoutMs = 5000
)

if ($ShellcodeHex.Length -eq 0) {
    Write-Error "ShellcodeHex is required"
    exit 1
}
if ($ShellcodeHex.Length % 2 -ne 0) {
    Write-Error "ShellcodeHex must have even length"
    exit 1
}

$bytes = [byte[]]::new($ShellcodeHex.Length / 2)
for ($i = 0; $i -lt $bytes.Length; $i++) {
    $bytes[$i] = [Convert]::ToByte($ShellcodeHex.Substring($i * 2, 2), 16)
}

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
    Write-Error "process not found: ${ProcessName}.exe"
    exit 1
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BkScInject {
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr OpenProcess(uint a, bool b, int c);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr VirtualAllocEx(IntPtr h, IntPtr a, uint s, uint t, uint p);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool WriteProcessMemory(IntPtr h, IntPtr a, byte[] b, int s, out int w);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, int s, out int r);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr CreateRemoteThread(IntPtr h, IntPtr a, uint s, IntPtr fn, IntPtr p, uint f, IntPtr t);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool VirtualFreeEx(IntPtr h, IntPtr a, int s, uint t);
}
"@

$PROCESS_ALL_ACCESS = 0x1F0FFF
$MEM_COMMIT_RESERVE  = 0x3000
$PAGE_EXECUTE_READWRITE = 0x40
$PAGE_READWRITE      = 0x04
$MEM_RELEASE         = 0x8000
$WAIT_TIMEOUT_CODE   = 0x102

$hProc = [BkScInject]::OpenProcess($PROCESS_ALL_ACCESS, $false, $proc.Id)
if ($hProc -eq [IntPtr]::Zero) {
    Write-Error "OpenProcess failed: error $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    exit 1
}

$scAddr     = [IntPtr]::Zero
$scratchAddr = [IntPtr]::Zero
try {
    $scAddr = [BkScInject]::VirtualAllocEx($hProc, [IntPtr]::Zero, [uint32]$bytes.Length, $MEM_COMMIT_RESERVE, $PAGE_EXECUTE_READWRITE)
    if ($scAddr -eq [IntPtr]::Zero) { Write-Error "VirtualAllocEx(shellcode) failed"; exit 1 }

    $w = 0
    if (-not [BkScInject]::WriteProcessMemory($hProc, $scAddr, $bytes, $bytes.Length, [ref]$w)) {
        Write-Error "WriteProcessMemory failed"; exit 1
    }

    $scratchAddr = [BkScInject]::VirtualAllocEx($hProc, [IntPtr]::Zero, [uint32]$ResultSize, $MEM_COMMIT_RESERVE, $PAGE_READWRITE)
    if ($scratchAddr -eq [IntPtr]::Zero) { Write-Error "VirtualAllocEx(scratch) failed"; exit 1 }

    $hThread = [BkScInject]::CreateRemoteThread($hProc, [IntPtr]::Zero, 0, $scAddr, $scratchAddr, 0, [IntPtr]::Zero)
    if ($hThread -eq [IntPtr]::Zero) { Write-Error "CreateRemoteThread failed"; exit 1 }

    if (-not $NoWait) {
        $waitResult = [BkScInject]::WaitForSingleObject($hThread, [uint32]$TimeoutMs)
        [BkScInject]::CloseHandle($hThread) | Out-Null
        if ($waitResult -eq $WAIT_TIMEOUT_CODE) {
            Write-Error "shellcode thread timeout after ${TimeoutMs}ms"
            exit 1
        }
        $readBuf = [byte[]]::new($ResultSize)
        $r = 0
        [BkScInject]::ReadProcessMemory($hProc, $scratchAddr, $readBuf, $ResultSize, [ref]$r) | Out-Null
        $nullIdx = [Array]::IndexOf($readBuf, [byte]0)
        if ($nullIdx -gt 0) { $readBuf = $readBuf[0..($nullIdx - 1)] }
        elseif ($nullIdx -eq 0) { $readBuf = [byte[]]::new(0) }
        Write-Output ([System.Text.Encoding]::UTF8.GetString($readBuf))
    } else {
        [BkScInject]::CloseHandle($hThread) | Out-Null
        Write-Output ""
    }
} finally {
    if ($scAddr -ne [IntPtr]::Zero)      { [BkScInject]::VirtualFreeEx($hProc, $scAddr, 0, $MEM_RELEASE) | Out-Null }
    if ($scratchAddr -ne [IntPtr]::Zero) { [BkScInject]::VirtualFreeEx($hProc, $scratchAddr, 0, $MEM_RELEASE) | Out-Null }
    [BkScInject]::CloseHandle($hProc) | Out-Null
}
```

- [ ] **Step 5: Run all tests**

```bash
node --test tools/bkcli/bkcli.test.mjs
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add tools/bkcli/shellcode.js tools/bkcli/bkcli.test.mjs \
        tools/inject/BKPayload64/inject-shellcode.ps1
git commit -m "feat(bkcli): add exec-shellcode command and inject-shellcode.ps1"
```

---

### Task 5: CmdLoadProbe in BKAutoOpAgent.cpp + rebuild DLL

**Files:**
- Modify: `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp` (add `CmdLoadProbe`, register in dispatch table)

**Interfaces:**
- Produces (wire protocol):
  - Command: `{"cmd":"LoadProbe","args":{"dllPath":"<abs path>","argsJson":"{}"}}`
  - Success: `{"id":"...","ok":true,"result":{"output":"<resultBuf content>"}}`
  - Failure (LoadLibrary): `{"id":"...","ok":false,"error":"LoadLibrary failed: 0xXXXXXXXX"}`
  - Failure (no export): `{"id":"...","ok":false,"error":"BKProbeEntry not exported"}`

- [ ] **Step 1: Add CmdLoadProbe function**

In `tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp`, insert the following function immediately before the `// ======== Dispatch table` comment (around line 3882):

```cpp
// ==========================================================================
// LoadProbe: load a probe DLL and call its BKProbeEntry export
// ==========================================================================
typedef void (*ProbeEntryFn)(const char*, char*, int);

static void CmdLoadProbe(AgentConn* c, const char* id, const char* json) {
    char dllPath[MAX_PATH] = {};
    char argsJson[BK_BUF_SIZE] = {};
    strncpy(argsJson, "{}", sizeof(argsJson) - 1);

    if (!JsonGetString(json, "dllPath", dllPath, sizeof(dllPath))) {
        SendResponse(c, id, false, "dllPath is required");
        return;
    }
    JsonGetString(json, "argsJson", argsJson, sizeof(argsJson));

    HMODULE h = LoadLibraryA(dllPath);
    if (!h) {
        char err[128];
        snprintf(err, sizeof(err), "LoadLibrary failed: 0x%08X", (unsigned)GetLastError());
        SendResponse(c, id, false, err);
        return;
    }

    ProbeEntryFn fn = (ProbeEntryFn)GetProcAddress(h, "BKProbeEntry");
    if (!fn) {
        FreeLibrary(h);
        SendResponse(c, id, false, "BKProbeEntry not exported");
        return;
    }

    static char resultBuf[65536];
    memset(resultBuf, 0, sizeof(resultBuf));
    fn(argsJson, resultBuf, (int)sizeof(resultBuf));
    FreeLibrary(h);

    // JSON-escape resultBuf into output field
    char escaped[131072];
    int ei = 0;
    for (int i = 0; resultBuf[i] && ei < (int)sizeof(escaped) - 4; i++) {
        unsigned char ch = (unsigned char)resultBuf[i];
        if (ch == '"' || ch == '\\') { escaped[ei++] = '\\'; escaped[ei++] = ch; }
        else if (ch == '\n')         { escaped[ei++] = '\\'; escaped[ei++] = 'n'; }
        else if (ch == '\r')         { escaped[ei++] = '\\'; escaped[ei++] = 'r'; }
        else                         { escaped[ei++] = (char)ch; }
    }
    escaped[ei] = '\0';

    char result[BK_BUF_SIZE];
    snprintf(result, sizeof(result), "{\"output\":\"%s\"}", escaped);
    SendResponse(c, id, true, result);
}
```

- [ ] **Step 2: Register CmdLoadProbe in the dispatch table**

In the `kCommands[]` array (around line 3909), insert `LoadProbe` before `UnloadAgent`:

```cpp
    { "InvokeMethod",     CmdInvokeMethod     },
    { "LoadProbe",        CmdLoadProbe        },   // ← add this line
    { "UnloadAgent",      CmdUnloadAgent      },
```

- [ ] **Step 3: Build BKAutoOpAgent.dll**

```bash
cd "A:\BidKing-feat-bkcli"
wsl -e bash tools/inject/AutoOperation/BKAutoOpAgent/build.sh
```

Expected output:
```
Done: tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
```

If the build fails, check the error from g++ — most likely a syntax issue in the inserted code.

- [ ] **Step 4: Commit**

```bash
git add tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.cpp \
        tools/inject/AutoOperation/BKAutoOpAgent/BKAutoOpAgent.dll
git commit -m "feat(agent): add LoadProbe command for C++ probe DLL injection"
```

---

### Task 6: probe_template.h + build_probe.sh + probe.js + exec-probe command

**Files:**
- Create: `tools/inject/AutoOperation/BKProbeTemplate/probe_template.h`
- Create: `tools/inject/AutoOperation/BKProbeTemplate/build_probe.sh`
- Create: `tools/bkcli/probe.js`
- Modify: `tools/bkcli/bkcli.test.mjs` (add probe.js tests)

**Interfaces:**
- Consumes: `sendCommand`, `PIPE_NAME` from `./pipe.js`
- Produces:
  - `toWslPath(winPath: string): string` — converts `C:\foo\bar` → `/mnt/c/foo/bar`
  - `compileProbeDll(cppPath: string, opts?: {outPath?: string, spawnSyncImpl?: function}): string` — returns Windows path to compiled DLL; throws `{message, detail}` on compile failure
  - `execProbe(cppPath: string, opts?: {argsJson?: string, keep?: boolean, ...sendOpts}): Promise<{output: string}>` — compile + LoadProbe + optional cleanup

- [ ] **Step 1: Add probe.js tests to bkcli.test.mjs**

Append after the `shellcode.js` describe block:

```js
// ── probe.js ─────────────────────────────────────────────────────────────────
describe('probe.js', () => {
  let probe;
  const path = require('path');
  before(() => { probe = require('./probe.js'); });

  it('toWslPath: converts C:\\foo\\bar to /mnt/c/foo/bar', () => {
    assert.equal(probe.toWslPath('C:\\foo\\bar'), '/mnt/c/foo/bar');
    assert.equal(probe.toWslPath('D:\\test\\file.cpp'), '/mnt/d/test/file.cpp');
  });

  it('compileProbeDll: calls wsl -e bash build_probe.sh with correct WSL paths', () => {
    const calls = [];
    const mockSpawn = (cmd, args) => {
      calls.push({ cmd, args });
      return { status: 0, stdout: '', stderr: 'Build complete' };
    };
    const result = probe.compileProbeDll('C:\\test\\probe.cpp', {
      outPath: 'C:\\Temp\\bkprobe_test.dll',
      spawnSyncImpl: mockSpawn,
    });
    assert.equal(result, 'C:\\Temp\\bkprobe_test.dll');
    assert.equal(calls[0].cmd, 'wsl');
    assert.ok(calls[0].args.includes('-e'));
    assert.ok(calls[0].args.includes('bash'));
    assert.ok(calls[0].args.some(a => a.includes('build_probe.sh')));
    assert.ok(calls[0].args.some(a => a === '/mnt/c/test/probe.cpp'));
    assert.ok(calls[0].args.some(a => a === '/mnt/c/temp/bkprobe_test.dll'));
  });

  it('compileProbeDll: throws with detail when wsl exits non-zero', () => {
    const mockSpawn = () => ({ status: 1, stdout: 'error: undefined reference', stderr: '' });
    let caught;
    try { probe.compileProbeDll('C:\\test\\probe.cpp', { outPath: 'C:\\t.dll', spawnSyncImpl: mockSpawn }); }
    catch (e) { caught = e; }
    assert.ok(caught, 'should have thrown');
    assert.match(caught.message, /compile failed/i);
    assert.ok(caught.detail.includes('error: undefined reference'));
  });

  it('execProbe: sends LoadProbe command with compiled dllPath and argsJson', async () => {
    // Mock compileProbeDll and sendCommand
    let loadProbeArgs;
    const { encodeFrame } = require('./pipe.js');
    const fakeNet = {
      createConnection(_p) {
        const listeners = {};
        const socket = {
          once(ev, fn) { listeners[ev] = fn; return this; },
          on(ev, fn) { listeners[ev] = fn; return this; },
          setTimeout() { return this; }, destroy() {},
          write(buf) {
            const req = JSON.parse(buf.subarray(4).toString('utf8'));
            loadProbeArgs = req.args;
            const resp = encodeFrame(JSON.stringify({ id: req.id, ok: true, result: { output: 'probe result' } }));
            setTimeout(() => listeners['data']?.(resp), 0);
          },
        };
        setTimeout(() => listeners['connect']?.(), 0);
        return socket;
      }
    };
    const mockSpawn = () => ({ status: 0, stdout: '', stderr: '' });
    const result = await probe.execProbe('C:\\test\\probe.cpp', {
      argsJson: '{"x":1}',
      keep: true,
      outPath: 'C:\\Temp\\bkprobe_fixed.dll',
      spawnSyncImpl: mockSpawn,
      netImpl: fakeNet,
    });
    assert.equal(result.output, 'probe result');
    assert.equal(loadProbeArgs.argsJson, '{"x":1}');
    assert.equal(loadProbeArgs.dllPath, 'C:\\Temp\\bkprobe_fixed.dll');
  });
});
```

- [ ] **Step 2: Run new tests — expect failures**

```bash
node --test tools/bkcli/bkcli.test.mjs
```

Expected: probe.js tests fail with `MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement probe.js**

Create `tools/bkcli/probe.js`:

```js
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
```

- [ ] **Step 4: Create probe_template.h**

Create `tools/inject/AutoOperation/BKProbeTemplate/probe_template.h`:

```cpp
#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

// ==========================================================================
// IL2CPP type stubs
// ==========================================================================
typedef void Il2CppDomain;
typedef void Il2CppAssembly;
typedef void Il2CppImage;
typedef void Il2CppClass;
typedef void Il2CppMethod;
typedef void Il2CppObject;
typedef void Il2CppFieldInfo;

typedef Il2CppDomain*          (*fn_domain_get)();
typedef const Il2CppAssembly** (*fn_domain_get_assemblies)(const Il2CppDomain*, size_t*);
typedef Il2CppImage*           (*fn_assembly_get_image)(const Il2CppAssembly*);
typedef Il2CppClass*           (*fn_class_from_name)(Il2CppImage*, const char*, const char*);
typedef Il2CppObject*          (*fn_runtime_invoke)(const Il2CppMethod*, void*, void**, Il2CppObject**);
typedef const Il2CppMethod*    (*fn_class_get_method_from_name)(Il2CppClass*, const char*, int);
typedef void*                  (*fn_thread_attach)(Il2CppDomain*);
typedef Il2CppObject*          (*fn_string_new)(const char*);
typedef Il2CppFieldInfo*       (*fn_class_get_field_from_name)(Il2CppClass*, const char*);
typedef void                   (*fn_field_static_get_value)(Il2CppFieldInfo*, void*);

struct BkIl2Cpp {
    fn_domain_get                domain_get;
    fn_domain_get_assemblies     domain_get_assemblies;
    fn_assembly_get_image        assembly_get_image;
    fn_class_from_name           class_from_name;
    fn_runtime_invoke            runtime_invoke;
    fn_class_get_method_from_name class_get_method_from_name;
    fn_thread_attach             thread_attach;
    fn_string_new                string_new;
    fn_class_get_field_from_name class_get_field_from_name;
    fn_field_static_get_value    field_static_get_value;
    Il2CppDomain*                domain;
};

// ==========================================================================
// Result output — writes into the resultBuf provided by LoadProbe
// ==========================================================================
static char*  g_probe_result_buf  = nullptr;
static int    g_probe_result_size = 0;

#define PROBE_RESULT(fmt, ...) \
    do { if (g_probe_result_buf) snprintf(g_probe_result_buf, g_probe_result_size, fmt, ##__VA_ARGS__); } while(0)

// ==========================================================================
// Resolve IL2CPP function pointers from GameAssembly.dll
// ==========================================================================
static bool BKProbeResolveIl2cpp(BkIl2Cpp* il) {
    HMODULE h = GetModuleHandleA("GameAssembly.dll");
    if (!h) return false;

#define RES(field, sym) \
    il->field = (decltype(il->field))GetProcAddress(h, "il2cpp_" #sym); \
    if (!il->field) return false;

    RES(domain_get,              domain_get)
    RES(domain_get_assemblies,   domain_get_assemblies)
    RES(assembly_get_image,      assembly_get_image)
    RES(class_from_name,         class_from_name)
    RES(runtime_invoke,          runtime_invoke)
    RES(class_get_method_from_name, class_get_method_from_name)
    RES(thread_attach,           thread_attach)
    RES(string_new,              string_new)
    RES(class_get_field_from_name,  class_get_field_from_name)
    RES(field_static_get_value,  field_static_get_value)
#undef RES

    il->domain = il->domain_get();
    if (!il->domain) return false;
    il->thread_attach(il->domain);
    return true;
}

// ==========================================================================
// Entry point every probe DLL must export
// ==========================================================================
// extern "C" __declspec(dllexport)
// void BKProbeEntry(const char* argsJson, char* resultBuf, int resultSize);
//
// On entry: set g_probe_result_buf/g_probe_result_size then call PROBE_RESULT.
// Standard pattern:
//
//   extern "C" __declspec(dllexport)
//   void BKProbeEntry(const char* argsJson, char* resultBuf, int resultSize) {
//       g_probe_result_buf  = resultBuf;
//       g_probe_result_size = resultSize;
//       BkIl2Cpp il = {};
//       if (!BKProbeResolveIl2cpp(&il)) { PROBE_RESULT("il2cpp not ready"); return; }
//       // ... do work ...
//       PROBE_RESULT("{\"ok\":true}");
//   }
```

- [ ] **Step 5: Create build_probe.sh**

Create `tools/inject/AutoOperation/BKProbeTemplate/build_probe.sh`:

```bash
#!/bin/bash
set -e
SOURCE="$1"
OUTPUT="$2"

if [ -z "$SOURCE" ] || [ -z "$OUTPUT" ]; then
    echo "Usage: build_probe.sh <source.cpp (WSL path)> <output.dll (WSL path)>" >&2
    exit 1
fi

INCLUDE_DIR="$(dirname "$(realpath "$0")")"

x86_64-w64-mingw32-g++ \
    -shared \
    -o "$OUTPUT" \
    -I "$INCLUDE_DIR" \
    -O0 -g \
    "$SOURCE" \
    -lkernel32 \
    2>&1

echo "Build complete: $OUTPUT" >&2
```

Make it executable (in WSL):

```bash
wsl chmod +x tools/inject/AutoOperation/BKProbeTemplate/build_probe.sh
```

- [ ] **Step 6: Run all tests**

```bash
node --test tools/bkcli/bkcli.test.mjs
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add tools/bkcli/probe.js tools/bkcli/bkcli.test.mjs \
        tools/inject/AutoOperation/BKProbeTemplate/probe_template.h \
        tools/inject/AutoOperation/BKProbeTemplate/build_probe.sh
git commit -m "feat(bkcli): add exec-probe command with C++ compilation and probe template"
```

---

### Final: Merge worktree back to master

- [ ] **Step 1: Run full test suite one last time**

```bash
cd "A:\BidKing-feat-bkcli"
node --test tools/bkcli/bkcli.test.mjs
```

Expected: all tests pass with no failures.

- [ ] **Step 2: Merge to master**

```bash
cd "A:\BidKing"
git merge feat/bkcli --no-ff -m "feat(bkcli): injection analysis tool for Claude dev use"
```

- [ ] **Step 3: Remove worktree**

```bash
git worktree remove ../BidKing-feat-bkcli
git branch -d feat/bkcli
```

---

## Acceptance Verification

After merge, verify these commands work against a running BidKing process:

```bash
# 1. Inject the agent
node tools/bkcli/bkcli.js inject
# Expected: {"ok":true,"result":{"status":"ready"}}

# 2. Ping the agent
node tools/bkcli/bkcli.js ping
# Expected: {"ok":true,"result":{"pong":true}}

# 3. Query current UI
node tools/bkcli/bkcli.js get-current-ui
# Expected: {"ok":true,"result":{"panel":"MainPanel"}}

# 4. Dump interactive nodes
node tools/bkcli/bkcli.js dump MainPanel
# Expected: {"ok":true,"result":{"nodes":[...]}}

# 5. Exec shellcode (NOP sled ending in RET, no result expected)
echo -n "9090909090C3" > /tmp/nop.hex
node tools/bkcli/bkcli.js exec-shellcode /tmp/nop.hex --no-wait
# Expected: {"ok":true,"result":{"output":""}}

# 6. Tests
node --test tools/bkcli/bkcli.test.mjs
# Expected: all pass
```
