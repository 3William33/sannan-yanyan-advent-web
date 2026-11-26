# V4 发布与回滚

## 发布

1. 在 `v4-double-cabin-desk` 分支运行 `node --check app.js && node --check backend.js && node --check house.js`。
2. 用虚构数据启动静态服务器，检查桌面端和手机端；不要把 `builtin-gifts.js` 解码内容写入日志或截图。
3. 合并到经过确认的发布分支后部署 GitHub Pages。礼物仓库保持独立，不随网页部署自动改写。

## 回滚

网页回滚只需将 Pages 指向上一个网页提交；浏览器旧存档仍使用 `advent-web-save-v1`，新增字段均为可选，不需要清空存档。若发现本地 V4 草稿异常，只删除 `advent-v4-draft:*` 和 `advent-v4-scrapbook`，不要删除正式存档键。

## 验证矩阵

已完成 JavaScript 语法检查和 diff 空白检查。应在 Chromium/WebKit 实际执行 1920×1080、1440×900、1366×768、1024×768、768×1024、390×844；当前仓库旧 E2E 脚本存在 `/root/work/webrepo` 硬编码路径，需先由维护者修正测试运行器路径后才能作为有效回归结果。

## 架构边界

GitHub Pages 静态站点不能提供真正的服务端秘密保护或安全双向并发写入；现有 XOR+Base64 仍只是混淆，PAT 仅保存在 sessionStorage。回信、收藏和手账草稿当前为浏览器本地数据，不会假装已同步到礼物仓库。
