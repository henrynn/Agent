# research-cua

一个用于研究和演示“多范式计算机控制/信息提取”的实验仓库。

## 先看结论（TL;DR）

### 三条结论

- 能用 API/MCP 就不要点 UI：通常最快、最稳、最省成本。
- 浏览器任务优先 DOM/CDP：实测里 CDP 路径 token 最低、字段完整、综合性价比最高。
- 视觉范式是“通用兜底”而非默认首选：覆盖最广，但延迟和 payload 成本最高，核心瓶颈是 GUI grounding。

### 同任务五路实测（HN Top 10）

| 路径 | 感知形态 | 延迟 (ms) | LLM tokens | Payload (B) | 关键观察 |
|---|---|---:|---:|---:|---|
| API/MCP | 结构化 JSON | 1056 | 294 | 11172 | 最稳、最易维护，字段缺失 0% |
| DOM 正则 | 原始 HTML | 815 | 8689（裁剪后 291） | 34754 | 快，但结构脆弱 |
| CDP 页内提取 | DOM evaluate | 1220 | 288 | 1153 | token 与 payload 最低，综合赢家 |
| a11y AX 树 | 语义控件树 | 1429 | 13812 | 55249 | 全树不裁剪时 token 最高 |
| 视觉截图 | PNG 像素 | 3043 | 1536 | 123661 | 通用性最高，但最慢最重 |

### 融合总结（结合 agent-harness-report）

`agent-computer-control-report.html` 偏“范式与实测”，`agent-harness-report.html` 偏“家族级方法论”。两者合并后的决策是：

| 维度 | ① GUI 视觉操控 | ② 浏览器自动化 | ③ 终端/代码 harness |
|---|---|---|---|
| 通用性 | 最高（任意 GUI） | 中（浏览器内） | 低（可脚本化环境） |
| 精度/可靠性 | 最受 grounding 影响 | 高（DOM 元素级） | 最高（文本地址天然精确） |
| 成本/速度 | 成本高、速度慢 | 成本低、速度快 | 成本低、反馈最干净 |
| 典型场景 | 无 API、无 DOM 的封闭应用 | Web 业务自动化 | 编码、运维、可审计流程 |
| 关键瓶颈 | 像素到坐标映射 | 依赖页面结构稳定性 | 工具链与执行权限治理 |

### 选型顺序（建议）

1. API/MCP 可用：直接走 API/MCP。
2. 仅浏览器且结构稳定：DOM/CDP。
3. 页面频繁改版：混合范式（视觉 + DOM）。
4. 原生桌面且无障碍覆盖好：a11y。
5. 无 API/无可用 a11y/高自绘：视觉兜底。

## 报告整合摘要

### 核心框架

- 怎么看：像素、DOM、a11y、API 数据。
- 怎么动：鼠标键盘、选择器/CDP、控件 invoke、函数调用。

### 关键洞察

- 通用性与可靠性/成本成反比。
- a11y 不是天然省 token：完整 AX 树如果不裁剪，可能比整页 HTML 更贵。
- 同一任务在不同数据源（API 快照 vs 实时 DOM）下可能结果不同，这是“数据语义差异”，不是实现错误。
- 终端/代码 harness 在可靠性和可控性上最强，因其不依赖空间 grounding。

### 学术与发布期快照（用于参考）

- OSWorld：人类约 72.36%，发布期模型与人类有明显差距。
- WebVoyager：59.1%（发布口径）。
- WebArena：58.1%（二手口径）。

说明：上述数字是发布期快照；到 2026 视角，SOTA 持续上升，建议把“趋势”当结论、把“绝对数值”当历史快照。

## 安装与运行（放在后面）

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

浏览器打开：`http://localhost:8848`。

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
├─ agent-computer-control-report.html  # 深入报告（范式+实测）
├─ agent-harness-report.html           # 总结报告（家族+架构）
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
├─ package.json
├─ package-lock.json
└─ node_modules/                # 本地依赖（不建议提交）
```

## GitHub Check-in 建议

- `README.md` 已更新并可独立说明项目用途。
- `bench-results.json` 是否为你希望保留的结果快照。
- 验证截图为临时产物，默认不提交（已由 `.gitignore` 忽略）。
- 不提交 `node_modules/`。
- `.gitignore` 已配置（含 `node_modules/` 与验证截图）。

## 说明

- 多数 `verify-*.mjs` 使用 Playwright 做端到端检查与截图。
- 个别验证脚本里写死了本地 HTML 绝对路径，跨机器运行前请先改为当前仓库路径。

