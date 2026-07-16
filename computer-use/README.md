# research-cua

一个用于研究和演示“多范式计算机控制/信息提取”的实验仓库。

核心目标：围绕同一任务（以 Hacker News 前 10 条结构化提取为例），对比 API、DOM、CDP、a11y、视觉等路径在延迟、token 成本、稳定性上的差异，并提供可演示页面与自动化验证脚本。

## 目录整理

```text
research-cua/
├─ bench-core.mjs               # 核心两路基准：API vs DOM
├─ bench-browser.mjs            # 浏览器三路基准：Vision / a11y / CDP
├─ bench-all.mjs                # 汇总五路并输出 bench-results.json
├─ bench-results.json           # 基准结果样例/缓存数据
├─ demo-server.mjs              # 本地演示服务（http://localhost:8848）
├─ demo-live.html               # 演示页（由 demo-server 提供）
│
├─ agent-computer-control-report.html  # 研究报告页（静态）
├─ agent-harness-report.html           # 相关报告页（静态）
│
├─ verify-demo.mjs              # 验证演示页的一键全跑、赢家高亮、截图
├─ verify-code-modal.mjs        # 验证演示页“看代码”弹层
├─ verify-report.mjs            # 验证报告页图表/表格渲染
├─ verify-report-code.mjs       # 验证报告页“看代码”弹层
├─ verify-a11y-section.mjs      # 验证报告页 a11y 章节与导航
├─ verify-skyvern.mjs           # 验证报告页 Skyvern 弹层内容
├─ verify-uia-report.mjs        # 验证报告页 UIA 卡片与弹层
│
├─ uia-a11y-demo.py             # Windows UIA 桌面无障碍树实测示例
│
│
├─ package.json
├─ package-lock.json
└─ node_modules/                # 本地依赖（不建议提交）
```

## 快速开始

### 1) 环境要求

- Node.js 18+
- Windows（`uia-a11y-demo.py` 依赖 Windows UI Automation）
- Python 3（仅运行 `uia-a11y-demo.py` 时需要）

### 2) 安装依赖

```bash
npm install
```

### 3) 运行基准

```bash
node bench-core.mjs
node bench-browser.mjs
node bench-all.mjs
```

运行 `bench-all.mjs` 后会更新 `bench-results.json`。

### 4) 启动演示服务

```bash
node demo-server.mjs
```

浏览器打开：`http://localhost:8848`

### 5) 运行验证脚本（可选）

```bash
node verify-demo.mjs
node verify-code-modal.mjs
node verify-report.mjs
node verify-report-code.mjs
node verify-a11y-section.mjs
node verify-skyvern.mjs
node verify-uia-report.mjs
```

## 报告核心对比数据与结论

以下内容摘自 `agent-computer-control-report.html` 与 `agent-harness-report.html`，并与 `bench-results.json` 保持一致，方便不打开 HTML 也能快速查看。

### 同任务五路实测（HN Top10 提取）

| 路径 | 感知形态 | 延迟 (ms) | LLM tokens | Payload (B) | 关键观察 |
|---|---|---:|---:|---:|---|
| API/MCP | 结构化 JSON | 1056 | 294 | 11172 | 最稳、最易维护，字段缺失 0% |
| DOM 正则 | 原始 HTML | 815 | 8689（裁剪后 291） | 34754 | 速度快，但对页面结构更脆弱 |
| CDP 页内提取 | DOM evaluate | 1220 | 288 | 1153 | token 与 payload 最低，综合性价比最佳 |
| a11y AX 树 | 语义控件树 | 1429 | 13812 | 55249 | 不裁剪时 token 反而最高（AX 全树噪声大） |
| 视觉截图 | PNG 像素 | 3043 | 1536 | 123661 | 通用性最高，但最慢、载荷最重 |

### 关键结论（工程选型）

- 能用 API/MCP 就不要点 UI：通常最快、最稳、最便宜。
- 浏览器场景优先 CDP/DOM：实测中 CDP 路径 token 最低（288），且字段完整。
- a11y 不是天然省 token：完整 AX 树若不裁剪，会比整页 HTML 更贵。
- 视觉范式是“通用兜底”而非默认首选：可覆盖任意 GUI，但延迟和 payload 成本最高。
- 终端/代码 harness 在可靠性与可控性上最强：以文本地址和执行结果闭环，避免像素级 grounding 误差。

### 基准结论（报告快照）

- OSWorld 发布期对比：人类约 72.36%，模型与人类仍有明显差距。
- 报告强调的核心瓶颈是 GUI grounding（定位与对齐），这是纯视觉路径的主要失败来源。
- 因此推荐策略是“分层降级”：API/MCP -> DOM/CDP -> a11y -> 视觉兜底。

## 报告主要内容（详细版）

本节按 `agent-computer-control-report.html` 的 01-09 章节重排为 Markdown，便于在仓库首页直接阅读。

### 01 总框架：怎么看、怎么动

所有计算机控制方案都可以拆成两件事：

- 怎么看：像素、DOM、a11y 语义树、API 数据。
- 怎么动：鼠标键盘、选择器/CDP、控件级 invoke、函数调用。

| 范式 | 怎么看（感知） | 怎么动（动作） | 作用层 |
|---|---|---|---|
| ① 像素视觉 | 屏幕截图（像素） | 鼠标/键盘坐标动作 | 任意 GUI |
| ② DOM/CDP | HTML DOM 结构 | 选择器/CDP 协议 | 浏览器内部 |
| ③ 无障碍树 a11y | OS 语义控件树 | 控件级 invoke | 桌面 + 网页 |
| ④ API/MCP | 结构化数据/schema | 直接函数调用 | 绕过 UI |
| ⑤ 混合 | 截图 + DOM 标注框 | 定位后执行 | 主要浏览器 |

核心判断：

- 通用性与可靠性/成本通常成反比。
- 越靠近 API，越快、越便宜、越稳定；越靠近像素，越通用但越贵、越慢、越不稳定。

### 02 四范式通用优劣（综合打分）

| 范式 | 通用性 | 可靠性 | 速度 | 低成本 | 可维护性 | 结论标签 |
|---|---:|---:|---:|---:|---:|---|
| ① 像素视觉 | 5 | 2 | 2 | 1 | 3 | 最通用、最贵 |
| ② DOM/CDP | 2 | 4 | 5 | 5 | 2 | 最快、仅浏览器 |
| ③ 无障碍树 | 4 | 4 | 4 | 3 | 3 | 结构化、看覆盖 |
| ④ API/MCP | 1 | 5 | 5 | 5 | 5 | 最稳、需接口 |
| ⑤ 混合 | 3 | 4 | 3 | 2 | 4 | 抗改版、较贵 |

补充定位：

- ③ a11y 在像素与 DOM 之间：结构化但依赖应用无障碍实现质量。
- ④ API/MCP 是“天花板路线”：能调接口就不要模拟 UI。

### 03 a11y：浏览器与桌面的同构语义树

统一认识：

- 浏览器里可通过 CDP `Accessibility.getFullAXTree` 获取 AX 树。
- 桌面可通过 OS 无障碍 API 获取同构语义树：`role + name + state`。

三平台入口：

| 平台 | API | 备注 |
|---|---|---|
| Windows | UI Automation (UIA) | 生态成熟，Win32/WPF/UWP/Electron 常见 |
| macOS | AXUIElement (AX) | 需辅助功能/屏幕录制权限 |
| Linux | AT-SPI2 | 基于 D-Bus，GNOME/GTK/Qt 常见 |

结论：

- 标准控件应用：优先 a11y，稳且省 token（前提是裁剪树）。
- 自绘 UI/Canvas/游戏：a11y 往往为空，需要视觉兜底。

### 04 具名工具对比（要点）

视觉家族（范式①）：

- Claude Computer Use：纯截图+鼠键动作，通用强但慢且易出错。
- UI-TARS：端到端视觉模型，发布期 OSWorld 数字优于 Claude 同期。
- Operator/Mariner：方向一致，部分指标为二手数据。

浏览器与混合家族（范式②/⑤）：

- browser-use：DOM 驱动为主，历史宣传中的部分 SOTA/提速口径已证伪。
- Stagehand：在确定性脚本中插入 AI，强调可控性；若干旧表述已证伪。
- Skyvern：截图 + DOM + Set-of-Marks，抗改版但更耗算力。
- LaVague：将动作编译成 Selenium/Playwright 代码，便于审计复用。
- WebVoyager：研究基准与混合范式样例，成功率口径清晰。
- Playwright/Puppeteer/Selenium：执行层最快最准，但不具备 AI 泛化能力。

### 05 Demo 对决设计

统一任务：

- 从 Hacker News 首页提取前 10 条 `{标题, 分数, 作者, 评论数}`。

统一指标：

- 端到端延迟（ms）
- LLM tokens（上下文估算）
- 网络 payload（字节）
- 解析步数与字段缺失率（脆性）

五条实跑路径：

- ① 视觉截图
- ② DOM 正则
- ②b CDP 页内提取
- ③ a11y AX 树
- ④ API/MCP 直连

### 06 实测结果与反直觉发现

详细数值见上方“同任务五路实测”表；这里给出关键洞察：

- CDP 页内提取是隐藏赢家：token 最低（288）、payload 最小（1153B）。
- a11y 全树若不裁剪会非常贵：13812 tokens，高于整页 HTML 路径。
- 视觉单张截图 token（1536）低于未裁剪文本树，但延迟最慢、payload 最重。

数据语义提醒：

- API 路拿的是 `front_page` 快照。
- DOM/CDP 路拿的是实时页面。
- 两者内容排序不同是“数据源定义差异”，不是某一路错。

### 07 学术基准速查（发布期口径）

| 基准 | 覆盖 | 发布期关键数字 |
|---|---|---|
| OSWorld | 369 真实电脑任务，三系统 | 人类 72.36%，最佳模型 12.24%，Claude 14.9%→22%，UI-TARS-72B 24.6% |
| WebVoyager | 643 任务/15 网站 + 90 GAIA | 59.1% |
| WebArena | 可复现 Web 环境 | Operator 报告 58.1%（二手） |

说明：这些是发布期快照；到 2026 视角，SOTA 已持续上升。

### 08 工程选型决策树

优先级建议：

1. 有 API/MCP：直接 ④。
2. 仅浏览器且结构稳定：②（必要时接入 browser-use/Stagehand）。
3. 网页多变/频繁改版：⑤（Skyvern/SoM）。
4. 原生桌面且 a11y 覆盖好：③。
5. 无 API、无可用 a11y 或高度自绘：① 视觉兜底。

反直觉提醒：

- 能不用视觉就不用视觉。
- 纯 LLM Agent 在关键流程需确认、重试与回滚护栏。

### 09 局限与勘误

- 部分工具结论依赖发布期资料与厂商口径，需持续复核。
- 已证伪口径（勿引用）：
	- browser-use `89.1% WebVoyager SOTA`
	- browser-use `bu-2-0 提速 3–5×`
	- Stagehand `具体为 CDP-engine`
	- Stagehand `act/agent/extract 三原语`
- Demo 为单机单批次运行，延迟受网络波动影响；token 为估算值，结论侧重“数量级差异”。

### 主要来源

- Anthropic Computer Use / MCP
- UI-TARS（arXiv 2501.12326）
- OSWorld（arXiv 2404.07972）
- WebVoyager（arXiv 2401.13919）
- GUI Agents Survey（arXiv 2411.18279）
- Set-of-Mark（arXiv 2310.11441）
- browser-use / Stagehand / Skyvern / LaVague / WebArena 官方资料

