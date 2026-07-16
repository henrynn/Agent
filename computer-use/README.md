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

## GitHub Check-in 建议

提交前建议确认：

- `README.md` 已更新并可独立说明项目用途
- `bench-results.json` 是否为你希望保留的结果快照
- 验证截图为临时产物，默认不提交（已由 `.gitignore` 忽略）
- 不提交 `node_modules/`
- `.gitignore` 已配置（含 `node_modules/` 与验证截图）

## 说明

- 多数 `verify-*.mjs` 使用 Playwright 做端到端检查与截图。
- 个别验证脚本里写死了本地 HTML 绝对路径，跨机器运行前请先改为当前仓库路径。
