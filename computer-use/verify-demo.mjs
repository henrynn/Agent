// 端到端验证演示页：驱动真实浏览器点"一键全跑"，确认五路渲染+截图+赢家高亮
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1700 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:8848/', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// 连接状态
const conn = await page.textContent('#conn-label');
console.log('连接状态:', conn);

// 点一键全跑
await page.click('#run-all');
console.log('已点击"一键全跑"，等待五路完成…');

// 等到 insight 浮层出现（= 五路全跑完 + 赢家判定）
await page.waitForSelector('#insight.show', { timeout: 90000 });
await page.waitForTimeout(1200); // 等动画

// 采集每路状态
const lanes = await page.evaluate(() => {
  const keys = ['vision','a11y','dom','api','cdp'];
  return keys.map(k => {
    const lane = document.getElementById('lane-'+k);
    const st = document.getElementById('st-'+k);
    const met = document.getElementById('met-'+k);
    const hero = met.querySelector('.m.hero .v');
    return {
      key: k,
      status: st.textContent.trim(),
      winner: lane.classList.contains('winner'),
      metricsOpen: met.classList.contains('open'),
      heroToken: hero ? hero.textContent.trim() : null,
      hasShot: !!met.querySelector('.shot img'),
      hasSample: !!met.querySelector('.sample'),
    };
  });
});

console.log('\n=== 五路验证结果 ===');
for (const l of lanes) {
  const flags = [
    l.metricsOpen ? '指标✓' : '指标✗',
    l.heroToken ? `token=${l.heroToken}` : 'token✗',
    l.key==='vision' ? (l.hasShot?'截图✓':'截图✗') : '',
    l.winner ? '🏆赢家' : '',
  ].filter(Boolean).join(' ');
  console.log(`  ${l.key.padEnd(7)} ${l.status.padEnd(12)} ${flags}`);
}

const visionOk = lanes.find(l=>l.key==='vision')?.hasShot;
const winnerCount = lanes.filter(l=>l.winner).length;
const allOpen = lanes.every(l=>l.metricsOpen);
console.log('\n=== 断言 ===');
console.log('  五路指标全部展开:', allOpen ? '✓' : '✗');
console.log('  视觉截图已渲染:', visionOk ? '✓' : '✗');
console.log('  恰好一个赢家高亮:', winnerCount===1 ? '✓ ('+lanes.find(l=>l.winner).key+')' : '✗ (共'+winnerCount+'个)');
console.log('  控制台错误:', errors.length ? errors.join('; ') : '无');

// 截图存档（亮/暗）
await page.screenshot({ path: 'demo-preview-light.png', fullPage: false });
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(300);
await page.screenshot({ path: 'demo-preview-dark.png', fullPage: false });

await browser.close();
console.log('\n截图存档: demo-preview-light.png / demo-preview-dark.png');
