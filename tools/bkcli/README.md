# bkcli

Overview manual: [`../../docs/AUTO_OPERATION_MANUAL.md`](../../docs/AUTO_OPERATION_MANUAL.md). Use the manual first for the current `bkcli` / Agent / MetaOperation / AggregateOperation boundary map. This file stays focused on CLI usage.

AI 辅助开发工具，通过 DLL 注入访问 BidKing 游戏进程内部结构，用于 UI 分析和自动化操作。

## 前提条件

- Windows 10/11
- Node.js 20+
- PowerShell 7+ (`pwsh`)
- BidKing.exe 进程正在运行
- `exec-probe` 命令额外需要 WSL + MinGW：`sudo apt install gcc-mingw-w64-x86-64`

## 快速开始

```bash
# 1. 注入 Agent（每次启动 BidKing 后运行一次）
node bkcli.js inject

# 2. 验证连通性
node bkcli.js ping

# 3. 查看当前界面
node bkcli.js get-current-ui

# 4. 列出可见面板
node bkcli.js get-visible-panels

# 5. 分析面板节点树（只看可交互节点）
node bkcli.js dump MainPanel

# 6. 点击按钮
node bkcli.js click MainPanel Btns1/mail
```

## 输出格式

所有命令输出 JSON，成功时 exit code 0，失败时 exit code 1：

```json
{"ok": true, "result": {...}}
{"ok": false, "error": "...", "detail": "..."}
```

---

## 命令参考

### inject

向 BidKing 进程注入 BKAutoOpAgent.dll，建立命名管道通信通道。

```
node bkcli.js inject
```

Agent 注入后在 `\\.\pipe\BKAutoOp` 上监听。管道就绪后返回：

```json
{"ok": true, "result": {"status": "ready"}}
```

**注意：** BidKing 重启后需重新注入。

---

### ping

检查 Agent 是否在线。

```
node bkcli.js ping
```

---

### get-current-ui

获取当前主界面名称。

```
node bkcli.js get-current-ui
```

示例输出：

```json
{"ok": true, "result": {"ui": "MainPanel"}}
```

---

### get-visible-panels

列出当前所有可见面板。

```
node bkcli.js get-visible-panels
```

示例输出：

```json
{"ok": true, "result": {"panels": ["MainPanel", "WareHousePanel"]}}
```

---

### dump

导出面板节点树，默认只返回可交互节点。

```
node bkcli.js dump <panel> [选项]
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `--root <path>` | `""` | 从指定子路径开始遍历 |
| `--all` | 关 | 包含不可交互节点（关闭 interactiveOnly） |
| `--depth <n>` | `4` | 最大遍历深度 |
| `--limit <n>` | `200` | 返回节点数上限 |

示例：

```bash
# 导出 MainPanel 所有可交互节点（默认）
node bkcli.js dump MainPanel

# 从子路径开始，深度 6，包含所有节点
node bkcli.js dump MainPanel --root Btns1 --depth 6 --all

# 增大节点数上限
node bkcli.js dump WareHousePanel --limit 500
```

示例输出：

```json
{
  "ok": true,
  "result": {
    "nodes": [
      {"path": "Btns1/mail", "name": "mail", "componentTypes": ["Button"], "active": true, "interactive": true},
      {"path": "Btns1/notice", "name": "notice", "componentTypes": ["Button"], "active": true, "interactive": true}
    ],
    "truncated": false
  }
}
```

---

### get-node

获取单个节点的详细状态。

```
node bkcli.js get-node <panel> <path> [选项]
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `--root <path>` | `""` | 路径前缀 |
| `--mode exact\|glob` | `exact` | 路径匹配模式 |

示例：

```bash
node bkcli.js get-node MainPanel Btns1/mail
node bkcli.js get-node WareHousePanel "leftDown/Button*" --mode glob
```

---

### click

点击指定节点（Button 或 Toggle）。

```
node bkcli.js click <panel> <path> [选项]
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `--root <path>` | `""` | 路径前缀 |
| `--mode exact\|glob` | `exact` | 路径匹配模式 |
| `--component auto\|button\|toggle` | `auto` | 组件类型提示 |

示例：

```bash
# 精确路径点击
node bkcli.js click MainPanel Btns1/mail

# glob 路径 + 指定组件类型
node bkcli.js click WareHousePanel "leftDown/Button*" --mode glob --component button
```

---

### set-text

向输入框写入文字，可选提交。

```
node bkcli.js set-text <panel> <path> <text> [选项]
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `--root <path>` | `""` | 路径前缀 |
| `--mode exact\|glob` | `exact` | 路径匹配模式 |
| `--submit` | 关 | 写入后触发提交（相当于按 Enter） |

示例：

```bash
node bkcli.js set-text SearchPanel Input/Field "关键词" --submit
```

---

### wait-panel

等待面板出现（或消失）。

```
node bkcli.js wait-panel <panel> [选项]
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `--hidden` | 关 | 等待面板隐藏，而非出现 |
| `--timeout <ms>` | `5000` | 超时时间 |
| `--poll <ms>` | Agent 默认 | 轮询间隔 |

示例：

```bash
# 等待 WareHousePanel 出现（最多 10 秒）
node bkcli.js wait-panel WareHousePanel --timeout 10000

# 等待面板关闭
node bkcli.js wait-panel WareHousePanel --hidden
```

---

### wait-node

等待节点进入指定状态。

```
node bkcli.js wait-node <panel> <path> <state> [选项]
```

`state` 可选值：`active`、`inactive`、`interactive`、`non-interactive`

| 选项 | 默认 | 说明 |
|------|------|------|
| `--root <path>` | `""` | 路径前缀 |
| `--mode exact\|glob` | `exact` | 路径匹配模式 |
| `--timeout <ms>` | `5000` | 超时时间 |
| `--poll <ms>` | Agent 默认 | 轮询间隔 |

示例：

```bash
node bkcli.js wait-node MainPanel Btns1/mail active --timeout 8000
```

---

### run

直接发送原始命令（escape hatch）。

```
node bkcli.js run <Cmd> [argsJson]
```

示例：

```bash
node bkcli.js run Ping
node bkcli.js run DumpPanelTree '{"panel":"MainPanel","interactiveOnly":true,"maxDepth":3}'
```

---

### exec-shellcode

将 x64 shellcode 注入 BidKing 进程并执行，读取 scratch buffer 作为返回值。

Shellcode 通过 Windows x64 调用约定接收 scratch buffer 地址（RCX 寄存器），可将 JSON 字符串写入 `[RCX]` 作为输出。

```
node bkcli.js exec-shellcode <file.bin|file.hex> [选项]
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `--result-size <n>` | `4096` | scratch buffer 大小（字节） |
| `--timeout <ms>` | `5000` | 线程等待超时 |
| `--no-wait` | 关 | 不等待线程完成（fire-and-forget） |

文件格式：
- `.bin` — 原始二进制
- `.hex` — 十六进制文本（空格/换行分隔，大小写不限）

示例：

```bash
node bkcli.js exec-shellcode payload.bin
node bkcli.js exec-shellcode payload.hex --result-size 8192 --timeout 10000
node bkcli.js exec-shellcode trigger.bin --no-wait
```

示例输出：

```json
{"ok": true, "result": {"output": "{\"value\": 42}"}}
```

---

### exec-probe

将 C++ 源文件通过 WSL MinGW 编译为 DLL，注入进程，调用 `BKProbeEntry`，返回输出字符串。

```
node bkcli.js exec-probe <file.cpp> [选项]
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `--args <jsonString>` | `{}` | 传给 `BKProbeEntry` 的参数 JSON |
| `--keep` | 关 | 执行后保留临时 DLL（默认自动删除） |

示例：

```bash
node bkcli.js exec-probe probe.cpp
node bkcli.js exec-probe probe.cpp --args '{"panel":"MainPanel"}'
node bkcli.js exec-probe probe.cpp --keep
```

示例输出：

```json
{"ok": true, "result": {"output": "gold=12345 items=3"}}
```

#### 探针模板

每个 probe.cpp 包含 `probe_template.h`，该头文件提供：

- `BkIl2Cpp` 结构体，包含所有 IL2CPP 函数指针
- `bool BKProbeResolveIl2cpp(BkIl2Cpp* il)` — 从 `GameAssembly.dll` 解析 IL2CPP 函数地址
- `PROBE_RESULT(fmt, ...)` — snprintf 结果到输出 buffer 的宏

最小探针示例：

```cpp
#include "probe_template.h"

extern "C" __declspec(dllexport)
void BKProbeEntry(const char* argsJson, char* resultBuf, int resultSize) {
    BkIl2Cpp il = {};
    if (!BKProbeResolveIl2cpp(&il)) {
        PROBE_RESULT("il2cpp resolve failed");
        return;
    }
    // ... 在此读取游戏内存 ...
    PROBE_RESULT("result=%d", someValue);
}
```

编译工具链：`tools/inject/AutoOperation/BKProbeTemplate/build_probe.sh`（WSL MinGW x86_64）

---

## 错误参考

| 错误消息 | 原因 |
|----------|------|
| `pipe not available — run: node bkcli.js inject` | Agent 未注入，先运行 `inject` |
| `command timeout: <cmd>` | 命令超过默认 5 秒未响应 |
| `agent pipe not ready after 8000ms` | 注入后 8 秒内管道未就绪 |
| `LoadLibrary failed: 0x<hex>` | 探针 DLL 加载失败，检查路径和依赖 |
| `BKProbeEntry not exported` | DLL 未导出 `BKProbeEntry` 函数 |
| `compile failed` | WSL MinGW 编译出错，`detail` 字段含 gcc 错误信息 |
| `frame too large: N > 262144` | 命令参数或响应超过 256 KB 限制 |

---

## 技术细节

| 项目 | 值 |
|------|-----|
| 命名管道 | `\\.\pipe\BKAutoOp` |
| 帧格式 | `[uint32 LE 长度][UTF-8 JSON]` |
| 最大帧 | 262144 字节（256 KB） |
| 默认超时 | 5000 ms |
| 注入等待超时 | 8000 ms |
| shellcode scratch buffer 默认 | 4096 字节 |
| 探针 result buffer | 65536 字节 |
