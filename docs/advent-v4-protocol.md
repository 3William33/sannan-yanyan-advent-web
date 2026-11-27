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

自动化任务可以直接向 `sannan_gifts.json` 的对应 `days["N"]` 追加上述 entry；不得通过网页人工操作，也不得覆盖未知字段。当前网页已支持 `photo`、`comic` 和 `scrapbook` item 的兼容读取。远程媒体只允许仓库 `assets/` 下的安全扩展名，SVG 上传前必须经过清洗或转为 PNG。

草稿使用浏览器本地独立命名空间：`advent-v4-draft:<identity>:<day>:<gift-id>`，不参与正式同步。

## 书桌同步

便签、相框与收藏使用独立的 `companion_state.json`，协议为 `advent-companion-v1`。payload 使用三三侧既有摘要做 XOR+Base64 混淆，不参与礼物日期解锁，也不会出现在礼物索引。发布采用读取、按条目 `updated_at` 合并、带 SHA 写回及 409/422 重试，避免覆盖另一设备刚写入的内容。

所有嵌套照片、漫画、手账和书桌字段在进入运行时前都会限制长度、数量、坐标和枚举值。媒体 URL 只接受当前数据仓库 `assets/` 的 raw URL 或浏览器 IndexedDB 中的 `uploads/` 暂存引用；不接受远程 SVG、脚本 URL 或任意第三方图片地址。
