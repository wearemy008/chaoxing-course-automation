#!/usr/bin/env node
/**
 * cx — 超星泛雅/学习通课程自动化 CLI 统一入口
 *
 *   node bin/cx.js login      扫码登录（首次）
 *   node bin/cx.js courses    列出我的课程（courseId/clazzId/cpi）
 *   node bin/cx.js quiz       题库：view | mkdir | import | clean | delall
 *   node bin/cx.js topics     讨论话题批量发布/删除
 *   node bin/cx.js res        资料库：add | list | del
 *   node bin/cx.js fill       章节正文批量安全追加
 *
 * 全局选项：--course=ID --cpi=ID [--clazz=ID]（其余参数透传给对应子命令）
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP = {
  login: 'cx-login.mjs',
  courses: 'cx-courses.mjs',
  quiz: 'cx-quiz.mjs',
  topics: 'cx-topics.mjs',
  res: 'cx-res.mjs',
  fill: 'cx-fill.mjs',
};

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(`cx — 超星课程自动化 CLI

用法：cx <命令> [参数...]

  login     扫码登录一次，保存登录态（首次必跑）
  courses   列出我的课程（courseId / clazzId / cpi 三件套）
  quiz      题库管理：view | mkdir | import | clean | delall
  topics    讨论话题批量发布 / 删除
  res       课程资料库：add | list | del
  fill      章节正文批量安全追加（绝不覆盖已上传课件）

示例：
  cx login
  cx courses --json=courses.json
  cx quiz view --course=123456789 --cpi=110000000
  cx quiz import --course=123456789 --cpi=110000000 --dir=题库 --prefix=课程名 --chapters=10
  cx topics --course=123456789 --cpi=110000000 --json=讨论题.json
  cx res add --course=123456789 --cpi=110000000 --kw=室内设计,人体工程学 --max=5
  cx fill --course=123456789 --cpi=110000000 --map=chapter-map.json --marker=本章拓展资源

环境变量：CX_CHROME（chrome.exe 路径） CX_STATE（登录态 JSON） CX_HEADFUL=1（可见窗口） CX_SLOW=1（放慢）
`);
  process.exit(0);
}

const script = MAP[cmd];
if (!script) { console.error(`未知命令：${cmd}（可选：${Object.keys(MAP).join(' | ')}）`); process.exit(1); }

const r = spawnSync(process.execPath, [path.join(HERE, '..', 'scripts', script), ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 1);
