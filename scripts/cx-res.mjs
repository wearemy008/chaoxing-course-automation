/**
 * 平台教学资源库检索 + 入库课程资料库
 *
 * 子命令：
 *   add    按关键词批量检索并添加（--kw=关键词1,关键词2）
 *   list   列出课程资料库现有文件
 *   del    按文件名子串删除（进回收站）
 *
 * 例：
 *   node cx-res.mjs add  --course=123456789 --clazz=987654321 --cpi=110000000 \
 *                        --kw=办公空间设计,室内空间设计,人体工程学 --max=5
 *   node cx-res.mjs list --course=... --clazz=... --cpi=...
 *   node cx-res.mjs del  --course=... --clazz=... --cpi=... --name=授课计划,Unity
 *
 * 说明：平台「教学资源库」按课程组织资源；部分课程显示"资源正在建设中"（0 条），
 *      脚本会自动跳过并尝试同关键词下的其他课程（最多 6 门）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { launch, newPage, wait, args, log, die, progress, openZyk, zykSearch, zykOpenCourse, zykPickAndAdd, readZiliao, clickVisible, resolveClazz } from './cx.mjs';

const A = args();
const [CMD] = A._ || ['list'];
['course', 'cpi'].forEach((k) => { if (!A[k]) die(`缺少参数 --${k}`); });
let { course, clazz, cpi } = A;
const progFile = progress(`res-${course}.json`);

const browser = await launch();
const page = await newPage(browser);
clazz = await resolveClazz(page, course, clazz, cpi);

try {
  if (CMD === 'list') {
    const names = await readZiliao(page, course, cpi);
    console.log(`* 资料库共 ${names.length} 项：`);
    names.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
  }

  if (CMD === 'add') {
    const kws = (A.kw || die('缺少 --kw=关键词1,关键词2')).split(',').map((s) => s.trim()).filter(Boolean);
    const maxN = Number(A.max || 5);
    for (const kw of kws) {
      if (progFile.data[kw]) { log(kw, '已添加过，跳过'); continue; }
      try {
        const { zyk, cf } = await openZyk(page, course, cpi);
        const s = await zykSearch(zyk, kw);
        if (s !== 'ok') { log(kw, '搜索框异常:', s); continue; }
        const cands = await zyk.evaluate(() => Array.from(document.querySelectorAll('[onclick*="getdatalist"]'))
          .map((c) => { const m = (c.getAttribute('onclick') || '').match(/getKcResourceData','([^']+)'/); return m ? m[1] : null; })
          .filter(Boolean));
        if (!cands.length) { log(kw, '无相关课程'); continue; }
        const uniq = [...new Set(cands)];                       // 结果卡片常重复
        uniq.sort((a, b) => (b.includes(kw) ? 1 : 0) - (a.includes(kw) ? 1 : 0));
        let used = null, n = 0;
        for (const cn of uniq.slice(0, 6)) {
          n = await zykOpenCourse(zyk, cn);
          if (n > 0) { used = cn; break; }
          await zyk.evaluate(() => { if (typeof gotoback === 'function') gotoback(); });
          await wait(3000);
        }
        if (!used) { log(kw, '→ 相关课程资源均为空'); continue; }
        await zyk.evaluate(() => { const h = document.querySelector('#idspptArr'); if (h) h.value = ''; });
        const existing = Object.values(progFile.data).flat();
        const r = await zykPickAndAdd(page, zyk, cf, maxN, existing);
        if (r.err) { log(kw, `(${used}) →`, r.err); continue; }
        progFile.set(kw, r.picked);
        log(kw, `(${used}) → 添加 ${r.picked.length} 项:`, r.picked.join(' / ').slice(0, 160));
      } catch (e) {
        log(kw, 'FAIL:', e.message.slice(0, 120));
      }
    }
    log('完成。建议用 list 复核，并用 del 清理无关文件。');
  }

  if (CMD === 'del') {
    const pats = (A.name || die('缺少 --name=子串1,子串2')).split(',').map((s) => s.trim()).filter(Boolean);
    await page.goto(`https://mooc1.chaoxing.com/course/isNewCourse?courseId=${course}&edit=true&v=2&cpi=${cpi}&pageHeader=-1&single=0`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await wait(9000);
    await page.locator('li a[data-url="/mooc2-ans/coursedata"], :text-is("资料")').first().click({ timeout: 10000 });
    await wait(9000);
    const cf = page.frames().reverse().find((f) => f.url().includes('coursedata'));
    if (!cf) die('未打开资料页');
    const norm = (s) => (s || '').replace(/\s+/g, '');
    const sel = await cf.evaluate((ps) => {
      const nn = (s) => (s || '').replace(/\s+/g, '');
      const matched = [];
      let n = 0;
      document.querySelectorAll('input[type=checkbox]').forEach((cb) => {
        if (cb.closest('.dataHead')) return;
        const c = cb.closest('ul') || cb.closest('.dataBody') || cb.parentElement.parentElement;
        if (!c) return;
        const ne = c.querySelector('.dataBody_name');
        const name = nn(ne ? ne.innerText : c.innerText);
        if (!name) return;
        if (ps.some((p) => name.includes(nn(p)))) {
          if (!cb.checked) { cb.click(); n++; }
          matched.push(name.slice(0, 50));
        }
      });
      return { n, matched };
    }, pats);
    log('已勾选:', sel.n, JSON.stringify(sel.matched));
    if (sel.n > 0) {
      await wait(1500);
      await cf.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a')).find((e) => (e.className + '').includes('popDeleBnt') && e.offsetParent !== null);
        if (btn) btn.click();
      });
      await wait(2500);
      await clickVisible(cf, '.jb_btn, a, button', '删除');
      await wait(4000);
      log('删除完成');
    }
  }
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
