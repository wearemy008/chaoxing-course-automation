/**
 * 终验：读取全部挂载节点正文，统计 insertvideo 模块与视频文件名
 * 用法: node video-verify.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE = process.env.CX_STATE || path.join(__dirname, 'auth-state.json');
const CHROME = process.env.CX_CHROME || 'C:\\Users\\admin\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CFG = {
  bangong:  { c: '265670555', k: '156694092', p: '110496162', name: '办公空间设计' },
  kongjian: { c: '265670558', k: '156695612', p: '110496162', name: '空间数字化表现' },
};
const NODES = {
  bangong: { 1: '1231342532', 2: '1231339466', 3: '1231339472', 4: '1231339478', 5: '1231339484', 6: '1231339490', 7: '1231339496', 8: '1231339502', 9: '1231339508', 10: '1231339514' },
  kongjian: { 1: '1229280785', 2: '1229283191', 3: '1229289628', 4: '1229290900', 5: '1229300851', 6: '1229302941', 7: '1229305603', 8: '1229308671', 9: '1229337499', 10: '1229338039', 11: '1229339181' },
};

const OUT = { ts: new Date().toISOString(), courses: {}, totalVideos: 0, totalDocs: 0, totalImages: 0 };

for (const key of ['bangong', 'kongjian']) {
  const C = CFG[key];
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
      await page.goto(`https://mooc1.chaoxing.com/edit/chapters/${C.c}/${node}?classId=${C.k}&cpi=${C.p}&newMooc=true&mooc2=1`,
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
