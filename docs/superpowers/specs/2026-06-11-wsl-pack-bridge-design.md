# WSL Pack Auto-Bridge Design

## Goal

让 `npm run pack` 在 `WSL` 下自动判断每个打包阶段应该继续使用 `WSL` 原生执行，还是桥接到 Windows 侧工具执行；同时保持在具备 Linux 依赖时，`build:pages` 仍可继续走原生 `WSL` 编译，不被强制切到 Windows。

## Current Facts

### Existing `pack` chain

当前 `scripts/pack-win-dir.mjs` 的打包链是：

1. `npm run build:pages`
2. `npm run prepare:dumpcap`
3. `electron-builder --win --dir`
4. `node scripts/patch-win-icons.js <app-dir>`

### Historical facts from repo history

- 老代码里的 `build:home` / `build:pages` 一直是普通 `vite build`，并不天然要求 Windows exe。
- 老代码里的完整 `pack` 链从较早版本开始就已经包含 `patch-win-icons.js`。
- `patch-win-icons.js` 从引入开始就依赖 `rcedit.exe`，并显式支持 `WSL` 互操作。
- 因此，历史上的 `WSL pack` 不是纯 Linux-only 链，但也从未要求把整条链无条件重启到 Windows。

### Current failure mode

当前工作区的 `node_modules` 只安装了 Windows 侧的 `@rolldown/binding-win32-x64-msvc`。在 `WSL` 中用 Linux Node 执行 `vite build` 时，会因为缺失 `@rolldown/binding-linux-x64-gnu` 而失败。

这说明问题不在 `pack` 目标本身，而在“当前依赖形态”和“实际执行平台”不匹配。

## Non-Goals

- 不把 `npm run pack` 简化为“在 `WSL` 下整条链都改用 Windows 执行”。
- 不改变 `pack` 的产物语义、目录语义或 `--app-dir-name` 语义。
- 不要求用户额外维护 `pack` / `pack:win-bridge` 两套命令入口。
- 不修改 `patch-win-icons.js` 已有的 `WSL -> rcedit.exe` 互操作模型，除非为修复桥接链路必须做最小补充。

## Recommended Architecture

`scripts/pack-win-dir.mjs` 从“顺序执行命令的轻包装器”升级为“按阶段调度执行环境的包装器”。

它仍然负责：

- 解析 `--app-dir-name`
- 计算 `dist` 输出路径
- 顺序执行打包阶段
- 在需要时重命名输出目录

新增职责：

- 检测当前是否运行在 `WSL`
- 检测当前 `node_modules` 对 `build:pages` 可用的是 Linux 绑定、Windows 绑定，还是两者都可用
- 在 `WSL` 下为每个阶段选择 `native` 或 `windows-bridge` 执行模式
- 动态解析 Windows 侧可执行路径，而不是硬编码 `C:\Program Files\nodejs\node.exe`

## Decision Table

### Platform: native Windows

所有阶段继续原生执行：

1. `build:pages` -> native
2. `prepare:dumpcap` -> native
3. `electron-builder --win --dir` -> native
4. `patch-win-icons.js` -> native

### Platform: non-WSL Linux

不支持 Windows 桌面打包桥接。

行为：

- `runPack()` 在进入任何阶段前就应直接失败
- 不允许先执行 `build:pages` / `prepare:dumpcap` 再在中途失败
- 错误信息应明确指出：当前环境不是 Windows，也不是 WSL，无法生成 Windows 打包产物

### Platform: WSL

#### Stage 1: `build:pages`

优先级：

1. 如果检测到 Linux `rolldown` 绑定可用，则 native 执行
2. 否则，如果检测到 Windows `rolldown` 绑定可用且 Windows Node/NPM 可解析，则桥接到 Windows `npm run build:pages`
3. 否则报错，错误信息应明确指出当前缺少 Linux 绑定，且也无法桥接到 Windows 工具链

#### Stage 2: `prepare:dumpcap`

始终 native 执行。

理由：

- 该脚本只是复制 Windows 运行时文件
- 它不要求 Linux 原生绑定，也不要求执行 Windows exe
- 保持在 `WSL` 执行可以减少无意义桥接

#### Stage 3: `electron-builder --win --dir`

在 `WSL` 下始终桥接到 Windows 侧执行。

理由：

- 这是 Windows 目标产物构建阶段
- 与当前 repo 中的 `patch-win-icons`、Windows admin manifest、Windows 打包产物后处理语义一致
- 即使未来 `build:pages` 能原生在 `WSL` 执行，这一步也应保持 Windows 侧更稳妥

#### Stage 4: `patch-win-icons.js`

默认保持 native `WSL` 执行。

理由：

- 该脚本已实现 `WSL -> rcedit.exe` 的兼容路径
- 继续沿用现有模型，减少桥接面

## Tool Resolution Rules

在 `WSL` 下桥接到 Windows 时，不允许硬编码 `node.exe`、`npm.cmd`、`electron-builder.cmd` 路径。

应新增一层“Windows tool resolution”：

1. 通过 `cmd.exe /d /c where node`
2. 通过 `cmd.exe /d /c where npm`
3. 通过 `cmd.exe /d /c where electron-builder`

如果 `electron-builder` 不在 `PATH`，允许第二优先级回退到：

- `node_modules/.bin/electron-builder.cmd`

`toWslPath()` 的规则必须固定为：

- `<drive>:\<rest>` -> `/mnt/<drive.lower()>/<rest with "\" -> "/">`

例如：

- `C:\Program Files\nodejs\node.exe` -> `/mnt/c/Program Files/nodejs/node.exe`
- `D:\work\foo\bar.cmd` -> `/mnt/d/work/foo/bar.cmd`

Windows bridge 的进程执行契约必须固定为：

- `spawn()` 的 `command` 使用 `WSL` 可执行路径
- 传给 Windows 进程的脚本参数和命令参数使用 Windows 语义路径
- 所有 Windows-bridged 进程的 `cwd` 都必须无条件使用 Windows 路径，即 `toWindowsPath(projectRoot)`；不能传 `WSL` 路径
- 所有路径型 CLI 参数也都必须在进入 Windows bridge 前转换成 Windows 路径；不能把 `WSL` 路径透传给 Windows 进程

例如：

- script path: `C:\tools\bidking\scripts\pack-win-dir.mjs`
- cwd: `C:\tools\bidking`

### `.cmd` / batch wrapper rule

在 `WSL` 下，`.cmd` 文件不能被直接 `spawn()`。

因此 `runWindowsBridgedCommand()` 必须遵守以下规则：

- 如果目标工具是 `.exe`，可以直接通过其 `WSL` 可执行路径启动
- 如果目标工具是 `.cmd`，必须包装成：
  - `cmd.exe /d /c <absolute-windows-path-to>.cmd <args...>`
- Windows 侧 `npm run build:pages` 也必须通过 `cmd.exe /d /c npm run build:pages` 执行，不能直接 `spawn('npm.cmd')`

## Legacy Path Removal

当前 `scripts/pack-win-dir.mjs` 里已有的整链路重启路径必须在实现时移除，不能与新的按阶段调度并存：

- `WINDOWS_NODE_EXE`
- `BK_PACK_WINDOWS_RELAUNCHED`
- `buildWindowsRelaunchCommand()`
- `relaunchViaWindows()`
- `main()` 里基于 `WSL` 的整脚本 relaunch guard

实现完成后，`WSL` 下只能走新的“按阶段自动判断”路径。

## Detection Rules

### WSL detection

继续使用：

- `process.platform === 'linux'`
- `os.release().toLowerCase().includes('microsoft')`

### Linux `rolldown` binding availability

最小检测目标：

- `node_modules/@rolldown/binding-linux-x64-gnu/rolldown-binding.linux-x64-gnu.node`

如果未来要更稳，可扩展为从 `rolldown` 包的 optional bindings 推导当前平台对应 binding 名称，但本次先服务当前 `x64 + gnu` 机器。

### Windows `rolldown` binding availability

最小检测目标：

- `node_modules/@rolldown/binding-win32-x64-msvc/rolldown-binding.win32-x64-msvc.node`

### Windows bridge availability

必须同时满足：

- 当前在 `WSL`
- 能解析 Windows `node`
- 能解析 Windows `npm`

对于 `electron-builder` 阶段，还必须能解析：

- Windows `electron-builder`，或
- `node_modules/.bin/electron-builder.cmd`

## Error Handling

错误信息必须按阶段说明：

- 是哪个阶段失败
- 当前选择的是 `native` 还是 `windows-bridge`
- 缺的是 Linux binding、Windows tool，还是 Windows bridge 本身不可用

例如：

- `build:pages cannot run natively in WSL: missing @rolldown/binding-linux-x64-gnu`
- `build:pages fallback to Windows bridge failed: npm.cmd not found on Windows PATH`
- `electron-builder Windows bridge is unavailable: node_modules/.bin/electron-builder.cmd not found and 'where electron-builder' returned no result`

## Implementation Shape

推荐在 `scripts/pack-win-dir.mjs` 内新增几类 helper：

- platform helpers
  - `isWslEnvironment()`
  - `isNativeWindowsEnvironment()`
- path conversion helpers
  - `toWindowsPath()`
  - `toWslPath()`
- tool resolution helpers
  - `resolveWindowsTool()`
  - `resolveWindowsNodeToolchain()`
- binding detection helpers
  - `hasLinuxRolldownBinding()`
  - `hasWindowsRolldownBinding()`
- stage dispatch helpers
  - `runNativeCommand()`
  - `runWindowsBridgedCommand()`
  - `runBuildPagesStage()`
  - `runPrepareDumpcapStage()`
  - `runElectronBuilderStage()`
  - `runPatchIconsStage()`

`runPack()` 负责串联阶段，不再自己直接拼平台判断。

`runElectronBuilderStage()` 在 Windows bridge 下必须把所有路径型参数转换成 Windows 路径，包括但不限于：

- `--config.directories.output=<windows-path>`
- 未来新增的任何 `--config.*=<path>`、输入目录参数或输出目录参数

### Helper contracts

`resolveWindowsTool(name, deps?)`

- 输入：工具名，例如 `node`、`npm`、`electron-builder`
- 输出：`{ windowsPath, wslPath, viaCmd }`
- 其中：
  - `windowsPath` 是 Windows 语义绝对路径
  - `wslPath` 是 `WSL` 可执行路径
  - `viaCmd` 表示该工具是否必须通过 `cmd.exe /d /c` 间接调用
- 找不到时抛错，不返回 `null`
- `deps` 必须允许注入子进程执行器，供测试 mock `where ...`

`resolveWindowsNodeToolchain(deps?)`

- 输出：
  - `node`: `resolveWindowsTool('node', deps)` 的结果
  - `npm`: `resolveWindowsTool('npm', deps)` 的结果
- 找不到任一必需工具时抛错
- `deps` 同样允许注入子进程执行器

`runWindowsBridgedCommand(commandSpec, deps?)`

- 输入必须显式区分：
  - 要启动的是 `.exe` 还是 `.cmd`
  - 传入的命令路径是 Windows 路径还是 `WSL` 路径
- 推荐的最小对象形状是：
  - `{ kind, wslExecutable, windowsCommand, args, windowsCwd }`
  - 其中 `kind` 只能是 `'exe'` 或 `'cmd'`
- 所有 Windows-bridged 进程的 `cwd` 都必须是 `toWindowsPath(projectRoot)`
- `deps` 必须允许注入 `spawn` 实现，便于测试断言 `.cmd` 包装行为

## Test Strategy

只做脚本契约测试，不做真实端到端打包。

至少新增覆盖：

1. `WSL + Linux binding present` -> `build:pages` 选择 native
2. `WSL + Linux binding missing + Windows binding present` -> `build:pages` 选择 windows-bridge
3. `WSL + Windows bridge unavailable` -> 返回明确错误
4. `WSL` 下 `electron-builder` 始终选择 windows-bridge
5. `WSL` 下 `prepare:dumpcap` 始终 native
6. `WSL` 下 `patch-win-icons` 保持 native
7. Windows tool path 解析不再硬编码固定安装目录
8. `.cmd` 工具会通过 `cmd.exe /d /c ...` 包装执行，而不是被直接 `spawn()`

测试层面优先锁定“决策函数”与“路径转换函数”，避免把测试耦合到真实本机 PATH。

为做到这一点，tool resolution 与 Windows bridge helper 都必须支持注入 mock executor / mock spawn，而不是在函数内部直接硬耦合真实 `cmd.exe`。

## Done When

满足以下条件才算完成：

1. `npm run pack` 在 Windows 下行为不变
2. `npm run pack` 在 `WSL` 下会按阶段自动选择 native / Windows bridge
3. 如果 `WSL` 具备 Linux `rolldown` 绑定，`build:pages` 不会被强制桥接到 Windows
4. 如果 `WSL` 缺失 Linux `rolldown` 绑定但具备 Windows toolchain，会自动桥接 `build:pages`
5. `electron-builder` 阶段在 `WSL` 下通过 Windows bridge 运行
6. 相关测试覆盖调度决策与错误分支
7. current-state 文档更新为“按阶段自动判断”而不是“整条 pack relaunch 到 Windows”
8. 旧的 `relaunchViaWindows / BK_PACK_WINDOWS_RELAUNCHED` 整链路重启路径已移除
