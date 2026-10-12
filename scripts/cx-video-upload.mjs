/**
 * 教学视频批量上传（章节挂载版）
 *
 * 策略：视频追加挂载到「该章已存放 PPT 的同一个节节点」正文里（同章课件合并呈现）
 *
 * 流程：
 *   开编辑器 → 激活 UE(✏) → getContent 读原文（幂等标记 VIDEO::xxx）→
 *   真实点 .ans-command-insertvideo → insertvideo iframe →
 *   setInputFiles（★ input[name=file][accept*=video]，页面有两个同名 input）→
 *   轮询帧内「完成」/100% → 点确认 → ★ 等 insertvideo iframe 消失 →
 *   校验媒体块增量 → 埋幂等标记 → savecard
 *
 * 用法：node cx-video-upload.mjs --plan=video-plan.json [--course=<别名>] [--from=N] [--to=N] [--only=关键词]
 *
 * —— video-plan.json 格式（参考 video-plan.example.json）——
 *   {
 *     "videoDir": "D:/我的课程/视频成品",
 *     "nodes": { "bangong": { "1": "该章PPT所在节点id", "2": "该章PPT所在节点id" } },
 *     "plan": [ ["bangong", 1, "课程名-01-第一集.mp4"], ["bangong", 2, "课程名-02-第二集.mp4"] ]
 *   }
 *   课程别名 → 三件套来自 scripts/courses.json
 *   节点 id：该章 PPT 所在节点（避免 PPT+视频分散在不同节点）
 *
 * 幂等：正文已含 VIDEO::<name> 标记则跳过
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCourse } from './cx-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = process.env.CX_STATE || path.join(__dirname, 'auth-state.json');
const CHROME = process.env.CX_CHROME || 'C:\\Users\\admin\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const RESULT = path.join(__dirname, 'video-upload-result.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));

const PLAN_FILE = args.plan || process.env.CX_VIDEO_PLAN || path.join(__dirname, 'video-plan.json');
if (!fs.existsSync(PLAN_FILE)) {
  console.error(`未找到上传计划：${PLAN_FILE}`);
  console.error('请复制 scripts/video-plan.example.json 为 video-plan.json 并填写（格式见本文件顶部说明）。');
  process.exit(1);
}
const J = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
const VIDEO_DIR = J.videoDir || process.env.CX_VIDEO_DIR || path.join(__dirname, '..', '视频成品');
const NODES = J.nodes || {};
const PLAN = J.plan || [];

let TARGETS = PLAN;
if (args.course) TARGETS = TARGETS.filter((x) => x[0] === args.course);
if (args.from) TARGETS = TARGETS.filter((x) => x[1] >= parseInt(args.from, 10));
if (args.to) TARGETS = TARGETS.filter((x) => x[1] <= parseInt(args.to, 10));
if (args.only) TARGETS = TARGETS.filter((x) => x[2].includes(args.only));

const loadResult = () => (fs.existsSync(RESULT) ? JSON.parse(fs.readFileSync(RESULT, 'utf8')) : { done: {}, log: [] });
const saveResult = (r) => fs.writeFileSync(RESULT, JSON.stringify(r, null, 1));

console.log(`待上传 ${TARGETS.length} 集`);

for (const [course, ch, file] of TARGETS) {
  const res = loadResult();
  const key = file;
  if (res.done[key] && res.done[key].ok) { console.log(`跳过 ${file}（已完成）`); continue; }

  const C = loadCourse(course);
  if (!C) { console.log(`✗ 未知课程别名「${course}」：请在 courses.json 中配置`); continue; }
  const node = (NODES[course] || {})[ch];
  if (!node) { console.log(`✗ 未在 video-plan.json 的 nodes.${course} 中配置第 ${ch} 章的节点 id`); continue; }
  const FILE = path.isAbsolute(file) ? file : path.join(VIDEO_DIR, file);
  if (!fs.existsSync(FILE)) { console.log(`✗ 找不到文件 ${FILE}`); continue; }
  const sizeMB = Math.round(fs.statSync(FILE).size / 1048576);
  console.log(`\n===== ${C.name} 第${ch}章 ${file} (${sizeMB}MB) → 节点 ${node} =====`);

  const entry = { course, ch, node, file, sizeMB, steps: {} };
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'], locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  });
  const ctx = await browser.newContext({
    storageState: STATE, viewport: { width: 1680, height: 1050 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  const baseName = path.basename(file);

  let uploadedOid = null;
  page.on('response', async (r) => {
    try {
      if (/ananas\/status\/[0-9a-f]{24,}/.test(r.url())) {
        const body = await r.text();
        if (body.includes('"filename":"' + baseName + '"')) {
          const m = body.match(/"objectid":"([0-9a-f]+)"/);
          if (m) uploadedOid = m[1];
        }
      }
    } catch (e) {}
  });

  try {
    await page.goto(`https://mooc1.chaoxing.com/edit/chapters/${C.courseId}/${node}?classId=${C.clazzId}&cpi=${C.cpi}&newMooc=true&mooc2=1`,
      { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(9000);

    // 激活 UE
    let ueReady = false;
    for (let i = 0; i < 14; i++) {
      ueReady = await page.evaluate(() => !!(window.UE && window.UE.instants && window.UE.instants.ueditorInstant0));
      if (ueReady) break;
      await page.evaluate(() => {
        const byText = (t) => Array.from(document.querySelectorAll('a, i, span, div')).find((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (el.textContent || '').trim() === t;
        });
        const pencil = byText('✏') || document.querySelector('[class*=edit-icon], [class*=pencil], [class*=card-edit]');
        if (pencil) { pencil.click(); return; }
        const card = document.querySelector('[class*=ans-card], [class*=card-body], [class*=editCard]');
        if (card) card.click();
      }).catch(() => {});
      await sleep(3000);
    }
    if (!ueReady) throw new Error('UEditor 未激活');
    entry.steps.ueReady = true;

    // 幂等
    const marker = `VIDEO::${baseName}`;
    const before = await page.evaluate(() => window.UE.instants.ueditorInstant0.getContent() || '');
    if (before.includes(marker) || before.includes(baseName)) {
      entry.ok = true; entry.steps.skipped = 'already-uploaded';
      const r2 = loadResult(); r2.done[key] = entry; saveResult(r2);
      console.log('  已有该视频，跳过');
      await browser.close(); continue;
    }
    // 统计已有课件/视频块（taskIframe=文档, ans-video=视频）
    const cntMods = (s) => ({
      doc: (s.match(/taskIframe/g) || []).length,
      video: (s.match(/ans-video|module="video"|ans-insertvideo/g) || []).length,
      img: (s.match(/ans-insertimage|module="image"/g) || []).length,
    });
    const beforeMods = cntMods(before);
    entry.steps.beforeMods = beforeMods;
    entry.steps.beforeLen = before.length;
    const beforeTotal = beforeMods.doc + beforeMods.video + beforeMods.img;

    // 点「视频」开 insertvideo 弹层（★ 不是「文档」）
    // 工具栏按钮需先把光标放进正文才可点：先点编辑区再点按钮，失败则重试
    let opened = false;
    for (let attempt = 0; attempt < 4 && !opened; attempt++) {
      try {
        // 激活编辑区
        await page.evaluate(() => {
          const ue = window.UE.instants.ueditorInstant0;
          try { ue.focus(); } catch (e) {}
          const body = document.querySelector('iframe[id^=ueditor_]');
          if (body) body.click();
        }).catch(() => {});
        await sleep(1200);
        // 若工具栏未显示 insertvideo 按钮，先点一下已有媒体块让工具栏切换
        const hasBtn = await page.evaluate(() => !!document.querySelector('.ans-command-insertvideo:not([style*="display: none"])'));
        if (!hasBtn) {
          await page.evaluate(() => {
            const blk = document.querySelector('.ans-module, iframe.taskIframe, [class*=ans-attach]');
            if (blk) blk.click();
          }).catch(() => {});
          await sleep(1500);
        }
        const btn = page.locator('.ans-command-insertvideo:visible').first();
        if (await btn.count()) {
          await btn.click({ timeout: 6000 }).catch(async () => {
            await page.locator('.ans-command-insertvideo:visible').first().click({ force: true, timeout: 6000 });
          });
          opened = true;
        }
      } catch (e) {}
      if (!opened) { console.log(`  [retry ${attempt + 1}] 视频按钮未就绪，重试…`); await sleep(3000); }
    }
    if (!opened) throw new Error('视频按钮无法点击');
    console.log('  已点开「视频」弹层');
    await sleep(6000);

    // 等 insertvideo iframe
    let dlg = null;
    for (let i = 0; i < 30; i++) {
      dlg = page.frames().find((f) => /dialogs\/insertvideo\/insertvideo\.html/i.test(f.url()));
      if (dlg) break;
      await sleep(1000);
    }
    if (!dlg) throw new Error('insertvideo iframe 未出现');
    entry.steps.dialogOpened = true;
    await sleep(2500);

    // 设文件（video 专用 input[name=file][accept*=video]）
    const fin = dlg.locator('input[name="file"][accept*="video"]').first();
    await fin.setInputFiles(FILE, { timeout: 60000 });
    entry.steps.fileSet = true;
    console.log('  视频文件已设置，上传中（较大，耐心等）...');

    // 轮询：本地上传列表出现「完成」或 100%，或捕获到 status 响应
    const waitMs = parseInt(args.wait || '60', 10) * 60000;
    const t0 = Date.now();
    let done = false, lastLog = '';
    while (Date.now() - t0 < waitMs) {
      await sleep(8000);
      if (uploadedOid) { done = true; entry.steps.uploadedOid = uploadedOid; break; }
      const snap = await dlg.evaluate(() => {
        const t = (document.body.innerText || '').replace(/\s+/g, ' ');
        const bars = Array.from(document.querySelectorAll('[class*=progress]')).map((el) => (el.style && el.style.width) || '').filter((w) => w).slice(0, 4);
        return { t: t.slice(0, 400), pcts: (t.match(/(\d{1,3})%/g) || []).slice(0, 4), bars };
      }).catch(() => null);
      if (!snap) continue;
      const sig = JSON.stringify([snap.pcts, snap.bars, snap.t.includes('完成')]);
      if (sig !== lastLog) { lastLog = sig; console.log(`  [${Math.round((Date.now() - t0) / 60000)}min] pct=${snap.pcts.join(',')} bars=${snap.bars.join(',')} done?=${snap.t.includes('完成')}`); }
      if (/上传完成|已完成|100%/.test(snap.t) || snap.pcts.some((p) => p === '100%') || snap.bars.some((w) => w === '100%')) { done = true; break; }
    }
    entry.steps.uploadDone = done;
    if (!done) throw new Error('上传等待超时');
    await sleep(4000);

    // 点弹层内「确认」
    const okClicked = await page.evaluate(() => {
      const dlgEl = document.querySelector('.edui-dialog.edui-for-insertvideo, .edui-dialog');
      const scope = dlgEl && dlgEl.getBoundingClientRect().width > 100 ? dlgEl : document;
      const btns = Array.from(scope.querySelectorAll('.edui-button, .jb_btn, a, button')).filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && /^(确认|确定|确 定|OK)$/i.test((b.textContent || '').trim());
      });
      if (btns.length) { btns[btns.length - 1].click(); return true; }
      return false;
    });
    entry.steps.okClicked = okClicked;
    if (!okClicked) throw new Error('未找到确认按钮');
    await sleep(10000);

    // 等弹层消失（确认生效的强信号）
    let dlgGone = false;
    for (let i = 0; i < 20; i++) {
      const alive = page.frames().some((f) => /dialogs\/insertvideo\/insertvideo\.html/i.test(f.url()));
      if (!alive) { dlgGone = true; break; }
      await sleep(1000);
    }
    entry.steps.dlgGone = dlgGone;
    // 若弹层还在，再点一次确认
    if (!dlgGone) {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('.edui-button, .jb_btn, a, button')).filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && /^(确认|确定|确 定|OK)$/i.test((b.textContent || '').trim());
        });
        if (btns.length) btns[btns.length - 1].click();
      });
      await sleep(6000);
    }

    // 追加「本章视频」小标题（若首次）
    const after = await page.evaluate(() => window.UE.instants.ueditorInstant0.getContent() || '');
    const afterMods = cntMods(after);
    entry.steps.afterMods = afterMods;
    const afterTotal = afterMods.doc + afterMods.video + afterMods.img;
    if (afterTotal <= beforeTotal) throw new Error(`正文未新增媒体块 (${beforeTotal}→${afterTotal})`);
    console.log(`  视频已插入正文（doc/video/img ${JSON.stringify(beforeMods)}→${JSON.stringify(afterMods)}）`);

    // 埋幂等标记（隐藏注释，不改动视觉）
    await page.evaluate((mk) => {
      const ue = window.UE.instants.ueditorInstant0;
      const cur = ue.getContent() || '';
      if (!cur.includes(mk)) ue.setContent(cur + `<!--${mk}-->`);
    }, marker).catch(() => {});

    // 保存
    const saveResp = page.waitForResponse((r) => /savecard/i.test(r.url()), { timeout: 40000 }).then((r) => ({ status: r.status() })).catch(() => null);
    await page.locator('a.ans-save-btn:visible').first().click({ timeout: 15000 });
    const sv = await saveResp;
    entry.steps.save = sv ? sv.status : 'no-response';
    if (!sv || sv.status !== 200) throw new Error('保存响应异常: ' + JSON.stringify(sv));
    await sleep(5000);

    entry.ok = true;
    entry.finishedAt = new Date().toISOString();
    const r3 = loadResult(); r3.done[key] = entry; saveResult(r3);
    console.log(`  ✓ 已完成并保存`);
  } catch (e) {
    entry.error = (e.message || '').slice(0, 300);
    const r4 = loadResult(); r4.done[key] = entry; saveResult(r4);
    console.log('  ✗ ' + entry.error);
    await page.screenshot({ path: path.join(__dirname, `vup-fail-${baseName.slice(0, 20)}.png`) }).catch(() => {});
  }
  await browser.close();
}
console.log('\nALL DONE');
process.exit(0);
