/**
 * 从超星取各章 PPT 的 PDF 预览版（用于渲染成视频画面）
 *
 * 用法：
 *   node fetch-pdf.mjs --course=<courseId> --clazz=<clazzId> --cpi=<cpi> --oids=ppt-oids.json --out=pdf/ch1
 *   node fetch-pdf.mjs --course=<courseId> --clazz=<clazzId> --cpi=<cpi> --oids=ppt-oids.json --out=pdf/ch1 --kj
 *
 *   --cpi 也可省略，改用 --course=<courses.json 别名> 从 courses.json 读取。
 *   --kj   表示 oids 文件是「按章一组 oid」的结构（空数课程 0-based 章号 +1）
 *
 * 说明：必须在章节编辑器页上下文内 fetch /ananas/status/{oid}（独立 request 返回 {}）；
 *       下载 PDF 时 Referer 必带，否则 403。
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCourse } from './cx-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).map((s) => {
  const i = s.indexOf('=');
  if (i < 0) return [s.replace(/^--/, ''), true];        // 无值 flag，如 --kj
  return [s.slice(2, i), s.slice(i + 1)];
}));

// 允许 --course 传 courses.json 别名，三件套从配置读取
const ALIAS = argv.course && !/^\d+$/.test(argv.course) ? loadCourse(argv.course) : null;
const COURSE = ALIAS ? ALIAS.courseId : (argv.course || die('缺 --course'));
const CLAZZ = argv.clazz || (ALIAS && ALIAS.clazzId) || die('缺 --clazz');
const CPI = argv.cpi || (ALIAS && ALIAS.cpi) || die('缺 --cpi（或在 courses.json 中配置）');
const OIDS_FILE = path.join(__dirname, argv.oids || die('缺 --oids'));
const OUT_DIR = path.join(__dirname, argv.out || die('缺 --out'));
const IS_KJ = 'kj' in argv;
const CHROME = process.env.CX_CHROME || 'C:\\Users\\admin\\.agent-browser\\browsers\\chrome-152.0.7977.82\\chrome.exe';
const STATE = process.env.CX_STATE || path.join(__dirname, 'auth-state.json');
const STATIC = 'https://s2.ananas.chaoxing.com/sv-w9/';

function die(m) { console.error('✗ ' + m); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 统一成 [{ch, nid, oid}] 列表 */
function normalize(raw) {
  const out = [];
  for (const [k, v] of Object.entries(raw)) {
    const ch = String(Number(k) + (IS_KJ ? 1 : 0));   // 空数是 0-based
    if (IS_KJ) {
      (v.oids || []).forEach((oid, i) => out.push({ ch, nid: v.nid, oid, idx: i, name: v.name }));
    } else {
      const m = (v.desc || '').match(/objectid&quot;:&quot;([0-9a-f]{16,40})&quot;/i)
        || (v.desc || '').match(/ananas\/status\/([0-9a-f]{16,40})/i);
      if (m) out.push({ ch, nid: v.kid, oid: m[1] });
    }
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const raw = JSON.parse(fs.readFileSync(OIDS_FILE, 'utf-8'));
  const list = normalize(raw);
  console.log('* 待下载', list.length, '个课件');

  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'], locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
  });
  const ctx = await browser.newContext({
    storageState: STATE,
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  });

  const results = [];
  for (const it of list) {
    const tag = `第${it.ch}章`;
    const page = await ctx.newPage();
    try {
      const editUrl = `https://mooc1.chaoxing.com/edit/chapters/${COURSE}/${it.nid}?classId=${CLAZZ}&cpi=${CPI}&newMooc=true&mooc2=1`;
      await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(5000);
      const info = await page.evaluate(async (o) => {
        const res = await fetch(`/ananas/status/${o}?_dc=${Date.now()}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        return await res.json();
      }, it.oid);
      await page.close();

      // pdf 字段可能是文件名（需拼 STATIC 前缀）或完整 URL
      let pdfUrl = info.pdf || '';
      if (pdfUrl && !/^https?:/i.test(pdfUrl)) pdfUrl = STATIC + pdfUrl.replace(/^\//, '');
      if (!pdfUrl) { console.log(`${tag} ✗ 无 PDF`); results.push({ ...it, error: '无PDF' }); continue; }

      const resp = await ctx.request.get(pdfUrl, {
        headers: { Referer: 'https://mooc1.chaoxing.com/', Accept: '*/*' },
        timeout: 180000,
      });
      if (!resp.ok()) throw new Error('HTTP ' + resp.status());
      const buf = await resp.body();
      const fp = path.join(OUT_DIR, `ch${String(it.ch).padStart(2, '0')}.pdf`);
      fs.writeFileSync(fp, buf);
      results.push({ ...it, file: fp, size: buf.length, pagenum: info.pagenum, filename: info.filename });
      console.log(`${tag} ✓ ${(buf.length / 1024 / 1024).toFixed(2)} MB  ${info.pagenum} 页`);
    } catch (e) {
      try { await page.close(); } catch {}
      results.push({ ...it, error: e.message.slice(0, 160) });
      console.log(`${tag} ✗ ${e.message.slice(0, 100)}`);
    }
    await sleep(400);
  }

  fs.writeFileSync(path.join(OUT_DIR, '_index.json'), JSON.stringify(results, null, 1), 'utf-8');
  console.log('* 完成 →', OUT_DIR, `(${results.filter((r) => r.file).length}/${list.length})`);
  await browser.close();
}

main().catch((e) => { console.error('失败：' + e.message); process.exit(1); });
