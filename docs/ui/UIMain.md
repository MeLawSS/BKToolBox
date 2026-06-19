# UIMain — 主界面 UI 结构文档

采集时间：2026-06-19  
采集方式：bkcli `dump` + `get-visible-panels`

---

## 概览

`UIMain` 是游戏主场景面板名称，始终作为顶层面板存在。  
`get-current-ui` 返回值：`"panel": "UIMain"`

UIMain 场景内常驻以下顶层节点：

| 节点 | 类型 | 说明 |
|------|------|------|
| `Bg` | 非交互 | 背景图 |
| `Cabinet` | 非交互 | 展柜区域（背景展示） |
| `MainPanel` | 含交互 | 主操作面板（按钮、轮播、玩家信息） |
| `WareHousePanel` | 含交互 | 仓库面板（常驻内存，打开/关闭切换显隐） |
| `AssetItem_1` | 非交互 | 货币1展示（图标 + 数量） |
| `AssetItem_2` | 含交互 | 货币2展示（图标 + 数量）+ 充值按钮 |

---

## 一、MainPanel — 主操作面板

### 1.1 mask/Button — 竞拍快捷入口

```
MainPanel/mask/Button  [Button]
└── layout/
    ├── Image (1)
    ├── Image
    └── ui_jinrupaimai      ← 图标名，意为"进入拍卖"
```

点击后打开竞拍大厅（`BattlePrevPanel_Main`）。  
bkcli 操作路径：`MainPanel/mask/Button`

---

### 1.2 ScrollBanner — 顶部轮播横幅

```
MainPanel/ScrollBanner
└── Viewport/Content/
    ├── Item(Clone)[0]  [Button]  ← 横幅1（可点击）
    │   └── Title
    ├── Item(Clone)[1]  [Button]  ← 横幅2
    │   └── Title
    └── Item(Clone)[2]  [Button]  ← 横幅3
        └── Title
└── Dot/
    ├── Dot0  ← 位置指示点
    ├── Dot1
    ├── Dot2
    └── Line
```

3 张可滚动横幅，当前固定显示 3 个克隆条目。Dot 指示当前显示位置，非交互。

---

### 1.3 Btns1 — 右上角功能按钮

| 路径 | 操作标签 | 说明 |
|------|---------|------|
| `MainPanel/Btns1/friend` | 好友 | 打开好友列表 |
| `MainPanel/Btns1/mail` | 邮箱 | 打开邮件 |
| `MainPanel/Btns1/notice` | 通知 | 打开通知 |
| `MainPanel/Btns1/setting` | 设置 | 打开设置 |

全部为 `[Button]`，无子交互节点。

---

### 1.4 Player — 玩家信息区

```
MainPanel/Player/
├── playerName          ← 玩家名（文字，非交互）
├── playerInfo          ← 玩家信息（非交互）
├── reddot              ← 红点提醒（非交互）
├── HeadIcon  [Button]  ← 点击打开个人信息/头像设置
│   └── HeadIconFrame/
│       └── ui_avatarframe_09(Clone)   ← 当前装备的头像框
└── m_BtnOLQA  [Button] ← 问题反馈
    ├── icon
    └── ui_OnlineQA_Main_1
```

- `HeadIcon` 带框架装饰，`ui_avatarframe_09(Clone)` 为当前头像框资源名
- `reddot` 为红点节点，active 时说明有新消息/待处理事项

---

### 1.5 Btns2 — 中部主功能按钮（6个）

dump 中实际渲染顺序（视觉位置顺序）：

| 路径 | 图标资源名 | 操作标签 | 红点 |
|------|-----------|---------|:----:|
| `MainPanel/Btns2/Button_1` | ui_main_warehouse | 仓库 | — |
| `MainPanel/Btns2/Button_2` | ui_main_trading | 交易所 | — |
| `MainPanel/Btns2/Button_5` | ui_main_auction | 拍卖行 | — |
| `MainPanel/Btns2/Button_3` | ui_main_store | 商店 | — |
| `MainPanel/Btns2/Button_4` | ui_main_hero | 竞买人 | ✓ |
| `MainPanel/Btns2/Button_6` | ui_main_xiehui | 收藏协会 | ✓ |

> 注：渲染顺序为 1→2→5→3→4→6，编号不连续，视觉排列顺序与数字编号无关。  
> 带 `reddot` 子节点的按钮（竞买人、收藏协会）在有未读内容时显示红点。

每个按钮子结构：
```
Button_N/
├── Image          ← 背景图
├── ui_main_xxx    ← 图标
├── Image_1        ← 角标或装饰图（部分有）
└── reddot         ← 红点（仅 Button_4、Button_6 有）
```

---

### 1.6 Btns3 — 下部次功能按钮（6个）

dump 中实际渲染顺序：

| 路径 | 图标资源名 | 操作标签 | 红点 |
|------|-----------|---------|:----:|
| `MainPanel/Btns3/Button_6` | ui_purchase | 充值 | — |
| `MainPanel/Btns3/Button_1` | ui_main_btn_1 | 背包 | ✓ |
| `MainPanel/Btns3/Button_2` | ui_main_btn_2 | 通行证 | ✓ |
| `MainPanel/Btns3/Button_3` | ui_main_btn_3 | 排行榜 | — |
| `MainPanel/Btns3/Button_4` | ui_main_btn_4 | 任务 | ✓ |
| `MainPanel/Btns3/Button_5` | ui_cangpinbaike | 藏品百科 | — |

> 渲染顺序为 6→1→2→3→4→5，充值(Button_6)在最左侧。  
> 背包、通行证、任务有红点，采集时均有未读内容。

---

## 二、Cabinet — 展柜区域

展柜是主界面背景的核心视觉元素，展示玩家拥有的藏品。**全部节点非交互**，纯视觉展示。

### 2.1 Grids — 展柜格子槽位

```
Cabinet/Grids/
├── Grid_0
│   ├── LeftTop
│   ├── RightTop
│   ├── LeftBottom
│   ├── RightBottom
│   └── Center
├── Grid_1  …（结构相同）
└── Grid_N  （实测 Grid_0 ~ Grid_49+，总数超过 50）
```

每个 Grid 有 5 个方位子槽（LeftTop/RightTop/LeftBottom/RightBottom/Center），对应展柜格子内的陈列位置。全部非交互，通过游戏逻辑动态填充。

### 2.2 Items — 展示中的藏品条目

```
Cabinet/Items/
├── GridItem(Clone)(Clone)[0]
│   ├── Mask/icon      ← 藏品图标
│   ├── Name           ← 藏品名称
│   └── Count          ← 数量
├── GridShelf(Clone)(Clone)[0]
│   └── Image          ← 展架图
…（共 13 对，GridItem + GridShelf 交替）
```

采集时展示 13 件藏品（GridItem(Clone)[0~12]）。  
特殊字段：`GridItem(Clone)[6]` 含额外子节点 `canSale`，表示该藏品当前**可出售**（其余藏品无此节点）。

---

## 三、AssetItem — 货币显示

### AssetItem_1（货币1）

```
AssetItem_1/
├── bg    ← 背景
├── icon  ← 货币图标
└── num   ← 数量（文字，非交互）
```

纯展示，无交互。对应游戏内的辅助货币（根据图标判断，具体种类待确认）。

### AssetItem_2（货币2 + 充值）

```
AssetItem_2/
├── bg    ← 背景
├── icon  ← 货币图标
├── num   ← 数量（文字，非交互）
└── Button  [Button]   ← 充值入口
```

bkcli 操作路径：`AssetItem_2/Button`  
与 `MainPanel/Btns3/Button_6`（ui_purchase）功能相同，均为充值入口。

---

## 四、WareHousePanel — 仓库面板

仓库面板作为 UIMain 场景的子节点常驻内存，不是独立顶层面板（`get-visible-panels` 不会单独列出）。  
详细结构见：[WareHousePanel.md](./WareHousePanel.md)（待补充）

从 UIMain dump 可见其顶层子节点：

```
WareHousePanel/
├── WareHouse/     ← 仓库主体（Middle网格 + right库存列表 + PanelWareHouseSale出售面板）
├── Toggles/       ← 分类标签（ScrollView，当前2个Tab）
├── leftDown/      ← 左下展柜奖励按钮
│   ├── Button[0]  [Button] → 展柜奖励查看
│   └── Button[1]  [Button] → 展柜奖励查看
└── Top/
    └── Close  [Button]     → 关闭仓库
```

---

## 五、所有可交互节点汇总（主界面常态）

以下为主界面正常状态下（无弹窗覆盖）的全部交互节点，按功能分组：

### 竞拍入口
| 路径 | 标签 |
|------|------|
| `MainPanel/mask/Button` | 竞拍（进入拍卖大厅） |

### 轮播横幅
| 路径 | 说明 |
|------|------|
| `MainPanel/ScrollBanner/Viewport/Content/Item(Clone)[0]` | 横幅1 |
| `MainPanel/ScrollBanner/Viewport/Content/Item(Clone)[1]` | 横幅2 |
| `MainPanel/ScrollBanner/Viewport/Content/Item(Clone)[2]` | 横幅3 |

### 右上角
| 路径 | 标签 |
|------|------|
| `MainPanel/Btns1/friend` | 好友 |
| `MainPanel/Btns1/mail` | 邮箱 |
| `MainPanel/Btns1/notice` | 通知 |
| `MainPanel/Btns1/setting` | 设置 |

### 玩家区域
| 路径 | 标签 |
|------|------|
| `MainPanel/Player/HeadIcon` | 头像（个人信息） |
| `MainPanel/Player/m_BtnOLQA` | 问题反馈 |

### 中部主功能
| 路径 | 标签 |
|------|------|
| `MainPanel/Btns2/Button_1` | 仓库 |
| `MainPanel/Btns2/Button_2` | 交易所 |
| `MainPanel/Btns2/Button_5` | 拍卖行 |
| `MainPanel/Btns2/Button_3` | 商店 |
| `MainPanel/Btns2/Button_4` | 竞买人 |
| `MainPanel/Btns2/Button_6` | 收藏协会 |

### 下部次功能
| 路径 | 标签 |
|------|------|
| `MainPanel/Btns3/Button_6` | 充值 |
| `MainPanel/Btns3/Button_1` | 背包 |
| `MainPanel/Btns3/Button_2` | 通行证 |
| `MainPanel/Btns3/Button_3` | 排行榜 |
| `MainPanel/Btns3/Button_4` | 任务 |
| `MainPanel/Btns3/Button_5` | 藏品百科 |

### 货币区域
| 路径 | 标签 |
|------|------|
| `AssetItem_2/Button` | 充值 |

### 仓库面板（仓库打开时额外出现）
| 路径 | 标签 |
|------|------|
| `WareHousePanel/leftDown/Button[0]` | 展柜奖励查看 |
| `WareHousePanel/leftDown/Button[1]` | 展柜奖励查看 |
| `WareHousePanel/Top/Close` | 关闭仓库 |

---

## 六、bkcli 操作备注

- UIMain 是独立顶层面板，所有命令以 `panel=UIMain` 操作
- WareHousePanel 的节点路径须带完整前缀，如 `WareHousePanel/Top/Close`
- 场景切换（如进入竞拍房间）会断开 Agent 管道，返回主界面后需重新 `node bkcli.js inject`
- 示例：

```bash
# 点击仓库
node bkcli.js click UIMain "MainPanel/Btns2/Button_1"

# 点击拍卖行
node bkcli.js click UIMain "MainPanel/Btns2/Button_5"

# 点击竞拍入口（mask按钮）
node bkcli.js click UIMain "MainPanel/mask/Button"

# 关闭仓库
node bkcli.js click UIMain "WareHousePanel/Top/Close"
```
