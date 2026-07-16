import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const url = pathToFileURL('C:/work/builder/research/agent-computer-control-report.html').href;
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1200,height:1400} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto(url,{waitUntil:'networkidle'}); await p.waitForTimeout(400);

// 卡片存在 + 真实输出文本在
const cardOk = await p.locator('.uia-card').count();
const hasOut = await p.locator('.uia-out').textContent();
console.log('桌面a11y卡片数:', cardOk, cardOk===1?'✓':'✗');
console.log('卡片含 Display is 56:', hasOut.includes('Display is 56')?'✓':'✗');
console.log('卡片含 零坐标标注:', hasOut.includes('pixel_coordinates_used')?'✓':'✗');

// 点卡片里的看代码
await p.locator('.uia-card .code-btn[data-code="uia"]').scrollIntoViewIfNeeded();
await p.click('.uia-card .code-btn[data-code="uia"]');
await p.waitForSelector('#modal-bd.show',{timeout:3000});
await p.waitForTimeout(300);
const m = await p.evaluate(()=>({
  title: document.getElementById('modal-title').textContent.trim(),
  sub: document.getElementById('modal-sub').textContent.trim(),
  hasUIA: document.getElementById('modal-code').textContent.includes('uiautomation'),
  hasInvoke: document.getElementById('modal-code').textContent.includes('GetInvokePattern'),
  noteHasUIA: document.getElementById('modal-note').textContent.includes('UI Automation'),
}));
console.log('\n=== UIA 弹层 ===');
console.log('  标题:', m.title);
console.log('  副标题:', m.sub);
console.log('  代码含 uiautomation:', m.hasUIA?'✓':'✗');
console.log('  代码含 GetInvokePattern:', m.hasInvoke?'✓':'✗');
console.log('  note含UI Automation:', m.noteHasUIA?'✓':'✗');

await p.screenshot({ path:'report-uia-modal.png' });

// 原有5个数据表按钮仍在
const tblBtns = await p.locator('#data-table .code-btn').count();
console.log('\n数据表看代码按钮仍为5:', tblBtns===5?'✓':'✗ '+tblBtns);
console.log('控制台错误:', errs.length?errs.join('; '):'无');
await b.close();
console.log('\n截图: report-uia-modal.png');
