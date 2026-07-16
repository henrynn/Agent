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
├─ demo-*.png / report-*.png    # 验证脚本运行后按需生成（默认不入库）
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
