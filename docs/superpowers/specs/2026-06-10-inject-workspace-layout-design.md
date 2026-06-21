# Inject 工作台布局重构 · 设计文档

> 日期: 2026-06-10 · 状态: 设计已确认，待用户审阅 spec

## 目标

将 `Inject` 页面从“长页面堆叠多个 section”的结构，重构为与 `Tools` 页面一致的工作台形态：

- 顶部保留全局 `TopBar`
- 主区改为“左侧导航 + 右侧单内容区”
- 同一时间只显示一个激活中的 inject panel
- 页内切换 panel 时保留该 panel 的输入、结果和局部状态
- 离开 `Inject` 页面后，下一次重新进入按冷启动处理

本次重构的核心目标是修正交互结构与信息架构，而不是顺手重做全部 inject 业务逻辑。

## 范围

- 为 `Inject` 引入与 `Tools` 对齐的工作台壳层
- 为 inject 功能建立左侧导航与分组
- 将现有长页面拆分为多个独立 panel
- 将 `原始命令 / InvokeMethod` 并入 `Agent 状态` panel，而不是保留一级导航入口
- 保留桌面端现有能力探测、桌面桥接和业务命令语义
- 更新对应测试以覆盖新导航结构、默认激活行为和状态保留行为

## 非目标

- 不在本次重构中新增新的 inject 业务能力
- 不在本次重构中改写 Agent / Electron IPC 协议
- 不顺手重构 `StockMovePanel` 的核心搬运逻辑
- 不让 `Inject` 复用 `elsa.css` 这类页面私有样式文件
- 不在本次设计中引入跨页面持久化缓存

## 已确认上下文

### 当前页面结构

`src/inject/App.vue` 当前是一个单文件长页面，主要包含：

- 柜子奖励查询/领取
- AutoOperation Agent 状态与启动
- 仓库统计
- 批量移仓
- 高倍售价/上架建议
- 延迟查价
- 收藏价格长期扫描
- 原始命令与 `InvokeMethod`

这些能力大多共存于同一个 `App.vue` 中，导致：

- 页面纵向过长
- 常用功能与调试能力混杂
- 组件边界不清晰
- 后续继续扩展时易出现样式与状态回归

### 当前 Tools 工作台模式

`src/elsa/App.vue` 已实现较成熟的工作台结构：

- 左侧 tab 导航
- 右侧单内容区
- 已访问 panel 保留实例，切回时不重复初始化
- 页面壳层与业务 panel 在视觉和结构上分离

本次 `Inject` 重构以这套交互模型为参照，但不直接依赖 `Tools` 页面的私有样式或状态文件。

## 方案比较

### A. 轻量壳层改造，推荐

先引入 `Inject` 工作台壳层，把现有长页面改成“左侧导航 + 右侧单内容区”，并只把边界清晰的功能块拆成独立 panel。

优点：

- 风险最低
- 能最快修正页面交互结构
- 与现有 `Tools` 的用户心智最接近
- 不要求本轮立即重构所有业务状态

缺点：

- 首版落地后，`App.vue` 仍会保留一部分共享状态编排责任

### B. 中度组件化改造

在引入工作台壳层的同时，把所有 inject 功能块都拆成独立 panel 组件，由 `App.vue` 只负责装配。

优点：

- 长期维护性最好
- 业务边界最清晰

缺点：

- 本轮改动面更大
- 测试与回归成本更高

### C. 仅仿制视觉，不改结构

保留现有长页面 DOM，只增加左侧导航并通过滚动或折叠定位到对应 section。

优点：

- 表面改动最少

缺点：

- 交互模型并未真正变成工作台
- 焦点、滚动、样式和移动端体验都会更脆弱
- 未来大概率还要再重做一次

### 结论

采用 **A 作为本轮交付方案**，并有选择地吸收 **B** 中边界最清晰的组件拆分做法。

## 信息架构

`Inject` 左侧导航按两组组织：

- `基础`
  - `柜子奖励`
  - `Agent 状态`
- `交易`
  - `仓库统计`
  - `批量移仓`
  - `上架建议`
  - `延迟查价`
  - `长期扫描`

其中 `原始命令 / InvokeMethod` 不再作为一级 panel，而是并入 `Agent 状态` panel 的“高级命令区”。

这样处理的目的：

- 左侧导航只保留用户心智上的主功能入口
- 将危险度更高、调试属性更强的命令区收口到 Agent 语境下
- 降低 `Inject` 导航层级噪音

## 组件设计

建议将 `Inject` 调整为以下结构：

- `src/inject/App.vue`
  - 页面壳层
  - 左侧导航
  - 当前活动 panel 选择
  - 共享资源装配
- `src/inject/panels/InjectCabinetRewardPanel.vue`
- `src/inject/panels/InjectAgentPanel.vue`
- `src/inject/panels/InjectWarehousePanel.vue`
- `src/inject/StockMovePanel.vue`
  - 继续保留现有独立组件身份，作为一级 panel 接入
- `src/inject/panels/InjectListingPanel.vue`
- `src/inject/panels/InjectDelayedPricePanel.vue`
- `src/inject/panels/InjectCollectionScanPanel.vue`

### App.vue 责任

`App.vue` 只承担以下责任：

- 定义左侧导航配置
- 管理当前激活 panel
- 加载 `collectibles` 这类跨多个 panel 共享的数据
- 计算桌面端能力可用性
- 向子 panel 传递必要 props 或 bridge 能力

### Panel 责任

每个 panel 自己负责：

- 本 panel 的输入状态
- loading / error / result
- 本 panel 的局部交互与渲染
- 本 panel 的事件订阅解绑

核心原则是：能关在 panel 里的状态，就不要继续堆在 `App.vue` 中。

## Panel 详细边界

### 柜子奖励

仅负责柜子奖励查询/领取、最新数值与观测时间展示。

### Agent 状态

负责：

- Agent 可用性判断
- load / status / pipe 展示
- `Ping`
- `GetCurrentUI`
- `GetVisiblePanels`
- `OpenPanel`
- `ClosePanel`
- `InvokeMethod`
- 原始命令结果区

这部分是 `Inject` 的系统级控制面板。

### 仓库统计

负责：

- 拉取 `GetStockCollectibleCounts`
- 渲染聚合仓库藏品表
- 展示仓库加载错误

### 批量移仓

继续使用现有 `StockMovePanel`，只调整挂载方式与外层容器样式，不重写其核心搬运实现。

### 上架建议

负责：

- 搜索并选择藏品
- 输入数量与单价
- 拉取 listing advice
- 可选执行高价上架确认

### 延迟查价

负责：

- 搜索并选择藏品
- 配置 delay / jitter
- 启动、刷新、取消延迟查价任务
- 展示任务进度状态

### 长期扫描

负责：

- 配置扫描周期和间隔
- 启停收藏价格长期扫描
- 展示扫描进度与最新结果

## 状态与生命周期

### 页内状态保留

在 `Inject` 页内切换左侧 panel 时：

- 保留 panel 输入框内容
- 保留最近一次结果与错误态
- 保留候选列表和局部滚动位置
- 不重复执行初始化请求

实现策略与 `Tools` 保持一致，使用“已访问 panel 标记 + `v-if`/`v-show` 控制”模式，而不是每次切换都重新挂载组件。

### 离页清空

离开 `Inject` 页面后：

- 不保留任何跨路由工作台缓存
- 再次进入 `Inject` 按冷启动处理

本次设计不引入 `sessionStorage` 持久化。

如果后续 `Inject` 也需要显式跨组件清理钩子，则新增独立的 `src/shared/inject-page-lifecycle.js`，不复用 `tools-page-lifecycle.js`。

设计上明确禁止把 `Inject` 生命周期和 `Tools` 生命周期绑在同一个缓存键或同一个 leave 事件上。

## 工作台壳层与样式策略

### 共享壳层

建议新增共享工作台样式层，例如：

- `src/shared/workspace-shell.css`

只承载与页面无关的结构性样式：

- 页面头部
- 左侧导航容器
- 导航按钮激活态
- 右侧内容区
- 桌面/窄屏响应式切换

### 页面私有样式

`src/inject/inject.css` 只保留 inject 业务样式：

- 表格
- 表单
- 结果面板
- 命令按钮
- panel 内局部布局

本次重构不允许：

- 让 `Inject` 直接引入 `src/elsa/elsa.css`
- 将 inject 业务样式塞回共享壳层文件

## 交互细节

### 默认激活 panel

首次进入 `Inject` 时，默认激活左侧导航中的第一个常用 panel。

### 已访问 panel 策略

panel 首次激活时再渲染；之后保留实例并通过 `v-show` 控制显示/隐藏。

### 窄屏行为

窄屏下左侧导航折叠为顶部横向滚动 tab 条，保持与 `Tools` 接近的交互逻辑。

### 滚动策略

- 页面主壳层控制整体布局
- 具体 panel 的内容滚动由 panel 自己负责
- 避免整个页面和 panel 内容区同时形成难以控制的双重滚动

## 迁移步骤

1. 新增 `Inject` 工作台壳层和导航配置
2. 将当前长页面切为单内容区切换结构
3. 优先抽离边界清晰的 panel
4. 将 `StockMovePanel` 作为一级 panel 接入
5. 将 `Agent 状态` 与“高级命令区”合并成统一 panel
6. 补充离页清理与页内状态保留逻辑
7. 统一处理壳层样式与移动端回归

这个顺序的目标是先纠正页面结构，再逐步收敛内部组织，避免一次性大手术。

## 风险与控制

### 风险 1: App.vue 仍然过重

如果共享状态拆分不彻底，`App.vue` 可能只是从长页面变成“长容器”。

控制策略：

- 跨 panel 共享资源只保留真正通用的数据
- 其余输入、错误、结果全部下沉到各自 panel

### 风险 2: 保留实例导致旧状态误导

页内切换时保留实例，可能会保留过期错误提示或旧 loading 状态。

控制策略：

- 只保留对用户有价值的输入和最近结果
- 明确哪些一次性状态在 panel 切回时应重置

### 风险 3: 选择器与测试回归

DOM 结构变化后，现有 `App.test.js` 中依赖长页面结构的断言可能失效。

控制策略：

- 将测试从“长页面静态结构存在”调整为“导航切换后的可见性与行为”

### 风险 4: StockMovePanel 样式回归

`StockMovePanel` 从内嵌 section 变成一级 panel 后，可能出现高度、滚动和按钮排列异常。

控制策略：

- 保持其内部逻辑不动
- 只调整外层容器与 panel host 的布局契约

## 测试范围

### Inject 页级测试

更新 `src/inject/App.test.js`，覆盖：

- 左侧导航分组渲染
- 默认激活 panel
- 点击导航切换 panel
- `原始命令 / InvokeMethod` 已并入 `Agent 状态`
- 页内切换时 panel 状态保留
- 离开 `Inject` 后重新进入按冷启动处理

### Panel 级测试

对新拆出的 panel，至少覆盖一类核心行为：

- 可用性/禁用态
- 错误态
- 成功结果渲染
- 输入驱动的主要交互

### 现有独立组件测试

保留 `StockMovePanel` 现有测试，必要时只更新挂载方式与宿主容器假设。

## 验收标准

满足以下条件时，此设计对应的实现可判定完成：

- `Inject` 页面已改为 `Tools` 风格的工作台结构
- 左侧导航分为 `基础` 与 `交易` 两组
- `原始命令 / InvokeMethod` 不再占用一级导航，而是并入 `Agent 状态`
- 页内切换 panel 时保留状态
- 离开 `Inject` 页面后重新进入按冷启动处理
- `Inject` 不依赖 `Tools` 页面的私有样式文件
- 桌面与窄屏下布局都能正常显示
- 对应测试更新并通过
