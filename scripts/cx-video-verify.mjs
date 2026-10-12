/**
 * 终验：读取全部挂载节点正文，统计 insertvideo 模块与视频文件名
 * 用法: node cx-video-verify.mjs [--plan=video-plan.json]
 *
 * 读取 video-plan.json 的 nodes（第N章 → 节点 id），逐节点回读正文，
 * 统计「视频 / 课件 / 图片」计数并落 video-verify.json。
 * 课程三件套来自 scripts/courses.json。
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCourse } from './cx-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = process.env.CX_STATE || path.join(__dirname, 'auth-state.json');
const CHROME = process.env.CX_CHROME || 'C:\\Users\\admin\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const PLAN_FILE = args.plan || process.env.CX_VIDEO_PLAN || path.join(__dirname, 'video-plan.json');
if (!fs.existsSync(PLAN_FILE)) {
  console.error(`未找到计划文件：${PLAN_FILE}（请参考 scripts/video-plan.example.json 创建）`);
  process.exit(1);
}
const PLAN = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
const NODES = PLAN.nodes || {};
const COURSES = Object.keys(NODES);

let COURSES_FILTER = COURSES;
if (args.course) COURSES_FILTER = COURSES.filter((k) => k === args.course);

const OUT = { ts: new Date().toISOString(), courses: {}, totalVideos: 0, totalDocs: 0, totalImages: 0 };

for (const key of COURSES_FILTER) {
  const C = loadCourse(key);
  if (!C) { console.log(`跳过 ${key}（courses.json 未配置）`); continue; }
  console.log(`\n===== ${C.name} =====`);
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
  OUT.courses[key] = [];

  for (const [ch, node] of Object.entries(NODES[key])) {
    try {
      await page.goto(`https://mooc1.chaoxing.com/edit/chapters/${C.courseId}/${node}?classId=${C.clazzId}&cpi=${C.cpi}&newMooc=true&mooc2=1`,
        { waitUntil: 'domcontentloaded', timeout: 90000 });
      await sleep(7000);
      // 激活 UE
      for (let i = 0; i < 10; i++) {
        const ok = await page.evaluate(() => !!(window.UE && window.UE.instants && window.UE.instants.ueditorInstant0));
        if (ok) break;
        await page.evaluate(() => {
          const byText = (t) => Array.from(document.querySelectorAll('a, i, span, div')).find((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (el.textContent || '').trim() === t;
          });
          const p = byText('✏') || document.querySelector('[class*=edit-icon], [class*=pencil], [class*=card-edit]');
          if (p) p.click();
        }).catch(() => {});
        await sleep(2500);
      }
      const info = await page.evaluate(() => {
        const ue = window.UE.instants.ueditorInstant0;
        const h = ue ? (ue.getContent() || '') : '';
        const videos = [];
        const docs = [];
        const imgs = [];
        const re = /<iframe[^>]*module="insertvideo"[^>]*data="([^"]*)"[^>]*>/g;
        let m;
        while ((m = re.exec(h))) {
          const d = m[1].replace(/&quot;/g, '"');
          const nm = (d.match(/"name":"(.*?)"/) || [])[1] || '';
          videos.push(nm);
        }
        const re2 = /<iframe[^>]*module="insertdoc"[^>]*data="([^"]*)"[^>]*>/g;
        while ((m = re2.exec(h))) {
          const d = m[1].replace(/&quot;/g, '"');
          docs.push((d.match(/"name":"(.*?)"/) || [])[1] || '');
        }
        const re3 = /<img[^>]*data="([^"]*)"[^>]*>/g;
        imgs.push(...(h.match(/<img/g) || []).map(() => ''));
        return { len: h.length, videos, docs, imgCount: (h.match(/<img/g) || []).length };
      });
      OUT.courses[key].push({ ch: parseInt(ch, 10), node, ...info });
      OUT.totalVideos += info.videos.length;
      OUT.totalDocs += info.docs.length;
      OUT.totalImages += info.imgCount;
      console.log(`  第${String(ch).padStart(2)}章  视频${info.videos.length}  课件${info.docs.length}  图${info.imgCount}  ${info.videos.join(' | ')}`);
    } catch (e) {
      console.log(`  第${ch}章 ERR ${e.message.slice(0, 80)}`);
      OUT.courses[key].push({ ch: parseInt(ch, 10), node, err: e.message.slice(0, 100) });
    }
  }
  await browser.close();
}

fs.writeFileSync(path.join(__dirname, 'video-verify.json'), JSON.stringify(OUT, null, 1));
console.log(`\n=== 合计：视频 ${OUT.totalVideos} / 课件 ${OUT.totalDocs} / 图片 ${OUT.totalImages} ===`);
process.exit(0);
