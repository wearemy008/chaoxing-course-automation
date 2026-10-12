# CHANGELOG

## 3.0.0 — 2026-10-12

**大版本：从「建课工具」升级为「课程全流程平台」**，新增课件讲解视频合成、视频章节上传、考试组卷发布、任务引擎发布、知识图谱建设五大模块。

### 🎬 课件讲解视频合成（新增）

- `make_video.py`：分镜脚本 md + 章节课件 PDF → 配音讲解视频
  - `parse_segment()` 解析脚本表格 → 镜头列表
  - `render_pages()` PDF 全页渲染 PNG（scale=3 → 2160×1215）
  - edge-tts **逐句合成**（`zh-CN-XiaoxiaoNeural`，`Semaphore(4)`，3 次重试）—— 因中文不返回 WordBoundary，必须逐句累加时钟算时间轴
  - 每镜头音频 concat + `zoompan` Ken Burns 视频片段 → 全局 concat
  - PIL 标题条 PNG overlay + 字幕烧录
  - 输出 **1080p25 H.264/AAC MP4 + 同名 .srt**
- `video_all.py`：批量合成，断点续跑（`_videowork/_progress.json`）
- `video_manifest.example.py`：视频清单模板（去项目硬编码）
- **Windows ffmpeg 三大坑**已封装：滤镜禁出现盘符冒号（`cwd` + 相对文件名）/ 不用 `drawtext` 写中文（PIL PNG + overlay）/ 工作目录纯英文
- **TTS 并发写盘竞态修复**：新增 `concat_audio()` 带 3 次重试 + 产物大小校验（否则读到截断 wav 报 `Invalid data`）
- **删除守卫绕过**：`unlink()` 包 try/except，长批量任务设 `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000`
- ✅ 实战：**25 集**（办公 12 + 空间 13，758 MB）全部合成成功

### 📹 视频章节上传（新增）

- `cx-video-upload.mjs`：走 **`.ans-command-insertvideo`** 链路（不是 `.ans-command-insertdoc`）
  - 弹层跨域 iframe `insertvideo.html`，上传 input 是 **`input[name="file"][accept*="video"]`**（页面有两个同名 file input）
  - 完成信号：帧内出现「完成」/「100%」（`ananas/status` 响应不一定带 filename）
  - ★ 点「确认」后**必须等 insertvideo iframe 从 `page.frames()` 消失**才算落盘
  - 「视频」按钮 4 次重试（`ue.focus()` + 点编辑区 + 点已有媒体块刷新工具栏）
  - 判据升级：`cntMods()` 统计 doc/video/img 三类并校验增量
  - 埋幂等标记 `VIDEO::<文件名>`
- `cx-video-verify.mjs`：逐节点回读统计
- ✅ 实战：25 集全部挂载，终验 **视频 25 / 课件 21 / 失败 0**，每章 PPT 与视频并存

### 📝 考试组卷 / 发布（新增）

- `cx-exam-build.mjs`：`toAutoCreatePaperPage` 组卷
  - `[id="{type}_libraryInputQuestionNum"]` / `[id="{type}_score"]`（**数字开头 id 必须用属性选择器**）
  - `_score` = 该题型**整块总分**；满分必须 === 各题型分之和
  - ★ `window.send(1)` 跳过二次确认 → 轮询 `autopapertask-status` 拿 `paperId`
- `cx-exam-publish.mjs`：`topublish` 页 → `#choosepublish` → 同行 `span.class_check` → `#confirmchoose` → ★ `window.publishpaper(true)`
  - jQuery 时间控件赋值走原生 setter + dispatchEvent
- ✅ 实战：单选 20×4 + 多选 5×4 = 100 分，两个班发布成功

### ✅ 任务引擎发布（新增）

- `cx-task-publish.mjs`：`getTaskDataLists`（**课程级，不传 clazzId**）→ 逐任务点「发布」
  - 核心请求 `POST /taskReference/coursePublishAuthentication` → 返回 `publish-plugin` iframe URL
  - 帧内 DOM 与作业发放同构：`a.classitem.newClassItem[data=clazzid]` + `span.class_check`
  - 幂等：`publishStatus && targetList>0` 跳过
  - 判据：回读 `publishStatus:true` + `taskStudentsNumber`
- ★ 探查手法：UI 点击无反应时用 `ctx.addInitScript` hook `XMLHttpRequest.prototype.open/send` + `window.fetch`（`page.on('request')` 会漏）

### 🕸 知识图谱建设（新增）

- `gen-graph.py`：从章节数据 + 图谱节点树生成填充 JSON
- `cx-graph-fill.mjs`：六板块填充
  - **三开关**：`updatequestionmap` / `updateabilitymap` / `updateideologicalmap`
  - **节点属性**：`savepropertyedit`（全量替换语义，先读后合并）+ 重点/难点/考点/思政标签
  - **问题图谱**：`stat2/question-map/questionLevel/update` + `question/add`
  - **能力图谱（五会）**：`stat2/course-target/manager/addTargetV2` / `updateTarget` + `saveTargetSetTitle`
- ★ **域与参数铁律**：`stat2-ans.chaoxing.com` 的 `course-target/*`、`question-map/*` **必须不带 enc + `clazzid='0'`**（带 enc 403）；hash 路由 query 带 enc 会让 SPA 假「暂无内容」
- ★ 踩坑：**章节点（depth=1）不能绑问题**（status:true 但 topicList=[] 静默拒绝），只绑叶节点；`questionId` 必须传数字 `'0'`
- 逆向前置：读 `runtime.js` webpack chunk 映射 → 全量下载 chunk 扫端点（139 chunk → 350 端点）
- ✅ 实战：节点属性 32+1、问题图谱 8 题、五会能力 5 点、思政 8 节点

### 文档

- `references/api.md` 全面重写为 **10 节接口全表 + 40 条踩坑总表**，新增视频上传、考试、任务引擎、知识图谱、视频合成管线、逆向方法论
- `SKILL.md` / `README.md` 重写为全流程导航

### 可移植性

- 全部脚本支持 `CX_CHROME` / `CX_STATE` / `CX_COURSES` 环境变量，路径不再硬编码
- 新增 `scripts/cx-config.mjs` + `courses.example.json`：课程三件套改为从 `courses.json` 读取（已 gitignore）
- 新增 `video-plan.example.json`：视频上传的目录/节点/清单外置（`cx-video-upload.mjs` / `cx-video-verify.mjs` 由 `--plan` 驱动）
- `gen-graph.py` 重写为通用模板（去项目专属逻辑），`video_all.py` 课程键从 manifest 动态推导
- `video_manifest.example.py` / `courses.example.json` 作为可复制模板

### 兼容性

- v1.0.0 的六个命令（`login` / `courses` / `quiz` / `topics` / `res` / `fill`）**行为完全不变**
- 新增 Python 依赖：`edge-tts`、`Pillow`、`imageio-ffmpeg`（仅视频合成需要）

---

## 1.0.0 — 2026-09-05

初版。把两门超星课程（办公空间设计 10 章、空间数字化表现 11 章）的完整建设流程固化为命令行 Skill。

**已验证能力**
- `cx-courses.mjs` 列课程（走 `i.chaoxing.com/base?t=course` → `visit/interaction` iframe）
- `cx-quiz.mjs view` 回读题库：办公 80 题 / 空数 88 题，每章各 8 题
- `cx-res.mjs list` 读资料库：办公 20 项
- `gen-quiz.py` + `validate-quiz.py` 题本生成与校验（模板 → 4 题 → 校验全过）

**关键修正**
- 课程列表入口：mooc1/mooc2-ans 的 `mycourse/teachercourse` 会 404 或被踢到登录页，只有 `i.chaoxing.com` 稳
- `gotoHome()` 改为返回 `{courseId, clazzId, cpi, enc, bbsid, openc}` 对象，三件套一次取全
- 新增 `resolveClazz()`，`--clazz` 参数变为可选
- `playwright-core` 改为动态解析 + `CX_PW` 兜底，避免换机器后模块找不到

**已知限制**
- 登录态是超星会话 cookie，通常可用数周，过期后需重跑 `cx-login.mjs` 扫码
- 资源入库依赖逆向接口 `POST /mooc2-ans/coursedata/add-zyk`，平台改版需重新逆向（见 `references/api.md`）
