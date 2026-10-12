/** 考试组卷：真实 fill 填表 + 调页面原生 send(1) 直连提交 + 轮询任务状态
 *  用法: node cx-exam-build.mjs <course> [单选数] [多选数] [单选分值]
 *  输出: exam4-<course>.json
 *
 *  关键点：
 *   - 分值 = 该题型「整块总分」，各块之和必须 = 满分（页面强校验 totalScoreId === totalScoreIdV2）
 *   - chooseType=1 → send() 内不弹确认框，直接 randomPaper()
 *   - 只提交「可见」题型（div[id$=_TypeDiv] 且 offsetParent!=null）；判断题块默认隐藏
 *   - randomPaper 异步 → taskId，须轮询 /mooc2-ans/exam/autopapertask-status 拿 paperId
 *
 *  ⚠️ 课程三件套来自课程配置文件（见 scripts/courses.example.json），不要把真实 courseId 提交进仓库。
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCourse } from './cx-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CX_CHROME || 'C:\\Users\\admin\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const STATE = process.env.CX_STATE || path.join(__dirname, 'auth-state.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COURSE = (process.argv[2] || '').trim();
const CFG = loadCourse(COURSE);
if (!CFG) { console.error(`未知课程「${COURSE}」：请在 scripts/courses.json 中配置（参考 courses.example.json）`); process.exit(1); }

// 题型配置：[题量, 整块总分]
const N_S = parseInt(process.argv[3] || '20', 10);
const N_M = parseInt(process.argv[4] || '5', 10);
// 分值分配：单选 4分/题，多选 4分/题（合计 100）
const P_S = parseInt(process.argv[5] || '4', 10);
const P_M = 4;
const TOTAL = N_S * P_S + N_M * P_M;
const TITLE = `${CFG.name} 期末考试`;

const OUT = { course: COURSE, title: TITLE, cfg: { N_S, N_M, P_S, P_M, TOTAL }, steps: [], reqs: [] };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'], locale: 'zh-CN' });
const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1680, height: 1050 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36' });
const p = await ctx.newPage();
p.on('dialog', (d) => d.accept().catch(() => {}));
p.on('request', (r) => {
  const u = r.url();
  if (/\/mooc2-ans\/exam\//i.test(u) && !/\.(png|jpg|css|gif|ico|woff|ttf|js)/i.test(u)) {
    OUT.reqs.push({ m: r.method(), u: u.slice(0, 220), post: (r.postData() || '').slice(0, 3000) });
  }
});
p.on('response', async (r) => {
  const u = r.url();
  if (/reVersionToSetPaperStructureV2|autopapertask-status/i.test(u)) {
    try { OUT.reqs.push({ RES: u.slice(0, 200), s: r.status(), body: (await r.text()).slice(0, 800) }); } catch (e) {}
  }
});

const URL = `https://mooc2-ans.chaoxing.com/mooc2-ans/exam/toAutoCreatePaperPage?courseid=${CFG.courseId}&classid=${CFG.clazzId}&cpi=${CFG.cpi}&pid=0&position=test&createPaperType=1&editPaperTemplate=true&ut=t`;
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await sleep(14000);

// 1. 填标题 / 满分 / 组卷数量
await p.locator('#title').first().fill(TITLE).catch(() => {});
await sleep(500);
await p.locator('#score').first().fill(String(TOTAL)).catch(() => {});
await p.locator('#score').first().press('Tab').catch(() => {});
await sleep(500);
await p.locator('#pageNum').first().fill('1').catch(() => {});
await p.locator('#pageNum').first().press('Tab').catch(() => {});
await sleep(800);

// 2. 填题型块（单选题=0，多选题=1；判断题=3 默认隐藏，先尝试展开）
const fillPair = async (type, num, score) => {
  const nEl = p.locator(`[id="${type}_libraryInputQuestionNum"]`).first();
  const sEl = p.locator(`[id="${type}_score"]`).first();
  const n = await nEl.count(), s = await sEl.count();
  if (n) { await nEl.fill(String(num)).catch(() => {}); await nEl.press('Tab').catch(() => {}); await sleep(400); }
  if (s) { await sEl.fill(String(score)).catch(() => {}); await sEl.press('Tab').catch(() => {}); await sleep(400); }
  return { type, n, s };
};
OUT.steps.push(await fillPair('0', N_S, N_S * P_S));
OUT.steps.push(await fillPair('1', N_M, N_M * P_M));
await sleep(2000);

// 3. 读状态（总分是否配平）
const readState = async () => p.evaluate(() => {
  const g = (id) => { try { const el = document.getElementById(id); return el ? el.value : null; } catch (e) { return 'ERR'; } };
  const gi = (id) => { try { const el = document.getElementById(id); return el ? el.innerHTML.trim() : null; } catch (e) { return 'ERR'; } };
  const visTypes = [...document.querySelectorAll('div[id$=_TypeDiv]')].filter((d) => d.offsetParent !== null).map((d) => d.getAttribute('value'));
  return {
    title: g('title'), score: g('score'), pageNum: g('pageNum'),
    q0: g('0_libraryInputQuestionNum'), s0: g('0_score'),
    q1: g('1_libraryInputQuestionNum'), s1: g('1_score'),
    totalQ: gi('totalQuestionNum'), sumA: gi('totalScoreId'), sumB: gi('totalScoreIdV2'),
    visTypes,
  };
});
OUT.beforeSubmit = await readState();

// 4. 调页面原生 send(1) —— chooseType=1 跳过二次确认，直接 randomPaper()
await p.evaluate(() => {
  window.__pe = null;
  try { window.send(1); } catch (e) { window.__pe = String(e); }
}).catch(() => {});
await sleep(3500);

OUT.afterSend = await p.evaluate(() => ({
  jsErr: window.__pe || null,
  taskid: document.querySelector('#taskid')?.value || '',
  paperId: document.querySelector('#paperId')?.value || '',
  tipShown: [...document.querySelectorAll('#totalScoreTip1,#totalScoreTip,#scoreTip')].filter((e) => e.offsetParent !== null).map((e) => (e.innerText || '').trim()),
})).catch((e) => ({ err: String(e).slice(0, 200) }));

// 5. 轮询任务状态
let taskId = OUT.afterSend?.taskid || '';
for (let i = 0; i < 12 && taskId; i++) {
  await sleep(5000);
  const r = await p.evaluate(async (tid) => {
    const cid = document.querySelector('#courseId')?.value;
    const cpi = document.querySelector('#cpi')?.value;
    const res = await fetch(`/mooc2-ans/exam/autopapertask-status?courseid=${cid}&cpi=${cpi}&taskid=${tid}`, { credentials: 'include' });
    return await res.text();
  }, taskId).catch(() => '');
  OUT.poll = OUT.poll || [];
  OUT.poll.push({ i, raw: String(r).slice(0, 500) });
  if (/ok|fail|invalid/.test(String(r))) break;
}

OUT.final = {
  url: p.url().slice(0, 240),
  text: await p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 900)).catch(() => ''),
  paperId: await p.evaluate(() => document.querySelector('#paperId')?.value || '').catch(() => ''),
  paperPushEnc: await p.evaluate(() => document.querySelector('#paperPushEnc')?.value || '').catch(() => ''),
  taskid: await p.evaluate(() => document.querySelector('#taskid')?.value || '').catch(() => ''),
};
await p.screenshot({ path: path.join(__dirname, `exam4-${COURSE}.png`), fullPage: true }).catch(() => {});

fs.writeFileSync(path.join(__dirname, `exam4-${COURSE}.json`), JSON.stringify(OUT, null, 2));
console.log('DONE paperId=' + OUT.final.paperId + ' taskid=' + OUT.final.taskid);
await browser.close();
