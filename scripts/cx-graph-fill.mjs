/** 知识图谱六板块填充（通用版）：读 bangong-graph-fill.json 写入指定课程
 *  用法：node graph-fill-generic.mjs bangong  或  node graph-fill-generic.mjs kongjian
 *  幂等：标签取并集、desc 空才写、classify=0 才写；问题按标题查重
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = process.env.CX_STATE || path.join(__dirname, 'auth-state.json');
const CHROME = process.env.CX_CHROME || 'C:\\Users\\admin\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CPI = '110496162';
const S2 = 'https://stat2-ans.chaoxing.com';
const LAB = { zhongdian: '24283664', nandian: '24283665', kaodian: '24283666', sizheng: '24283667' };

const WHICH = process.argv[2] || 'bangong';
const CFG = {
  bangong: { courseId: '265670555', clazzId: '150967074', dataFile: 'bangong-graph-fill.json', tag: 'bangong' },
  kongjian: { courseId: '265670558', clazzId: '150967079', dataFile: 'kongjian-graph-fill.json', tag: 'kongjian' },
}[WHICH];
if (!CFG) { console.error('unknown course'); process.exit(1); }

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, CFG.dataFile), 'utf8'));
const OUT = { course: WHICH, switches: [], levels: [], questions: [], targets: [], nodes: { ok: 0, skip: 0, fail: 0, detail: {} }, errors: [] };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs: ['--enable-automation'], locale: 'zh-CN' });
const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1680, height: 1050 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36' });
const page = await ctx.newPage();
await page.goto(`https://mooc1.chaoxing.com/course/isNewCourse?courseId=${CFG.courseId}&edit=true&v=2&cpi=${CPI}&pageHeader=-1&single=0`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await sleep(9000);

let tp = null;
for (let attempt = 1; attempt <= 4 && !tp; attempt++) {
  const [popup] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 25000 }).catch(() => null),
    page.locator('a[data-url*="knowgraph"]').first().click({ timeout: 15000 }).catch(() => null),
  ]);
  if (!popup) continue;
  await popup.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 8; i++) { await sleep(3000); if (/enc=/.test(popup.url())) { tp = popup; break; } }
  if (tp) break;
  await popup.close().catch(() => {});
}
if (!tp) { fs.writeFileSync(path.join(__dirname, `graph-fill-${WHICH}.json`), JSON.stringify(OUT, null, 2)); await browser.close(); console.log('NO-GRAPH'); process.exit(1); }
await sleep(2000);

const ENC = (tp.url().match(/enc=([^&]+)/) || [])[1] || '';
const MAIN = tp.url().split('#')[0];

await tp.evaluate(() => {
  window.__api = async (url, params, method) => {
    try {
      const r = await fetch(url, { method: method || 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
      return { http: r.status, body: (await r.text()).slice(0, 2000) };
    } catch (e) { return { http: -1, body: 'ERR:' + String(e).slice(0, 100) }; }
  };
  window.__get = async (url, params) => {
    try { const r = await fetch(url + '?' + new URLSearchParams(params).toString(), { credentials: 'include' }); return await r.text(); }
    catch (e) { return 'ERR:' + String(e).slice(0, 100); }
  };
});
const J = (s) => { try { return JSON.parse(s); } catch { return null; } };
const BASE = { courseid: CFG.courseId, clazzid: '0', cpi: CPI, ut: 't', modelId: '0' };
const g = (u, p) => tp.evaluate((a) => window.__get(a.url, a.params), { url: u, params: p });
const p2 = (u, p) => tp.evaluate((a) => window.__api(a.url, a.params), { url: u, params: p });

// ── 1. 三开关 ──
const SWITCHES = [
  ['updatequestionmap', { courseId: CFG.courseId, cpi: CPI, topicModelId: '0', clazzId: CFG.clazzId, enc: ENC, questionMap: '1' }],
  ['updateabilitymap', { courseId: CFG.courseId, cpi: CPI, topicModelId: '0', clazzId: CFG.clazzId, enc: ENC, abilityMap: '1' }],
  ['updateideologicalmap', { courseId: CFG.courseId, cpi: CPI, topicModelId: '0', clazzId: CFG.clazzId, enc: ENC, ideologicalMap: '1' }],
];
for (const [ep, params] of SWITCHES) {
  const r = await p2(`/mooc2-ans/questionBankTopic/${ep}`, params);
  OUT.switches.push({ ep, http: r.http, resp: r.body.slice(0, 100) });
  await sleep(1200);
}

// ── 2. 节点属性（classify + 标签 + 描述 + 教学目标）──
const nodeIds = Object.keys(DATA.nodes);
for (const nid of nodeIds) {
  const nd = DATA.nodes[nid];
  // 先读现状（幂等合并）
  const cur = J(await g('/mooc2-ans/coursetopic/gettopicdetail', { courseid: CFG.courseId, clazzid: CFG.clazzId, cpi: CPI, ut: 't', modelId: '0', topicId: nid, enc: ENC }));
  const cd = cur?.data || {};
  const haveLabels = String(cd.topicLabelIds || cd.labelIds || '').split(',').filter(Boolean);
  const wantLabels = (nd.labels || []).map((l) => LAB[l]).filter(Boolean);
  const mergedLabels = [...new Set([...haveLabels, ...wantLabels])];
  const curDesc = String(cd.topicDesc || '').trim();
  const curClassify = String(cd.classify || '0');
  const payload = {
    courseid: CFG.courseId, cpi: CPI, topicIds: nid,
    classify: (nd.classify && curClassify === '0') ? nd.classify : (curClassify !== '0' ? curClassify : '-1'),
    cognize: '-1',
    topicLabelIds: mergedLabels.join(','),
    topicDesc: curDesc || nd.desc || '',
    teachTargert: String(cd.teachTargert || '').trim() || (nd.teach || ''),
    studyHours: '0',
  };
  if (!payload.topicDesc && !payload.teachTargert && mergedLabels.length === 0) { OUT.nodes.skip++; continue; }
  const r = await p2('/mooc2-ans/questionBankTopic/savepropertyedit', payload);
  const ok = /true/.test(r.body);
  if (ok) OUT.nodes.ok++; else { OUT.nodes.fail++; OUT.errors.push({ nid, resp: r.body.slice(0, 120) }); }
  OUT.nodes.detail[nid] = ok ? 'ok' : 'fail';
  await sleep(900);
}

// ── 3. 问题图谱层级 ──
for (const lv of DATA.levels) {
  const r = await p2(`${S2}/stat2/question-map/questionLevel/update`, { ...BASE, title: lv.title, description: lv.description, level: lv.level });
  OUT.levels.push({ level: lv.level, title: lv.title, resp: r.body.slice(0, 100) });
  await sleep(1200);
}

// ── 4. 问题图谱（按标题幂等）──
const qlRaw = J(await g(`${S2}/stat2/question-map/question/list`, BASE));
const existing = new Set();
(() => { const walk = (o) => { if (Array.isArray(o)) return o.forEach(walk); if (o && typeof o === 'object') { if (o.title) existing.add(String(o.title)); else Object.values(o).forEach(walk); } }; walk(qlRaw); })();
for (const [level, title, desc, topics] of DATA.questions) {
  if (existing.has(title)) { OUT.questions.push({ title: title.slice(0, 24), skip: 'exists' }); continue; }
  const r = await p2(`${S2}/stat2/question-map/question/add`, { ...BASE, title, description: desc, answer: '', level, labelIds: '', topicIds: topics, questionId: '0', lastQuestionId: '0' });
  OUT.questions.push({ title: title.slice(0, 24), lv: level, resp: r.body.slice(0, 100) });
  await sleep(1600);
}

// ── 5. 能力图谱（五会）──
const tlRaw = J(await g(`${S2}/stat2/course-target/manager/targetList`, { ...BASE, pageNo: '1', pageSize: '50', targetName: '', labelName: '' }));
const haveTargets = new Map(((tlRaw?.data?.data) || []).map((t) => [t.name, t.id]));
for (const [name, desc, topics] of DATA.targets) {
  let r;
  if (haveTargets.has(name)) {
    r = await p2(`${S2}/stat2/course-target/manager/updateTarget`, { ...BASE, name, description: desc, labelIds: '', topicIds: topics, type: '0', targetId: String(haveTargets.get(name)) });
  } else {
    r = await p2(`${S2}/stat2/course-target/manager/addTargetV2`, { ...BASE, name, description: desc, labelIds: '', topicIds: topics, type: '0' });
  }
  OUT.targets.push({ name, resp: r.body.slice(0, 100) });
  await sleep(1400);
}
// 能力集标题（正确端点：/stat2/course-target/knowledge/saveTargetSetTitle，标题限 ≤10 字符）
const setTitle = WHICH === 'bangong' ? '办公空间·五会能力' : '数字表现·五会能力';
const rt = await p2(`${S2}/stat2/course-target/knowledge/saveTargetSetTitle`, { courseid: CFG.courseId, clazzid: '0', cpi: CPI, modelId: '0', title: setTitle });
OUT.targetSetTitle = { title: setTitle, resp: rt.body.slice(0, 100) };

fs.writeFileSync(path.join(__dirname, `graph-fill-${WHICH}.json`), JSON.stringify(OUT, null, 2));
console.log('DONE', WHICH, 'nodes ok=' + OUT.nodes.ok, 'skip=' + OUT.nodes.skip, 'fail=' + OUT.nodes.fail, 'q=' + OUT.questions.length, 't=' + OUT.targets.length);
await browser.close();
