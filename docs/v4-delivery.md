# Advent V4 交付说明

## 修改范围

- 页面与交互：`index.html`、`app.js`、`advent.css`、`house.js`、`music.js`。
- 数据与同步：`backend.js`、`config.js`。
- 协议与运维：`docs/advent-v4-protocol.md`、`docs/automation-example.json`、`docs/release-v4.md`。
- 美术预留：`art-reference/`。
- 测试：`tests/e2e.py`、`tests/e2e_features.py`、`tests/e2e_fix.py`、`tests/v4_smoke.py`、`tests/mock_data.py`。

## 已交付能力

宽屏双栏圣诞小屋与书桌、移动单栏、非遮罩右侧面板、首次开窗送礼、风琴包与两段拆封、追加礼物提示、手账信纸/贴纸/手势/导出/发布、双面照片编辑阅读导出、漫画五种阅读模式、回信、收藏、邮局、便签、相框、唱片机和 12 月 25 日生日倒计时。

V4 新增字段全部可选，旧礼物无需迁移。照片、漫画、手账嵌套字段会限制长度、数量、枚举、坐标和媒体来源；图片贴纸与相框图片通过 IndexedDB 暂存，发布时按 SHA-256 写入数据仓库资产目录。

书桌状态使用独立 `companion_state.json`，不改变正式礼物封箱与解锁规则。它采用既有混淆摘要、按条目时间戳合并和 GitHub SHA 冲突重试。混淆不是加密，GitHub Pages 仍不存在服务端秘密边界。

## 测试结果

- 完整虚构数据 E2E：43/43。
- 音乐、预览、偷看专项：26/26。
- 显示模式、流畅模式、离线专项：24/24。
- Chromium：1920×1080、1440×900、1366×768、1024×768、768×1024、744×1133、1133×744、390×844 均通过冒烟测试。
- WebKit：测试运行时已准备，但宿主缺少 GTK4、Graphene、Manette、Harfbuzz ICU、Hyphen 和 GLES 系统库，自动化明确跳过。
- 真实 iPad Safari：未实机测试，不能用 WebKit 自动化代替。

所有测试只使用虚构或空礼物。自动化测试不读取、下载、解码或打印真实礼物内容。

## 部署与回滚

开发分支为 `v4-double-cabin-desk`。合并前按 `docs/release-v4.md` 复测。网页回滚只需恢复前一网页提交；旧存档键 `advent-web-save-v1` 保持兼容，不得通过清空存档回滚。
