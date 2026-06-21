# BidKing 对局日志逆向记录

## 结论

- BidKing 是 Unity 游戏，`Archive/BidKing/BidKing_Data/app.info` 中记录的公司名和产品名为 `laolin` / `BidKing`。
- Windows 运行数据目录是 Unity `Application.persistentDataPath` 对应路径：
  - `%USERPROFILE%\AppData\LocalLow\laolin\BidKing`
- 已确认可用于游戏机维护/监控的常用 SSH 目标为 `admin@192.168.5.8` 和 `Melo@192.168.5.66`
- 不应只依赖 `.playback` 判断能否实时拿到技能信息。客户端在对局中会先通过 TCP 收到服务端 protobuf 消息，`.playback` 只是对局结束链路里的结构化回放保存结果。
- 对局回放/日志数据当前确认主要落盘为 NTFS Alternate Data Stream（ADS）：
  - `%USERPROFILE%\AppData\LocalLow\laolin\BidKing\<mapId>:<gameUidTail>.playback`
  - 例：`C:\Users\Melo\AppData\LocalLow\laolin\BidKing\4405:1178745290411251.playback`
  - 这里 `4405` 是一个数字目录名，`:1178745290411251.playback` 是挂在该目录上的 ADS 流名，不是普通文件名。
- 旧逆向代码中还能看到普通文件写入形态：
  - `%USERPROFILE%\AppData\LocalLow\laolin\BidKing\<gameUid>.playback`
  - 实机 2026-05-22 监控中没有看到普通 `*.playback` 新增，看到的是目录 ADS。
- Unity 标准日志通常在：
  - `%USERPROFILE%\AppData\LocalLow\laolin\BidKing\Player.log`
- `.playback` 是当前最关键的结构化对局数据文件；它不是纯文本日志，而是自定义二进制容器，内部主要载荷是 protobuf 消息。

## 写入位置

在解密后的 `Scripts.dll.bytes` 中定位到普通 `.playback` 写入链路：

- `Battle_Handler.S2C_OnGameOver(S2C_45_game_over_notify data)`
- 调用：
  - `new GamePlayBackData(data.GameData, data.UserSkillList, data.WinUserUid).Save()`
- 保存逻辑：
  - `File.WriteAllBytes(Application.persistentDataPath + "/" + gameUid + ".playback", bytes)`

这条链路说明普通 `.playback` 写入点发生在服务端推送对局结束通知之后。实机 ETW/WPR 监控进一步确认，新版本运行时实际访问的是数字目录上的 `.playback` ADS；直接读取 ADS 内容后，其二进制布局与 `GamePlayBackData` 解析器一致。

已确认样例：

| ADS 路径 | 解析摘要 |
|---|---|
| `...\BidKing\4401:1178745288490605.playback` | `mapId=4401`，`round=3`，胜者 `720386274725658`，本机玩家英雄 `208`，出价 `344444,288888,245555,188888` |
| `...\BidKing\4405:1178745290411251.playback` | `mapId=4405`，`round=3`，胜者 `893421919811036`，本机玩家英雄 `208`，出价 `344444,366667,455555,543333` |

若游戏在回合中也有增量落盘，需要继续查找是否存在其它写入 `GameData` / `GamePlayBackData` / `.playback` 的路径，或继续监控 ADS 内容是否在对局未结束时变化。

## 实时来源

`.playback` 不是实时技能信息的唯一来源。解密 `StreamingAssets/dll/Scripts.dll.bytes` 后可确认，客户端实时处理链路如下：

- `Connector.ReceiveCallback` 从 TCP stream 读取数据。
- `Connector.TryToReadMsg` 按包头长度切分完整消息。
- `MsgHander.OnMsg(byte[] bytes)` 解析消息头，按 `msgId` 选择 `Google.Protobuf.MessageParser.ParseFrom(payload)`。
- `MsgHander.OnHander` 分发通知类消息到主线程 handler。
- `Battle_Handler` 接收对局相关消息，并在 `DealSkillData(GameSkillData skillData)` 中处理技能命中结果。

已确认实时相关 S2C 消息：

| msgId | protobuf 类型 | 实时价值 |
|---:|---|---|
| 33 | `S2C_33_game_start_notify` | 对局开始，带 `GameData` |
| 37 | `S2C_37_game_next_round_notify` | 普通对局下一回合通知，带 `GameData`，包含回合技能日志 |
| 39 | `S2C_39_game_use_item` | 使用道具回包，带 `itemSkillLog` |
| 45 | `S2C_45_game_over_notify` | 普通对局结束，带最终 `GameData` 和 `userSkillList`，随后会保存 `.playback` |
| 185 | `S2C_185_room_game_start_notify` | 房间对局开始，带 `GameData` |
| 191 | `S2C_191_room_game_next_round_notify` | 房间对局下一回合通知，带 `GameData` |
| 207 | `S2C_207_room_game_over_notify` | 房间对局结束，带最终 `GameData` |
| 229 | `S2C_229_get_now_game_data` | 查询当前对局数据回包，带 `GameData` |

实机连接中已观察到 BidKing 进程保持 TCP 连接：

- `8.133.195.27:10000`
- `43.110.40.169:8000`

这些连接是实时抓取的优先目标。

## TCP 包格式

`Packet` 和 `MsgHander.OnMsg` 显示整包使用 big-endian int32：

| 偏移 | 长度 | 含义 |
|---:|---:|---|
| 0 | 4 | `packetLength`，big-endian，包含包头和 payload |
| 4 | 4 | 服务端包内字段；当前客户端读取后未使用 |
| 8 | 4 | `clientMsgID`，big-endian |
| 12 | 4 | `msgId`，big-endian |
| 16 | `packetLength - 16` | protobuf payload |

客户端发送包头略短：`Packet` 构造器写入 `packetLength`、`clientMsgID`、`msgId` 和 payload，`packetLength = 12 + payloadLength`。实时技能解析应优先针对服务端下行包做 TCP 流重组，然后按 `msgId` 解析 payload。

## 相关日志文本

二进制保存逻辑中存在以下日志文本：

- 保存成功：`二进制保存成功: {path}, 大小: {bytes}字节`
- 保存失败：`二进制保存失败`
- 加载成功/失败也有对应文本

注意：保存成功日志走的是游戏自定义 `Log.Info`。已观察到默认日志开关主要输出 Error/Exception，因此这些成功日志不一定会出现在 `Player.log`。

`DealSkillData(GameSkillData skillData)` 中还存在实时技能日志：

- `触发技能：{0}({1})  命中目标：{2}`
- `触发技能：{0}({1})  命中目标2：{2}`

这些日志走 `Log.Warn`。`NotHotUpdate.dll.bytes` 解密后可见 `Log.flags` 静态初始化为 `12`，即只启用 Error 和 Exception；Info 和 Warn 默认关闭，所以正常情况下 `Player.log` 看不到这些实时技能日志。若把 Warn 打开，理论上可以通过 `Player.log` 实时看到技能触发摘要，但这需要修改游戏热更 DLL 或找到运行期开关，属于侵入式方案。

## 热更 DLL 加密

`Scripts.dll.bytes` / `NotHotUpdate.dll.bytes` 是 XOR 加密的 .NET DLL。文件头与标准 `MZ` 头对齐后可得到重复 key：

```text
72 79 72 73
```

ASCII 为 `ryrs`。按该 key XOR 后可用 .NET 元数据工具读取：

- `Scripts.dll` 包含 `Battle_Handler`、`Connector`、`MsgHander`、`Protodata.*`。
- `NotHotUpdate.dll` 包含 `Log`、`CryptoUtils`、启动加载工具等。

`NotHotUpdate.CryptoUtils.Xor` 也验证了该类资源使用重复 key XOR 的加解密方式。

## `.playback` 文件格式

普通文件和 ADS 内容的整体布局一致，整数均为 little-endian：

| 顺序 | 类型 | 含义 |
|---:|---|---|
| 1 | int32 | `Protodata.GameData` protobuf 字节长度 |
| 2 | bytes | `Protodata.GameData` protobuf 字节 |
| 3 | int32 | `GameUserSkillLogData` 条目数量 |
| 4 | repeated | 每条先写 int32 长度，再写 `Protodata.GameUserSkillLogData` protobuf 字节 |
| 5 | int64 | `winnerUid` |

## 已确认 protobuf 字段

### `Protodata.GameData`

| 字段号 | 字段 | 类型/含义 |
|---:|---|---|
| 1 | `uid` | string，对局 uid |
| 2 | `mapId` | int32，地图 id |
| 3 | `round` | int32，当前/结束回合 |
| 5 | `userLog` | repeated `GameUserData` |
| 6 | `heroSkillLog` | repeated `GameSkillData` |
| 7 | `mapSkillLog` | repeated `GameSkillData` |
| 8 | `itemSkillLog` | repeated `GameSkillData` |
| 9 | `nextRoundTime` | int64 |
| 20 | `serverTime` | int64 |

### `Protodata.GameUserData`

| 字段号 | 字段 | 类型/含义 |
|---:|---|---|
| 1 | `userUid` | int64，玩家 uid |
| 2 | `name` | string，玩家名 |
| 3 | `heroCid` | int32，英雄 cid |
| 4 | `useItemLog` | repeated `GameUseItemOrPriceData` |
| 5 | `priceLog` | repeated `GameUseItemOrPriceData`，出价记录 |
| 6 | `isStandDown` | bool |
| 7 | `isQuit` | bool |
| 9 | `heroSkinCid` | int32 |

### `Protodata.GameUseItemOrPriceData`

| 字段号 | 字段 | 类型/含义 |
|---:|---|---|
| 1 | `round` | int32，回合 |
| 2 | `itemCidOrPrice` | int32，道具 cid 或出价 |

在项目监控脚本的摘要输出中，字段 2 被统一映射为 `value`。

### `Protodata.GameSkillData`

| 字段号 | 字段 | 类型/含义 |
|---:|---|---|
| 1 | `skillCid` | int32 |
| 2 | `heroCid` | int32 |
| 3 | `mapCid` | int32 |
| 4 | `itemCid` | int32 |
| 5 | `castTime` | int64 |
| 6 | `castRound` | int32 |
| 7 | `hitItemIndex` | int32 |
| 8 | `hitBoxList` | repeated `BoxInfoData`，技能命中的格子/藏品信息 |
| 9 | `allHitItemAvgPrice` | float32，命中藏品平均价格 |
| 10 | `allHitBoxAvgPrice` | float32，命中格均价格 |
| 11 | `allHitItemAvgBoxIndex` | float32，命中藏品平均格数 |
| 12 | `hitItemTotalPrice` | int32 |
| 13 | `uid` | int64/string，技能日志 uid |
| 14 | `totalHitBoxIndex` | int32，命中总格数 |
| 15 | `hitItemTypeList` | repeated int32，命中的藏品类型 |
| 16 | `hitItemQuilityList` | repeated int32，命中的藏品品质 |

### `Protodata.BoxInfoData`

| 字段号 | 字段 | 类型/含义 |
|---:|---|---|
| 1 | `boxId` | int32，格子/盒子 id |
| 2 | `itemUid` | int64/string，局内藏品实例 uid |
| 3 | `itemCid` | int32，藏品配置 id |
| 4 | `itemSlotType` | int32 |
| 5 | `itemType` | repeated int32，藏品类型 |
| 6 | `itemQuility` | int32，藏品品质，游戏字段名拼写为 `Quility` |
| 7 | `itemPrice` | int32，藏品价格 |
| 8 | `itemBoxIndex` | int32，藏品占用格数 |

`GameSkillData.hitBoxList` 是目前解析技能揭露结果最关键的数据源。以实机样本 `4403:961935884974190` 为例，道具 `100130 随机抽检（4）` 在第 4 回合的技能日志包含：

| 字段 | 值 |
|---|---|
| `allHitItemAvgPrice` | `4238.75` |
| `allHitBoxAvgPrice` | `2825.8333` |
| `allHitItemAvgBoxIndex` | `1.5` |
| `hitItemTotalPrice` | `16955` |
| `totalHitBoxIndex` | `6` |
| `hitBoxList` | `C4吸塑炸药`、`氙气大灯`、`车载充气泵`、`高浓缩磁暴瘫痪手雷` |

监控脚本会结合 `StreamingAssets/Tables/Item.txt` 和 `Item_Type.txt` 把 `itemCid` / `itemType` / `itemQuility` 映射为藏品名、类型名、品质名、价格和尺寸。该映射只用于输出展示，不改变 `.playback` 原始解析结果。

## 当前监控实现与脚本

已实现脚本：

- `scripts/watch-bidking-game-log.mjs`
- `scripts/watch-bidking-game-log.ps1`
- `scripts/parse-bidking-tcp-pcap.mjs`

当前桌面实时监控主链路并不只依赖 PowerShell 包装脚本。仓库中的实际运行实现是：

- `lib/bidking-live-monitor.js`
- `lib/capture-driver.js`
- `scripts/prepare-dumpcap-runtime.mjs`

当前桌面 Monitor 默认抓包后端是 `auto`：

- 优先使用打包内置或系统可用的 `dumpcap.exe`
- 若 `dumpcap` 缺失，则直接报错并提示先准备 `tools/WiresharkPortable64/`

PowerShell 用法：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/watch-bidking-game-log.ps1 -GameRoot "D:\SteamLibrary\steamapps\common\BidKing"
```

Node 用法：

```bash
npm run watch:game-log -- --game-root "D:\SteamLibrary\steamapps\common\BidKing"
```

可选参数：

- `--game-root <path>` / `-GameRoot <path>`：游戏安装根目录，也可以是包含 `app.info` 的 `BidKing_Data` 目录。
- `--data-dir <path>` / `-DataDir <path>`：手动覆盖 Unity 运行数据目录。
- `--interval <ms>` / `-IntervalMs <ms>`：轮询间隔，默认 1000ms。
- `--once` / `-Once`：只读取当前数据一次后退出。
- `--ads` / `-Ads`：启用 Windows NTFS ADS `.playback` 监控。
- `--no-ads` / `-NoAds`：禁用 Windows NTFS ADS `.playback` 监控。
- `--no-player-log` / `-NoPlayerLog`：不输出 `Player.log` 新增行，只输出结构化 `.playback` 摘要，避免 Unity 调用栈噪音。

当前脚本行为：

- 根据 `app.info` 推导 Windows `LocalLow` 数据目录。
- 监控 `Player.log` 的新增行并实时输出。
- 监控 `*.playback` 文件的新建或修改。
- Windows 下默认额外枚举数字目录上的 `.playback` ADS，新建或签名变化时直接读取 `目录:流名` 并解析。
- 首次启动时只输出最新一份 `.playback`，避免历史文件刷屏。
- 后续轮询中只输出新建或内容变化的普通 `.playback` 文件 / ADS。
- 解析并输出对局 uid、地图、回合、胜者 uid、玩家出价/道具记录和技能日志摘要。
- 技能日志会解析 `GameSkillData` 的聚合字段、命中类型/品质列表和 `hitBoxList`；能映射到游戏表的 cid 会输出中文道具名、品质、类型、价格、尺寸和格数。

### TCP pcap 解析脚本

`scripts/parse-bidking-tcp-pcap.mjs` 用于解析 BidKing TCP 抓包产物。当前桌面链路直接消费 `dumpcap` 写出的 pcapng；解析器本身仍兼容历史 `pktmon etl2pcap` 产物：

```bash
node scripts/parse-bidking-tcp-pcap.mjs /tmp/bidking-capture/tcp-live-20260523-1558.pcapng \
  --tables-dir Archive/BidKing/BidKing_Data/StreamingAssets/Tables
```

脚本行为：

- 读取 pcapng Enhanced Packet Block。
- 在每个包前 80 字节内扫描合法 IPv4 头，兼容 `pktmon` 在入站/出站帧前附加的元数据前缀。
- 过滤 `:10000` 游戏 TCP 流，按上下行分别用 TCP sequence 重组 payload。
- 下行按 16 字节 BidKing 包头拆帧，上行按 12 字节包头拆帧。
- 输出上下行 `msgId` 分布，并解析已知下行 `33/37/45/185/191/207/229` 中的 `GameData`。
- 对 `39` 会尝试解析 `GameSkillData`，用于继续验证道具技能实时回包。
- `--events` 只输出去重后的实时技能事件；`--event-json` 输出同一事件结构的 JSON，供监控脚本消费。
- `--output <path>` 可把 JSON/text 直接写入 UTF-8 文件，避免 Windows PowerShell 捕获 Node stdout 时把中文 JSON 解码坏。
- 在 live monitor 场景下，解析器还会配合同输出目录下的 stream-state 文件，跨批次拼接 TCP 半包尾部，减少抓包文件边界导致的事件延迟。

完整的对局/技能 protobuf 字段表已单独整理：

- `docs/BIDKING_REALTIME_PROTOCOL_SCHEMA.md`
- `docs/bidking-realtime-protocol-schema.json`

2026-05-23 实机样本 `tcp-live-20260523-1558.pcapng`：

- `packets=730`，游戏 TCP payload 段 `512`。
- 下行 `segments=411`，`frames=141`，`gaps=0`。
- 上行 `segments=101`，`frames=101`，`gaps=0`。
- 已解析 `msgId=33` 对局开始和 `msgId=45` 对局结束：
  - `gameUid=2101:1178745395783897`
  - 玩家 `脚踩西瓜皮` / `melo`
  - `melo` 胜出，最终出价 `66667`
- 该样本未出现 `37/39/191`，所以没有观察到实时 `hitBoxList` 藏品揭露数据。

### Desktop 实时监控

当前桌面端只通过 `lib/bidking-live-monitor.js` 启动 `dumpcap` 持续抓包：

1. `scripts/prepare-dumpcap-runtime.mjs` 从本地 `tools/WiresharkPortable64/` 刷新 `dumpcap.exe`、顶层 DLL 和可选 `npcap-*.exe` 到 `build/runtime-capture/`
2. Electron 打包时把这些文件放进 `runtime/tools/{dumpcap,npcap}/`
3. Monitor 启动后调用 `dumpcap -D` 自动选网卡，并以 ring buffer 形式持续写出 pcapng
4. `scripts/parse-bidking-tcp-pcap.mjs --event-json` 增量解析完成的 capture 文件，按事件 key 去重并回灌 UI

注意：

- 桌面 Monitor 不再回退到 `pktmon`
- 若 `dumpcap` 缺失或 Npcap/WinPcap 不可用，Monitor 会直接报错并要求先准备抓包运行时

2026-05-23 实机样本 `tcp-live-20260523-162640.pcapng` 已确认实时路径成立：

- `packets=196`，`drops=0`。
- 下行 `frames=59`，`gaps=0`。
- 观察到 `33:1`、`37:2`、`39:6`、`45:1`。
- `37/39` 可在对局中拿到技能数据；其中部分技能携带完整 `itemCid/price/size`，部分技能只携带品质、格子数或 box id。

## 已知限制

- 当前确认的普通 `.playback` 保存点在对局结束时触发；ADS 是否在回合中增量更新，需要继续用监控脚本观察实局。
- 实时 TCP 路径已确认存在；`37/39` 已能在实局中解析技能数据，但并非所有技能都会下发完整藏品 `itemCid/price/size`。
- 当前桌面 Monitor 只走 `dumpcap` 链路；若要复现现状，应优先参考 `lib/bidking-live-monitor.js` 与 `scripts/prepare-dumpcap-runtime.mjs`。
- ADS 枚举依赖 Windows Win32 API `FindFirstStreamW` / `FindNextStreamW`；PowerShell `Get-Item -Stream *` 对目录 ADS 不稳定，不能作为唯一判断依据。
- `Player.log` 中不一定包含保存成功的 Info 日志，取决于游戏自定义日志开关。
- `.playback` 中还有未映射字段，当前优先解析对局、玩家记录和技能揭露相关字段。
- int64 uid 在脚本中以字符串输出，避免 JavaScript number 精度损失。
- `dumpcap` 路径需要可用的 Npcap/WinPcap 驱动；当前桌面实现已提供 bundled `dumpcap` + Npcap 安装器检测，但驱动本身仍依赖用户环境。
