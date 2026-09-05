# CHANGELOG

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
- 资源入库依赖逆向接口 `POST /mooc2-ans/coursedata/add-zyk`，平台改版需重新逆向（见 `references/api.md` 第 7 节）
