# 砚砚 × 三三 · 双人降临历（GitHub Pages 网页版）

> 人和人的距离是一个十二万年。

原版（advent_yansan_v3.2）的静态网页移植版：不需要电脑开机运行 Python，
直接在浏览器里运行，礼物数据仍来自同一个数据仓库。

当前代码版本为 `8.2.1`（V4 UI、收藏馆、日期权限与圣诞邮局迭代版）；正式 Pages 是否已更新以实际部署为准。

## 双人身份、收藏馆与邮局

- 默认写礼物身份是三三；在地址后加 `?writer=yan` 切换为砚砚。写入身份与顶栏“偷看记名”相互独立。
- 书桌双方礼物堆和「礼物收藏馆」共用权威礼物数据，可按作者、日期、类型、状态与关键词筛选，不建立第二份礼物清单。
- 未解锁的对方礼物在收藏馆只显示安全元数据；浏览不会开盒、增加偷看或读取正文/附件。
- 「圣诞邮局」展示真实成功操作产生的永久时间线，支持筛选、增量加载、双方独立未读与通知跳转；活动只存安全元数据，不含正文或附件。
- 12 月 26 日前，双方可新增、修改或删除自己尚未正式封存的 1–25 日普通礼物，包括已过去的日期；12 月 24/25 日的内置特别结局仍只读，12 月 26 日起完整只读。
- 日期与作者权限在实际写入 API 中校验。GitHub Pages 属于静态站点，这不能构成服务端秘密边界。

详细协议、测试与发布边界见 `docs/advent-v4-protocol.md`、`docs/v4-delivery.md` 和 `docs/release-v4.md`。

- 访问地址：https://3william33.github.io/sannan-yanyan-advent-web/
- 礼物数据仓库：https://github.com/3William33/sannan-yanyan-advent-2026 （协议与数据不变，定时任务无需任何修改）

## 与原版的对应关系

| 原版（Python 本机） | 网页版 |
|---|---|
| `advent_game.py` HTTP 接口 | `backend.js` 浏览器端等价实现 |
| `save.json` 本机存档 | 浏览器 `localStorage`（opened / answers / 偷看记录 / 三三礼物） |
| `data/uploads/` 上传暂存 | 浏览器 `IndexedDB`，发布时转存仓库 `assets/sannan/<sha256>.<ext>` |
| DPAPI 保存的 GitHub Token | Fine-grained PAT 默认仅存在当前标签页 `sessionStorage`；只有主动勾选“记住”才明文存入本机 `localStorage` |
| 砚砚内置礼物（Python 明文） | `builtin-gifts.js` 按 v3.2 协议 XOR+Base64 混淆，解锁后才按天解码 |

## 发布礼物（三三）

1. 在 GitHub 创建 Fine-grained PAT：只勾选 `sannan-yanyan-advent-2026`
   一个仓库的 **Contents: Read and write** 权限。
2. 打开网页 → 「⬆ 发布」→ 粘贴 Token → 「发布」。Token 不写入源码、仓库、URL 或日志。
3. 默认关闭标签页即清除。若勾选「在这台设备记住」，Token 会明文保存在该浏览器的
   `localStorage`；这只省去重复输入，不是安全凭证库。可随时点击「清除本机 Token」。

## 隐私说明

- 礼物内容（含 12月24/25 特别礼物）与远程 `gifts.json` 一样，采用 XOR + Base64
  混淆存放在 `builtin-gifts.js` 中——这是防止公开仓库被直接阅读的混淆，不是加密。
- 解锁规则（北京时间 12月N日 00:00 起）在浏览器端执行，属于交互层限制，
  与原版本机运行时的性质相同，不构成服务器端安全边界。
- 顶栏「偷看记名」切换偷看事件归属（三三/砚砚），与原版 `peek_log.json` 的 `who` 字段兼容。

## 构建

`tools/build_builtin.py` 用于从原版 `advent_game.py` 重新生成 `builtin-gifts.js`：

```bash
python3 tools/build_builtin.py <原版advent_game.py> builtin-gifts.js <砚砚密钥>
```

明文礼物不会进入本仓库。

## 素材与许可

房子图片、CSS 动画、小星星精灵来自
[advent-for-two](https://github.com/lucienkeke-jj/advent-for-two)（CC BY-NC 4.0）。
ABC 五线谱由 [abcjs](https://www.abcjs.net/) 6.4.4 提供（MIT）。
