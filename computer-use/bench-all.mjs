// 汇总器：合并 core(API/DOM) 与 browser(vision/a11y/cdp) 两批基准，产出统一结果 JSON
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const N = 10;
const toks = (s) => Math.round(s.length / 4);
const imgToks = (w, h) => Math.round((w * h) / 750);
const timeIt = async (fn) => { const t0 = performance.now(); const r = await fn(); return { ms: +(performance.now() - t0).toFixed(0), ...r }; };

// ---------- 网络两路 ----------
async function runAPI() {
  const url = `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${N}`;
  const res = await fetch(url); const text = await res.text();
  const items = JSON.parse(text).hits.map((h) => ({ title: h.title, points: h.points, author: h.author, comments: h.num_comments }));
  const good = items.filter((i) => i.title && i.author != null);
  return { ok: good.length === N, wirePayload: text.length, llmTokens: toks(JSON.stringify(items)), parseSteps: 1, fieldMissRate: +(1 - good.length / N).toFixed(2), items };
}
async function runDOM() {
  const res = await fetch('https://news.ycombinator.com/'); const html = await res.text();
  const items = [];
  const rows = html.split('class="athing').slice(1, N + 1);
  const rest = html.split('class="subtext"');
  for (let i = 0; i < N && i < rows.length; i++) {
    const b = rows[i]; const sub = rest[i + 1] || '';
    items.push({
      title: (b.match(/class="titleline"><a[^>]*>([^<]+)<\/a>/) || [])[1] || null,
      points: +((sub.match(/class="score"[^>]*>(\d+)/) || [])[1]) || null,
      author: (sub.match(/class="hnuser">([^<]+)</) || [])[1] || null,
      comments: +((sub.match(/(\d+)(?:&nbsp;|\s)*comments?/) || [])[1]) || null,
    });
  }
  const good = items.filter((i) => i.title && i.author);
  return { ok: good.length >= N * 0.8, wirePayload: html.length, llmTokens: toks(html), llmTokensTrimmed: toks(JSON.stringify(items)), parseSteps: 5, fieldMissRate: +(1 - good.length / N).toFixed(2), items };
}

// ---------- 浏览器三路 ----------
async function runBrowser() {
  const browser = await chromium.launch(); const out = {};
  try {
    out.vision = await timeIt(async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' });
      const buf = await page.screenshot(); const vp = page.viewportSize(); await page.close();
      return { ok: true, wirePayload: buf.length, llmTokens: imgToks(vp.width, vp.height), screenshotBytes: buf.length, viewport: `${vp.width}x${vp.height}` };
    });
    out.a11y = await timeIt(async () => {
      const page = await browser.newPage();
      await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' });
      const client = await page.context().newCDPSession(page);
      await client.send('Accessibility.enable');
      const { nodes } = await client.send('Accessibility.getFullAXTree'); await page.close();
      const slim = nodes.map((n) => ({ role: n.role?.value, name: n.name?.value, value: n.value?.value })).filter((n) => n.name || n.value);
      const json = JSON.stringify(slim);
      return { ok: true, wirePayload: json.length, llmTokens: toks(json), axNodes: nodes.length, linkNodes: slim.filter((n) => n.role === 'link').length };
    });
    out.cdp = await timeIt(async () => {
      const page = await browser.newPage();
      await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' });
      const items = await page.evaluate((n) => {
        const o = []; const rows = document.querySelectorAll('tr.athing');
        for (let i = 0; i < Math.min(n, rows.length); i++) {
          const r = rows[i]; const s = r.nextElementSibling;
          const cl = [...(s?.querySelectorAll('a') || [])].find((a) => /comment/.test(a.textContent));
          o.push({ title: r.querySelector('.titleline > a')?.textContent ?? null, points: parseInt(s?.querySelector('.score')?.textContent) || null, author: s?.querySelector('.hnuser')?.textContent ?? null, comments: cl ? parseInt(cl.textContent) || 0 : null });
        }
        return o;
      }, N);
      await page.close();
      const good = items.filter((i) => i.title && i.author);
      return { ok: good.length >= N * 0.9, wirePayload: JSON.stringify(items).length, llmTokens: toks(JSON.stringify(items)), parseSteps: 2, fieldMissRate: +(1 - good.length / N).toFixed(2), items };
    });
  } finally { await browser.close(); }
  return out;
}

const api = await timeIt(runAPI);
const dom = await timeIt(runDOM);
const br = await runBrowser();

const merged = {
  task: '从 Hacker News 首页提取前 10 条 {标题, 分数, 作者, 评论数}',
  target: 'news.ycombinator.com',
  runAt: new Date().toISOString(),
  env: { node: process.version, platform: process.platform },
  paradigms: {
    api:    { key: 'api',    order: 4, label: 'API/MCP 直连',  perception: '结构化 JSON', ...api },
    cdp:    { key: 'cdp',    order: 2, label: 'DOM/CDP 精确提取', perception: 'DOM 树 (页内 evaluate)', ...br.cdp },
    a11y:   { key: 'a11y',   order: 3, label: '无障碍树 a11y',  perception: '语义控件树 (AX Tree)', ...br.a11y },
    dom:    { key: 'dom',    order: 2, label: 'DOM 正则解析',   perception: '原始 HTML', ...dom },
    vision: { key: 'vision', order: 1, label: '像素视觉截图',   perception: '屏幕截图 PNG', ...br.vision },
  },
};

writeFileSync('bench-results.json', JSON.stringify(merged, null, 2));
console.log('=== 六路对决实测结果（同批次）===\n');
const rows = Object.values(merged.paradigms);
console.log('范式\t\t延迟ms\tLLM_tokens\t网络payload\t解析步\t字段缺失');
for (const p of rows) {
  console.log(`${p.label}\t${p.ms}\t${p.llmTokens}\t\t${p.wirePayload}\t\t${p.parseSteps ?? '-'}\t${p.fieldMissRate ?? '-'}`);
}
console.log('\n写入 bench-results.json');
