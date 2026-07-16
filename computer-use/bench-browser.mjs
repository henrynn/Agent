// 多范式对决基准 —— 浏览器三路：⑤ 视觉截图 / ③ 无障碍树 / ②b CDP 精确提取
// 需要 Playwright Chromium。任务同 bench-core：抓 HN 前 10 条结构化数据。
import { chromium } from 'playwright';
import { performance } from 'node:perf_hooks';

const N = 10;
const toks = (s) => Math.round(s.length / 4);
// Anthropic 视觉 token 估算：约 (width*height)/750
const imgToks = (w, h) => Math.round((w * h) / 750);

async function timeIt(fn) {
  const t0 = performance.now();
  const r = await fn();
  return { ms: +(performance.now() - t0).toFixed(0), ...r };
}

const browser = await chromium.launch();
const results = {};

try {
  // ===== ⑤ 视觉截图范式 =====
  results.vision = await timeIt(async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' });
    const buf = await page.screenshot({ fullPage: false }); // 一屏截图
    const vp = page.viewportSize();
    await page.close();
    // 纯视觉 agent：把整张截图喂多模态模型，每一步都要重新截图
    return {
      ok: true,
      wirePayload: buf.length,               // PNG 字节
      llmTokens: imgToks(vp.width, vp.height),// 单张截图视觉 token
      screenshotBytes: buf.length,
      viewport: `${vp.width}x${vp.height}`,
      note: '每个动作步骤都需重新截图；多步任务 token 线性累积',
    };
  });

  // ===== ③ 无障碍树范式（通过 CDP Accessibility.getFullAXTree，真实 a11y agent 做法）=====
  results.a11y = await timeIt(async () => {
    const page = await browser.newPage();
    await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' });
    const client = await page.context().newCDPSession(page);
    await client.send('Accessibility.enable');
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    await page.close();
    // 只保留 agent 关心的语义字段（role/name/value），丢弃冗余
    const slim = nodes.map((n) => ({
      role: n.role?.value,
      name: n.name?.value,
      value: n.value?.value,
    })).filter((n) => n.name || n.value);
    const json = JSON.stringify(slim);
    const linkCount = slim.filter((n) => n.role === 'link').length;
    return {
      ok: linkCount > 0,
      wirePayload: json.length,
      llmTokens: toks(json),      // 语义树比截图省 token，比整页 HTML 也精简
      axNodes: nodes.length,
      linkNodes: linkCount,
      note: '语义化控件树；比像素更省 token、比 DOM 更抽象；覆盖依赖站点无障碍质量',
    };
  });

  // ===== ②b CDP 精确提取（Playwright evaluate = 在页内直接跑 DOM API）=====
  results.cdp = await timeIt(async () => {
    const page = await browser.newPage();
    await page.goto('https://news.ycombinator.com/', { waitUntil: 'domcontentloaded' });
    const items = await page.evaluate((n) => {
      const out = [];
      const rows = document.querySelectorAll('tr.athing');
      for (let i = 0; i < Math.min(n, rows.length); i++) {
        const row = rows[i];
        const sub = row.nextElementSibling;
        out.push({
          title: row.querySelector('.titleline > a')?.textContent ?? null,
          points: parseInt(sub?.querySelector('.score')?.textContent) || null,
          author: sub?.querySelector('.hnuser')?.textContent ?? null,
          comments: (() => {
            const links = sub?.querySelectorAll('a') ?? [];
            const c = [...links].find((a) => /comment/.test(a.textContent));
            return c ? parseInt(c.textContent) || 0 : null;
          })(),
        });
      }
      return out;
    }, N);
    await page.close();
    const good = items.filter((i) => i.title && i.author);
    return {
      ok: good.length >= N * 0.9,
      wirePayload: JSON.stringify(items).length, // 只回传精炼结果
      llmTokens: toks(JSON.stringify(items)),
      parseSteps: 2,
      fieldMissRate: +(1 - good.length / N).toFixed(2),
      sample: items.slice(0, 3),
    };
  });
} finally {
  await browser.close();
}

console.log(JSON.stringify({
  task: 'Extract top 10 HN items via browser paradigms',
  timestamp: new Date().toISOString(),
  results,
}, null, 2));
