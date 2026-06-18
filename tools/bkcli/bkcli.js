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
            injectAgent();
            await waitForPipe(PIPE_NAME);
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
