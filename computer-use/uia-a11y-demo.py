# -*- coding: utf-8 -*-
"""
Windows UIA a11y demo —— 桌面原生应用的"无障碍树"实测
================================================================
对照报告里浏览器的 CDP Accessibility.getFullAXTree：
  浏览器: page.context().newCDPSession -> Accessibility.getFullAXTree
  桌面:   Windows UI Automation (UIA) -> 遍历 ControlType 树

本 demo 用系统计算器（标准 UWP 控件，无障碍实现完整）演示：
  1) 读控件树（= 桌面版 AX 树，纯语义、无像素）
  2) 按"控件名"点按钮算 7 × 8（不算任何屏幕坐标）
  3) 读回结果，全部为真实运行输出
"""
import sys, io, time, json, subprocess
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
import uiautomation as auto

auto.SetGlobalSearchTimeout(5)

def line(): print('-' * 60)

# ── 1. 启动真实桌面应用：系统计算器 ──────────────────────────
print('启动系统计算器（真实桌面 App）…')
subprocess.Popen('calc.exe')
time.sleep(2.0)  # 等 UWP 壳子把真正的窗口拉起来

# calc.exe 只是启动器，真窗口叫 "Calculator" / 中文"计算器"
calc = None
for name in ('Calculator', '计算器'):
    w = auto.WindowControl(searchDepth=1, Name=name)
    if w.Exists(2):
        calc = w; break
if not calc:
    # 兜底：按 ClassName 找
    calc = auto.WindowControl(searchDepth=1, ClassName='ApplicationFrameWindow')

print('窗口标题 :', calc.Name)
print('控件类型 :', calc.ControlTypeName)
r = calc.BoundingRectangle
print('窗口位置 :', f'({r.left},{r.top})-({r.right},{r.bottom})  ← 有坐标但我们不靠它点像素')
line()

# ── 2. 读控件树（桌面版 AX 树）──────────────────────────────
print('■ UIA 控件树（前若干层）—— 这就是桌面应用的"无障碍树"')
line()
node_count = [0]
def walk(ctrl, depth=0, max_depth=3, max_per_level=8):
    if depth > max_depth: return
    kids = ctrl.GetChildren()
    for c in kids[:max_per_level]:
        node_count[0] += 1
        name = (c.Name or '').strip().replace('\n', ' ')[:24]
        indent = '  ' * depth
        # role(ControlType) + name —— 和 AX 树的 {role, name} 一模一样
        print(f'{indent}{c.ControlTypeName:<18} {name}')
        walk(c, depth + 1, max_depth, max_per_level)
walk(calc)
print(f'\n（已展示 {node_count[0]} 个节点；完整树更大，和报告"AX全树很吵"同理）')
line()

# ── 3. 按"控件名"语义操作：算 7 × 8 ─────────────────────────
print('■ 语义操作：按钮按【名字】点，全程不算屏幕坐标')
line()
def tap(names):
    """按控件 Name 找按钮并调用 UIA 的 Invoke —— 不是模拟鼠标点像素"""
    for n in names:
        btn = calc.ButtonControl(Name=n)
        if btn.Exists(1):
            btn.GetInvokePattern().Invoke()   # UIA 语义级"激活控件"
            print(f'  Invoke 按钮  Name="{n}"  ({btn.ControlTypeName})')
            time.sleep(0.15)
            return True
    print(f'  [跳过] 未找到按钮 {names}')
    return False

# 中英文按钮名都试（不同系统语言）
tap(['七', 'Seven', '7'])
tap(['乘', 'Multiply by', 'Multiply'])
tap(['八', 'Eight', '8'])
tap(['等于', 'Equals'])
time.sleep(0.4)
line()

# ── 4. 读回结果（从结果控件的 Name/Value 里拿，仍是纯语义）──
print('■ 读回结果 —— 从结果显示控件的语义属性里取，非 OCR 截图')
line()
result_text = None
for auto_id in ('CalculatorResults',):
    disp = calc.TextControl(AutomationId=auto_id)
    if disp.Exists(1):
        result_text = disp.Name
        break
if not result_text:
    # 兜底：找名字里带"显示为"/"Display is"的控件
    for c in calc.GetChildren():
        for sub in c.GetChildren():
            if sub.Name and ('显示' in sub.Name or 'Display is' in sub.Name):
                result_text = sub.Name; break

print('  结果控件读到 :', result_text)

# ── 5. 断言 + 结构化输出（对照 HN demo 的 JSON 汇报）────────
line()
ok = result_text and ('56' in result_text)
summary = {
    'paradigm': 'a11y / desktop UIA',
    'target_app': calc.Name,
    'perception': 'UI Automation control tree (semantic, no pixels)',
    'tree_nodes_shown': node_count[0],
    'operation': '7 × 8 via Invoke(button.Name)',
    'result_text': result_text,
    'pixel_coordinates_used': False,
    'assert_equals_56': bool(ok),
}
print('■ 结构化汇报')
line()
print(json.dumps(summary, ensure_ascii=False, indent=2))
line()
print('断言 7×8=56 :', '✓ 通过' if ok else '✗ 失败')

# 收尾：关掉计算器
try: calc.GetWindowPattern().Close()
except Exception: pass
