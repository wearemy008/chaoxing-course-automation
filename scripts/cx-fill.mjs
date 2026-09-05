/**
 * 批量写入/追加章节正文（安全追加策略，绝不覆盖已上传课件）
 *
 * 用法：
 *   node cx-fill.mjs --course=123456789 --clazz=987654321 --cpi=110000000 \
 *                    --map=chapter-map.json --marker=本章拓展资源
 *
 * map 文件格式：{ "1231342532": "<h3>...</h3>", "1231339466": "<h3>...</h3>" }
 *   键 = 章节节点 knowledgeId，值 = 要写入的 HTML
 *   也可以用 --nodes=1,2,3 配合 --html=block.html（所有节点写同一段 HTML）
 *
 * 安全策略（重要）：
 *   - 正文已含 marker  → 跳过（幂等，可反复跑）
 *   - 正文为空         → 直接写入
 *   - 正文非空         → old + "<hr/>" + html 追加
 * 进度落盘 state/fill-<course>.json，可断点续跑。
 */
import fs from 'node:fs';
import { launch, newPage, wait, args, log, die, progress, writeChapter, readChapter, resolveClazz } from './cx.mjs';

const A = args();
['course', 'cpi'].forEach((k) => { if (!A[k]) die(`缺少参数 --${k}`); });
let { course, clazz, cpi } = A;
const marker = A.marker || 'CX_AUTO_MARKER';

let map = {};
if (A.map) {
  map = JSON.parse(fs.readFileSync(A.map, 'utf-8'));
} else if (A.nodes && A.html) {
  const html = fs.readFileSync(A.html, 'utf-8');
  A.nodes.split(',').map((s) => s.trim()).filter(Boolean).forEach((id) => { map[id] = html; });
} else die('缺少 --map=xxx.json  或  --nodes=id1,id2 --html=block.html');

const ids = Object.keys(map);
const limited = A.limit ? ids.slice(0, Number(A.limit)) : ids;
const prog = progress(`fill-${course}.json`);

const browser = await launch();
const page = await newPage(browser);
clazz = await resolveClazz(page, course, clazz, cpi);
let ok = 0, skip = 0, fail = 0;

for (const id of limited) {
  if (prog.has(id)) { ok++; skip++; log(`${id} 已完成，跳过`); continue; }
  try {
    const r = await writeChapter(page, course, id, clazz, cpi, map[id], marker);
    if (r.mode === 'skip') { ok++; skip++; prog.set(id, { mode: 'skip' }); log(`${id} ⊙ 已存在`); continue; }
    if (!r.saved) throw new Error('未知保存失败');
    ok++;
    prog.set(id, { mode: r.mode, ts: new Date().toISOString() });
    log(`${id} ✓ (${r.mode})`);
  } catch (e) {
    fail++;
    log(`${id} ✗`, e.message.slice(0, 120));
  }
  await wait(800);
}
log(`完成：成功 ${ok}（跳过 ${skip}），失败 ${fail}`);

if (A.verify) {
  log('回读校验：');
  for (const id of limited.slice(0, Number(A.verify))) {
    const r = await readChapter(page, course, id, clazz, cpi);
    log(`  ${id}: 正文长度=${r.len} 含课件=${r.hasPPT}`);
  }
}
await browser.close();
