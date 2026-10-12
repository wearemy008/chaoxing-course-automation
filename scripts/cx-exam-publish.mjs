/** 发布考试到班级（完整版）
 *  用法: node exam-publish.mjs <course> <paperId> [startOffsetDays] [limitMinutes] [endOffsetDays]
 *  输出: exam-published-<course>.json
 *
 *  链路：
 *   1. /mooc2-ans/exam/test/topublish?...&paperid=P  发布设置页
 *   2. 点 #choosepublish 开发放对象弹层 → 勾 a.classitem[data=clazzid] 同行的 span.class_check
 *   3. 点 #confirmchoose 确认 → 生成 .selectClass > a[data=clazzid][publishtype=0]
 *   4. 填截止时间（时间控件需 setter + dispatchEvent）
 *   5. 调 window.publishpaper(true) → POST /mooc2-ans/exam/test/publish
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CX_CHROME || 'C:\\Users\\admin\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const STATE = process.env.CX_STATE || path.join(__dirname, 'auth-state.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const COURSE = (process.argv[2] || 'bangong').trim();
const PAPER = process.argv[3] || '';
const START_OFF = parseFloat(process.argv[4] || '0');
const LIMIT = parseInt(process.argv[5] || '90', 10);
const END_OFF = parseFloat(process.argv[6] || '7');
const CMAP = {
  bangong: { c: '265670555', k: '156694092', p: '110496162', name: '办公空间设计', cls: '1班' },
  kongjian: { c: '265670558', k: '156695612', p: '110496162', name: '空间数字化表现', cls: '2班' },
};
const CFG = CMAP[COURSE];

const now = new Date();
const startTime = new Date(now.getTime() + START_OFF * 3600 * 1000);
const endDate = new Date(startTime.getTime() + END_OFF * 24 * 3600 * 1000);
endDate.setHours(23, 59, 59, 0);
const END = fmt(endDate);

const OUT = { course: COURSE, paperId: PAPER, clazzName: CFG.cls, endTime: END, limitTime: LIMIT, reqs: [], steps: [] };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'], locale: 'zh-CN' });
const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1680, height: 1050 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36' });
const p = await ctx.newPage();
p.on('dialog', (d) => d.accept().catch(() => {}));
p.on('request', (r) => {
  const u = r.url();
  if (/exam\/test\/publish|topublish/i.test(u)) OUT.reqs.push({ m: r.method(), u: u.slice(0, 180), post: (r.postData() || '').slice(0, 2500) });
});
p.on('response', async (r) => {
  if (/exam\/test\/publish/i.test(r.url())) {
    try { OUT.publishResp = { s: r.status(), body: (await r.text()).slice(0, 800) }; } catch (e) {}
  }
});

const PUB_URL = `https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/topublish?taskid=0&clazzid=${CFG.k}&courseid=${CFG.c}&ut=t&cpi=${CFG.p}&paperid=${PAPER}&score=100.0`;
await p.goto(PUB_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await sleep(10000);
OUT.steps.push({ s: 'loaded', url: p.url().slice(0, 200) });

// 1. 开发放对象弹层
await p.evaluate(() => { try { document.getElementById('choosepublish')?.click(); } catch (e) {} });
await sleep(3500);

// 2. 勾班级：点 a.classitem[data=clazzid] 同行的 span.class_check
const pick = await p.evaluate((cid) => {
  const a = [...document.querySelectorAll('a.classitem')].find((x) => (x.getAttribute('data') || '') === cid);
  if (!a) return 'no-a';
  for (const el of [a.parentElement, a.parentElement?.parentElement]) {
    if (!el) continue;
    const chk = el.querySelector('span.class_check');
    if (chk) { chk.click(); return 'clicked:' + chk.className; }
  }
  return 'no-check';
}, CFG.k);
OUT.steps.push({ s: 'pick', r: pick });
await sleep(1500);

// 3. 确认
const conf = await p.evaluate(() => {
  const b = document.getElementById('confirmchoose');
  if (!b) return 'no-confirm';
  b.click();
  return 'clicked';
});
OUT.steps.push({ s: 'confirm', r: conf });
await sleep(2500);

OUT.selectClass = await p.evaluate(() => [...document.querySelectorAll('.selectClass > a')].map((a) => ({ t: (a.innerText || '').trim().slice(0, 20), data: a.getAttribute('data') || '', pt: a.getAttribute('publishtype') || '' })));

// 4. 设置截止时间（定时截止）
const setEnd = await p.evaluate((v) => {
  const steps = [];
  // 切到「定时截止」
  const jz = document.querySelector('.jiezhiSelect');
  if (jz) {
    const opts = [...jz.querySelectorAll('*')].filter((e) => /定时截止/.test((e.innerText || '').trim()));
    const t = [...jz.querySelectorAll('a,span,label,li')].find((e) => /定时截止/.test((e.innerText || '').trim()));
    if (t) { t.click(); steps.push('clicked-定时截止'); }
    else steps.push('no-定时截止-el');
  }
  const el = document.getElementById('endTime');
  if (!el) return steps.concat('no-endTime');
  // jQuery 日期控件：走原生 setter + change
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  steps.push('set-endTime=' + el.value);
  return steps;
}, END);
OUT.steps.push({ s: 'endTime', r: setEnd });
await sleep(1500);

// 5. 考试限时
const setLimit = await p.evaluate((m) => {
  const el = document.getElementById('limitTime');
  if (!el) return 'no-limitTime';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, String(m));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  return el.value;
}, LIMIT);
OUT.steps.push({ s: 'limitTime', r: setLimit });
await sleep(1200);

OUT.beforeSubmit = await p.evaluate(() => ({
  endTime: document.getElementById('endTime')?.value || '',
  limitTime: document.getElementById('limitTime')?.value || '',
  selectClass: document.querySelectorAll('.selectClass > a').length,
  fullScore: document.getElementById('fullScore')?.value || '',
}));

// 6. 提交：publishpaper(true) 跳过二次确认
await p.evaluate(() => { window.__pe = null; try { window.publishpaper(true); } catch (e) { window.__pe = String(e); } }).catch(() => {});
await sleep(12000);

OUT.result = await p.evaluate(() => ({
  jsErr: window.__pe || null,
  url: location.href.slice(0, 220),
  text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 700),
})).catch((e) => ({ err: String(e).slice(0, 150) }));

await p.screenshot({ path: path.join(__dirname, `exam-pub-${COURSE}.png`), fullPage: true }).catch(() => {});
fs.writeFileSync(path.join(__dirname, `exam-published-${COURSE}.json`), JSON.stringify(OUT, null, 2));
console.log('DONE publishResp=' + JSON.stringify(OUT.publishResp || {}));
await browser.close();
