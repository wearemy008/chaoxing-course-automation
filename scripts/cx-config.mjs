/** 课程配置加载器（所有涉及具体课程的脚本共用）
 *
 *  优先读环境变量 CX_COURSES 指定的 JSON 文件，否则读同目录的 courses.json。
 *  文件格式（键 = 课程别名，值 = 三件套 + 元信息）：
 *    {
 *      "bangong": { "courseId": "123...", "clazzId": "456...", "cpi": "1104...",
 *                   "name": "办公空间设计", "cls": "1班" },
 *      "kongjian": { ... }
 *    }
 *  参考同目录 courses.example.json。
 *
 *  ⚠️ courses.json 里含你自己的 courseId/clazzId，已被 .gitignore 排除，请勿提交。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadCourses() {
  const file = process.env.CX_COURSES || path.join(__dirname, 'courses.json');
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`courses.json 解析失败：${e.message}`); return null; }
}

export function loadCourse(alias) {
  const all = loadCourses();
  if (!all) {
    console.error(`未找到课程配置（${process.env.CX_COURSES || path.join(__dirname, 'courses.json')}）`);
    console.error('请复制 scripts/courses.example.json 为 scripts/courses.json 并填入你的课程三件套。');
    return null;
  }
  const c = all[alias];
  if (!c) return null;
  return {
    courseId: String(c.courseId),
    clazzId: String(c.clazzId || ''),
    cpi: String(c.cpi || ''),
    name: c.name || alias,
    cls: c.cls || '',
    ...c,
  };
}
