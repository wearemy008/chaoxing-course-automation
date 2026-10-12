---
name: chaoxing-course-automation
description: "超星泛雅 / 学习通（chaoxing.com）教师端课程全流程自动化 Skill。覆盖建章节、批量写正文、课件/视频挂载、题库智能导入、讨论话题、资料与教学资源库、考试自动组卷与发布、任务引擎发布、知识图谱（知识/问题/能力/思政）建设，以及「分镜脚本 + 课件 PDF → 配音讲解视频」的本地合成。当用户提到 超星、泛雅、学习通、chaoxing、建课、课程章节、章节正文、课件上传、PPT挂载、视频上传、题库导入、智能导入、章节测验、考试组卷、试卷发布、任务引擎、发布任务、讨论题、话题发布、资料库、教学资源库、知识图谱、问题图谱、能力图谱、思政图谱、课程视频、课件视频、配音视频 时使用此 Skill。"
description_zh: "超星泛雅 / 学习通教师端课程全流程自动化（建课 → 内容 → 测验 → 考试 → 任务 → 图谱 → 课件视频合成）。触发词：超星、泛雅、学习通、建课、章节、正文、课件上传、视频上传、题库、智能导入、组卷、发布考试、任务引擎、讨论、资料库、资源库、知识图谱、课程视频合成。"
version: 3.0.0
------

# 超星泛雅 / 学习通课程全流程自动化

## 简介

把「在超星建一门完整的在线课」从**建结构**到**填内容**到**考核运营**到**知识图谱**再到**课件讲解视频**，整条链路封装成可复用的命令行脚本 + Python 管线。全部基于 Playwright 驱动本机 Chrome 完成 —— **超星没有公开可用的课程内容写入 API**，所有能力都是真实逆向出来的。

已在真实课程上完整跑通并验证：

- **2 门课程 × 21 章**：章节结构、章节正文、168 道章节测验、21 个讨论话题、39 项平台共享资源
- **7 章课件 PPT** 挂载 + **25 集讲解视频**（办公 12 + 空间 13，共 758 MB）上传并挂到对应章节
- **期末考试** 自动组卷（单选 20×4 + 多选 5×4 = 100 分）并发布到两个班
- **任务引擎** 逐章任务批量发布
- **知识图谱** 六板块建设：节点属性 32+1、问题图谱 8 题、五会能力 5 点、思政 8 节点

## v3.0 新增

| 模块 | 说明 |
|---|---|
| 🎬 **课件视频合成** | 分镜脚本 + 章节 PDF → 配音讲解视频（edge-tts + ffmpeg），输出 1080p25 MP4 + SRT |
| 📹 **视频章节上传** | 把合成视频挂到章节正文（`insertvideo` 链路，与课件 PPT 可共存） |
| 📝 **考试组卷 / 发布** | 自动组卷（跳二次确认）+ 发布到班级（定时截止 + 限时） |
| ✅ **任务引擎发布** | 已有任务批量发放到班级（`coursePublishAuthentication` → publish-plugin iframe） |
| 🕸 **知识图谱建设** | 知识/问题/能力/思政四类图谱的节点属性、层级、题目、五会能力写入 |

## 能力矩阵

| 脚本 | 作用 | 幂等 | 断点续跑 |
|---|---|---|---|
| `cx-login.mjs` | 扫码登录，保存登录态 | — | — |
| `cx-courses.mjs` | 列出我的课程，取 courseId/clazzId/cpi 三件套 | — | — |
| `cx-fill.mjs` | 章节正文批量**安全追加**（绝不覆盖课件） | ✅ | ✅ |
| `cx-quiz.mjs` | 题库：建章文件夹 / 智能导入 / 回读 / 清空 | 部分 | ✅ |
| `cx-topics.mjs` | 讨论话题批量发布 / 删除 | ✅ | ✅ |
| `cx-res.mjs` | 平台教学资源库检索 + 入库 / 列出 / 删除 | ✅ | ✅ |
| `cx-video-upload.mjs` | 🆕 课件讲解视频按章挂载（`insertvideo`） | ✅ | ✅ |
| `cx-video-verify.mjs` | 🆕 全量回读校验（视频/课件/图片计数） | — | — |
| `cx-exam-build.mjs` | 🆕 考试自动组卷 | — | — |
| `cx-exam-publish.mjs` | 🆕 发布试卷到班级 | — | — |
| `cx-task-publish.mjs` | 🆕 任务引擎批量发布 | ✅ | ✅ |
| `cx-graph-fill.mjs` | 🆕 知识图谱六板块填充 | ✅ | — |
| `gen-graph.py` | 🆕 从大纲/章节数据生成图谱填充 JSON | — | — |
| `make_video.py` | 🆕 单集视频合成（脚本 + PDF → MP4 + SRT） | ✅ | — |
| `video_all.py` | 🆕 批量合成（断点续跑） | ✅ | ✅ |
| `fetch-pdf.mjs` | 从超星下载章节课件 PDF | — | — |
| `gen-quiz.py` / `validate-quiz.py` | 生成超星格式题本 / 格式校验 | — | — |

## 快速开始

```bash
SK="<skill>/scripts"
NODE="C:/Users/admin/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
PY="C:/Users/admin/.workbuddy/binaries/python/envs/default/Scripts/python.exe"

# ① 首次：扫码登录（有头窗口，扫完自动保存 auth-state.json）
"$NODE" "$SK/cx-login.mjs"

# ② 取课程三件套
"$NODE" "$SK/cx-courses.mjs" --json=courses.json
```

后续命令统一形如：

```bash
"$NODE" "$SK/<命令>.mjs" <子命令> --course=<courseId> --cpi=<cpi> [--clazz=<clazzId>] [...]
```

---

## 标准工作流

### A. 建结构 + 填正文

章节正文用 `cx-fill.mjs`，核心是**安全三态写入**（详见「安全约束」节）。

```bash
"$NODE" "$SK/cx-fill.mjs" --course=X --cpi=Y --map=chapter-map.json --marker=本章拓展资源 --verify=3
```

### B. 题库 / 讨论 / 资料

```bash
# 题库
"$PY" "$SK/gen-quiz.py" 题库源.json 题库/课程名
"$PY" "$SK/validate-quiz.py" 题库/
"$NODE" "$SK/cx-quiz.mjs" mkdir  --course=X --cpi=Y --n=10
"$NODE" "$SK/cx-quiz.mjs" import --course=X --cpi=Y --dir=题库 --prefix=课程名 --chapters=10
"$NODE" "$SK/cx-quiz.mjs" view   --course=X --cpi=Y          # ★ 必须回读

# 讨论
"$NODE" "$SK/cx-topics.mjs" --course=X --cpi=Y --json=讨论题.json --chapters=10

# 资源库
"$NODE" "$SK/cx-res.mjs" add  --course=X --clazz=Y --cpi=Z --kw=办公空间设计 --max=5
"$NODE" "$SK/cx-res.mjs" list --course=X --clazz=Y --cpi=Z    # ★ 必须复核
"$NODE" "$SK/cx-res.mjs" del  --course=X --clazz=Y --cpi=Z --name=授课计划
```

### C. 🆕 课件讲解视频（合成 → 上传）

**第一步：合成**

1. 准备**分镜脚本 md**（表格列 `镜号 | 时间 | 画面 | 旁白（配音稿）| 素材`）与本集对应章节的 **PDF**；
2. `fetch-pdf.mjs` 从超星下载 PDF（或本地提供）；
3. 复制 `scripts/video_manifest.example.py` → `video_manifest.py`，填入本课程清单：

```python
ITEMS = [
    ('课程名', 1, '脚本-01.md', 'pdf/ch01.pdf', '课程名-01-本集标题', '第一章 章名'),
]
```

4. 合成：

```bash
# 单集
"$PY" "$SK/make_video.py" --md=脚本-01.md --seg=1 --pdf=pdf/ch01.pdf \
                          --course=课程名 --out=成品/课程名-01-xxx.mp4 --chapter="第一章 章名"
# 批量（断点续跑）
"$PY" "$SK/video_all.py"
```

输出：`1080p25 H.264/AAC MP4 + 同名 .srt`。

**第二步：上传挂载**

```bash
"$NODE" "$SK/cx-video-upload.mjs" --course=bangong --from=1 --to=10
"$NODE" "$SK/cx-video-verify.mjs" --course=bangong     # ★ 必须终验
```

视频与课件 PPT **可共存于同一节**（一个是 `module="insertvideo"`，一个是 `module="insertdoc"`）。

### D. 🆕 考试组卷 → 发布

```bash
# ① 组卷（默认 单选 20×4 + 多选 5×4 = 100 分）
"$NODE" "$SK/cx-exam-build.mjs" bangong 20 5 4
# → 输出 exam4-bangong.json，取其中的 paperId

# ② 发布到班级（0 小时后开始，限时 90 分钟，7 天后 23:59 截止）
"$NODE" "$SK/cx-exam-publish.mjs" bangong <paperId> 0 90 7
```

要点：
- `[id="{type}_score"]` 是**该题型整块总分**（不是每题分）；**满分必须 = 各题型分之和**；
- 判断题块默认隐藏，**只提交可见题型**；
- 组卷是异步任务，脚本会自动轮询 `autopapertask-status` 拿 `paperId`。

### E. 🆕 任务引擎发布

```bash
"$NODE" "$SK/cx-task-publish.mjs" bangong 1 10     # 发布第 1~10 章任务
```

已发布且目标数 > 0 的任务**自动跳过**（幂等）。脚本会回读 `publishStatus` + `taskStudentsNumber` 确认。

### F. 🆕 知识图谱建设

```bash
# ① 准备两个输入：
#    - <course>-graph-data.json  章节正文抽取的 sections（no/name/key/goal/hard）
#    - mapdata-<course>.json     图谱页面抓的节点树（nodes[].{name,topicid,level}）
# ② 生成填充 JSON
"$PY" "$SK/gen-graph.py"                 # 输出 <course>-graph-fill.json
# ③ 写入图谱
"$NODE" "$SK/cx-graph-fill.mjs" bangong
```

写入内容：
- **三开关**：激活问题/能力/思政图谱
- **节点属性**：`classify` 分类 + 重点/难点/考点/思政标签 + 描述 + 教学目标
- **问题图谱**：三层（基础认知 / 方法建构 / 综合创造），每章一核心问题
- **能力图谱**：五会（会思考/会学习/会沟通/会动手/会生活），各绑 2-3 个 topicid

---

## 六条强制安全约束

1. **章节正文只追加、不覆盖。** 教师已上传的 PPT/视频以 iframe 形式存在于正文 HTML 里。`cx-fill.mjs` 的三态逻辑就是为保护它 —— 已含标记→跳过 / 空→写入 / 非空→`原文 + <hr/> + 新内容` 追加。**任何情况下不要整段替换正文。**
2. **题库导入后必须 `view` 回读。** 曾出现批量导入时章节文件夹选中丢失，导致「第1章重复 16 题 / 另一门课第1章 0 题」。
3. **资源入库后必须 `list` + `del` 清理。** 平台共享资源质量参差，入库数量 ≠ 可用数量。
4. **视频上传后必须 `cx-video-verify.mjs` 终验。** 视频判据是 `ans-insertvideo` 不是 `taskIframe`；且点「确认」后要等 iframe 消失，否则内容不落盘。
5. **图谱 `savepropertyedit` 是全量替换语义**，必须先 GET 现状再合并写入，否则覆盖已有标签。
6. **视频合成的工作目录必须纯英文路径，ffmpeg 滤镜里禁止出现盘符冒号。**

## 环境变量

| 变量 | 说明 |
|---|---|
| `CX_CHROME` | Chrome 可执行路径，默认 `C:\Users\admin\.agent-browser\browsers\chrome-152.0.7977.82\chrome.exe` |
| `CX_STATE` | 登录态 JSON，默认 `<skill>/state/auth-state.json` |
| `CX_PW` | `playwright-core` 安装路径（skill 自带 node_modules 缺失时兜底） |
| `CX_HEADFUL=1` | 显示浏览器窗口（默认无头），调试时强烈建议开 |
| `CX_SLOW=1` | 全部等待 ×1.8，网络慢时开 |
| `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD` | 跑长批量合成时设 `100000`，避免被本机删除守卫中途杀掉 |

## 目录结构

```
chaoxing-course-automation/
├── SKILL.md
├── README.md
├── CHANGELOG.md
├── package.json
├── LICENSE
├── assets/
│   └── quiz-template.json          题库源文件模板（配合 gen-quiz.py）
├── bin/
│   └── cx.js                        CLI 统一入口
├── references/
│   └── api.md                       ★ 所有逆向结论：URL 表 / 选择器 / 参数语义 / 40 条踩坑
└── scripts/
    ├── cx.mjs                       公共库：登录态 / 导航 / 章节安全写入 / 智能导入
    ├── cx-login.mjs                 扫码登录
    ├── cx-courses.mjs               课程三件套
    ├── cx-fill.mjs                  章节正文批量安全追加
    ├── cx-quiz.mjs                  题库 view | mkdir | import | clean | delall
    ├── cx-topics.mjs                话题批量发布 / 删除
    ├── cx-res.mjs                   资源库 add | list | del
    ├── cx-video-upload.mjs          🆕 视频章节上传（insertvideo 链路）
    ├── cx-video-verify.mjs          🆕 全量视频/课件回读校验
    ├── cx-exam-build.mjs            🆕 考试自动组卷
    ├── cx-exam-publish.mjs          🆕 发布试卷到班级
    ├── cx-task-publish.mjs          🆕 任务引擎批量发布
    ├── cx-graph-fill.mjs            🆕 知识图谱六板块填充
    ├── gen-graph.py                 🆕 图谱填充 JSON 生成
    ├── make_video.py                🆕 单集讲解视频合成
    ├── video_all.py                 🆕 批量合成（断点续跑）
    ├── video_manifest.example.py    🆕 视频清单模板
    ├── fetch-pdf.mjs                从超星下载章节课件 PDF
    ├── gen-quiz.py                  生成超星格式题本
    └── validate-quiz.py             题本格式校验
```

**新增功能前先读 `references/api.md`。** 里面记录了全部逆向结论 —— 包括为什么智能导入必须用 `textContent`、为什么 `setContent` 会删课件、为什么 stat2 端点不能带 `enc`、为什么问题图谱的 `questionId` 必须是字符串 `'0'`、为什么视频上传必须选 `input[accept*="video"]`。照着写能省掉数小时试错。

## 排障速查

| 现象 | 原因 / 解法 |
|---|---|
| `未找到登录态文件` | 跑一次 `cx-login.mjs` |
| 课程树显示「2.1 2.1」 | 导入文本里写了序号前缀，平台会自动加，别手写 |
| 长跑脚本中途死掉 | Bash 管道 `| head` 会 SIGPIPE 杀进程，输出重定向到文件 |
| 课件被删 | 用了 `setContent` 覆写；必须追加 + 埋幂等标记 |
| 视频上传 `setInputFiles: Timeout` | 用了「文档」按钮；改 `.ans-command-insertvideo` + `input[accept*="video"]` |
| 视频上传后正文没变 | 点确认后等待不足；要等 insertvideo iframe 从 `page.frames()` 消失 |
| 「视频」按钮点不动 | 工具栏未激活；脚本已内置 4 次重试（focus + 点编辑区 + 点媒体块） |
| 组卷 submit 无反应 | 走 `window.send(1)`（跳过二次确认） |
| 组卷后拿不到 paperId | 异步任务，须轮询 `autopapertask-status` |
| 考试发布卡在二次确认 | `window.publishpaper(true)` |
| 点「发布」抓不全请求 | 用 `ctx.addInitScript` hook XHR/fetch，别用 `page.on('request')` |
| 查不到班级列表 | 在跨域 iframe 里，`p.frames().find(f => /publish-plugin/.test(f.url()))` |
| stat2 端点 403 | `course-target/*`、`question-map/*` 不能带 `enc`，且 `clazzid='0'` |
| 图谱面板假「暂无内容」 | hash 路由 query 带了 enc；无 enc 直接 GET 才是真相 |
| 问题 add 返回 true 不生效 | `questionId` 必须数字 `'0'`；章节点不能绑问题，只绑叶节点 |
| 图谱标签被覆盖 | `savepropertyedit` 是全量替换，必须先读后合并 |
| 智能导入只识别 1 题 | 编辑区必须 `textContent = 纯文本`（含真实 `\n`） |
| 资源入库成功但资料库空 | `parent.postMessage` 静默丢消息；走直连 `POST /mooc2-ans/coursedata/add-zyk` |
| ffmpeg 滤镜报参数错乱 | 滤镜里出现了盘符 `C:`；设 `cwd` + 只用相对文件名 |
| 字幕中文乱码 | 别用 `drawtext`；PIL 渲染 PNG 再 overlay |
| 字幕时间轴全是 0 | edge-tts 中文不返回 WordBoundary，必须逐句合成累加 |
| 音频拼接 `Invalid data` | TTS 并发写盘竞态；重试 + 产物大小校验 |
| 批量合成被中途杀掉 | 删除守卫；设 `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000` |

## 免责

本工具仅用于**管理教师自己的课程**。登录态含 Cookie，已被 `.gitignore` 排除，请勿分享或提交。平台页面结构可能随改版变化，接口细节以 `references/api.md` 为准并自行验证。本项目与超星集团官方无关。
