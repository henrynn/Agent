// 验证报告里的"看代码"弹层：加载本地 HTML，点表格里 CDP 那行的看代码，确认弹层内容
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const url = pathToFileURL('C:/work/builder/research/agent-computer-control-report.html').href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
const errors = [];
page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 数据表 5 行都应有看代码按钮
const btnCount = await page.locator('#data-table .code-btn').count();
console.log('数据表看代码按钮数量:', btnCount, btnCount === 5 ? '✓' : '✗');

// 点 CDP 那行
await page.click('#data-table .code-btn[data-code="cdp"]');
await page.waitForSelector('#modal-bd.show', { timeout: 3000 });
await page.waitForTimeout(400);

const m = await page.evaluate(() => ({
  title: document.getElementById('modal-title').textContent.trim(),
  sub: document.getElementById('modal-sub').textContent.trim(),
  hasCDP: document.getElementById('modal-note').textContent.includes('Chrome DevTools Protocol'),
  hasEval: document.getElementById('modal-code').textContent.includes('page.evaluate'),
  codeLen: document.getElementById('modal-code').textContent.length,
}));
console.log('\n=== CDP 弹层 ===');
console.log('  标题:', m.title);
console.log('  副标题:', m.sub);
console.log('  note 含 Chrome DevTools Protocol:', m.hasCDP ? '✓' : '✗');
console.log('  代码含 page.evaluate:', m.hasEval ? '✓' : '✗');
console.log('  代码长度:', m.codeLen);

await page.screenshot({ path: 'report-code-cdp.png' });

// Esc 关闭
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const closed = await page.evaluate(() => !document.getElementById('modal-bd').classList.contains('show'));
console.log('  Esc 关闭:', closed ? '✓' : '✗');

// 再验一条 vision，确认 CODE 字典完整
await page.click('#data-table .code-btn[data-code="vision"]');
await page.waitForSelector('#modal-bd.show', { timeout: 3000 });
const vTitle = await page.textContent('#modal-title');
console.log('\n=== Vision 弹层标题:', vTitle.trim());

console.log('\n控制台错误:', errors.length ? errors.join('; ') : '无');
await browser.close();
console.log('\n截图: report-code-cdp.png');
