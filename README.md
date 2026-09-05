# Chaoxing Course Automation

超星泛雅 / 学习通（chaoxing.com）教师端课程自动化 CLI。把「建一门在线课」的重复劳动封装成 7 条命令：**批量建章节、批量写章节正文、智能导入题库、发布讨论话题、平台教学资源检索入库、章节批量清理**。

基于 Playwright 驱动本机 Chrome 完成（超星无公开的课程内容写入 API），登录态复用，一次扫码可用数周。

> 已在真实课程完整跑通并验证：2 门课程 × 21 章 —— 168 道章节测验按章归档、21 个讨论话题发布、39 项平台共享资源入库、21 章正文批量追加，全程零人工剪辑/零手工录入。

## 功能

| 命令 | 作用 |
|---|---|
| `cx login` | 扫码登录一次，保存登录态（有头窗口） |
| `cx courses` | 列出我的课程，取 courseId / clazzId / cpi 三件套 |
| `cx quiz` | 题库：建「第N章」文件夹 / 智能导入题本 / 回读复核 / 批量清理 |
| `cx topics` | 讨论话题批量发布（标题自动加章节前缀）/ 按关键词删除 |
| `cx res` | 平台「教学资源库」检索 → 入库课程资料库 / 列出 / 按文件名删除 |
| `cx fill` | 章节正文批量**安全追加**（绝不覆盖已上传的课件） |
| `gen-quiz.py` / `validate-quiz.py` | 生成超星「智能导入」格式题本 / 格式校验 |

## 环境要求

- Windows + Chrome（macOS/Linux 理论可用，路径探测按需扩展）
- Node.js ≥ 18
- 超星教师账号（有建课权限）

## 安装

```bash
git clone https://github.com/wearemy008/chaoxing-course-automation.git
cd chaoxing-course-automation
npm install
node bin/cx.js help
```

## 快速开始

```bash
# ① 首次：扫码登录（弹窗扫码，登录态存 state/auth-state.json）
node bin/cx.js login

# ② 列出课程，拿 courseId / cpi（clazzId 可省略，命令运行时自动补全）
node bin/cx.js courses

# ③ 之后任意命令
node bin/cx.js quiz view --course=123456789 --cpi=110000000
node bin/cx.js quiz import --course=123456789 --cpi=110000000 --dir=题库 --prefix=课程名 --chapters=10
node bin/cx.js topics --course=123456789 --cpi=110000000 --json=讨论题.json --chapters=10
node bin/cx.js res add --course=123456789 --cpi=110000000 --kw=室内设计,人体工程学 --max=5
```

题本格式（超星智能导入规范）见 [`assets/quiz-template.json`](assets/quiz-template.json)，用 `gen-quiz.py` 从 JSON 源生成、`validate-quiz.py` 校验后导入。

## 三条安全设计（重要）

1. **章节正文只追加、不覆盖**。教师手动上传的 PPT 以 iframe 形式存在于正文 HTML 里，`cx fill` 内置三态策略：已含标记→跳过（幂等可重跑）/ 正文为空→写入 / 非空→`原文 + <hr/> + 新内容` 追加。
2. **题库导入后强制回读复核**。批量导入时章节文件夹选中可能丢失（实测出现过单章重复 16 题、另一章 0 题），`quiz view` 会对比总题数与各章题数并告警。
3. **资源入库后需 list + del 清理**。平台共享资源质量参差，脚本自动跳过「资源正在建设中」的课程并跨关键词去重，但仍建议人工复核。

环境变量：`CX_CHROME`（指定 chrome.exe）、`CX_STATE`（登录态路径）、`CX_HEADFUL=1`（可见窗口调试）、`CX_SLOW=1`（放慢 1.8 倍）。

## 目录结构

```
├── bin/cx.js            CLI 统一入口
├── scripts/
│   ├── cx.mjs           公共库：登录态/导航/章节安全写入/智能导入/讨论/资源直连入库
│   ├── cx-login.mjs     扫码登录
│   ├── cx-courses.mjs   课程三件套
│   ├── cx-quiz.mjs      view | mkdir | import | clean | delall
│   ├── cx-topics.mjs    话题批量发布 / 删除
│   ├── cx-res.mjs       add | list | del
│   ├── cx-fill.mjs      章节正文批量安全追加
│   ├── gen-quiz.py      生成超星格式题本
│   └── validate-quiz.py 题本格式校验
├── references/api.md    ★ 接口速查：URL 表、导航机制、UEditor、智能导入、
│                          题库管理、讨论区、资料库/资源库直连接口、全部踩坑解法
└── state/               （git 忽略）登录态 + 进度 JSON，断点续跑
```

`references/api.md` 记录了全部逆向结论——智能导入为什么必须用 `textContent`、资源入库为什么要直连 `POST /mooc2-ans/coursedata/add-zyk`（原生 `parent.postMessage` 在自动化下会静默丢消息）、资料库复选框的 DOM 结构等。**想二开先读它，能省数小时试错。**

## 安全与免责

- `state/auth-state.json` 存有登录 Cookie，已被 `.gitignore` 排除，**请勿分享或提交**
- 本工具仅用于**管理教师自己的课程**，请遵守超星平台服务条款，勿用于爬取、刷课或干扰他人
- 平台页面结构可能随改版变化，接口细节以 [`references/api.md`](references/api.md) 为准并自行验证
- 本项目与超星集团官方无关，仅供教学管理效率工具交流

## License

[MIT](LICENSE)
