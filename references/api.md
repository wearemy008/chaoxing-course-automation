# 超星泛雅教师端 · 接口与逆向全表（v3.0）

> 本文件是全部逆向结论的单一真源。所有 URL、DOM 选择器、参数语义都经过真实课程跑通验证。
> 域：`mooc1.chaoxing.com` / `mooc2-ans.chaoxing.com` / `stat2-ans.chaoxing.com` / `task.chaoxing.com` / `groupweb.chaoxing.com`

---

## 0. 通用前置

### 0.1 登录态

超星是**会话 cookie**型平台，`storageState` 注入即可复用，持久化 profile 无效。

```js
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'], locale: 'zh-CN',
});
const ctx = await browser.newContext({
  storageState: path.join(__dirname, 'auth-state.json'),
  viewport: { width: 1680, height: 1050 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
});
const p = await ctx.newPage();
p.on('dialog', (d) => d.accept().catch(() => {}));   // 一律自动接受原生 confirm
```

一次有头扫码导出 `auth-state.json`，可用数周。

### 0.2 三件套 + enc

| 参数 | 含义 | 获取方式 |
|---|---|---|
| `courseId` | 课程 id | 课程列表 |
| `clazzId` | 班级 id | 课程主页（同一门课多班时取授课班） |
| `cpi` | 用户/机构 id | 课程主页 URL |
| `enc` | **每次会话变化的加密参数** | 只能从 `isNewCourse` 重定向后的主页 URL 里提取，**严禁手工拼** |

### 0.3 进课程主页（唯一正确入口）

```
https://mooc1.chaoxing.com/course/isNewCourse?courseId={courseId}&edit=true&v=2&cpi={cpi}&pageHeader=-1&single=0
```

超星会重定向生成带有效 `enc` 的 URL。**不要手工拼 `tch` 开头的 URL**（enc 不匹配 → 403/空白）。

侧边菜单的地址在 `a[data-url]` 属性里（`li` 本身无 onclick，是事件委托）。

---

## 1. 章节结构

### 1.1 批量建章节（文本大纲导入）

```
POST https://mooc1.chaoxing.com/edit/importdirForText
body: courseId=<id>&text=<缩进大纲，2 空格/层级>
```

超星官方格式：每层缩进 2 空格。

> ⚠️ **平台会自动给章节加序号**，导入文本里**不要再写序号前缀**，否则课程树显示成「2.1 2.1 空间布局」。

### 1.2 重命名节点

```
POST https://mooc1.chaoxing.com/mooc-ans/edit/changename
body: courseid=<id>&nodeid=<knowledgeId>&name=<新名>
```

`changename` / `addchild` 之后立刻读树可能读到旧 DOM，需 `sleep` 或 reload。

### 1.3 批量删除章节

```
POST https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/batchdeletechapters
body: courseid=<id>&knowledgeids=<逗号分隔>&cpi=<cpi>
```

**必须在 mooc2-ans 列表页同源调用**，否则被拒。

### 1.4 课程树 DOM

| 元素 | 含义 |
|---|---|
| `tr[data-recordid]` | 章节行，`data-recordid` = `knowledgeId` |
| `span.x-tree-node-text` | 节点名 |
| `.lib-chapter-N` | 深度 class（N = 层级） |

**depth 判定必须 `parseInt`**，字符串比较 `'10' < '2'` 会错。

---

## 2. 节内容（正文）读写 ★ 最危险区域

### 2.1 节点编辑器

```
https://mooc1.chaoxing.com/edit/chapters/{courseId}/{knowledgeId}?classId={clazzid}&cpi={cpi}&newMooc=true&mooc2=1
```

### 2.2 激活 UEditor

编辑器页面用 UEditor。必须先激活：

1. 轮询 `window.UE.instants.ueditorInstant0` 出现；
2. 点铅笔 ✏ 图标或 `.ans-card` 激活编辑区；
3. 工具栏按钮才会就绪。

### 2.3 读写正文

```js
// 读
const html = await p.evaluate(() => window.UE.instants.ueditorInstant0.getContent());
// 写（危险！见下）
await p.evaluate((h) => window.UE.instants.ueditorInstant0.setContent(h), html);
```

### 2.4 保存

编辑器页内点 `a.ans-save-btn` → `POST /mooc-ans/edit/savecard`（`title` / `attachments` / `description`）。

保存超时的节点可能**实际已保存**，重试前先读内容检查，否则会重复（用 `<hr/>` 识别追加重复）。

### 2.5 ★★★ 课件保护铁律

**主人上传的 PPT 是以内嵌 iframe 存在于节正文 HTML 里**，不是独立附件列表：

```html
<iframe class="taskIframe ans-module frame-spread ans-attach-online ans-insertdoc-retract"
        data="{&quot;objectid&quot;:&quot;...&quot;}">
```

**对含课件的节点绝不能 `setContent` 直接覆写，否则课件被删。**

安全三态写入：

| 正文现状 | 行为 |
|---|---|
| 已含内容标记 | **跳过**（幂等可重跑） |
| 正文为空 | 直接写入 |
| 正文非空（有课件） | `原文 + '<hr/>' + 新内容` **追加** |

### 2.6 取附件 objectid

编辑器页内 GET（**必须在页面上下文内 fetch**，独立 request 返回 `{}`）：

```
GET /mooc-ans/edit/getcard?cardid=0&nodeid={nodeId}&courseid={courseId}&cpi={cpi}
```

从 `description` 里正则提取（HTML 转义形式）：

```js
/&quot;objectid&quot;:&quot;([^&]+)&quot;/
```

### 2.7 下载 PPT

```
GET /ananas/status/{objectid}   →  { download, pdf, filename, pagenum }
```

下载直链时**缺 Referer 会 403**：

```js
await ctx.request.get(dl, { headers: { Referer: 'https://mooc1.chaoxing.com/' } });
```

---

## 3. 文件上传协议（两套独立端点）

### 3.1 章节课件（PPT 挂正文）

章（depth=1）不可编辑内容 → 每章需建一个「本章课件」节（depth=2）来挂 PPT。

```
1. 开节点编辑器，点铅笔 ✏ 激活 UEditor
2. 真实 click .ans-command-insertdoc:visible      ← 弹 insertdoc iframe
3. iframe 内 input[type=file] setInputFiles(FILE)
4. 自动 generate-sign → POST pan-yz.chaoxing.com/upload/v2/uploadfile
5. 轮询 GET /ananas/status/<objectid>，响应含 filename = 成功
6. 点「确定」
7. 点 a.ans-save-btn → savecard 200
```

### 3.2 章节课件（**视频**挂正文）★新增

```
1. 激活 UEditor（ue.focus() + 点 iframe[id^=ueditor_]）
2. 真实 click .ans-command-insertvideo:visible     ← 弹 insertvideo iframe
   跨域 URL: https://mooc1.chaoxing.com/ananas/new-editor/ueditor/dialogs/insertvideo/insertvideo.html
3. iframe 内 4 个 tab：本地上传 / 云盘 / 课程资料 / 在线视频
4. ★ 上传 input 是 input[name="file"][accept*="video"]
   （页面有两个同名 file input，必须选视频专用那个）
5. 上传完成信号：帧内出现文本「完成」/「100%」
   （★ ananas/status 响应不一定带 filename，别只靠它）
6. 点「确认」→ ★ 必须等 insertvideo iframe 从 page.frames() 消失才算生效
   否则内容不落盘
7. 保存 a.ans-save-btn → savecard 200
```

插入后正文出现：

```html
<iframe module="insertvideo"
        class="ans-module ans-insertvideo-retract ans-attach-online"
        data="{...objectid,name,size,title...}">
```

课件是 `module="insertdoc"`，两者**可共存于同一节**。

### 3.3 资料库本地上传（与上面是两套端点）

```
主页真实点「资料」菜单（iframe 切换，直接 goto 会空白）
→ 帧内 a.jb_btn「添加资料」
→ a.popLocalBnt
→ input[name=file].webuploader-element-invisible  setInputFiles
→ 自动 POST mooc1/upload-ans/upload/uploadNew
→ {state:"SUCCESS", url:<objectid>, original, fileSize}
```

### 3.4 资料删除

列表条目 `a.rename_title`（结构 `LI.dataBody_name`）→ 行内爬祖先找「删除」→ 弹层「删除文件?」，**确认按钮文案 =「删除」**。

同名重传自动加 `(1)` 后缀，**不覆盖**。

---

## 4. 考试组卷 / 发布

### 4.1 自动组卷

```
入口：/mooc2-ans/exam/toAutoCreatePaperPage?courseid=X&classid=Y&cpi=Z&pid=0
      &position=test&createPaperType=1&editPaperTemplate=true&ut=t
```

表单元素：

| id | 含义 |
|---|---|
| `#title` | 试卷标题 |
| `#score` | 满分 |
| `#pageNum` | 页数（填 1） |
| `[id="{type}_libraryInputQuestionNum"]` | 该题型题量 |
| `[id="{type}_score"]` | **该题型整块总分**（不是每题分值！） |

> ⚠️ **数字开头的 id 必须用属性选择器** `[id="0_score"]`，`#0_score` 是非法 CSS 选择器。

题型编号：`0`=单选，`1`=多选，`3`=判断（判断题块默认隐藏，若块隐藏则填了也无效）。
**只提交可见题型**：`div[id$=_TypeDiv]` 且 `offsetParent !== null`。

> ⚠️ 满分必须 **=== 各题型分之和**（页面强校验 `totalScoreId === totalScoreIdV2`）。
> 实测可用组合：单选 20×4 + 多选 5×4 = 100。

提交（★ 跳过二次确认）：

```js
window.send(1);   // chooseType=1 → 内部不弹确认框，直接 randomPaper()
```

组卷是**异步任务**，返回 `#taskid`，须轮询：

```
GET /mooc2-ans/exam/autopapertask-status?courseid=<id>&cpi=<cpi>&taskid=<tid>
→ 出现 ok / fail / invalid 即结束，成功后 #paperId 有值
```

### 4.2 发布到班级

```
/mooc2-ans/exam/test/topublish?taskid=0&clazzid=Y&courseid=X&ut=t&cpi=Z&paperid=P&score=100.0
```

```
1. 点 #choosepublish           → 开发放对象弹层
2. 点 a.classitem[data=<clazzid>] 同行的 span.class_check  → 勾选班级
3. 点 #confirmchoose           → 生成 .selectClass > a[data=<clazzid>][publishtype=0]
4. 设 #endTime（切「定时截止」→ jQuery 控件需 setter + dispatchEvent）
5. 设 #limitTime（考试限时，分钟）
6. ★ window.publishpaper(true)  → POST /mooc2-ans/exam/test/publish（跳过二次确认）
```

jQuery 日期/数字控件赋值必须走原生 setter：

```js
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
setter.call(el, v);
el.dispatchEvent(new Event('input',  { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

---

## 5. 任务引擎发布

```
入口：https://task.chaoxing.com/task/index?courseId=X&clazzId=Y&cpi=Z&enc=-1
```

| 操作 | 端点 |
|---|---|
| 任务列表 | `GET /task/getTaskDataLists?searchKey=&flag=true&courseId=X&isDel=0&page=1&pageSize=50` |
| 任务详情 | `/task/taskList?taskId=<enc>&flag=true&courseId=X` |

★ **列表是课程级，不传 clazzId**。返回字段：`taskId / name / publishStatus / taskStudentsNumber / targetList`。

发布链路（点「发布」实际触发 4 个请求，核心是第 2 个）：

```
1. 前面两个是埋点/校验
2. ★ POST /taskReference/coursePublishAuthentication
      → 返回 publish-plugin iframe URL:
        https://mooc2-ans.chaoxing.com/mooc2-ans/exam/test/publish-plugin?courseid=X&cpi=Y
3. 该 URL 以 iframe 弹窗形式注入
4. 帧内 DOM 与作业发放同构：
     a.classitem.newClassItem[data=<clazzid>] + span.class_check
     「确定」按钮 .jb_btn.jb_btn_92.fr.fs14
```

判据：回读 `getTaskDataLists` → `publishStatus:true` + `taskStudentsNumber:30`。

> ⚠️ 若点「发布」UI 无反应，**用 `ctx.addInitScript` hook `XMLHttpRequest.prototype.open/send` + `window.fetch`** 抓全部请求。
> `page.on('request')` 在有 iframe/异步链时会漏（只抓到 1 个）。

---

## 6. 资料 / 题库 / 讨论 / 资源库

| 模块 | 入口 | 关键操作 |
|---|---|---|
| 题库 | 新窗口 `mooc2-ans.chaoxing.com/mooc2-ans/qbank/questionlist?courseid=X&clazzid=Y&enc=Z&cpi=W&ut=t` | 批量导入（`.insert.mapEdit`）→ 模板/智能/跨课导入 |
| 智能导入 | `.../qbank/smartimport?courseid=X&cpi=Y&qbanksystem=0&microTopicId=0` | `#queContent` 填文本 → `app.reparse()` 识别 → 「加入题库」→ `checkDirectory()` 选文件夹 → `confirmImport()` |
| 讨论 | `groupweb.chaoxing.com/course/topic/topicList?courseid=X&clazzid=Y&enc=Z&openc=...&ut=t&microClassDiscuss=1&bbsid=...&supportAI=true` | 新建话题 `a.createTopic`；**bbsid/openc 缺一不可**，缺了报「非法请求」 |
| 资料 | `mooc2-ans.chaoxing.com/mooc2-ans/coursedata?...` | **必须从主页点「资料」菜单进**，直接 goto 缺初始化 |
| 教学资源库 | 弹新 frame `fanyazyk2.chaoxing.com/zyk2mooc/prep/schoolResourceRepository?courseid=X&enc=Y&fid=3229&isNewVer=1&type=2` | 标签：本校资源库 / 教学资源库 |
| 平台资源搜索 | 切「教学资源库」标签 → `searchMoocName3?coursetitle=关键词` | 课程列表 → 资源列表（类型 tabs `searchByDataType`：6视频/3PPT/1文档/4图片）→ 勾选 → `patchAddData()` 批量入库 |

### 智能导入文本格式（超星官方规范）

```
1.【单选题】题干（B）
A. 选项一
B. 选项二
C. 选项三
D. 选项四
答案：B
解析：……

2.【多选题】题干（ABD）
A. …
答案：ABD
解析：……

3.【判断题】题干（对）
答案：对
解析：……

4.【填空题】下划线处 ___ 答案；分号隔开
答案：答案一；答案二

【自定义题型名】用方括号标注题型
{{ 阅读理解/组合题 }} 用双大括号包裹
```

- 题号 `1.`
- 选项 `A.` 或 `A、`，也可横向空格分隔
- 答案另起一行 `答案：X`（多选多字母）
- 判断题答案写 `对` / `错`

> ⚠️ 智能导入的编辑区**必须用 `textContent` 塞值**（纯文本含真实 `\n`），`fill` / `insertText` / `innerHTML` 都会只识别出 1 题。

---

## 7. 知识图谱（六级体系）★ v3.0 新增

### 7.1 域与开关

图谱数据在 **`stat2-ans.chaoxing.com`**。入口：主页点 `a[data-url*="knowgraph"]`（新窗口打开）。

> ★ **坑：`stat2` 的 `course-target/*`、`question-map/*` 端点必须不带 enc + `clazzid='0'`**，带 enc 直接 403。
> ★ **hash 直达路由**（`#/targetMapTeacher` 等）的 query **不能带 enc**，SPA 会把 enc 塞进 stat2 请求 → 403 → 面板假「暂无内容」。
> **数据真相以「无 enc 直接 GET」为准。**

公共参数：

```js
const BASE = { courseid: COURSE, clazzid: '0', cpi: CPI, ut: 't', modelId: '0' };
```

### 7.2 三开关（激活问题/能力/思政图谱）

```
POST /mooc2-ans/questionBankTopic/updatequestionmap   {courseId, cpi, topicModelId:'0', clazzId, enc, questionMap:'1'}
POST /mooc2-ans/questionBankTopic/updateabilitymap    {..., abilityMap:'1'}
POST /mooc2-ans/questionBankTopic/updateideologicalmap{..., ideologicalMap:'1'}
```

### 7.3 节点属性（知识图谱）

```
POST /mooc2-ans/questionBankTopic/savepropertyedit
```

**全量替换语义**（先读后合并）：

```
courseid, cpi, topicIds=<nodeId>, classify, cognize:'-1',
topicLabelIds=<逗号分隔>, topicDesc, teachTargert, studyHours:'0'
```

读现状（幂等合并用）：

```
GET /mooc2-ans/coursetopic/gettopicdetail
    ?courseid=X&clazzid=Y&cpi=Z&ut=t&modelId=0&topicId=<nid>&enc=E
```

标签 id 映射（本机构）：

| 标签 | id |
|---|---|
| 重点 | `24283664` |
| 难点 | `24283665` |
| 考点 | `24283666` |
| 思政 | `24283667` |

`classify` 取值：`1` 历程/演变/标准/流程 · `2` 概念/方法/原理 · `3` 实训/上机 · `4` 总结/评价/反思 · `-1` 未分类。

### 7.4 问题图谱

```
POST {S2}/stat2/question-map/questionLevel/update   {BASE, title, description, level}
GET  {S2}/stat2/question-map/question/list          BASE
POST {S2}/stat2/question-map/question/add
     {BASE, title, description, answer:'', level, labelIds:'', topicIds, questionId:'0', lastQuestionId:'0'}
POST {S2}/stat2/question-map/question/delete?id=<id>
```

> ★ **`questionId` 必须传数字 `'0'`**，否则 add 失败。
> ★ **章节点（depth=1）不能绑问题**（返回 `status:true` 但 `topicList=[]` 静默拒绝），**只绑叶节点**。
> ★ add 后 list 有**秒级同步延迟**。

### 7.5 能力图谱（五会）

```
GET  {S2}/stat2/course-target/manager/targetList      {BASE, pageNo:'1', pageSize:'50', targetName:'', labelName:''}
POST {S2}/stat2/course-target/manager/addTargetV2     {BASE, name, description, labelIds:'', topicIds, type:'0'}
POST {S2}/stat2/course-target/manager/updateTarget    {BASE, ..., targetId:<id>}
POST {S2}/stat2/course-target/knowledge/saveTargetSetTitle  {courseid, clazzid:'0', cpi, modelId:'0', title}
```

能力集标题 **≤10 字符**。

### 7.6 六板块对应

| 图谱 | 页面路由 | 写入端点 |
|---|---|---|
| 知识图谱 | `knowledgeMapTempPage` | `savepropertyedit` |
| 问题图谱 | `questionMap` | `stat2/question-map/*` |
| 目标/能力图谱 | `targetMapTeacher` | `stat2/course-target/manager/*` |
| 思政图谱 | `ideologyPoliticsMap` | `updateideologicalmap` + `savepropertyedit.topicLabelIds` |
| 学习图谱 | `studyMap` | 服务端从学习数据派生（**无需写入**） |

> `knowledgeRelation`（关系图）/ `ad`（达成度）空属**正常**：前者服务端异步派生，后者需学生学习数据。

### 7.7 图谱数据生成

`gen-graph.py` 从两个输入生成填充 JSON：

1. `*-graph-data.json` —— 章节正文抽取的 `sections`（含 `no` / `name` / `key` 关键点 / `goal` 教学目标 / `hard` 难点）
2. `mapdata-*.json` —— 从图谱页面抓的节点树（`nodes[].{name, topicid, level}`）

输出 `*-graph-fill.json`：`{ nodes, levels, questions, targets }`，再由 `cx-graph-fill.mjs` 写入。

**生成逻辑**（严格依据大纲，不杜撰）：
- 节点描述 ← section 的 `key`（本章核心要点），教学目标 ← `goal`
- `classify` ← 关键词规则判定
- 标签 ← `.1` 结尾=重点；`hard` 含「难点/抽象/转化/平衡」=难点；思政节点清单=思政
- 问题图谱 ← 每章一个核心问题（三层：基础认知 / 方法建构 / 综合创造）
- 五会能力 ← 会思考/会学习/会沟通/会动手/会生活，各绑 2-3 个 topicid

---

## 8. 视频合成管线（本地，course-video-maker 主体）

### 8.1 输入

- 分镜脚本 md：表格列 `镜号 | 时间 | 画面 | 旁白（配音稿）| 素材`
- 章节课件 PDF（用 `fetch-pdf.mjs` 从超星下载，或本地提供）

### 8.2 流程

```
parse_segment()   解析脚本「第 N 段」→ 镜头列表
render_pages()    PDF 全页渲染 PNG（scale=3 → 2160×1215）
split_sentences() 按 。！？； 切句
tts_one()         edge-tts 逐句配音（zh-CN-XiaoxiaoNeural, Semaphore(4), 3 次重试）
   ↓ 每镜头：音频 concat + zoompan Ken Burns 视频片段
concat()          合并全部镜头
   ↓ PIL 标题条 PNG overlay + subtitles 烧录字幕
输出              1080p25 H.264/AAC MP4 + 同名 .srt
```

### 8.3 ★ Windows ffmpeg 三大坑

1. **滤镜参数禁出现盘符冒号** → 设 `cwd`=工作目录，滤镜里只用**相对文件名**（`C:/x/y.mp4` 里的 `C:` 会被 filtergraph 当参数分隔符）。
2. **不用 `drawtext` 写中文**（字体路径/编码各种炸）→ 用 **PIL 渲染 PNG 再 overlay**。
3. **工作目录必须纯英文路径**。

### 8.4 其他要点

- ★ **edge-tts 中文不返回 WordBoundary** → 必须**逐句合成**再累加时钟算时间轴。
- ★ **imageio-ffmpeg 不带 ffprobe** → wav 时长用标准库 `wave`（`nframes / framerate`）。
- ★ **TTS 并发写盘竞态**会导致 `Invalid data found when processing input`（读到未落盘的截断 wav）→ 音频拼接必须带**重试 + 产物校验**（大小 > 1000B）。

---

## 9. 踩坑总表

| # | 现象 | 原因 / 解法 |
|---|---|---|
| 1 | 课程树显示「2.1 2.1 xxx」 | 导入文本里写了序号，平台会自动加，**别手写** |
| 2 | 连续点子目录后节点级联嵌套 | 编辑器树点「子目录」后新节点自动选中，**每次创建前必须重新选中目标父节点** |
| 3 | 长跑 node 脚本中途死掉 | Bash 管道 `\| head` 会 SIGPIPE 杀进程；**长任务输出必须重定向到文件** |
| 4 | 改完名读树还是旧值 | `changename`/`addchild` 后 DOM 未更新，需 `sleep` 或 reload |
| 5 | 保存超时但实际已保存 | **重试前先读内容检查**，否则重复写入 |
| 6 | 课件被删 | `setContent` 覆写了正文，课件是 iframe；必须追加 + 幂等标记 |
| 7 | 独立 request 取 getcard 返回 `{}` | 必须在**页面上下文内** fetch |
| 8 | 下载 PPT 直链 403 | 缺 `Referer: https://mooc1.chaoxing.com/` |
| 9 | 视频上传 `setInputFiles: Timeout` | 用了「文档」按钮（insertdoc 弹层无视频 input）；必须 `.ans-command-insertvideo` + `input[name="file"][accept*="video"]` |
| 10 | 视频上传后正文没变 | 判据错（视频是 `ans-insertvideo` 不是 `taskIframe`）+ 点确认后**等待不足**；必须等 insertvideo iframe 消失 |
| 11 | 「视频」按钮点不动 | 工具栏未激活；加 4 次重试（`ue.focus()` + 点编辑区 + 点已有媒体块刷新工具栏） |
| 12 | `#0_score` 选不中 | 数字开头 id 必须 `[id="0_score"]` |
| 13 | `_score` 填错 | 它是**整块总分**不是每题分；满分必须 = 各块之和 |
| 14 | `div[id$=_TypeDiv]:visible` 报错 | `:visible` 是 jQuery 语法，Playwright 不支持；改用 `offsetParent !== null` |
| 15 | 组卷 submit 后无反应 | 走 `window.send(1)`（chooseType=1 跳过确认） |
| 16 | 组卷成功但拿不到 paperId | 是异步任务，须轮询 `autopapertask-status` |
| 17 | 直接 goto 考试列表 404 | 改为**真实点击左侧菜单「考试」** |
| 18 | `page.evaluate(fn, a, b)` 报 Too many arguments | 包成对象 `page.evaluate(fn, { t, cid })` |
| 19 | 点「发布」只抓到 1 个请求 | `page.on('request')` 会漏；用 `ctx.addInitScript` hook XHR/fetch |
| 20 | `.popDiv.qdistribution` 查不到班级 | 内容在跨域 iframe；`p.frames().find(f => /publish-plugin/.test(f.url()))` |
| 21 | 发布考试遇二次确认卡住 | `window.publishpaper(true)` 跳过 |
| 22 | 时间控件 set 了不生效 | jQuery 控件需**原生 setter + dispatchEvent(input/change)** |
| 23 | stat2 端点 403 | `course-target/*`、`question-map/*` **不能带 enc**，且 `clazzid='0'` |
| 24 | 图谱面板假「暂无内容」 | hash 路由 query 带了 enc，SPA 把它塞进 stat2 请求 → 403；**无 enc 直接 GET 才是真相** |
| 25 | 问题 add 返回 true 但不生效 | `questionId` 必须是数字 `'0'`；且**章节点不能绑问题**，只绑叶节点 |
| 26 | 问题 add 后 list 读不到 | 秒级同步延迟，等 1-2 秒 |
| 27 | `savepropertyedit` 覆盖了旧标签 | 它是**全量替换**；必须先 GET 现状再合并 |
| 28 | 资源入库 `parent.postMessage` 静默丢消息 | 自动化下不可靠，走直连 `POST /mooc2-ans/coursedata/add-zyk` |
| 29 | 智能导入只识别 1 题 | 编辑区必须 `textContent = 纯文本`（含真实 `\n`） |
| 30 | 讨论页报「非法请求」 | URL 缺 `bbsid` 或 `openc` |
| 31 | 智能导入题号重排 | 目录树异步加载选中失败，需轮询 + 重试 |
| 32 | 资料库删错文件 | `.dataBody` 是整组容器，要按「复选框所在 ul 内找 `.dataBody_name`」精确匹配 |
| 33 | `zyk.keyboard.press` TypeError | Frame 没有 keyboard，键盘操作只用主 `page.keyboard` |
| 34 | ffmpeg 滤镜报错、参数错乱 | 滤镜里出现了盘符 `C:`；改 `cwd` + 相对文件名 |
| 35 | 画中文字幕乱码 | `drawtext` 不可靠；改 PIL 渲染 PNG → overlay |
| 36 | 字幕时间轴全为 0 | edge-tts 中文不返回 WordBoundary；必须逐句合成累加 |
| 37 | `ffprobe not found` | imageio-ffmpeg 不带 ffprobe；用标准库 `wave` 读 wav 时长 |
| 38 | 音频拼接 `Invalid data` | TTS 并发写盘竞态；重试 + 产物大小校验 |
| 39 | 跑批量时进程被杀（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`） | 本机删除守卫按 `scope=turn` 阈值 50 计数，TTS 逐句删 mp3 会累积触发；设 `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000` 且 `unlink` 包 try/except |
| 40 | 后台进程随 shell 退出被杀 | 用工具的 `run_in_background`，不要 `nohup ... &` |

---

## 10. 逆向方法论（可复制到任何平台）

1. **登录态**：Playwright `storageState` 注入（会话 cookie 型）；有头登录一次导出。
2. **探查**：probe 脚本逐页 dump DOM + 网络；**页面上下文内 fetch 才有数据**，独立 request 常 403/空。
3. **填表**：React/Vue/jQuery 控件必须**原生 setter + dispatchEvent**；隐藏模板元素用 `:visible`（jQuery）或 `offsetParent` 避开。
4. **hook 网络**：`ctx.addInitScript` 改写 `XMLHttpRequest.prototype.open/send` 与 `fetch`，比 `page.on('request')` 全。
5. **chunk 逆向**：读 `runtime.js` 的 webpack chunk 映射 → 全量下载 chunk → 正则扫出现过的 API 路径（本项目用此法从 139 个 chunk 里扫出 350 个端点）。
6. **验证链**：单任务冒烟 → 后台批量（幂等标记 + 断点续跑 + 结果落 json）→ 列表回读验证。
7. **沉淀**：接口表 + 踩坑教训写进 `references/api.md`，脚本进 `scripts/`。
8. **保护性操作**：对含用户内容的节点**先读后写、追加不覆写、埋内容标记做幂等**。
