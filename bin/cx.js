#!/usr/bin/env node
/**
 * cx — 超星泛雅/学习通课程全流程自动化 CLI 统一入口
 *
 *   node bin/cx.js login      扫码登录（首次）
 *   node bin/cx.js courses    列出我的课程（courseId/clazzId/cpi）
 *   node bin/cx.js fill       章节正文批量安全追加
 *   node bin/cx.js quiz       题库：view | mkdir | import | clean | delall
 *   node bin/cx.js topics     讨论话题批量发布/删除
 *   node bin/cx.js res        资料库：add | list | del
 *   node bin/cx.js video      课件视频：upload | verify
 *   node bin/cx.js exam       考试：build | publish
 *   node bin/cx.js task       任务引擎：publish
 *   node bin/cx.js graph      知识图谱：fill
 *
 * 全局选项：--course=ID --cpi=ID [--clazz=ID]（其余参数透传给对应子命令）
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP = {
  login:   'cx-login.mjs',
  courses: 'cx-courses.mjs',
  fill:    'cx-fill.mjs',
  quiz:    'cx-quiz.mjs',
  topics:  'cx-topics.mjs',
  res:     'cx-res.mjs',
  video:   { upload: 'cx-video-upload.mjs', verify: 'cx-video-verify.mjs' },
  exam:    { build: 'cx-exam-build.mjs', publish: 'cx-exam-publish.mjs' },
  task:    { publish: 'cx-task-publish.mjs' },
  graph:   { fill: 'cx-graph-fill.mjs' },
};

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(`cx — 超星课程全流程自动化 CLI  v3.0

用法：cx <命令> [子命令] [参数...]

  登录/课程
    login                     扫码登录一次，保存登录态（首次必跑）
    courses                   列出我的课程（courseId / clazzId / cpi 三件套）

  内容建设
    fill                      章节正文批量安全追加（绝不覆盖已上传课件）
    video upload              讲解视频按章挂载到章节正文
    video verify              全量回读校验（视频/课件/图片计数）

  题库 / 讨论 / 资料
    quiz view|mkdir|import|clean|delall
    topics                    讨论话题批量发布 / 删除
    res add|list|del          课程资料库（平台教学资源库检索入库）

  考核运营
    exam build                自动组卷（跳二次确认，轮询拿 paperId）
    exam publish              发布试卷到班级（定时截止 + 限时）
    task publish              任务引擎批量发布

  知识图谱
    graph fill                知识/问题/能力/思政四类图谱填充

示例：
  cx login
  cx courses --json=courses.json
  cx fill     --course=123456789 --cpi=110000000 --map=chapter-map.json --marker=本章拓展资源
  cx video    upload --course=bangong --from=1 --to=10
  cx video    verify --course=bangong
  cx exam     build bangong 20 5 4
  cx exam     publish bangong <paperId> 0 90 7
  cx task     publish bangong 1 10
  cx graph    fill bangong

视频合成请直接用 Python（不在 CLI 内）：
  python scripts/make_video.py --md=脚本.md --seg=1 --pdf=ch01.pdf --out=out.mp4
  python scripts/video_all.py

环境变量：CX_CHROME（chrome.exe 路径） CX_STATE（登录态 JSON）
          CX_HEADFUL=1（可见窗口） CX_SLOW=1（放慢 1.8x）
          CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000（长批量合成防中途被杀）
`);
  process.exit(0);
}

let script = MAP[cmd];
if (script && typeof script === 'object') {
  const sub = rest[0];
  if (!sub || !script[sub]) {
    console.error(`${cmd} 的子命令：${Object.keys(script).join(' | ')}`);
    process.exit(1);
  }
  script = script[sub];
  rest.shift();
}
if (!script) { console.error(`未知命令：${cmd}（可选：${Object.keys(MAP).join(' | ')}）`); process.exit(1); }

const r = spawnSync(process.execPath, [path.join(HERE, '..', 'scripts', script), ...rest], { stdio: 'inherit' });
process.exit(r.status ?? 1);
