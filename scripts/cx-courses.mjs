/**
 * 列出我的课程（courseId / clazzId / cpi 三件套，其余命令都靠它）
 *
 * 用法：
 *   node cx-courses.mjs                 只列课程（clazzId 可能为空）
 *   node cx-courses.mjs --full           逐门进主页，补全 clazzId（慢但全）
 *   node cx-courses.mjs --json=out.json  同时写出 JSON
 */
import fs from 'node:fs';
import { launch, newPage, wait, args, log, die, listCourses, gotoHome } from './cx.mjs';

const A = args();
const browser = await launch();
const page = await newPage(browser);

let items = [];
try {
  items = await listCourses(page);
} catch (e) {
  die(e.message);
}
if (!items.length) die('课程列表为空（登录态可能失效，请重新 node cx-login.mjs）');

// 公共 cpi（同一账号固定）
const commonCpi = items.find((x) => x.cpi)?.cpi || '';
items.forEach((x) => { x.cpi = x.cpi || commonCpi; });

if (A.full) {
  for (const it of items) {
    try {
      const m = await gotoHome(page, it.courseId, it.cpi);
      it.clazzId = m.clazzId;
      log(`${it.name}  clazzId=${it.clazzId}`);
    } catch (e) {
      log(`${it.name}  clazzId 获取失败：${e.message.slice(0, 60)}`);
    }
  }
}

console.log('* 我的课程：');
items.forEach((x, i) => console.log(`  ${i + 1}. ${x.name}  courseId=${x.courseId}  clazzId=${x.clazzId || '(未取，加 --full 或运行时自动补)'}  cpi=${x.cpi}`));
if (A.json) { fs.writeFileSync(A.json, JSON.stringify(items, null, 1), 'utf-8'); log('已写出', A.json); }
log('提示：clazzId 可以不用手填，各命令未传 --clazz 时会自动从课程主页补全。');
await browser.close();
