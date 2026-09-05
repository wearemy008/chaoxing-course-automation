# 超星泛雅接口速查（实战逆向）

> 全部结论来自 2026-09 在 mooc1/mooc2-ans 环境实测。若平台改版，优先以浏览器实际 DOM 为准。

## 0. 三件套参数

| 参数 | 说明 | 获取方式 |
|---|---|---|
| `courseId` | 课程 ID | `cx-courses.mjs` |
| `clazzId` | 班级 ID | 同上（URL 里的 `clazzid`） |
| `cpi` | 教师-课程关联 ID | 同一账号通常固定，如 `110000000` |
| `enc` | 一次性会话串 | 进课程主页后从 URL query 取，每次刷新都会变 |

⚠ `enc` 必须每次现取：先进主页 `isNewCourse?courseId=X&cpi=Y` 等 9 秒，再从 `location.search` 读。

**三件套全能从主页隐藏 input 一次取全**（`gotoHome()` 已实现，返回对象）：

```
#courseid  #clazzid  #cpi  #enc  #bbsid  #openc  #fid  #userId
```

所以 `--clazz` 参数可省略，各命令会调 `resolveClazz()` 自动补全。

⚠ **不能用的列表页**（实测）：`mooc1.chaoxing.com/mooc2-ans/mycourse/tch?courseid=0`（404）、
`mooc1-1 / mooc1 / mooc2-ans 的 /mycourse/teachercourse`（302 到登录页）。只有 `i.chaoxing.com/base?t=course` 稳。

## 1. 关键页面 URL

| 用途 | URL |
|---|---|
| **课程列表（唯一稳定入口）** | `https://i.chaoxing.com/base?t=course&folder=0` → 真实列表在 iframe `https://mooc2-ans.chaoxing.com/visit/interaction?s=...` |
| 课程主页（取 enc） | `https://mooc1.chaoxing.com/course/isNewCourse?courseId={cid}&edit=true&v=2&cpi={cpi}&pageHeader=-1&single=0`<br>会 302 到 `mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch?courseid=..&clazzid=..&cpi=..&enc=..` |
| 题库 | `https://mooc2-ans.chaoxing.com/mooc2-ans/qbank/questionlist?courseid={cid}&clazzid={zid}&enc={enc}&cpi={cpi}&ut=t` |
| 智能导入 | `https://mooc2-ans.chaoxing.com/mooc2-ans/qbank/smartimport?courseid={cid}&cpi={cpi}&qbanksystem=0&microTopicId=0` |
| 章节编辑 | `https://mooc1.chaoxing.com/edit/chapters/{cid}/{nid}?classId={zid}&cpi={cpi}&newMooc=true&mooc2=1` |
| 讨论区 | `https://groupweb.chaoxing.com/course/topic/topicList?...&bbsid=...&openc=...`（**只能从菜单点进去**，拼 URL 会报非法请求） |
| 资料库 | `https://mooc2-ans.chaoxing.com/mooc2-ans/coursedata?...`（**必须从主页点「资料」菜单进**） |
| 教学资源库 | `https://fanyazyk2.chaoxing.com/zyk2mooc/prep/schoolResourceRepository?courseid={cid}&enc={enc}&fid={fid}&isNewVer=1&type=2` |
| 保存章节 | `POST /mooc-ans/edit/savecard`（点 `a.ans-save-btn` 触发） |

## 2. 导航机制

- 左侧菜单是 **iframe 切换 + 事件委托**，`li` 上无 onclick，真实地址在 `a[data-url]`。
  → 用 `document.querySelectorAll('a[data-url]')` 按文本匹配后 `.click()`。
- 内容区、编辑器、弹窗大多是 iframe，操作前先 `page.frames().find(f => f.url().includes('关键词'))`。

## 3. 章节正文（UEditor）

```js
const ed = window.UE.instants.ueditorInstant0;
ed.getContent();                 // 读 HTML
ed.getContent({ plain: true });  // 读纯文本（判断是否有内容）
ed.setContent(html);             // 写
```

- 保存：点 `a.ans-save-btn`，并监听 response URL 含 `/mooc-ans/edit/savecard` 且 status 200 才算成功。
- 主人已上传的 PPT 是**内嵌 iframe**（`class="taskIframe ans-module frame-spread ans-attach-online"`），
  存在于正文 HTML 里 —— 写正文必须"追加"不能"覆盖"。

**安全写入三态**：已含 marker→跳过 / 正文为空→写入 / 非空→`old + '<hr/>' + new`。

## 4. 智能导入（题库）

流程：题库页 → 批量导入 `.insert.mapEdit` → 智能导入 → 编辑区 → 识别 → 确定 → 加入题库 → 选目录 → 确定。

- 编辑区是 Vue 实例 `sqpPaperBodyVue`，真正的数据源是 `.editbox` 的 **innerHTML 文本**：
  ```js
  const eb = document.querySelector('.editbox');
  eb.textContent = 题本纯文本;   // ✅ 必须带真实 \n
  ```
  ❌ 用 `innerHTML` 塞 div / 用 `keyboard.insertText` 会被压成一行 → 服务端只识别出 1 题。
- 「识别」按钮：取所有可见、文本严格等于"识别"、子节点最少的元素点击。
- 确认弹窗：`.jb_btn` 文本"确定" → 调 `app.doReparse()` → `POST /sqp/api/parse`。
- 解析完成标志：页面出现「共识别 N 题」。
- 「加入题库」→ 目录弹窗，**目录树异步加载**，需轮询：
  `li[dirid] .popMove_text`（点其父 `.popMove_name`）。
- 确认：`checkDirectory()` → 可能还有二级确认（"确定"/"删除"都要试）。

## 5. 题库管理

| 操作 | 做法 |
|---|---|
| 建文件夹 | 点「新建文件夹」→ 行内输入框已聚焦并全选 → `page.keyboard.type(名称)` → `Enter` |
| 勾选题目 | `li.TiMu input.item` |
| 批量删除 | 勾选后点 `a.popDeleBnt`（"删除"）→ **确认按钮文本是"删除"不是"确定"** |
| 查题数 | 正文正则：`共 (\d+) 题`；文件夹：`(第\d+章)\s*公开\s*共\s*(\d+)\s*题` |

⚠ 批量导入后**必须回读复核每章题数**：实测出现过章节重复（16 题）与章节丢失（0 题）。

## 6. 讨论区

```js
const bf = page.frames().find(f => f.url().includes('topicList'));
await bf.locator('a.createTopic').first().click();
await bf.fill('input[name="title"]', 标题);
window.UE.instants.ueditorInstant0.setContent('<p>正文</p>');
// 发布：div.jb_btn 文本"发布"（初始可能带 jb_btn_92_disable 样式，直接点即可）
```

- 删除话题：勾选（话题条目里的 `input[type=checkbox]`）→ `a.popDeleBnt` → 确认"删除"/"确定"。

## 7. 资料库与教学资源库

打开链路：主页 → `a[data-url="/mooc2-ans/coursedata"]`（资料）→ `text=添加资料` → `text=教学资源库`
→ zyk 帧里切「教学资源库」标签。

| 元素/函数 | 作用 |
|---|---|
| `input#title`（placeholder 课程/资源） | 搜索框 |
| `a.zyk_search_bnt` / `searchmooc()` | 搜索（**必须调函数或点这个 a**，别的按钮无效） |
| `getdatalist('教学资源库','/zyk2mooc/prep/getKcResourceData', 课程名)` | 打开某课程的资源列表 |
| `li.resultBody_cont` / `a.resultBody_href` | 资源行 / 文件名 |
| `input[name=checkbox_ppt]` | **真正的选择框**（`checkOnePPT()` 写 `#idspptArr`）；外层 `span.zyk_check` 只切样式 |
| `#idspptArr` | 已选 id，逗号分隔 |
| `li.tabs` / `searchByDataType(el, n)` | 类型筛选，n = 6视频/3PPT/1文档/4图片 |

**入库（原生 patchAddData 在自动化下会断链，需直连）：**

```js
// 1) zyk 帧取数据
const data = await zyk.evaluate(() => new Promise(res => {
  const ids = document.querySelector('#idspptArr').value;
  const cid = (location.search.match(/courseid=(\d+)/) || [])[1] || '';
  $.post('/zyk2mooc/prep/getDataInfo?ids=' + ids + '&courseId=' + cid + '&type=2&chapterId=', d => res(d));
}));
// 2) coursedata 帧直连入库
await cf.evaluate((d) => new Promise(res => {
  $.ajax({ type:'post', url:'/mooc2-ans/coursedata/add-zyk', dataType:'json',
    data: { courseid:$('#courseid').val(), clazzid:$('#classId').val(), cpi:$('#cpi').val(),
            rootid:$('#rootId').val(), data:d, microTopicId:'0' },
    success: r => res(r) });
}), data);
```

原生链路失败原因：`patchAddData()` 依赖 `parent.postMessage` 触发 coursedata 里的 `handlePostMessage`，
自动化下 zyk 帧的 parent 常不是 coursedata（多包了一层），消息丢失且无错误提示。

**资料库删除**：`li.dataBody_check`（复选框，value=文件 id）与 `li.dataBody_name`（文件名）是**同排兄弟 li**，
匹配时要在"复选框所在的 ul / .dataBody 容器"里找 `.dataBody_name`。

## 8. 其他踩坑

- `window.frames` 不能 `for...of` 迭代 → 用 `page.frames()` 或 `Array.from(window.frames)`。
- Frame 对象没有 `.keyboard`，键盘操作只能用主 `page.keyboard`。
- `page.evaluate` 里不能引用 Node 侧定义的函数/变量（如 `esc()`），必须内联或作为参数传入。
- PPT 下载需带 `Referer: https://mooc1.chaoxing.com/` 防盗链。
- 批量任务一律落盘进度 JSON（本 skill 存 `state/`），支持断点续跑。
