# Chaoxing Course Automation

超星泛雅 / 学习通（chaoxing.com）**教师端课程全流程自动化**工具集 —— 从建课程结构、填内容、发测验，到组卷发布、任务发放、知识图谱建设，再到「分镜脚本 + 课件 PDF → 配音讲解视频」的本地合成。

基于 Playwright 驱动本机 Chrome 完成（超星**没有**公开可用的课程内容写入 API），登录态 `storageState` 复用，一次扫码可用数周。

> **已在真实课程上完整跑通并验证：**
> - 2 门课程 × 21 章 —— 章节结构、章节正文、168 道章节测验、21 个讨论话题、39 项平台共享资源
> - 7 章课件 PPT + **25 集讲解视频**（758 MB）上传并挂到对应章节
> - 期末考试自动组卷（单选 20×4 + 多选 5×4 = 100） 发布到两个班
> - 任务引擎逐章任务批量发布
> - 知识图谱六板块建设（节点属性 32+1、问题图谱 8 题、五会能力 5 点、思政 8 节点）
>
> 全程零人工剪辑、零手工录入。

## v3.0 亮点

| 模块 | 能力 |
|---|---|
| 🎬 **课件视频合成** | 分镜脚本 md + 章节 PDF → edge-tts 逐句配音 + ffmpeg Ken Burns → 1080p25 MP4 + SRT |
| 📹 **视频章节上传** | `insertvideo` 链路，与课件 PPT 共存于同一节 |
| 📝 **考试组卷 / 发布** | 自动组卷（跳二次确认）+ 定时截止 + 限时 |
| ✅ **任务引擎发布** | 已有任务批量发放到班级，幂等跳过 |
| 🕸 **知识图谱** | 知识 / 问题 / 能力 / 思政四类图谱的节点属性、层级、题目、五会能力写入 |

## 功能

| 脚本 | 作用 |
|---|---|
| `cx-login.mjs` | 扫码登录一次，保存登录态 |
| `cx-courses.mjs` | 列出我的课程，取 courseId / clazzId / cpi 三件套 |
| `cx-fill.mjs` | 章节正文批量**安全追加**（绝不覆盖已上传课件） |
| `cx-quiz.mjs` | 题库：建「第N章」文件夹 / 智能导入 / 回读复核 / 批量清理 |
| `cx-topics.mjs` | 讨论话题批量发布 / 按关键词删除 |
| `cx-res.mjs` | 平台「教学资源库」检索 → 入库课程资料库 / 列出 / 删除 |
| `cx-video-upload.mjs` | 🆕 讲解视频按章挂载到正文 |
| `cx-video-verify.mjs` | 🆕 全量回读校验（视频/课件/图片计数） |
| `cx-exam-build.mjs` | 🆕 考试自动组卷 |
| `cx-exam-publish.mjs` | 🆕 发布试卷到班级 |
| `cx-task-publish.mjs` | 🆕 任务引擎批量发布 |
| `cx-graph-fill.mjs` | 🆕 知识图谱六板块填充 |
| `gen-graph.py` | 🆕 图谱填充 JSON 生成 |
| `make_video.py` / `video_all.py` | 🆕 讲解视频单集合成 / 批量合成（断点续跑） |
| `fetch-pdf.mjs` | 从超星下载章节课件 PDF |
| `gen-quiz.py` / `validate-quiz.py` | 生成超星「智能导入」格式题本 / 格式校验 |

## 环境要求

- Windows + Chrome（macOS/Linux 理论可用，路径探测按需扩展）
- Node.js ≥ 18
- Python 3.9+（视频合成需 `edge-tts` / `Pillow` / `imageio-ffmpeg`）
- 超星教师账号（有建课权限）

## 安装

```bash
git clone https://github.com/wearemy008/chaoxing-course-automation.git
cd chaoxing-course-automation
npm install

# 视频合成还需要 Python 依赖
pip install edge-tts Pillow imageio-ffmpeg
```

## 快速开始

```bash
# ① 首次：扫码登录（弹窗扫码，登录态存 state/auth-state.json）
node bin/cx.js login

# ② 列出课程，拿 courseId / cpi（clazzId 可省略，命令运行时自动补全）
node bin/cx.js courses

# ③ 配置课程（考试 / 任务 / 图谱脚本需要）
cp scripts/courses.example.json scripts/courses.json
#    编辑 courses.json，填入你的 courseId / clazzId / cpi

# ④ 之后任意命令
node bin/cx.js fill   --course=123456789 --cpi=110000000 --map=chapter-map.json --marker=本章拓展资源
node bin/cx.js quiz   view --course=123456789 --cpi=110000000
node bin/cx.js video  upload --plan=video-plan.json --course=bangong --from=1 --to=10
node bin/cx.js exam   build  bangong 20 5 4
node bin/cx.js task   publish bangong 1 10
node bin/cx.js graph  fill   bangong
```

> 考试 / 任务引擎 / 图谱脚本以 `courses.json` 里的**课程别名**为第一参数（示例用 `bangong`），
> 你可以在 `courses.json` 里用任意别名映射到自己的课程。
> `courses.json` 含个人 courseId，已被 `.gitignore` 排除，**请勿提交**。

## 三条安全设计（重要）

1. **章节正文只追加、不覆盖。** 教师手动上传的 PPT / 视频以 iframe 形式存在于正文 HTML 里，所有写入走三态策略：已含标记→跳过（幂等可重跑）/ 正文为空→写入 / 非空→`原文 + <hr/> + 新内容` 追加。
2. **题库导入后强制回读复核。** 批量导入时章节文件夹选中可能丢失（实测出现过单章重复 16 题、另一章 0 题），`quiz view` 会对比总题数与各章题数并告警。
3. **视频上传后强制终验。** 视频判据是 `ans-insertvideo` 而非 `taskIframe`，且点「确认」后须等 iframe 消失，否则内容不落盘。`video verify` 逐节点回读三类媒体计数。

环境变量：`CX_CHROME`（指定 chrome.exe）、`CX_STATE`（登录态路径）、`CX_COURSES`（课程配置路径）、`CX_HEADFUL=1`（可见窗口调试）、`CX_SLOW=1`（放慢 1.8 倍）、`CX_GRAPH_LABELS`（覆盖图谱标签 id）、`CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000`（长批量合成时避免被删除守卫中断）。

## 目录结构

```
├── bin/cx.js            CLI 统一入口
├── scripts/
│   ├── cx.mjs                   公共库：登录态/导航/章节安全写入/智能导入
│   ├── cx-config.mjs            课程配置加载（courses.json）
│   ├── courses.example.json     课程配置模板
│   ├── video-plan.example.json  视频上传计划模板
│   ├── cx-login.mjs             扫码登录
│   ├── cx-courses.mjs           课程三件套
│   ├── cx-fill.mjs              章节正文批量安全追加
│   ├── cx-quiz.mjs              题库 view | mkdir | import | clean | delall
│   ├── cx-topics.mjs            话题批量发布 / 删除
│   ├── cx-res.mjs               资源库 add | list | del
│   ├── cx-video-upload.mjs      视频章节上传
│   ├── cx-video-verify.mjs      视频/课件回读校验
│   ├── cx-exam-build.mjs        考试自动组卷
│   ├── cx-exam-publish.mjs      发布试卷到班级
│   ├── cx-task-publish.mjs      任务引擎批量发布
│   ├── cx-graph-fill.mjs        知识图谱六板块填充
│   ├── gen-graph.py             图谱填充 JSON 生成
│   ├── make_video.py            单集讲解视频合成
│   ├── video_all.py             批量合成（断点续跑）
│   ├── video_manifest.example.py 视频清单模板
│   ├── fetch-pdf.mjs            下载章节课件 PDF
│   ├── gen-quiz.py              生成超星格式题本
│   └── validate-quiz.py         题本格式校验
├── references/api.md    ★ 接口速查：URL 表、选择器、参数语义、40 条踩坑解法
└── state/               （git 忽略）登录态 + 进度 JSON，断点续跑
```

`references/api.md` 记录了**全部逆向结论** —— 为什么智能导入必须用 `textContent`、为什么 `setContent` 会删课件、为什么 stat2 端点不能带 `enc`、为什么问题图谱的 `questionId` 必须是字符串 `'0'`、为什么 ffmpeg 滤镜里不能出现盘符冒号。**想二开先读它，能省数小时试错。**

## 视频合成管线

```
分镜脚本 md  ──parse_segment()──►  镜头列表
课件 PDF     ──render_pages()──►  PNG（scale=3, 2160×1215）

每镜头：
  旁白 ──split_sentences()──► 逐句 TTS（zh-CN-XiaoxiaoNeural, 4 并发, 3 重试）
                              └─► wav 拼接（重试 + 产物校验）
  PNG + zoompan Ken Burns    ──► 视频片段
                              └─► 音频 concat

全部镜头 ──concat──► PIL 标题条 overlay ──► 字幕烧录 ──► 1080p25 H.264/AAC MP4 + .srt
```

**Windows ffmpeg 三大坑**：① 滤镜参数禁出现盘符冒号（设 `cwd` + 只用相对文件名）；② 不用 `drawtext` 写中文（PIL 渲染 PNG + overlay）；③ 工作目录纯英文路径。

## 安全与免责

- `state/auth-state.json` 存有登录 Cookie，已被 `.gitignore` 排除，**请勿分享或提交**
- 本工具仅用于**管理教师自己的课程**，请遵守超星平台服务条款，勿用于爬取、刷课或干扰他人
- 平台页面结构可能随改版变化，接口细节以 [`references/api.md`](references/api.md) 为准并自行验证
- 本项目与超星集团官方无关，仅供教学管理效率工具交流

## License

[MIT](LICENSE)
