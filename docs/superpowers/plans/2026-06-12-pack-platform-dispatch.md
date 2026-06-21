# Pack Platform Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `npm run pack` 在 Windows 与 Linux / WSL 上都先做宿主预检，再走对应本机链路，同时移除旧的 WSL Windows-bridge 逻辑并保持当前时间戳输出目录契约不变。

**Architecture:** 继续保留 `scripts/pack-win-dir.mjs` 作为唯一入口，但把宿主判断收敛成显式的 `resolvePackProfile()` 和 `assertSupportedPackHost()` 预检层。`runPack()` 只在预检通过后串起现有本机构建阶段，删除不再需要的 Windows bridge helpers，并把 current-state 文档更新为新的双 profile / 无桥接事实。

**Tech Stack:** Node ESM 脚本、`node:fs/promises`、`node:child_process`、Vitest、Electron Builder、现有 npm scripts。

参考设计: `docs/superpowers/specs/2026-06-12-pack-platform-dispatch-design.md`

---

## File Structure

- **Modify** `scripts/pack-win-dir.mjs` - 新增宿主预检 helper，删除 WSL bridge helpers，把 `runPack()` 改成 profile-based native orchestration。
- **Modify** `scripts/pack-win-dir.test.mjs` - 新增 preflight/profile/logging 回归，删除旧 bridge helper 测试块，同时保留 `patch-win-icons` 目标解析测试。
- **Modify** `docs/Documentation.md` - 把 current-state 从“WSL 阶段桥接”更新成“双 profile + 无 Windows 桥接 + Linux x64 GNU 约束”。
- **Verify Only** `package-config.test.mjs` - 不改文件；继续用它确认 `package.json` 的 `pack` 入口仍然是 `node scripts/pack-win-dir.mjs`。

当前工作区已经有无关脏改动：

- `package.json`
- `package-lock.json`
- `src/inject/App.test.js`

执行本计划时，不要把这些文件一起 stage 或 commit。

---

### Task 1: 锁定宿主预检契约

**Files:**
- Modify: `scripts/pack-win-dir.test.mjs`
- Modify: `scripts/pack-win-dir.mjs`

- [ ] **Step 1: 先写失败测试，锁定 `resolvePackProfile()` 和 `assertSupportedPackHost()`**

在 `scripts/pack-win-dir.test.mjs` 的顶部导入列表里追加新导出 `assertSupportedPackHost` 与 `resolvePackProfile`，暂时保留 bridge helper 相关导出到 Task 2 再删除，并新增一个 `describe('pack host preflight', ...)` 组：

```js
const {
  assertSupportedPackHost,
  getElectronBuilderArgs,
  getPackPaths,
  hasLinuxRolldownBinding,
  hasWindowsRolldownBinding,
  isNativeWindowsEnvironment,
  isWslEnvironment,
  parsePackArgs,
  resolvePackOptions,
  resolvePackProfile,
  resolveWindowsNodeToolchain,
  resolveWindowsTool,
  runBuildPagesStage,
  runElectronBuilderStage,
  runPack,
  runPatchIconsStage,
  runPrepareDumpcapStage,
  runWindowsBridgedCommand,
  toWindowsPath,
  toWslPath,
} = packWinDirModule;

describe('pack host preflight', () => {
  it('maps supported operating systems to exact profile literals', () => {
    expect(resolvePackProfile('win32')).toBe('windows-native');
    expect(resolvePackProfile('linux')).toBe('linux-native');
    expect(() => resolvePackProfile('darwin')).toThrow('Unsupported pack host platform: darwin');
  });

  it('fails fast before any pack stage on unsupported operating systems', async () => {
    const runNativeCommand = vi.fn(async () => {});

    await expect(runPack({ appDirName: 'BKToolBox-dev' }, {
      projectRoot: '/repo',
      env: {
        platform: 'darwin',
        release: '23.5.0',
        arch: 'arm64',
        glibcVersionRuntime: '',
      },
      runNativeCommand,
    })).rejects.toThrow('Unsupported pack host platform: darwin');

    expect(runNativeCommand).not.toHaveBeenCalled();
  });

  it('rejects unsupported linux ABI contracts during preflight', () => {
    expect(() => assertSupportedPackHost({
      platform: 'linux',
      release: '6.8.0',
      arch: 'arm64',
      glibcVersionRuntime: '2.39',
    }, {
      projectRoot: '/repo',
      hasLinuxRolldownBinding: () => true,
    })).toThrow('linux-native pack requires x64 GNU Node runtime');

    expect(() => assertSupportedPackHost({
      platform: 'linux',
      release: '6.8.0',
      arch: 'x64',
      glibcVersionRuntime: '',
    }, {
      projectRoot: '/repo',
      hasLinuxRolldownBinding: () => true,
    })).toThrow('linux-native pack requires glibc runtime');

    expect(() => assertSupportedPackHost({
      platform: 'linux',
      release: '6.8.0',
      arch: 'x64',
      glibcVersionRuntime: '2.39',
    }, {
      projectRoot: '/repo',
      hasLinuxRolldownBinding: () => false,
    })).toThrow('linux-native pack requires @rolldown/binding-linux-x64-gnu before build starts');
  });
});
```

同时把当前两个 `runPack()` Linux fixture 的 `env` 补齐为带 ABI 信息的宿主快照，避免 Task 1 接入预检后旧用例误报失败：

```js
env: {
  platform: 'linux',
  release: '6.6.87.2-microsoft-standard-WSL2',
  arch: 'x64',
  glibcVersionRuntime: '2.39',
},
```

```js
env: {
  platform: 'linux',
  release: '6.6.87.2-generic',
  arch: 'x64',
  glibcVersionRuntime: '2.39',
},
```

- [ ] **Step 2: 运行测试，确认预检契约当前还不存在**

Run: `npx vitest run scripts/pack-win-dir.test.mjs`

Expected: FAIL，报错应体现缺少 `resolvePackProfile` / `assertSupportedPackHost` 导出，或 `runPack()` 还没有在任何 stage 前中止。

- [ ] **Step 3: 在 `scripts/pack-win-dir.mjs` 增加最小预检实现**

先保留现有 `execFileSync` import 和 bridge helpers，新增宿主快照与预检 helper；等 Task 2 删除 bridge helpers 时，再一起清理不再需要的 import：

```js
function readGlibcVersion(processReport = process.report) {
  return processReport?.getReport?.().header?.glibcVersionRuntime || '';
}

export function createPackEnv(processObject = process, osModule = os) {
  return {
    platform: processObject.platform,
    release: osModule.release(),
    arch: processObject.arch,
    glibcVersionRuntime: readGlibcVersion(processObject.report),
  };
}

export function resolvePackProfile(platform = process.platform) {
  if (platform === 'win32') return 'windows-native';
  if (platform === 'linux') return 'linux-native';
  throw new Error(`Unsupported pack host platform: ${platform}`);
}

export function assertSupportedPackHost(env, deps = {}) {
  if (env.platform !== 'linux') return;
  if (env.arch !== 'x64') {
    throw new Error(`linux-native pack requires x64 GNU Node runtime; received arch=${env.arch}`);
  }
  if (!env.glibcVersionRuntime) {
    throw new Error('linux-native pack requires glibc runtime');
  }
  const hasBinding = deps.hasLinuxRolldownBinding ?? hasLinuxRolldownBinding;
  if (!hasBinding(deps.projectRoot ?? projectRoot, deps)) {
    throw new Error('linux-native pack requires @rolldown/binding-linux-x64-gnu before build starts');
  }
}
```

然后把 `runPack()` 的 env 初始化改成：

```js
const env = deps.env ?? createPackEnv(process, os);
const profile = resolvePackProfile(env.platform);
assertSupportedPackHost(env, { ...deps, projectRoot: rootDir });
```

约束：

- `resolvePackProfile()` 只做 OS family 分类
- Linux x64 GNU 的 ABI / binding 校验只放在 `assertSupportedPackHost()`
- `runPack()` 在预检失败时不得调用任何构建 stage

- [ ] **Step 4: 回跑脚本测试，确认预检契约通过**

Run: `npx vitest run scripts/pack-win-dir.test.mjs`

Expected: PASS，新增的 `pack host preflight` 用例通过；旧 WSL bridge helper 用例此时仍可暂时保留，下一 task 再移除。

- [ ] **Step 5: 提交 Task 1**

```bash
git add scripts/pack-win-dir.mjs scripts/pack-win-dir.test.mjs
git commit -m "refactor: add pack host preflight"
```

---

### Task 2: 切换到 profile-based native orchestration 并删除旧 bridge 测试

**Files:**
- Modify: `scripts/pack-win-dir.mjs`
- Modify: `scripts/pack-win-dir.test.mjs`

- [ ] **Step 1: 先写失败测试，锁定日志与“无桥接”行为**

在 `scripts/pack-win-dir.test.mjs` 里删除整个 `describe('WSL bridge helpers', ...)` 测试块，改成新的 `describe('runPack native profiles', ...)`：

```js
describe('runPack native profiles', () => {
  it('logs WSL host diagnostics and keeps linux-native fully native', async () => {
    const runNativeCommand = vi.fn(async () => {});
    const renameDefaultAppDir = vi.fn(async () => {});
    const logInfo = vi.fn();

    await runPack({ appDirName: 'BKToolBox-dev' }, {
      projectRoot: '/mnt/c/tools/bidking',
      env: {
        platform: 'linux',
        release: '6.6.87.2-microsoft-standard-WSL2',
        arch: 'x64',
        glibcVersionRuntime: '2.39',
      },
      hasLinuxRolldownBinding: () => true,
      runNativeCommand,
      renameDefaultAppDir,
      logInfo,
    });

    expect(logInfo.mock.calls).toEqual([
      ['pack host: WSL'],
      ['pack profile: linux-native'],
    ]);
    expect(runNativeCommand).toHaveBeenCalledTimes(3);
  });

  it('logs windows-native and still runs patch-win-icons on native Windows', async () => {
    const runNativeCommand = vi.fn(async () => {});
    const renameDefaultAppDir = vi.fn(async () => {});
    const logInfo = vi.fn();

    await runPack({ appDirName: 'BKToolBox-dev' }, {
      projectRoot: '/repo',
      env: {
        platform: 'win32',
        release: '10.0.26100',
        arch: 'x64',
        glibcVersionRuntime: '',
      },
      execPath: '/custom-node',
      runNativeCommand,
      renameDefaultAppDir,
      logInfo,
    });

    expect(logInfo.mock.calls).toEqual([
      ['pack profile: windows-native'],
    ]);
    expect(runNativeCommand).toHaveBeenNthCalledWith(4, '/custom-node', [
      path.join('/repo', 'scripts', 'patch-win-icons.js'),
      path.join('/repo', 'dist', 'BKToolBox-dev'),
    ], '/repo', expect.any(Object));
  });
});
```

保留现有 `describe('patch-win-icons target resolution', ...)` 不动。

同时从顶部 destructuring 里删掉这些只服务 bridge 测试的导出：

```js
hasWindowsRolldownBinding
resolveWindowsNodeToolchain
resolveWindowsTool
runWindowsBridgedCommand
toWindowsPath
toWslPath
```

- [ ] **Step 2: 运行测试，确认当前实现还没有 profile 日志且还带着 bridge helper 依赖**

Run: `npx vitest run scripts/pack-win-dir.test.mjs`

Expected: FAIL，至少包含：

- `logInfo` 相关断言失败
- 删除 `describe('WSL bridge helpers', ...)` 后，旧 helper 导出还残留但没有新的 log 行为

- [ ] **Step 3: 删除 WSL bridge helpers，并把 `runPack()` 改成 profile 驱动**

从 `scripts/pack-win-dir.mjs` 中删除以下不再需要的 helper 与相关 import：

```js
hasWindowsRolldownBinding
runWhereDefault
normalizeWhereResult
resolveWindowsTool
resolveWindowsNodeToolchain
runWindowsBridgedCommand
toWindowsPath
toWslPath
```

并从 `node:child_process` import 中删掉 `execFileSync`。

把 `runPack()` 改成显式 profile + log orchestration：

```js
function logPackContext(context, deps = {}) {
  const logInfo = deps.logInfo ?? console.log;
  if (isWslEnvironment(context.env)) {
    logInfo('pack host: WSL');
  }
  logInfo(`pack profile: ${context.profile}`);
}

export async function runPack(options, deps = {}) {
  const rootDir = deps.projectRoot ?? projectRoot;
  const env = deps.env ?? createPackEnv(process, os);
  const profile = resolvePackProfile(env.platform);
  assertSupportedPackHost(env, { ...deps, projectRoot: rootDir });
  const execPath = deps.execPath ?? process.execPath;
  const renameDefaultAppDirImpl = deps.renameDefaultAppDir ?? renameDefaultAppDir;

  const resolvedOptions = resolvePackOptions(options);
  const paths = getPackPaths(rootDir, resolvedOptions);
  const context = { projectRoot: rootDir, paths, env, execPath, profile };

  logPackContext(context, deps);
  await runBuildPagesStage(context, deps);
  await runPrepareDumpcapStage(context, deps);
  await runElectronBuilderStage(context, deps);
  await renameDefaultAppDirImpl(paths);
  await runPatchIconsStage(context, deps);
}
```

同时把 `runPatchIconsStage()` 的 guard 改成依赖 `context.profile`：

```js
export async function runPatchIconsStage(context, deps = {}) {
  if (context.profile !== 'windows-native') {
    return;
  }
  const runNative = deps.runNativeCommand ?? runNativeCommand;
  await runNative(
    context.execPath ?? process.execPath,
    [path.join(context.projectRoot, 'scripts', 'patch-win-icons.js'), context.paths.finalAppDir],
    context.projectRoot,
    deps,
  );
}
```

约束：

- 不改 `scripts/patch-win-icons.js`
- 不改 `package.json`
- 不删 `patch-win-icons target resolution` 测试

- [ ] **Step 4: 回跑 pack 脚本测试**

Run: `npx vitest run scripts/pack-win-dir.test.mjs`

Expected: PASS，且不再出现任何 bridge helper 相关失败；`patch-win-icons target resolution` 组仍全部通过。

- [ ] **Step 5: 提交 Task 2**

```bash
git add scripts/pack-win-dir.mjs scripts/pack-win-dir.test.mjs
git commit -m "refactor: switch pack to native host profiles"
```

---

### Task 3: 更新 current-state 文档并完成 Linux smoke verification

**Files:**
- Modify: `docs/Documentation.md`

- [ ] **Step 1: 把 `Documentation.md` 从旧 WSL 桥接事实改成新 profile 事实**

把 `docs/Documentation.md` 的 `当前仓库约束` 段落中关于 `npm run pack` 的旧桥接描述替换为下面这组 current-state 事实：

```md
- `npm run pack` 现在默认输出到 `dist/<YYYYMMDDHHMMSS>`；如需固定目录名，继续显式传 `--app-dir-name <name>`
- `npm run pack` 在进入任何构建阶段前会先做预检：
  - `resolvePackProfile()` 只返回 `windows-native` 或 `linux-native`
  - `assertSupportedPackHost()` 只接受当前 `x64 GNU` Linux 依赖契约
- `npm run pack` 在 Linux / WSL 下不再桥接到 Windows 侧工具
- `npm run pack` 在原生 Windows 下仍会执行 `patch-win-icons.js`
- `npm run deploy:game-pc` 为了保持默认部署路径稳定，内部仍显式执行 `npm run pack -- --app-dir-name win-unpacked`
```

不要修改与 `desktop`、`dist:win` 有关的 current-state 文本。

- [ ] **Step 2: 跑目标测试与 Linux smoke verification**

Run: `npx vitest run scripts/pack-win-dir.test.mjs package-config.test.mjs`

Expected: PASS

Run: `npm run prepare:dumpcap`

Expected: PASS，刷新 `build/runtime-capture/` 下的运行时文件

Run: `npx electron-builder --win --dir --config.directories.output=dist/.pack-linux-smoke`

Expected: PASS，说明当前 Linux 环境能原生完成 `electron-builder --win --dir`

Run: `rm -rf dist/.pack-linux-smoke`

Expected: 无输出，清理 smoke 产物

- [ ] **Step 3: 把验证结果补录到 `Documentation.md`**

在 `docs/Documentation.md` 的 `最新验证` 段追加两条 2026-06-12 记录：

```md
- 2026-06-12：`npx vitest run scripts/pack-win-dir.test.mjs package-config.test.mjs` 通过；覆盖 `resolvePackProfile()`、`assertSupportedPackHost()`、`runPack()` 的 `windows-native / linux-native` 分派、原生 Windows 图标补丁保留，以及 `patch-win-icons` 的目标解析回归。
- 2026-06-12：`npm run prepare:dumpcap` 与 `npx electron-builder --win --dir --config.directories.output=dist/.pack-linux-smoke` 通过，说明当前 Linux 环境可以原生完成 `electron-builder --win --dir`，不再依赖 Windows bridge。
```

- [ ] **Step 4: 运行格式与收尾检查**

Run: `git diff --check`

Expected: 无输出

- [ ] **Step 5: 提交 Task 3**

```bash
git add docs/Documentation.md
git commit -m "docs: record native pack host profiles"
```

---

## Self-Review

- 规格覆盖检查:
  - `resolvePackProfile(platform)` 命名导出: Task 1
  - `assertSupportedPackHost(env, deps)` 前置硬失败: Task 1
  - `resolvePackProfile()` 的精确字面量返回与 unsupported 平台失败: Task 1
  - `runPack()` 的 preflight + profile 日志顺序: Task 2
  - 删除 WSL bridge helpers，但保留 `patch-win-icons` 目标解析测试: Task 2
  - 默认时间戳目录与 `--app-dir-name` 语义不变: Task 1 + Task 2
  - `Documentation.md` 的 current-state 与 smoke verification: Task 3
- 占位符检查:
  - 无 `TODO` / `TBD` / “自行实现”
- 类型与命名一致性:
  - 统一使用 `resolvePackProfile`, `assertSupportedPackHost`, `windows-native`, `linux-native`, `glibcVersionRuntime`
  - `patch-win-icons` 只描述为 Windows-only post-processing，不把它写进跨平台目录语义承诺
