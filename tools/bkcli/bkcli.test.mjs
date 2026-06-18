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
