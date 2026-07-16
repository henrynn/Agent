# Agent Harness for Computer Control

> 架构深度对比：GUI 视觉操控、浏览器自动化、终端/代码执行三大家族
>
> 基于 `agent-harness-report.html` 生成（2026-07-13）

详细版项目说明请见 [README.detail.md](README.detail.md)。

---

## 00. 核心洞察

所有 computer-control agent 的本质是同一件事：

- 一个被增强的 LLM（工具 + 检索 + 记忆）运行「感知 -> 推理 -> 动作」反馈循环
- 每一步都通过环境返回的 ground truth 做纠错

三大家族真正的分野不在“是否用 LLM”，而在：

- 感知层是什么
- grounding（定位）机制是什么

一句话总览：

- 三者不是竞品，而是感知层光谱
- 能拿文本就别碰 DOM，能拿 DOM 就别数像素
- 视觉操控是最后手段的通用层，代价是 grounding 不确定性
- 最佳实践是分层混合：结构化部分走终端/浏览器 harness，封闭 GUI 才回退视觉

---

## 01. 三大架构家族

### 家族 ①：GUI 视觉操控

代表：Anthropic Computer Use、OpenAI CUA/Operator、UI-TARS

- 感知：纯截图（周期帧）
- 动作：虚拟鼠标 + 键盘

### 家族 ②：浏览器自动化

代表：browser-use、Skyvern、Playwright MCP

- 感知：DOM/CDP 结构化页面数据（截图可选）
- 动作：高层交互（click/fill/type 等）

### 家族 ③：终端 / 代码 harness

代表：Claude Code、OpenAI Codex CLI、OpenHands

- 感知：纯文本与执行结果
- 动作：shell 命令 + 文件编辑 + 工具调用

---

## 02. 跨维度对比矩阵

| 维度 | ① GUI 视觉操控 | ② 浏览器自动化 | ③ 终端 / 代码 |
|---|---|---|---|
| 感知层 | 纯截图，周期性帧（非视频流） | 结构化页面数据（DOM/CDP），截图可选 | 纯文本（终端输出、文件、执行结果） |
| grounding 机制 | 像素 -> 坐标映射（核心瓶颈） | DOM 元素索引，无需空间坐标 | 无需空间定位（路径/行号即地址） |
| 动作空间 | 通用虚拟鼠标+键盘（像素级 click/type/scroll） | 高层交互（open/click/type/fill） | shell + 文件编辑 + 工具调用 |
| Agent Loop | 截图入上下文 -> 推理 -> 动作 -> 重观察 -> 重试 | NL 任务 -> 多步循环 -> 返回动作历史 | 写代码/命令 -> 执行 -> 读结果 -> 迭代 |
| 通用性 vs 精度 | 通用性最强，精度最弱 | 仅浏览器，但精度高且稳定 | 仅可脚本化环境，精度最高 |
| 安全 / 沙箱 | 虚拟机 / 远程桌面隔离 | 独立浏览器上下文 | Docker 沙箱（原生一等设计） |

---

## 03. GUI 视觉操控：grounding 是决定性难题

共性（Anthropic / OpenAI / UI-TARS）：

- 都是“看截图 -> 决策 -> 鼠键动作”
- 差异主要在如何把视觉感知映射到精确坐标

主要路线：

- Anthropic：强调 counts pixels（像素计数）来移动光标
- OpenAI CUA：监督学习负责感知与控制，强化学习负责推理恢复
- UI-TARS：端到端统一动作空间，不依赖外部编排

已知硬伤：

- 截图是离散帧，会漏掉两帧间的瞬时变化
- OSWorld（arXiv 2404.07972）显示主要瓶颈就是 GUI grounding

---

## 04. 浏览器自动化：绕开像素，利用结构化

这一路线的关键权衡是：快而脆 vs 抗变但贵。

### browser-use（DOM/CDP 路线）

- 直接走 CDP（Chrome DevTools Protocol）
- 操作索引后的可交互元素，而不是点像素
- 截图可选
- 优点：快、低成本、定位准确
- 代价：依赖 DOM 结构稳定

### Skyvern（视觉优先路线）

- 以 Vision LLM 作为主感知
- 不预设 XPath/selector
- 借助多 agent 协作理解网页并规划执行
- 优点：抗页面改版
- 代价：更慢、更贵

---

## 05. 终端 / 代码 harness：最成熟、最可靠

这是最纯粹的“工具调用 + 执行反馈”闭环：

- 无需截图
- 无需 DOM
- 直接使用文本地址（路径、行号、命令）

代表：

- OpenHands：代码/命令/网页操作 + Docker 沙箱，安全性强
- Codex CLI：本地终端运行，轻量且直接

为何最可靠：

- 不存在空间 grounding 误差
- ground truth 来自真实执行结果，反馈信号强

---

## 06. 选型结论

| 维度 | 最优家族 | 说明 |
|---|---|---|
| 通用性（任意软件） | ① GUI 视觉操控 | 唯一可覆盖无 API、无 DOM 的封闭 GUI |
| 可靠性 / 精度 | ③ 终端 / 代码 | 文本地址精确，无 grounding 误差 |
| Web 任务性价比 | ② 浏览器自动化 | 有 DOM 时显著优于像素路线 |
| 安全隔离成熟度 | ③ 终端 / 代码 | Docker 沙箱是原生设计 |
| 核心技术瓶颈 | ① GUI 视觉操控 | grounding 是主要失败源 |

---

## 核查与局限

核查说明：

- 7 组核心论断为 high confidence
- 采用 3 票对抗式核查
- 证据来自厂商一手资料 + arXiv 基准

局限：

- 厂商自述可能带宣传偏差
- 领域迭代很快，部分框架在当前批次覆盖不完整

---

## 参考来源

- Anthropic: Developing Computer Use
- OpenAI: CUA / Operator System Card
- UI-TARS: arXiv 2501.12326
- OSWorld: arXiv 2404.07972
- browser-use / Skyvern 官方仓库
- OpenHands: arXiv 2407.16741
- OpenAI Codex CLI 仓库
- Anthropic: Building Effective Agents
