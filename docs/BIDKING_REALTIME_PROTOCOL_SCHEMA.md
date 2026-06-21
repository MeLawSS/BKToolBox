# BidKing Realtime Protocol Schema

本文件记录从 `Archive/BidKing/BidKing_Data/StreamingAssets/dll/Scripts.dll.bytes` 逆向出的对局/技能 protobuf schema。DLL 使用 XOR key `ryrs` 解密，字段表来自解密后 .NET assembly 的 protobuf 生成类型。

机器可读版本见 `docs/bidking-realtime-protocol-schema.json`。

## 传输层

服务端下行包头为 16 字节，payload 是 protobuf：

| offset | type | 含义 |
|---:|---|---|
| 0 | int32 BE | packetLength，包含包头和 payload |
| 4 | int32 BE | 服务端包内字段，客户端读取后未使用 |
| 8 | int32 BE | clientMsgID |
| 12 | int32 BE | msgId |
| 16 | bytes | protobuf payload |

客户端上行包头为 12 字节：`packetLength`、`clientMsgID`、`msgId`、payload。

## 关键 S2C 消息

| msgId | protobuf 类型 | 对局/技能含义 |
|---:|---|---|
| 33 | `S2C_33_game_start_notify` | 普通对局开始，字段 1 是 `GameData` |
| 37 | `S2C_37_game_next_round_notify` | 普通对局下一回合，字段 1 是累计 `GameData` |
| 39 | `S2C_39_game_use_item` | 普通对局道具/技能回包，字段 2 是 repeated `GameSkillData` |
| 45 | `S2C_45_game_over_notify` | 普通对局结束，字段 1 胜者，字段 2 最终 `GameData`，字段 6 用户技能日志 |
| 119 | `S2C_119_game_user_bid_price_notify` | 普通对局玩家出价通知，只带 `userUid` 和 `gameUid` |
| 125 | `S2C_125_create_sim_game` | 模拟对局创建，字段 2 是 `GameData` |
| 127 | `S2C_127_sim_game_bid_price` | 模拟对局出价，字段 4 可能是下一回合 `GameData` |
| 129 | `S2C_129_sim_game_use_item` | 模拟对局道具使用，字段 2 是更新后的 `GameData` |
| 131 | `S2C_131_get_sim_game_log` | 模拟对局日志，字段 6 是 `GameData` |
| 157 | `S2C_157_sim_game_use_buff_item` | 模拟对局 buff 道具使用，字段 2 是更新后的 `GameData` |
| 185 | `S2C_185_room_game_start_notify` | 房间对局开始，字段 1 房间 uid，字段 2 `GameData` |
| 187 | `S2C_187_room_game_use_item` | 房间对局道具/技能回包，字段 2 是 repeated `GameSkillData` |
| 191 | `S2C_191_room_game_next_round_notify` | 房间对局下一回合，字段 1 房间 uid，字段 2 `GameData` |
| 193 | `S2C_193_room_game_user_bid_price_notify` | 房间对局玩家出价通知，只带 `userUid` 和 `roomUid` |
| 207 | `S2C_207_room_game_over_notify` | 房间对局结束，字段 1 胜者，字段 2 最终 `GameData`，字段 3 `RoomData` |
| 229 | `S2C_229_get_now_game_data` | 查询当前对局数据，字段 2 是 `GameData` |
| 291 | `S2C_291_test_game_cast_skill` | 测试技能回包，含 `ItemSkillLog`、`NewGameData`、`HeroSkillLog`、`MapSkillLog`、`SkillLog` |
| 301 | `S2C_301_get_send_auction_game_list` | 竞拍发送对局列表，列表项 `SendAuctionGameData` 内含 `GameData` 和用户技能日志 |

完整 S2C 对局相关列表在 JSON 的 `s2cMessages` 中，目前包含 51 个消息类型。

## Core Types

### `GameData`

| field | name | type | 含义 |
|---:|---|---|---|
| 1 | `Uid` | string | 对局 uid，通常形如 `mapId:tail` |
| 2 | `MapId` | int32 | 地图 cid |
| 3 | `Round` | int32 | 当前回合 |
| 4 | `StockContainer` | `StockContainerData` | 当前库存/格子容器快照 |
| 5 | `UserLog` | repeated `GameUserData` | 玩家状态与出价/用道具记录 |
| 6 | `HeroSkillLog` | repeated `GameSkillData` | 英雄技能日志 |
| 7 | `MapSkillLog` | repeated `GameSkillData` | 地图技能日志 |
| 8 | `ItemSkillLog` | repeated `GameSkillData` | 道具技能日志 |
| 9 | `NextRoundTime` | int64 | 下一回合时间 |
| 10 | `SelectItemCount` | int32 | 选择道具数量 |
| 11 | `RoundCanUseItemCount` | int32 | 每回合可用道具数 |
| 12 | `GameCarryItemMax` | int32 | 携带道具上限 |
| 13 | `GameGoldRateMax` | int32 | 金币/倍率上限 |
| 14 | `GameType` | int32 | 对局类型 |
| 15 | `SendAuctionUserUid` | int64 | 发起竞拍用户 uid |
| 16 | `SendAuctionUserName` | string | 发起竞拍用户名 |
| 17 | `SendAuctionUserHead` | int32 | 头像 cid |
| 18 | `SendAuctionHeadBox` | int32 | 头像框 cid |
| 19 | `SendAuctionUserTitle` | int32 | 称号 cid |
| 20 | `ServerTime` | int64 | 服务器时间 |

### `GameUserData`

| field | name | type |
|---:|---|---|
| 1 | `UserUid` | int64 |
| 2 | `Name` | string |
| 3 | `HeroCid` | int32 |
| 4 | `UseItemLog` | repeated `GameUseItemOrPriceData` |
| 5 | `PriceLog` | repeated `GameUseItemOrPriceData` |
| 6 | `IsStandDown` | bool |
| 7 | `IsQuit` | bool |
| 8 | `HeadCid` | int32 |
| 9 | `HeroSkinCid` | int32 |
| 10 | `SimSelectItemList` | repeated `UserSimSelectGameItemData` |
| 11 | `SimBuffItemList` | repeated `UserSimBuffItemData` |
| 12 | `SelectItemList` | repeated `UserSelectItemData` |
| 13 | `HeadBoxCid` | int32 |
| 14 | `TitleCid` | int32 |
| 15 | `Remark` | string |

`GameUseItemOrPriceData` 字段 1 是 `Round`，字段 2 是 `ItemCidOrPrice`。在 `UseItemLog` 中字段 2 表示道具 cid；在 `PriceLog` 中字段 2 表示出价。

### `GameSkillData`

| field | name | type | 含义 |
|---:|---|---|---|
| 1 | `SkillCid` | int32 | 技能 cid |
| 2 | `HeroCid` | int32 | 英雄 cid |
| 3 | `MapCid` | int32 | 地图 cid |
| 4 | `ItemCid` | int32 | 道具 cid |
| 5 | `CastTime` | int64 | 释放时间 |
| 6 | `CastRound` | int32 | 释放回合 |
| 7 | `HitItemIndex` | int32 | 命中件数/序号，具体语义随技能变化 |
| 8 | `HitBoxList` | repeated `BoxInfoData` | 命中的格子/藏品信息 |
| 9 | `AllHitItemAvgPrice` | float | 命中藏品平均价格 |
| 10 | `AllHitBoxAvgPrice` | float | 命中格均价格 |
| 11 | `AllHitItemAvgBoxIndex` | float | 命中藏品平均格数 |
| 12 | `HitItemTotalPrice` | int32 | 命中藏品总价 |
| 13 | `Uid` | int64 | 技能事件 uid，用于去重 |
| 14 | `TotalHitBoxIndex` | int32 | 命中总格数 |
| 15 | `HitItemTypeList` | repeated int32 | 命中类型列表 |
| 16 | `HitItemQuilityList` | repeated int32 | 命中品质列表，游戏拼写为 `Quility` |

### `BoxInfoData`

| field | name | type | 含义 |
|---:|---|---|---|
| 1 | `BoxId` | int32 | 格子 id |
| 2 | `ItemUid` | int64 | 藏品 uid |
| 3 | `ItemCid` | int32 | 藏品 cid |
| 4 | `ItemSlotType` | int32 | 格子/槽位类型 |
| 5 | `ItemType` | repeated int32 | 藏品类型列表 |
| 6 | `ItemQuility` | int32 | 藏品品质 |
| 7 | `ItemPrice` | int32 | 藏品价格 |
| 8 | `ItemBoxIndex` | int32 | 藏品格数 |

## 实时解析结论

- `33/37/45/185/191/207/229` 等消息的核心载荷都是 `GameData`，其中 `HeroSkillLog`、`MapSkillLog`、`ItemSkillLog` 会累计出现已触发技能。
- `39/187` 是实时道具技能回包，直接下发 repeated `GameSkillData`。
- `GameSkillData.HitBoxList` 是技能揭露的最关键字段；但技能效果决定下发粒度，不是所有技能都会给完整 `ItemCid/ItemPrice/ItemBoxIndex`。
- 目前实测：`mapSkill=200023` 给完整藏品 cid/品质/价格/尺寸；`skill=702 宝光四鉴` 只给 box + 品质；`skill=201/202 扫描` 只给命中总格数。

## Live Monitor SSE 事件 payload

`/api/bidking-monitor/events` 推送的 `event` payload 保持 raw parser event 向后兼容：原始事件字段仍然平铺在顶层，例如 `key`、`msgId`、`group`、`sourceKind`、`gameUid`、`round`、`skill` 等旧消费者可继续读取的字段。

新版本会在同一个顶层对象上附加以下字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `rawEvent` | object | 原始 parser event 的完整快照，内容与顶层 raw-compatible 字段一致 |
| `facts` | object[] | 从 raw event 归一化出的 monitor facts，供页面按稳定语义消费 |
| `state` | object | 应用 facts 后的 canonical monitor state，包含跨事件累计结果 |

示例结构：

```json
{
  "key": "skill:123",
  "msgId": 39,
  "group": "item",
  "gameUid": "4405:1178745290411251",
  "round": 2,
  "skill": { "skillCid": 1002081, "hitBoxList": [] },
  "rawEvent": {
    "key": "skill:123",
    "msgId": 39,
    "group": "item",
    "gameUid": "4405:1178745290411251",
    "round": 2,
    "skill": { "skillCid": 1002081, "hitBoxList": [] }
  },
  "facts": [
    { "type": "game.changed", "gameUid": "4405:1178745290411251", "round": 2 }
  ],
  "state": {
    "gameUid": "4405:1178745290411251",
    "round": 2,
    "groups": {
      "wg": { "totalCells": null, "averageCells": null, "averagePrice": null },
      "blue": { "totalCells": null, "averageCells": null, "averagePrice": null },
      "purple": { "totalCells": null, "averageCells": null, "averagePrice": null },
      "orange": { "totalCells": null, "averageCells": null, "averagePrice": null },
      "red": { "totalCells": null, "averageCells": null, "averagePrice": null }
    },
    "outlines": [],
    "exactItems": [],
    "qualityCells": [],
    "revealedTypes": [],
    "minimumOccupied": null
  }
}
```
