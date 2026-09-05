/**
 * 超星题库批量操作
 *
 * 子命令：
 *   view    查看题库（总题数 + 各章文件夹题数）
 *   mkdir   批量建「第N章」文件夹
 *   import  批量导入题本（每章一个 .txt，按章归档）
 *   clean   清空某文件夹内的题目（进回收站，可恢复）
 *   delall  清空当前列表全部题目
 *
 * 例：
 *   node cx-quiz.mjs view   --course=123456789 --clazz=987654321 --cpi=110000000
 *   node cx-quiz.mjs mkdir  --course=123456789 --clazz=987654321 --cpi=110000000 --n=10
 *   node cx-quiz.mjs import --course=123456789 --clazz=987654321 --cpi=110000000 \
 *                           --dir=../../题库 --prefix=办公空间设计 --chapters=10
 *   node cx-quiz.mjs clean  --course=123456789 --clazz=987654321 --cpi=110000000 --folder=第1章
 */
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, wait, args, log, die, progress,
  gotoSmartImport, importQuiz, readTiku, tikuUrl, gotoHome, clickVisible, resolveClazz } from './cx.mjs';

const A = args();
const [CMD] = A._;
if (!CMD) die('缺少子命令：view | mkdir | import | clean | delall');
for (const k of ['course', 'cpi']) if (!A[k]) die(`缺少参数 --${k}`);
let { course, clazz, cpi } = A;

const browser = await launch();
const page = await newPage(browser);
clazz = await resolveClazz(page, course, clazz, cpi);

try {
  if (CMD === 'view') {
    const r = await readTiku(page, course, clazz, cpi);
    console.log(`* 题库总题数：${r.total}`);
    (r.folders || []).forEach((f) => console.log(`  ${f.name}: ${f.n} 题`));
    // 根目录游离题检查
    const folderSum = (r.folders || []).reduce((s, f) => s + f.n, 0);
    if (Number(r.total) !== folderSum) console.log(`  ⚠ 有 ${Number(r.total) - folderSum} 题未在章节文件夹内（在根目录）`);
  }

  if (CMD === 'mkdir') {
    const n = Number(A.n || 10);
    await gotoHome(page, course, cpi);
    const enc = new URL(page.url()).searchParams.get('enc');
    await page.goto(tikuUrl(course, clazz, enc, cpi), { waitUntil: 'domcontentloaded', timeout: 90000 });
    await wait(8000);
    for (let i = 1; i <= n; i++) {
      const name = `第${i}章`;
      const exists = await page.evaluate((nm) => document.body.innerText.split('\n').some((l) => l.trim() === nm), name);
      if (exists) { log('已存在，跳过:', name); continue; }
      let done = false;
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        const r = await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button,a,div,span')).filter((e) => {
            if (e.offsetParent === null) return false;
            if ((e.innerText || '').trim() !== '新建文件夹') return false;
            const rc = e.getBoundingClientRect();
            return rc.width < 250 && rc.height < 70 && e.querySelectorAll('*').length <= 3;
          });
          if (!btn.length) return 'no-btn';
          btn.sort((x, y) => x.querySelectorAll('*').length - y.querySelectorAll('*').length);
          btn[0].click();
          return 'clicked';
        });
        if (r !== 'clicked') break;
        await wait(2000);
        await page.keyboard.type(name, { delay: 40 });   // 行内输入框已聚焦并全选
        await wait(500);
        await page.keyboard.press('Enter');
        await wait(2500);
        done = await page.evaluate((nm) => document.body.innerText.split('\n').some((l) => l.trim() === nm), name);
      }
      log(done ? `√ ${name}` : `× ${name} 创建失败`);
    }
  }

  if (CMD === 'import') {
    const dir = A.dir || die('缺少 --dir（题本目录）');
    const prefix = A.prefix || die('缺少 --prefix（题本文件名前缀）');
    const chapters = Number(A.chapters || 10);
    const prog = progress(`quiz-${course}.json`);
    let ok = 0, fail = 0;
    await gotoSmartImport(page, course, clazz, cpi);
    for (let ch = 1; ch <= chapters; ch++) {
      const key = String(ch);
      if (prog.has(key)) { log(`第${ch}章 已完成，跳过`); ok++; continue; }
      const file = path.join(dir, `${prefix}-第${ch}章-章节测验.txt`);
      if (!fs.existsSync(file)) { log(`第${ch}章 题本不存在：${file}`); continue; }
      try {
        const cnt = await importQuiz(page, course, clazz, cpi, file, `第${ch}章`);
        prog.set(key, { cnt, ts: new Date().toISOString() });
        ok++;
        log(`第${ch}章 OK：${cnt} 题入库`);
      } catch (e) {
        fail++;
        log(`第${ch}章 FAIL：`, e.message.slice(0, 120));
        try { await gotoSmartImport(page, course, clazz, cpi); } catch {}
      }
    }
    log(`导入完成：${ok}/${chapters} 成功，${fail} 失败`);
    log('⚠ 务必用 view 子命令回读复核每章题数（曾出现章节重复/丢失）');
    if (A.reset) { fs.rmSync(path.resolve(progress(`quiz-${course}.json`).data && ''), { force: true }); }
  }

  if (CMD === 'clean' || CMD === 'delall') {
    await gotoHome(page, course, cpi);
    const enc = new URL(page.url()).searchParams.get('enc');
    await page.goto(tikuUrl(course, clazz, enc, cpi), { waitUntil: 'domcontentloaded', timeout: 90000 });
    await wait(8000);
    if (CMD === 'clean') {
      if (!A.folder) die('缺少 --folder=第N章');
      const clicked = await page.evaluate((fname) => {
        const nodes = Array.from(document.querySelectorAll('a,div,span'))
          .filter((e) => e.offsetParent !== null && (e.innerText || '').trim() === fname && e.getBoundingClientRect().height < 60);
        if (!nodes.length) return false;
        nodes.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
        nodes[0].click();
        return true;
      }, A.folder);
      if (!clicked) die('未找到文件夹 ' + A.folder);
      await wait(5000);
    }
    for (let round = 0; round < 6; round++) {
      const n = await page.evaluate(() => document.querySelectorAll('li.TiMu input.item').length);
      log('当前题数:', n);
      if (!n) break;
      await page.evaluate(() => document.querySelectorAll('li.TiMu input.item').forEach((b) => { if (!b.checked) b.click(); }));
      await wait(1500);
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a')).find((e) => (e.className + '').includes('popDeleBnt') && e.offsetParent !== null);
        if (btn) btn.click();
      });
      await wait(2500);
      // 确认按钮文字是「删除」而非「确定」
      await clickVisible(page, '.jb_btn, a, button', '删除');
      await wait(4000);
    }
    log('清空完成，剩余:', await page.evaluate(() => document.querySelectorAll('li.TiMu').length));
  }
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
