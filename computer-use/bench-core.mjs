// 多范式对决基准 —— 核心两路：④ API/MCP 直连 vs ② DOM 解析
// 任务：从 Hacker News 首页提取前 10 条 {title, points, author, comments}
// 度量：端到端延迟、网络 payload 字节、送入 LLM 的 token 估算、解析代码脆性
import { performance } from 'node:perf_hooks';

const N = 10;
// 粗略 token 估算：英文/JSON ~4 chars/token；截图按 Anthropic 每 (w*h)/750 估
const toks = (s) => Math.round(s.length / 4);

async function timeIt(fn) {
  const t0 = performance.now();
  const r = await fn();
  return { ms: +(performance.now() - t0).toFixed(0), ...r };
}

// ④ API/MCP 直连：请求结构化 JSON，字段直接可用
async function runAPI() {
  const url = `https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${N}`;
  const res = await fetch(url);
  const text = await res.text();
  const data = JSON.parse(text);
  const items = data.hits.map((h) => ({
    title: h.title,
    points: h.points,
    author: h.author,
    comments: h.num_comments,
  }));
  // 送入 LLM 的上下文 = 精炼后的结构化数据（甚至可以完全不进 LLM）
  const llmPayload = JSON.stringify(items);
  return {
    ok: items.length === N && items.every((i) => i.title && i.author != null),
    wirePayload: text.length,     // 网络传输字节
    llmTokens: toks(llmPayload),  // 若把结果交给 LLM 判断，需要的 token
    parseSteps: 1,                // JSON.parse 一步到位
    sample: items.slice(0, 3),
    items,
  };
}

// ② DOM 解析：抓 HTML，用选择器逐字段抠数据
async function runDOM() {
  const res = await fetch('https://news.ycombinator.com/');
  const html = await res.text();
  // 无第三方依赖的正则/切片解析（模拟脚本化 DOM 抽取的脆性）
  const items = [];
  // HN 结构：每条 <tr class='athing'> 标题，下一行 <span class='score'> 分数、<a>作者、评论
  const rows = html.split("class=\"athing").slice(1, N + 1);
  const rest = html.split("class=\"subtext\"");
  for (let i = 0; i < N && i < rows.length; i++) {
    const block = rows[i];
    // 标题：titleline 内第一个 <a>
    const titleM = block.match(/class="titleline"><a[^>]*>([^<]+)<\/a>/);
    // 分数/作者/评论在 subtext 块
    const sub = rest[i + 1] || '';
    const ptsM = sub.match(/class="score"[^>]*>(\d+)\s*points?/);
    const authM = sub.match(/class="hnuser">([^<]+)</);
    const cmtM = sub.match(/(\d+)(?:&nbsp;|\s)*comments?/);
    items.push({
      title: titleM ? titleM[1] : null,
      points: ptsM ? +ptsM[1] : null,
      author: authM ? authM[1] : null,
      comments: cmtM ? +cmtM[1] : null,
    });
  }
  const good = items.filter((i) => i.title && i.author);
  // DOM 路线：整段 HTML 往往需要喂给 LLM 去理解（或至少喂裁剪后的 DOM）
  return {
    ok: good.length >= N * 0.8,   // 允许少量字段抠失败，体现脆性
    wirePayload: html.length,
    llmTokens: toks(html),        // 最坏情况：整页 HTML 进 LLM
    llmTokensTrimmed: toks(JSON.stringify(items)), // 若先本地裁剪
    parseSteps: 5,                // 多个正则/选择器，逐字段
    fieldMissRate: +(1 - good.length / N).toFixed(2),
    sample: items.slice(0, 3),
    items,
  };
}

const api = await timeIt(runAPI);
const dom = await timeIt(runDOM);

const out = {
  task: 'Extract top 10 HN front-page items {title, points, author, comments}',
  timestamp: new Date().toISOString(),
  paradigms: {
    api: { label: '④ API/MCP 直连', ...api },
    dom: { label: '② DOM 解析', ...dom },
  },
};
console.log(JSON.stringify(out, null, 2));
