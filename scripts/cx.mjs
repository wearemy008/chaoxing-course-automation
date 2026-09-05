/**
 * 超星泛雅/学习通 自动化公共库（Playwright）
 * ------------------------------------------------------------
 * 封装本次实战逆向出的全部接口与踩坑解法，供各命令脚本复用。
 *
 * 环境变量：
 *   CX_CHROME  Chrome 可执行路径（默认 agent-browser 下载的 chrome-for-testing）
 *   CX_STATE   登录态 JSON 路径（默认 <skill>/state/auth-state.json）
 *   CX_HEADFUL 设为 1 时显示浏览器窗口（默认无头）
 *   CX_SLOW    设为 1 时延长等待（网络慢时使用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * 解析 playwright-core：优先 skill 自带 node_modules，
 * 其次 CX_PW 环境变量指向的安装目录（换机器/免安装场景）。
 */
async function loadPlaywright() {
  const tries = ['playwright-core', process.env.CX_PW].filter(Boolean);
  for (const t of tries) {
    try {
      const m = await import(t.startsWith('.') || t.includes('\\') || t.includes('/')
        ? pathToFileURL(path.resolve(t)).href : t);
      if (m.chromium) return m;
    } catch {}
  }
  console.error('✗ 未找到 playwright-core。请在 skill 目录执行：npm i playwright-core\n'
    + '  或用环境变量 CX_PW 指向其安装路径。');
  process.exit(1);
}
const PW = await loadPlaywright();
export const chromium = PW.chromium;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = path.resolve(HERE, '..');
export const STATE_FILE = process.env.CX_STATE || path.join(SKILL_DIR, 'state', 'auth-state.json');

/** Chrome 探测：环境变量 > 常见安装位；都找不到时给可操作报错 */
export function findChrome() {
  const cand = [
    process.env.CX_CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : '',
    process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Google\\Chrome\\Application\\chrome.exe') : '',
  ].filter(Boolean);
  for (const p of cand) if (fs.existsSync(p)) return p;
  return null;
}
export const DEFAULT_CHROME = findChrome();

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = process.env.CX_SLOW === '1' ? 1.8 : 1;
export const wait = (ms) => sleep(Math.round(ms * S));

export const log = (...a) => console.log('*', ...a);
export const die = (msg) => { console.error('✗ ' + msg); process.exit(1); };

/** 主域名 */
export const MOOC1 = 'https://mooc1.chaoxing.com';
export const MOOC2 = 'https://mooc2-ans.chaoxing.com';

/* ------------------------------------------------------------------ */
/* 浏览器与登录态                                                       */
/* ------------------------------------------------------------------ */

export function requireState() {
  if (!fs.existsSync(STATE_FILE)) {
    die(`未找到登录态文件：${STATE_FILE}\n请先运行：node cx-login.mjs  （扫码登录一次，之后自动复用）`);
  }
}

export async function launch() {
  requireState();
  if (!DEFAULT_CHROME) die('未找到 Chrome。请安装 Chrome，或用环境变量 CX_CHROME 指定 chrome.exe 路径');
  return chromium.launch({
    executablePath: DEFAULT_CHROME,
    headless: process.env.CX_HEADFUL !== '1',
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
}

export async function newPage(browser) {
  const ctx = await browser.newContext({
    storageState: STATE_FILE,
    viewport: { width: 1680, height: 1050 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return page;
}

/* ------------------------------------------------------------------ */
/* 课程导航                                                             */
/* ------------------------------------------------------------------ */

export function homeUrl(courseId, cpi) {
  return `${MOOC1}/course/isNewCourse?courseId=${courseId}&edit=true&v=2&cpi=${cpi}&pageHeader=-1&single=0`;
}

/**
 * 进课程主页，返回 { courseId, clazzId, cpi, enc, bbsid, openc }
 * 主页会 302 到 mooc2-ans/mycourse/tch，三件套与 enc 都在隐藏 input 里。
 */
export async function gotoHome(page, courseId, cpi) {
  await page.goto(homeUrl(courseId, cpi), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await wait(9000);
  const meta = await page.evaluate(() => {
    const g = (id) => { const e = document.getElementById(id); return e ? (e.value || '') : ''; };
    const q = (k) => (location.search.match(new RegExp(k + '=([^&]+)')) || [])[1] || '';
    return {
      courseId: g('courseid') || q('courseid'),
      clazzId: g('clazzid') || q('clazzid'),
      cpi: g('cpi') || q('cpi'),
      enc: g('enc') || q('enc'),
      bbsid: g('bbsid'),
      openc: g('openc'),
    };
  });
  if (!meta.enc) throw new Error('未取到 enc（登录态可能失效，请重新 node cx-login.mjs）');
  return meta;
}

/** 未显式传 --clazz 时，自动从课程主页补 clazzId */
export async function resolveClazz(page, courseId, clazzId, cpi) {
  if (clazzId) return clazzId;
  const m = await gotoHome(page, courseId, cpi);
  if (!m.clazzId) die('未能自动获取 clazzId，请显式传 --clazz=<clazzId>');
  log('自动补全 clazzId =', m.clazzId);
  return m.clazzId;
}

/** 点击左侧菜单（事件委托，必须走 a[data-url]） */
export async function clickMenu(page, name) {
  return page.evaluate((n) => {
    const a = Array.from(document.querySelectorAll('a[data-url]'))
      .find((e) => (e.innerText || '').trim().replace(/​/g, '') === n);
    if (!a) return false;
    a.click();
    return true;
  }, name);
}

/** 等待某个 iframe 出现，返回 Frame 对象 */
export async function waitFrame(page, match, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const f = page.frames().find((fr) => fr.url().includes(match));
    if (f) return f;
    await wait(2000);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 课程列表                                                             */
/* ------------------------------------------------------------------ */

/**
 * 课程列表。唯一稳定入口是个人空间 i.chaoxing.com/base?t=course
 * （mooc1/mooc2-ans 的 mycourse 列表页会 404 或被踢到登录页）。
 * 真实列表在 iframe /visit/interaction 里。
 */
export async function listCourses(page) {
  await page.goto('https://i.chaoxing.com/base?t=course&folder=0', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await wait(8000);
  const f = await waitFrame(page, 'interaction', 10);
  if (!f) throw new Error('未加载课程列表（登录态失效？请重新 node cx-login.mjs）');
  const items = await f.evaluate(() => {
    const out = [];
    document.querySelectorAll('a[href*="isNewCourse"]').forEach((a) => {
      const m = a.href.match(/courseId=(\d+)/i);
      const c = a.href.match(/cpi=(\d+)/i);
      const name = (a.innerText || '').trim();
      if (m && name) out.push({ name: name.slice(0, 40), courseId: m[1], cpi: c ? c[1] : '' });
    });
    return out;
  });
  const seen = new Set();
  return items.filter((x) => { if (seen.has(x.courseId)) return false; seen.add(x.courseId); return true; });
}

/* ------------------------------------------------------------------ */
/* 章节树                                                               */
/* ------------------------------------------------------------------ */

/** 读取章节树：返回 [{no, text, knowledgeId}]（no 形如 1.1） */
export async function getChapters(page, courseId, clazzId, cpi) {
  const { enc } = await gotoHome(page, courseId, cpi);
  await clickMenu(page, '章节');
  let f = await waitFrame(page, 'tchcourse');
  if (!f) throw new Error('未打开章节页');
  await wait(6000);
  const raw = await f.evaluate(() => Array.from(document.querySelectorAll('[class*="catalog_name"]'))
    .map((e) => ({ text: (e.innerText || '').trim(), knowledgeId: e.getAttribute('data-knowledgeid') || e.id || '' })));
  // knowledgeId 常在父级 li 上，二次兜底
  const withIds = await f.evaluate(() => {
    const out = [];
    document.querySelectorAll('li,div').forEach((e) => {
      const t = (e.innerText || '').trim();
      if (!t || t.length > 60) return;
      const kid = e.querySelector('[data-knowledgeid]');
      const id = kid ? kid.getAttribute('data-knowledgeid') : (e.getAttribute('data-knowledgeid') || '');
      const m = t.match(/^(\d+\.\d+)[\s、]*(.+)$/);
      if (m && id) out.push({ no: m[1], text: m[2].slice(0, 50), knowledgeId: id });
    });
    return out;
  });
  const merged = withIds.length ? withIds : raw.filter((r) => /^\d+\.\d+/.test(r.text)).map((r) => ({ no: r.text.slice(0, 4), text: r.text, knowledgeId: r.knowledgeId }));
  return { enc, chapters: merged };
}

/* ------------------------------------------------------------------ */
/* 章节正文读写（安全追加策略）                                          */
/* ------------------------------------------------------------------ */

export function chapterEditUrl(courseId, nid, clazzId, cpi) {
  return `${MOOC1}/edit/chapters/${courseId}/${nid}?classId=${clazzId}&cpi=${cpi}&newMooc=true&mooc2=1`;
}

/**
 * 写入章节正文：
 *   - 已含 marker → 跳过（幂等）
 *   - 正文为空   → 直接写
 *   - 正文非空   → <hr/> 追加（绝不覆盖，保护已上传课件）
 * 返回 {mode, saved}
 */
export async function writeChapter(page, courseId, nid, clazzId, cpi, html, marker) {
  const url = chapterEditUrl(courseId, nid, clazzId, cpi);
  const p = await page.context().newPage();
  try {
    const savecardDone = new Promise((resolve) => {
      const handler = async (res) => {
        if (res.url().includes('/mooc-ans/edit/savecard')) {
          let body = '';
          try { body = await res.text(); } catch {}
          p.off('response', handler);
          resolve({ status: res.status(), body: body.slice(0, 200) });
        }
      };
      p.on('response', handler);
      setTimeout(() => resolve(null), 25000);
    });

    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(7000);

    const r = await p.evaluate(({ html, marker }) => {
      try {
        const ed = window.UE.instants.ueditorInstant0;
        const old = ed.getContent() || '';
        const plain = (ed.getContent({ plain: true }) || '').trim();
        let finalHtml = html;
        let mode = 'write';
        if (old.includes(marker)) mode = 'skip';
        else if (plain.length > 5) { finalHtml = old + '<hr/>' + html; mode = 'append'; }
        if (mode !== 'skip') ed.setContent(finalHtml);
        return { mode, oldLen: plain.length };
      } catch (e) { return { mode: 'error', err: e.message }; }
    }, { html, marker });

    if (r.mode === 'error') throw new Error(r.err);
    if (r.mode === 'skip') return { mode: 'skip', saved: false };

    await p.locator('a.ans-save-btn').first().click({ timeout: 15000 });
    const res = await savecardDone;
    if (res && res.status === 200) return { mode: r.mode, saved: true };
    throw new Error('保存失败: ' + (res ? res.body : '超时'));
  } finally {
    await p.close().catch(() => {});
  }
}

/** 读取章节正文（含是否含课件 iframe 的判断） */
export async function readChapter(page, courseId, nid, clazzId, cpi) {
  const p = await page.context().newPage();
  try {
    await p.goto(chapterEditUrl(courseId, nid, clazzId, cpi), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await wait(6000);
    return p.evaluate(() => {
      try {
        const ed = window.UE.instants.ueditorInstant0;
        const c = ed.getContent() || '';
        return { len: c.length, hasPPT: /taskIframe|ans-attach-online/.test(c), snippet: c.slice(0, 200) };
      } catch (e) { return { err: e.message }; }
    });
  } finally { await p.close().catch(() => {}); }
}

/* ------------------------------------------------------------------ */
/* 题库                                                                 */
/* ------------------------------------------------------------------ */

export function tikuUrl(courseId, clazzId, enc, cpi) {
  return `${MOOC2}/mooc2-ans/qbank/questionlist?courseid=${courseId}&clazzid=${clazzId}&enc=${enc}&cpi=${cpi}&ut=t`;
}

/** 进入「智能导入」页 */
export async function gotoSmartImport(page, courseId, clazzId, cpi) {
  const { enc } = await gotoHome(page, courseId, cpi);
  await page.goto(tikuUrl(courseId, clazzId, enc, cpi), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await wait(8000);
  await page.locator('.insert.mapEdit, :text("批量导入")').first().click({ timeout: 15000 });
  await wait(2000);
  await page.locator(':text-is("智能导入")').first().click({ timeout: 10000 });
  await wait(8000);
  return enc;
}

/**
 * 识别并导入一章题本到指定章节文件夹。
 * ⚠ 关键：编辑区是 Vue 组件，只能 textContent 写纯文本（含 \n），
 *         用 innerHTML / insertText 会被压成一行，服务端只识别出 1 题。
 */
export async function importQuiz(page, courseId, clazzId, cpi, file, folderName, expect) {
  const content = fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
  const wr = await page.evaluate((c) => {
    const eb = document.querySelector('.editbox');
    if (!eb) return { err: 'no editbox' };
    eb.focus();
    eb.textContent = c;
    return { lines: eb.textContent.split('\n').length };
  }, content);
  if (wr.err) throw new Error(wr.err);
  await wait(800);

  // 点「识别」：选最内层、文本严格等于"识别"的元素
  const clicked = await page.evaluate(() => {
    const cands = Array.from(document.querySelectorAll('button, a, div, span')).filter((e) => {
      if (e.offsetParent === null) return false;
      if ((e.innerText || '').trim() !== '识别') return false;
      const r = e.getBoundingClientRect();
      return r.width < 200 && r.height < 80 && e.children.length <= 2;
    });
    if (!cands.length) return false;
    cands.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    cands[0].click();
    return true;
  });
  if (!clicked) throw new Error('未找到「识别」按钮');
  await wait(2500);
  // 确认弹窗 → doReparse → POST /sqp/api/parse
  await clickVisible(page, '.jb_btn', '确定');
  await wait(1000);

  let cnt = -1;
  for (let i = 0; i < 15; i++) {
    await wait(3000);
    cnt = await page.evaluate(() => {
      const m = document.body.innerText.match(/共识别\s*(\d+)\s*题/);
      return m ? Number(m[1]) : -1;
    });
    if (cnt >= 0) break;
  }
  if (cnt <= 0) throw new Error('识别失败 cnt=' + cnt);
  const expectN = expect || (content.match(/^\d+\./gm) || []).length;
  if (cnt !== expectN) log(`  注意：识别 ${cnt} 题，题本 ${expectN} 题`);

  // 加入题库
  const joinOk = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button,a,.jb_btn,[onclick],div,span')).filter((e) => {
      if (e.offsetParent === null) return false;
      if ((e.innerText || '').trim() !== '加入题库') return false;
      return e.querySelectorAll('*').length <= 3 && e.getBoundingClientRect().width < 300;
    });
    if (!btn.length) return false;
    btn.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    btn[0].click();
    return true;
  });
  if (!joinOk) throw new Error('未找到「加入题库」按钮');
  await wait(4000);

  // 选章文件夹（目录树异步加载，必须轮询）
  let sel = 'not-found';
  if (folderName) {
    for (let i = 0; i < 10; i++) {
      await wait(2000);
      sel = await page.evaluate((fname) => {
        const pop = Array.from(document.querySelectorAll('.popDiv, [class*="popMove"]'))
          .find((e) => e.offsetParent !== null && (e.innerText || '').includes('选择目录'));
        if (!pop) return 'no-pop';
        const nodes = Array.from(pop.querySelectorAll('li[dirid] .popMove_text'))
          .filter((e) => (e.innerText || '').trim() === fname);
        if (!nodes.length) return 'no-node';
        (nodes[0].closest('.popMove_name') || nodes[0]).click();
        return 'ok';
      }, folderName);
      if (sel === 'ok') break;
    }
    if (sel !== 'ok') log(`  未选中文件夹[${folderName}]（${sel}），将导入到根目录`);
    await wait(1500);
  }

  await clickVisible(page, '.jb_btn', '确定');   // checkDirectory
  await wait(5000);
  await clickVisible(page, '.jb_btn, button, a', '确定');  // 二级确认
  await wait(5000);
  return cnt;
}

/** 题库页：读取文件夹与题数 */
export async function readTiku(page, courseId, clazzId, cpi) {
  const { enc } = await gotoHome(page, courseId, cpi);
  await page.goto(tikuUrl(courseId, clazzId, enc, cpi), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await wait(8000);
  return page.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, ' ');
    const total = (t.match(/共\s*(\d+)\s*题/) || [])[1];
    const folders = [];
    const re = /(第\d+章)\s*公开\s*共\s*(\d+)\s*题/g;
    let m;
    while ((m = re.exec(t))) folders.push({ name: m[1], n: Number(m[2]) });
    return { total, folders };
  });
}

/* ------------------------------------------------------------------ */
/* 讨论区                                                               */
/* ------------------------------------------------------------------ */

/** 从菜单进讨论区（bbsid/openc 只能这样拿到，直接拼 URL 会报非法请求） */
export async function gotoTopicFrame(page, courseId, cpi) {
  await gotoHome(page, courseId, cpi);
  await clickMenu(page, '讨论');
  const f = await waitFrame(page, 'topicList');
  if (f) await wait(3000);
  return f;
}

export async function createTopic(bf, title, content) {
  await bf.locator('a.createTopic').first().click({ timeout: 15000 });
  await wait(5000);
  await bf.fill('input[name="title"]', title);
  await wait(800);
  const html = content.split('\n').filter((l) => l.trim())
    .map((l) => '<p>' + l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>').join('');
  const ok = await bf.evaluate((h) => {
    try { window.UE.instants.ueditorInstant0.setContent(h); return true; } catch (e) { return false; }
  }, html);
  if (!ok) throw new Error('正文写入失败');
  await wait(1500);
  const pub = await bf.evaluate(() => {
    const c = Array.from(document.querySelectorAll('div.jb_btn, a.jb_btn'))
      .filter((e) => (e.innerText || '').trim() === '发布' && e.offsetParent !== null);
    if (!c.length) return false;
    c[0].click();
    return true;
  });
  if (!pub) throw new Error('未找到「发布」按钮');
  await wait(5000);
  await bf.evaluate(() => {
    const vis = Array.from(document.querySelectorAll('.jb_btn')).filter((e) => (e.innerText || '').trim() === '确定' && e.offsetParent !== null);
    if (vis.length) vis[vis.length - 1].click();
  });
  await wait(4000);
  return true;
}

/* ------------------------------------------------------------------ */
/* 资料库 / 平台教学资源库                                              */
/* ------------------------------------------------------------------ */

/** 打开「添加资料 → 教学资源库」弹窗内的 zyk 帧 */
export async function openZyk(page, courseId, cpi, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      await gotoHome(page, courseId, cpi);
      await page.locator('li a[data-url="/mooc2-ans/coursedata"], :text-is("资料")').first().click({ timeout: 10000 });
      await wait(8000);
      const cf = page.frames().reverse().find((f) => f.url().includes('coursedata'));
      if (!cf) throw new Error('no coursedata frame');
      await cf.locator('text=添加资料').first().click({ timeout: 10000 });
      await wait(2500);
      await cf.locator('text=教学资源库').first().click({ timeout: 10000 });
      let zyk = null;
      for (let k = 0; k < 8; k++) {
        await wait(2000);
        zyk = page.frames().reverse().find((f) => f.url().includes('fanyazyk2'));
        if (zyk) break;
      }
      if (!zyk) throw new Error('no zyk frame');
      await zyk.locator('text=教学资源库').first().click({ timeout: 10000 });
      await wait(5000);
      return { zyk, cf };
    } catch (e) {
      log('openZyk 重试', i + 1, e.message.slice(0, 80));
      await wait(3000);
    }
  }
  throw new Error('打开教学资源库失败');
}

/** 搜索关键词（搜索按钮是 a.zyk_search_bnt → searchmooc()） */
export async function zykSearch(zyk, kw) {
  const r = await zyk.evaluate((k) => {
    const inp = document.querySelector('#title');
    if (!inp) return 'no-input';
    inp.value = k;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof searchmooc === 'function') { searchmooc(); return 'ok'; }
    const btn = document.querySelector('a.zyk_search_bnt');
    if (btn) { btn.click(); return 'ok'; }
    return 'no-btn';
  }, kw);
  await wait(6000);
  return r;
}

/** 进入某课程的资源列表，返回资源条数 */
export async function zykOpenCourse(zyk, courseName) {
  await zyk.evaluate((cn) => { getdatalist('教学资源库', '/zyk2mooc/prep/getKcResourceData', cn); }, courseName);
  for (let i = 0; i < 8; i++) {
    await wait(2500);
    const n = await zyk.evaluate(() => document.querySelectorAll('li.resultBody_cont').length);
    if (n > 0) return n;
  }
  return 0;
}

/**
 * 勾选并入库。
 * ⚠ 要点内层 input[name=checkbox_ppt]（写 #idspptArr），外层 span.zyk_check 只切样式。
 * ⚠ 页面原生 patchAddData 的跨帧 postMessage 在自动化下断链，改为直连
 *   coursedata 帧的 POST /mooc2-ans/coursedata/add-zyk。
 */
export async function zykPickAndAdd(page, zyk, cf, maxN, existingTitles = []) {
  const picked = await zyk.evaluate(({ mx, existing }) => {
    const hrefs = Array.from(document.querySelectorAll('a.resultBody_href')).filter((e) => e.offsetParent !== null);
    const inputs = Array.from(document.querySelectorAll('input[name="checkbox_ppt"]'));
    const out = [];
    for (let i = 0; i < inputs.length && out.length < mx; i++) {
      const title = (hrefs[i] ? hrefs[i].innerText : '').trim();
      if (!title || existing.includes(title)) continue;
      if (!inputs[i].checked) { inputs[i].click(); out.push(title); }
    }
    return out;
  }, { mx: maxN, existing: existingTitles });
  if (!picked.length) return { err: '无可勾选资源' };

  const ids = await zyk.evaluate(() => (document.querySelector('#idspptArr') || {}).value || '');
  if (!ids) return { err: '选中态未登记(#idspptArr 为空)' };

  const payload = await zyk.evaluate(() => new Promise((resolve) => {
    const ids = document.querySelector('#idspptArr').value;
    const cid = (location.search.match(/courseid=(\d+)/) || [])[1] || '';
    $.post('/zyk2mooc/prep/getDataInfo?ids=' + ids + '&courseId=' + cid + '&type=2&chapterId=', (data) => resolve({ data }))
      .fail(() => resolve({ err: 'getDataInfo failed' }));
    setTimeout(() => resolve({ err: 'getDataInfo timeout' }), 15000);
  }));
  if (payload.err) return { err: payload.err };

  const res = await cf.evaluate((d) => new Promise((resolve) => {
    $.ajax({
      type: 'post', url: '/mooc2-ans/coursedata/add-zyk', dataType: 'json',
      data: {
        courseid: $('#courseid').val(), clazzid: $('#classId').val(), cpi: $('#cpi').val(),
        rootid: $('#rootId').val(), data: d, microTopicId: '0',
      },
      success: (r) => resolve({ status: r.status, msg: r.msg }),
      error: () => resolve({ status: false, msg: 'ajax error' }),
    });
    setTimeout(() => resolve({ status: false, msg: 'timeout' }), 20000);
  }), payload.data);
  if (!res.status) return { err: 'add-zyk: ' + res.msg };
  return { picked };
}

/** 读取资料库文件列表 */
export async function readZiliao(page, courseId, cpi) {
  await gotoHome(page, courseId, cpi);
  await page.locator('li a[data-url="/mooc2-ans/coursedata"], :text-is("资料")').first().click({ timeout: 10000 });
  await wait(9000);
  const cf = page.frames().reverse().find((f) => f.url().includes('coursedata'));
  if (!cf) throw new Error('未打开资料页');
  return cf.evaluate(() => {
    const names = [];
    document.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      if (cb.closest('.dataHead')) return;
      const c = cb.closest('ul') || cb.closest('.dataBody') || cb.parentElement.parentElement;
      if (!c) return;
      const ne = c.querySelector('.dataBody_name');   // 复选框与文件名是同排兄弟 li
      if (ne && ne.innerText.trim()) names.push(ne.innerText.trim());
    });
    return names;
  });
}

/* ------------------------------------------------------------------ */
/* 通用小工具                                                           */
/* ------------------------------------------------------------------ */

/** 点击可见的、文本严格等于指定值的按钮（通常取最后一个，避免点到隐藏层） */
export async function clickVisible(pageOrFrame, selector, text) {
  return pageOrFrame.evaluate(({ sel, txt }) => {
    const vis = Array.from(document.querySelectorAll(sel)).filter((e) => (e.innerText || '').trim() === txt && e.offsetParent !== null);
    if (!vis.length) return false;
    vis[vis.length - 1].click();
    return true;
  }, { sel: selector, txt: text });
}

/** 进度文件读写（支持断点续跑） */
export function progress(file) {
  const p = path.join(SKILL_DIR, 'state', file);
  const data = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : {};
  return {
    data,
    save: () => fs.writeFileSync(p, JSON.stringify(data, null, 1), 'utf-8'),
    has: (k) => !!data[k],
    set: (k, v) => { data[k] = v; fs.writeFileSync(p, JSON.stringify(data, null, 1), 'utf-8'); },
  };
}

/** 解析命令行 --key=value 与位置参数 */
export function args(argv = process.argv.slice(2)) {
  const o = { _: [] };
  argv.forEach((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) o[m[1]] = m[2];
    else if (a.startsWith('--')) o[a.slice(2)] = true;
    else o._.push(a);
  });
  return o;
}
