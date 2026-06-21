# BidKing 技能解析支持矩阵

最后更新：2026-06-02

本文记录 BKToolBox 当前对 BidKing 对局技能信息的解析、展示和待支持范围。协议字段总表见 [BIDKING_REALTIME_PROTOCOL_SCHEMA.md](./BIDKING_REALTIME_PROTOCOL_SCHEMA.md)，逆向过程见 [BIDKING_GAME_LOG_REVERSE_ENGINEERING.md](./BIDKING_GAME_LOG_REVERSE_ENGINEERING.md)。

## 数据来源

当前实时监控走 TCP 明文抓包解析，核心入口是 `scripts/parse-bidking-tcp-pcap.mjs`：

| msgId | 当前归类 | 解析内容 |
|---:|---|---|
| 33 | `game_start` | `GameData` |
| 37 | `game_next_round` | 累计 `GameData`，包含英雄/地图/道具技能日志 |
| 39 | `game_use_item` | repeated `GameSkillData` |
| 45 | `game_over` | 最终 `GameData`，包含累计技能日志 |
| 125/127/129/131/157 | `sim_game_*` | 模拟对局 `GameData` |
| 185/191/207 | `room_game_*` | 房间对局 `GameData` |
| 187 | `room_game_use_item` | repeated `GameSkillData` |
| 229 | `now_game_data` | 当前 `GameData` |
| 291 | `test_game_cast_skill` | 测试技能/技能日志 |

`.playback` 解析使用同一套 `GameSkillData` / `BoxInfoData` 字段解析逻辑，但 `.playback` 通常不是对局中实时写入，实时能力以 TCP 下行为准。

## 已解析字段

### `GameSkillData`

| 字段 | 当前属性 | 支持状态 | 展示/用途 |
|---:|---|---|---|
| 1 | `skillCid` | 已解析 | 技能 id |
| 2 | `heroCid` | 已解析 | 英雄 id |
| 3 | `mapCid` | 已解析 | 地图 id |
| 4 | `itemCid` | 已解析 | 道具 id，能结合表映射道具名 |
| 5 | `castTime` | 已解析 | 释放时间 |
| 6 | `castRound` | 已解析 | 释放回合 |
| 7 | `hitItemIndex` | 已解析 | 命中件数/序号，语义随技能变化，当前仅原样输出 |
| 8 | `hitBoxList` | 已解析 | 命中格子、轮廓、品质、完整藏品信息的主要来源 |
| 9 | `allHitItemAvgPrice` | 已解析/已纳入实时事件 | 平均藏品价格 |
| 10 | `allHitBoxAvgPrice` | 已解析/已纳入实时事件 | 平均格子价格 |
| 11 | `allHitItemAvgBoxIndex` | 已解析/已纳入实时事件 | 平均格数，例如 `303/100112 优品均格` |
| 12 | `hitItemTotalPrice` | 已解析/已纳入实时事件 | 命中总价 |
| 13 | `uid` | 已解析 | 事件去重 key |
| 14 | `totalHitBoxIndex` | 已解析/已纳入实时事件 | 命中总格数 |
| 15 | `hitItemTypeList` | 已解析/已纳入实时事件 | 命中/揭露类型列表 |
| 16 | `hitItemQuilityList` | 已解析/已纳入实时事件 | 命中/揭露品质列表 |

### `BoxInfoData`

| 字段 | 当前属性 | 支持状态 | 展示/用途 |
|---:|---|---|---|
| 1 | `boxId` | 已解析 | 协议内 0-based 格子 id，UI 显示为 1-based |
| 2 | `itemUid` | 已解析 | 局内藏品实例 uid |
| 3 | `itemCid` | 已解析 | 完整藏品信息，可映射藏品名 |
| 4 | `itemSlotType` | 已解析 | 轮廓尺寸，按两位数解析为宽 x 高，例如 `22` => `2x2` |
| 5 | `itemType` | 已解析 | 藏品类型列表，可映射类型名 |
| 6 | `itemQuility` | 已解析 | 藏品品质，可映射白/绿/蓝/紫/金/红 |
| 7 | `itemPrice` | 已解析 | 藏品价格 |
| 8 | `itemBoxIndex` | 已解析 | 藏品占用格数 |

## 当前已支持的技能结果形态

当前不是按固定 skillId 白名单支持，而是按 `GameSkillData` 携带的结果字段支持。

| 结果形态 | 判定字段 | Monitor 页面 | Ethan 页面 |
|---|---|---|---|
| 完整藏品揭露 | `hitBoxList[].itemCid` / `itemPrice` / `itemBoxIndex` | 显示藏品、品质、尺寸、价格 | 暂不直接填入矩阵完整藏品 |
| 轮廓揭露 | `skillCid=1002081` + `hitBoxList[].boxId` + `itemSlotType` | 作为普通技能事件显示 | 在 43x10 矩阵绘制轮廓 |
| 品质揭露 | `hitBoxList[].itemQuility` / `itemQuilityName` | 显示品质和格子 | 保存为 `qualityCells`，与轮廓重叠时推导轮廓品质 |
| 类型揭露 | `hitItemTypeList` / `hitItemTypeNames` | 可过滤/展示 | 显示为“揭露类型” |
| 总格数 | `totalHitBoxIndex` | 显示“命中格数” | 对 `普品/良品/优品/极品/珍品扫描` 自动回填对应品质总格数 |
| 总价 | `hitItemTotalPrice` | 显示“命中价格” | 暂不参与矩阵推理 |
| 平均藏品价格 | `allHitItemAvgPrice` | 显示聚合指标 | 对已确认品质的平均价值类技能自动回填对应品质平均价格 |
| 平均格子价格 | `allHitBoxAvgPrice` | 显示聚合指标 | 暂不参与估算输入自动填充 |
| 平均格数 | `allHitItemAvgBoxIndex` | 显示聚合指标 | 对 `普品/良品/优品/极品/珍品均格` 自动回填对应品质平均格数 |

## 归一化 facts 层

实时 Monitor 在保留 raw event 的同时，会把技能结果转换成稳定 facts。Ethan、Monitor 调试面板和后续页面应优先消费 `facts` / `state`，避免在页面组件中重复解析 skill id、道具名和 raw 协议字段。

| fact type | 主要字段 | 含义 |
|---|---|---|
| `group.totalCellsKnown` | `group`、`value` | 某品质组总占用格数已知，对应扫描类技能或地图聚合技能 |
| `group.averageCellsKnown` | `group`、`value` | 某品质组平均格数已知，对应均格类技能 |
| `group.averagePriceKnown` | `group`、`value` | 某品质组平均藏品价格已知，对应品质平均价值类技能 |
| `item.outlineRevealed` | `cells`、`boxId`、`width`、`height`、`quality` | 某个藏品轮廓被揭露，`cells` 使用 UI 侧 1-based 格子编号 |
| `item.qualityCellsRevealed` | `cells`、`quality` | 某些格子的品质被揭露，可与轮廓交集推导轮廓品质 |
| `item.exactRevealed` | `itemCid`、`itemName`、`itemPrice`、`cells`、`quality` | 具体藏品被揭露，包含名称、价格和占用格子 |
| `type.revealed` | `itemTypes` | 对局中出现或被技能揭露的藏品类型列表 |

`state.groups` 当前按 `wg`、`blue`、`purple`、`orange`、`red` 聚合 `totalCells`、`averageCells`、`averagePrice`。`state.outlines`、`state.qualityCells`、`state.exactItems` 和 `state.revealedTypes` 会跨事件累计，并按 fact key 去重。

## 已实测/已覆盖的代表技能

| skill / item | 名称或来源 | 当前支持情况 | 备注 |
|---|---|---|---|
| `1002081` | 英雄轮廓揭露 | 已支持 | Ethan 矩阵绘制轮廓；同时显示 `hitItemTypeList` 揭露类型 |
| `1002082` / `1002083` / `1002084` | 英雄轮廓类结果 | 可解析为技能事件 | 当前 Ethan 仅把 `1002081` 作为矩阵轮廓来源，其他 id 暂不画入矩阵 |
| `1001031-1001034` | 艾莎 | 可解析为英雄技能事件 | TCP 实测为“轮廓 + 品质”形态：`group=hero`、`heroCid=103`，`hitBoxList[]` 含 `boxId/itemUid/itemSlotType/itemQuility`，不含 `itemCid/itemPrice/itemBoxIndex` |
| `200050` | 地图技能样本 | 可解析 | 实测出现完整藏品/均值类信息 |
| `200001` | 地图技能样本 | 已支持 | 实测出现完整紫色品质轮廓；Ethan 会按轮廓面积回填紫色总格数 |
| `200010` | 地图技能样本 | 已支持 | 实测出现紫色品质总占用格子数；Ethan 使用 `totalHitBoxIndex` 回填紫色总格数 |
| `200013` | 地图技能样本 | 已支持 | 实测出现紫色品质平均格数；Ethan 使用 `allHitItemAvgBoxIndex` 回填紫色平均格数 |
| `200036-200038` | 地图技能样本 | 已支持 | 实测出现紫/金/红品质平均价值；Ethan 使用 `allHitItemAvgPrice` 回填对应品质平均价格 |
| `603 / 100130` | 随机抽检（4）样本 | 已支持 | `.playback` 样本可解析完整藏品、均价、总价、总格数、类型、品质 |
| `702 / 100136` | 品质揭露样本 | 已支持 | Monitor 显示品质；Ethan 可与轮廓交集推导品质 |
| `303 / 100112` | 优品均格 | 已支持 | 实测字段为 `allHitItemAvgBoxIndex=2.5`；已修复无 hitBox 时被过滤的问题 |
| `201-205 / 100104-100108` | 普品/良品/优品/极品/珍品扫描 | 已支持 | Ethan 根据技能名或 id 映射品质，使用 `totalHitBoxIndex` 回填 `白绿/蓝/紫/金/红` 总格数 |
| `301-305 / 100110-100114` | 普品/良品/优品/极品/珍品均格 | 已支持 | Ethan 根据技能名或 id 映射品质，使用 `allHitItemAvgBoxIndex` 回填 `白绿/蓝/紫/金/红` 平均格数 |

### 艾莎 TCP 实测样本

样本文件：

- pcap：`tmp/elsa-live-20260602-211701.pcapng`
- 事件 JSON：`tmp/elsa-live.events.json`
- 对局：`gameUid=2205:1295018822725372`

表数据：

- `Hero.txt`：`heroCid=103` 是艾莎，技能列表为 `[1001034,1001033,1001032,1001031]`。
- `Skill.txt`：`1001031-1001034` 均为艾莎技能，按品质揭露所有对应品质道具的轮廓和品质。

这局解析到的艾莎事件：

| msgId | sourceKind | round | skillCid | quality | hitBoxCount | boxId |
|---:|---|---:|---:|---|---:|---|
| 33 | `game_start` | - | `1001034` | 白 | 5 | `24,16,17,5,26` |
| 37 | `game_next_round` | 1 | `1001034` | 白 | 5 | `16,17,5,26,24` |
| 37 | `game_next_round` | 1 | `1001033` | 绿 | 9 | `20,15,8,6,0,27,25,1,2` |
| 45 | `game_over` | 1 | `1001034` | 白 | 5 | `5,26,24,16,17` |
| 45 | `game_over` | 1 | `1001033` | 绿 | 9 | `6,27,25,15,1,2,0,20,8` |

代表性事件结构：

```json
{
  "type": "skill",
  "key": "skill:1295018822726046",
  "msgId": 37,
  "sourceKind": "game_next_round",
  "gameUid": "2205:1295018822725372",
  "mapId": 2205,
  "round": 1,
  "group": "hero",
  "skill": {
    "skillCid": 1001034,
    "heroCid": 103,
    "castTime": "1780406294471",
    "uid": "1295018822726046",
    "hitBoxCount": 5,
    "fullHitBoxCount": 0,
    "qualityOnlyHitBoxCount": 5,
    "hitBoxList": [
      {
        "boxId": 16,
        "itemUid": "1295018822725931",
        "itemSlotType": 11,
        "itemQuility": 1,
        "itemTypeNames": [],
        "itemQuilityName": "白"
      }
    ]
  }
}
```

结论：

- 艾莎技能是 `qualityOnly` 形态，`fullHitBoxCount=0`。
- `hitBoxList[]` 只提供格子、局内藏品 uid、轮廓编码和品质；没有 `itemCid`、`itemName`、`itemPrice`、`itemBoxIndex`。
- 同一 `skill.uid` 会随 `msgId=33/37/45` 多次出现，且 `hitBoxList` 顺序可能变化。消费时应按 `gameUid + skill.uid` 合并/去重，并把 `boxId` 集合作为稳定内容。

## Ethan 矩阵推理规则

Ethan 当前仅把 `1002081` 事件中的 `hitBoxList[].itemSlotType` 作为“轮廓”来源。品质来源不限制 skillId，只要事件里有 `hitBoxList[].boxId` 和 `itemQuility` / `itemQuilityName` 就会进入 `qualityCells`。

推理规则：

1. 品质先到、轮廓后到：轮廓覆盖格子与已知品质格子有交集时，给轮廓标记品质。
2. 轮廓先到、品质后到：新增品质格子后，反向扫描已有轮廓并更新品质。
3. 交集内只有一种品质：`qualityStatus=confirmed`。
4. 交集内有多种品质：`qualityStatus=conflict`，UI 显示如 `紫/金`。
5. 没有交集：轮廓保持未知品质。

估值规则：

- 当某个品质组存在已知轮廓或精确藏品，并且已知格数不超过该品质总格数时，按以下公式计算：
  `品质价值 = (该品质总格数 - 已知轮廓格数 - 精确藏品格数) * 单格期望 + 已知轮廓价值期望 + 精确藏品价值`
- 具体藏品已揭露价格时计入“精确藏品价值”；否则使用“品质 + 轮廓尺寸”候选藏品价格中位数计入“已知轮廓价值期望”。
- 若已知轮廓/精确藏品格数超过输入总格数，则不启用该覆盖公式，避免得到负剩余格数。

## 待支持/待验证

| 项目 | 当前状态 | 建议方案 |
|---|---|---|
| 非 `1002081` 轮廓类英雄技能画入 Ethan | 可解析但未作为矩阵来源 | 对 `1002082/1002083/1002084` 等样本确认 `itemSlotType` 语义后，扩展轮廓 skill 白名单或改为字段驱动 |
| 品质列表 `hitItemQuilityList` 与具体格子的关联 | 已解析但没有格子级映射 | 若协议只给列表、不含 `boxId`，不能直接推导矩阵位置；需要更多样本确认顺序语义 |
| 类型列表 `hitItemTypeList` 与具体轮廓/格子的关联 | 已解析但只做整体展示 | 若需要给单个轮廓标类型，需要确认列表与 `hitBoxList` 的对应规则 |
| `hitItemIndex` 语义 | 已解析但仅原样输出 | 需要按技能样本对照 UI 文案，区分“件数”“序号”“候选数量”等语义 |
| 库存数量类 `400-405` | 协议字段可承载，实测不足 | 预计对应 `hitItemIndex` 或其他标量字段；需要实局样本确认输出字段 |
| 估价/总价值类 `500-505` | 协议字段可承载，实测不足 | 预计对应 `hitItemTotalPrice` 或平均价字段；需要实局样本确认 |
| 完整藏品自动填入 Ethan 矩阵 | Monitor 已显示完整藏品，Ethan 未使用 | 可按 `itemCid + itemSlotType/尺寸 + boxId` 在矩阵内标出名称/价格；需先决定 UI 密度 |
| 聚合总价类自动回填 Ethan 表单 | Monitor 已显示总价，Ethan 未自动回填 | 均格、扫描和品质平均价值已回填；总价类需确认对应 Ethan 输入语义后再接入 |
| 未识别的 `GameSkillData` 新字段 | 当前 parser 会跳过未知字段 | 对新样本保存原始 pcap/events，必要时增加 unknown field dump 以定位字段号和 wire type |

## 维护约定

- 新增支持时优先按字段形态扩展，不要只针对单个 skillId 写死逻辑。
- 实时事件去重必须按 `gameUid + event.key` 分域；不同对局允许复用相同 `skill.uid` / `event.key`。
- Ethan 收到首个 `gameUid` 时只建立当前对局基线；后续检测到 `gameUid` 变化时，会清空上一局所有 Ethan 输入和估算结果，包括用户手填值，等待新局事件重新回填。
- 每个新形态至少补一个 parser 测试；涉及 Ethan 矩阵时补 `monitor-grid` 状态测试和 `App` 渲染测试。
- 实测到新技能后，在“已实测/已覆盖的代表技能”补一行，并标明是 TCP 实时样本还是 `.playback` 样本。
