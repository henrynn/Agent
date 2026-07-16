// 验证"看代码"弹层：打开页面、点 CDP 那条的看代码按钮、确认弹层内容、截图
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

// 等服务
for (let i = 0; i < 15; i++) {
  try { await page.goto('http://localhost:8848/', { waitUntil: 'networkidle' }); break; }
  catch { await page.waitForTimeout(1000); }
}
await page.waitForTimeout(300);

// 5 条都应有看代码按钮
const btnCount = await page.locator('.code-btn').count();
console.log('看代码按钮数量:', btnCount, btnCount === 5 ? '✓' : '✗');

// 点 CDP 那条
await page.click('#lane-cdp .code-btn');
await page.waitForSelector('#modal-bd.show', { timeout: 3000 });
await page.waitForTimeout(400);

const modal = await page.evaluate(() => ({
  title: document.getElementById('modal-title').textContent.trim(),
  sub: document.getElementById('modal-sub').textContent.trim(),
  hasNote: document.getElementById('modal-note').textContent.includes('Chrome DevTools Protocol'),
  hasEvaluate: document.getElementById('modal-code').textContent.includes('page.evaluate'),
  codeLen: document.getElementById('modal-code').textContent.length,
}));
console.log('\n=== CDP 弹层 ===');
console.log('  标题:', modal.title);
console.log('  副标题:', modal.sub);
console.log('  note 含"Chrome DevTools Protocol":', modal.hasNote ? '✓' : '✗');
console.log('  代码含 page.evaluate:', modal.hasEvaluate ? '✓' : '✗');
console.log('  代码长度:', modal.codeLen);

await page.screenshot({ path: 'demo-code-cdp.png' });

// Esc 关闭
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const closed = await page.evaluate(() => !document.getElementById('modal-bd').classList.contains('show'));
console.log('  Esc 关闭:', closed ? '✓' : '✗');

// 再点 DOM 正则那条对照
await page.click('#lane-dom .code-btn');
await page.waitForSelector('#modal-bd.show', { timeout: 3000 });
await page.waitForTimeout(400);
const domTitle = await page.textContent('#modal-title');
console.log('\n=== DOM 弹层 ===');
console.log('  标题:', domTitle.trim());
await page.screenshot({ path: 'demo-code-dom.png' });

console.log('\n控制台错误:', errors.length ? errors.join('; ') : '无');
await browser.close();
console.log('\n截图: demo-code-cdp.png / demo-code-dom.png');
