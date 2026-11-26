/**
 * backend.js — 网页版浏览器端适配层
 *
 * 完整替代原 Python 后端（advent_game.py）提供的全部接口语义：
 *   /api/board  /api/touch  /api/seen  /api/answer  /api/hide
 *   /api/sync + /api/sync/status  /api/upload  /api/publish
 *
 * 数据协议与 v3.2 完全一致（advent-gifts-v3.2）：
 *   - XOR + Base64 混淆 payload，密钥摘要见 config.js
 *   - gifts.json / sannan_gifts.json 双方礼物，gift_index_*.json 无内容索引
 *   - peek_log.json 双向偷看事件，按事件 ID 去重合并
 *   - 砚砚箱 2026-12-01 定稿快照（freeze）+ 12月1—23日当天追加限制
 *
 * 本地状态保存在 localStorage，上传媒体暂存在 IndexedDB，发布时写入
 * 数据仓库 assets/sannan/<sha256>.<ext> 并改写为 raw URL。
 *
 * 安全说明：
 *   - GitHub PAT 只保存在当前浏览器标签页的 sessionStorage，关闭标签页即清除，
 *     不写入 localStorage、不进入 URL、不进入任何日志
 *   - 解锁规则是客户端交互层限制（与原版本机运行一致），并非服务器端安全边界
 */

import { CONFIG, UPLOAD_MIME_EXT, REMOTE_MEDIA_EXTENSIONS, MAX_UPLOAD_BYTES } from './config.js?v=8a1c3e';
import { BUILTIN_DAYS } from './builtin-gifts.js?v=8a1c3e';

/* ── 编解码工具（与 advent-gifts-v3.2 协议一致）────────────────────── */

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function xorBytes(bytes, digest) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ digest[i % digest.length];
  return out;
}

const YAN_DIGEST = hexToBytes(CONFIG.YAN_DIGEST_HEX);
const SAN_DIGEST = hexToBytes(CONFIG.SAN_DIGEST_HEX);

function decodeRaw(b64, digest) {
  return JSON.parse(new TextDecoder().decode(xorBytes(b64ToBytes(b64), digest)));
}

function decodePayload(b64, digest) {
  const value = decodeRaw(b64, digest);
  if (!value || typeof value !== 'object' || typeof value.days !== 'object' || !value.days) {
    throw new Error('remote payload has an invalid shape');
  }
  return value;
}

function encodePayload(value, digest) {
  return bytesToB64(xorBytes(new TextEncoder().encode(JSON.stringify(value)), digest));
}

async function sha256Hex(bytes) {
  if (crypto?.subtle) {
    const d = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return 'unavailable'; // 非安全上下文时退化；GitHub Pages 为 https，正常可用
}

/* ── 时间（统一北京时间，不依赖设备时区）──────────────────────────── */

function shanghaiParts() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date())) p[type] = value;
  return p; // { year, month, day, hour, minute, second }
}

function shanghaiNowIso() {
  const p = shanghaiParts();
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

function isUnlocked(day) {
  const p = shanghaiParts();
  const y = parseInt(p.year, 10), m = parseInt(p.month, 10), d = parseInt(p.day, 10);
  const h = parseInt(p.hour, 10), mi = parseInt(p.minute, 10), s = parseInt(p.second, 10);
  if (y > CONFIG.YEAR) return true;
  if (y < CONFIG.YEAR) return false;
  if (m > 12) return true;
  if (m < 12) return false;
  if (d > day) return true;
  if (d < day) return false;
  return true; // 当天 00:00:00 起解锁
}

function isNightNow() {
  const h = parseInt(shanghaiParts().hour, 10);
  return h >= 17 || h < 6;
}

/* 显示模式：auto 按北京时间 17:00–06:00 自动夜间；day 恒白昼；night 恒夜间。
   与用户设备时区无关，只取决于 Asia/Shanghai。 */
function effectiveNight() {
  const mode = save.settings.display;
  if (mode === 'day') return false;
  if (mode === 'night') return true;
  return isNightNow();
}

function getDisplay() {
  const m = save.settings.display;
  return m === 'day' || m === 'night' ? m : 'auto';
}
function setDisplay(mode) {
  save.settings.display = mode === 'day' || mode === 'night' ? mode : 'auto';
  persist();
  return getDisplay();
}
function getSmooth() { return !!save.settings.smooth; }
function setSmooth(on) {
  save.settings.smooth = !!on;
  persist();
  return getSmooth();
}

function todayDay() {
  const p = shanghaiParts();
  const y = parseInt(p.year, 10), m = parseInt(p.month, 10);
  if (y === CONFIG.YEAR && m === 12) return parseInt(p.day, 10);
  return 0;
}

function isPrepPeriod() {
  const p = shanghaiParts();
  const y = parseInt(p.year, 10), m = parseInt(p.month, 10), d = parseInt(p.day, 10);
  if (y < CONFIG.YEAR) return true;
  if (y > CONFIG.YEAR) return false;
  if (m < 12) return true;
  if (m > 12) return false;
  return d === 1 && (p.hour < '23' || (p.hour === '23' && p.minute <= '59')); // 11-30 23:59:59 之前
}

/* ── 本地存档（localStorage，结构与原版 save.json 一致）────────────── */

const SAVE_KEY = 'advent-web-save-v1';
const REMOTE_CACHE_KEY = 'advent-web-remote-v1';
const PAT_KEY = 'advent-gh-pat'; // sessionStorage 专用

const DEFAULT_SAVE = {
  version: 3,
  opened: [],
  opened_at: {},
  peek_counts: { san: 0, yan: 0 },
  peek_log: [],
  answers: {},
  human_gifts: {},
  seen_remote_ids: [],
  yanyan_freeze: null,
  scores: {},
  earned_stars: 0,
  companion: { notes: {}, frames: {}, favorites: {} },
  settings: { name: '三三', companion: '砚砚', music: true, who: 'san', display: 'auto', smooth: false },
};

let save = loadSave();
let remoteData = { yan: { days: {} }, san: { days: {} } };
let remoteIndexes = { yan: { days: {} }, san: { days: {} } };
let syncState = { state: 'idle', message: '尚未同步', sources: {} };

function loadSave() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_SAVE);
    const merged = structuredClone(DEFAULT_SAVE);
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'peek_counts' || k === 'settings' || k === 'companion') Object.assign(merged[k], v || {});
      else merged[k] = v;
    }
    for (const [day, gift] of Object.entries(merged.human_gifts)) {
      if (gift && !Array.isArray(gift)) merged.human_gifts[day] = [gift];
    }
    merged.peek_log = mergePeekEvents([], merged.peek_log || []);
    merged.peek_counts = peekCounts(merged.peek_log);
    return merged;
  } catch {
    return structuredClone(DEFAULT_SAVE);
  }
}

function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch { /* 存储满时静默：关键写入路径已有 try */ }
}

function loadRemoteCache() {
  try {
    const c = JSON.parse(localStorage.getItem(REMOTE_CACHE_KEY) || 'null');
    if (!c) return;
    if (c.yan) remoteData.yan = c.yan;
    if (c.san) remoteData.san = c.san;
    if (c.yanIndex) remoteIndexes.yan = c.yanIndex;
    if (c.sanIndex) remoteIndexes.san = c.sanIndex;
  } catch { /* 无缓存则从空开始 */ }
}
loadRemoteCache();

/* ── 礼物条目规范化（与 Python clean_item / normalize_* 一致）──────── */

const ITEM_TYPES = new Set(['text', 'question', 'song', 'abc', 'image', 'photo', 'comic', 'scrapbook', 'voice', 'audio', 'attachment']);
const TEXT_FIELDS = { text: 6000, abc: 12000, name: 200, artist: 200, provider: 40, mime: 100, filename: 240 };
const clamp = (n, min, max, fallback = min) => { n = Number(n); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };

function isSafeLocalUploadUrl(url) {
  if (!url.startsWith('uploads/') && !url.startsWith('/uploads/')) return false;
  const name = url.replace(/^\//, '').slice('uploads/'.length);
  return Boolean(name) && !/[/\\\0]/.test(name) && !name.startsWith('.');
}

function isSafeMusicUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' &&
      ['open.spotify.com', 'music.163.com', 'y.music.163.com', '163cn.tv'].includes(u.hostname.toLowerCase());
  } catch { return false; }
}

export function isAllowedRemoteAsset(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'raw.githubusercontent.com') return false;
    const path = decodeURIComponent(u.pathname);
    if (path.split('/').includes('..')) return false;
    if (!path.startsWith(`/${CONFIG.OWNER}/${CONFIG.DATA_REPO}/${CONFIG.BRANCH}/assets/`)) return false;
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
    return REMOTE_MEDIA_EXTENSIONS.has(ext);
  } catch { return false; }
}

export function isAllowedAssetUrl(url) {
  return isSafeLocalUploadUrl(url) || isAllowedRemoteAsset(url);
}

function cleanPhotoData(value, { allowLocal = true } = {}) {
  if (!value || typeof value !== 'object') return null;
  const safeUrl = raw => { const u=String(raw||'').slice(0,1000); return (isAllowedRemoteAsset(u)||(allowLocal&&isSafeLocalUploadUrl(u)))?u:''; };
  const front=value.front&&typeof value.front==='object'?value.front:value; const back=value.back&&typeof value.back==='object'?value.back:{};
  const url=safeUrl(front.url||value.url); if(!url)return null;
  return {front:{url,frame:['polaroid','vintage','plain','postcard','stamp'].includes(front.frame)?front.frame:'polaroid',title:String(front.title||'').slice(0,200),date:String(front.date||'').slice(0,40),fit:front.fit==='contain'?'contain':'cover',positionX:clamp(front.positionX,0,100,50),positionY:clamp(front.positionY,0,100,50)},back:{text:String(back.text||'').slice(0,3000),date:String(back.date||'').slice(0,40),signature:String(back.signature||'').slice(0,120)}};
}
function cleanComicData(value, { allowLocal = true } = {}) {
  if(!value||typeof value!=='object')return null;const modes=new Set(['single','pages','scroll','spread','strip']);const pages=[];
  for(const p of (Array.isArray(value.pages)?value.pages:[]).slice(0,80)){const u=String(p?.url||'').slice(0,1000);if(isAllowedRemoteAsset(u)||(allowLocal&&isSafeLocalUploadUrl(u)))pages.push({url:u,alt:String(p.alt||'').slice(0,300)});}
  return pages.length?{mode:modes.has(value.mode)?value.mode:'pages',title:String(value.title||'').slice(0,200),pages}:null;
}
function cleanScrapbookLayout(value, { allowLocal = true } = {}) {
  if(!value||typeof value!=='object')return null;const stickers=[];
  for(const s of (Array.isArray(value.stickers)?value.stickers:[]).slice(0,100)){const out={char:String(s.char||'').slice(0,8),x:clamp(s.x,0,100,50),y:clamp(s.y,0,100,50),scale:clamp(s.scale,.2,4,1),rotate:clamp(s.rotate,-360,360,0),opacity:clamp(s.opacity,.1,1,1),z:Math.round(clamp(s.z,0,100,1))};const src=String(s.src||'').slice(0,1000);if(src&&(isAllowedRemoteAsset(src)||(allowLocal&&isSafeLocalUploadUrl(src))))out.src=src;/* 贴纸库元数据：仅元数据，用于重开后识别/替换，不影响解锁与归属 */if(s.name)out.name=String(s.name).slice(0,80);if(s.stickerId)out.stickerId=String(s.stickerId).slice(0,120);if(s.patternId)out.patternId=String(s.patternId).slice(0,120);if(out.char||out.src)stickers.push(out);}
  return {title:String(value.title||'').slice(0,200),text:String(value.text||'').slice(0,6000),paper:['cream','kraft','grid','snow','botanical','blank'].includes(value.paper)?value.paper:'cream',wax:String(value.wax||'wine').slice(0,30),tape:String(value.tape||'paper').slice(0,30),stickers};
}

function cleanItem(item, { allowLocal = true } = {}) {
  if (!item || typeof item !== 'object' || !ITEM_TYPES.has(item.type)) return null;
  const kind = item.type;
  const out = { type: kind };
  if (kind === 'photo') out.photo = cleanPhotoData(item.photo||item, {allowLocal});
  if (kind === 'comic') out.comic = cleanComicData(item.comic||item, {allowLocal});
  if (kind === 'scrapbook') out.layout = cleanScrapbookLayout(item.layout, {allowLocal});
  for (const [field, limit] of Object.entries(TEXT_FIELDS)) {
    if (item[field] !== undefined && item[field] !== null) out[field] = String(item[field]).slice(0, limit);
  }
  if (item.url) {
    const url = String(item.url).slice(0, 1000);
    const valid = kind === 'song' ? isSafeMusicUrl(url) : isAllowedRemoteAsset(url);
    if (allowLocal && isSafeLocalUploadUrl(url)) { /* 本地暂存资源 */ out.__local = true; }
    if (valid || (allowLocal && isSafeLocalUploadUrl(url))) out.url = url;
  }
  if (out.text || out.abc || out.url || out.photo || out.comic || out.layout) return out;
  return null;
}

function entryItems(entry, { allowLocal = true } = {}) {
  const raw = Array.isArray(entry.items_v2) ? entry.items_v2 : (Array.isArray(entry.items) ? entry.items : null);
  const cleaned = (raw || []).map(x => cleanItem(x, { allowLocal })).filter(Boolean);
  if (cleaned.length) return cleaned;
  const legacy = [];
  if (entry.text) legacy.push({ type: 'text', text: String(entry.text).slice(0, 6000) });
  if (entry.song) {
    const c = cleanItem({ type: 'song', url: entry.song, name: entry.song_name || '' }, { allowLocal });
    if (c) legacy.push(c);
  }
  if (entry.url) {
    let guessed = entry.type || entry.kind || 'image';
    if (!ITEM_TYPES.has(guessed)) guessed = 'image';
    const c = cleanItem({ type: guessed, url: entry.url, name: entry.name || '' }, { allowLocal });
    if (c) legacy.push(c);
  }
  return legacy;
}

function normalizeEntry(entry, fallbackId, { allowLocal = true } = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const items = entryItems(entry, { allowLocal });
  if (!items.length) return null;
  const created = String(entry.created_at || entry.at || '').slice(0, 80);
  const out = {
    id: String(entry.id || fallbackId).slice(0, 160),
    from: String(entry.from || '').slice(0, 80),
    title: String(entry.title || '').slice(0, 300),
    kind: String(entry.kind || 'letter').slice(0, 40),
    text: items.find(x => x.type === 'text')?.text || '',
    items_v2: items,
    created_at: created,
    at: created,
  };
  // V4 可选字段：只做浅层安全保留，旧协议字段和未知字段不被覆盖。
  for (const key of ['paper', 'stickers', 'photo', 'comic', 'reply_to', 'favorite', 'editor_version']) {
    if (entry[key] !== undefined) out[key] = entry[key];
  }
  return out;
}

function normalizeDays(value, { allowLocal = false } = {}) {
  const result = {};
  const days = (value && typeof value === 'object' && value.days) || {};
  for (const [day, entriesRaw] of Object.entries(days)) {
    const dayI = parseInt(day, 10);
    if (!Number.isInteger(dayI) || dayI < 1 || dayI > 25) continue;
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [entriesRaw];
    const seen = new Set();
    const clean = [];
    for (const raw of entries.slice(0, 100)) {
      const e = normalizeEntry(raw, `legacy-${dayI}-${clean.length}`, { allowLocal });
      if (e && !seen.has(e.id)) { seen.add(e.id); clean.push(e); }
    }
    if (clean.length) result[String(dayI)] = clean;
  }
  return { days: result };
}

/* ── 偷看事件（与 v3.2 协议一致）──────────────────────────────────── */

function normalizePeekEvent(event, ordinal = 0) {
  if (!event || typeof event !== 'object') return null;
  const day = parseInt(event.day, 10);
  if (!Number.isInteger(day) || day < 1 || day > 25) return null;
  const who = String(event.who || 'san').slice(0, 40);
  const at = String(event.peeked_at || event.at || '').slice(0, 80);
  let id = String(event.id || '').slice(0, 180);
  if (!id) {
    id = 'legacy-' + sha256HexSync(`${who}|${day}|${at}|${ordinal}`);
  }
  let outcome = String(event.outcome || 'attempt');
  if (outcome !== 'attempt' && outcome !== 'read') outcome = 'attempt';
  return { id, who, day, peeked_at: at, at, outcome };
}

function sha256HexSync(text) {
  // 旧事件 ID 兜底：轻量 FNV 不是 SHA-256，但仅用于生成稳定去重 ID
  let h1 = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h1 ^= text.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + text.length.toString(16);
}

export function mergePeekEvents(...groups) {
  const merged = [];
  const seen = new Set();
  let ordinal = 0;
  for (const group of groups) {
    const events = (group && Array.isArray(group.events)) ? group.events : (Array.isArray(group) ? group : []);
    for (const raw of events || []) {
      const event = normalizePeekEvent(raw, ordinal++);
      if (event && !seen.has(event.id)) { seen.add(event.id); merged.push(event); }
    }
  }
  merged.sort((a, b) => (a.peeked_at || '').localeCompare(b.peeked_at || '') || a.id.localeCompare(b.id));
  return merged;
}

function peekCounts(events) {
  const counts = { san: 0, yan: 0 };
  for (const e of events) counts[e.who] = (counts[e.who] || 0) + 1;
  return counts;
}

/* ── 内置礼物（按天混淆存储，仅解锁后解码）────────────────────────── */

const builtinCache = new Map();

function builtinGift(day) {
  const payload = BUILTIN_DAYS[String(day)];
  if (!payload) return null;
  if (!builtinCache.has(day)) {
    let decoded = null;
    try { decoded = decodeRaw(payload, YAN_DIGEST); } catch { decoded = null; }
    builtinCache.set(day, decoded);
  }
  return builtinCache.get(day);
}

function hasBuiltin(day) { return Boolean(BUILTIN_DAYS[String(day)]); }

/* ── 砚砚定稿快照（freeze）与追加限制 ─────────────────────────────── */

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',') + '}';
  }
  return JSON.stringify(value);
}

async function recordYanyanFreeze(wrapper, decoded) {
  if (isPrepPeriod() || save.yanyan_freeze) return;
  const canonical = new TextEncoder().encode(canonicalJson(decoded));
  save.yanyan_freeze = {
    recorded_at: shanghaiNowIso(),
    updated_at: String(wrapper.updated_at || '').slice(0, 80),
    version: wrapper.version,
    sha256: await sha256Hex(canonical),
    gift_ids: Object.values(decoded.days).flat().map(e => e.id).sort(),
  };
  persist();
}

function enforceYanyanFreeze(decoded) {
  const freeze = save.yanyan_freeze;
  if (!freeze) return decoded;
  const baseline = new Set(freeze.gift_ids || []);
  const output = { days: {} };
  for (const [day, entries] of Object.entries(decoded.days)) {
    const accepted = [];
    for (const entry of entries) {
      if (baseline.has(entry.id)) { accepted.push(entry); continue; }
      try {
        let created = new Date(entry.created_at || entry.at || '');
        if (isNaN(created.getTime())) continue;
        // 转换为北京时间年月日
        const fmt = new Intl.DateTimeFormat('en-CA', {
          timeZone: CONFIG.TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
        }).formatToParts(created).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
        const cy = parseInt(fmt.year, 10), cm = parseInt(fmt.month, 10), cd = parseInt(fmt.day, 10);
        if (cy === CONFIG.YEAR && cm === 12 && cd >= 1 && cd <= 23 && cd === parseInt(day, 10)) {
          accepted.push(entry);
        }
      } catch { /* 无效时间戳：拒绝 */ }
    }
    if (accepted.length) output.days[day] = accepted;
  }
  return output;
}

/* ── 同步（对应 /api/sync + /api/sync/status）─────────────────────── */

let _syncPromise = null;

/* 把异常归类为可展示的原因，便于区分网络失败 / 解析失败 / API 限制 / 缓存回退 */
function classifyError(e) {
  const msg = String((e && e.message) || e || '');
  if (/abort/i.test(msg)) return { reason: 'timeout', label: '网络超时' };
  if (/failed to fetch|networkerror|load failed|connection/i.test(msg)) return { reason: 'network', label: '网络不可达' };
  if (/http 403|forbidden|permission|write permission/i.test(msg)) return { reason: 'permission', label: '权限不足（无写入/读取授权）' };
  if (/http 429|rate limit|abuse/i.test(msg)) return { reason: 'api_limit', label: 'GitHub 接口限流' };
  if (/http 404/i.test(msg)) return { reason: 'missing', label: '数据文件尚未创建（正常）' };
  if (/http 5\d\d/i.test(msg)) return { reason: 'server', label: 'GitHub 服务暂时不可用' };
  if (/json|decode|invalid|payload|shape|unexpected|too large/i.test(msg)) return { reason: 'parse', label: '数据解析失败' };
  return { reason: 'network', label: '网络或数据异常' };
}

/* 判断某来源失败时本地是否已有可用缓存（用于区分「缓存回退」与「完全无数据」） */
function hasRemoteCache() {
  try {
    const c = JSON.parse(localStorage.getItem(REMOTE_CACHE_KEY) || 'null');
    return !!(c && c.yan && c.san && (c.yan.days || c.san.days));
  } catch { return false; }
}

async function fetchJson(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 5 * 1024 * 1024) throw new Error('remote JSON too large');
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object') throw new Error('remote JSON must be an object');
    return value;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 拉取数据仓库文件：优先 raw（无速率限制），失败时回退 GitHub Contents API
 * （api.github.com 自带 CORS 头并返回 base64 内容，可绕过个别网络的 CDN/CORS 问题）。
 * 测试模式（?data= 覆盖）下不回退，保证测试隔离。
 */
async function fetchRemoteFile(path) {
  const bust = `?t=${Date.now()}`; // 绕过 raw.githubusercontent 的 CDN 缓存，保证拿到最新礼物
  try {
    return await fetchJson(`${CONFIG.dataBase()}/${path}${bust}`);
  } catch (e) {
    if (new URLSearchParams(location.search).get('data')) throw e;
    const res = await fetch(`${CONFIG.ghApiBase()}${path}?ref=${CONFIG.BRANCH}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const meta = await res.json();
    if (meta.encoding !== 'base64' || !meta.content) throw new Error('unexpected contents response');
    return JSON.parse(new TextDecoder().decode(b64ToBytes(meta.content.replace(/\n/g, ''))));
  }
}

function writeRemoteCache() {
  try {
    localStorage.setItem(REMOTE_CACHE_KEY, JSON.stringify({
      yan: remoteData.yan, san: remoteData.san,
      yanIndex: remoteIndexes.yan, sanIndex: remoteIndexes.san,
      fetched_at: shanghaiNowIso(),
    }));
  } catch { /* 缓存失败不影响主流程 */ }
}

function syncAll() {
  if (syncState.state === 'syncing') return _syncPromise || Promise.resolve({ ...syncState });
  syncState = { state: 'syncing', message: '正在同步', sources: {}, finished_at: null };

  _syncPromise = (async () => {
    const sources = {};
    let ok = 0;
    const cached = hasRemoteCache();

    const fail = (name, e) => {
      const c = classifyError(e);
      // missing（404，尚未创建）是预期的空数据源，不计入「失败」告警
      if (c.reason === 'missing') {
        sources[name] = { state: 'empty', reason: c.reason, label: c.label };
        return;
      }
      sources[name] = {
        state: cached ? 'offline_cache' : 'failed',
        reason: c.reason,
        label: c.label,
        fromCache: cached,
        error: String((e && e.message) || e || '').slice(0, 240),
      };
    };

    const giftJobs = [
      ['yanyan_gifts', 'gifts.json', YAN_DIGEST, 'yan'],
      ['sannan_gifts', 'sannan_gifts.json', SAN_DIGEST, 'san'],
    ];
    for (const [name, file, digest, who] of giftJobs) {
      try {
        const wrapper = await fetchRemoteFile(file);
        let decoded = normalizeDays(decodePayload(wrapper.payload, digest), { allowLocal: false });
        if (who === 'yan') {
          await recordYanyanFreeze(wrapper, decoded);
          decoded = enforceYanyanFreeze(decoded);
        }
        remoteData[who] = decoded;
        sources[name] = { state: 'succeeded', count: Object.values(decoded.days).reduce((n, x) => n + x.length, 0) };
        ok++;
      } catch (e) { fail(name, e); }
    }

    const indexJobs = [
      ['yanyan_index', 'gift_index_yanyan.json', 'yan'],
      ['sannan_index', 'gift_index_sannan.json', 'san'],
    ];
    for (const [name, file, who] of indexJobs) {
      try {
        const idx = normalizeIndex(await fetchRemoteFile(file), who);
        remoteIndexes[who] = idx;
        sources[name] = { state: 'succeeded' };
        ok++;
      } catch (e) { fail(name, e); }
    }

    try {
      const remotePeeks = await fetchRemoteFile('peek_log.json');
      save.peek_log = mergePeekEvents(save.peek_log, remotePeeks);
      save.peek_counts = peekCounts(save.peek_log);
      persist();
      sources.peek_log = { state: 'succeeded', count: save.peek_log.length };
      ok++;
    } catch (e) { fail('peek_log', e); }

    try {
      const wrapper=await fetchRemoteFile('companion_state.json');const remote=decodeRaw(wrapper.payload,SAN_DIGEST);mergeCompanionState(remote);sources.companion_state={state:'succeeded'};ok++;
    } catch(e){fail('companion_state',e);}

    // 统计：成功 / 预期为空 / 缓存回退 / 真正失败
    const entries = Object.values(sources);
    const failed = entries.filter(s => s.state === 'failed' || s.state === 'offline_cache');
    const fromCache = entries.filter(s => s.state === 'offline_cache');
    const state = failed.length === 0 ? 'succeeded' : (ok === 0 ? 'offline_cache' : 'partial');
    let message = '同步完成';
    if (state === 'offline_cache') message = fromCache.length ? '全部来源离线，正在使用本地缓存' : '暂时无法获取远程数据';
    else if (state === 'partial') {
      const labels = [...new Set(failed.map(s => s.label))].join('、');
      message = fromCache.length ? `部分来源离线（${labels}）· 已用缓存` : `部分来源失败（${labels}）`;
    }
    /* 偷看记录是否成功读取：只有真正读到文件（succeeded）才算「已知次数」。
       404（missing）、权限不足、网络失败、离线缓存都表示「无法确认」，UI 不得显示成已确认的 0 次。 */
    const peekSrc = sources.peek_log;
    const peekAvailable = !!peekSrc && peekSrc.state === 'succeeded';
    syncState = {
      state,
      message,
      okCount: ok,
      failedCount: failed.length,
      fromCacheCount: fromCache.length,
      sources,
      peekAvailable,
      finished_at: shanghaiNowIso(),
    };
    if (ok > 0) writeRemoteCache();
    _syncPromise = null;
    return { ...syncState };
  })();

  return _syncPromise;
}

function normalizeIndex(raw, author) {
  const days = {};
  const rawDays = (raw && typeof raw === 'object' && raw.days) || {};
  for (const [d, entriesRaw] of Object.entries(rawDays)) {
    const day = parseInt(d, 10);
    if (!Number.isInteger(day) || day < 1 || day > 25 || !Array.isArray(entriesRaw)) continue;
    const seen = new Set();
    const clean = [];
    for (const entry of entriesRaw.slice(0, 200)) {
      let gid = '', created = '';
      if (typeof entry === 'string') gid = entry;
      else if (entry && typeof entry === 'object') {
        gid = String(entry.id || '').slice(0, 160);
        created = String(entry.created_at || entry.at || '').slice(0, 80);
      }
      if (gid && !seen.has(gid)) { seen.add(gid); clean.push({ id: gid, created_at: created }); }
    }
    if (clean.length) days[String(day)] = clean;
  }
  return {
    version: 1, author, days,
    updated_at: String(raw?.updated_at || '').slice(0, 80),
  };
}

/* ── 看板（对应 build_board）──────────────────────────────────────── */

function getBoard() {
  const today = todayDay();
  const events = mergePeekEvents(save.peek_log);
  const counts = peekCounts(events);
  const seenRemote = new Set(save.seen_remote_ids);
  const cells = [];

  for (let d = 1; d <= 25; d++) {
    const unlocked = isUnlocked(d);
    const yanRemote = remoteData.yan.days[String(d)] || [];
    const sanRemote = remoteData.san.days[String(d)] || [];
    const yanIndex = remoteIndexes.yan.days?.[String(d)] || [];
    const sanIndex = remoteIndexes.san.days?.[String(d)] || [];
    const yanIds = new Set([...yanRemote, ...yanIndex].map(x => x.id).filter(Boolean));
    const sanIds = new Set([...sanRemote, ...sanIndex].map(x => x.id).filter(Boolean));

    const openedBy = {};
    if (save.opened.includes(d)) openedBy.human = save.opened_at[String(d)] || '';

    const giftsOut = {};
    const hidden = {};

    hidden.ai = Boolean(hasBuiltin(d) || yanIds.size);
    if (unlocked && hasBuiltin(d)) {
      const yan = builtinGift(d);
      if (yan) {
        giftsOut.ai = { ...yan, day: d, author: 'ai', id: `builtin-yan-${d}`,
          answer: save.answers[`builtin-yan-${d}`] !== undefined
            ? save.answers[`builtin-yan-${d}`]
            : save.answers[String(d)] ?? undefined };
      }
    }

    const humanList = save.human_gifts[String(d)] || [];
    const localIds = new Set(humanList.map(e => e?.id).filter(Boolean));
    hidden.human = Boolean(humanList.length || sanIds.size);
    if (humanList.length && unlocked) {
      const entries = [];
      humanList.forEach((entry, i) => {
        const normalized = normalizeEntry(entry, `local-${d}-${i}`, { allowLocal: true });
        if (normalized) {
          normalized.day = d;
          normalized.answer = save.answers[`${d}:${normalized.id}`] || '';
          entries.push(normalized);
        }
      });
      if (entries.length) giftsOut.human_entries = entries;
    }

    const unreadIds = new Set([...yanIds, ...[...sanIds].filter(id => !localIds.has(id))].filter(id => !seenRemote.has(id)));
    const hasAny = hidden.ai || hidden.human;
    // lit 严格表示「已开启」——与 opened_by / 顶部已开启计数完全同源。
    // 「有新礼物未读」绝不并入 lit（否则筹备期会误触发开窗动画与亮灯）。
    const lit = save.opened.includes(d);
    // ready 表示「今天可以开但还没开」，必须是已解锁、有内容、且未开启。
    // 未读新礼物只作为独立提示（new_count），不改变 ready/lit 的开启语义。
    const isOpened = save.opened.includes(d);
    const ready = unlocked && !isOpened && hasAny;
    // 红点只在对应日期解锁后才可能出现：筹备期（含未解锁的未来格）一律不提示，
    // 既不误报、也不提前泄露「哪天有礼物」。解锁后若远程仍有未读礼物，才亮红点。
    const new_count = unlocked ? unreadIds.size : 0;
    cells.push({
      day: d,
      owners: ['ai', 'human'],
      open: unlocked,
      lit,
      opened_by: openedBy,
      hidden,
      gifts: giftsOut,
      new_count,
      ready,
    });
  }

  return {
    today,
    hour: parseInt(shanghaiParts().hour, 10),
    night: effectiveNight(),
    display: getDisplay(),
    smooth: getSmooth(),
    peeks: counts.san + counts.yan,
    peek_counts: counts,
    peek_events: events,
    peek_available: syncState.peekAvailable !== false,
    sync: { ...syncState },
    freeze: save.yanyan_freeze,
    cells,
    settings: save.settings,
  };
}

/* ── 写操作（touch / seen / answer / hide）────────────────────────── */

/** 取出某天的礼物内容（不产生任何开启记录），供正常开启与「偷看」共用 */
function giftsForDay(day) {
  const gifts = {};
  if (hasBuiltin(day)) {
    const yan = builtinGift(day);
    if (yan) {
      gifts.ai = { ...yan, day, author: 'ai', id: `builtin-yan-${day}`,
        answer: save.answers[`${day}:builtin-yan-${day}`] ?? save.answers[String(day)] };
    }
  }
  const humanList = save.human_gifts[String(day)] || [];
  const humanEntries = [];
  humanList.forEach((e, i) => {
    const normalized = normalizeEntry(e, `local-${day}-${i}`, { allowLocal: true });
    if (normalized) {
      normalized.day = day;
      normalized.answer = save.answers[`${day}:${normalized.id}`] || '';
      humanEntries.push(normalized);
    }
  });
  if (humanEntries.length) gifts.human_entries = humanEntries;

  const withAnswer = (entry) => ({ ...entry, answer: save.answers[`${day}:${entry.id || ''}`] || '' });
  const remoteExtras = (remoteData.yan.days[String(day)] || []).map(withAnswer);
  const localIds = new Set(humanEntries.map(e => e.id));
  const sannanExtras = (remoteData.san.days[String(day)] || [])
    .filter(e => !localIds.has(e.id)).map(withAnswer);
  const displayedIds = [...remoteExtras, ...sannanExtras].map(e => e.id).filter(Boolean);

  return { gifts, remote_extras: remoteExtras, sannan_extras: sannanExtras, displayed_remote_ids: displayedIds };
}

function touch(day) {
  if (!Number.isInteger(day) || day < 1 || day > 25) throw new Error('invalid day');
  const content = giftsForDay(day);
  if (!isUnlocked(day)) {
    // 偷看：按协议记录为 attempt（未解锁不能伪造成 read，保证双方对账可信），
    // 但按用户约定同时给出礼物内容供查看——不 markOpened，顶部开启数不变。
    recordPeek(day, save.settings.who === 'yan' ? 'yan' : 'san', 'attempt');
    return { open: false, peek: true, outcome: 'attempt', ...content };
  }
  markOpened(day);
  return { open: true, ...content };
}

function markOpened(day) {
  if (!save.opened.includes(day)) {
    save.opened.push(day);
    save.opened.sort((a, b) => a - b);
  }
  if (!save.opened_at[String(day)]) save.opened_at[String(day)] = shanghaiNowIso();
  persist();
}

function recordPeek(day, who, outcome) {
  const at = shanghaiNowIso();
  const id = (crypto.randomUUID ? crypto.randomUUID() : `peek-${Date.now()}-${Math.random()}`).replace(/-/g, '');
  save.peek_log.push({
    id: `peek-${id}`, day, who,
    peeked_at: at, at,
    outcome: outcome === 'read' ? 'read' : 'attempt',
  });
  save.peek_counts = peekCounts(save.peek_log);
  persist();
}

function seen(ids) {
  const known = new Set();
  for (const data of [remoteData.yan, remoteData.san]) {
    for (const entries of Object.values(data.days)) {
      for (const e of entries) if (e.id) known.add(e.id);
    }
  }
  const set = new Set(save.seen_remote_ids);
  for (const id of ids) if (typeof id === 'string' && id && known.has(id)) set.add(id);
  save.seen_remote_ids = [...set].sort();
  persist();
  return { ok: true };
}

function answer(day, giftId, text) {
  const clean = String(text || '').trim().slice(0, 4000);
  if (!clean) throw new Error('empty');
  const key = giftId ? `${parseInt(day, 10) || 0}:${String(giftId).slice(0, 160)}` : String(day);
  save.answers[key] = clean;
  persist();
  return { ok: true };
}

function hide(day, items, icon) {
  if (!Number.isInteger(day) || day < 1 || day > 25) throw new Error('invalid day');
  const cleanItems = (items || []).slice(0, 24).map(it => cleanItem(it, { allowLocal: true })).filter(Boolean);
  if (!cleanItems.length) throw new Error('至少要放一点内容进礼盒');
  const created = shanghaiNowIso();
  const id = `san-${(crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).replace(/-/g, '')}`;
  const entry = {
    id,
    created_at: created,
    at: created,
    title: `三三藏在第${day}天的礼物`,
    kind: icon || 'lettre',
    text: cleanItems.find(i => i.type === 'text')?.text || '',
    song: cleanItems.find(i => i.type === 'song')?.url || null,
    items_v2: cleanItems,
    published: false,
  };
  (save.human_gifts[String(day)] ||= []).push(entry);
  persist();
  return { ok: true, id };
}

function reply(day, giftId, text) {
  const clean = String(text || '').trim().slice(0, 4000);
  const d = parseInt(day, 10);
  if (!Number.isInteger(d) || d < 1 || d > 25 || !clean) throw new Error('回信内容不能为空');
  const created = shanghaiNowIso();
  const id = `reply-${(crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).replace(/-/g, '')}`;
  (save.human_gifts[String(d)] ||= []).push({ id, created_at:created, at:created, title:'写给这份礼物的回信', kind:'letter', reply_to:String(giftId||'').slice(0,160), text:clean, items_v2:[{type:'text',text:clean}], published:false });
  persist();
  return { ok:true, id };
}

/* ── 上传暂存（IndexedDB；发布时转存到仓库）──────────────────────── */

const IDB_NAME = 'advent-uploads';
const IDB_STORE = 'files';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key, blob) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key) {
  const db = await idb();
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function uploadFile(fileOrBlob) {
  const mime = (fileOrBlob.type || '').split(';')[0].toLowerCase();
  const ext = UPLOAD_MIME_EXT[mime];
  if (!ext) throw new Error(`不支持的文件类型：${mime || '未知'}`);
  if (fileOrBlob.size > MAX_UPLOAD_BYTES) throw new Error('文件超过 25MB 上限');
  const key = `${(crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).replace(/-/g, '')}${ext}`;
  await idbPut(key, fileOrBlob);
  return { url: `uploads/${key}` };
}

const objectUrlCache = new Map();

async function resolveMediaUrl(url) {
  if (!url) return null;
  if (isSafeLocalUploadUrl(url)) {
    const key = url.replace(/^\//, '').slice('uploads/'.length);
    if (!objectUrlCache.has(url)) {
      const blob = await idbGet(key);
      if (!blob) return null;
      objectUrlCache.set(url, URL.createObjectURL(blob));
    }
    return objectUrlCache.get(url);
  }
  if (isAllowedRemoteAsset(url)) return url; // raw.githubusercontent.com 可直接加载
  return null;
}

/* ── GitHub 发布（对应 /api/publish，需用户会话内提供 PAT）────────── */

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghGetFile(token, repoPath) {
  const res = await fetch(`${CONFIG.ghApiBase()}${encodeURIComponent(repoPath).replace(/%2F/g, '/')}?ref=${CONFIG.BRANCH}`, {
    headers: ghHeaders(token),
  });
  if (res.status === 404) return { content: null, sha: null };
  if (!res.ok) throw Object.assign(new Error(`GitHub ${res.status}`), { status: res.status });
  const meta = await res.json();
  const content = meta.content ? b64ToBytes(meta.content.replace(/\n/g, '')) : null;
  return { content, sha: meta.sha };
}

async function ghPutFile(token, repoPath, bytes, message, sha) {
  const res = await fetch(`${CONFIG.ghApiBase()}${encodeURIComponent(repoPath).replace(/%2F/g, '/')}`, {
    method: 'PUT',
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: bytesToB64(bytes),
      branch: CONFIG.BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw Object.assign(new Error(`GitHub ${res.status}`), { status: res.status });
  return res.json();
}

function commitStamp() {
  const p = shanghaiParts();
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

async function publishLocalAsset(token, url) {
  if (!isAllowedRemoteAsset(url)) {
    if (!isSafeLocalUploadUrl(url)) throw new Error('unsupported asset URL');
  } else {
    return url; // 已是仓库资源
  }
  const key = url.replace(/^\//, '').slice('uploads/'.length);
  const blob = await idbGet(key);
  if (!blob) throw new Error(`本地资源缺失：${key}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new Error(`资源大小不合法：${key}`);
  const ext = key.slice(key.lastIndexOf('.')).toLowerCase();
  if (!REMOTE_MEDIA_EXTENSIONS.has(ext)) throw new Error(`资源类型不合法：${ext}`);
  const digest = await sha256Hex(bytes);
  const repoPath = `assets/sannan/${digest}${ext}`;

  let existing = null, sha = null;
  try {
    ({ content: existing, sha } = await ghGetFile(token, repoPath));
  } catch (e) { if (e.status !== 404) throw e; }
  if (existing == null) {
    try {
      await ghPutFile(token, repoPath, bytes, `Add sannan gift asset ${digest.slice(0, 12)}`, sha);
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      // 并发冲突：重读，若已存在同路径则视为成功
      const again = await ghGetFile(token, repoPath);
      if (again.content == null) throw e;
    }
  } else {
    const existingHex = await sha256Hex(existing);
    if (existingHex !== digest) throw new Error('remote asset hash mismatch');
  }
  const rawUrl = `${CONFIG.rawAssetPrefix}sannan/${digest}${ext}`;
  await idbDelete(key); // 已转存仓库，释放本地暂存
  return rawUrl;
}

function mergeDayPayloads(remote, local) {
  const merged = normalizeDays(remote, { allowLocal: false });
  for (const [day, entries] of Object.entries(local.days || {})) {
    const existing = new Map((merged.days[day] || []).map(e => [e.id, e]));
    for (const entry of entries) existing.set(entry.id, entry);
    merged.days[day] = [...existing.values()];
  }
  return merged;
}

function indexFromDays(daysObj, author) {
  const days = {};
  for (const [day, entries] of Object.entries(daysObj.days || {})) {
    days[day] = entries.map(e => ({ id: e.id, created_at: e.created_at || '' }));
  }
  return { version: 1, author, updated_at: shanghaiNowIso(), days };
}

async function publishAll(onProgress) {
  const token = sessionStorage.getItem(PAT_KEY);
  if (!token) throw Object.assign(new Error('需要 GitHub Token'), { status: 401 });
  const progress = (msg) => { try { onProgress?.(msg); } catch { /* ignore */ } };

  try {
    /* 1. 上传本地暂存资源 → assets/sannan/<sha256>.<ext> */
    progress('正在上传图片与音频资源…');
    for (const [dayStr, entries] of Object.entries(save.human_gifts)) {
      for (const entry of entries) {
        if (!entry.items_v2) continue;
        for (const item of entry.items_v2) {
          if (['image', 'voice', 'audio', 'attachment'].includes(item.type) && item.url) {
            item.url = await publishLocalAsset(token, item.url);
          }
          if (item.type === 'photo' && item.photo?.front?.url) item.photo.front.url = await publishLocalAsset(token, item.photo.front.url);
          if (item.type === 'comic' && Array.isArray(item.comic?.pages)) for (const page of item.comic.pages) page.url = await publishLocalAsset(token, page.url);
          if (item.type === 'scrapbook' && Array.isArray(item.layout?.stickers)) for (const sticker of item.layout.stickers) if (sticker.src) sticker.src = await publishLocalAsset(token, sticker.src);
        }
      }
    }

    /* 2. 合并 sannan_gifts.json（带冲突重试，不覆盖定时任务刚提交的数据） */
    progress('正在合并礼物数据…');
    const localDays = { days: {} };
    for (const [dayStr, entries] of Object.entries(save.human_gifts)) {
      const output = [];
      entries.forEach((raw, i) => {
        const entry = normalizeEntry(raw, `san-${dayStr}-${i}`, { allowLocal: true });
        if (!entry) return;
        entry.from = '三三';
        entry.text = entry.items_v2.find(x => x.type === 'text')?.text || '';
        entry.song = entry.items_v2.find(x => x.type === 'song')?.url || null;
        entry.items = entry.items_v2;
        output.push(entry);
      });
      if (output.length) localDays.days[dayStr] = output;
    }

    let merged = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { content, sha } = await ghGetFile(token, 'sannan_gifts.json');
      let remote = { days: {} };
      if (content) {
        const wrapper = JSON.parse(new TextDecoder().decode(content));
        remote = decodePayload(wrapper.payload, SAN_DIGEST);
      }
      merged = mergeDayPayloads(remote, localDays);
      const outWrapper = {
        version: 2,
        updated_at: shanghaiNowIso(),
        protocol: 'advent-gifts-v3.2',
        payload: encodePayload(merged, SAN_DIGEST),
      };
      try {
        await ghPutFile(token, 'sannan_gifts.json',
          new TextEncoder().encode(JSON.stringify(outWrapper, null, 2)),
          `Update sannan gifts (${commitStamp()})`, sha);
        break;
      } catch (e) {
        if ((e.status !== 409 && e.status !== 422) || attempt === 3) throw e;
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      }
    }

    /* 非必要步骤：失败只记录告警，不阻断礼物本体与后续步骤（可独立修复重试） */
    const warnings = [];
    const softStep = async (label, fn) => { try { await fn(); } catch (e) { warnings.push(`${label}：${e.message || e}`); } };

    /* 3. 更新无内容索引（独立于礼物本体；失败不影响已写入的礼物） */
    const index = indexFromDays(merged, 'san');
    await softStep('礼物索引', async () => {
      progress('正在更新礼物索引…');
      for (let attempt = 0; attempt < 4; attempt++) {
        const { sha } = await ghGetFile(token, 'gift_index_sannan.json');
        try {
          await ghPutFile(token, 'gift_index_sannan.json',
            new TextEncoder().encode(JSON.stringify(index, null, 2)),
            `Update sannan gift index (${commitStamp()})`, sha);
          break;
        } catch (e) {
          if ((e.status !== 409 && e.status !== 422) || attempt === 3) throw e;
          await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
        }
      }
    });

    /* 4. 同步书桌状态（便签/相框/收藏），独立于正式礼物与解锁规则 */
    await softStep('书桌状态', async () => {
      progress('正在同步圣诞书桌…');
      for(const frame of Object.values(save.companion.frames||{}))if(frame?.src)frame.src=await publishLocalAsset(token,frame.src);
      for(let attempt=0;attempt<4;attempt++){
        const {content,sha}=await ghGetFile(token,'companion_state.json');let remote={notes:{},frames:{},favorites:{}};
        if(content){try{const wrapper=JSON.parse(new TextDecoder().decode(content));remote=decodeRaw(wrapper.payload,SAN_DIGEST);}catch{/* 首次或损坏时以本地安全结构重建 */}}
        mergeCompanionState(remote);const wrapper={version:1,updated_at:shanghaiNowIso(),protocol:'advent-companion-v1',payload:encodePayload(save.companion,SAN_DIGEST)};
        try{await ghPutFile(token,'companion_state.json',new TextEncoder().encode(JSON.stringify(wrapper,null,2)),`Update companion state (${commitStamp()})`,sha);break;}catch(e){if((e.status!==409&&e.status!==422)||attempt===3)throw e;await new Promise(r=>setTimeout(r,300*(attempt+1)));}
      }
    });

    /* 4. 合并偷看记录（读取远端 → 合并双方历史 → 写回），独立于礼物本体 */
    await softStep('偷看记录', async () => {
      progress('正在合并偷看记录…');
      const localPeeks = mergePeekEvents(save.peek_log);
      for (let attempt = 0; attempt < 4; attempt++) {
        const { content, sha } = await ghGetFile(token, 'peek_log.json');
        let current = {};
        if (content) {
          try { current = JSON.parse(new TextDecoder().decode(content)); } catch { current = {}; }
        }
        const mergedPeeks = {
          version: 2,
          updated_at: shanghaiNowIso(),
          events: mergePeekEvents(current, localPeeks),
        };
        try {
          await ghPutFile(token, 'peek_log.json',
            new TextEncoder().encode(JSON.stringify(mergedPeeks, null, 2)),
            `Merge peek log (${commitStamp()})`, sha);
          save.peek_log = mergePeekEvents(save.peek_log, mergedPeeks.events);
          save.peek_counts = peekCounts(save.peek_log);
          break;
        } catch (e) {
          if ((e.status !== 409 && e.status !== 422) || attempt === 3) throw e;
          await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
        }
      }
    });

    /* 5. 标记本地条目已发布并持久化 */
    for (const entries of Object.values(save.human_gifts)) {
      for (const entry of entries) entry.published = true;
    }
    remoteData.san = normalizeDays(merged, { allowLocal: false });
    remoteIndexes.san = index;
    persist();
    writeRemoteCache();

    return { message: warnings.length
      ? `礼物已发布；部分附带数据未同步（${warnings.join('；')}），可稍后重试，礼物不会重复追加`
      : '礼物、资源、索引与偷看记录均已发布', warnings };
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      sessionStorage.removeItem(PAT_KEY); // Token 无效：清除本次会话凭据
      throw new Error('Token 无效或没有该仓库的写入权限（401/403），请检查 Fine-grained PAT 授权');
    }
    throw e;
  }
}

function setPat(token) {
  const clean = String(token || '').trim();
  if (!clean) throw new Error('Token 不能为空');
  sessionStorage.setItem(PAT_KEY, clean);
}

function hasPat() { return Boolean(sessionStorage.getItem(PAT_KEY)); }

/* ── 身份记名（偷看事件归属）──────────────────────────────────────── */

function getWho() { return save.settings.who === 'yan' ? 'yan' : 'san'; }
function setWho(who) {
  save.settings.who = who === 'yan' ? 'yan' : 'san';
  persist();
  return getWho();
}

function cleanCompanionValue(group,value){if(!value||typeof value!=='object')return null;if(group==='notes')return{text:String(value.text||'').slice(0,280),who:value.who==='yan'?'yan':'san',updated_at:String(value.updated_at||'').slice(0,80)};if(group==='favorites')return{id:String(value.id||'').slice(0,160),day:clamp(value.day,1,25,1),updated_at:String(value.updated_at||'').slice(0,80)};if(group==='frames'){const src=String(value.src||'').slice(0,1000);return{src:(isAllowedRemoteAsset(src)||isSafeLocalUploadUrl(src))?src:'',note:String(value.note||'').slice(0,1000),updated_at:String(value.updated_at||'').slice(0,80)};}return null;}
function mergeCompanionState(remote){for(const group of ['notes','frames','favorites']){save.companion[group]||={};for(const [key,value] of Object.entries(remote?.[group]||{}).slice(0,500)){const clean=cleanCompanionValue(group,value);if(!clean)continue;const local=save.companion[group][key];if(!local||String(clean.updated_at||'')>String(local?.updated_at||''))save.companion[group][String(key).slice(0,200)]=clean;}}persist();return save.companion;}
function getCompanion(){return structuredClone(save.companion);}
function setCompanion(group,key,value){if(!['notes','frames','favorites'].includes(group))throw new Error('invalid companion group');save.companion[group]||={};if(value===null)delete save.companion[group][String(key)];else{const clean=cleanCompanionValue(group,{...value,updated_at:shanghaiNowIso()});if(!clean)throw new Error('invalid companion value');save.companion[group][String(key).slice(0,200)]=clean;}persist();return getCompanion();}

/* ── 导出接口（app.js 调用）───────────────────────────────────────── */

export const Backend = {
  init() { /* 状态已在模块加载时恢复 */ },
  getBoard,
  sync: syncAll,
  touch,
  seen,
  answer,
  reply,
  hide,
  uploadFile,
  resolveMediaUrl,
  isAllowedRemoteAsset,
  isAllowedAssetUrl,
  publish: publishAll,
  setPat,
  hasPat,
  getWho,
  setWho,
  getCompanion,
  setCompanion,
  getDisplay,
  setDisplay,
  getSmooth,
  setSmooth,
  isNight: effectiveNight,
  shanghaiNowIso,
};
