# Price 仓库 Panel 交易所上架 · 设计文档

> 日期:2026-06-03 · 状态:已与用户确认设计,待 writing-plans

## 目标

在 Price 页面的「仓库」tab 中,选中某个藏品后,支持把该藏品上架到游戏交易所。用户手动输入单价(默认带一个基于当前最低价的建议值)和数量,确认后通过已注入的 AutoOperation Agent 执行上架。

## 范围

- **仅这一版(v1)**:手动单价 + 数量 + 总价,直接调用裸 `ExchangeItem`。
- **本版纯前端改动**:执行、桥接、命令均已存在并暴露,无需新增后端 / Electron / Agent 代码。

## 背景:已有基础设施(均已就绪,直接复用)

| 能力 | 位置 | 说明 |
|---|---|---|
| 上架命令 | `BKAutoOpAgent.cpp` `CmdExchangeItem` | 调游戏 `PlayerManager.ExchangeItem(itemCid, count, unitPrice)`,3 参数;Agent 端已校验 itemCid/count/unitPrice > 0、total 不溢出 |
| 行情查询命令 | `BKAutoOpAgent.cpp` `CmdGetItemTradeInfo` | 返回 TradeListSummary JSON |
| 命令分发 | Agent `kCommands[]` | `ExchangeItem`、`GetItemTradeInfo` 已注册 |
| Node 桥接 | `electron/services/inject-service.js` `runAutoOperationCommand` | 通用命名管道桥接,已含 `ExchangeItem` 超时配置 |
| 渲染层桥接 | `electron/preload.js` | `window.bidkingDesktop.runAutoOperationCommand(command, args)` 已暴露 |
| 仓库数据 | `src/price/App.vue` | `warehouseItems`(含 `itemCid` + `count`)、`selectedItemCid`、`selectItem()`、`canRefreshWarehouse` 守卫 |

> 注:后端另有一套「建议价上架」管线(`buildListingAdvice` / `confirmHighPriceExchangeListing` / `listing-fee-config-store`),会强制锁定 advisor 建议价、禁止亏本上架。**本版不使用**,因为它与「手动输入单价」冲突。保留供未来 v2 用。

## 设计决策(已确认)

1. **单价**:用户手动输入;默认 = `当前最低价 - 10`(不做 advisor 推算)。
2. **数量**:默认 = 该藏品持有全部;可改;上限 = 持有数。
3. **确认**:弹确认窗;明细**只显示总价**(`数量 × 单价`),不算手续费/税/净额。
4. **行情来源**:打开弹窗时实时拉一次 `GetItemTradeInfo`。
5. **布局**:详情区头部加「上架」按钮,点击弹出独立弹窗(方案 C)。

## 架构与组件

```
src/price/App.vue (仓库 panel)
  └─ 选中藏品详情区头部:新增 [上架] 按钮 (仅桌面端 + agent 可用时显示)
       └─ 点击 → 打开 <ListingModal>
src/price/ListingModal.vue (新建)
  ├─ props: itemCid, name, quality, ownedCount
  ├─ 打开时拉 GetItemTradeInfo → 渲染挂单阶梯 + 计算默认单价
  ├─ 单价输入 / 数量输入 / 总价显示 / [取消] [确认上架]
  └─ emit: 'listed'(成功,携带 itemCid/count/unitPrice) | 'close'
```

新建独立组件 `ListingModal.vue`,避免 `App.vue`(已 563 行)继续膨胀,且弹窗逻辑可独立测试。

### 触发按钮可见性

复用 `App.vue` 现有守卫模式:`window.bidkingDesktop?.isDesktop && typeof window.bidkingDesktop?.runAutoOperationCommand === 'function'`。Web 模式或无 agent 时按钮隐藏。

## 数据流与契约

**打开弹窗(拉行情):**
```
ListingModal 挂载
  → window.bidkingDesktop.runAutoOperationCommand('GetItemTradeInfo', { itemCid })
  → response.value = {
       itemCid, resultClass, minPrice, tierCount, totalCount,
       tiers: [ { price, count }, ... ]   // 按价格升序的挂单阶梯
     }
  → 渲染 tiers 为挂单阶梯列表(价格 × 件数)
  → 默认单价 = minPrice > 0 ? max(minPrice - 10, 1) : 空(手填)
```

**确认上架:**
```
[确认上架]
  → window.bidkingDesktop.runAutoOperationCommand('ExchangeItem', { itemCid, count, unitPrice })
  → response.ok / response.value 判定结果
```

## 交互细节

- **默认单价**:`minPrice - 10`;若结果 ≤ 0 取 `1`;若无挂单(`minPrice === 0` 或 `tiers` 空)则单价框留空,提示手动输入。
- **默认数量**:`ownedCount`(取自选中行 `warehouseItems[].count`);上限 = `ownedCount`。
- **前端校验**(发送前):`count` 为整数且 `∈ [1, ownedCount]`;`unitPrice` 为整数且 `≥ 1`。不满足则禁用「确认上架」并提示。
- **总价**:`count × unitPrice`,随输入实时更新。

## 错误与边界处理

- 拉 `GetItemTradeInfo` 失败:弹窗仍打开,挂单区显示错误/空,单价框留空允许手填。
- `ExchangeItem` 失败(agent 报错 / 游戏拒绝):在弹窗内显示错误信息,**保持打开**,允许重试。
- 成功:关闭弹窗 → 刷新该藏品仓库持有数(复用现有 `GetStockCollectibleCounts` 刷新路径,上架后持有数应下降);价格历史刷新为可选 → 提示成功。
- agent 未连接 / 非桌面端:按钮不显示(守卫拦截)。

## 非目标 / YAGNI(本版不做)

- 不接 advisor 建议价、不用 `confirmHighPriceExchangeListing`、不展示手续费/税/净额。
- 不做批量多藏品上架。
- 不改后端 / Electron / Agent 代码。
- 不记录上架日志(`appendListingLog` 那套属于 advised-listing 管线)。

## 测试(Vitest + @vue/test-utils)

新建 `src/price/ListingModal.test.js`,覆盖:

1. 挂载时调用 `GetItemTradeInfo`,默认单价 = `minPrice - 10`。
2. `minPrice ≤ 10` 时默认单价取 `1`;无挂单时单价框为空。
3. 默认数量 = `ownedCount`,数量超过 `ownedCount` 时校验失败、确认禁用。
4. 单价 `< 1` 或非整数时校验失败。
5. 总价 = `count × unitPrice` 实时更新。
6. 点「确认上架」以正确入参 `{itemCid, count, unitPrice}` 调用 `runAutoOperationCommand('ExchangeItem', …)`。
7. 上架成功 emit `'listed'` 并触发刷新;失败时弹窗保持打开并显示错误。

`src/price/App.test.js` 补充:桌面端 + agent 可用时显示「上架」按钮;Web 模式隐藏。

## 文件清单

- 新建 `src/price/ListingModal.vue`
- 新建 `src/price/ListingModal.test.js`
- 修改 `src/price/App.vue`(详情区头部加按钮、挂载弹窗、成功后刷新)
- 修改 `src/price/App.test.js`(按钮可见性回归)
- 修改 `docs/Documentation.md`(记录新功能当前状态)
