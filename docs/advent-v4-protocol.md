# Advent V4 可选扩展协议

V4 保持 `protocol: advent-gifts-v3.2`、北京时间解锁、XOR+Base64 payload、双方独立礼物仓库与未知字段保留规则。以下字段均为可选，旧礼物缺失时按普通信件/图片显示。

```json
{
  "schema_version": 4,
  "kind": "letter | photo | comic | scrapbook",
  "items_v2": [{"type":"text","text":"..."},{"type":"scrapbook","layout":{"title":"冬日手账","text":"正文","stickers":[{"char":"★","x":50,"y":30,"scale":1,"rotate":0,"opacity":1,"z":1}]}}],
  "paper": {"style":"cream","title":"冬日信","signature":"三三"},
  "stickers": [{"char":"★","src":"","x":50,"y":30,"scale":1,"rotate":0,"opacity":1,"z":1},{"src":"assets/stickers/example.png","x":65,"y":45,"scale":1,"rotate":0,"opacity":1,"z":2}],
  "photo": {"front":{"url":"...","frame":"polaroid","fit":"cover","positionX":50,"positionY":50},"back":{"text":"背面留言","date":"2026-12-01","signature":""}},
  "comic": {"mode":"single | pages | scroll | spread | strip","pages":[{"url":"...","alt":""}]},
  "reply_to":"gift-id",
  "favorite": false,
  "editor_version": 1
}
```

自动化任务可以向对应作者的 `days["N"]` 追加上述 entry；不得覆盖未知字段。当前网页支持 `photo`、`comic` 和 `scrapbook` item 的兼容读取。远程媒体只允许仓库 `assets/` 下的安全扩展名，SVG 上传前必须经过清洗或转为 PNG。

## 写入身份与日期权限

- 默认写入身份为三三，使用 `sannan_gifts.json`、`gift_index_sannan.json` 与 `assets/sannan/`。
- 砚砚通过 `?writer=yan` 选择，使用 `gifts.json`、`gift_index_yanyan.json` 与 `assets/yanyan/`。该参数不改变顶栏“偷看记名”。
- 12 月 26 日前（含筹备期和 12 月 1–25 日），双方可新增、修改或删除自己尚未正式封存的 1–25 日普通礼物，包括已过去的日期。
- 12 月 24/25 日的内置特别结局保持只读；12 月 26 日起普通礼物和完整档案只读。
- 修改与删除在实际写入 API 中再次校验作者归属、日期和封存状态，不能修改对方礼物。

草稿使用浏览器本地独立命名空间：新礼物为 `advent-v4-draft:<writer>:<day>`，编辑为 `advent-v4-edit:<writer>:<gift-id>`，不参与正式同步。

## 礼物活动事件

`gift_events.json` 是独立的活动源，不替代、不修改礼物主数据。活动只保存白名单安全元数据：

```json
{
  "version": 1,
  "updated_at": "2026-12-05T10:00:00+08:00",
  "events": [{
    "event_id": "giftevt-...",
    "actor_id": "san",
    "actor_name": "三三",
    "event_type": "create",
    "gift_id": "san-...",
    "gift_date": 20,
    "gift_type": "text",
    "title": "公开安全的礼物标题",
    "created_at": "2026-12-05T10:00:00+08:00"
  }],
  "read_cursors": {"san": "", "yan": ""},
  "read_event_ids": {"san": [], "yan": []}
}
```

- `event_type` 为 `create`、`update`、`delete`、`attachment`、`open` 或 `seal`。
- 成功的实际操作才生成事件；失败调用不生成成功事件。发布以远程写入并核验成功为封存事件前提。
- 时间线按 `created_at` 的真实时刻排序，界面以 `Asia/Shanghai` 显示；兼容不同时区偏移的 ISO 时间戳。
- 删除事件可以没有正文或附件，事件永不保存 `text`、`items_v2`、媒体 URL 或其他礼物内容。
- 未读只统计对方操作，按作者分别合并游标和逐条已读 ID；旧版数组形式的 `read_event_ids` 可兼容读取。
- 通知跳转只打开收藏馆对应日期，仍受既有解锁与作者权限约束。
- 合并按 `event_id` 去重，不设置事件数量上限，归档后继续保留完整时间线。

## 收藏馆读取边界

收藏馆使用双方礼物、本地礼物、内置统计和 tombstone 的统一投影。未解锁的对方条目只有 ID、日期、作者、类型、公开标题、时间和状态等安全元数据，`can_read=false`；正文与附件只在既有正式开启或作者本人权限成立时读取。浏览、筛选、搜索、展开和通知跳转都不会增加偷看或正式开启记录。

## 书桌同步

便签、相框与收藏使用独立的 `companion_state.json`，协议为 `advent-companion-v1`。payload 使用三三侧既有摘要做 XOR+Base64 混淆，不参与礼物日期解锁，也不会出现在礼物索引。发布采用读取、按条目 `updated_at` 合并、带 SHA 写回及 409/422 重试，避免覆盖另一设备刚写入的内容。

所有嵌套照片、漫画、手账和书桌字段在进入运行时前都会限制长度、数量、坐标和枚举值。媒体 URL 只接受当前数据仓库 `assets/` 的 raw URL 或浏览器 IndexedDB 中的 `uploads/` 暂存引用；不接受远程 SVG、脚本 URL 或任意第三方图片地址。
