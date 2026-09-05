/**
 * 扫码登录一次，保存登录态（供其余命令复用，通常可用数周）
 * 用法：node cx-login.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, DEFAULT_CHROME, STATE_FILE, wait } from './cx.mjs';

if (!DEFAULT_CHROME) {
  console.error('✗ 未找到 Chrome。请安装 Chrome，或用环境变量 CX_CHROME 指定 chrome.exe 路径');
  process.exit(1);
}
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

const browser = await chromium.launch({
  executablePath: DEFAULT_CHROME,
  headless: false,                       // 必须可见，方便扫码
  args: ['--disable-blink-features=AutomationControlled'],
  ignoreDefaultArgs: ['--enable-automation'],
  locale: 'zh-CN',
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();

console.log('* 正在打开超星登录页，请扫码/密码登录...');
await page.goto('https://passport2.chaoxing.com/login?loginType=1&newversion=true', {
  waitUntil: 'domcontentloaded', timeout: 90000,
}).catch(() => {});

// 轮询检测登录成功（出现课程列表页或个人信息）
let ok = false;
for (let i = 0; i < 120; i++) {
  await wait(2000);
  const url = page.url();
  if (/i\.chaoxing|mooc\d|space|passport.*(index|home)/i.test(url) && !/login/i.test(url)) { ok = true; break; }
  const hasUser = await page.evaluate(() => !!document.querySelector('.head-user, [class*="userInfo"], .userName')).catch(() => false);
  if (hasUser) { ok = true; break; }
}
if (!ok) {
  console.log('* 未自动检测到登录成功，尝试打开我的课程页再确认一次...');
  await page.goto('https://mooc1-2.chaoxing.com/visit/interaction', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await wait(6000);
  ok = !/login/i.test(page.url());
}
if (!ok) {
  console.error('✗ 未检测到登录成功（4 分钟超时），请重试。');
  await browser.close();
  process.exit(1);
}

await ctx.storageState({ path: STATE_FILE });
console.log('* 登录态已保存 ->', STATE_FILE);
await browser.close();
