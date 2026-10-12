/**
 * 任务引擎批量发布：把已有任务发放到指定班级
 * 用法: node task-publish-all.mjs <course> [startCh] [endCh]
 * 输出: task-pub-all-<course>.json  + _task-pub-<course>.log
 *
 * 链路（2026-10-09 逆向）：
 *  1. 列表页 GET /task/getTaskDataLists?courseId=X → [{taskId, name, targetList, publishStatus}]
 *  2. 逐任务进详情 /task/taskList?taskId=<enc>&flag=true&courseId=X
 *  3. 点「发布」(.xbutton.linear.publish) → POST /taskReference/coursePublishAuthentication
 *     → 返回发布插件 URL: mooc2-ans.chaoxing.com/mooc2-ans/exam/test/publish-plugin?courseid=X&cpi=Y
 *  4. 该 URL 以 iframe 弹窗形式注入，帧内 DOM 与作业发放同构：
 *     a.classitem.newClassItem[data=<clazzid>] + span.class_check → 点 class_check
 *     确定按钮 .jb_btn.jb_btn_92
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CX_CHROME || 'C:\\Users\\admin\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const STATE = process.env.CX_STATE || path.join(__dirname, 'auth-state.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COURSE = (process.argv[2] || 'bangong').trim();
const START_CH = parseInt(process.argv[3] || '1', 10);
const END_CH = parseInt(process.argv[4] || '99', 10);

const CMAP = {
  bangong: { c: '265670555', k: '156694092', p: '110496162', cls: '1班', name: '办公空间设计' },
  kongjian: { c: '265670558', k: '156695612', p: '110496162', cls: '2班', name: '空间数字化表现' },
};
const CFG = CMAP[COURSE];
const LOG = path.join(__dirname, `_task-pub-${COURSE}.log`);
const logger = (m) => { const s = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${m}\n`; fs.appendFileSync(LOG, s); console.log(m); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'], locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1500, height: 950 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36' });
const p = await ctx.newPage();
p.on('dialog', (d) => d.accept().catch(() => {}));

const RESULT = { course: COURSE, clazz: CFG.cls, clazzId: CFG.k, items: [] };

// 1. 拿任务列表
await p.goto(`https://task.chaoxing.com/task/index?courseId=${CFG.c}&clazzId=${CFG.k}&cpi=${CFG.p}&enc=-1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await sleep(11000);
const list = await p.evaluate(async ({ cid }) => {
  const r = await fetch(`/task/getTaskDataLists?searchKey=&flag=true&courseId=${cid}&isDel=0&page=1&pageSize=50`, { credentials: 'include' });
  const j = await r.json();
  return (j.data || []).map((x) => ({ taskId: x.taskId, name: x.name, publishStatus: x.publishStatus, students: x.taskStudentsNumber, targetList: (x.targetList || []).length }));
}, { cid: CFG.c });
logger(`任务总数 ${list.length}`);

// 按章节号过滤 + 排序（升序做）
const parseCh = (n) => { const m = (n || '').match(/第\s*(\d+)\s*章/); return m ? parseInt(m[1], 10) : 999; };
const targets = list.filter((t) => { const ch = parseCh(t.name); return ch >= START_CH && ch <= END_CH; });
targets.sort((a, b) => parseCh(a.name) - parseCh(b.name));
logger(`待处理 ${targets.length} 个：${targets.map((t) => parseCh(t.name)).join(',')}`);

let ok = 0, skip = 0, fail = 0;

for (const t of targets) {
  const ch = parseCh(t.name);
  const tag = `第${ch}章 ${t.name}`;
  try {
    // 已发布且目标数>0 → 跳过（幂等）
    if (t.publishStatus && t.targetList > 0) { skip++; logger(`SKIP ${tag} (已发布 ${t.targetList} 个对象)`); RESULT.items.push({ ch, name: t.name, status: 'skip' }); continue; }

    await p.goto(`https://task.chaoxing.com/task/taskList?taskId=${encodeURIComponent(t.taskId)}&flag=true&courseId=${CFG.c}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(13000);

    // 点「发布」
    const clicked = await p.evaluate(() => {
      const b = [...document.querySelectorAll('a,.xbutton')].find((e) => e.offsetParent !== null && (e.innerText || '').trim() === '发布');
      if (!b) return false; b.click(); return true;
    });
    if (!clicked) { fail++; logger(`FAIL ${tag} (no-publish-btn)`); RESULT.items.push({ ch, name: t.name, status: 'fail', err: 'no-publish-btn' }); continue; }
    await sleep(12000);

    // 找 publish-plugin 帧
    const pf = p.frames().find((f) => /publish-plugin/.test(f.url()));
    if (!pf) { fail++; logger(`FAIL ${tag} (no-plugin-frame)`); RESULT.items.push({ ch, name: t.name, status: 'fail', err: 'no-plugin-frame' }); continue; }

    // 勾选目标班级（点 a.classitem[data=clazzid] 同行的 span.class_check）
    const pick = await pf.evaluate((cid) => {
      const a = [...document.querySelectorAll('a.classitem')].find((x) => (x.getAttribute('data') || '') === cid);
      if (!a) return 'no-a';
      for (const el of [a.parentElement, a.parentElement?.parentElement]) {
        if (!el) continue;
        const chk = el.querySelector('span.class_check');
        if (chk) { chk.click(); return 'ok:' + chk.className; }
      }
      return 'no-check';
    }, CFG.k).catch((e) => 'err:' + e.message.slice(0, 60));
    await sleep(1200);

    // 点「确定」
    const confirmed = await pf.evaluate(() => {
      const b = [...document.querySelectorAll('a,button')].find((e) => e.offsetParent !== null && (e.innerText || '').trim() === '确定');
      if (!b) return 'no-confirm'; b.click(); return 'clicked';
    }).catch((e) => 'err:' + e.message.slice(0, 60));
    await sleep(9000);

    // 回读确认
    const after = await p.evaluate(async ({ cid, tid }) => {
      const r = await fetch(`/task/getTaskDataLists?searchKey=&flag=true&courseId=${cid}&isDel=0&page=1&pageSize=50`, { credentials: 'include' });
      const j = await r.json();
      const it = (j.data || []).find((x) => x.taskId === tid);
      return it ? { publishStatus: it.publishStatus, students: it.taskStudentsNumber, targetLen: (it.targetList || []).length, targets: (it.targetList || []).map((y) => y.name || y.id || '').slice(0, 5) } : null;
    }, { cid: CFG.c, tid: t.taskId }).catch(() => null);

    if (after && after.publishStatus) { ok++; logger(`OK   ${tag} → published=${after.publishStatus} students=${after.students} targets=${JSON.stringify(after.targets)}`); RESULT.items.push({ ch, name: t.name, status: 'ok', pick, confirmed, after }); }
    else { fail++; logger(`FAIL ${tag} pick=${pick} confirm=${confirmed} after=${JSON.stringify(after)}`); RESULT.items.push({ ch, name: t.name, status: 'fail', pick, confirmed, after }); }
  } catch (e) {
    fail++; logger(`ERR  ${tag} ${String(e).slice(0, 150)}`);
    RESULT.items.push({ ch, name: t.name, status: 'err', err: String(e).slice(0, 150) });
  }
  await sleep(2000);
}

RESULT.summary = { ok, skip, fail, total: targets.length };
logger(`\n=== SUMMARY ok=${ok} skip=${skip} fail=${fail} total=${targets.length} ===`);
fs.writeFileSync(path.join(__dirname, `task-pub-all-${COURSE}.json`), JSON.stringify(RESULT, null, 2));
await browser.close();
