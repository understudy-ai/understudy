<div align="center">

<img src="./assets/logo.svg" alt="Understudy" width="480">

<br>

**替角先观察，然后登台。**

[![CI](https://github.com/understudy-ai/understudy/actions/workflows/ci.yml/badge.svg)](https://github.com/understudy-ai/understudy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-%3E%3D20.6-green.svg)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/@understudy-ai/understudy.svg)](https://www.npmjs.com/package/@understudy-ai/understudy)
[![Discord](https://img.shields.io/badge/Discord-加入-7289DA?logo=discord&logoColor=white)](https://discord.gg/eyR2dS3f)

[英文展示页](https://understudy-ai.github.io/understudy/) · [中文展示页](https://understudy-ai.github.io/understudy/zh-CN/index.html) · [产品设计](./docs/Product_Design.zh-CN.md) · [快速开始](#快速开始) · [Showcase](#showcase) · [参与贡献](#参与贡献) · [English README](./README.md)

</div>

---

开源本地 AI Agent，一条指令操控你的整台电脑 — GUI、浏览器、终端、消息。教一次就会，越用越快。自带模型，无需订阅。

## Showcase

> **演示环境：** macOS + GPT-5.4 via Codex (OpenAI)。所有演示也支持 Claude、Gemini 等其他提供方。完整列表见[支持的模型](#支持的模型)。

下面的 demo 按产品故事递进：通用 Agent → Computer Use → Teach → 完整自主 Pipeline。

### 通用 Agent：一句话搞定

[![演示：通用 Agent](https://img.youtube.com/vi/KObeVm7MK1Y/maxresdefault.jpg)](https://youtube.com/shorts/KObeVm7MK1Y)

这是起点：Understudy 首先是一个通用 Agent。它调研网络、操控浏览器、调用技能，最终交付完整结果 —— 一条指令触发。无需分阶段操作，说出需求即可。

> *示例提示：「帮我调研 Cowork 并在 downloads 文件夹生成一个科技风落地页。」*

### Computer Use + 远程 Dispatch：手机控制桌面 Agent

[![演示：远程调度](https://img.youtube.com/vi/HlTD6Jvm3gk/maxresdefault.jpg)](https://youtu.be/HlTD6Jvm3gk)

这是 Computer Use 的实际演示：在手机上通过 Telegram 发一条消息，Understudy 在你的 Mac 上将网页转换为 PDF，打开桌面版 Telegram，找到联系人并发送 —— 全程 GUI 自动化。演示中手机画面和电脑画面并排呈现。

> *示例提示：「把 Cowork 网页转成 PDF 发给 Telegram 里的 Alex。」*

Understudy 使用你已有的消息应用：Telegram、Discord、Slack、WhatsApp、Signal、LINE、iMessage 和 Web。

### 演示教学：演示一次，精调后泛化重放

[![演示：演示教学](https://img.youtube.com/vi/ZOZU6vb4rRs/maxresdefault.jpg)](https://youtube.com/shorts/ZOZU6vb4rRs)

通过演示教会一个任务。Understudy 学习**意图**，不是坐标 —— 所以技能在 UI 改版、窗口大小变化、甚至切换到类似应用时仍然有效。交互式精调生成的技能，再用自然语言调用。重放时 Agent 自动泛化：Google 图片搜索变成浏览器自动化，下载变成 shell 命令，原生应用操控（Pixelmator Pro）保持 GUI 驱动。

> *演示流程：`/teach start` → Google 图片搜索 Sam Altman → 下载照片 → Pixelmator Pro 去背景 → 导出 → 通过 Telegram 发送给 Alex。然后交互式精调技能。最后用自然语言调用："找一张 [某人] 的照片，去除背景，用 Telegram 发送给 [某人]" —— Agent 自动发现已学技能并带着泛化升级重放。*

查看此演示[生成的已发布技能](./examples/published-skills/taught-create-a-background-removed-portrait-for-a-requested-person-and-send-it-in-telegram-cd861a/SKILL.md)，了解 teach 产出的真实示例。[完整未剪辑录屏](https://drive.google.com/file/d/1vTMpYaCOIO8IVmciI1DpvEBC6x5MaJ4f/view?usp=sharing)。

### AI 应用测评博主：一条 Prompt 到发布 YouTube

这是所有能力的集大成演示。一条 Prompt 触发一条六阶段流水线：Agent 在 Chrome 里浏览真实 App Store，通过 iPhone Mirroring 在真机上安装 Snapseed，自主探索它从未见过的功能（背景移除、黑白滤镜），在本地用 FFmpeg 合成带旁白和字幕的竖版评测视频，上传到 YouTube，最后清理设备。整个过程约一小时，零人工干预。

这条 Pipeline 引入了**工作区产物组合**：一个 Playbook 编排 Workers（确定性的浏览器/设备自动化）和 Skills（自主决策的 Agent 子会话）。中间阶段 —— 应用探索 —— 是真正的 Agentic：51 条质量门控规则引导 Agent，但它在从未见过的应用中自由导航、自主做出编辑判断。

| 发布的评测视频 | 制作过程 |
|:---:|:---:|
| [![成品](https://img.youtube.com/vi/jliTvpTnsKY/maxresdefault.jpg)](https://youtu.be/jliTvpTnsKY) | [![过程](https://img.youtube.com/vi/gYMYI0bxkJs/maxresdefault.jpg)](https://youtu.be/gYMYI0bxkJs) |

> *示例提示：「从零制作一个 Snapseed iPhone 应用评测视频：使用真实 App Store 和 iPhone Mirroring，重点拍摄背景移除和滤镜（如黑白）的操作片段，加英文旁白和字幕，导出竖版视频，以不公开方式上传到 YouTube，清理设备，分享结果。」*

[完整未剪辑录屏](https://drive.google.com/file/d/1Ap5hGWWemU04UkRm495waHjB1-3nq3g5/view?usp=sharing)。

### 为什么选 Understudy？

快照截至 2026 年 3 月 26 日，基于可公开核实的官方资料。偏保守：官方没有明确承诺的能力会写窄，不做替人放大。

| 能力 | OpenClaw | Cowork | Vy (Vercept) | Understudy |
|:---|:---|:---|:---|:---|
| GUI / Computer Use | 部分 — 浏览器自动化 | 是 | 是 | **是（macOS）** |
| 演示教学 | 否 | 否 | 是（"Watch & Repeat"） | **是** |
| 多渠道 Dispatch | 20 + 渠道 | 50 + MCP 连接器（非消息收件箱） | 否 | **内置 8 个消息渠道** |
| 开源 | 是（MIT） | 否 | 否 | **是（MIT）** |
| 使用成本 | 开源 runtime + 自带 API key | Pro $20 /月 · Max $100–200 /月 | 已于 2026-03-25 停服 | **开源 runtime + 自带 API key** |

<details><summary>资料来源</summary>

- **OpenClaw** — [GitHub](https://github.com/openclaw/openclaw) · [browser 文档](https://docs.openclaw.ai/tools/browser) · [定价](https://www.getopenclaw.ai/en/pricing)
- **Cowork** — [定价](https://claude.com/pricing) · [computer-use 公告](https://claude.com/blog/dispatch-and-computer-use) · [Cowork webinar](https://www.anthropic.com/webinars/future-of-ai-at-work-introducing-cowork)
- **Vy** — [Vercept → Anthropic](https://vercept.com/) · [Watch & Repeat 发布](https://vercept.com/changelog/0.3.0) · [workflow 更新](https://vercept.com/changelog/0.7.8)
- **Understudy** — 当前仓库（`README`、`docs/`）

</details>

## 五层递进

Understudy 的设计是一个渐进过程 —— 就像一个新员工成长为靠谱同事的路径。

```
第 1 天:   看别人怎么做
第 1 周:   模仿流程，问问题
第 1 个月: 记住了套路，独立完成
第 3 个月: 发现捷径和更好的方法
第 6 个月: 预判需求，主动行动
```

这就是 **Understudy** 这个名字的由来 —— 在戏剧中，understudy（替角演员）观看主角表演、学会角色、在需要时上场。

五层架构对应这条成长路径：

```
Layer 1 ┃ 原生 GUI 能力      像人一样操作电脑 —— 看屏幕、点击、输入、验证
────────╋───────────────────────────────────────────────────────────────────
Layer 2 ┃ 从演示中学习       用户主动演示一个任务，agent 提取意图、验证、学会
────────╋───────────────────────────────────────────────────────────────────
Layer 3 ┃ 日用渐深           日常使用中自动积累经验，把成功路径固化为确定性流程
────────╋───────────────────────────────────────────────────────────────────
Layer 4 ┃ 越做越快           自动发现并升级到更快的执行路线
────────╋───────────────────────────────────────────────────────────────────
Layer 5 ┃ 主动观察，互不影响  在独立工作空间主动发现和执行任务，不干扰用户
```

当前状态：Layer 1-2 已经实现并可用，Layer 3-4 为部分实现，Layer 5 仍是长期方向。

每一层以前一层为基础，没有捷径 —— 系统必须一步步赢得更高的能力。完整文档：**[英文展示页 →](https://understudy-ai.github.io/understudy/)** | **[中文展示页 →](https://understudy-ai.github.io/understudy/zh-CN/index.html)** | **[产品设计 →](./docs/Product_Design.zh-CN.md)**

## 工作区产物 —— Playbook、Worker、Skill

Understudy 的 Teach 和 Crystallization 管线可以产出三种工作区产物，它们可以组合成更大的自动化流程：

| 产物类型 | 角色 | 执行方式 | 示例 |
|----------|------|----------|------|
| **Skill** | 可复用的能力 | Agentic —— 在质量门控内自主决策 | `app-explore`：自由探索一个陌生的 iPhone 应用 |
| **Worker** | 确定性的子任务 | 脚本化 —— 按固定序列执行，输出结构化结果 | `appstore-browser-package`：浏览 App Store、采集元数据 |
| **Playbook** | 多阶段编排器 | 将 Workers 和 Skills 作为子会话按序编排，跨阶段管理状态 | `app-review-pipeline`：从 App Store 到 YouTube 的 6 阶段 Pipeline |

Playbook 将每个阶段作为**子 Agent（subagent）**启动 —— 独立的子会话，拥有自己的上下文窗口和工具。Workers 是确定性的：按指令执行，产出结构化输出。Skills 是 Agentic 的：接收目标和质量门控，自行决定如何实现。这种分离让同一条 Pipeline 既有脚本化的可靠性，又有真正的自主能力。

```
app-review-pipeline (playbook)
  ├─ Stage 1: appstore-browser-package   (worker)  → Chrome 自动化
  ├─ Stage 2: appstore-device-install    (worker)  → iPhone Mirroring
  ├─ Stage 3: app-explore               (skill)   → Agentic 探索
  ├─ Stage 4: local-video-edit           (skill)   → FFmpeg + Python
  ├─ Stage 5: youtube-upload             (skill)   → Chrome 自动化
  └─ Stage 6: app-review-cleanup         (skill)   → iPhone Mirroring
```

产物类型在每个 SKILL.md 的 `metadata.understudy.artifactKind` 字段中声明。Playbook 声明其子产物，E2E 测试框架验证完整契约 —— 必需输出文件、manifest schema 和阶段顺序。

## 现在能做什么

### Layer 1 — 像人一样操作你的电脑

**状态：** 已实现，当前支持 macOS。

Understudy 不只是一个 GUI 点击器。它是一个统一的桌面运行时，在同一个 agent 循环、同一个 session、同一条策略管线中混合你电脑提供的所有执行路线：

| 路线 | 实现方式 | 覆盖范围 |
|------|---------|---------|
| **GUI** | 8 个工具 + 截图 grounding + 原生输入 | 任意 macOS 桌面应用 |
| **浏览器** | 托管 Playwright + Chrome extension relay attach | 任意网站，可走干净托管浏览器，也可附着到真实 Chrome 标签页 |
| **Shell** | `bash` 工具，完全本地访问 | CLI 工具、脚本、文件系统 |
| **Web** | `web_search` + `web_fetch` | 实时信息检索 |
| **记忆** | 跨 session 语义记忆 | 持久化上下文和偏好 |
| **消息** | 8 个频道适配器 | Telegram、Slack、Discord、WhatsApp、Signal、LINE、iMessage、Web |
| **调度** | Cron + 单次定时器 | 自动化定期任务 |
| **子 Agent** | 子 session 并行工作 | 复杂多步骤委派 |

Planner 决定每一步使用哪条路线。一个任务可能浏览网站、运行 shell 命令、点击桌面应用、发送消息 —— 全在一个 session 内完成。

**GUI grounding** — 双模型架构：主模型决定*做什么*，独立的 grounding 模型决定*在屏幕哪里*。支持 HiDPI Retina 显示、小目标自动裁切精炼、两种 grounding 模式（简单预测或带模拟叠加图的多轮验证）。Grounding 基准测试：**30/30 全部命中** — 明确标签、歧义目标、纯图标元素、模糊提示。

实现细节（坐标空间、点击点稳定化、跨次反馈、捕获模式等）见 [产品设计](./docs/Product_Design.zh-CN.md)。

### Layer 2 — 从演示中学习

**状态：** 已实现。Teach 可以录制演示、分析证据、澄清任务、按需验证回放，并发布可复用 skill。

**显式教学：** 你主动演示一个桌面任务，agent 从中学会。不是宏录制 — Understudy 学的是**意图**，不是坐标。

```
/teach start                              启动双轨录制（屏幕视频 + 语义事件）
                                          → 用鼠标键盘完成一次任务

/teach stop "整理周报"                     AI 分析录制 → 提取意图、参数槽、步骤、
                                          成功标准 → 生成 teach draft
                                          → 多轮对话修订任务

/teach confirm [--validate]               锁定 task card，可选回放验证

/teach publish <draftId> [skill-name]     生成 SKILL.md → 热加载到活跃 session
```

> **Teach 隐私提示：** 演示视频、事件日志和执行轨迹默认保存在本地；但 teach 分析和 GUI grounding 在运行时，可能会将选定的截图、关键帧或其他图像证据发送给你当前配置的模型提供方。

发布的 SKILL.md 是三层抽象结构：意图流程（自然语言步骤）、路线选项（preferred / fallback 路径）、GUI 回放提示（仅作兜底，每次从当前截图重新 grounding）。UI 改版、窗口大小变化、甚至换了一个功能相似的应用，只要语义目标还在，技能就能执行。

Draft / publish 管线现在也不只支持一种产物。当前 schema 可以发布 `skill`、`worker` 和 `playbook` 这几类 workspace artifact，不过演示教学最常见的产物仍然是可复用 skill。

完整的 teach 管线、证据包构建和验证细节见 [产品设计](./docs/Product_Design.zh-CN.md)。

### Layer 3 — 日用渐深

**状态：** 部分实现。现在已经有一条可工作的 workflow crystallization 链路，但提升策略和自动路线升级还处在早期阶段。

**隐式积累：** 不需要刻意教学。你日常使用 Understudy 的过程中，它自动识别重复模式，把成功路径逐步固化为确定性流程：

| 阶段 | 发生了什么 | 用户感受 |
|------|-----------|---------|
| Stage 0 | 完全探索 | "AI 在摸索" |
| Stage 1 | 记住路径 | "比上次快了" |
| Stage 2 | 确定性子步骤 | "它记住了流程" |
| Stage 3 | 固化执行 | "一键搞定" |
| Stage 4 | 主动触发 | "不用说就做了" |

**当前的使用体验**

- 正常使用 Understudy 即可，不需要先执行 `/teach`。
- 同一个 workspace 里的重复多轮工作会在后台被压缩和分析。
- 当某类工作重复到一定程度后，Understudy 会自动发布一个 workspace skill，热加载到当前活跃 session，并发一条通知告诉你有新的 crystallized workflow 可用了。
- 后续 agent 会像使用 teach 产出的 skill 一样，通过正常的 `## Skills (mandatory)` 路径选择并使用它。

实现细节（crystallization pipeline、segmentation、clustering、skill synthesis）见 [产品设计](./docs/Product_Design.zh-CN.md)。

**当前边界**

- segmentation、clustering、skill synthesis 目前仍然是 LLM-first。
- promotion 阈值目前还是启发式策略，不是最终版 crystallization policy。
- Layer 4 式的自动路线升级还比较早期；现在日常积累主要产出的是可复用 skill，而不是彻底替换执行路线。

### Layer 4 — 越做越快

**状态：** 部分实现。路线偏好、teach 路线标注、浏览器自动降级和能力感知选路已经在工作。完全自动的路线发现、提升和失败驱动型路线策略仍在开发中。

同一个功能有多种实现方式。以"发送 Slack 消息"为例：

```
最快 ──→  1. API 调用        直接调 Slack API（毫秒级）
          2. CLI 工具        slack-cli send（秒级）
          3. 浏览器操作      在 Slack 网页版中输入发送（秒级）
最慢 ──→  4. GUI 操作        在 Slack 桌面客户端中截图定位、点击、输入（秒~十秒级）
```

第一天从 GUI 开始 — 因为 GUI 是万能兜底，任何应用都能操作。随使用积累，Understudy 逐步发现同一功能的更快实现方式，在安全验证后升级为默认路线。

**当前的使用体验**

- 系统提示明确引导 agent 优先使用更快路线：直接工具/API > Shell/CLI > 浏览器 > GUI。
- Teach 产出的 skill 里每步标注了 `preferred` / `fallback` / `observed` 路线，agent 可以跳过 GUI 直接用更快路径。
- 浏览器模式同时支持托管 Playwright 和 Chrome extension relay；在 `auto` 模式下先试 relay，不行再切换到托管 Playwright。
- GUI 能力矩阵根据可用权限动态启用/禁用工具子集，agent 不会尝试它无法执行的路线。

**实际感受**

- 新学会的任务可能一开始还走 GUI 兜底。
- 随时间推移，agent 开始优先使用更高效的路线 — 已有 skill、浏览器流程或 shell 命令 — 只要结果一致。
- 实际感受是 GUI 步骤越来越少、执行越来越快、重复绕路越来越少。
- 当更快路线不确定时，agent 会回退到较慢但更安全的路径，而不是冒险失败。

**当前边界**

- 路线优化目前是引导和安全偏好排序，不是完全自主的优化器。
- Agent 可以优先使用已知的更快路线，但尚未对每个重复任务做广泛的自动路线搜索。
- 自动路线提升（发现 → 验证 → 提升为默认）已设计但尚未完全实现。

完整的路线选择机制、升级策略和未来方向见 [产品设计](./docs/Product_Design.zh-CN.md)。

### Layer 5 — 主动观察，互不影响

**状态：** 目前仍以愿景为主。调度和运行时基础能力已经在，但被动观察、独立工作空间和主动自治还在后续阶段。

信任需要赢取，不能预设。Understudy 的终极目标不是"被动等指令"，而是成为一个能长期观察、主动行动的同事。

**长期观察与学习** — 除了显式 teach，Understudy 还能被动观察你的日常操作，分析重复模式，理解你的工作习惯和偏好。它不是记录每一次点击，而是理解你每天在做什么、什么时间做、用什么工具做。

**主动建议** — 基于积累的观察，主动建议下一步该做什么：该处理的邮件、该跟进的任务、该运行的报告。建议以非侵入方式呈现，你确认后才执行。

**独立工作空间** — 在一个互不干扰的桌面自主执行任务，不占用你正在使用的屏幕：

| 阶段 | 实现 | 用户体验 |
|------|------|---------|
| 当前 | 受控前台窗口 + app focus | AI 能稳定完成任务 |
| 近期 | macOS 第二桌面 / headless 窗口 | 用户可切换查看 AI 工作 |
| 远期 | Docker + VNC / 云 VM | AI 24 小时工作 |

**跨应用协同** — 独立工作空间解锁了真正的多应用并行操作。在自己的桌面上，Understudy 可以同时控制多个应用，协调它们之间的数据流动 — 从邮件中提取信息填入表格，同时更新日历，再把结果通过 Slack 发出去。不再是一次只操作一个窗口的单线程模式。

**渐进信任模型** — 每个技能从 `manual` 开始，只有持续成功才能提升：

| 级别 | 行为 |
|------|------|
| `manual` | 每次用户手动触发（默认） |
| `suggest` | AI 建议，用户确认后执行 |
| `auto_with_confirm` | AI 自动执行，用户确认结果 |
| `full_auto` | AI 自动执行 + 自动验证，仅异常时通知 |

## 架构

```
 ┌──────────┐ ┌───────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐
 │  终端     │ │ Dashboard │ │ WebChat │ │ Telegram │ │  Slack  │ ...
 └────┬─────┘ └─────┬─────┘ └────┬────┘ └────┬─────┘ └────┬────┘
      └──────────────┴────────────┴────────────┴────────────┘
                                  │
                    Gateway (HTTP + WebSocket + JSON-RPC)
                                  │
                     ┌────────────┴────────────┐
                     │                         │
              Session Runtime            内置工具
              + Policy Pipeline    ┌──────────────────────┐
                                   │ gui_*  │ browser     │
                                   │ bash   │ memory      │
                                   │ web    │ schedule    │
                                   │ message│ subagents   │
                                   └──────────────────────┘
```

- **本地优先** — 截图、录屏和执行轨迹默认保存在本地；GUI grounding 和演示分析在使用模型时，可能会将选定的截图或关键帧发送给你配置的模型提供方
- **统一网关** — 终端、Web、手机、消息应用都通过同一端点连接
- **统一运行时** — 聊天、教学、定时任务、子 agent 共享同一循环
- **策略管线** — 每次工具调用都经过安全、信任、日志 hook

## 快速开始

### npm 安装

```bash
npm install -g @understudy-ai/understudy
understudy wizard    # 引导完成配置
```

### 从 GitHub Packages 安装

```bash
cat >> ~/.npmrc <<'EOF'
@understudy-ai:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
EOF

npm install -g @understudy-ai/understudy
understudy wizard    # 引导完成配置
```

从 GitHub Packages 安装时，需要一个带 `read:packages` 权限的 GitHub token。内置的 `researcher` skill 默认启用，可用于带来源的多源研究和事实核查。

### 源码安装

```bash
git clone https://github.com/understudy-ai/understudy.git
cd understudy
pnpm install && pnpm build
pnpm start -- wizard
```

### 开始使用

```bash
# 推荐：启动 Gateway 后台服务，然后用终端交互
understudy daemon --start        # 启动 Gateway 后台进程（或 understudy gateway --port 23333）
understudy chat                  # 终端交互（自动连接运行中的 Gateway）

# 管理界面
understudy dashboard             # 在浏览器中打开控制面板

# 其他入口
understudy webchat               # 浏览器聊天界面
understudy agent --message "..."  # 脚本/CI 单轮调用（需要 Gateway 运行）
```

### 依赖要求

**所有安装方式都必需：**

| 依赖 | 安装方式 | 用途 |
|------|---------|------|
| Node.js >= 20.6 | `brew install node` 或 [nvm](https://github.com/nvm-sh/nvm) | 核心运行时 |

**源码安装 / 开发必需：**

| 依赖 | 安装方式 | 用途 |
|------|---------|------|
| pnpm >= 10 | `corepack enable && corepack prepare pnpm@latest --activate` | monorepo 包管理器 |

**macOS GUI 自动化（macOS 上启用 GUI 工具和演示教学时必需）：**

| 依赖 | 安装方式 | 用途 |
|------|---------|------|
| Xcode Command Line Tools | `xcode-select --install` | 编译 Swift 原生 helper（`swiftc`），实现截图和输入事件 |
| 辅助功能权限 | 详见 [macOS 权限设置](#macos-权限设置) | 鼠标/键盘输入注入、窗口查询、演示事件捕获 |
| 屏幕录制权限 | 详见 [macOS 权限设置](#macos-权限设置) | 截图、GUI grounding、演示视频录制 |

**可选：**

| 依赖 | 安装方式 | 用途 |
|------|---------|------|
| Chrome | [chrome.google.com](https://www.google.com/chrome/) | Extension relay 浏览器模式 — 访问已登录的标签页。不安装则回退到 Playwright 托管浏览器 |
| Playwright | `pnpm exec playwright install chromium` | `browser` 工具的托管浏览器。作为可选依赖安装，需下载浏览器二进制 |
| ffmpeg + ffprobe | `brew install ffmpeg` | 演示教学视频分析，提取证据包 |
| signal-cli | `brew install signal-cli` | Signal 消息频道 |

## 平台支持

Understudy 目前在 **macOS** 上开发和测试。核心功能（CLI、Gateway、浏览器、消息频道）在设计上是跨平台的，但原生 GUI 自动化和演示教学目前仅支持 macOS。Linux 和 Windows GUI 后端在规划中 —— 欢迎贡献。

## 支持的模型

Understudy 不绑定模型。使用 `provider/model` 格式配置（例如 `anthropic/claude-sonnet-4-6`）。

真实可用模型集合以当前 Understudy 运行时内置的模型目录，加上你本地 model registry 中的自定义条目为准。这个目录会随版本演进，因此 README 不再手写一份固定不变的完整 provider/model 对照表。

查看当前安装实际可用的模型，建议直接运行：

```bash
understudy models --list
understudy wizard
```

**认证和提供方说明：**

| 提供方类别 | 认证方式 | 说明 |
|-----------|---------|------|
| **Anthropic** | `ANTHROPIC_API_KEY` 或 OAuth | 当前 Understudy 运行时可用的 Claude 模型 |
| **OpenAI** | `OPENAI_API_KEY` | 当前 Understudy 运行时可用的 GPT-4.x、GPT-5.x、`o*` 等 OpenAI 模型 |
| **OpenAI Codex** | `OPENAI_API_KEY` 或 OAuth | 例如 `gpt-5.4` 这类 Codex / Responses 模型；与 OpenAI 共用认证 |
| **Google / Gemini** | `GOOGLE_API_KEY` 或 `GEMINI_API_KEY` | `gemini` 可作为 `google` 的提供方别名 |
| **MiniMax** | `MINIMAX_API_KEY` | `MiniMax-M2.7`、`MiniMax-M2.7-highspeed`、`MiniMax-M2.5`、`MiniMax-M2.5-highspeed`；使用 `minimax-cn` 提供方可切换至国内端点 |
| **更多兼容提供方** | 提供方自己的认证方式 | 取决于当前 Understudy 运行时，常见示例包括 GitHub Copilot、OpenRouter、xAI、Mistral、Groq、Bedrock、Vertex 等 |
| **自定义提供方 / 模型** | 提供方自己的认证方式 | 可以通过底层 model registry 增加自定义模型条目 |

默认：`openai-codex/gpt-5.4`。向导会从你本地运行时检测到的认证状态和模型 registry 中选择模型。

## macOS 权限设置

在 macOS 上，要获得完整的截图 grounding GUI 自动化能力，需要 native helper 加上两项系统权限。缺少权限时，GUI 工具会部分降级或被隐藏，而不是所有 GUI 能力都一起失效。

### 辅助功能

**启用功能：** 鼠标点击、输入、拖拽、滚动、按键/快捷键、绝对坐标光标移动，以及演示事件捕获。

**缺失时：** 输入驱动类 GUI 工具会被阻止；如果屏幕录制权限可用，`gui_observe` 这类观察型能力仍可能可用。

**授权方式：**

1. 打开 **系统设置 → 隐私与安全性 → 辅助功能**
2. 点击 **+** 按钮，添加你的终端应用（Terminal.app、iTerm2、VS Code 等）
3. 开启开关

### 屏幕录制

**启用功能：** `gui_observe` 的截图采集、GUI grounding/验证，以及演示视频录制。

**缺失时：** 基于截图 grounding 的 GUI 工具会被阻止；`gui_key`、`gui_move` 这类不依赖截图的输入路径仍可能可用，`gui_scroll` 和 `gui_type` 也还能以不带 `target` 的方式运行。

**授权方式：**

1. 打开 **系统设置 → 隐私与安全性 → 屏幕录制**
2. 点击 **+** 按钮，添加你的终端应用
3. 开启开关
4. 重启终端应用使权限生效

> 两项权限都需要授权给运行 `understudy` 的终端应用，而不是 Understudy 本身。
>
> 如果授权后 GUI 能力仍然不完整，运行 `understudy doctor --deep` 检查 native helper、grounding、浏览器运行时和 teach-analysis 依赖是否齐全。

## 技能系统

内置技能 + 你自己创建或安装的 workspace 技能。

```bash
understudy skills --list                    # 浏览可用技能
understudy skills install <名称或URL>        # 从注册表或 URL 安装

# 或通过演示教学
/teach start → 演示 → /teach stop → /teach confirm
→ /teach publish <draftId>
# 可选：在发布前或发布后运行 /teach validate <draftId>
```

## 消息频道

8 个内置频道适配器：Web、Telegram、Discord、Slack、WhatsApp、Signal、LINE、iMessage。

```bash
understudy channels --list
understudy channels --add telegram
```

## 仓库结构

```
apps/cli           CLI 入口，20+ 操作命令
packages/core      Agent session runtime、配置、认证、技能、策略
packages/gateway   HTTP + WebSocket 网关、session runtime、Web 界面
packages/gui       原生 GUI runtime、截图 grounding、演示录制器
packages/tools     内置工具：浏览器、Web、记忆、调度、GUI、消息
packages/channels  频道适配器（8 个平台）
packages/types     共享 TypeScript 类型定义
skills/            内置技能模块
examples/          Teach 演示及已发布技能示例
docs/              愿景、产品设计文档
```

## 开发

```bash
pnpm install          # 安装依赖
pnpm build            # 构建所有包
pnpm test             # 运行测试
pnpm lint             # oxlint 代码检查
pnpm typecheck        # 类型检查所有包
pnpm check            # 完整校验：build + lint + typecheck + test
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=understudy-ai/understudy&type=Date)](https://star-history.com/#understudy-ai/understudy&Date)

## 致谢

Understudy 构建于以下优秀开源项目的思路和代码之上：

| 项目 | 我们从中学到的 |
|------|--------------|
| [OpenClaw](https://github.com/openclaw/openclaw) | Gateway 架构、多频道设计、技能生态模式 |
| [pi-mono](https://github.com/badlogic/pi-mono) | Agent 核心运行时、统一 LLM API、TUI 基础设施 |
| [NanoClaw](https://github.com/nanoclaw/nanoclaw) | 极简 agent 设计、扩展模式 |
| [OSWorld](https://github.com/xlang-ai/OSWorld) | GUI agent 基准测试方法论、computer use 评测 |
| [openai-cua-sample-app](https://github.com/openai/openai-cua-sample-app) | Computer use agent 参考实现 |

特别感谢 [Mario Zechner](https://github.com/badlogic) 提供的 `pi-agent-core` 基础，它驱动了 Understudy 的 agent 循环。

## Contributors

感谢所有为 Understudy 做出贡献的开发者。

<a href="https://github.com/understudy-ai/understudy/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=understudy-ai/understudy" alt="Contributors" />
</a>

## 参与贡献

参见 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解贡献指南。

我们特别欢迎以下方向的贡献：

- **GUI 后端** — Linux (AT-SPI) 和 Windows (UIA) 原生 GUI 支持
- **技能** — 热门应用和工作流的新技能模块
- **路线发现** — 自动 API 检测和升级逻辑（Layer 4）
- **教学改进** — 更好的 evidence pack 分析和验证
- **文档与翻译**

## 许可证

[MIT](./LICENSE)

---

<div align="center">

**观察 → 学习 → 记住 → 优化 → 预判**

*这就是整个产品。*

</div>
