# Windows Unpacked App 目录名配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `npm run pack -- --app-dir-name <name>` 支持把默认的 `dist/win-unpacked` 改名为 `dist/<name>`，同时保持未传参数时的默认行为不变。

**Architecture:** 新增一个轻量包装脚本 `scripts/pack-win-dir.mjs` 作为 `pack` 的入口，内部继续调用当前构建链，再在需要时重命名 unpacked 目录。`scripts/patch-win-icons.js` 增加“直接接收 app 目录”的能力，以便重命名后仍能补图标；测试集中在脚本参数解析与目标路径解析，不做真实 electron-builder 端到端打包。

**Tech Stack:** Node ESM 脚本、`node:child_process`、`node:fs/promises`、Vitest、现有 npm scripts。

参考设计: `docs/superpowers/specs/2026-06-04-pack-app-dir-name-design.md`

---

## File Structure

- **Create** `scripts/pack-win-dir.mjs` - 解析 `--app-dir-name`，封装 pack 构建链和目录重命名。
- **Create** `scripts/pack-win-dir.test.mjs` - 覆盖参数解析、目录名校验和最终路径计算。
- **Modify** `scripts/patch-win-icons.js` - 允许直接传 app 目录，同时兼容旧的 `dist` 根目录调用。
- **Modify** `package.json` - 把 `pack` 脚本切到新包装脚本。
- **Modify** `docs/Documentation.md` - 更新常用命令示例。

---

### Task 1: 先锁定 pack 脚本参数契约

**Files:**
- Create: `scripts/pack-win-dir.test.mjs`
- Create: `scripts/pack-win-dir.mjs`

- [ ] **Step 1: 先写失败测试**

创建 `scripts/pack-win-dir.test.mjs`，覆盖至少这些行为：

```js
import { describe, expect, it } from 'vitest';
import {
  parsePackArgs,
  getPackPaths,
} from './pack-win-dir.mjs';

describe('pack-win-dir', () => {
  it('keeps the default unpacked directory when no app dir name is provided', () => {
    const options = parsePackArgs([]);
    const paths = getPackPaths('/repo', options);

    expect(options.appDirName).toBe('');
    expect(paths.defaultAppDir).toBe('/repo/dist/win-unpacked');
    expect(paths.finalAppDir).toBe('/repo/dist/win-unpacked');
  });

  it('parses --app-dir-name and points the final app dir under dist', () => {
    const options = parsePackArgs(['--app-dir-name', 'BKToolBox-dev']);
    const paths = getPackPaths('/repo', options);

    expect(options.appDirName).toBe('BKToolBox-dev');
    expect(paths.finalAppDir).toBe('/repo/dist/BKToolBox-dev');
  });

  it('rejects missing or invalid app dir names', () => {
    expect(() => parsePackArgs(['--app-dir-name'])).toThrow('--app-dir-name requires a value');
    expect(() => parsePackArgs(['--app-dir-name', '   '])).toThrow('--app-dir-name cannot be empty');
    expect(() => parsePackArgs(['--app-dir-name', '../escape'])).toThrow('--app-dir-name must be a single directory name');
    expect(() => parsePackArgs(['--app-dir-name', 'dir/name'])).toThrow('--app-dir-name must be a single directory name');
  });
});
```

- [ ] **Step 2: 运行测试确认先失败**

Run: `npx vitest run scripts/pack-win-dir.test.mjs`

Expected: FAIL，提示找不到 `scripts/pack-win-dir.mjs` 或缺少导出。

- [ ] **Step 3: 写最小实现使测试通过**

创建 `scripts/pack-win-dir.mjs`，至少导出：

- `parsePackArgs(argv)`
- `getPackPaths(projectRoot, options)`

要求：

- 默认 `appDirName = ''`
- `defaultAppDir = <projectRoot>/dist/win-unpacked`
- 传参时 `finalAppDir = <projectRoot>/dist/<appDirName>`
- 校验目录名合法性

- [ ] **Step 4: 重新运行测试**

Run: `npx vitest run scripts/pack-win-dir.test.mjs`

Expected: PASS

---

### Task 2: 让 pack 包装脚本和图标补丁接通

**Files:**
- Modify: `scripts/pack-win-dir.mjs`
- Modify: `scripts/patch-win-icons.js`
- Modify: `package.json`

- [ ] **Step 1: 先补 patch 目标解析失败测试**

在 `scripts/pack-win-dir.test.mjs` 或单独新增 `scripts/patch-win-icons.test.mjs`，锁定一个纯函数，例如：

```js
expect(resolvePatchTargets('/repo/dist')).toEqual([
  '/repo/dist/win-unpacked/BKToolBox.exe',
]);

expect(resolvePatchTargets('/repo/dist/BKToolBox-dev')).toEqual([
  '/repo/dist/BKToolBox-dev/BKToolBox.exe',
]);
```

如果实现里把 helper 放进 `patch-win-icons.js`，就直接对该 helper 做测试。

- [ ] **Step 2: 运行测试确认先失败**

Run: `npx vitest run scripts/pack-win-dir.test.mjs`

Expected: FAIL，缺少 patch 目标解析 helper 或行为仍只支持 `dist/win-unpacked`。

- [ ] **Step 3: 实现 pack 执行链**

在 `scripts/pack-win-dir.mjs` 中补齐：

- `runCommand(command, args)`
- `removeDirIfExists(targetPath)`
- `renameDefaultAppDir(paths)`
- `main(argv = process.argv.slice(2))`

命令链固定为：

```js
await runCommand('npm', ['run', 'build:pages']);
await runCommand('npm', ['run', 'prepare:dumpcap']);
await runCommand('npx', ['electron-builder', '--win', '--dir']);
```

然后：

- 未传 `appDirName`：直接 patch 默认目录
- 已传 `appDirName`：删除旧 `dist/<name>`，把 `dist/win-unpacked` 改名到 `dist/<name>`，再 patch 该目录

- [ ] **Step 4: 修改 `patch-win-icons.js`**

把目标解析从：

```js
path.join(outputDir, 'win-unpacked', 'BKToolBox.exe')
```

改成 helper 驱动：

- 如果 `inputDir/BKToolBox.exe` 存在，则直接用它
- 否则回退检查 `inputDir/win-unpacked/BKToolBox.exe`

并导出该 helper 供测试复用。

- [ ] **Step 5: 切换 npm script**

把 `package.json` 的：

```json
"pack": "npm run build:pages && npm run prepare:dumpcap && electron-builder --win --dir && node scripts/patch-win-icons.js dist"
```

改为：

```json
"pack": "node scripts/pack-win-dir.mjs"
```

- [ ] **Step 6: 回跑脚本测试**

Run: `npx vitest run scripts/pack-win-dir.test.mjs package-config.test.mjs`

Expected: PASS

---

### Task 3: 更新 current-state 文档并做最小验证

**Files:**
- Modify: `docs/Documentation.md`

- [ ] **Step 1: 更新常用命令**

在 `docs/Documentation.md` 的构建命令区补一条说明：

- `npm run pack -- --app-dir-name BKToolBox-dev`

并注明默认仍是 `dist/win-unpacked`，传参后可改成 `dist/<name>`。

- [ ] **Step 2: 运行最小验证链**

Run: `npx vitest run scripts/pack-win-dir.test.mjs package-config.test.mjs`

Expected: PASS

Run: `git diff --check`

Expected: 无输出

- [ ] **Step 3: 提交本轮实现**

```bash
git add package.json scripts/pack-win-dir.mjs scripts/pack-win-dir.test.mjs scripts/patch-win-icons.js docs/Documentation.md
git commit -m "feat: allow custom pack app directory names"
```

---

## Self-Review

- 规格覆盖检查:
  - `--app-dir-name` 参数入口: Task 1 + Task 2
  - 默认行为保持 `dist/win-unpacked`: Task 1 + Task 2
  - 重命名后仍做图标补丁: Task 2
  - `dist:win` 不变: Task 2
  - 文档更新: Task 3
- 待补占位文本检查:
  - 无
- 类型一致性:
  - 统一使用 `appDirName`, `defaultAppDir`, `finalAppDir`
