# Pack 平台分派与本机编译链路 · 设计文档

> 日期: 2026-06-12 · 状态: 已确认设计, 等待用户审阅

## 目标

让 `npm run pack` 在构建开始前先识别当前系统，然后选择对应的本机编译链路：

- Windows 上走 Windows 原生链路
- Linux / WSL 上走 Linux 原生链路
- 不再把 Linux 链路桥接到 Windows 侧工具

本次只处理 `pack`。`desktop` 和 `dist:win` 不在本轮范围内。

## 当前状态

当前 `pack` 入口仍然是：

```json
"pack": "node scripts/pack-win-dir.mjs"
```

`scripts/pack-win-dir.mjs` 已经负责串起这些阶段：

1. `npm run build:pages`
2. `npm run prepare:dumpcap`
3. `electron-builder --win --dir`
4. 重命名 unpacked 目录（如果传了 `--app-dir-name`）
5. `scripts/patch-win-icons.js`

当前脚本里已经有一些平台判断，但整体语义还不够明确，尤其是“先识别系统，再决定整条链路如何执行”这件事还没有被显式建模。

当前默认输出目录语义已经是：

- 未传 `--app-dir-name` 时，输出到 `dist/<YYYYMMDDHHMMSS>`
- 传了 `--app-dir-name <name>` 时，输出到 `dist/<name>`
- `deploy:game-pc` 为了保持兼容，仍显式传 `--app-dir-name win-unpacked`

这里的“产物语义”只指目录名、目录结构和 `--app-dir-name` 行为，不包含 host-specific 的图标后处理一致性。

本次设计要求新增一个命名导出：

- `resolvePackProfile(platform)`
- 参数是平台字符串
- 返回值只能是精确字符串字面量 `'windows-native'` 或 `'linux-native'`
- 其他任何值都必须抛错，不能静默降级

`runPack()` 只负责调用这个导出，不负责自己内联平台判定。

本次设计同时要求新增一个前置守卫导出：

- `assertSupportedPackHost(env, deps)`
- 只在 `resolvePackProfile(platform)` 成功后调用
- 在任何构建阶段前完成宿主约束校验
- 当前迭代里，Linux 只接受当前 x64 GNU 依赖契约；不符合时必须前置硬失败
- `resolvePackProfile(platform)` 只负责 OS family 分类，不负责 ABI 兼容性判断

## 方案比较

### A. 拆成多个用户命令

把 `pack` 拆成 `pack:win`、`pack:linux`，再让 `pack` 做转发。

优点：

- 每条链路更显式
- 调试时可以直接跑对应命令

缺点：

- 用户需要记更多命令
- 配置和实现容易分散

### B. 推荐方案: 单入口 + 运行前识别系统

保留 `npm run pack` 作为唯一入口，在脚本内部先判定 host profile，再执行本机链路。

优点：

- 入口不变
- Linux 不依赖 Windows 工具
- Windows 侧也能直接原生编译
- 逻辑集中，后续容易维护

缺点：

- `scripts/pack-win-dir.mjs` 需要引入一个很小的 profile 抽象

### C. 继续散落式 `if (process.platform === ...)`

在现有函数里继续加平台判断，不单独建 profile。

优点：

- 改动最小

缺点：

- 规则会越来越散
- 后续再改 stage 时容易重复判断

### 结论

采用 **B**。

## 设计

### 0. 执行顺序

`runPack()` 的执行顺序必须是下面这个顺序，不能把前置校验拆散到各个阶段里：

```text
profile = resolvePackProfile(env.platform)
assertSupportedPackHost(env, deps)
log host diagnostics
log pack profile
build:pages
prepare:dumpcap
electron-builder --win --dir
rename output directory if needed
patch-win-icons only when profile === 'windows-native'
```

如果预检阶段抛错，必须立刻记录错误并退出，后续任何阶段都不允许运行。

### 1. Host Profile

`runPack()` 在执行任何构建阶段前，先解析一个 host profile：

- `windows-native`：`process.platform === 'win32'`
- `linux-native`：`process.platform === 'linux'`
- 其他平台直接报错，避免把 Windows 打包流程误跑到不支持的宿主环境上

`resolvePackProfile()` 只做 OS family 分类；Linux x64 GNU 的 ABI / 依赖契约由 `assertSupportedPackHost()` 单独校验。

WSL 不单独分支成一条桥接链路，它只作为 Linux 宿主的一种诊断信息存在。

如果当前宿主是 WSL，日志可以额外打印一行：

- `pack host: WSL`

但 profile 行本身必须保持不变，仍然是：

- `pack profile: windows-native`
- `pack profile: linux-native`

不要把 `(WSL)` 追加到 profile 行里；WSL 只作为单独的 host 诊断行存在。

### 2. 阶段分派

`pack` 的阶段顺序保持不变，但每个阶段的执行规则明确为：

0. `preflight`
   - `resolvePackProfile(env.platform)`
   - `assertSupportedPackHost(env, deps)`
   - 预检必须在任何构建阶段前完成
   - Linux 只接受当前 x64 GNU 依赖契约；不满足时必须硬失败
   - 后续任何阶段都不允许运行
1. `build:pages`
   - 始终本机执行
   - Linux 宿主缺少 `@rolldown/binding-linux-x64-gnu` 时，直接失败
2. `prepare:dumpcap`
   - 始终本机执行
   - 不引入 Windows 侧工具
3. `electron-builder --win --dir`
   - 始终本机执行
   - 继续沿用现有命令语义，不在 Linux 链路里引入 Windows relaunch
   - 本次设计将这一步视为实施前置条件：在实现前必须先通过 smoke test 验证当前仓库的 Linux 环境可以完成这一步
4. `output directory rename`
   - 保持现有默认目录和 `--app-dir-name` 行为
5. `patch-win-icons`
   - 保持当前的入口平台策略：仅在原生 Windows 执行
   - Linux / WSL 直接跳过
   - 这是 Windows-only 的后处理步骤，不属于跨平台路径/目录语义的一部分

这个设计的重点是：Linux 链路不再依赖 Windows 侧可执行文件、`cmd.exe` 或 `npm.cmd`。

### 3. 日志与错误

`runPack()` 应在开跑时打印一次当前 profile：

- `pack profile: windows-native`
- `pack profile: linux-native`

如果当前宿主是 WSL，先打印 `pack host: WSL`，再打印 profile 行。

如果宿主平台不支持，应在任何阶段执行前失败，并给出明确报错：

- 当前宿主平台
- 预期支持的平台
- 本次为何不能继续

unsupported-platform 的失败必须是硬失败，不得继续执行任何阶段，也不得尝试部分构建。

### 4. 输出语义

这次设计不改 `pack` 的产物语义：

- 默认仍输出时间戳目录 `dist/<YYYYMMDDHHMMSS>`
- `--app-dir-name <name>` 仍只改最终输出目录名
- 目录已存在时，仍先清理再重命名
- Windows-only 的图标补丁不在这次跨平台路径/目录语义承诺的范围内

### 5. 代码边界

本次迭代会把 `scripts/pack-win-dir.mjs` 里现有的 WSL bridge helpers 视为过期实现并移除，包括：

- `runWindowsBridgedCommand`
- `resolveWindowsTool`
- `resolveWindowsNodeToolchain`
- `toWindowsPath`
- `toWslPath`

对应的 bridge helper 测试也一并退场，`scripts/pack-win-dir.test.mjs` 只保留 profile 分派和目录行为测试。
现有 `scripts/patch-win-icons.js` 的目标解析测试保留不动，因为它们覆盖的是 `dist:win` 和直接 app-dir 路径行为，不属于 WSL bridge 范围。

## 非目标

- 不改 `desktop`
- 不改 `dist:win`
- 不新增用户必须记忆的第二套打包命令
- 不把 Linux `pack` 回切到 Windows 侧工具链
- 不要求 `pack` 在 Linux 上调用 `cmd.exe`、`npm.cmd`、`electron-builder.cmd`
- 不支持 ARM64 Linux；本次 `linux-native` 仅指当前 x64 GNU 环境
- 不改 `scripts/pack-win-dir.mjs` 文件名；本轮只调整内部语义和导出

## 影响文件

- `scripts/pack-win-dir.mjs`
- `scripts/pack-win-dir.test.mjs`
- `docs/Documentation.md`
- `package.json` 仅在必要时调整说明，不改变入口命令名
- `scripts/pack-win-dir.mjs` 中的 WSL bridge helpers 及其测试（作为删除范围）

## 测试

至少覆盖这些行为：

1. `resolvePackProfile()` 能区分 `win32` 和 `linux`
2. `assertSupportedPackHost()` 会在 Linux 缺少当前 x64 GNU binding 时前置失败
3. 非 `win32` / `linux` 平台会在构建前失败
4. `runPack()` 在 Linux profile 下按顺序执行 `build:pages`、`prepare:dumpcap`、`electron-builder`
5. `runPack()` 在 Windows profile 下会执行 `patch-win-icons`
6. Linux profile 下不会触发任何 Windows 侧命令解析
7. `scripts/pack-win-dir.test.mjs` 仅删除桥接 helpers 旧测试块，保留 `patch-win-icons` 的目标解析测试

## 验收标准

1. `npm run pack` 在 Windows 上和 Linux 上都能先识别 host，再走对应链路。
2. Linux / WSL 执行 `pack` 时不会尝试桥接到 Windows 侧工具。
3. `pack` 的默认输出目录和 `--app-dir-name` 语义不变。
4. `pack` 的日志能明确说明当前 profile。
5. `docs/Documentation.md` 包含一节明确说明两个 profile、Linux x64 范围和“禁止桥接到 Windows 侧工具”的约定。
6. 在开始实现前，Linux smoke test 已确认 `electron-builder --win --dir` 在当前仓库环境可用。
