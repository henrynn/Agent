// 演示后端：五路真跑 + 网络失败自动回退缓存
// 原生 http，零新增依赖（除已装的 playwright）。给客户现场演示用。
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';

const PORT = 8848;
const N = 10;
const toks = (s) => Math.round(s.length / 4);
const imgToks = (w, h) => Math.round((w * h) / 750);

// 预加载缓存（真跑失败时的兜底，本身就是之前的真实实测数据）
const CACHE = JSON.parse(readFileSync('bench-results.json', 'utf8')).paradigms;

// 复用浏览器实例，加快现场多次演示
let browserPromise = null;
const getBrowser = () => (browserPromise ??= chromium.launch());

const timeIt = async (fn) => {
  const t0 = performance.now();
  const r = await fn();
  return { ms: +(performance.now() - t0).toFixed(0), ...r };
};

// 把缓存条目整理成前端要的形状（标注来自缓存）
function fromCache(key, note) {
  const c = CACHE[key];
  return {
    ok: c.ok,
    ms: c.ms,
    llmTokens: c.llmTokens,
    wirePayload: c.wirePayload,
    parseSteps: c.parseSteps ?? null,
    fieldMissRate: c.fieldMissRate ?? null,
    sample: (c.items || []).slice(0, 3),
    fromCache: true,
    cacheNote: note || '实时请求失败，回退到已录制的真实数据',
  };
}

// ---------- ④ API/MCP ----------
async function runAPI() {
  const url = `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${N}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  const items = JSON.parse(text).hits.map((h) => ({
    title: h.title, points: h.points, author: h.author, comments: h.num_comments,
  }));
  const good = items.filter((i) => i.title && i.author != null);
  return {
    ok: good.length === N, wirePayload: text.length,
    llmTokens: toks(JSON.stringify(items)), parseSteps: 1,
    fieldMissRate: +(1 - good.length / N).toFixed(2), sample: items.slice(0, 3),
  };
}

// ---------- ② DOM 正则 ----------
async function runDOM() {
  const res = await fetch('https://news.ycombinator.com/', { signal: AbortSignal.timeout(8000) });
  const html = await res.text();
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
  return {
    ok: good.length >= N * 0.8, wirePayload: html.length,
    llmTokens: toks(html), llmTokensTrimmed: toks(JSON.stringify(items)),
    parseSteps: 5, fieldMissRate: +(1 - good.length / N).toFixed(2), sample: items.slice(0, 3),
  };
}

// ---------- ②b CDP 页内提取 ----------
async function runCDP() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded', timeout: 12000 });
    const items = await page.evaluate((n) => {
      const o = []; const rows = document.querySelectorAll('tr.athing');
      for (let i = 0; i < Math.min(n, rows.length); i++) {
        const r = rows[i]; const s = r.nextElementSibling;
        const cl = [...(s?.querySelectorAll('a') || [])].find((a) => /comment/.test(a.textContent));
        o.push({
          title: r.querySelector('.titleline > a')?.textContent ?? null,
          points: parseInt(s?.querySelector('.score')?.textContent) || null,
          author: s?.querySelector('.hnuser')?.textContent ?? null,
          comments: cl ? parseInt(cl.textContent) || 0 : null,
        });
      }
      return o;
    }, N);
    const good = items.filter((i) => i.title && i.author);
    return {
      ok: good.length >= N * 0.9, wirePayload: JSON.stringify(items).length,
      llmTokens: toks(JSON.stringify(items)), parseSteps: 2,
      fieldMissRate: +(1 - good.length / N).toFixed(2), sample: items.slice(0, 3),
    };
  } finally { await page.close(); }
}

// ---------- ③ 无障碍树 ----------
async function runA11y() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded', timeout: 12000 });
    const client = await page.context().newCDPSession(page);
    await client.send('Accessibility.enable');
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const slim = nodes.map((n) => ({ role: n.role?.value, name: n.name?.value, value: n.value?.value }))
      .filter((n) => n.name || n.value);
    const json = JSON.stringify(slim);
    return {
      ok: slim.some((n) => n.role === 'link'), wirePayload: json.length,
      llmTokens: toks(json), axNodes: nodes.length, parseSteps: null, fieldMissRate: null,
    };
  } finally { await page.close(); }
}

// ---------- ① 像素视觉（返回真实截图！）----------
async function runVision() {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded', timeout: 12000 });
    const buf = await page.screenshot();
    const vp = page.viewportSize();
    // 现场高潮：截图缩小后 base64 传给前端展示（原尺寸算 token）
    const thumb = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 520 } });
    return {
      ok: true, wirePayload: buf.length, llmTokens: imgToks(vp.width, vp.height),
      screenshotBytes: buf.length, viewport: `${vp.width}x${vp.height}`,
      parseSteps: null, fieldMissRate: null,
      screenshot: 'data:image/png;base64,' + thumb.toString('base64'),
    };
  } finally { await page.close(); }
}

const RUNNERS = {
  api: { fn: runAPI, cacheKey: 'api' },
  dom: { fn: runDOM, cacheKey: 'dom' },
  cdp: { fn: runCDP, cacheKey: 'cdp' },
  a11y: { fn: runA11y, cacheKey: 'a11y' },
  vision: { fn: runVision, cacheKey: 'vision' },
};

async function runOne(key) {
  const r = RUNNERS[key];
  if (!r) return { error: 'unknown paradigm' };
  try {
    return await timeIt(r.fn);
  } catch (e) {
    // 真跑失败 → 回退缓存，诚实标注
    return fromCache(r.cacheKey, `实时请求失败（${e.name || 'error'}），回退到已录制的真实数据`);
  }
}

// ---------- HTTP 服务 ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (url.pathname === '/') {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync('demo-live.html'));
    } catch { res.writeHead(404); res.end('demo-live.html not found'); }
    return;
  }

  if (url.pathname === '/run') {
    const key = url.searchParams.get('p');
    const result = await runOne(key);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ key, ...result }));
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => {
  console.log(`\n  演示服务已启动 → http://localhost:${PORT}\n  五路真跑，网络失败自动回退缓存。Ctrl+C 停止。\n`);
});
