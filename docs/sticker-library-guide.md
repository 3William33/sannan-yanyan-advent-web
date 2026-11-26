# 圣诞贴纸素材库 · AI 自动化操作手册

> 供「梁砚舟」的 Chat / Work 定时任务读取。目标：让 AI 能仅凭本文件与素材索引，独立挑选贴纸、生成合法的手账（scrapbook）礼物，并验证资源可用。
> 本手册所有路径、URL、色值、字段均来自当前线上索引与当前网页代码实际支持的字段；示例中的素材均真实存在。

---

## 1. 素材索引访问地址（准确）

- 数据仓库：`3William33/sannan-yanyan-advent-2026`，分支 `main`。
- 索引（富元数据，唯一权威来源）：
  `https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/sticker_index.json`
- 索引结构：`schema = advent-sticker-index-v1`，顶层含 `palettes`、`categories`、`subcategories`、`patterns`、`stickers`。
  - `patterns`：62 种图案，每种含 `pattern_id`、`name_zh`、`name_en`、`category`、`subcategory`、`description`、`tags`、`sticker_ids`。
  - `stickers`：328 枚具体贴纸，每枚含下方字段；`pattern_id` 把同图案的不同配色关联起来，`variants` 列出同图案其余配色的 `id`。

**每枚贴纸字段：** `id`（唯一）、`pattern_id`、`name_zh` / `name_en`、`pattern_name_zh` / `pattern_name_en`、`category`、`category_name_zh`、`subcategory`、`color`、`color_name_zh`、`color_name_en`、`color_hex`、`width`、`height`、`path`（相对 `assets/stickers/`）、`raw_url`（可直接访问）、`tags`、`description`、`search_text`、`variants`、`variant_count`。

读取示例（Python）：

```python
import json, urllib.request
url = "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/sticker_index.json"
idx = json.load(urllib.request.urlopen(url))
by_id = {s["id"]: s for s in idx["stickers"]}
s = by_id["doodles-bear-wine"]
print(s["raw_url"], s["width"], s["height"], s["description"])
```

> 重要：**同图案的八种颜色不是八种不同图案**。`postmarks` 与 `doodles` 下每个图案都有 8 个配色变体，共享同一个 `pattern_id`。需要换色时，从该贴纸的 `variants`（或按 `pattern_id` 过滤）里选，不要当成新图案。

---

## 2. 素材目录与分类说明

根目录：`assets/stickers/`。保留原始四类：

| 分类 key | 中文 | 目录 | 数量 | 说明 |
| --- | --- | --- | --- | --- |
| `christmas` | 圣诞 | `assets/stickers/christmas/` | 17 | 圣诞彩球、铃铛、拐杖糖、姜饼人、信纸边框、花体字、围巾、雪人等，均为原色 |
| `celebration` | 庆祝 | `assets/stickers/celebration/` | 7 | 蛋糕、礼物堆、金色驯鹿、雪人、三角贺卡等，均为原色 |
| `postmarks` | 邮戳 | `assets/stickers/postmarks/<配色>/` | 40 | 5 种图案 × 8 配色：日期邮戳、圆形邮戳、雪花邮戳、波浪邮戳、波浪纹 |
| `doodles` | 涂鸦 | `assets/stickers/doodles/<配色>/` | 264 | 33 种图案 × 8 配色：动物、植物、食物、装饰等线稿 |

- 所有图片均为**透明背景 PNG**（RGBA）。原色素材保留原作者配色；线稿素材为灰度透明叠加八色。
- 素材来源与授权见数据仓库 `LICENSES.md`：素材提供者已确认全部为已授权、免费非商用素材；作者与具体许可证名称未提供，不虚构。AI 引用授权信息时以 `LICENSES.md` 为准，不得编造作者或许可证名称。

---

## 3. 全部可用配色及色值

| color key | 配色名 | 色值 | 适用 |
| --- | --- | --- | --- |
| `ink` | 墨黑 | `#202020` | postmarks / doodles |
| `sepia` | 棕褐 | `#79533b` | postmarks / doodles |
| `wine` | 酒红 | `#842d46` | postmarks / doodles |
| `pine` | 松绿 | `#285b46` | postmarks / doodles |
| `peacock` | 孔雀蓝 | `#167c83` | postmarks / doodles |
| `mist_blue` | 雾蓝 | `#6885a0` | postmarks / doodles |
| `rose` | 玫瑰粉 | `#b66b83` | postmarks / doodles |
| `gold` | 暖金 | `#b68b40` | postmarks / doodles |
| `original` | 原色 | 无固定色值 | christmas / celebration |

`christmas`、`celebration` 两类的 `color` 均为 `original`，`color_hex` 为 `null`；换配色请改用 `postmarks` / `doodles`。

---

## 4. 如何通过索引寻找指定图案

1. **按图案名**：在 `patterns` 里找 `name_zh` / `name_en` 含关键词（如「雪人」「bear」「邮戳」），得到 `pattern_id` 与 `sticker_ids`。
2. **按标签**：`patterns[].tags` 与 `stickers[].search_text` 已包含中文名、英文名、子分类与视觉描述关键词，可做子串匹配。
3. **按配色**：在 `stickers` 里过滤 `color == 目标配色`，再按 `pattern_id` 聚合。
4. **按主题**：用 `subcategory` 过滤（动物 / 植物 / 食物 / 装饰 / 邮戳 / 人物 / 边框 / 文字 / 服饰 / 礼物 / 甜点 / 糖果）。

```python
def find(idx, keyword=None, color=None, subcategory=None, category=None):
    out = []
    for s in idx["stickers"]:
        if keyword and keyword.lower() not in s["search_text"].lower(): continue
        if color and s["color"] != color: continue
        if subcategory and s["subcategory"] != subcategory: continue
        if category and s["category"] != category: continue
        out.append(s)
    return out

# 例：找孔雀蓝的动物线稿
for s in find(idx, color="peacock", subcategory="动物"):
    print(s["pattern_name_zh"], s["raw_url"])
```

> 视觉描述（`description`）准确具体，无法看图时据此判断：如 `doodles-bear` 是「坐姿小熊，身旁点缀小星星」，`postmarks-date_stamp` 是「圆形邮戳，中间两条横线用于填写日期」。

---

## 5. 如何按主题选贴纸

| 信纸 / 主题 | 推荐 `paper` | 推荐贴纸（pattern_id） | 配色建议 |
| --- | --- | --- | --- |
| 复古邮戳信件 | `cream` / `kraft` | `postmarks-date_stamp`、`postmarks-round_stamp`、`christmas-letter_frame` | `sepia` / `wine` |
| 圣诞手账 | `botanical` / `snow` | `christmas-tree_small`、`christmas-snowman_small`、`doodles-fireworks` | `pine` / `wine` / `gold` |
| 生日贺卡 | `cream` | `celebration-blue_cake`、`celebration-gift_pile`、`doodles-hearts` | `rose` / `gold` |
| 黑白动物日记 | `grid` / `blank` | `doodles-cat`、`doodles-bear`、`doodles-rabbit_pair` | `ink` |
| 孔雀蓝主题书信 | `snow` / `blank` | `postmarks-wave_stamp`、`doodles-sprig`、`doodles-stars` | `peacock` |
| 双面照片组合 | `cream` | `christmas-letter_frame` 做角饰 + `doodles-sparkles` | `gold` / `rose` |

选型原则：线稿（`postmarks` / `doodles`）适合压在文字旁做点缀；原色素材（`christmas` / `celebration`）适合做主体装饰。同一封信配色不超过 2–3 种，保持统一。

---

## 6. 通过 scrapbook 协议添加贴纸（当前代码实际支持字段）

礼物条目格式遵循 `docs/advent-v4-protocol.md`（`protocol: advent-gifts-v3.2`）。网页渲染手账时读取 `item.layout.stickers`，每个贴纸元素**实际支持的字段**如下（与 `backend.js` 的 `cleanScrapbookLayout` 及 `app.js` 渲染一致）：

| 字段 | 类型 | 含义 | 是否必需 |
| --- | --- | --- | --- |
| `src` | string | 贴纸图片 URL，必须是数据仓库 `assets/` 下 raw URL 或本地 `uploads/` | 二选一 |
| `char` | string | 文字贴纸（1–8 字），无图时用 | 二选一 |
| `x` | number | 水平位置百分比 | 建议 |
| `y` | number | 垂直位置百分比 | 建议 |
| `scale` | number | 缩放 | 建议 |
| `rotate` | number | 旋转角度 | 建议 |
| `opacity` | number | 透明度 | 建议 |
| `z` | number | 图层顺序 | 建议 |
| `name` | string | 贴纸名称（元数据，重开识别用） | 可选 |
| `stickerId` | string | 索引中的贴纸 id（元数据） | 可选 |
| `patternId` | string | 索引中的 pattern_id（元数据） | 可选 |

`layout` 字段：`title`、`text`、`paper`（`cream` / `kraft` / `grid` / `snow` / `botanical` / `blank`）、`wax`、`tape`、`stickers`。

**关键：`src` 必须是网页白名单允许的 raw URL**，格式为
`https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/<path>`。
其它任意第三方图片地址会被 `isAllowedRemoteAsset` 拒绝，导致贴纸不显示。直接使用索引里的 `raw_url` 即可。

---

## 7. 贴纸参数有效范围

以 `backend.js` 的 `cleanScrapbookLayout` 为准（超出会被钳制）：

| 参数 | 有效范围 | 默认 |
| --- | --- | --- |
| `x` | 0–100（百分比） | 50 |
| `y` | 0–100（百分比） | 50 |
| `scale` | 0.2–4 | 1 |
| `rotate` | -360–360（度） | 0 |
| `opacity` | 0.1–1 | 1 |
| `z` | 0–100（整数） | 1 |
| `char` | ≤ 8 字 | — |
| `src` | ≤ 1000 字符且通过白名单 | — |
| `stickers` 数量 | ≤ 100 枚 | — |
| `title` | ≤ 200 字 | — |
| `text` | ≤ 6000 字 | — |

坐标以画布左上角为原点，百分比定位；`x:50,y:50` 为画布正中。图层 `z` 越大越靠前。

---

## 8. 真实有效的 JSON 示例

> 以下 `raw_url` 均已核验为线上真实素材。把整段 `layout` 作为某天礼物的 `items_v2` 中的 `{"type":"scrapbook","layout":{...}}` 追加即可。

### 8.1 复古邮戳信件

```json
{
  "type": "scrapbook",
  "layout": {
    "title": "冬日来信",
    "text": "寄自十二月的邮局。",
    "paper": "kraft",
    "wax": "wine",
    "tape": "paper",
    "stickers": [
      {"src": "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/postmarks/ink/date_stamp.png", "x": 78, "y": 12, "scale": 0.8, "rotate": -12, "opacity": 0.9, "z": 3, "name": "日期邮戳·墨黑", "stickerId": "postmarks-date_stamp-ink", "patternId": "postmarks-date_stamp"},
      {"src": "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/christmas/letter_frame.png", "x": 50, "y": 52, "scale": 1.1, "rotate": 0, "opacity": 1, "z": 1, "name": "信纸边框", "stickerId": "christmas-letter_frame", "patternId": "christmas-letter_frame"}
    ]
  }
}
```

### 8.2 圣诞手账

```json
{
  "type": "scrapbook",
  "layout": {
    "title": "圣诞手账",
    "text": "今天下雪了，树也亮起来了。",
    "paper": "botanical",
    "wax": "wine",
    "tape": "holly",
    "stickers": [
      {"src": "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/christmas/fir_tree.png", "x": 22, "y": 30, "scale": 0.9, "rotate": 0, "opacity": 1, "z": 2, "name": "冷杉树", "stickerId": "christmas-fir_tree", "patternId": "christmas-fir_tree"},
      {"src": "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/doodles/gold/sparkles.png", "x": 70, "y": 20, "scale": 1, "rotate": 15, "opacity": 0.95, "z": 3, "name": "星光·暖金", "stickerId": "doodles-sparkles-gold", "patternId": "doodles-sparkles"}
    ]
  }
}
```

### 8.3 生日贺卡

```json
{
  "type": "scrapbook",
  "layout": {
    "title": "生日快乐",
    "text": "把蛋糕和祝福都给你。",
    "paper": "cream",
    "wax": "gold",
    "tape": "transparent",
    "stickers": [
      {"src": "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/celebration/blue_cake.png", "x": 32, "y": 40, "scale": 1.2, "rotate": -4, "opacity": 1, "z": 2, "name": "蓝莓蛋糕", "stickerId": "celebration-blue_cake", "patternId": "celebration-blue_cake"},
      {"src": "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/doodles/rose/hearts.png", "x": 72, "y": 24, "scale": 1.1, "rotate": 10, "opacity": 1, "z": 3, "name": "爱心·玫瑰粉", "stickerId": "doodles-hearts-rose", "patternId": "doodles-hearts"}
    ]
  }
}
```

### 8.4 黑白动物日记

```json
{
  "type": "scrapbook",
  "layout": {
    "title": "动物日记",
    "text": "窗外来了一只猫。",
    "paper": "grid",
    "wax": "wine",
    "tape": "paper",
    "stickers": [
      {"src": "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/doodles/ink/cat.png", "x": 30, "y": 38, "scale": 1.3, "rotate": 0, "opacity": 1, "z": 2, "name": "猫咪·墨黑", "stickerId": "doodles-cat-ink", "patternId": "doodles-cat"},
      {"src": "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/doodles/ink/bear.png", "x": 68, "y": 62, "scale": 1.1, "rotate": -8, "opacity": 0.95, "z": 2, "name": "小熊·墨黑", "stickerId": "doodles-bear-ink", "patternId": "doodles-bear"}
    ]
  }
}
```

### 8.5 孔雀蓝主题书信

```json
{
  "type": "scrapbook",
  "layout": {
    "title": "给三三的信",
    "text": "像孔雀蓝的湖面一样安静的一天。",
    "paper": "snow",
    "wax": "green",
    "tape": "transparent",
    "stickers": [
      {"src": "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/postmarks/peacock/wave_stamp.png", "x": 80, "y": 14, "scale": 0.85, "rotate": -10, "opacity": 0.9, "z": 3, "name": "波浪邮戳·孔雀蓝", "stickerId": "postmarks-wave_stamp-peacock", "patternId": "postmarks-wave_stamp"},
      {"src": "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/doodles/peacock/sprig.png", "x": 18, "y": 70, "scale": 1.2, "rotate": 20, "opacity": 1, "z": 2, "name": "枝叶·孔雀蓝", "stickerId": "doodles-sprig-peacock", "patternId": "doodles-sprig"}
    ]
  }
}
```

### 8.6 双面照片与贴纸组合

手账手账贴纸可直接与照片 item 放在同一条礼物里，贴纸做角饰：

```json
{
  "type": "scrapbook",
  "layout": {
    "title": "我们的照片",
    "text": "翻到背面还有一行字。",
    "paper": "cream",
    "wax": "wine",
    "tape": "paper",
    "stickers": [
      {"src": "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/christmas/letter_frame.png", "x": 50, "y": 50, "scale": 1.05, "rotate": 0, "opacity": 1, "z": 1, "name": "信纸边框", "stickerId": "christmas-letter_frame", "patternId": "christmas-letter_frame"},
      {"src": "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/doodles/gold/sparkles.png", "x": 82, "y": 18, "scale": 0.9, "rotate": 12, "opacity": 1, "z": 3, "name": "星光·暖金", "stickerId": "doodles-sparkles-gold", "patternId": "doodles-sparkles"}
    ]
  }
}
```

> 以上均为创作参考排版，AI 可自由组合其它真实图案与配色，不必拘泥于此。

---

## 9. 如何验证贴纸资源可访问与可渲染

1. **Raw 地址可访问**（HTTP 200）：
   ```bash
   curl -s -o /dev/null -w '%{http_code}' \
     "https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/stickers/doodles/ink/bear.png"
   ```
   期望 `200`。
2. **索引一致**：`raw_url` 去掉 `raw_base` 前缀后应等于 `path`，且 `path` 在仓库 `assets/stickers/` 下存在。
3. **白名单校验**：`raw_url` 必须以 `https://raw.githubusercontent.com/3William33/sannan-yanyan-advent-2026/main/assets/` 开头，扩展名 `.png`，否则网页不渲染。
4. **渲染验证**：网页打开手账抽屉（`书桌 → 手账抽屉`），在贴纸收纳册按分类/搜索找到贴纸，点击添加到画布；保存草稿后重新打开，贴纸位置与属性应完整恢复。发布后开启对应日期礼物，贴纸应正常显示。
5. **真实浏览器**：网页端已在 Chromium 与 WebKit 自动化测试通过；真实 iPad Safari 需在设备上复验（沙箱无法运行真实 Safari）。

---

## 10. 不改旧礼物、把贴纸加入新礼物

- **只追加，不覆盖**：用 GitHub Contents API 更新 `sannan_gifts.json` 时，先 GET 当前文件与 `sha`，在 `payload`（XOR+Base64 混淆后的 `days`）里向目标日期数组**追加**新 entry，再带 `sha` 写回；遇到 409/422 重新 GET 后重试，绝不整体替换或删除既有条目。
- **不改正文/日期/ID/创建时间**：新 entry 使用全新的 `id`（如 `sticker-note-<day>-<随机>`）与当前 `created_at`；不要改动任何已有礼物的字段。
- **只写自己的礼物箱**：三三侧写 `sannan_gifts.json`；砚砚侧写 `gifts.json`。北京时间 12 月 1 日前不得实际偷看三三礼物。
- **索引同步**：追加礼物后，按 `docs/advent-v4-protocol.md` 与既有逻辑同步更新 `gift_index_sannan.json`（仅元数据，非正文），失败可独立修复，不要重复追加。
- **贴纸引用**：新礼物里的贴纸 `src` 直接用索引 `raw_url`（见第 6、7 节字段与范围），不要上传重复图片，不要引用第三方地址。

---

## 附：快速核对清单

- [ ] 索引 URL 返回 200 且 `schema = advent-sticker-index-v1`
- [ ] 选用的 `src` 来自索引 `raw_url`，以 `.../main/assets/stickers/` 开头
- [ ] 同图案换色用 `variants` / `pattern_id`，不新建图案
- [ ] `x/y` 0–100、`scale` 0.2–4、`rotate` -360–360、`opacity` 0.1–1、`z` 0–100
- [ ] `paper` 为合法枚举值
- [ ] 只追加新礼物，带最新 `sha` 写回，409 重试
- [ ] 不改旧礼物正文、不提前偷看三三礼物
- [ ] 素材授权见 `LICENSES.md`（提供者确认已授权、免费非商用），不编造作者或许可证名称
