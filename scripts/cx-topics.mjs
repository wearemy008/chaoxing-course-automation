/**
 * 讨论话题批量发布
 *
 * 用法：
 *   node cx-topics.mjs --course=123456789 --clazz=987654321 --cpi=110000000 \
 *                      --json=../../题库/办公空间设计-讨论题.json [--chapters=10]
 *
 * JSON 格式：{ "1": {"title":"话题标题", "content":"正文"}, ... }
 * 发布后标题自动加「【第N章】」前缀。进度落盘，可断点续跑。
 * 删除单个话题：node cx-topics.mjs ... --delete=关键词
 */
import fs from 'node:fs';
import { launch, newPage, wait, args, log, die, progress, gotoTopicFrame, createTopic, resolveClazz } from './cx.mjs';

const A = args();
['course', 'cpi'].forEach((k) => { if (!A[k]) die(`缺少参数 --${k}`); });
let { course, clazz, cpi } = A;

const browser = await launch();
const page = await newPage(browser);
clazz = await resolveClazz(page, course, clazz, cpi);

try {
  let bf = await gotoTopicFrame(page, course, cpi);
  if (!bf) die('未进入讨论区（登录态失效？）');

  if (A.delete) {
    const kw = A.delete;
    await wait(3000);
    const sel = await bf.evaluate((k) => {
      const items = Array.from(document.querySelectorAll('li, div'))
        .filter((e) => (e.innerText || '').includes(k) && (e.innerText || '').length < 400 && e.querySelector('input[type=checkbox]'));
      if (!items.length) return false;
      const it = items[items.length - 1];
      const cb = it.querySelector('input[type=checkbox]');
      if (cb && !cb.checked) cb.click();
      return true;
    }, kw);
    if (!sel) die('未找到含关键词的话题：' + kw);
    await wait(1500);
    await bf.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('a')).find((e) => (e.innerText || '').trim() === '删除' && (e.className + '').includes('popDeleBnt'));
      if (btn) btn.click();
    });
    await wait(2500);
    await bf.evaluate(() => {
      const vis = Array.from(document.querySelectorAll('.jb_btn, a, button')).filter((e) => {
        if (e.offsetParent === null) return false;
        const t = (e.innerText || '').trim();
        return (t === '删除' || t === '确定') && e.getBoundingClientRect().width < 300;
      });
      if (vis.length) vis[vis.length - 1].click();
    });
    await wait(4000);
    log('删除请求已提交，请复核');
  } else {
    const jsonFile = A.json || die('缺少 --json（讨论题 JSON）');
    const data = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
    const chapters = Number(A.chapters || Object.keys(data).length);
    const prog = progress(`topics-${course}.json`);
    let ok = 0, fail = 0;
    for (let ch = 1; ch <= chapters; ch++) {
      const key = String(ch);
      if (prog.has(key)) { log(`第${ch}章 已发布，跳过`); ok++; continue; }
      const item = data[key];
      if (!item) continue;
      try {
        if (!(await bf.$('a.createTopic'))) bf = await gotoTopicFrame(page, course, cpi);
        await createTopic(bf, `【第${ch}章】${item.title}`, item.content);
        prog.set(key, { title: item.title, ts: new Date().toISOString() });
        ok++;
        log(`第${ch}章 已发布：${item.title}`);
      } catch (e) {
        fail++;
        log(`第${ch}章 FAIL：`, e.message.slice(0, 120));
        bf = await gotoTopicFrame(page, course, cpi);
      }
    }
    log(`发布完成：${ok}/${chapters} 成功，${fail} 失败`);
  }
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
