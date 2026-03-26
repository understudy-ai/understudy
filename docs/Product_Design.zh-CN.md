# 产品设计

[English](./Product_Design.md)

更新于：2026-03-12

## 一句话定义

> **Understudy 是一个通用、本地运行的电脑 Agent。** 它像人类同事一样操作你的电脑 —— GUI、浏览器、Shell、文件系统 —— 在此基础上具备现代 Computer Use 能力，并从演示中学习，把成功路径固化为可复用产物，持续优化执行效率。

## 核心架构：五层递进

Understudy 的所有设计决策服务于五个递进层次。每一层以前一层为基础，构成一条从"能做"到"主动做"的完整路径。

```
Layer 1  原生 GUI 能力        →  像人一样操作电脑
   ↓
Layer 2  从人类演示中学习      →  看一遍，学会做；验证是否正确学习；和人交互真正学会
   ↓
Layer 3  学会记住              →  好的路径固定下来，避免 agent 的随机性
   ↓
Layer 4  越做越快              →  路径优化升级，自动发现更快的执行方式
   ↓
Layer 5  主动观察，互不影响    →  主动发现和执行任务，在独立空间工作
```

## Layer 1：原生 GUI 能力

**目标：** 像人一样操作电脑 — 打开应用、点击按钮、输入文字、拖拽、滚动，完成真实 GUI 任务。

### 执行路线

| 路线 | 实现 | 适用场景 |
|------|------|---------|
| `browser` | Playwright 托管浏览器 + Chrome extension relay | 网页任务、需要登录的站点 |
| `gui_*` | 截图 grounding + 原生输入事件 | 桌面应用、任意 macOS 原生应用 |

### GUI 工具面

`gui_observe`、`gui_click`、`gui_drag`、`gui_scroll`、`gui_type`、`gui_key`、`gui_wait`、`gui_move`

这些工具与 `bash`、`browser`、`web_fetch`、`web_search` 同级，由 planner/orchestrator 统一选路。

### 执行纪律

每个 GUI 动作遵循统一循环：

```
观察 → 定位目标 → 执行动作 → 重新观察 → 验证 → 记录
```

核心规则：GUI 动作串行执行。重要步骤必须重新观察 UI。验证需要新的截图。每步输出证据和 trace 数据。

### Grounding

双模型架构：主模型决定 *做什么*，独立的 grounding provider 决定 *在屏幕哪里做*。这种分离意味着规划模型不需要精确预测像素坐标，grounding 模型不需要理解任务上下文。

```
主模型: "点击提交按钮"
  → 截图（窗口模式 -l<windowId> / 显示模式 -D<displayIndex>）
    → HiDPI 归一化（Retina 物理像素 → 逻辑像素）+ 自适应缩放（≤2000×2000，≤4.5MB）
      → Grounding 模型预测：边界框 + 点击坐标 + 置信度
        → 坐标从模型空间映射回原始图像空间（modelToOriginalScale）
          → 点击点稳定化（小控件边缘偏移 >22% 纠正回中心；输入框确保点击在 18% 安全内区）
            → [小目标 ≤160px / 密集区域 ≤2% 面积] 裁切放大（≥360×320px，5× bbox）二次精炼
              → [complex 模式] 生成模拟叠加图（SVG: 十字线 + bbox + 动作标签）→ 验证模型二次确认
                → 拒绝 → 生成引导图标记失败位置 → 重试（最多 3 轮）
              → 坐标转换到屏幕显示空间（captureRect + scaleX/Y）→ CGEvent 原生执行
                → 动作后截图 → 验证结果
```

**三个坐标空间：** 物理像素（截图 PNG 原始尺寸）→ 逻辑点（macOS 显示坐标，CGEvent 需要）→ 模型像素（发送给 grounding 模型的缩放尺寸）。scaleX/Y 桥接物理到逻辑，modelToOriginalScale 桥接模型到物理。

**两种 grounding 模式：**
- `single` — 预测即返回，适用于明确目标
- `complex` — 预测后生成模拟叠加图，由验证模型（同模型不同 prompt）二次确认；拒绝则标记失败位置生成引导图，重试最多 3 轮

**防抖等待：** `gui_wait` 的 `probeForTarget()` 需要连续 2 次一致的正面或负面 grounding 结果才判定条件满足，防止单次偶发结果导致误判。

每次验证返回结构化状态：`observed`、`resolved`、`action_sent`、`condition_met`、`not_found`、`timeout`。这个信号驱动学习 — `condition_met` trace 使 Layer 3 能固化该步骤；`not_found` 触发重试、降级或用户接管。

### 个性化 UI 记忆

当前每次 grounding 独立预测，不保留历史经验。下一步：将 grounding 经验持久化为个性化 UI 记忆：

- **元素特征库** — 记住每个应用中常用元素的视觉特征、相对位置、层级关系
- **布局模型** — 积累对应用界面布局的理解，窗口大小变化时能推断元素新位置
- **成功路径缓存** — 对同一目标，复用上次成功的 grounding 策略（捕获模式、scope 提示、grounding 模式）
- **越用越准** — 对常用应用，grounding 速度和准确率随使用持续提升，不再每次从零识别同一个按钮

## Layer 2：从人类演示中学习

**目标：** 用户演示一次完整任务，Understudy 从中提炼出可复用的技能。

### Teach 模型

一次演示教会的是**完整任务**，不是零散动作：

- **原子技能** — 单一能力：点击、滚动、输入、调 API、发消息
- **任务技能** — 由原子技能、路线选择和验证组成的完整任务
- **Teach draft** — 任务技能的可编辑草稿
- **已发布任务技能** — 提升为可复用的正式 workspace 技能

### Teach 流程

```
/teach start
  → 双轨录制同时启动：
    1. screencapture -x -v -D<display> -k → .mov 视频（含点击标记）
    2. swift -e <内联脚本> → 全局事件监听（NSEvent.addGlobalMonitorForEvents）
       捕获：鼠标全事件、键盘全事件、应用切换（NSWorkspace 通知）
       每个事件通过 Accessibility API 获取语义上下文：应用名、窗口标题、
       目标元素（role、title、description、identifier、value）
       节流：鼠标移动 250ms/28px，拖拽 140ms/18px
  → 用户用鼠标键盘完成一次完整任务

/teach stop "整理周报"
  → SIGINT 停止双轨录制 → 输出 .mov + events.json
  → 证据包构建（见下文）→ AI 分析 → teach draft
  → 进入澄清对话

（自然语言多轮交互，修订 task card：标题、目标、参数槽、步骤、成功标准）

/teach confirm [--validate]
  → 检查是否还有未解决的 open questions
  → 锁定 task card；--validate 同时触发回放验证

/teach validate <draftId>
  → 作为 agent 提示实际回放学到的任务
  → 分析执行轨迹：区分阻断性失败和可恢复失败（后续有 action_sent/condition_met 恢复点的不算失败）
  → 验证状态：validated / requires_reset / failed / unvalidated

/teach publish <draftId> [skill-name]
  → 生成三层结构的 SKILL.md（见下文"泛化能力"）
  → 写入 <workspaceDir>/skills/<skill-name>/SKILL.md
  → /teach confirm 后即可发布；回放验证可在发布前或发布后按需执行
  → 热更新所有绑定同一 workspace 的活跃 session 系统提示
```

**隐私提示：** 演示产物默认保存在本地，但 teach 分析和 GUI grounding 可能会将选定的截图、关键帧或其他图像证据发送给当前配置的模型提供方。

### 不是宏录制

Understudy 学的是：

- **意图** — "整理报销单"，不是"点击坐标 (340, 892)"
- **参数** — 哪些值是固定的，哪些每次变（参数槽 `parameterSlots`）
- **成功标准** — 如何验证任务确实完成了
- **路线选项** — 每步标注 preferred / fallback / observed 路线，优先非 GUI 方式
- **组合性** — 步骤之间如何构成完整任务，可引用已有的 workspace 技能

### 证据包

`buildDemonstrationEvidencePack()` 以视频为先，不是盲抽固定帧：

1. **场景检测** — `ffmpeg -vf select='gt(scene,0.12)'` 检测视觉突变点，最小间隔 900ms
2. **事件聚类** — 按时间间隙（<1100ms）聚类事件，按事件类型（拖拽 60 / 指针 42 / 键盘 34 / 滚动 24）和重要性加权评分
3. **三源融合** — 事件引导窗口 + 场景引导窗口 + 上下文窗口（10%/50%/90% 时间点）合并去重
4. **自适应预算** — 根据复杂度（时长 + 事件数 + 场景数 + 应用种类）动态分配：最多 18 片段、64 关键帧
5. **语义关键帧** — 每片段最多 6 帧（before_action / action / settled / after_action / context ×2），提取失败时在 -250ms 和 -1000ms 偏移重试
6. **AI 分析** — 关键帧 + 代表性事件（最多 24 个）+ 能力快照（可用工具 + workspace 技能）送入模型，返回结构化 JSON

证据包解耦了产品合约和 provider 合约 — 分析后端可替换。

### 泛化能力

发布的 SKILL.md 是三层抽象结构，不是坐标录制回放：

1. **意图流程**（`## Staged Workflow`）— 自然语言描述的步骤。指令明确告知 agent："学习工作流，不是工具序列"
2. **路线选项**（`## Tool Route Options`）— 每步标注 `preferred` / `fallback` / `observed` 路线。偏好顺序：skill → browser → shell → gui。执行策略默认 `toolBinding: "adaptive"`、`stepInterpretation: "fallback_replay"`
3. **GUI 回放提示**（`## Detailed GUI Replay Hints`）— 仅作为兜底。失败策略要求：执行前 `gui_observe` 确认目标可见；目标描述从当前截图重新获取，不用录制时的坐标；路线偏离时重新规划而非盲目回放

UI 改版、窗口大小变化、甚至换了一个功能相似的应用，只要语义目标还在，技能就能执行。

### 验证与纠正

当前实现：创建 teach draft → 多轮澄清对话修订 → 可选回放验证（实际执行 + 轨迹分析）→ 发布。

完整 Layer 2 目标：回放学到的任务 → 验证结果 → 必要时纠正 → 再次回放直到证明学会了。

## Layer 3：学会记住

**目标：** 不再每次从零重新发现同一个解决方案。

**当前实现：** Layer 3 现在已经有一条可工作的 workflow crystallization 链路。它不再只是“保存一次成功 trace”，而是尝试从普通对话历史里切出完整工作单元，对历史上重复出现的工作单元做聚类，再合成为 teach 风格的 staged skill。

### 渐进固化

| 阶段 | 含义 | LLM 开销 | 用户感受 |
|------|------|---------|---------|
| Stage 0 | 纯探索 | 100% | "AI 在摸索" |
| Stage 1 | 记住路径 + 每步验证 | ~70% | "比上次快了" |
| Stage 2 | 确定性子步骤 | ~30% | "它记住了流程" |
| Stage 3 | 大部分固化 | ~5% | "一键搞定" |
| Stage 4 | 主动触发 | ~5% | "不用说就做了" |

### 当前的 Workflow Crystallization Pipeline

```
普通 prompt turn
  → 压成 compact turn record
    → 按天做 segmentation
      → 做 episode summarization
        → 跨历史做 clustering
          → 做 skill synthesis
            → 发布 workspace SKILL.md
              → 热刷新活跃 session
                → 通知用户
```

#### 1. Compact turn record

每个成功的 workspace turn 都会写入一个按天组织的 ledger。这个 compact turn 会保留：

- `timestamp`、`sessionId`、`runId`
- `userText`、`assistantText`
- 供后续阶段使用的压缩执行证据：参数提示、成功信号、不确定项、路线签名、工具链摘要

这样可以让 segmentation 保持轻量，同时又不丢掉后续总结所需的核心信号。

#### 2. Segmentation：只做对话边界判断

Segmentation 故意只看按时间排序的 `user` / `assistant` 对话，不直接吃原始 tool trace。

原因很简单：这一阶段要回答的问题是“一个真实工作从哪里开始，到哪里结束”。tool log 是证据，但会快速膨胀上下文，也容易把模型注意力从“工作边界”带偏。

输出是一个或多个 `segments`，每个 segment 包含：

- `startTurnIndex`
- `endTurnIndex`
- `completion`（`complete` 或 `partial`）

#### 3. Episode summarization：在边界确定后补回执行证据

边界确定后，summary 阶段再把 segment 和压缩执行证据一起看，生成一个 `episode`：

- `title`
- `objective`
- `summary`
- `parameterHints`
- `successSignals`
- `uncertainties`
- `keyTools`
- `routeSignature`
- `triggers`
- `completion`

这一步才真正把“几轮对话”变成“一个可复用的工作单元”。

#### 4. Clustering：找出重复工作的模式

只有 `complete` 的 episode 才会进入跨历史聚类。当前实现是 LLM-first：

- 先按意图和结果聚
- 再用执行证据做辅助判断
- 允许不同 run 之间参数值不同，但仍归到同一类工作

输出是 recurring `clusters`，包含 `episodeIds`、`title`、`objective`、`summary`、`parameterSchema`。

#### 5. Skill synthesis：产出 teach 风格 skill

被提升的 cluster 会被合成为一个真正的 workflow skill，而不是只注入一段 prompt memory。输出结构刻意靠近 teach：

- `title`、`objective`、`summary`
- `triggers`
- `parameterSlots`
- `stages`
- `routeOptions`
- `successCriteria`
- `failurePolicy`

这里有一个明确约束：`stages` 要描述**功能性工作阶段**，不是低层 GUI 点击回放。GUI 只应该出现在路线建议或 fallback 中。

### 当前的使用体验

Layer 3 的目标体验是尽量“无感”：

- 用户只是正常使用 Understudy
- 不需要显式走 `/teach`
- 分析在普通成功 turn 之后异步执行
- 用户第一次明显感知到它，通常是收到“新的 crystallized workflow skill 已发布”的通知

一旦发布，新的 skill 会通过正常 workspace skills 路径加载，并热刷新到活跃 session。对 agent 来说，crystallized skill 和普通 workspace skill 没有本质区别。

### 记忆产物

- **原子技能** — 单一能力单元
- **任务技能** — 组合的完整任务
- **定时技能** — 带触发条件的任务技能
- **可编辑技能图** — 用户可调整组合关系

就当前的 Layer 3 实现而言，最主要的产物是一个从重复完整工作中合成出来的 workspace task skill（`SKILL.md`）。

### 安全模型

- 只有验证通过的经验才会进入长期记忆
- 失败经验不污染记忆层
- 所有学习产物可版本回退

### 当前边界

- segmentation、clustering、synthesis 目前仍然是 LLM-first，不是 rule-first。
- promotion 阈值目前还是启发式策略。
- Layer 3 当前主要把重复工作固化成可复用 skill；Layer 4 式的自动路线替换还更保守、范围也更窄。

## Layer 4：越做越快

**目标：** 同一个任务不应该永远走最慢的 GUI 路径。

### 路线金字塔

同一个应用功能有多种实现方式。以"发送 Slack 消息"为例：

```
最快 ▲
     │  ① API 调用          直接调 Slack REST API（毫秒级）
     │  ② CLI 工具          slack-cli send ...（秒级）
     │  ③ 浏览器操作        在 Slack 网页版中定位输入框、输入、发送（秒级）
     │  ④ GUI 操作          在 Slack 桌面客户端中截图定位、点击、输入（秒~十秒级）
最慢 ▼
```

GUI 是万能兜底 — 任何有界面的应用都能操作。但对一个已经学会的任务，不应该永远走最慢的路径。Understudy 在日常执行中逐步发现同一功能的更快实现方式，验证后升级。

### 当前路线选择机制

#### 1. 系统提示内置偏好

每个 session 的系统提示中 `## Tool Routing` 明确告知模型：

```
直接工具/API > Shell/CLI > 浏览器 > GUI
```

这是基线引导：planner 被指示在有更高层路线可用时优先使用，只有没有更快替代时才走 GUI。无论 skill 是否经过 teach 或 crystallization，这个偏好始终生效。

#### 2. Route Guard 策略

运行时设计里包含 failure-driven route guard（`route-guard-policy`），用于追踪各路线类别的连续失败次数：`gui`、`browser`、`web`、`shell`、`process`。但在当前这条 mainline 风格分支里，默认行为更多依赖偏好引导、teach 路线标注、浏览器自动降级和能力 gating；专门的 route guard 仍然更偏实验性，而不是稳定的默认常开策略。

在启用时，它的工作原理是：

- 每次工具调用结果被归类到对应路线类别
- 失败结果递增该路线的失败计数器
- 成功结果重置该路线的计数器
- 当一条路线累积 **2 次或以上连续失败**时，策略会在下一轮模型输入中注入引导提示，建议 agent 尝试其他路线

这是一个被动安全机制 — 它不会主动搜索更好的路线，但能防止 agent 在一条失败路径上反复尝试。

#### 3. Teach 路线标注

当 skill 通过 `/teach` 创建时，发布的 SKILL.md 中每步都携带路线元数据：

- `preferred` — 该步骤已知最快的路线
- `fallback` — preferred 失败时的备用路线
- `observed` — 录制演示时实际使用的路线

执行策略默认 `toolBinding: "adaptive"`、`stepInterpretation: "fallback_replay"`，含义是：

- Agent 先尝试 preferred 路线
- 失败后按路线列表依次降级
- GUI 始终是最后兜底
- 任何时候都不盲目回放录制时的坐标

这是 Layer 2（teach）直接喂养 Layer 4（路线优化）的地方：演示不仅捕获了*做什么*，还捕获了每步*有哪些路线可用*。

#### 4. 浏览器自动降级

浏览器工具有三种模式：`auto`、`extension`、`managed`。

在 `auto` 模式（默认）下：

1. 先尝试 CDP 连接 Chrome 扩展（保留用户已登录的会话）
2. 扩展不可用或连接失败时，回退到托管 Playwright 浏览器
3. 托管浏览器在干净上下文中启动（没有现有会话）

这个降级链对 agent 透明 — 它只是调用 `browser` 工具，运行时自动处理模式选择。

#### 5. GUI 能力矩阵

并非所有 GUI 工具始终可用。运行时根据以下条件动态启用/禁用工具子集：

- **辅助功能权限** — 输入驱动类工具（click、type、drag、scroll）必需
- **屏幕录制权限** — 截图类 GUI 工具（`gui_observe` 以及基于截图 grounding 的 click/drag/wait 流程）必需
- **Grounding provider** — 视觉目标解析必需

权限缺失时，对应工具从模型的工具列表中完全隐藏，而不是在执行时才阻止。这防止 agent 围绕它无法使用的工具做规划。

### Layer 3 与 Layer 4 的关系

Layer 3 crystallization 和 Layer 4 路线优化是互补关系：

- **Layer 3** 识别*哪些工作是重复的*，并提取为可复用 skill
- **Layer 4** 识别*这些工作的每一步如何执行得更快*

实际运行中，Layer 3 crystallized 的 skill 起初继承原始工作中观察到的路线。随时间推移，Layer 4 的机制（偏好引导、teach 标注、浏览器自动降级，以及后续更成熟的 route guard 策略）推动同一个 skill 向更快的执行路径演进。

当前边界：Layer 3 可以 crystallize 一个 skill，但其中的路线仍主要继承自观察，而非主动优化。在 crystallized skill 内部做完整的路线优化是后续目标。

### 升级规则

1. 首次发现更快路径 → 只记录，不切换
2. 连续成功 + 验证通过 → 升级为默认路径
3. 任意一次失败 → 立即降级回上一层
4. 对用户透明可解释

### 未来方向：自动路线发现

当前实现依赖模型自身的知识和 teach/crystallization 的路线标注。下一步是主动路线发现：

- **API 探测** — 对给定应用，自动搜索可以完成同一任务的 CLI 工具、REST API 或 MCP tool surface
- **路线验证** — 通过新路线执行同一任务，将结果与已知正确路径对比
- **渐进提升** — 新路线连续 N 次验证成功后才提升为默认
- **失败即回退** — 已提升路线任意一次失败立即降级回上一个稳定路线

这部分尚未实现。当前系统有意保持保守：当更快路线已知时引导 agent 使用，但不会自主搜索模型从未见过的路线。

### 当前边界

- 路线优化目前是引导和安全偏好排序，不是完全自主的优化器。
- Agent 可以优先使用已知的更快路线，但尚未自动搜索全新路线。
- 自动路线提升（发现 → 验证 → 提升为默认）已设计但尚未完全实现。
- Route guard 是被动的（响应失败）而非主动的（寻求改进）。
- Layer 3 crystallization 与 Layer 4 路线升级之间的跨层集成仍在优化中。

## Layer 5：主动观察，互不影响

**目标：** 系统能长期观察和理解人类的工作模式，主动建议下一步行动，并在独立工作空间中自主执行，不干扰用户。

### 长期观察与工作理解

Layer 5 的核心不是"按指令执行"，而是"理解你在做什么"。

- **被动观察** — 在用户授权下持续观察桌面操作，不是记录每一次点击，而是识别工作模式：你每天什么时间处理邮件、用什么工具写周报、哪些操作总是重复出现
- **模式发现** — 从观察数据中自动提取重复模式，理解任务之间的依赖关系和触发条件（例如"每次收到 X 类邮件后，用户都会做 Y 操作"）
- **偏好学习** — 积累对用户工具偏好、工作节奏、沟通习惯的理解，形成个性化的工作画像

### 主动建议与预判

基于积累的观察和理解，主动建议下一步该做什么：

- **任务提醒** — "你通常周五下午整理周报，要现在开始吗？"
- **跟进建议** — "这封邮件的附件还没处理，需要我整理吗？"
- **流程优化** — "这个操作你每天都手动做三次，要我自动化吗？"
- **非侵入呈现** — 建议通过通知或消息频道推送，不弹窗打断，用户确认后才执行

### 独立工作空间

AI 在自己的工作空间执行任务，不占用用户的屏幕和鼠标键盘：

| 阶段 | 实现 | 用户体验 |
|------|------|---------|
| 当前 | 受控前台窗口 + app focus | AI 能稳定完成任务 |
| 近期 | macOS 第二桌面 / headless 窗口 | 用户可切换查看 AI 工作，互不干扰 |
| 远期 | Docker + VNC / 云 VM | AI 24 小时工作，用户不在也能执行 |

独立工作空间意味着：用户在主桌面写代码的同时，Understudy 可以在另一个桌面帮你整理邮件、更新文档、跟进任务 — 各做各的，互不影响。

### 跨应用协同

独立工作空间解锁了真正的多应用并行操作。当前在前台窗口执行时，agent 一次只能聚焦一个应用。在独立桌面中，Understudy 可以：

- **同时操作多个应用** — 邮件客户端、表格、日历、聊天工具并行打开，按任务需要在它们之间切换和传递数据
- **协调数据流动** — 从邮件中提取信息填入表格，同时更新日历事件，再把结果通过 Slack 发出去
- **复杂工作流编排** — 跨应用的多步骤任务作为一个整体执行，而不是拆成多个独立的单应用操作

### 渐进信任模型

每个技能从最保守的级别开始，只有持续成功才能提升。用户可随时降级或撤销。

| 级别 | 行为 |
|------|------|
| `manual` | 每次用户手动触发（默认） |
| `suggest` | AI 主动建议，用户确认后执行 |
| `auto_with_confirm` | AI 自动执行，用户审查结果 |
| `full_auto` | AI 自动执行 + 自动验证，仅异常时通知 |

提升条件：同一技能连续 N 次成功执行 + 无用户纠正 + 验证通过。任意一次失败立即降级。

## 设计原则

### 交互原则

| 原则 | 含义 |
|------|------|
| 可教学，不是一次性提示 | 通过演示和纠正持续塑造技能 |
| 克制通知 | 只在必要时打扰用户 |
| 透明但不啰嗦 | 可查看决策过程，但不强制展示 |
| 渐进信任 | 自主级别只能手动提升 |
| 安全降级 | 任何失败都降级到更保守的方式 |

### 学习原则

| 原则 | 含义 |
|------|------|
| 回放验证可选 | 需要额外把握时，可在发布前或发布后运行回放验证 |
| 渐进固化 | 学习是连续渐进的 |
| 可回退 | 所有学习结果可版本回退 |
| 不污染 | 只有验证通过的成功经验写入记忆 |

## 当前状态

**已实现并通过验收：**

- Layer 1–3（操作、学习、记忆）已实现并测试
- 8 个 GUI 工具 + grounding（30/30 基准测试）
- 视频优先的演示教学和 evidence pack 分析
- Workspace 技能及发布流程
- Session 持久化、执行轨迹、记忆
- 8 个频道适配器、定时任务、子 agent 委派
- 内置技能库

**坦诚说明尚未完成的：**

- Layer 4 路线发现 — 路线偏好、teach 路线标注、浏览器自动降级和能力感知选路已实现；专门的 route guard 仍偏实验性，主动路线提升和自动路线发现是后续工作
- Layer 5 被动观察 — 演示录制器可捕获全局事件，但持续后台观察和模式发现尚未实现
- Layer 5 主动建议 — 调度触发可用，基于观察的主动建议尚未发布
- Layer 5 独立工作空间 — 当前在前台窗口执行，第二桌面/headless 方案在规划中
- Layer 5 自主级别管理 — 四级模型已设计，运行时级别管理和提升/降级逻辑尚未实现
- 任务技能图 — 当前产物仍是线性 SKILL.md，不是可组合图
- Layer 1 个性化 UI 记忆 — 当前每次 grounding 独立预测，将经验（元素特征、布局模型、成功路径）持久化在规划中
- Layer 5 跨应用协同 — 依赖独立工作空间，当前单次聚焦单个应用窗口，多应用并行控制在规划中
- 跨平台 GUI — 目前以 macOS 为主
- Stage 0 → Stage 3 自动固化仍在持续优化
