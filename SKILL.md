---
name: chaoxing-course-automation
description: "超星泛雅 / 学习通（chaoxing.com）教师端课程自动化建设 Skill。覆盖建章节、批量写章节正文、智能导入题库、发布讨论话题、检索平台教学资源库并入库课程资料库、按章归档与批量清理。当用户提到 超星、泛雅、学习通、chaoxing、建课、课程章节、章节正文、题库导入、智能导入、章节测验、讨论题、话题发布、资料库、教学资源库、课程资源入库、批量建课 时使用此 Skill。"
description_zh: "超星泛雅 / 学习通（chaoxing.com）教师端课程自动化建设 Skill，覆盖建章节、批量写正文、智能导入题库、发布讨论话题、平台资源检索入库与批量清理。触发词：超星、泛雅、学习通、chaoxing、建课、章节、题库、智能导入、章节测验、讨论题、话题、资料库、教学资源库、批量。"
version: 1.0.0
------

# 超星泛雅 / 学习通课程自动化

## 简介

把「在超星泛雅教师端建一门课」这件重复劳动封装成 7 条命令行指令。全部基于 Playwright 驱动本机 Chrome 完成，**不依赖超星开放 API**（超星没有公开可用的课程内容写入 API），登录态用 `storageState` 复用，一次扫码可用数周。

已在真实课程上完整跑通并验证：两门课程 × 21 章，168 道章节测验、21 个讨论话题、39 项平台共享资源、21 章正文批量追加。

## 能力矩阵

| 命令 | 作用 | 幂等 | 断点续跑 |
|---|---|---|---|
| `cx-login.mjs` | 扫码登录，保存登录态 | — | — |
| `cx-courses.mjs` | 列出我的课程，取 courseId/clazzId/cpi 三件套 | — | — |
| `cx-quiz.mjs` | 题库：建章文件夹 / 智能导入 / 回读 / 清空 | 部分 | ✅ |
| `cx-topics.mjs` | 讨论话题批量发布 / 删除 | ✅ | ✅ |
| `cx-res.mjs` | 平台教学资源库检索 + 入库课程资料库 / 列出 / 删除 | ✅ | ✅ |
| `cx-fill.mjs` | 章节正文批量安全追加（**绝不覆盖已上传课件**） | ✅ | ✅ |
| `gen-quiz.py` / `validate-quiz.py` | 生成超星格式题本 / 格式校验 | — | — |

## 快速开始

```bash
SK="C:/Users/admin/.workbuddy/skills/chaoxing-course-automation/scripts"
NODE="C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-2/node.exe"

# ① 首次：扫码登录（有头窗口，扫完自动保存登录态）
"$NODE" "$SK/cx-login.mjs"

# ② 取课程三件套
"$NODE" "$SK/cx-courses.mjs" --json=courses.json
# 输出： 4. 办公空间设计  courseId=123456789  clazzId=(未取…)  cpi=110000000
# 加 --full 会逐门进主页补全 clazzId（慢）；不加也行 —— 各命令运行时会自动补。
```

后续所有命令统一形如（`--clazz` 可省略，缺了会自动从课程主页补全）：

```bash
"$NODE" "$SK/<命令>.mjs" <子命令> --course=<courseId> --cpi=<cpi> [--clazz=<clazzId>] [...]
```

## 标准工作流（建一门课的四件套）

### 1. 章节正文 —— `cx-fill.mjs`

先准备 `chapter-map.json`（键 = 章节节点 `knowledgeId`，值 = 要写入的 HTML）：

```json
{ "1231342532": "<h3>本章拓展资源</h3><p>……</p>",
  "1231339466": "<h3>本章拓展资源</h3><p>……</p>" }
```

```bash
"$NODE" "$SK/cx-fill.mjs" --course=123456789 --cpi=110000000 \
                           --map=chapter-map.json --marker=本章拓展资源 --verify=3
```

**安全三态写入（核心，不可破坏）**：

| 正文现状 | 行为 |
|---|---|
| 已含 `--marker` 文本 | **跳过**（可反复跑，不会重复追加） |
| 正文为空 | 直接写入 |
| 正文非空（有课件/PPT） | `原文 + <hr/> + 新内容` **追加** |

`--verify=N` 回读前 N 章，打印「正文长度 / 是否仍含课件 iframe」。

> 章节节点 id 可用 `cx.mjs` 的 `getChapters(page, courseId, clazzId, cpi)` 拉取，见 `references/api.md` 第 3 节。

### 2. 章节测验 —— `gen-quiz.py` → `validate-quiz.py` → `cx-quiz.mjs`

```bash
```bash
# ① 从 JSON 源生成超星「智能导入」格式题本（每章一个 txt）
#    源格式见 assets/quiz-template.json
python "$SK/gen-quiz.py" 题库源.json 题库/办公空间设计

# ② 校验：题号连续 / 标注答案与答案一致 / 选项齐全 / 解析完备
python "$SK/validate-quiz.py" 题库/

# ③ 建「第N章」文件夹 + 逐章导入
"$NODE" "$SK/cx-quiz.mjs" mkdir  --course=... --cpi=... --n=10
"$NODE" "$SK/cx-quiz.mjs" import --course=... --cpi=... \
                                 --dir=题库 --prefix=办公空间设计 --chapters=10

# ④ 【强制】回读复核
"$NODE" "$SK/cx-quiz.mjs" view --course=... --cpi=...
```

题本格式（智能导入规范，错一格就只识别出 1 题；`gen-quiz.py` 生成的就是这版）：

```
1.【单选题】下列照度标准符合普通办公室要求的是（B）
A. 100-150lx
B. 300-500lx
C. 800-1000lx
D. 与照度无关
答案：B
解析：GB 50034 规定普通办公室桌面照度标准值为 300lx，设计常取 300-500lx。

2.【判断题】判断题题干不写字母标注（对）
答案：对
解析：……

3.【多选题】多选题干（ABD）
A. 选项一
B. 选项二
C. 干扰项
D. 选项四
答案：ABD
解析：……

4.【简答题】简答题题干
答案：参考答案（≥30 字，否则校验器会提示过短）
```

### 3. 讨论话题 —— `cx-topics.mjs`

```bash
# 讨论题 JSON：{ "1": {"title":"…", "content":"…"}, … }
"$NODE" "$SK/cx-topics.mjs" --course=... --cpi=... \
                             --json=题库/办公空间设计-讨论题.json --chapters=10
# 删单个话题（按标题关键词）
"$NODE" "$SK/cx-topics.mjs" --course=... --cpi=... --delete=第3章
```

标题自动加「【第N章】」前缀。

### 4. 平台资源入库 —— `cx-res.mjs`

```bash
"$NODE" "$SK/cx-res.mjs" add  --course=... --clazz=... --cpi=... \
                               --kw=办公空间设计,室内空间设计,人体工程学 --max=5
"$NODE" "$SK/cx-res.mjs" list --course=... --clazz=... --cpi=...
"$NODE" "$SK/cx-res.mjs" del  --course=... --clazz=... --cpi=... --name=授课计划,Unity
```

行为细节：
- 关键词检索平台「教学资源库」，按课程组织；部分课程显示「资源正在建设中」（0 条），脚本自动跳过并尝试同关键词下最多 6 门候选课程。
- 每个关键词默认取前 5 项，自动排除已添加过的（跨关键词去重）。
- **必须 `list` 复核**：检索会带入授课计划、软件安装包、重复 PDF 等低质资源，用 `del` 按文件名子串清理。

## 三条强制安全约束

1. **章节正文只追加、不覆盖。** 教师已手动上传的 PPT 以 iframe 形式存在于正文中，`writeChapter` 的三态逻辑就是为保护它。任何情况下不要用整段替换的方式写正文。
2. **题库导入后必须 `view` 回读。** 曾出现批量导入时章节文件夹选中丢失导致「第1章重复 16 题 / 另一门课第1章 0 题」。回读发现异常用 `clean --folder=第N章` 清空后单章重导。
3. **资源入库后必须 `list` + `del` 清理。** 平台共享资源质量参差，入库数量不等于可用数量。

## 环境变量

| 变量 | 说明 |
|---|---|
| `CX_CHROME` | Chrome 可执行路径，默认 `C:\Users\admin\.agent-browser\browsers\chrome-152.0.7977.82\chrome.exe` |
| `CX_STATE` | 登录态 JSON，默认 `<skill>/state/auth-state.json` |
| `CX_PW` | `playwright-core` 安装路径（skill 自带 node_modules 缺失时的兜底） |
| `CX_HEADFUL=1` | 显示浏览器窗口（默认无头），调试时强烈建议开 |
| `CX_SLOW=1` | 全部等待 ×1.8，网络慢时开 |

## 目录结构

```
chaoxing-course-automation/
├── SKILL.md
├── assets/
│   └── quiz-template.json  题库源文件模板（配合 gen-quiz.py）
├── scripts/
│   ├── cx.mjs           公共库：登录态/导航/章节安全写入/智能导入/讨论/资源入库
│   ├── cx-login.mjs     扫码登录
│   ├── cx-courses.mjs   课程三件套
│   ├── cx-quiz.mjs      view | mkdir | import | clean | delall
│   ├── cx-topics.mjs    话题批量发布 / 删除
│   ├── cx-res.mjs       add | list | del
│   ├── cx-fill.mjs      章节正文批量安全追加
│   ├── gen-quiz.py      生成超星格式题本
│   └── validate-quiz.py 题本格式校验
├── package.json        依赖声明（playwright-core）
├── references/api.md    ★ 接口速查：URL 表、导航机制、UEditor、智能导入、
│                          题库管理、讨论区、资料库/资源库直连接口、全部踩坑解法
└── state/               登录态 + 各命令进度 JSON（断点续跑，勿提交）
```

**新增功能前先读 `references/api.md`。** 里面记录了全部逆向结论——包括智能导入必须用 `textContent`（不能用 `fill` / `insertText` / `innerHTML`）、资源入库必须直连 `POST /mooc2-ans/coursedata/add-zyk`（`parent.postMessage` 在自动化下会静默丢消息）、资料库复选框与文件名是同排兄弟 li 等。照着写能省掉数小时试错。

## 排障速查

| 现象 | 原因 / 解法 |
|---|---|
| `未找到登录态文件` | 跑一次 `cx-login.mjs` |
| `未取到课程列表` | 登录态过期，重新 `cx-login.mjs` |
| 智能导入只识别出 1 题 | 编辑区塞值方式错了，必须 `textContent = 纯文本(含真实 \n)` |
| 章节文件夹选中失败 | 目录树异步加载，脚本已做轮询 + 重试；仍失败开 `CX_SLOW=1` |
| 资源已勾选但 `#idspptArr` 为空 | 点的是外层 `span.zyk_check`（只切样式），要点内层 `input[name=checkbox_ppt]` |
| 资源显示添加成功但资料库为空 | `parent.postMessage` 断链，走直连 `add-zyk` 接口（已在 `cx.mjs` 修复） |
| 资料库删错文件 | `.dataBody` 是整组容器，必须按「复选框所在 ul 内找 `.dataBody_name`」精确匹配 |
| `zyk.keyboard.press` TypeError | Frame 没有 keyboard，键盘操作只用主 `page.keyboard` |
| `题库总题数：undefined` | `gotoHome()` 返回的是对象不是字符串，取 `.enc`（已修，自己写脚本时别踩） |
| `未找到 playwright-core` | skill 自带 `node_modules/` 被清了。从其他装过的地方 `cp -r` 过来，或用 `CX_PW` 指定路径。注意 `npm i` 可能被本机的 safe-delete 批量删除保护拦截 |
