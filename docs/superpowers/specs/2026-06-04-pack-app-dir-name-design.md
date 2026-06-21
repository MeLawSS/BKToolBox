# Windows Unpacked App 目录名配置 · 设计文档

> 日期: 2026-06-04 · 状态: 已确认设计, 进入 writing-plans / 实现

## 目标

让 `npm run pack` 支持通过命令行参数指定 `dist/` 下 unpacked app 目录的名称。

本次确认采用的入口是：

```bash
npm run pack -- --app-dir-name BKToolBox-dev
```

当用户未传该参数时，当前行为必须保持不变，仍然输出默认的 `dist/win-unpacked`。

## 当前状态

`package.json` 里的当前 `pack` 脚本是：

```json
"pack": "npm run build:pages && npm run prepare:dumpcap && electron-builder --win --dir && node scripts/patch-win-icons.js dist"
```

这意味着：

1. `electron-builder --win --dir` 固定产出 `dist/win-unpacked`
2. `scripts/patch-win-icons.js` 当前接收 `dist` 根目录，再硬编码寻找：

```text
dist/win-unpacked/BKToolBox.exe
```

3. `dist:win` 走的是便携包构建，不依赖 unpacked 目录名

## 已确认行为

1. 支持 `npm run pack -- --app-dir-name <name>`。
2. 不支持环境变量入口；本次只做命令行参数模式。
3. 未传参数时，保留现状：输出 `dist/win-unpacked`。
4. 传参时，`electron-builder` 仍然先产出默认 `dist/win-unpacked`，然后再重命名为 `dist/<name>`。
5. 图标补丁仍然要执行，但目标应切换到重命名后的 app 目录。
6. `dist:win` 不改行为。
7. `deploy:game-pc` 不改默认行为，仍然把 `dist/win-unpacked` 当作默认本地目录；如需部署自定义目录，继续显式传 `--local-dir`。

## 方案比较

### A. 直接改 electron-builder 输出配置

尝试动态改 `build.directories.output` 或让 electron-builder 直接产出自定义 unpacked 目录。

优点：

- 理论上不需要额外重命名

缺点：

- 会把整个 `dist/` 输出根一起改掉，超出需求
- 需要把动态配置注入 electron-builder，改动面更大
- 容易影响 `dist:win`、调试输出和现有脚本假设

### B. 推荐方案: 包装 `pack`，构建后重命名 unpacked 目录

新增一个 Node 包装脚本，内部继续调用：

- `npm run build:pages`
- `npm run prepare:dumpcap`
- `electron-builder --win --dir`

如果传了 `--app-dir-name`，则在成功产出 `dist/win-unpacked` 后把它重命名为 `dist/<name>`，然后对该目录执行图标补丁。

优点：

- 不改变 electron-builder 的核心配置
- 不影响 `dist:win`
- 兼容现有默认行为
- 逻辑清晰，易于单测

缺点：

- 额外多一步重命名
- 需要处理目标目录已存在的情况

### C. 在 `pack` 后复制一份自定义目录

保留 `dist/win-unpacked`，再复制到 `dist/<name>`。

优点：

- 对现有默认目录兼容性最好

缺点：

- 会在 `dist` 下保留两份大目录
- 无意义放大磁盘占用和打包时间

### 结论

采用 **B**。

## 设计

### 1. 新增包装脚本

新增 `scripts/pack-win-dir.mjs`，作为 `npm run pack` 的唯一入口。

它负责：

- 解析 `--app-dir-name`
- 按顺序执行现有构建命令
- 在需要时把 `dist/win-unpacked` 重命名为 `dist/<name>`
- 调用图标补丁脚本并把最终 app 目录路径传进去

### 2. 参数契约

支持：

```bash
npm run pack
npm run pack -- --app-dir-name BKToolBox-dev
```

约束：

- `--app-dir-name` 必须带值
- 值不能为空白
- 值不能是 `.`、`..`
- 值不能包含路径分隔符，避免逃出 `dist/`

本次不额外支持别名参数。

### 3. 目录行为

默认情况：

- 最终目录仍为 `dist/win-unpacked`

传入自定义名称时：

- 若 `dist/win-unpacked` 构建成功，则重命名为 `dist/<name>`
- 若 `dist/<name>` 已存在，应先删除旧目录再重命名，避免 `fs.rename()` 直接失败

这是可接受的，因为该目录本来就是 `pack` 产物。

### 4. 图标补丁脚本

`scripts/patch-win-icons.js` 需要从“接收 dist 根目录并硬编码 `win-unpacked`”改成：

- 优先把入参视为 app 目录
- 在该目录下直接寻找 `BKToolBox.exe`
- 为兼容旧调用，如果传入的是 `dist` 根目录，也继续回退检查 `dist/win-unpacked/BKToolBox.exe`

这样：

- 新包装脚本可以传 `dist/<name>`
- 现有 `dist:win` 或手工调用仍不会立刻坏掉

### 5. 测试

至少覆盖：

1. `parsePackArgs([])` 保持默认目录名为空配置
2. `parsePackArgs(['--app-dir-name', 'BKToolBox-dev'])` 正常解析
3. 缺值、空值、带路径分隔符时报错
4. `patch-win-icons` 的目标解析能同时支持：
   - 直接 app 目录
   - 旧的 `dist` 根目录

本次不跑真实 `electron-builder` 端到端构建测试，只锁定脚本契约与路径解析。

## 范围

- 修改 `package.json` 的 `pack` 脚本入口
- 新增 `scripts/pack-win-dir.mjs`
- 新增对应脚本测试
- 修改 `scripts/patch-win-icons.js`
- 更新 `docs/Documentation.md` 的常用命令说明

## 非目标

- 不改 `dist:win`
- 不改 electron-builder `build.directories.output`
- 不改 `deploy:game-pc` 默认 `localDir`
- 不支持环境变量入口
- 不支持修改 exe 文件名

## 影响文件

- `package.json`
- `scripts/pack-win-dir.mjs`
- `scripts/pack-win-dir.test.mjs`
- `scripts/patch-win-icons.js`
- `docs/Documentation.md`

## 验收标准

1. `npm run pack` 仍然生成默认 `dist/win-unpacked`。
2. `npm run pack -- --app-dir-name BKToolBox-dev` 最终生成 `dist/BKToolBox-dev`。
3. 自定义目录模式下，图标补丁仍然作用在 `dist/BKToolBox-dev/BKToolBox.exe`。
4. 非法目录名参数会被脚本直接拒绝。
5. `dist:win` 与 `deploy:game-pc` 的默认行为不回归。
