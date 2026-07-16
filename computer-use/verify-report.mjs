// 验证 HTML 报告：加载本地文件，检查图表/表格是否正确渲染，截图存档
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

const url = pathToFileURL('C:/work/builder/research/agent-computer-control-report.html').href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// 检查关键内容是否被 JS 正确注入
const checks = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  return {
    tokenBars: document.querySelectorAll('#chart-tokens .bar-row').length,
    latencyBars: document.querySelectorAll('#chart-latency .bar-row').length,
    payloadBars: document.querySelectorAll('#chart-payload .bar-row').length,
    osworldBars: document.querySelectorAll('#chart-osworld .bar-row').length,
    tableRows: document.querySelectorAll('#data-table tr').length,
    dotsOn: document.querySelectorAll('.dots i.on').length,
    firstTokenVal: q('#chart-tokens .val')?.textContent?.trim(),
    tableFirstCell: q('#data-table b')?.textContent?.trim(),
    title: document.title,
    bodyHeight: document.body.scrollHeight,
  };
});

console.log('=== 渲染自检 ===');
console.log(JSON.stringify(checks, null, 2));
console.log('\n=== 控制台错误 ===');
console.log(errors.length ? errors.join('\n') : '(无)');

// 截图：亮色 + 暗色各一张（首屏 + 图表区）
await page.screenshot({ path: 'report-preview-light.png', fullPage: false });
await page.emulateMedia({ colorScheme: 'dark' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
// 滚到实测结果区
await page.evaluate(() => document.getElementById('results').scrollIntoView());
await page.waitForTimeout(1000);
await page.screenshot({ path: 'report-preview-dark.png', fullPage: false });

await browser.close();
console.log('\n截图已存：report-preview-light.png / report-preview-dark.png');
