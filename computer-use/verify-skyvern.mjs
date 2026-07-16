import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const url = pathToFileURL('C:/work/builder/research/agent-computer-control-report.html').href;
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:1200,height:1400}});
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
await p.goto(url,{waitUntil:'networkidle'}); await p.waitForTimeout(300);

const r = await p.evaluate(()=>{
  const btn = document.querySelector('.tool .code-btn[data-code="skyvern"]');
  const has = !!btn;
  openCode('skyvern');
  const show = document.getElementById('modal-bd').classList.contains('show');
  const code = document.getElementById('modal-code').textContent;
  return {
    btnExists: has,
    show,
    title: document.getElementById('modal-title').textContent.trim(),
    noteHasSoM: document.getElementById('modal-note').textContent.includes('Set-of-Marks'),
    codeHasSoM: code.includes('draw_numbered_boxes'),
    codeHasMap: code.includes('elements[action'),
    codeHasXpath: code.includes('不写死 XPath'),
    sectionNums: [...document.querySelectorAll('section h2 .num')].map(n=>n.textContent.trim()).join(','),
    tblBtns: document.querySelectorAll('#data-table .code-btn').length,
  };
});
console.log('Skyvern 看原理按钮存在:', r.btnExists?'✓':'✗');
console.log('弹层打开:', r.show?'✓':'✗');
console.log('  标题:', r.title);
console.log('  note含 Set-of-Marks:', r.noteHasSoM?'✓':'✗');
console.log('  代码含 draw_numbered_boxes:', r.codeHasSoM?'✓':'✗');
console.log('  代码含 编号→元素映射:', r.codeHasMap?'✓':'✗');
console.log('  代码含 不写死XPath注解:', r.codeHasXpath?'✓':'✗');
console.log('章节编号未变:', r.sectionNums, r.sectionNums==='01,02,03,04,05,06,07,08,09'?'✓':'✗');
console.log('数据表看代码按钮仍为5:', r.tblBtns===5?'✓':'✗ '+r.tblBtns);
await p.evaluate(()=>closeCode());
await p.locator('.tool .code-btn[data-code="skyvern"]').scrollIntoViewIfNeeded();
await p.waitForTimeout(200);
await p.evaluate(()=>openCode('skyvern'));
await p.waitForTimeout(300);
await p.screenshot({path:'report-skyvern-modal.png'});
console.log('控制台错误:', errs.length?errs.join('; '):'无');
await b.close();
