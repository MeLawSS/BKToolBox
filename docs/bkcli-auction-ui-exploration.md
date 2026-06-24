# 竞拍界面探索记录（bkcli）

> 探索日期：2026-06-23
> 工具：`node tools/bkcli/bkcli.js <command>`

## 一、屏幕状态机

通过 `DetectScreenState`（`MetaOperations.cpp:537`）检测，当前屏幕是以下之一：

| 屏幕标识 | 面板条件 | 说明 |
|---------|---------|------|
| `authcode` | `AuthCode_Main` 可见 | 验证码 |
| `auction_in_progress` | `Battle_Main` + `Gaming` 活跃 | 竞拍进行中 |
| `auction_ended` | `Battle_Main` + `EndPanel` 活跃 | 竞拍结束 |
| `auction_lobby_room` | `BattlePrevPanel_Main` + `MapPanel` 活跃 | 房间大厅 |
| `auction_lobby_map` | `BattlePrevPanel_Main` + `MapPanel` 不可见 | 地图大厅 |
| `cabinet_reward_list` | `CollectAward_Main` 可见 | 收藏柜奖励列表 |
| `cabinet_reward_popup` | `CollectAward_Main` + `RewardsBox` 同时可见 | 奖励弹窗 |
| `mailbox` | `Mail_Main` 可见 | 邮箱 |
| `exchange` | `TradingPanel` 可见 | 交易所 |
| `battlepass` | `BattlePass_Main` 可见 | 战令 |
| `main_lobby` | `UIMain` + `MainPanel` 活跃 | 主大厅 |
| `warehouse` | `UIMain` + `MainPanel` 不可见 | 仓库 |

## 二、竞拍界面（Battle_Main）整体结构

```
Battle_Main
├── Bg                              # 背景
├── Gaming                          # 游戏区（拍卖对局核心）
│   ├── PlayerContainer
│   │   ├── Player_1 ~ Player_4     # 4 名玩家
│   │   │   ├── BidFrame            # 出价框
│   │   │   ├── NameUnit
│   │   │   │   ├── HeadIcon        # 头像
│   │   │   │   ├── NameLayout      # 玩家名（文本为空时通过 HeroUnit 区分）
│   │   │   │   └── HeadTitle       # 头衔
│   │   │   ├── HeroUnit
│   │   │   │   ├── heroIconBg      # 英雄图标背景
│   │   │   │   └── heroName        # 英雄名（文本）⭐
│   │   │   ├── containers
│   │   │   │   ├── RoundUnit               # 第 1 轮出价
│   │   │   │   └── RoundUnit(Clone)[0]~[3] # 第 2~5 轮出价
│   │   │   │       ├── roundTxt   # 轮次标记（如 "2"）
│   │   │   │       ├── priceTxt   # 出价金额（如 "58,999"）⭐
│   │   │   │       └── itemIconBg # 物品图标
│   │   │   └── rightTop            # 右上角标记
│   │   └── ...
│   ├── Center                       # 中央信息区
│   │   ├── RoundBg
│   │   │   └── roundTxt             # 当前轮次（如 "第3轮"）⭐
│   │   └── SkillDescScroll         # 技能描述滚动列表
│   │       └── Viewport/Content
│   │           └── SkillDescItem_*  # 技能/信息条目
│   │               ├── Name         # 来源名称 ⭐
│   │               └── skillDesc    # 描述文本 ⭐
│   ├── remainBg / remainTxt        # 倒计时（轮间间隙时为空）
│   ├── emojiBtn                    # 表情按钮 [Button]
│   ├── Playback                    # 回放控制
│   │   ├── replay                  # [Button]
│   │   ├── playstop                # [Button]
│   │   └── timerate                # [Button]
│   └── Close                       # 关闭按钮 [Button]
├── WareHouse                       # 战利品区域
│   ├── Top/ui_battle_zhanlipin     # 标题
│   ├── Right
│   │   ├── Button                  # [Toggle] 分类切换1
│   │   └── Button_1                # [Toggle] 分类切换2
│   ├── Container
│   │   ├── Scroll View             # 库存方格（32 个 Grid_0~31）
│   │   │   └── Viewport/Content
│   │   │       └── Grid_0 ~ Grid_31
│   │   │           ├── LeftTop     # 左上（item 或 高亮轮廓）
│   │   │           ├── RightTop    # 右上
│   │   │           ├── LeftBottom  # 左下
│   │   │           ├── RightBottom # 右下
│   │   │           └── Center      # 中心
│   │   └── Scroll View (1)         # 战利品列表（21 个 GridItem）
│   │       └── Viewport/Content
│   │           └── GridItem(Clone)(Clone)[0] ~ [20]
│   │               ├── Mask/icon   # 物品图标
│   │               ├── Name        # 物品名称 ⭐
│   │               ├── Count       # 数量
│   │               ├── effect
│   │               │   ├── biankuang_*  # 边框（不可用于品质判断）
│   │               │   └── glow_*       # 光效
│   │               └── battle_effect
│   │                   └── IconEffect_N
│   │                       └── IconFX2_Sheet_<Color>  # 品质颜色 ⭐
│   └── Bottom
│       └── yuguPrice               # 当前预估最低价格 ⭐
└── AssetItem_1 / AssetItem_2       # 资源信息
```

⭐ = 可读文本的关键节点

## 三、玩家出价数据

每条玩家记录通过 `Player_N/HeroUnit/heroName` 读取英雄名，通过 `containers/RoundUnit` 和 `RoundUnit(Clone)[0]~[3]` 读取各轮出价。

### 示例数据（第3轮）

| 玩家 | 英雄 | 第1轮 | 第2轮 | 第3轮 | 第4轮 | 第5轮 |
|------|------|-------|-------|-------|-------|-------|
| Player_1 | 艾莎 | 58,999 | 58,999 | 100.01K | - | - |
| Player_2 | 艾哈迈德 | 66,666 | 88,888 | 88,888 | - | - |
| Player_3 | 伊莎贝拉 | 56,666 | 110.22K | 130.00K | - | - |
| Player_4 | 索菲 | 66,666 | 44,444 | 97,646 | - | - |

### 关键路径

| 数据 | 路径 |
|------|------|
| 英雄名 | `Gaming/PlayerContainer/Player_N/HeroUnit/heroName` |
| 第1轮出价 | `Player_N/containers/RoundUnit/priceTxt` |
| 第2轮出价 | `Player_N/containers/RoundUnit(Clone)[0]/priceTxt` |
| 第N轮出价 | `Player_N/containers/RoundUnit(Clone)[N-2]/priceTxt` |
| 轮次标记 | `Gaming/Center/RoundBg/roundTxt` |
| 预估底价 | `WareHouse/Bottom/yuguPrice` |

### bkcli 命令示例
```bash
# 查英雄名
node tools/bkcli/bkcli.js get-node Battle_Main "Gaming/PlayerContainer/Player_1/HeroUnit/heroName"

# 查第3轮出价
node tools/bkcli/bkcli.js get-node Battle_Main "Gaming/PlayerContainer/Player_1/containers/RoundUnit(Clone)[1]/priceTxt"

# 快捷命令
node tools/bkcli/bkcli.js run GetBidState
```

## 四、中央对局信息/技能描述

路径：`Gaming/Center/SkillDescScroll/Viewport/Content/SkillDescItem_*`

每个条目有 `Name`（来源）和 `skillDesc`（内容）两个文本节点。

### 示例数据

| ID | Name | skillDesc |
|----|------|-----------|
| SkillDescItem_200023 | 民生储备仓库:竞拍信息 | 随机显示6件藏品 |
| SkillDescItem_1001034 | 艾莎:遗珍慧眼 | 显示所有白色品质道具的轮廓和品质 |
| SkillDescItem_200037 | 民生储备仓库:竞拍信息 | 所有金色品质藏品的平均价值约为21840 |
| SkillDescItem_1001033 | 艾莎:遗珍慧眼 | 显示所有绿色品质道具的轮廓和品质 |
| SkillDescItem_200028 | 民生储备仓库:竞拍信息 | 随机显示9件藏品的品质 |
| SkillDescItem_1001032 | 艾莎:遗珍慧眼 | 显示所有蓝色品质道具的轮廓和品质 |

- `2xxxxx` 前缀 = 竞拍信息（仓库藏品分布提示）
- `1001xxx` 前缀 = 艾莎英雄技能效果

### bkcli 命令示例
```bash
node tools/bkcli/bkcli.js get-node Battle_Main "Gaming/Center/SkillDescScroll/Viewport/Content/SkillDescItem_200023/Name"
node tools/bkcli/bkcli.js get-node Battle_Main "Gaming/Center/SkillDescScroll/Viewport/Content/SkillDescItem_200023/skillDesc"
```

## 五、战利品方格矩阵

路径：`WareHouse/Container/Scroll View (1)/Viewport/Content/GridItem(Clone)(Clone)[0]~[20]`

共 21 个格子，由 `GridLayoutGroup` 排列。前 6 个（0~5）有名称，后 15 个（6~20）仅有品质轮廓和图标。

### 物品名称

路径：`GridItem(Clone)(Clone)[N]/Name` — 仅前 6 项有值。

### 品质识别

`biankuang_*`（边框节点）始终全部 `active=true`，**不可用于品质判断**。

正确方式：读取 `battle_effect/IconEffect_N/IconFX2_Sheet_<Color>` 中实际存在的节点名。

| Sheet 颜色 | 品质 |
|-----------|------|
| `IconFX2_Sheet_White` | ⚪ 白 |
| `IconFX2_Sheet_Green` | 🟢 绿 |
| `IconFX2_Sheet_Blue` | 🔵 蓝 |
| `IconFX2_Sheet_Purple` | 🟣 紫 |
| `IconFX2_Sheet_Yellow` | 🟡 金 |
| `IconFX2_Sheet_Red` | 🔴 红 |

### 示例数据

| Index | 物品名称 | 品质 | IconEffect |
|-------|---------|------|------------|
| 0 | 充气玩具手枪 | 🟢 绿 | IconEffect_2 / Green |
| 1 | 银制耳饰 | 🔵 蓝 | IconEffect_3 / Blue |
| 2 | 变彩欧泊 | 🟡 金 | IconEffect_5 / Yellow |
| 3 | 玉扣 | 🟢 绿 | IconEffect_2 / Green |
| 4 | 月光石 | 🔵 蓝 | IconEffect_3 / Blue |
| 5 | 珊瑚珠 | 🟢 绿 | IconEffect_2 / Green |
| 6 | *(仅轮廓)* | ⚪ 白 | IconEffect_1 / White |
| 7 | *(仅轮廓)* | ⚪ 白 | IconEffect_1 / White |
| 8 | *(仅轮廓)* | 🟢 绿 | IconEffect_2 / Green |
| 9 | *(仅轮廓)* | 🟢 绿 | IconEffect_2 / Green |
| 10 | *(仅轮廓)* | 🟢 绿 | IconEffect_2 / Green |
| 11 | *(仅轮廓)* | 🟢 绿 | IconEffect_2 / Green |
| 12 | *(仅轮廓)* | 🟢 绿 | IconEffect_2 / Green |
| 13 | *(仅轮廓)* | 🟢 绿 | IconEffect_2 / Green |
| 14 | *(仅轮廓)* | 🟢 绿 | IconEffect_2 / Green |
| 15 | *(仅轮廓)* | 🟢 绿 | IconEffect_2 / Green |
| 16 | *(仅轮廓)* | 🔵 蓝 | IconEffect_3 / Blue |
| 17 | *(仅轮廓)* | 🟣 紫 | IconEffect_4 / Purple |
| 18 | *(仅轮廓)* | 🔵 蓝 | IconEffect_3 / Blue |
| 19 | *(仅轮廓)* | 🔵 蓝 | IconEffect_3 / Blue |
| 20 | *(仅轮廓)* | 🔵 蓝 | IconEffect_3 / Blue |

### 格子位置与矩阵布局

每个 `GridItem` 的 `RectTransform.anchoredPosition` 通过 `CallNodeComponentMethod` 读取（pipe 线程安全）：

```bash
# 读单个格子位置
node tools/bkcli/bkcli.js run CallNodeComponentMethod '{
  "panel":"Battle_Main",
  "path":"WareHouse/Container/Scroll View (1)/Viewport/Content/GridItem(Clone)(Clone)[0]",
  "className":"UnityEngine.RectTransform",
  "methodName":"get_anchoredPosition"
}'
# 返回: {"invokeResult":{"resultKind":"vector2","x":540.0,"y":-180.0}}
```

**矩阵规格**：10 列 × 5 行，单元格间距 60px，总计 50 个位置中 21 个有物品。

```
        c0      c1      c2      c3      c4      c5      c6      c7      c9      
      ------------------------------------------------------------------------
R0 (y=0   )  ·      ·    🟢绿       ·    🟢绿     🟢绿     🔵蓝     🟣紫     🔵蓝     
R1 (y=-60 )  ·    ⚪白        ·      ·      ·    🔵蓝       ·      ·    🟢绿     
R2 (y=-120)⚪白        ·    🔵蓝★    🟢绿       ·      ·      ·    🟢绿     🔵蓝★    
R3 (y=-180)  ·      ·    🟡金★      ·      ·    🟢绿     🟢绿★      ·    🟢绿★    
R4 (y=-240)🟢绿★    🟢绿     🔵蓝       ·      ·      ·      ·      ·      ·    
```

- **行**：R0=顶行（anchoredPosition.y=0），R4=底行（y=-240），递增 -60
- **列**：c0~c9（x 从 0 到 540，递增 60；c8 无 item）
- **r**：已揭示名称的 6 件物品
- **空白**：仅品质轮廓的 15 件

### 完整位置映射表

| Index | Row | Col | x | y | 名称 | 品质 |
|-------|-----|-----|----|----|------|------|
| 0 | R3 | c9 | 540 | -180 | 充气玩具手枪 | 🟢 绿 |
| 1 | R2 | c2 | 120 | -120 | 银制耳饰 | 🔵 蓝 |
| 2 | R3 | c2 | 120 | -180 | 变彩欧泊 | 🟡 金 |
| 3 | R4 | c0 | 0 | -240 | 玉扣 | 🟢 绿 |
| 4 | R2 | c9 | 540 | -120 | 月光石 | 🔵 蓝 |
| 5 | R3 | c6 | 360 | -180 | 珊瑚珠 | 🟢 绿 |
| 6 | R2 | c0 | 0 | -120 | (仅轮廓) | ⚪ 白 |
| 7 | R1 | c1 | 60 | -60 | (仅轮廓) | ⚪ 白 |
| 8 | R3 | c5 | 300 | -180 | (仅轮廓) | 🟢 绿 |
| 9 | R2 | c7 | 420 | -120 | (仅轮廓) | 🟢 绿 |
| 10 | R0 | c2 | 120 | 0 | (仅轮廓) | 🟢 绿 |
| 11 | R2 | c3 | 180 | -120 | (仅轮廓) | 🟢 绿 |
| 12 | R0 | c5 | 300 | 0 | (仅轮廓) | 🟢 绿 |
| 13 | R1 | c9 | 540 | -60 | (仅轮廓) | 🟢 绿 |
| 14 | R4 | c1 | 60 | -240 | (仅轮廓) | 🟢 绿 |
| 15 | R0 | c4 | 240 | 0 | (仅轮廓) | 🟢 绿 |
| 16 | R4 | c2 | 120 | -240 | (仅轮廓) | 🔵 蓝 |
| 17 | R0 | c7 | 420 | 0 | (仅轮廓) | 🟣 紫 |
| 18 | R0 | c6 | 360 | 0 | (仅轮廓) | 🔵 蓝 |
| 19 | R1 | c5 | 300 | -60 | (仅轮廓) | 🔵 蓝 |
| 20 | R0 | c9 | 540 | 0 | (仅轮廓) | 🔵 蓝 |

**品质分布**：🟢绿×11、🔵蓝×6、⚪白×2、🟡金×1、🟣紫×1

### bkcli 命令示例
```bash
# 读物品名称
node tools/bkcli/bkcli.js get-node Battle_Main "WareHouse/Container/Scroll View (1)/Viewport/Content/GridItem(Clone)(Clone)[0]/Name"

# dump 战利品列表
node tools/bkcli/bkcli.js dump Battle_Main --root "WareHouse/Container/Scroll View (1)" --depth 6 --all --limit 500

# 用 GetStockCollectibleCounts 获取结构化仓库数据（105 项）
node tools/bkcli/bkcli.js run GetStockCollectibleCounts

# 用 GetWarehouseItemList 获取仓库物品列表（105 项）
node tools/bkcli/bkcli.js run GetWarehouseItemList
```

## 六、bkcli 常用命令索引

| 命令 | 说明 |
|------|------|
| `ping` | 检查 agent 连通性 |
| `inject` | 注入 agent 到游戏进程 |
| `get-current-screen` | 获取当前屏幕状态 |
| `get-visible-panels` | 列出所有可见面板 |
| `get-current-ui` | 获取当前 UI 面板 |
| `dump <panel> [--root <path>] [--depth N] [--all] [--limit N]` | 导出面板节点树 |
| `get-node <panel> <path>` | 读取单个节点状态（含文本、active、toggleOn） |
| `click <panel> <path>` | 点击节点 |
| `wait-panel <panel> [--timeout N] [--hidden]` | 等待面板出现/消失 |
| `wait-node <panel> <path> <state>` | 等待节点达到指定状态 |
| `run <cmd> [argsJson]` | 执行任意 agent 命令 |
| `auto-auction [--room N] [--amount N]` | 自动竞拍 |
| `exec-probe <file.cpp>` | 编译并执行 C++ 探针 |
| `exec-shellcode <file.bin\|file.hex>` | 执行原始 shellcode |

### 常用 run 子命令

| 子命令 | 说明 |
|--------|------|
| `GetBidState` | 获取当前出价状态（{round, timeRemaining}） |
| `GetCurrentScreen` | 获取当前屏幕 |
| `GetWarehouseItemList` | 仓库物品列表 |
| `GetStockCollectibleCounts` | 藏品库存统计 |
| `CollectionPrices` | 藏品价格 |
| `CloseCurrentOverlay` | 关闭当前弹窗 |
| `DismissRewardsBox` | 关闭奖励框 |
| `DismissCollectAward` | 关闭领取奖励 |
| `CollectCabinetReward` | 领取收藏柜奖励 |
| `GoToBattlePrev` | 前往竞拍大厅 |
| `EnterRoom {roomId}` | 进入房间 |
| `SetBidAmount {amount}` | 设置出价金额 |
| `PlaceBid` | 出价 |
| `ConfirmBid` | 确认出价 |

## 七、滑动验证界面（AuthCode_Main）

2026-06-24 现场抓取结果：

- 当前 screen：`authcode`
- 可见 panels：`UIMain`、`BattlePrevPanel_Main`、`AuthCode_Main`、`ItemDetail_Main`、`InvitePanel`
- 关闭按钮：`Main/m_BtnClose` `[Button]`
- 滑块拖动按钮：`Main/Move` `[Button]`
- 遮罩：`Mask` `[Button]`

### 关键路径

| 用途 | 路径 |
|------|------|
| 关闭验证界面 | `Main/m_BtnClose` |
| 拖动滑块 | `Main/Move` |
| 点击遮罩 | `Mask` |

### 实测验证

```bash
node tools/bkcli/bkcli.js get-current-screen
node tools/bkcli/bkcli.js dump AuthCode_Main --all --depth 8 --limit 800
node tools/bkcli/bkcli.js click AuthCode_Main Main/m_BtnClose
```

实测结果：

- 点击 `Main/m_BtnClose` 后，`AuthCode_Main` 立即不可见
- screen 从 `authcode` 回到 `auction_lobby_room`
