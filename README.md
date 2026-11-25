# 砚砚 × 三三 · 双人降临历（GitHub Pages 网页版）

> 人和人的距离是一个十二万年。

原版（advent_yansan_v3.2）的静态网页移植版：不需要电脑开机运行 Python，
直接在浏览器里运行，礼物数据仍来自同一个数据仓库。

- 访问地址：https://3william33.github.io/sannan-yanyan-advent-web/
- 礼物数据仓库：https://github.com/3William33/sannan-yanyan-advent-2026 （协议与数据不变，定时任务无需任何修改）

## 与原版的对应关系

| 原版（Python 本机） | 网页版 |
|---|---|
| `advent_game.py` HTTP 接口 | `backend.js` 浏览器端等价实现 |
| `save.json` 本机存档 | 浏览器 `localStorage`（opened / answers / 偷看记录 / 三三礼物） |
| `data/uploads/` 上传暂存 | 浏览器 `IndexedDB`，发布时转存仓库 `assets/sannan/<sha256>.<ext>` |
| DPAPI 保存的 GitHub Token | 仅存在当前标签页 `sessionStorage` 的 Fine-grained PAT，关闭标签页即清除 |
| 砚砚内置礼物（Python 明文） | `builtin-gifts.js` 按 v3.2 协议 XOR+Base64 混淆，解锁后才按天解码 |

## 发布礼物（三三）

1. 在 GitHub 创建 Fine-grained PAT：只勾选 `sannan-yanyan-advent-2026`
   一个仓库的 **Contents: Read and write** 权限。
2. 打开网页 → 「⬆ 发布」→ 粘贴 Token → 「发布」。
   Token 只保存在当前标签页，不写入源码、仓库、URL 或日志。

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
