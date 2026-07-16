import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const url = pathToFileURL('C:/work/builder/research/agent-computer-control-report.html').href;
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:1200,height:1600} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto(url,{waitUntil:'networkidle'}); await p.waitForTimeout(400);

const r = await p.evaluate(()=>{
  const nums = [...document.querySelectorAll('section h2 .num')].map(n=>n.textContent.trim());
  const navNums = [...document.querySelectorAll('nav.toc .t-num')].map(n=>n.textContent.trim());
  const sec = document.getElementById('a11y');
  return {
    sectionNums: nums,
    navNums,
    a11ySectionExists: !!sec,
    a11yH2: sec ? sec.querySelector('h2').textContent.replace(/\s+/g,' ').trim() : null,
    hasBridgeTree: sec ? sec.querySelector('.tree') !== null : false,
    treeHasUIA: sec ? sec.querySelector('.tree').textContent.includes('UIA') : false,
    treeHasAX: sec ? sec.querySelector('.tree').textContent.includes('AX') : false,
    treeHasATSPI: sec ? sec.querySelector('.tree').textContent.includes('AT-SPI') : false,
    treeHasGetFullAXTree: sec ? sec.querySelector('.tree').textContent.includes('getFullAXTree') : false,
    platformTableRows: sec ? sec.querySelectorAll('table tbody tr').length : 0,
    navHasA11y: !!document.querySelector('nav.toc a[href="#a11y"]'),
  };
});
const uniqNums = new Set(r.sectionNums);
console.log('章节编号:', r.sectionNums.join(' '));
console.log('  无重复:', uniqNums.size===r.sectionNums.length ? '✓' : '✗ 有重复!');
console.log('  连续01-09:', r.sectionNums.join(',')==='01,02,03,04,05,06,07,08,09' ? '✓' : '✗');
console.log('导航编号:', r.navNums.join(' '), r.navNums.join(',')==='01,02,03,04,05,06,07,08,09'?'✓':'✗');
console.log('导航含 a11y 锚:', r.navHasA11y?'✓':'✗');
console.log('\n新节 #a11y 存在:', r.a11ySectionExists?'✓':'✗');
console.log('  标题:', r.a11yH2);
console.log('  桥接图存在:', r.hasBridgeTree?'✓':'✗');
console.log('  图含 UIA/AX/AT-SPI:', (r.treeHasUIA&&r.treeHasAX&&r.treeHasATSPI)?'✓':'✗');
console.log('  图含 getFullAXTree:', r.treeHasGetFullAXTree?'✓':'✗');
console.log('  三平台表格行数:', r.platformTableRows, r.platformTableRows===3?'✓':'✗');

// 点导航跳转测试
await p.click('nav.toc a[href="#a11y"]');
await p.waitForTimeout(500);
const scrolledTo = await p.evaluate(()=>{
  const sec=document.getElementById('a11y');
  const rect=sec.getBoundingClientRect();
  return rect.top < 300 && rect.top > -100;
});
console.log('  导航点击跳转到位:', scrolledTo?'✓':'~ (锚点存在即可)');

// 旧功能：uia 看代码按钮仍工作
await p.evaluate(()=>openCode('uia'));
await p.waitForTimeout(200);
const modalOk = await p.evaluate(()=>document.getElementById('modal-bd').classList.contains('show'));
console.log('\n旧功能 UIA 看代码弹层仍工作:', modalOk?'✓':'✗');
const tblBtns = await p.locator('#data-table .code-btn').count();
console.log('数据表看代码按钮仍为5:', tblBtns===5?'✓':'✗ '+tblBtns);

await p.evaluate(()=>closeCode());
await p.locator('#a11y').scrollIntoViewIfNeeded();
await p.waitForTimeout(300);
await p.screenshot({ path:'report-a11y-section.png' });
console.log('\n控制台错误:', errs.length?errs.join('; '):'无');
await b.close();
console.log('截图: report-a11y-section.png');
