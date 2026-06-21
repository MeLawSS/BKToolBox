# Price 上架默认价百分比配置 · 设计文档

> 日期: 2026-06-03 · 状态: 已实现

## 目标

把 Price 页面仓库上架流程里的默认单价规则，从当前的 `最低价 - 10` 改为一个**Price 页面全局共享、可持久化**的百分比配置。该配置显示在 Price 页已选中藏品的详情区内，作为打开 ListingModal 时的默认建议价来源；用户仍可在弹窗内手动修改最终上架单价。

## 当前状态

- `src/price/App.vue` 现在在详情区维护页面级默认上架价百分比，并用 `bidking-price-listing-default-percent:v1` 持久化
- `src/price/ListingModal.vue` 打开时会调用 `GetItemTradeInfo`，并通过 `defaultPricePercent` 计算默认单价
- `src/price/listing-form.js` 当前默认价逻辑为 `computeDefaultUnitPrice(minPrice, percent)`，规则是 `max(floor(minPrice * percent / 100), 1)`
- 详情区百分比配置默认值为 `98`，支持小数和大于 `100`

## 已确认行为

1. 配置入口放在 **Price 页 selected-item detail panel**，不是弹窗内配置，也不是按藏品单独保存。
2. 配置是 **Price 页面全局配置**，所有藏品共用一个值。
3. 默认值是 **`98`**。
4. **允许小数**。
5. **允许大于 100**。
6. 打开上架弹窗时，默认单价改为：
   `floor(minPrice * percent / 100)`，并且结果 **至少为 `1`**。
7. 如果没有可用 `minPrice` / 当前无挂单，则保持现在的**留空行为**，不强行填默认价。
8. 用户在弹窗内仍然可以手动修改单价；百分比配置只影响**初始建议值**。
9. 配置通过 `localStorage` 持久化。

## 交互设计

### 详情区新增配置项

在 Price 页右侧已选中藏品详情区、靠近现有「上架」按钮的位置，增加一个默认上架百分比输入项，例如：

- 标签：`默认上架价(%)`
- 输入框：数值输入，展示当前全局百分比
- 说明文案：表达其用途是“用于打开上架弹窗时的默认单价计算”

该输入项是 **页面级设置**，不是当前藏品私有状态。切换选中藏品时：

- 输入框继续显示同一个全局值
- 不因切换选中项而重置

### 弹窗默认价行为

`ListingModal` 打开并成功拿到 `GetItemTradeInfo` 返回后：

- 若 `minPrice` 是有效正数，使用当前全局百分比计算默认价
- 公式结果取 `Math.floor(...)`
- 若结果 `< 1`，填 `1`
- 若 `minPrice` 不可用，或没有挂单可形成可用默认价，则单价输入框继续留空

### 手动编辑保持不变

- 弹窗内单价输入框仍然允许用户自由修改
- 数量、总价、确认上架、错误提示等现有交互不变
- 该百分比配置**不会**在用户编辑单价后反向覆盖弹窗里的手输值

## 数据与持久化

### localStorage

新增一个 Price 页专用存储 key，用于保存默认上架百分比，例如：

`bidking-price-listing-default-percent:v1`

设计要求：

- 首次无存储值时，使用 `98`
- 页面初始化时从 `localStorage` 读取
- 用户修改后立即持久化
- 存储内容按数值语义处理，而不是依赖 UI 文本格式

### 值约束

已确认允许：

- 小数
- 大于 `100`

本次实现建议将“可持久化的有效值”定义为：

- `Number.isFinite(value)`
- `value > 0`

原因：

- `0` 或负数虽然仍可被“至少 1”钳制，但会让“百分比配置”语义失真
- 约束为正数后，行为更稳定，也更容易测试和解释

如果读到非法存储值、空值或非正数，页面应回退到 `98`。

## 逻辑调整

实现后：

- 默认价计算依赖 `minPrice + percent`
- 纯逻辑层明确接收百分比参数：`computeDefaultUnitPrice(minPrice, percent)`
- 页面级配置归一化由 `parseListingDefaultPricePercent(value)` 统一处理

目标算法：

```js
const suggested = Math.floor(minPrice * percent / 100);
return Math.max(suggested, 1);
```

保留空值分支：

- `minPrice` 不可用时返回 `null`
- 无挂单场景维持现有“输入框留空”

## 范围

- 修改 `Price` 页 detail panel，新增默认上架百分比配置 UI
- 修改上架默认价纯逻辑与单测
- 修改 `ListingModal` 读取并应用该配置
- 增加 `localStorage` 读写
- 更新相关测试和文档

## 非目标

- 不改 `ExchangeItem` 调用契约
- 不改后端 / Electron / Agent
- 不做按藏品分别保存百分比
- 不做复杂的价格建议策略（如 advisor、手续费、净收益推导）
- 不限制大于 100 的输入
- 不改变弹窗内手动改单价能力

## 影响文件

- `src/price/App.vue`
- `src/price/App.test.js`
- `src/price/ListingModal.vue`
- `src/price/ListingModal.test.js`
- `src/price/listing-form.js`
- `src/price/listing-form.test.js`
- `src/shared/messages.js`
- `docs/Documentation.md`

## 验收标准

1. Price 页选中任意藏品后，详情区可见默认上架百分比输入项。
2. 首次进入页面、无本地存储时，默认显示 `98`。
3. 修改该值后刷新页面，配置仍能恢复。
4. 输入 `98.5`、`105` 这类值可正常保存和使用。
5. 打开 ListingModal 时，若 `minPrice = 1600` 且百分比为 `98`，默认单价应为 `1568`。
6. 若计算结果小于 `1`，默认单价显示 `1`。
7. 若无可用 `minPrice` / 无挂单，单价输入框仍为空。
8. 用户仍可在弹窗内把默认单价改成任意合法值后提交。
9. 现有上架成功、失败、仓库刷新流程不回归。
