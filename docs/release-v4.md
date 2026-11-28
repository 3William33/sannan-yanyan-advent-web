# V4 / 8.2.1 发布与回滚

## 发布前

1. 在当前发布分支运行 `node --check app.js && node --check backend.js && node --check house.js && node --check music.js && node --check stickers.js`。
2. 运行 `tests/v4_archive_e2e.py`、`tests/v8_e2e.py`、`tests/e2e.py`、`tests/sticker_e2e.py` 和 `tests/v4_smoke.py`。测试服务只使用虚构数据与本地模拟 Contents API。
3. 检查桌面、手机和 WebKit 自动化截图，确认编辑器、收藏馆、邮局没有横向溢出，浮层不超过 `88dvh`，夜间主题无纯白或纯黑区块。
4. 不得把 `builtin-gifts.js` 解码内容、PAT、真实未揭晓礼物正文或附件写入日志、截图、提交和发布说明。
5. 明确确认网页提交与发布目标后再合并、推送和部署。礼物仓库保持独立，不随网页部署自动改写。

## 当前验证记录

Windows 11 + Node.js 24 环境已完成 JavaScript 语法检查、Python 测试编译、`git diff --check` 和以下自动化：

- V4 收藏馆、邮局、日期权限、挂件层级与双人同步：49/49。
- V8：Chromium 45/45。
- 完整 E2E：52/52。
- 贴纸/导出/指南：Chromium 与 WebKit 合计 48/48。
- 音乐/预览/偷看：26/26。
- 显示模式/流畅模式/离线：24/24。
- 同步容错：4/4。
- Chromium 与 WebKit 八种视口响应式冒烟通过。

本次没有真实 iPad Safari 实机结果，WebKit 自动化不能替代实机验收。8.2.0 已提交并推送至 `origin/main`；8.2.1 修正的提交与推送状态以最终交付记录为准。正式线上礼物数据未被读取或改写。

## 回滚

网页回滚只需恢复 Pages 指向的上一网页提交。浏览器旧存档仍使用 `advent-web-save-v1`，新增字段均为可选，不需要清空存档。

如确认本地 V4 草稿损坏，可只删除 `advent-v4-draft:*`、`advent-v4-edit:*` 和 `advent-v4-scrapbook`。不得删除正式存档键、`gift_events.json`、双方礼物文件、索引或 tombstone，也不得通过重置仓库数据回滚网页。

## 架构边界

GitHub Pages 不能提供服务端秘密保护或服务端强并发写入。当前 XOR+Base64 只是混淆，写入权限在实际浏览器数据 API 中集中校验，正常客户端不能绕过；自行修改客户端代码仍可绕过交互层，这不是服务器安全边界。

回信、收藏、便签、相框与手账草稿沿用各自既有存储/同步方式，不把仅本地状态伪装成已同步。PAT 默认仅存 `sessionStorage`，主动记住时明文存于当前设备 `localStorage`，不是安全凭证库。
