/**
 * app.js — 砚砚 × 三三 · 双人降临历前端主逻辑
 *
 * 网页版说明（GitHub Pages 静态移植）：
 * - 原本由 Python 后端提供的接口（board/touch/seen/answer/hide/sync/publish/upload）
 *   全部由 backend.js 在浏览器端等价实现，本文件的 UI 逻辑保持原样
 * - GitHub PAT 默认只保存在当前标签页；只有用户明确勾选时才明文保存到 localStorage
 * - data/ 状态保存在浏览器 localStorage，上传媒体暂存 IndexedDB
 */

/* 版本号与 index.html 保持一致：每次发布同步更新，强制移动 Safari 重新拉取（它缓存较强） */
import { mountHouse, iconSvg } from './house.js?v=8.2.0';
import { Backend } from './backend.js?v=8.2.0';
import { mountStickerLibrary } from './stickers.js?v=8.2.0';

/* ── 常量 ─────────────────────────────────────────────────────────── */
const TZ = 'Asia/Shanghai';
const YEAR = 2026;
const BIRTHDAY = { month: 12, day: 25 };

function shanghaiDateParts() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const out = {}; for (const p of parts) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}
function daysUntilBirthday() {
  const p = shanghaiDateParts();
  const todayUtc = Date.UTC(p.year, p.month - 1, p.day);
  let targetUtc = Date.UTC(p.year, BIRTHDAY.month - 1, BIRTHDAY.day);
  if (targetUtc < todayUtc) targetUtc = Date.UTC(p.year + 1, BIRTHDAY.month - 1, BIRTHDAY.day);
  return Math.round((targetUtc - todayUtc) / 86400000);
}

/* ── 时间工具 ─────────────────────────────────────────────────────── */
// 夜间判断统一由 backend 按 Asia/Shanghai + 显示模式计算，避免设备时区差异与重复逻辑
function isNight() {
  try { return Backend.isNight(); } catch { return false; }
}

/* ── Toast ───────────────────────────────────────────────────────── */
let _toastTimer;
function toast(msg, ms = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ── 状态 ────────────────────────────────────────────────────────── */
let board = null;
let houseCtrl = null;

function closeMainOverlay() {
  const overlay = document.getElementById('overlay');
  if (!overlay) return;
  /* 清理手账素材库定时器，避免浮层关闭后仍在后台刷新（iPad Safari 性能） */
  try { window.__advStklibDispose?.(); window.__advStklibDispose = null; } catch {}
  overlay.classList.remove('on');
  overlay.style.display = 'none';
  overlay.innerHTML = '';
}

/* ── 房子挂载 ────────────────────────────────────────────────────── */
function mountStage() {
  const stage = document.getElementById('stage');
  houseCtrl = mountHouse(stage, {
    assets: {
      house: 'assets/house.webp',
      ginger: 'assets/ginger.webp',
      bells: 'assets/bells.webp',
      pinecone: 'assets/pinecone.webp',
    },
    sprites: {
      sweep: 'sprites/star-sweep.svg',
      walk: 'sprites/star-walk.svg',
      happy: 'sprites/star-happy.svg',
      heart: 'sprites/star-heart.svg',
      carry: 'sprites/star-carry.svg',
    },
    onTap: (day) => onWindowTap(day),
    labels: {
      day: (d, st) => `12月${d}日` + (st === 'open' ? '（已开）' : st === 'ready' ? '（今天）' : ''),
    },
  });
}

/* ── 刷新界面 ────────────────────────────────────────────────────── */
function refresh() {
  if (!board || !houseCtrl) return;

  const { today, night, display, smooth, peeks, peek_counts: peekCounts = {}, cells, sync, peek_available: peekAvailable = true, gift_stats: giftStats, companion, public_tracks: publicTracks = [] } = board;

  // 顶栏：已开启数量严格以 opened_by 为准（与格子亮灯同源，杜绝「亮灯但计数0」）
  document.getElementById('topDay').textContent = today || '—';
  const opened = cells.filter(c => Object.values(c.opened_by || {}).length > 0).length;
  // 偷看记录读取失败时显示「?」，不得把未知伪装成已确认的 0 次
  const peekLabel = peekAvailable ? `三三 ${peekCounts.san || 0} / 砚砚 ${peekCounts.yan || 0}` : '偷看记录待同步';
  document.getElementById('topStars').textContent = `★ ${opened} · ${peekLabel}`;

  // 书桌默认态：不改变旧协议，只把已有看板信息投影成实体物件
  const deskDay = document.getElementById('deskDay');
  const deskDate = document.getElementById('deskDate');
  const deskCountdown = document.getElementById('deskCountdown');
  const deskMailStatus = document.getElementById('deskMailStatus');
  if (deskDay) deskDay.textContent = today || '—';
  if (deskDate) deskDate.textContent = today ? `12 月 ${today} 日 · 北京时间` : '十二月 · 北京时间';
  if (deskCountdown) {
    const birthdayDays = daysUntilBirthday();
    deskCountdown.textContent = birthdayDays === 0 ? '圣诞快乐 · 生日快乐 🎂' : `距离圣诞与生日还有 ${birthdayDays} 天`;
  }
  if (deskMailStatus) {
    const post = board?.post_office || {};
    const latest = post.latest;
    deskMailStatus.textContent = `总 ${post.total_deliveries || 0} · 砚 ${post.yan_deliveries || 0} · 三 ${post.san_deliveries || 0} · 未读 ${post.unread_count || 0}`;
    const latestLine = document.getElementById('deskMailLatest');
    if (latestLine) {
      const latestTime = latest
        ? new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(latest.created_at))
        : '';
      latestLine.textContent = latest
        ? `近7天 ${post.recent_count || 0} · ${latestTime} ${latest.actor_name}${EVENT_TYPE_LABELS[latest.event_type] || latest.event_type}`
        : `近7天 ${post.recent_count || 0} · 暂无投递活动`;
    }
    const mailButton = document.getElementById('deskMail');
    if (mailButton) mailButton.title = latest ? `${formatShanghai(latest.created_at)} · ${latest.actor_name}${EVENT_TYPE_LABELS[latest.event_type] || latest.event_type}「${latest.title || '一份礼物'}」` : '成功投递后，真实活动会出现在这里';
  }
  renderGiftStats(giftStats);
  renderDeskSurface(companion, publicTracks, sync);

  // 偷看提示：读取失败时不宣称 0 次，避免出现「已确认无人偷看」的误导
  const peekEl = document.getElementById('peekLine');
  if (!peekAvailable) peekEl.textContent = '偷看记录暂时无法读取，显示的次数仅供参考。';
  else peekEl.textContent = peeks > 0 ? `泡芙记下了 ${peeks} 次偷看：三三 ${peekCounts.san || 0}，砚砚 ${peekCounts.yan || 0}。` : '';

  // 显示模式（自动 / 白昼 / 夜间）与流畅模式：统一作用于页面与房子
  const page = document.getElementById('page');
  page.classList.toggle('dusk', night);
  document.body.classList.toggle('adv-night', night);
  page.classList.toggle('adv-smooth', !!smooth);
  // overlay 是 body 的直接子元素，流畅模式也作用于浮层内的礼物卡（黑胶停转等）
  document.body.classList.toggle('adv-smooth', !!smooth);
  applyDisplayButton(display);
  applySmoothButton(smooth);
  houseCtrl.configure({ night: !!night, smooth: !!smooth });

  // 渲染 house：lit 严格 = 已开启（backend 已保证），ready = 今天可开未开；新增礼物只走 new_count 提示
  houseCtrl.set({
    today,
    night: !!night,
    cells: cells.map(c => ({
      day: c.day,
      lit: c.lit,
      ready: Boolean(c.ready),
      isNew: (c.new_count || 0) > 0,
      who: (c.hidden?.ai && c.hidden?.human) ? 'both' : c.hidden?.human ? 'human' : c.hidden?.ai ? 'ai' : null,
      hidden: c.hidden,
    })),
  });

  // 同步状态栏：使用后端给出的明确原因，而非笼统的「部分离线缓存」
  applySyncStatus(sync);
}

const pileLevels = new Map();
function renderGiftStats(stats) {
  const yanEl = document.getElementById('yanGiftCount');
  const sanEl = document.getElementById('sanGiftCount');
  const summary = document.getElementById('giftSummary');
  const status = document.getElementById('giftStatsStatus');
  if (!yanEl || !sanEl || !summary || !status || !stats) return;
  const updatePile = (name, countEl, known, count) => {
    countEl.textContent = known ? String(count) : '—';
    const pile = countEl.closest('.adv-gift-pile');
    if (!pile) return;
    let boxes = pile.querySelector('.adv-pile-boxes');
    if (!boxes) {
      boxes = document.createElement('div'); boxes.className = 'adv-pile-boxes';
      pile.querySelector('.adv-pile-scene').appendChild(boxes);
    }
    if (!boxes.children.length) {
      for (let i = 0; i < 8; i++) {
        const box = document.createElement('span'); box.className = 'adv-pile-box'; boxes.appendChild(box);
      }
    }
    const level = known && count > 0 ? Math.max(1, Math.min(7, Math.ceil(count / 4))) : 0;
    pile.dataset.level = String(level);
    const previous = pileLevels.get(name) ?? 0;
    pileLevels.set(name, known ? count : previous);
    if (known && count > previous && previous > 0 && !document.body.classList.contains('adv-smooth')) {
      boxes.classList.remove('pile-grow'); void boxes.offsetWidth; boxes.classList.add('pile-grow');
      setTimeout(() => boxes.classList.remove('pile-grow'), 420);
    }
  };
  updatePile('yan', yanEl, Boolean(stats.yan?.known), stats.yan?.total || 0);
  updatePile('san', sanEl, Boolean(stats.san?.known), stats.san?.total || 0);
  const complete = Boolean(stats.yan?.known && stats.san?.known);
  const cached = !complete || !stats.fresh;
  status.textContent = !stats.known ? '统计暂不可用' : cached ? '缓存统计 · 等待完整同步' : '已按礼物编号去重';
  status.title = stats.updatedAt ? `统计时间：${new Date(stats.updatedAt).toLocaleString('zh-CN')}` : '';
  summary.replaceChildren();
  const entries = [
    ['合计', complete ? stats.total : '—'],
    ['正式揭晓', complete ? stats.revealed : '—'],
    ['尚未揭晓', complete ? stats.unrevealed : '—'],
    ['本地未发布', board?.settings?.who === 'san' ? stats.local || 0 : '仅当前编辑者可见'],
  ];
  for (const [label, value] of entries) {
    const span = document.createElement('span');
    const strong = document.createElement('b'); strong.textContent = String(value);
    span.append(label + ' ', strong); summary.appendChild(span);
  }
  summary.classList.toggle('is-cache', cached);
}

function renderDeskSurface(companion, tracks, sync) {
  const frameSlot = document.getElementById('deskFrameSlot');
  const noteSlot = document.getElementById('deskNoteSlot');
  const trackName = document.getElementById('deskTrackName');
  const trackCard = document.getElementById('deskRecordCard');
  if (!frameSlot || !noteSlot || !trackName || !trackCard) return;
  const frames = Object.values(companion?.frames || {}).filter(frame => frame?.src)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const frame = frames[0];
  frameSlot.replaceChildren();
  if (frame && ['succeeded', 'empty'].includes(sync?.sources?.companion_state?.state)) {
    const img = document.createElement('img'); img.alt = '共享桌面照片'; img.loading = 'lazy';
    Backend.resolveMediaUrl(frame.src).then(src => { if (src && frameSlot.isConnected) img.src = src; }).catch(() => {
      if (frameSlot.isConnected) frameSlot.textContent = '照片暂时无法载入';
    });
    const note = document.createElement('small'); note.textContent = frame.note || '我们的桌面照片';
    frameSlot.append(img, note);
  } else {
    const empty = document.createElement('div'); empty.className = 'adv-empty-frame'; empty.textContent = '♡';
    const small = document.createElement('small'); small.textContent = '等一张公开的桌面照片';
    frameSlot.append(empty, small);
  }
  const notes = Object.values(companion?.notes || {}).filter(note => note?.text)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const note = notes[0];
  noteSlot.replaceChildren();
  if (note && ['succeeded', 'empty'].includes(sync?.sources?.companion_state?.state)) {
    const by = document.createElement('div'); by.className = 'adv-empty-note';
    by.textContent = note.who === 'yan' ? 'de 砚砚' : 'de 三三';
    const text = document.createElement('span'); text.textContent = note.text;
    noteSlot.append(by, text);
  } else {
    const empty = document.createElement('div'); empty.className = 'adv-empty-note';
    empty.append(document.createTextNode("aujourd'hui "));
    const text = document.createElement('span'); text.textContent = '把小小的日常留在桌上'; empty.appendChild(text);
    noteSlot.appendChild(empty);
  }
  const current = board?._playingTrack || tracks[0];
  trackName.textContent = current?.name || (tracks.length ? tracks[0].name : '冬日留声机');
  trackCard.title = tracks.length ? '打开已公开的音频' : '打开圣诞唱片机';
}

/* ── 显示模式 / 流畅模式 / 同步状态 ─────────────────────────────── */
const DISPLAY_LABEL = { auto: '☾ 自动', day: '☀ 白昼', night: '✦ 夜间' };
function applyDisplayButton(display) {
  const btn = document.getElementById('displayBtn');
  if (!btn) return;
  btn.textContent = DISPLAY_LABEL[display] || DISPLAY_LABEL.auto;
  btn.dataset.mode = display || 'auto';
}
function applySmoothButton(smooth) {
  const btn = document.getElementById('smoothBtn');
  if (!btn) return;
  btn.textContent = smooth ? '⚡ 流畅 · 开' : '⚡ 流畅 · 关';
  btn.classList.toggle('gold', !!smooth);
}
function applySyncStatus(sync) {
  const el = document.getElementById('syncLine');
  if (!el) return;
  if (!sync || !sync.state || sync.state === 'idle') { el.textContent = '尚未同步'; el.removeAttribute('title'); return; }
  if (sync.state === 'syncing') { el.textContent = '正在同步…'; el.removeAttribute('title'); return; }
  let stamp = '';
  try { if (sync.finished_at) stamp = new Date(sync.finished_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); } catch { /* ignore */ }
  const prefix = sync.state === 'succeeded' ? '已同步' : sync.state === 'partial' ? '部分离线' : '离线缓存';
  el.textContent = `${prefix} · ${sync.message || ''}${stamp ? ' · ' + stamp : ''}`;
  const src = sync.sources || {};
  const details = Object.entries(src).map(([k, v]) => `${k}：${v.label || v.state}`).join('\n');
  if (details) el.title = details; else el.removeAttribute('title');
}

/* ── 身份记名（偷看事件归属）────────────────────────────────────── */
function refreshWhoBtn() {
  const btn = document.getElementById('whoBtn');
  if (btn) btn.textContent = Backend.getWho() === 'yan' ? '偷看记名：砚砚' : '偷看记名：三三';
  const writerBtn = document.getElementById('writerBtn');
  const name = Backend.getWriter() === 'yan' ? '砚砚' : '三三';
  if (writerBtn) writerBtn.textContent = `写礼物：${name}`;
  const writeLabel = document.querySelector('#deskWrite b');
  if (writeLabel) writeLabel.textContent = `✎ ${name}藏一份礼物`;
}

/* ── 拉取看板 ────────────────────────────────────────────────────── */
async function loadBoard() {
  try {
    board = Backend.getBoard();
    refresh();
  } catch (e) {
    console.error('loadBoard:', e);
  }
}

/* ── 同步 ─────────────────────────────────────────────────────────── */
let _syncLock = false;
async function syncRemote() {
  if (_syncLock) return;
  _syncLock = true;
  applySyncStatus({ state: 'syncing' });
  try {
    await Backend.sync();            // Backend 内部有并发锁；失败来源已带明确原因
    board = Backend.getBoard();
    refresh();                        // refresh 会调用 applySyncStatus 展示明确状态
  } catch (e) {
    applySyncStatus({ state: 'offline_cache', message: '同步失败：' + (e.message || '未知错误') });
    toast(e.message || '同步失败');
  } finally {
    _syncLock = false;
  }
}

/* ── 点窗 ─────────────────────────────────────────────────────────── */
async function onWindowTap(day) {
  let result;
  try {
    result = Backend.touch(day);
  } catch (e) {
    toast(e.message);
    return;
  }

  if (!result.open) {
    // 偷看：记一笔 attempt，同时把内容显示给你看（但不算正式开启，顶部计数不变）
    board = Backend.getBoard();
    refresh();
    houseCtrl?.rattle?.(day, `偷看 · 泡芙已记下`);
    const rect = { left: innerWidth / 2 - 20, top: innerHeight / 2 - 20, width: 40, height: 40 };
    showGiftCard(day, result.gifts, result.remote_extras || [], result.sannan_extras || [], rect, null);
    requestAnimationFrame(() => {
      const overlay = document.getElementById('overlay');
      const fd = overlay?.querySelector('.adv-front .fby');
      if (fd) fd.textContent = 'un regard en cachette · 偷看';
      const fh = overlay?.querySelector('.adv-front .fhint');
      if (fh) fh.textContent = '偷看已记下 · 轻触翻开';
      const hint = overlay?.querySelector('.adv-row .adv-hint');
      if (hint) hint.textContent = '偷看不算开启，窗仍会在当天亮';
    });
    return;
  }

  // 开窗动画 + 显示礼物卡
  const opening = result.firstOpen
    ? await (houseCtrl?.play?.(day) ?? { rect: { left: 0, top: 0, width: 0, height: 0 }, done: null })
    : { rect: houseCtrl?.rectOf?.(day) || { left: innerWidth / 2 - 20, top: innerHeight / 2 - 20, width: 40, height: 40 }, done: null };
  const { rect, done } = opening;
  board = Backend.getBoard();
  refresh();
  showGiftCard(day, result.gifts, result.remote_extras || [], result.sannan_extras || [], rect, done);
  if (result.displayed_remote_ids?.length) {
    Backend.seen(result.displayed_remote_ids);
    loadBoard();
  }
}

/* ── 礼物卡 ───────────────────────────────────────────────────────── */
function showGiftCard(day, gifts, remoteExtras, sannanExtras, rect, doneFn, overlayId) {
  const overlay = document.getElementById(overlayId || 'overlay');
  overlay.innerHTML = '';
  overlay.style.display = 'flex';

  const box = document.createElement('div');
  box.className = 'adv-cardbox';

  const xcard = document.createElement('div');
  xcard.className = 'adv-xcard';

  /* ── 正面（封蜡印） ── */
  const front = document.createElement('div');
  front.className = 'adv-face adv-front';
  front.setAttribute('role', 'button');
  front.setAttribute('tabindex', '0');
  front.setAttribute('aria-label', '点击打开礼物');
  front.innerHTML = `
    <svg class="fseal" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="26" fill="#b3893f"/>
      <circle cx="32" cy="32" r="21" fill="none" stroke="#8a6526" stroke-width="1.5"/>
      <path d="M32 18l3.2 8.6 9.1.4-7.1 5.7 2.4 8.8L32 36.6l-7.6 4.9 2.4-8.8-7.1-5.7 9.1-.4z"
            fill="#f0d796" opacity=".9"/>
    </svg>
    <div class="fd">${day} déc.</div>
    <div class="fby">de la part de 砚砚</div>
    <div class="fhint">轻触打开</div>
  `;

  /* ── 背面（信纸） ── */
  const back = document.createElement('div');
  back.className = 'adv-face adv-back adv-paper';

  const frame = document.createElement('div');
  frame.className = 'adv-frame';

  /* 卡头 */
  const ctop = document.createElement('div');
  ctop.className = 'adv-ctop';
  ctop.innerHTML = `<span class="d">${day} déc.</span><span class="by">砚砚 × 三三</span>`;
  frame.appendChild(ctop);

  /* 礼物内容区 */
  const body = document.createElement('div');
  body.className = 'adv-body';
  const giftSections = [];

  /* 渲染砚砚的礼物 */
  const yanGift = gifts?.ai;
  if (yanGift) {
    const yanSection = document.createElement('section');
    yanSection.className = 'adv-envelope-content';
    const pic = document.createElement('div');
    pic.className = 'adv-pic';
    const iconKey = kindToIcon(yanGift.kind || yanGift.icon);
    pic.innerHTML = iconSvg(iconKey);
    yanSection.appendChild(pic);

    for (const item of yanGift.items || []) {
      renderItem(yanSection, item, day, 'ai', yanGift.answer, yanGift.id || `builtin-yan-${day}`);
    }

    if (yanGift.note) {
      const note = document.createElement('div');
      note.className = 'adv-note';
      note.textContent = yanGift.note;
      yanSection.appendChild(note);
    }
    if (overlay?.id !== 'selfPreviewOverlay') appendMemoryActions(yanSection, yanGift.id || `builtin-yan-${day}`, day);
    body.appendChild(yanSection);
    giftSections.push({ el: yanSection, title: yanGift.title || '砚砚的礼物', fresh: false });
  }

  /* 砚砚的远程追加 */
  for (const entry of remoteExtras) {
    const el = renderRemoteEntry(body, entry, '砚砚后来追加', day);
    if (el) giftSections.push({ el, title: entry.title || '追加礼物', fresh: true });
  }

  /* 三三本地礼物 */
  const sanEntries = gifts?.human_entries || (gifts?.human ? [gifts.human] : []);
  for (const sanGift of sanEntries) {
    const el = renderHalf(body, sanGift, '三三放进来的');
    if (el) giftSections.push({ el, title: sanGift.title || '三三的礼物', fresh: false });
  }

  /* 三三的远程礼物 */
  for (const entry of sannanExtras) {
    const el = renderRemoteEntry(body, entry, '三三放进来的', day);
    if (el) giftSections.push({ el, title: entry.title || '三三追加', fresh: true });
  }

  /* ── 风琴包：组装文件夹 ── */
  buildAccordion(body, giftSections);

  frame.appendChild(body);

  /* 操作行 */
  const row = document.createElement('div');
  row.className = 'adv-row';
  const hint = document.createElement('span');
  hint.className = 'adv-hint';
  hint.textContent = '窗会一直亮着';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'adv-btn';
  closeBtn.textContent = '关上';
  closeBtn.onclick = closeCard;
  row.appendChild(hint);
  row.appendChild(closeBtn);
  frame.appendChild(row);

  back.appendChild(frame);
  xcard.appendChild(front);
  xcard.appendChild(back);
  box.appendChild(xcard);
  overlay.appendChild(box);

  /* 入场动画 */
  if (overlay?.id === 'selfPreviewOverlay') overlay.classList.add('on');
  else requestAnimationFrame(() => {
    const cr = box.getBoundingClientRect();
    const from = `translate(${rect.left + rect.width / 2 - (cr.left + cr.width / 2)}px,${rect.top + rect.height / 2 - (cr.top + cr.height / 2)}px) scale(${rect.width / cr.width || 0.1},${rect.height / cr.height || 0.1})`;
    box.animate(
      [{ transform: from, opacity: 0.3 }, { transform: 'none', opacity: 1 }],
      { duration: 480, easing: 'cubic-bezier(.2,.9,.25,1)' }
    );
    overlay.classList.add('on');
  });

  /* 翻开正面 */
  const flip = () => xcard.classList.add('flipped');
  front.onclick = flip;
  front.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };

  /* 关闭 */
  overlay.onclick = e => { if (e.target === overlay) closeCard(); };
  document.addEventListener('keydown', escHandler);

  function escHandler(e) { if (e.key === 'Escape') closeCard(); }
  function closeCard() {
    document.removeEventListener('keydown', escHandler);
    overlay.classList.remove('on');
    if (doneFn) doneFn();
    const a = box.animate(
      [{ transform: 'none', opacity: 1 }, { transform: 'scale(.85)', opacity: 0 }],
      { duration: 280, easing: 'ease-in' }
    );
    a.onfinish = () => { overlay.style.display = 'none'; overlay.innerHTML = ''; };
  }
}

/* ── 对方视角预览：把当前编辑器内容当作对方打开礼物时看到的样子展示 ──
   只读预览，不写入存档、不记录开启/偷看，不改动真实礼物。 */
function showSelfPreview(day, items) {
  const existing = document.getElementById('selfPreviewOverlay');
  if (existing) existing.remove();
  const host = document.createElement('div');
  host.className = 'adv-zoom adv-self-preview';
  host.id = 'selfPreviewOverlay';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', '对方视角预览');
  host.style.zIndex = '1280';
  document.body.appendChild(host);
  const editor = document.getElementById('overlay');
  if (editor) editor.classList.add('is-preview-underlay');

  const writer = Backend.getWriter();
  const entry = { day, kind: items.some(i => i.type === 'song') ? 'chanson' : 'lettre', items, note: '这是对方打开时会看到的样子（预览）', id: `preview-${day}`, answer: '', from: writer === 'yan' ? '砚砚' : '三三', title: '预览礼物' };
  const gifts = writer === 'yan' ? {} : { human_entries: [entry] };
  const remoteExtras = writer === 'yan' ? [entry] : [];
  const rect = { left: innerWidth / 2 - 20, top: innerHeight / 2 - 20, width: 40, height: 40 };
  showGiftCard(day, gifts, remoteExtras, [], rect, () => {
    host.remove();
    document.getElementById('overlay')?.classList.remove('is-preview-underlay');
  }, 'selfPreviewOverlay');

  // 在封面上标注「预览」，并区分这不是真正在开启的礼物
  requestAnimationFrame(() => {
    const front = host.querySelector('.adv-front .fhint');
    if (front) front.textContent = '对方视角预览 · 轻触翻开';
    const fd = host.querySelector('.adv-front .fby');
    if (fd) fd.textContent = writer === 'yan' ? 'de la part de 砚砚' : 'de la part de 三三';
    const hint = host.querySelector('.adv-row .adv-hint');
    if (hint) hint.textContent = '仅为预览，未真正封好';
    host.querySelectorAll('.adv-memory-actions').forEach(actions => actions.remove());
  });
}

/* ── 渲染单个 item ────────────────────────────────────────────────── */
/* ══════════════════════════════════════════════════════════════════
   风琴包（Accordion Folder）
   ─────────────────────────────────────────────────────────────────
   · 单份礼物：隐藏文件夹底座，内容直接显示，无标签干扰
   · 多份礼物：标签排 + 内容区，点标签弹出对应礼物
   · 切换时旧内容先收回（push-down），新内容再弹出（pull-up）
   · 每份礼物初始密封（封蜡面），点封蜡拆开才显示内容
   ══════════════════════════════════════════════════════════════════ */
function buildAccordion(body, sections) {
  if (!sections.length) return;

  const single = sections.length === 1;
  let activeIdx = -1;
  let switching = false;

  /* ── 给每份礼物加封蜡密封 ── */
  sections.forEach(s => {
    const seal = document.createElement('button');
    seal.type = 'button';
    seal.className = 'adv-envelope-seal';
    seal.setAttribute('aria-label', '轻触拆开火漆印章');
    seal.innerHTML = `
      <span>✦</span>
      <b>${s.fresh ? '新收到的礼物' : (s.title || '礼物')}</b>
      <small>轻触拆开火漆</small>`;
    seal.onclick = e => {
      e.stopPropagation();
      s.el.classList.remove('sealed');
      s.el.classList.add('opened');
    };
    s.el.prepend(seal);
    s.el.classList.add('sealed');
    s.el.hidden = true;
  });

  if (single) {
    /* 单份：不建文件夹底座，直接展示，自动拆封 */
    const s = sections[0];
    s.el.hidden = false;
    s.el.classList.add('pulled');
    body.prepend(s.el);
    /* 给用户一点感知时间再自动拆封 */
    setTimeout(() => {
      s.el.classList.remove('sealed');
      s.el.classList.add('opened');
    }, 350);
    return;
  }

  /* ── 多份：建文件夹底座 + 标签排 ── */
  const folder = document.createElement('div');
  folder.className = 'adv-accordion-folder';

  const tabBar = document.createElement('div');
  tabBar.className = 'adv-accordion-tabs';
  folder.appendChild(tabBar);

  const contentWrap = document.createElement('div');
  contentWrap.style.cssText = 'position:relative;overflow:hidden;min-height:40px;';
  folder.appendChild(contentWrap);
  sections.forEach(s => contentWrap.appendChild(s.el));

  body.prepend(folder);

  /* ── 标签：用 canvas 量文字像素宽再截断，避免中英文宽度不一 ── */
  const _canvas = document.createElement('canvas');
  const _ctx = _canvas.getContext('2d');
  _ctx.font = '12px sans-serif';
  const MAX_TAB_PX = 88; /* 对应 CSS max-width:130px 减去 padding */

  function fitLabel(title, fresh) {
    const prefix = fresh ? '★ ' : '';
    let text = title;
    while (text.length > 1 && _ctx.measureText(prefix + text + '…').width > MAX_TAB_PX) {
      text = text.slice(0, -1);
    }
    const truncated = text.length < title.length;
    return prefix + text + (truncated ? '…' : '');
  }

  sections.forEach((s, i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'adv-accordion-tab';
    if (s.fresh) tab.dataset.fresh = 'true';
    tab.title = s.title; /* 完整标题 hover 时在 tooltip 显示 */
    tab.textContent = fitLabel(s.title, s.fresh);
    tab.onclick = () => select(i);
    tabBar.appendChild(tab);
  });

  /* ── 切换逻辑 ── */
  function select(idx) {
    if (switching) return;

    if (idx === activeIdx) {
      /* 点同一个标签 → 收起 */
      switching = true;
      collapse(activeIdx, () => {
        activeIdx = -1;
        switching = false;
      });
      return;
    }

    switching = true;
    const prevIdx = activeIdx;

    if (prevIdx >= 0) {
      collapse(prevIdx, () => {
        expand(idx);
        switching = false;
      });
    } else {
      expand(idx);
      switching = false;
    }
  }

  function expand(idx) {
    activeIdx = idx;
    const s = sections[idx];
    Array.from(tabBar.children).forEach((t, i) =>
      t.classList.toggle('on', i === idx));
    s.el.hidden = false;
    s.el.classList.remove('pushed');
    /* rAF 确保 hidden:false 生效后再加动画类，首帧不会被跳过 */
    requestAnimationFrame(() => s.el.classList.add('pulled'));
  }

  function collapse(idx, cb) {
    const s = sections[idx];
    tabBar.children[idx]?.classList.remove('on');

    /* 防止 animationend + setTimeout 同时触发 cb */
    let called = false;
    const done = () => {
      if (called) return;
      called = true;
      s.el.style.animation = '';
      s.el.classList.remove('pulled');
      s.el.hidden = true;
      cb?.();
    };

    s.el.style.animation = 'adv-push-down .26s cubic-bezier(.4,0,.6,1) both';
    s.el.addEventListener('animationend', done, { once: true });
    setTimeout(done, 300); /* 比动画时长稍长，作为超时兜底 */
  }

  /* 入场后自动展开第一个 */
  setTimeout(() => select(0), 80);
}
function renderItem(container, item, day, role, existingAnswer, giftId = '') {
  if (item.type === 'text') {
    const p = document.createElement('p');
    p.textContent = item.text || '';
    container.appendChild(p);
    return;
  }

  if (item.type === 'question') {
    const qDiv = document.createElement('div');
    qDiv.className = 'adv-q';
    const qlabel = document.createElement('span');
    qlabel.className = 'adv-hint';
    qlabel.textContent = '砚砚想问 ';
    const qt = document.createElement('p');
    qt.style.margin = '0';
    qt.textContent = item.text || '';
    qDiv.appendChild(qlabel);
    qDiv.appendChild(qt);
    container.appendChild(qDiv);

    // 回答框
    const ta = document.createElement('textarea');
    ta.className = 'adv-ta';
    ta.placeholder = '写下你的回答，会一直保存在这里…';
    ta.value = existingAnswer || '';
    container.appendChild(ta);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'adv-btn solid';
    saveBtn.style.marginTop = '8px';
    saveBtn.textContent = existingAnswer ? '更新回答' : '保存回答';
    saveBtn.onclick = async () => {
      const text = ta.value.trim();
      if (!text) return;
      saveBtn.disabled = true;
      try {
        Backend.answer(day, giftId, text);
        saveBtn.textContent = '已保存 ✓';
        setTimeout(() => { saveBtn.textContent = '更新回答'; saveBtn.disabled = false; }, 1800);
      } catch (e) {
        toast(e.message);
        saveBtn.disabled = false;
      }
    };
    container.appendChild(saveBtn);
    return;
  }

  if (item.type === 'song') {
    window.AdventMusic?.renderMusicItem(container, item);
    if (item.name) {
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = item.name + (item.artist ? ' — ' + item.artist : '');
      container.appendChild(cap);
    }
    return;
  }

  if (item.type === 'abc') {
    window.AdventMusic?.renderAbc(container, item.abc || item.text || '');
    if (item.name) {
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.textContent = item.name;
      container.appendChild(cap);
    }
    return;
  }

  if (item.type === 'image' && item.url) {
    (async () => {
      const src = await Backend.resolveMediaUrl(item.url);
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = item.name || '图片';
        img.loading = 'lazy';
        img.style.borderRadius = '2px';
        img.style.maxWidth = '100%';
        container.appendChild(img);
      }
    })();
    return;
  }

  if (item.type === 'photo' || item.photo) {
    renderPhoto(container, item.photo || item, item.name || '一张冬日照片');
    return;
  }

  if (item.type === 'comic' || item.comic) {
    renderComic(container, item.comic || item, item.name || '冬日绘本');
    return;
  }

  if (item.type === 'scrapbook' && item.layout) {
    renderScrapbook(container, item.layout);
    return;
  }

  if ((item.type === 'voice' || item.type === 'audio') && item.url) {
    (async () => {
      const src = await Backend.resolveMediaUrl(item.url);
      if (src) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.preload = 'metadata';
        audio.style.width = '100%';
        audio.src = src;
        container.appendChild(audio);
        appendMediaCaption(container, item);
      }
    })();
    return;
  }

  if (item.type === 'attachment' && item.url && Backend.isAllowedAssetUrl(item.url)) {
    (async () => {
      const href = await Backend.resolveMediaUrl(item.url);
      if (href) {
        const link = document.createElement('a');
        link.className = 'adv-btn';
        link.textContent = item.name || item.filename || '下载附件';
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener';
        container.appendChild(link);
      }
    })();
    return;
  }
}

function buildPhotoView(photo, title, options = {}) {
  const frame = ['polaroid', 'vintage', 'plain', 'postcard', 'stamp'].includes(photo?.front?.frame)
    ? photo.front.frame : 'polaroid';
  const wrap = document.createElement('button');
  wrap.type = 'button'; wrap.className = 'adv-photo3d';
  wrap.setAttribute('aria-label', options.label || '翻转照片');
  const front = document.createElement('span'); front.className = `adv-photo-face adv-photo-front frame-${frame}`;
  const back = document.createElement('span'); back.className = 'adv-photo-face adv-photo-back';
  const img = document.createElement('img'); img.alt = title; img.loading = 'lazy';
  img.style.objectFit = ['cover', 'contain'].includes(photo?.front?.fit) ? photo.front.fit : 'cover';
  img.style.objectPosition = `${photo?.front?.positionX ?? 50}% ${photo?.front?.positionY ?? 50}%`;
  const url = photo?.front?.url || photo?.url;
  const setSource = src => { if (src) img.src = src; };
  if (options.src) setSource(options.src);
  else if (url) Backend.resolveMediaUrl(url).then(setSource).catch(() => {});
  const caption = document.createElement('small'); caption.textContent = photo?.front?.title || title;
  front.append(img, caption);
  const date = document.createElement('span'); date.className = 'adv-photo-date'; date.textContent = photo?.back?.date || '';
  const backText = document.createElement('span'); backText.textContent = photo?.back?.text || '背面还没有留言';
  const signature = document.createElement('span'); signature.className = 'adv-photo-signature'; signature.textContent = photo?.back?.signature || '';
  back.append(date, backText, signature);
  wrap.append(front, back);
  wrap.onclick = () => wrap.classList.toggle('flipped');
  return wrap;
}

async function downloadCanvasPng(canvas, filename) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 编码失败')), 'image/png'));
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportPhotoSide(photo, title, side) {
  const stage = document.createElement('div'); stage.className = 'adv-photo-export-stage';
  const view = buildPhotoView(photo, title); stage.appendChild(view); document.body.appendChild(stage);
  try {
    const fontResults = await Promise.allSettled([
      document.fonts.load(`16px "Pinyon Script"`, title || ''),
      document.fonts.load('16px "Noto Serif SC"', title || ''),
    ]);
    await document.fonts.ready;
    if (fontResults.some(result => result.status === 'rejected')) throw new Error('字体加载失败，未导出不完整的照片');
    const face = view.querySelector(side === 'back' ? '.adv-photo-back' : '.adv-photo-front');
    const img = face.querySelector('img'); img.loading = 'eager';
    const src = await Backend.resolveMediaUrl(photo?.front?.url || photo?.url);
    if (!src) throw new Error('照片不存在或链接不受支持');
    const loaded = await loadCanvasImage(src);
    const faceRect = face.getBoundingClientRect();
    const scale = 4, padding = 12 * scale;
    const output = document.createElement('canvas');
    output.width = Math.ceil(faceRect.width * scale + padding * 2);
    output.height = Math.ceil(faceRect.height * scale + padding * 2);
    const ctx = output.getContext('2d');
    const x0 = padding, y0 = padding, width = faceRect.width * scale, height = faceRect.height * scale;
    ctx.save(); ctx.shadowColor = 'rgba(60,30,10,.24)'; ctx.shadowBlur = 10 * scale; ctx.shadowOffsetY = 4 * scale;
    ctx.fillStyle = side === 'back' ? '#f8efd9' : '#fffaf0'; ctx.fillRect(x0, y0, width, height); ctx.restore();
    if (side === 'front') {
      const style = getComputedStyle(face), frame = photo?.front?.frame || 'polaroid';
      ctx.fillStyle = frame === 'postcard' ? '#efe4cb' : frame === 'vintage' ? '#e9dcc3' : style.backgroundColor;
      ctx.fillRect(x0, y0, width, height);
      const borders = ['Top','Right','Bottom','Left'].map(name => parseFloat(style[`border${name}Width`]) * scale);
      const borderColor = style.borderTopColor;
      if (frame !== 'stamp') {
        ctx.fillStyle = borderColor;
        ctx.fillRect(x0,y0,width,borders[0]); ctx.fillRect(x0+width-borders[1],y0,borders[1],height);
        ctx.fillRect(x0,y0+height-borders[2],width,borders[2]); ctx.fillRect(x0,y0,borders[3],height);
      } else {
        ctx.save(); ctx.strokeStyle = borderColor; ctx.lineWidth = 6 * scale; ctx.lineCap = 'round'; ctx.setLineDash([.1 * scale, 5 * scale]);
        ctx.strokeRect(x0+borders[3]/2,y0+borders[0]/2,width-borders[3],height-borders[0]); ctx.restore();
      }
      if (frame === 'postcard') {
        ctx.fillStyle = 'rgba(166,77,77,.14)'; ctx.fillRect(x0+width*.72,y0,width*.01,height);
      }
      if (frame === 'stamp') {
        ctx.strokeStyle = '#cbb993'; ctx.lineWidth = scale; ctx.setLineDash([2*scale,3*scale]);
        ctx.strokeRect(x0+borders[3]/2,y0+borders[0]/2,width-borders[3],height-borders[0]);
        ctx.setLineDash([]);
      }
      if (frame === 'vintage') {
        ctx.strokeStyle = '#c7ae83'; ctx.lineWidth = scale;
        ctx.strokeRect(x0+borders[3]+3*scale,y0+borders[0]+3*scale,width-borders[3]*2-6*scale,height-borders[0]*2-6*scale);
      }
      const imageRect = img.getBoundingClientRect();
      const boxX = x0 + (imageRect.left-faceRect.left)*scale, boxY = y0 + (imageRect.top-faceRect.top)*scale;
      const boxW = imageRect.width*scale, boxH = imageRect.height*scale;
      ctx.save(); ctx.beginPath(); ctx.rect(boxX,boxY,boxW,boxH); ctx.clip();
      ctx.fillStyle = '#e6d8bd'; ctx.fillRect(boxX,boxY,boxW,boxH);
      const fit = img.style.objectFit || 'cover';
      const ratio = fit === 'contain' ? Math.min(boxW/loaded.naturalWidth,boxH/loaded.naturalHeight) : Math.max(boxW/loaded.naturalWidth,boxH/loaded.naturalHeight);
      const drawW = loaded.naturalWidth*ratio, drawH = loaded.naturalHeight*ratio;
      const position = (img.style.objectPosition || '50% 50%').split(' ');
      const px = parseFloat(position[0])/100 || 0, py = parseFloat(position[1])/100 || 0;
      if (frame === 'vintage') ctx.filter = 'sepia(.22) contrast(.94)';
      ctx.drawImage(loaded,boxX+(boxW-drawW)*px,boxY+(boxH-drawH)*py,drawW,drawH);
      ctx.restore();
      const caption = face.querySelector('small');
      if (caption) {
        const capRect = caption.getBoundingClientRect(), capStyle = getComputedStyle(caption);
        ctx.save(); ctx.beginPath(); ctx.rect(x0+(capRect.left-faceRect.left)*scale,y0+(capRect.top-faceRect.top)*scale,capRect.width*scale,capRect.height*scale); ctx.clip();
        const fontSize = parseFloat(capStyle.fontSize)*scale;
        ctx.font = `${capStyle.fontStyle} ${capStyle.fontWeight} ${fontSize}px ${capStyle.fontFamily}`; ctx.fillStyle = capStyle.color; ctx.textBaseline='middle';
        const capX=x0+(capRect.left-faceRect.left)*scale, capY=y0+(capRect.top-faceRect.top+capRect.height/2)*scale;
        ctx.textAlign = capStyle.textAlign === 'right' ? 'right' : capStyle.textAlign === 'center' ? 'center' : 'left';
        ctx.fillText(caption.textContent,ctx.textAlign==='center'?capX+capRect.width*scale/2:ctx.textAlign==='right'?capX+capRect.width*scale:capX,capY,capRect.width*scale);
        ctx.restore();
      }
      if (frame === 'postcard') {
        ctx.strokeStyle='#a37a48'; ctx.lineWidth=scale; ctx.setLineDash([2*scale,2*scale]);
        ctx.strokeRect(x0+width-31*scale,y0+3*scale,25*scale,10*scale); ctx.setLineDash([]);
        ctx.fillStyle='#8a6526'; ctx.font=`${6*scale}px ${getComputedStyle(document.body).fontFamily}`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('✦ POST ✦',x0+width-18.5*scale,y0+8*scale);
      }
    } else {
      for (const element of face.querySelectorAll('.adv-photo-date,.adv-photo-back>span:not(.adv-photo-date):not(.adv-photo-signature),.adv-photo-signature')) {
        const rect = element.getBoundingClientRect();
        drawScrapbookText(ctx, element, { left:faceRect.left-padding/scale, top:faceRect.top-padding/scale }, scale, scale);
      }
    }
    await downloadCanvasPng(output, `photo-${side}-4x.png`);
  } finally { stage.remove(); }
}

function renderPhoto(container, photo, title) {
  const holder = document.createElement('div'); holder.className = 'adv-photo-holder';
  holder.appendChild(buildPhotoView(photo, title));
  const controls=document.createElement('div');controls.className='adv-photo-export';
  const frontBtn=document.createElement('button');frontBtn.className='adv-btn';frontBtn.textContent='导出正面 PNG';frontBtn.onclick=async()=>{try{await exportPhotoSide(photo,title,'front');}catch(error){toast(error.message,5000);}};
  const backBtn=document.createElement('button');backBtn.className='adv-btn';backBtn.textContent='导出背面 PNG';backBtn.onclick=async()=>{try{await exportPhotoSide(photo,title,'back');}catch(error){toast(error.message,5000);}};
  controls.append(frontBtn,backBtn);holder.appendChild(controls);container.appendChild(holder);
}

function renderComic(container, comic, title) {
  const pages = Array.isArray(comic?.pages) ? comic.pages : [];
  if (!pages.length) return;
  const reader=document.createElement('div');reader.className=`adv-comic-reader mode-${comic.mode||'pages'}`;const viewport=document.createElement('div');viewport.className='adv-comic-viewport';const controls=document.createElement('div');controls.className='adv-comic-controls';const caption=document.createElement('span');caption.className='adv-hint';let index=0,zoom=1,startX=0;
  const prev=document.createElement('button');prev.className='adv-btn';prev.textContent='‹';const next=document.createElement('button');next.className='adv-btn';next.textContent='›';const zoomBtn=document.createElement('button');zoomBtn.className='adv-btn';zoomBtn.textContent='放大';const immersive=document.createElement('button');immersive.className='adv-btn';immersive.textContent='沉浸阅读';
  const resolvePage=async p=>p?.url?await Backend.resolveMediaUrl(p.url):null;
  const draw=async()=>{viewport.innerHTML='';const mode=comic.mode||'pages';caption.textContent=`${title} · ${index+1}/${pages.length}`;reader.dataset.zoom=zoom;viewport.style.setProperty('--comic-zoom',zoom);if(mode==='scroll'||mode==='strip'){for(const [i,p] of pages.entries()){const src=await resolvePage(p);if(!src)continue;const img=document.createElement('img');img.src=src;img.alt=p.alt||`${title} ${i+1}`;img.loading='lazy';viewport.appendChild(img);}caption.textContent=`${title} · ${pages.length} 页`;}else{const visible=mode==='spread'?[pages[index],pages[(index+1)%pages.length]]:[pages[index]];for(const [i,p] of visible.entries()){const src=await resolvePage(p);if(!src)continue;const img=document.createElement('img');img.src=src;img.alt=p.alt||`${title} ${index+i+1}`;img.loading='lazy';viewport.appendChild(img);}}};
  prev.onclick=()=>{index=(index+(comic.mode==='spread'?-2:-1)+pages.length)%pages.length;draw();};next.onclick=()=>{index=(index+(comic.mode==='spread'?2:1))%pages.length;draw();};zoomBtn.onclick=()=>{zoom=zoom>=2?1:zoom+.5;zoomBtn.textContent=zoom===1?'放大':`${zoom}×`;draw();};immersive.onclick=()=>{reader.classList.toggle('immersive');immersive.textContent=reader.classList.contains('immersive')?'退出沉浸':'沉浸阅读';};
  viewport.onpointerdown=e=>{startX=e.clientX;};viewport.onpointerup=e=>{const dx=e.clientX-startX;if(Math.abs(dx)>50&&(comic.mode==='pages'||comic.mode==='spread'))(dx<0?next:prev).click();};
  controls.append(prev,caption,next,zoomBtn,immersive);reader.append(viewport,controls);container.appendChild(reader);draw();
}

function appendMediaCaption(container, item) {
      if (item.name) {
        const cap = document.createElement('div');
        cap.className = 'cap';
        cap.textContent = item.name;
        container.appendChild(cap);
      }
}

function renderRemoteEntry(container, entry, label, day) {
  if (!entry) return null;
  const source = Array.isArray(entry.items_v2) && entry.items_v2.length
    ? entry.items_v2
    : (Array.isArray(entry.items) && entry.items.length ? entry.items : legacyEntryItems(entry));
  const items = source.filter(item => item && ['text', 'question', 'song', 'abc', 'image', 'photo', 'comic', 'scrapbook', 'voice', 'audio', 'attachment'].includes(item.type));
  if (!items.length) return null;
  const half = document.createElement('div');
  half.className = 'adv-half';
  const lbl = document.createElement('div');
  lbl.className = 'adv-hint';
  lbl.style.marginBottom = '4px';
  lbl.textContent = label + (entry.title ? ' · ' + entry.title : '');
  half.appendChild(lbl);
  for (const item of items) {
    renderItem(half, item, day, entry.from || 'remote', entry.answer || '', entry.id || '');
  }
  appendMemoryActions(half, entry.id || `${day}-${label}`, day);
  container.appendChild(half);
  return half;
}

function appendMemoryActions(container, id, day) {
  const key = `advent-v4-favorite:${id}`;
  const row = document.createElement('div'); row.className = 'adv-memory-actions';
  const fav = document.createElement('button'); fav.className = 'adv-btn';
  const sync = () => { fav.textContent = Backend.getCompanion().favorites[id] ? '★ 已收藏' : '☆ 收藏'; };
  fav.onclick = () => { const exists=Backend.getCompanion().favorites[id];Backend.setCompanion('favorites',id,exists?null:{id,day});sync(); };
  const reply = document.createElement('button'); reply.className = 'adv-btn'; reply.textContent = '↩ 写回信';
  reply.onclick = () => openReplyComposer(id, day);
  row.append(fav, reply); sync(); container.appendChild(row);
}

function openDeskSheet(title, subtitle='Christmas desk') {
  const overlay=document.getElementById('overlay');overlay.innerHTML='';overlay.style.display='flex';overlay.classList.add('on');
  const sheet=document.createElement('div');sheet.className='adv-sheet adv-paper';const frame=document.createElement('div');frame.className='adv-frame';
  frame.innerHTML=`<div class="adv-ctop"><span class="d"></span><span class="by"></span></div>`;frame.querySelector('.d').textContent=title;frame.querySelector('.by').textContent=subtitle;
  const body=document.createElement('div');body.className='adv-body adv-desk-sheet-body';const row=document.createElement('div');row.className='adv-row';const close=document.createElement('button');close.className='adv-btn';close.textContent='关上';close.onclick=closeMainOverlay;row.appendChild(close);frame.append(body,row);sheet.appendChild(frame);overlay.appendChild(sheet);overlay.onclick=e=>{if(e.target===overlay)closeMainOverlay();};return {body,row,sheet};
}

function openTodayNote() {
  const {body,row}=openDeskSheet('今日便签','petit mot');const key=`${Backend.getWho()}:${Backend.shanghaiNowIso().slice(0,10)}`;
  const ta=document.createElement('textarea');ta.className='adv-ta adv-today-note';ta.maxLength=280;ta.placeholder='留一句简短的冬日留言…';ta.value=Backend.getCompanion().notes[key]?.text||'';
  const save=document.createElement('button');save.className='adv-btn solid';save.textContent='贴到桌上';save.onclick=()=>{Backend.setCompanion('notes',key,{text:ta.value.slice(0,280),who:Backend.getWho()});toast('今日便签已贴好，下次发布会同步');closeMainOverlay();};body.appendChild(ta);row.appendChild(save);
}

function openPhotoFrame() {
  const {body,row}=openDeskSheet('桌面相框','photo frame');const key=Backend.getWho();let data=Backend.getCompanion().frames[key]||{};
  const card=document.createElement('div');card.className='adv-frame-photo-card';const front=document.createElement('div');front.className='adv-frame-photo-front';const img=document.createElement('img');img.alt='桌面相框';front.appendChild(img);const back=document.createElement('div');back.className='adv-frame-photo-back';back.textContent=data.note||'照片背面还没有留言';card.append(front,back);card.onclick=()=>card.classList.toggle('flipped');
  const upload=document.createElement('input');upload.type='file';upload.accept='image/png,image/jpeg,image/webp';upload.className='adv-file';const note=document.createElement('textarea');note.className='adv-ta';note.placeholder='写在照片背面的留言';note.value=data.note||'';let src=data.src||'';if(src)Backend.resolveMediaUrl(src).then(u=>{if(u)img.src=u;});upload.onchange=async e=>{const f=e.target.files?.[0];if(!f||f.size>3*1024*1024)return toast('照片需小于 3MB');try{const up=await Backend.uploadFile(f);src=up.url;img.src=await Backend.resolveMediaUrl(src);}catch(err){toast(err.message);}};
  const save=document.createElement('button');save.className='adv-btn solid';save.textContent='放进相框';save.onclick=()=>{try{Backend.setCompanion('frames',key,{src,note:note.value.slice(0,1000)});toast('相框已更新，下次发布会同步');closeMainOverlay();}catch{toast('照片太大，无法保存在浏览器');}};body.append(card,upload,note);row.appendChild(save);
}

const GIFT_TYPE_LABELS = { text:'文字', question:'问答', song:'歌曲', abc:'五线谱', image:'图片', photo:'照片拼贴', comic:'漫画', scrapbook:'手账', voice:'语音', audio:'音频', attachment:'附件', lettre:'文字', chanson:'歌曲', melodie:'五线谱', dessin:'图片', cadeau:'礼物', mot:'文字', ensemble:'礼物', gift:'礼物' };
const EVENT_TYPE_LABELS = { create:'新增投递', update:'修改礼物', delete:'删除礼物', attachment:'添加附件', open:'正式开启', seal:'正式封箱' };
const STATUS_LABELS = { opened:'已开启', unopened:'未开启', sealed:'已封存' };
const senderName = sender => sender === 'yan' ? '砚砚' : '三三';
function formatShanghai(value) {
  try { return new Intl.DateTimeFormat('zh-CN', { timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(new Date(value)); }
  catch { return value || '时间未知'; }
}
function shanghaiDateKey(value) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(value)); }
  catch { return ''; }
}
function makeFilterSelect(options, value, label) {
  const select=document.createElement('select');select.className='adv-in1 adv-archive-filter';select.setAttribute('aria-label',label);
  for(const [key,text] of options){const option=document.createElement('option');option.value=key;option.textContent=text;option.selected=key===value;select.appendChild(option);}
  return select;
}
function filterToolbar(fields, state, storageKey, onChange) {
  const bar=document.createElement('div');bar.className='adv-archive-filters';
  fields.forEach(field=>{
    const control=field.type==='search'||field.type==='date'?document.createElement('input'):makeFilterSelect(field.options,state[field.key],field.label);
    if(field.type==='search'||field.type==='date'){control.type=field.type;control.className='adv-in1 adv-archive-filter';control.value=state[field.key]||'';control.setAttribute('aria-label',field.label);if(field.type==='search')control.placeholder=field.label;}
    control.addEventListener(field.type==='search'?'input':'change',()=>{state[field.key]=control.value;try{sessionStorage.setItem(storageKey,JSON.stringify(state));}catch{}onChange();});bar.appendChild(control);
  });
  return bar;
}

function openCollection(defaultSender='', defaultDay='') {
  const {body,row,sheet}=openDeskSheet('双人礼物收藏馆','notre collection');sheet.classList.add('adv-archive-sheet');
  let state={sender:'',day:'',type:'',status:'',search:''};
  try{state={...state,...JSON.parse(sessionStorage.getItem('advent-v4-collection-filters')||'null'),...(defaultSender?{sender:defaultSender}:{}),...(defaultDay?{day:String(defaultDay)}:{})};}catch{}
  const layout=document.createElement('div');layout.className='adv-archive-layout';
  const sidebar=document.createElement('aside');sidebar.className='adv-archive-sidebar';const main=document.createElement('div');main.className='adv-archive-main';layout.append(sidebar,main);body.appendChild(layout);
  const close=row.querySelector('.adv-btn');close.textContent='关闭收藏馆';
  function render(){
    const data=Backend.getBoard().collection;const rules=Backend.calendarRules();
    sidebar.replaceChildren();main.replaceChildren();
    const sideTitle=document.createElement('h3');sideTitle.textContent='双方礼物堆';sidebar.appendChild(sideTitle);
    for(const sender of ['yan','san']){const button=document.createElement('button');button.type='button';button.className=`adv-collection-pile${state.sender===sender?' on':''}`;button.innerHTML=`<span>${senderName(sender)}的礼物</span><b>${data.counts[sender]}</b>`;button.onclick=()=>{state.sender=state.sender===sender?'':sender;try{sessionStorage.setItem('advent-v4-collection-filters',JSON.stringify(state));}catch{}render();};sidebar.appendChild(button);}
    const total=document.createElement('div');total.className='adv-collection-total';total.textContent=`共 ${data.counts.total} 份礼物`;sidebar.appendChild(total);
    const note=document.createElement('p');note.className='adv-hint';note.textContent='点击礼物堆可按发送者筛选。列表与展开不会开启窗户，也不会增加偷看。';sidebar.appendChild(note);
    const permission=document.createElement('p');permission.className='adv-permission-note';permission.textContent=rules.label;sidebar.appendChild(permission);
    const heading=document.createElement('div');heading.className='adv-archive-heading';heading.innerHTML='<h3>按日期翻阅</h3><span>同一天可以有多份礼物</span>';main.appendChild(heading);
    const types=[...new Set(data.days.flatMap(day=>day.gifts.map(gift=>gift.type)))];
    const fields=[
      {key:'sender',label:'发送者',options:[['','全部发送者'],['yan','砚砚'],['san','三三']]},
      {key:'day',label:'礼物日期',options:[['','全部日期'],...Array.from({length:25},(_,i)=>[String(i+1),`12月${i+1}日`])]},
      {key:'type',label:'礼物类型',options:[['','全部类型'],...types.map(type=>[type,GIFT_TYPE_LABELS[type]||type])]},
      {key:'status',label:'开启状态',options:[['','全部状态'],...Object.entries(STATUS_LABELS)]},
      {key:'search',type:'search',label:'搜索标题或编号'},
    ];
    main.appendChild(filterToolbar(fields,state,'advent-v4-collection-filters',render));
    const query=state.search.trim().toLowerCase();let shown=0;
    for(const group of data.days){
      if(state.day&&Number(state.day)!==group.day)continue;
      const gifts=group.gifts.filter(gift=>(!state.sender||gift.sender===state.sender)&&(!state.type||gift.type===state.type)&&(!state.status||gift.status===state.status)&&(!query||`${gift.title} ${gift.id} ${senderName(gift.sender)}`.toLowerCase().includes(query)));
      shown+=gifts.length;const details=document.createElement('details');details.className='adv-archive-day';details.open=Boolean(state.day)||gifts.some(gift=>gift.opened);
      const summary=document.createElement('summary');summary.textContent=`12月${group.day}日 · ${gifts.length} 份`;details.appendChild(summary);
      if(!gifts.length){const empty=document.createElement('p');empty.className='adv-archive-empty';empty.textContent=query||state.sender||state.type||state.status?'这个日期没有符合筛选的礼物。':'这一天还没有礼物，空着也很好。';details.appendChild(empty);}
      for(const gift of gifts){
        const item=document.createElement('article');item.className='adv-archive-gift';const toggle=document.createElement('button');toggle.type='button';toggle.className='adv-archive-gift-summary';toggle.setAttribute('aria-expanded','false');
        const title=document.createElement('b');title.textContent=gift.title||`${senderName(gift.sender)}的一份礼物`;const meta=document.createElement('small');meta.textContent=`${senderName(gift.sender)} · ${GIFT_TYPE_LABELS[gift.type]||gift.type} · ${STATUS_LABELS[gift.status]}`;const mark=document.createElement('span');mark.textContent=gift.can_read?'▾':'⌑';toggle.append(title,meta,mark);item.appendChild(toggle);
        const detail=document.createElement('div');detail.className='adv-archive-gift-detail';detail.hidden=true;
        toggle.onclick=()=>{
          if(!detail.hidden){detail.hidden=true;toggle.setAttribute('aria-expanded','false');mark.textContent=gift.can_read?'▾':'⌑';return;}
          if(!gift.can_read){detail.replaceChildren();const locked=document.createElement('p');locked.className='adv-archive-locked';locked.textContent='尚未解锁：只显示投递信息。请回到圣诞屋按原有规则开盒或偷看。';detail.appendChild(locked);detail.hidden=false;toggle.setAttribute('aria-expanded','true');mark.textContent='▴';return;}
          try{
            const content=Backend.readGiftContent(gift.day,gift.id);const entries=[...(content.gifts?.ai?[content.gifts.ai]:[]),...(content.human_entries||[]),...(content.remote_extras||[]),...(content.sannan_extras||[])];const entry=entries.find(value=>value.id===gift.id);
            detail.replaceChildren();if(entry)renderRemoteEntry(detail,entry,`${senderName(gift.sender)} · 12月${gift.day}日`,gift.day);else{const missing=document.createElement('p');missing.textContent='礼物内容暂时不可用，请同步后重试。';detail.appendChild(missing);}
            if(gift.own){const actions=document.createElement('div');actions.className='adv-row';if(gift.can_edit){const edit=document.createElement('button');edit.type='button';edit.className='adv-btn';edit.textContent='编辑这份礼物';edit.onclick=()=>openEditor(gift.day,gift.id);actions.appendChild(edit);const remove=document.createElement('button');remove.type='button';remove.className='adv-btn';remove.textContent='删除';let armed=false;remove.onclick=()=>{if(!armed){armed=true;remove.textContent='再次点击确认删除';setTimeout(()=>{if(remove.isConnected){armed=false;remove.textContent='删除';}},4000);return;}try{Backend.deleteGift(gift.day,gift.id);board=Backend.getBoard();refresh();toast('礼物已删除；发布后双方同步');render();}catch(error){toast(error.message);}};actions.appendChild(remove);}const reason=document.createElement('span');reason.className='adv-hint';reason.textContent=gift.edit_reason||'这是你投递的礼物';actions.appendChild(reason);detail.appendChild(actions);}
          }catch(error){detail.replaceChildren();const message=document.createElement('p');message.className='adv-archive-locked';message.textContent=error.message;detail.appendChild(message);}
          detail.hidden=false;toggle.setAttribute('aria-expanded','true');mark.textContent='▴';
        };
        item.appendChild(detail);details.appendChild(item);
      }
      main.appendChild(details);
    }
    if(!shown){const empty=document.createElement('p');empty.className='adv-archive-empty';empty.textContent='没有找到匹配的礼物，试试清空关键词或筛选条件。';main.appendChild(empty);}
  }
  render();
}

function openPostOffice() {
  const {body,row,sheet}=openDeskSheet('圣诞邮局','Christmas post');sheet.classList.add('adv-post-office');
  row.querySelector('.adv-btn').textContent='离开邮局';
  let state={sender:'',day:'',event:'',type:'',search:'',from:'',to:''};let limit=30;
  try{state={...state,...JSON.parse(sessionStorage.getItem('advent-v4-post-filters')||'null')};}catch{}
  function render(){
    const data=Backend.getBoard().post_office;body.replaceChildren();
    const summary=document.createElement('div');summary.className='adv-post-summary';
    const stats=[['累计投递',data.total_deliveries],['砚砚投递',data.yan_deliveries],['三三投递',data.san_deliveries],['近 7 天新增',data.recent_count],['未读活动',data.unread_count],['最近投递',data.latest?formatShanghai(data.latest.created_at):'暂无记录']];
    for(const [label,value] of stats){const cell=document.createElement('div');const strong=document.createElement('b');strong.textContent=String(value);const span=document.createElement('span');span.textContent=label;cell.append(strong,span);summary.appendChild(cell);}body.appendChild(summary);
    const tools=document.createElement('div');tools.className='adv-post-tools';const permission=document.createElement('span');permission.className='adv-hint';permission.textContent=data.permissions.label;const read=document.createElement('button');read.type='button';read.className='adv-btn';read.textContent='全部标为已读';read.disabled=!data.unread_count;read.onclick=()=>{Backend.markEventsRead(true);board=Backend.getBoard();refresh();render();};tools.append(permission,read);body.appendChild(tools);
    const types=[...new Set(data.events.map(event=>event.gift_type))];
    const fields=[{key:'sender',label:'发送者',options:[['','全部操作者'],['yan','砚砚'],['san','三三']]},{key:'day',label:'礼物日期',options:[['','全部日期'],...Array.from({length:25},(_,i)=>[String(i+1),`12月${i+1}日`])]},{key:'event',label:'活动类型',options:[['','全部活动'],...Object.entries(EVENT_TYPE_LABELS)]},{key:'type',label:'礼物类型',options:[['','全部类型'],...types.map(type=>[type,GIFT_TYPE_LABELS[type]||type])]},{key:'from',type:'date',label:'操作日期从'},{key:'to',type:'date',label:'操作日期到'},{key:'search',type:'search',label:'搜索标题或编号'}];
    body.appendChild(filterToolbar(fields,state,'advent-v4-post-filters',()=>{limit=30;render();}));
    const latest=document.createElement('section');latest.className='adv-post-latest';const latestTitle=document.createElement('b');latestTitle.textContent='最新记录';const latestText=document.createElement('span');latestText.textContent=data.latest?`${formatShanghai(data.latest.created_at)} · ${data.latest.actor_name}${EVENT_TYPE_LABELS[data.latest.event_type]}了「${data.latest.title||'一份礼物'}」`:'成功投递后，真实活动会出现在这里。历史礼物不会补造虚假记录。';latest.append(latestTitle,latestText);body.appendChild(latest);
    const query=state.search.trim().toLowerCase();const events=data.events.filter(event=>{const operationDate=shanghaiDateKey(event.created_at);return (!state.sender||event.actor_id===state.sender)&&(!state.day||event.gift_date===Number(state.day))&&(!state.event||event.event_type===state.event)&&(!state.type||event.gift_type===state.type)&&(!state.from||operationDate>=state.from)&&(!state.to||operationDate<=state.to)&&(!query||`${event.title} ${event.gift_id} ${event.actor_name}`.toLowerCase().includes(query));});
    const list=document.createElement('div');list.className='adv-post-list';const unreadIds=new Set(data.unread_ids||[]);
    for(const event of events.slice(0,limit)){
      const unread=unreadIds.has(event.event_id);
      const button=document.createElement('button');button.type='button';button.className=`adv-post-event${unread?' is-unread':''}`;
      const time=document.createElement('time');time.textContent=formatShanghai(event.created_at);const title=document.createElement('b');title.textContent=`${event.actor_name} · ${EVENT_TYPE_LABELS[event.event_type]||event.event_type}`;const detail=document.createElement('span');detail.textContent=`12月${event.gift_date}日 · ${GIFT_TYPE_LABELS[event.gift_type]||event.gift_type} · ${event.title||event.gift_id}`;button.append(time,title,detail);
      button.onclick=()=>{Backend.markEventsRead(false,event.event_id);board=Backend.getBoard();refresh();openCollection('',event.gift_date);};list.appendChild(button);
    }
    if(!events.length){const empty=document.createElement('p');empty.className='adv-archive-empty';empty.textContent='没有符合条件的投递活动。';list.appendChild(empty);}body.appendChild(list);
    if(events.length>limit){const more=document.createElement('button');more.type='button';more.className='adv-btn';more.textContent=`再加载 ${Math.min(30,events.length-limit)} 条`;more.onclick=()=>{limit+=30;render();};body.appendChild(more);}
  }
  render();
}

function openRecordPlayer() {
  const {body}=openDeskSheet('圣诞唱片机','music for us');const player=document.getElementById('deskAudio');
  const controls=document.createElement('div');controls.className='adv-record-player';controls.innerHTML='<div class="adv-record-disc">♫</div><button class="adv-btn" type="button">播放 / 暂停</button><label>音量 <input type="range" min="0" max="1" step="0.05"></label><div class="adv-record-list"></div>';
  const play=controls.querySelector('button'),volume=controls.querySelector('input'),list=controls.querySelector('.adv-record-list');const savedVolume=Number(localStorage.getItem('advent-v4-volume'));if(Number.isFinite(savedVolume))player.volume=Math.max(0,Math.min(1,savedVolume));volume.value=player.volume;play.onclick=()=>player.src?(player.paused?player.play().catch(()=>toast('请再次点击播放')):player.pause()):toast('先从下面选择一段音频');volume.oninput=()=>{player.volume=+volume.value;localStorage.setItem('advent-v4-volume',volume.value);};
  const tracks=board?.public_tracks||[];
  if(!tracks.length){const p=document.createElement('p');p.className='adv-hint';p.textContent='已开启的礼物里还没有可直接播放的音频。Spotify/网易云仍从礼物中的播放器打开。';list.appendChild(p);}tracks.forEach(t=>{const b=document.createElement('button');b.type='button';b.className='adv-post-item';b.textContent=t.name;b.onclick=async()=>{const src=await Backend.resolveMediaUrl(t.url);if(src){player.src=src;player.dataset.track=t.name;board._playingTrack=t;document.getElementById('deskTrackName').textContent=t.name;player.play().catch(()=>toast('Safari 需要再次点击播放'));controls.querySelector('.adv-record-disc').classList.add('playing');}};list.appendChild(b);});player.onplay=()=>controls.querySelector('.adv-record-disc')?.classList.add('playing');player.onpause=()=>controls.querySelector('.adv-record-disc')?.classList.remove('playing');if(!player.paused)controls.querySelector('.adv-record-disc').classList.add('playing');body.appendChild(controls);
}

function openReplyComposer(id, day) {
  const overlay = document.getElementById('overlay'); overlay.innerHTML = ''; overlay.style.display = 'flex'; overlay.classList.add('on');
  const sheet = document.createElement('div'); sheet.className = 'adv-sheet adv-paper';
  sheet.innerHTML = '<div class="adv-frame"><div class="adv-ctop"><span class="d">写一封回信</span><span class="by">reply</span></div><p class="adv-editor-intro">这封回信只关联原礼物，不会改写对方的内容。</p></div>';
  const frame = sheet.querySelector('.adv-frame'); const ta = document.createElement('textarea'); ta.className = 'adv-ta'; ta.placeholder = '想对这份礼物说什么？';
  const saved = localStorage.getItem(`advent-v4-reply:${id}`); if (saved) ta.value = saved;
  const row = document.createElement('div'); row.className = 'adv-row'; const close = document.createElement('button'); close.className = 'adv-btn'; close.textContent = '关上';
  const save = document.createElement('button'); save.className = 'adv-btn solid'; save.textContent = '保存回信';
  close.onclick = closeMainOverlay; save.onclick = () => { try { Backend.reply(day, id, ta.value); localStorage.removeItem(`advent-v4-reply:${id}`); board=Backend.getBoard(); refresh(); toast('回信已封好，可随下一次发布同步'); closeMainOverlay(); } catch(e) { toast(e.message); } };
  frame.append(ta, row); row.append(close, save); overlay.appendChild(sheet); overlay.onclick = e => { if (e.target === overlay) closeMainOverlay(); };
}

function buildScrapbookContent(layout) {
  const content = document.createElement('div'); content.className = 'adv-scrap-content';
  const border = document.createElement('span'); border.className = 'adv-scrap-border'; content.appendChild(border);
  const tape = document.createElement('span'); tape.className = `adv-scrap-tape tape-${layout.tape || 'paper'}`; content.appendChild(tape);
  const title = document.createElement('h3'); title.className = 'adv-scrap-title'; title.textContent = layout.title || '冬日手账'; content.appendChild(title);
  const text = document.createElement('p'); text.className = 'adv-scrap-text'; text.textContent = layout.text || ''; text.style.textAlign = ['left','center','right'].includes(layout.align) ? layout.align : 'left'; content.appendChild(text);
  const seal = document.createElement('span'); seal.className = `adv-scrap-seal seal-${layout.wax || 'wine'}`; seal.textContent = '✦'; content.appendChild(seal);
  return content;
}

function fitScrapbookPage(page) {
  const title = page.querySelector('.adv-scrap-title');
  const text = page.querySelector('.adv-scrap-text');
  if (!title || !text) return page.getBoundingClientRect().height;
  const width = page.getBoundingClientRect().width;
  if (!width) return width * 4 / 3;
  text.style.top = `${title.offsetTop + title.offsetHeight + width * .045}px`;
  const needed = text.offsetTop + text.offsetHeight + width * .09;
  const height = Math.max(width * 4 / 3, Math.ceil(needed));
  page.style.height = `${height}px`;
  page.style.aspectRatio = 'auto';
  return height;
}

function renderScrapbook(container, layout) {
  const page = document.createElement('div'); page.className = `adv-scrap-read paper-${layout.paper || 'cream'}`;
  page.appendChild(buildScrapbookContent(layout));
  for (const s of layout.stickers || []) {
    const mark = document.createElement('span'); mark.className = 'adv-sticker adv-sticker-static';
    mark.style.left = `${s.x}%`; mark.style.top = `${s.y}%`; mark.style.opacity = s.opacity ?? 1; mark.style.zIndex = s.z ?? 2;
    mark.style.transform = `translate(-50%,-50%) scale(${s.scale || 1}) rotate(${s.rotate || 0}deg)`;
    if (s.src) {
      const img = document.createElement('img'); img.alt = s.name || '手账贴纸';
      Backend.resolveMediaUrl(s.src).then(src => { if (src) img.src = src; }).catch(() => {});
      mark.appendChild(img);
    } else mark.textContent = s.char;
    page.appendChild(mark);
  }
  container.appendChild(page);
  fitScrapbookPage(page);
  if (document.fonts) document.fonts.ready.then(() => { if (page.isConnected) fitScrapbookPage(page); });
  return page;
}

function loadCanvasImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/i.test(src)) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const timer = setTimeout(() => reject(new Error('图片解码超时')), 15000);
    img.onload = async () => {
      clearTimeout(timer);
      try { if (img.decode) await img.decode(); resolve(img); } catch (error) { reject(error); }
    };
    img.onerror = () => { clearTimeout(timer); reject(new Error('图片载入失败')); };
    img.src = src;
  });
}

function domTextLines(element) {
  const lines = [];
  let current = null;
  const flush = () => {
    if (current) lines.push(current);
    current = null;
  };
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const chars = Array.from(node.nodeValue || '');
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      if (char === '\n') { flush(); lines.push({ text: '', top: 0 }); continue; }
      const range = document.createRange();
      range.setStart(node, i); range.setEnd(node, i + 1);
      const rect = range.getBoundingClientRect();
      const top = rect.top;
      if (!current || (current.text && Math.abs(current.top - top) > 1)) flush();
      if (!current) current = { text: '', top };
      current.text += char;
    }
    flush();
  }
  if (!lines.length && current) lines.push(current);
  return lines.filter((line, index) => line.text || index < lines.length - 1);
}

function drawScrapbookText(ctx, element, pageRect, scaleX, scaleY) {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const fontSize = parseFloat(style.fontSize) * scaleX;
  const lineHeight = (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5) * scaleY;
  ctx.save();
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
  ctx.fillStyle = style.color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = style.textAlign || 'left';
  const x = (rect.left - pageRect.left) * scaleX;
  const width = rect.width * scaleX;
  const lines = domTextLines(element);
  lines.forEach((line) => {
    const text = line.text.trimEnd();
    if (!text) return;
    const lineX = ctx.textAlign === 'center' ? x + width / 2 : ctx.textAlign === 'right' ? x + width : x;
    const metrics = ctx.measureText(text);
    const ascent = metrics.actualBoundingBoxAscent || fontSize * .8;
    const descent = metrics.actualBoundingBoxDescent || fontSize * .2;
    const y = (line.top - pageRect.top) * scaleY;
    const baseline = y + (lineHeight - ascent - descent) / 2 + ascent;
    ctx.fillText(text, lineX, baseline);
  });
  ctx.restore();
}

async function exportScrapbookPng(canvas, scale) {
  if (!canvas) throw new Error('手账画布尚未准备好');
  const status = document.getElementById('scrapExportStatus');
  const button = document.getElementById('scrapExport');
  button.disabled = true;
  if (status) status.textContent = '正在加载字体与贴纸图片…';
  try {
    const titleText = canvas.querySelector('.adv-scrap-title')?.textContent || '';
    const bodyText = canvas.querySelector('.adv-scrap-text')?.textContent || '';
    const fontResults = await Promise.allSettled([
      document.fonts.load(`16px "Pinyon Script"`, titleText),
      document.fonts.load(`16px "Noto Serif SC"`, bodyText),
      document.fonts.load('16px "IM Fell English"'),
    ]);
    await document.fonts.ready;
    if (fontResults.some(result => result.status === 'rejected')) throw new Error('字体加载失败，未导出不完整的页面；请检查字体来源与跨域设置');
    fitScrapbookPage(canvas);
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('画布尺寸无效');
    const width = Math.round(1200 * scale);
    const height = Math.round(width * rect.height / rect.width);
    if (width > 4096 || height > 8192 || width * height > 12000000) throw new Error('导出尺寸超过安全内存上限，请改用 1× 或缩短正文');
    const output = document.createElement('canvas'); output.width = width; output.height = height;
    const ctx = output.getContext('2d');
    if (!ctx) throw new Error('浏览器无法创建 Canvas');
    const scaleX = width / rect.width, scaleY = height / rect.height;
    const paper = canvas.dataset.paper || 'cream';
    const paperColors = { cream:'#fffaf0', kraft:'#cfae78', grid:'#fffaf0', snow:'#edf3f4', botanical:'#fffaf0', blank:'#ffffff' };
    ctx.fillStyle = paperColors[paper] || paperColors.cream; ctx.fillRect(0, 0, width, height);
    if (paper === 'cream') {
      ctx.strokeStyle = 'rgba(107,68,35,.11)'; ctx.lineWidth = Math.max(1, scaleX);
      for (let y = 28 * scaleY; y < height; y += 28 * scaleY) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(width,y); ctx.stroke(); }
    } else if (paper === 'grid') {
      ctx.strokeStyle = 'rgba(98,128,150,.15)'; ctx.lineWidth = Math.max(1, scaleX);
      for (let x = 0; x < width; x += 24 * scaleX) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,height); ctx.stroke(); }
      for (let y = 0; y < height; y += 24 * scaleY) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(width,y); ctx.stroke(); }
    } else if (paper === 'snow') {
      ctx.fillStyle = '#ffffff';
      for (let y = 8 * scaleY; y < height; y += 32 * scaleY) for (let x = 8 * scaleX; x < width; x += 32 * scaleX) { ctx.beginPath(); ctx.arc(x,y,2*scaleX,0,Math.PI*2); ctx.fill(); }
    }
    const titleEl = canvas.querySelector('.adv-scrap-title');
    const textEl = canvas.querySelector('.adv-scrap-text');
    if (titleEl) drawScrapbookText(ctx, titleEl, rect, scaleX, scaleY);
    if (textEl) drawScrapbookText(ctx, textEl, rect, scaleX, scaleY);
    const tape = canvas.querySelector('.adv-scrap-tape');
    if (tape) {
      const tapeRect = tape.getBoundingClientRect();
      ctx.save(); ctx.translate((tapeRect.left-rect.left+tapeRect.width/2)*scaleX,(tapeRect.top-rect.top+tapeRect.height/2)*scaleY); ctx.rotate(-3*Math.PI/180);
      ctx.globalAlpha = tape.classList.contains('tape-transparent') ? .45 : .78;
      ctx.fillStyle = tape.classList.contains('tape-holly') ? '#49633c' : '#d8c397'; ctx.fillRect(-tapeRect.width*scaleX/2,-tapeRect.height*scaleY/2,tapeRect.width*scaleX,tapeRect.height*scaleY); ctx.restore();
    }
    const seal = canvas.querySelector('.adv-scrap-seal');
    if (seal) {
      const sealRect = seal.getBoundingClientRect(), sealStyle = getComputedStyle(seal);
      ctx.save(); ctx.fillStyle = sealStyle.backgroundColor; ctx.beginPath(); ctx.arc((sealRect.left-rect.left+sealRect.width/2)*scaleX,(sealRect.top-rect.top+sealRect.height/2)*scaleY,sealRect.width*scaleX/2,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = sealStyle.color; ctx.font = `${sealRect.width*.42*scaleX}px ${getComputedStyle(document.body).fontFamily}`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('✦',(sealRect.left-rect.left+sealRect.width/2)*scaleX,(sealRect.top-rect.top+sealRect.height/2)*scaleY); ctx.restore();
    }
    const border = canvas.querySelector('.adv-scrap-border');
    if (border) {
      const borderRect = border.getBoundingClientRect();
      ctx.strokeStyle = '#9a6b35'; ctx.lineWidth = Math.max(1, scaleX); ctx.strokeRect((borderRect.left-rect.left)*scaleX,(borderRect.top-rect.top)*scaleY,borderRect.width*scaleX,borderRect.height*scaleY);
    }
    if (paper === 'botanical') {
      const colors = ['#49633c','#a33b3b','#d5b56a']; const band = 12 * scaleX;
      for (let i = 0; i < Math.ceil((width+height)/(15*scaleX)); i++) {
        ctx.strokeStyle = colors[i%3]; ctx.lineWidth = 5*scaleX; const p=i*15*scaleX;
        ctx.beginPath(); ctx.moveTo(p,0); ctx.lineTo(0,p); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(width-p,height); ctx.lineTo(width,height-p); ctx.stroke();
      }
    }
    const stickers = [...canvas.querySelectorAll(':scope > .adv-sticker')].sort((a,b) => (+a.style.zIndex || 0)-(+b.style.zIndex || 0));
    const failures = [];
    for (const mark of stickers) {
      const src = mark.dataset.src;
      const x = (parseFloat(mark.style.left)/100) * width;
      const y = (parseFloat(mark.style.top)/100) * height;
      const size = width * .13;
      ctx.save(); ctx.translate(x,y); ctx.rotate((+mark.dataset.rotate||0)*Math.PI/180); ctx.scale(+mark.dataset.scale||1,+mark.dataset.scale||1);
      const opacity = Number(mark.dataset.opacity ?? 1);
      ctx.globalAlpha = Number.isFinite(opacity) ? Math.max(0,Math.min(1,opacity)) : 1;
      if (src) {
        try {
          const resolved = await Backend.resolveMediaUrl(src);
          if (!resolved) throw new Error('本地图片不存在或链接不受支持');
          const img = await loadCanvasImage(resolved);
          const ratio = Math.min(size/img.naturalWidth,size/img.naturalHeight);
          const drawW=img.naturalWidth*ratio, drawH=img.naturalHeight*ratio;
          ctx.drawImage(img,-drawW/2,-drawH/2,drawW,drawH);
        } catch (error) { failures.push(`${mark.dataset.name || '贴纸'}：${error.message}`); }
      } else {
        ctx.font = `${size}px ${getComputedStyle(mark).fontFamily}`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#3a2f28'; ctx.fillText(mark.dataset.char||'',0,0);
      }
      ctx.restore();
    }
    if (failures.length) throw new Error(`导出取消，以下贴纸未能载入：${failures.join('；')}`);
    const blob = await new Promise((resolve,reject) => output.toBlob(value => value ? resolve(value) : reject(new Error('PNG 编码失败或图片跨域污染')), 'image/png'));
    const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href=url; link.download=`christmas-scrapbook-${scale}x.png`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),2000);
    if (status) status.textContent = `PNG 已导出 · ${width} × ${height}`;
  } finally { button.disabled = false; }
}

function openScrapbook() {
  const overlay = document.getElementById('overlay'); overlay.innerHTML = ''; overlay.style.display = 'flex'; overlay.classList.add('on');
  const sheet = document.createElement('div'); sheet.className = 'adv-sheet adv-paper';
  sheet.innerHTML = '<div class="adv-frame"><div class="adv-ctop"><span class="d">手账抽屉</span><span class="by">scrapbook</span></div><div class="adv-scrap-body"><div class="adv-scrap-main"><p class="adv-editor-intro">拖动贴纸，留下今天的页面。草稿只保存在当前浏览器。</p><label class="adv-lab">礼物日期</label><input class="adv-in1" id="scrapDay" type="number" min="1" max="25" value="1"><label class="adv-lab">信纸标题</label><input class="adv-in1" id="scrapTitle" placeholder="十二月的某一天"><label class="adv-lab">正文</label><textarea class="adv-ta" id="scrapText" placeholder="写一点冬天的事…"></textarea><div class="adv-sticker-tray"><button type="button" data-sticker="★">★</button><button type="button" data-sticker="❄">❄</button><button type="button" data-sticker="♡">♡</button><button type="button" data-sticker="🍪">🍪</button><label class="adv-sticker-upload">＋ PNG<input id="stickerUpload" type="file" accept="image/png,image/webp" hidden></label></div></div><div class="adv-scrap-side"><button type="button" class="adv-stklib-toggle" id="stklibToggle" aria-expanded="true">🎀 贴纸收纳册 <small>分类 · 搜索 · 配色 · 收藏</small></button><div class="adv-stklib-host" id="stklibHost"></div></div><div class="adv-scrap-stage"><div class="adv-sticker-tools"><button type="button" data-action="smaller">−</button><button type="button" data-action="larger">＋</button><button type="button" data-action="rotate">↻</button><button type="button" data-action="fade">◐</button><button type="button" data-action="back">↓</button><button type="button" data-action="front">↑</button><button type="button" data-action="copy">复制</button><button type="button" data-action="delete">删除</button><button type="button" data-action="undo">撤销</button><button type="button" data-action="redo">重做</button></div><div class="adv-scrap-canvas" id="scrapCanvas"></div><div class="adv-row adv-scrap-actions"><button class="adv-btn" id="scrapExport">导出 PNG</button><select id="scrapExportScale" aria-label="导出倍数"><option value="1">1× 标准</option><option value="2">2× 高清</option></select><span id="scrapExportStatus" class="adv-hint" role="status"></span><button class="adv-btn" id="scrapClose">关上</button><button class="adv-btn" id="scrapSave">保存草稿</button><button class="adv-btn solid" id="scrapPublish">封成礼物</button></div></div></div></div>';
  overlay.appendChild(sheet);
  const title = sheet.querySelector('#scrapTitle'), text = sheet.querySelector('#scrapText'), canvas = sheet.querySelector('#scrapCanvas');
  const tray=sheet.querySelector('.adv-sticker-tray');tray.insertAdjacentHTML('beforebegin','<div class="adv-scrap-materials"><label>信纸<select id="scrapPaper"><option value="cream">奶油复古</option><option value="kraft">牛皮纸</option><option value="grid">格纹纸</option><option value="snow">雪花信纸</option><option value="botanical">圣诞植物边框</option><option value="blank">简洁空白</option></select></label><label>火漆<select id="scrapWax"><option value="wine">酒红</option><option value="gold">柔金</option><option value="green">松绿</option></select></label><label>胶带<select id="scrapTape"><option value="paper">牛皮纸胶带</option><option value="transparent">半透明胶带</option><option value="holly">冬青胶带</option></select></label><label>正文对齐<select id="scrapAlign"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label></div>');
  const paper=sheet.querySelector('#scrapPaper'),wax=sheet.querySelector('#scrapWax'),tape=sheet.querySelector('#scrapTape'),align=sheet.querySelector('#scrapAlign');
  let scrapContent = null;
  const currentLayout = () => ({ title:title.value.slice(0,200), text:text.value.slice(0,6000), paper:paper.value, wax:wax.value, tape:tape.value, align:align.value, stickers:snapshot() });
  function syncScrapbookCanvas() {
    canvas.dataset.paper = paper.value;
    scrapContent?.remove();
    scrapContent = buildScrapbookContent(currentLayout());
    canvas.prepend(scrapContent);
    fitScrapbookPage(canvas);
    if (document.fonts) document.fonts.ready.then(() => { if (canvas.isConnected) fitScrapbookPage(canvas); });
  }
  [paper,wax,tape,align].forEach(select => select.addEventListener('change', syncScrapbookCanvas));
  title.addEventListener('input', syncScrapbookCanvas); text.addEventListener('input', syncScrapbookCanvas);
  let selected = null, history = [], future = [], stklib = null;
  /* 贴纸快照保留图案元数据，便于重新打开后替换/识别；src 始终是渲染用的 raw URL */
  const stickerNodes = () => [...canvas.querySelectorAll(':scope > .adv-sticker')];
  const snapshot = () => stickerNodes().map(b=>({char:b.dataset.char||'',src:b.dataset.src||'',x:parseFloat(b.style.left),y:parseFloat(b.style.top),scale:+(b.dataset.scale??1),rotate:+(b.dataset.rotate??0),opacity:+(b.dataset.opacity??1),z:+(b.style.zIndex??1),name:b.dataset.name||'',stickerId:b.dataset.stickerId||'',patternId:b.dataset.patternId||''}));
  const remember = () => { history.push(snapshot()); if (history.length > 40) history.shift(); future = []; };
  const restore = list => { stickerNodes().forEach(node => node.remove()); selected=null; (list||[]).forEach(addStickerFromData); };
  try { const d = JSON.parse(localStorage.getItem('advent-v4-scrapbook') || 'null'); if (d) { title.value = d.title || ''; text.value = d.text || '';paper.value=d.paper||'cream';wax.value=d.wax||'wine';tape.value=d.tape||'paper';align.value=d.align||'left';restore(d.stickers || []); } } catch {}
  syncScrapbookCanvas();
  function applySticker(b) { b.style.transform=`translate(-50%,-50%) scale(${b.dataset.scale||1}) rotate(${b.dataset.rotate||0}deg)`; b.style.opacity=b.dataset.opacity??1; }
  function addStickerFromData(s) { addSticker(s.char||'',s.x??50,s.y??50,s); }
  function addSticker(char,x=50,y=50,data={}) {
    const b=document.createElement('button');b.type='button';b.className='adv-sticker';b.dataset.char=char;b.dataset.src=data.src||'';b.dataset.scale=data.scale||1;b.dataset.rotate=data.rotate||0;b.dataset.opacity=data.opacity??1;b.dataset.name=data.name||'';b.dataset.stickerId=data.stickerId||'';b.dataset.patternId=data.patternId||'';b.style.left=x+'%';b.style.top=y+'%';b.style.zIndex=data.z??1;
    if(data.src){const img=document.createElement('img');img.alt=data.name||'贴纸';if(data.preview)img.src=data.preview;else Backend.resolveMediaUrl(data.src).then(src=>{if(src)img.src=src;});b.appendChild(img);}else b.textContent=char;applySticker(b);
    b.onclick=()=>{selected?.classList.remove('selected');selected=b;b.classList.add('selected');};
    const points=new Map();let gesture=null;
    b.onpointerdown=e=>{if(!points.size)remember();b.onclick();points.set(e.pointerId,{x:e.clientX,y:e.clientY});b.setPointerCapture(e.pointerId);if(points.size===2){const [a,c]=[...points.values()];gesture={distance:Math.hypot(c.x-a.x,c.y-a.y),angle:Math.atan2(c.y-a.y,c.x-a.x),scale:+b.dataset.scale,rotate:+b.dataset.rotate};}};
    b.onpointermove=e=>{if(!points.has(e.pointerId))return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});if(points.size===1){const r=canvas.getBoundingClientRect();b.style.left=Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100))+'%';b.style.top=Math.max(0,Math.min(100,(e.clientY-r.top)/r.height*100))+'%';}else if(points.size===2&&gesture){const [a,c]=[...points.values()];const distance=Math.hypot(c.x-a.x,c.y-a.y),angle=Math.atan2(c.y-a.y,c.x-a.x);b.dataset.scale=clampNumber(gesture.scale*distance/Math.max(1,gesture.distance),.2,4);b.dataset.rotate=gesture.rotate+(angle-gesture.angle)*180/Math.PI;applySticker(b);}};
    const end=e=>{points.delete(e.pointerId);if(points.size<2)gesture=null;};b.onpointerup=end;b.onpointercancel=end;canvas.appendChild(b);return b;
  }
  function clampNumber(n,min,max){return Math.max(min,Math.min(max,Number(n)||min));}
  sheet.querySelectorAll('[data-sticker]').forEach(b => b.onclick = () => addSticker(b.dataset.sticker));
  sheet.querySelector('#stickerUpload').onchange=async e=>{const f=e.target.files?.[0];if(!f||f.size>2*1024*1024)return toast('贴纸需为 2MB 以内的 PNG/WebP');try{const uploaded=await Backend.uploadFile(f);const preview=await Backend.resolveMediaUrl(uploaded.url);remember();addSticker('',50,50,{src:uploaded.url,preview});}catch(err){toast(err.message);}};
  /* 集成素材库：点击添加、替换选中，草稿/发布都会带上 raw URL */
  stklib = mountStickerLibrary(sheet.querySelector('#stklibHost'), {
    onPick(s){ remember(); if(selected)selected.classList.remove('selected'); const b=addSticker('',50,50,{src:s.raw_url,preview:s.raw_url,name:s.name_zh,stickerId:s.id,patternId:s.pattern_id}); selected=b; b.classList.add('selected'); stklib?.refresh?.(); },
    onReplace(s){ if(!selected)return toast('先点选一枚贴纸再替换'); remember(); const img=selected.querySelector('img'); selected.dataset.src=s.raw_url; selected.dataset.name=s.name_zh; selected.dataset.stickerId=s.id; selected.dataset.patternId=s.pattern_id; if(img){img.src=s.raw_url;img.alt=s.name_zh;}else{selected.textContent='';const ni=document.createElement('img');ni.alt=s.name_zh;ni.src=s.raw_url;selected.appendChild(ni);} applySticker(selected); },
    hasSelection(){ return !!selected; },
  });
  window.__advStklibDispose = () => { try { stklib?.destroy?.(); } catch {} stklib = null; };
  const stkToggle=sheet.querySelector('#stklibToggle'),stkHost=sheet.querySelector('#stklibHost');
  // 竖屏窄屏默认收起收纳册，避免把画布挤出首屏；横屏/桌面保持展开
  if(window.innerWidth<820){stkHost.classList.add('collapsed');stkToggle.setAttribute('aria-expanded','false');}
  stkToggle.onclick=()=>{const hidden=stkHost.classList.toggle('collapsed');stkToggle.setAttribute('aria-expanded',String(!hidden));};
  sheet.querySelector('.adv-sticker-tools').onclick=e=>{const a=e.target.dataset.action;if(!a)return;if(a==='undo'){if(!history.length)return;future.push(snapshot());restore(history.pop());return;}if(a==='redo'){if(!future.length)return;history.push(snapshot());restore(future.pop());return;}if(!selected)return toast('先点选一枚贴纸');remember();if(a==='delete'){selected.remove();selected=null;return;}if(a==='copy'){addStickerFromData({...snapshot()[stickerNodes().indexOf(selected)],x:parseFloat(selected.style.left)+4,y:parseFloat(selected.style.top)+4});return;}if(a==='smaller')selected.dataset.scale=Math.max(.3,+selected.dataset.scale-.1);if(a==='larger')selected.dataset.scale=Math.min(3,+selected.dataset.scale+.1);if(a==='rotate')selected.dataset.rotate=(+selected.dataset.rotate+15)%360;if(a==='fade')selected.dataset.opacity=Math.max(.2,+selected.dataset.opacity-.2);if(a==='back')selected.style.zIndex=Math.max(0,+selected.style.zIndex-1);if(a==='front')selected.style.zIndex=+selected.style.zIndex+1;applySticker(selected);};
  sheet.querySelector('#scrapExport').onclick=async()=>{
    syncScrapbookCanvas();
    const status=document.getElementById('scrapExportStatus');
    try { await exportScrapbookPng(canvas, +sheet.querySelector('#scrapExportScale').value || 1); }
    catch(error) { if(status)status.textContent=error.message; toast(error.message,5000); }
  };
  sheet.querySelector('#scrapClose').onclick = closeMainOverlay; sheet.querySelector('#scrapSave').onclick = () => { localStorage.setItem('advent-v4-scrapbook', JSON.stringify(currentLayout())); toast('手账草稿已保存'); closeMainOverlay(); };
  sheet.querySelector('#scrapPublish').onclick=()=>{const day=parseInt(sheet.querySelector('#scrapDay').value,10);if(!day||day<1||day>25)return toast('日期要在 1—25 之间');const layout=currentLayout();try{Backend.hide(day,[{type:'scrapbook',layout}], 'dessin');localStorage.removeItem('advent-v4-scrapbook');board=Backend.getBoard();refresh();toast(`手账已封进12月${day}日`);closeMainOverlay();}catch(e){toast(e.message);}};
  overlay.onclick = e => { if (e.target === overlay) closeMainOverlay(); };
}

function legacyEntryItems(entry) {
  const items = [];
  if (entry.text) items.push({ type: 'text', text: String(entry.text) });
  if (entry.song) items.push({ type: 'song', url: String(entry.song), name: entry.song_name || '' });
  if (entry.url) items.push({ type: entry.type || entry.kind || 'image', url: String(entry.url), name: entry.name || '' });
  return items;
}

function isAllowedRemoteAsset(url) {
  return Backend.isAllowedRemoteAsset(url);
}

function renderHalf(container, gift, label) {
  if (!gift) return null;
  const half = document.createElement('div');
  half.className = 'adv-half';
  const lbl = document.createElement('div');
  lbl.className = 'adv-hint';
  lbl.style.marginBottom = '4px';
  lbl.textContent = label;
  half.appendChild(lbl);
  for (const item of gift.items_v2 || gift.items || []) {
    renderItem(half, item, gift.day, 'human', gift.answer, gift.id || '');
  }
  appendMemoryActions(half, gift.id || `local-${gift.day}`, gift.day);
  container.appendChild(half);
  return half;
}

/* ── 编辑器（双方按 writer 身份追加礼物） ─────────────────────────── */
async function openEditor(defaultDay, giftId = '') {
  const writer = Backend.getWriter();
  const writerName = writer === 'yan' ? '砚砚' : '三三';
  const recipientName = writer === 'yan' ? '三三' : '砚砚';
  let editing = null;
  if (giftId) {
    try { editing = Backend.getGiftForEdit(Number(defaultDay), giftId); }
    catch (error) { toast(error.message); return; }
  }
  const existingItems = Array.isArray(editing?.items_v2) ? editing.items_v2 : [];
  const existingPhoto = existingItems.find(item => item.type === 'photo')?.photo || null;
  const preservedItems = existingItems.filter(item => !['text','song','image','photo','voice','attachment'].includes(item.type));
  const overlay = document.getElementById('overlay');
  overlay.innerHTML = '';
  overlay.style.display = 'flex';
  overlay.classList.add('on');

  const sheet = document.createElement('div');
  sheet.className = 'adv-sheet adv-paper adv-face adv-editor-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', '礼物编辑器');

  const frame = document.createElement('div');
  frame.className = 'adv-frame';

  const editorTop = document.createElement('div');
  editorTop.className = 'adv-ctop adv-editor-head';
  editorTop.innerHTML = `<span class="d">${editing ? '编辑这份礼物' : '藏一份礼物'}</span><span class="by">pour mon amour</span>`;
  frame.appendChild(editorTop);

  const editorIntro = document.createElement('p');
  editorIntro.className = 'adv-editor-intro';
  editorIntro.textContent = `${writerName}写给${recipientName}：把想说的话，悄悄封进十二月的一扇窗。`;
  frame.appendChild(editorIntro);

  const titleLabel = document.createElement('span'); titleLabel.className = 'adv-lab adv-editor-title-label'; titleLabel.innerHTML = 'le titre <i>礼物标题</i>';
  const titleIn = document.createElement('input'); titleIn.className = 'adv-in1'; titleIn.type = 'text'; titleIn.maxLength = 300; titleIn.placeholder = '给这份礼物一个容易认出的标题';
  titleIn.value = editing?.title || '';
  frame.append(titleLabel, titleIn);

  // 日期选择
  const dayLabel = document.createElement('span');
  dayLabel.className = 'adv-lab';
  dayLabel.innerHTML = 'le jour <i>放进哪天</i>';
  frame.appendChild(dayLabel);

  const dayIn = document.createElement('input');
  dayIn.className = 'adv-in1';
  dayIn.type = 'number';
  dayIn.min = 1;
  dayIn.max = 23;
  const editorRules = Backend.calendarRules();
  if (editorRules.minDay) dayIn.min = editorRules.minDay;
  dayIn.disabled = Boolean(editing);
  // 默认日期按北京时间：12 月取当日，否则取 1（与解锁规则同源）
  const bj = Backend.shanghaiNowIso();
  dayIn.value = defaultDay || (bj.slice(5, 7) === '12' ? parseInt(bj.slice(8, 10), 10) : 1);
  dayIn.style.marginBottom = '10px';
  frame.appendChild(dayIn);

  // 文字内容
  const textLabel = document.createElement('span');
  textLabel.className = 'adv-lab';
  textLabel.innerHTML = `le cadeau <i>写给${recipientName}的话</i>`;
  frame.appendChild(textLabel);

  const textArea = document.createElement('textarea');
  textArea.className = 'adv-ta';
  textArea.placeholder = '文字内容（可选）';
  textArea.value = existingItems.find(item => item.type === 'text')?.text || editing?.text || '';
  frame.appendChild(textArea);

  // Spotify 链接
  const spLabel = document.createElement('span');
  spLabel.className = 'adv-lab';
  spLabel.style.marginTop = '10px';
  spLabel.innerHTML = 'une chanson <i>Spotify 或网易云链接</i>';
  frame.appendChild(spLabel);

  const urlRow = document.createElement('div');
  urlRow.className = 'adv-url-row';

  const urlIn = document.createElement('input');
  urlIn.className = 'adv-in1';
  urlIn.type = 'url';
  urlIn.placeholder = 'https://open.spotify.com/track/… 或 https://music.163.com/song?id=…';
  const existingSong = existingItems.find(item => item.type === 'song');
  urlIn.value = existingSong?.url || '';

  const urlPreviewBtn = document.createElement('button');
  urlPreviewBtn.textContent = '预览';
  urlPreviewBtn.onclick = async () => {
    urlPreviewBtn.disabled = true;
    try {
      await identifyMusic();
      const parsed = window.AdventMusic?.parseMusicUrl(urlIn.value, {
        name: nameIn.value.trim(), artist: artistIn.value.trim(), album: albumIn.value.trim(), cover: coverIn.value.trim(),
      });
      if (!parsed) { toast('链接格式不认识，支持 Spotify track 和网易云歌曲链接'); return; }
      urlPreview.innerHTML = '';
      urlPreview.style.display = 'block';
      window.AdventMusic?.renderMusicItem(urlPreview, parsed);
    } finally { urlPreviewBtn.disabled = false; }
  };

  urlRow.appendChild(urlIn);
  urlRow.appendChild(urlPreviewBtn);
  frame.appendChild(urlRow);

  // 歌曲信息（可选）：手填优先，留空则尝试自动抓取
  const musicMetaRow = document.createElement('div');
  musicMetaRow.className = 'adv-url-row';
  const nameIn = document.createElement('input');
  nameIn.className = 'adv-in1';
  nameIn.type = 'text';
  nameIn.placeholder = '歌名（可选，留空自动抓）';
  const artistIn = document.createElement('input');
  artistIn.className = 'adv-in1';
  artistIn.type = 'text';
  artistIn.placeholder = '歌手（可选）';
  musicMetaRow.append(nameIn, artistIn);
  frame.appendChild(musicMetaRow);

  const albumIn = document.createElement('input');
  albumIn.className = 'adv-in1';
  albumIn.type = 'text';
  albumIn.placeholder = '专辑（可选，留空自动识别）';
  albumIn.style.marginTop = '6px';
  frame.appendChild(albumIn);

  const coverIn = document.createElement('input');
  coverIn.className = 'adv-in1';
  coverIn.type = 'url';
  coverIn.placeholder = '专辑封面图片链接（可选，留空自动抓）';
  coverIn.style.marginTop = '6px';
  frame.appendChild(coverIn);

  const musicStatus = document.createElement('div');
  musicStatus.className = 'adv-status adv-music-status';
  musicStatus.setAttribute('role', 'status');
  musicStatus.setAttribute('aria-live', 'polite');
  frame.appendChild(musicStatus);

  const urlPreview = document.createElement('div');
  urlPreview.className = 'adv-music-preview';
  urlPreview.style.display = 'none';
  frame.appendChild(urlPreview);

  if (existingSong) {
    nameIn.value = existingSong.name || editing?.song_name || '';
    artistIn.value = existingSong.artist || '';
    albumIn.value = existingSong.album || '';
    coverIn.value = existingSong.cover || '';
  }
  const musicInputs = { name: nameIn, artist: artistIn, album: albumIn, cover: coverIn };
  const autoMusicValues = {};
  const manualMusicFields = new Set();
  let musicRequestSeq = 0;
  let musicTimer = null;
  let lastMusicUrl = '';
  let lastMusicResult = null;
  let editorDirty = false;
  let editorClosed = false;

  for (const [field, input] of Object.entries(musicInputs)) {
    input.addEventListener('input', () => {
      manualMusicFields.add(field);
      urlPreview.style.display = 'none';
    });
  }
  function clearAutoMusic() {
    for (const [field, input] of Object.entries(musicInputs)) {
      if (autoMusicValues[field] && !manualMusicFields.has(field) && input.value === autoMusicValues[field]) input.value = '';
      delete autoMusicValues[field];
    }
  }
  async function identifyMusic() {
    const raw = urlIn.value.trim();
    const seq = ++musicRequestSeq;
    if (!raw) { musicStatus.textContent = '粘贴 Spotify track 或网易云完整歌曲链接后会自动识别。'; return null; }
    if (raw === lastMusicUrl && lastMusicResult) return lastMusicResult;
    musicStatus.textContent = '正在向公开元数据源识别歌曲…';
    const result = await window.AdventMusic?.resolveSongMetadata(raw);
    if (seq !== musicRequestSeq || editorClosed) return null;
    if (!result?.ok) {
      lastMusicResult = null;
      musicStatus.textContent = result?.message || '自动识别失败，可继续手填歌曲信息。';
      return null;
    }
    const meta = result.meta || {};
    const values = { name: meta.name, artist: meta.artist, album: meta.album, cover: meta.cover };
    for (const [field, value] of Object.entries(values)) {
      const input = musicInputs[field];
      if (!value || manualMusicFields.has(field) || input.value.trim()) continue;
      input.value = String(value);
      autoMusicValues[field] = String(value);
    }
    if (meta.url && meta.url !== raw) {
      urlIn.value = meta.url;
      lastMusicUrl = meta.url;
    } else lastMusicUrl = raw;
    lastMusicResult = result;
    musicStatus.textContent = `已识别：${nameIn.value.trim() || meta.name || '歌曲'}${artistIn.value.trim() ? ' · ' + artistIn.value.trim() : ''}。播放是否可用请在预览中确认。`;
    persistDraft();
    return result;
  }
  urlIn.addEventListener('input', () => {
    musicRequestSeq++;
    lastMusicUrl = ''; lastMusicResult = null;
    clearAutoMusic();
    musicStatus.textContent = '链接已更改，正在等待自动识别…';
    urlPreview.style.display = 'none';
    clearTimeout(musicTimer);
    musicTimer = setTimeout(identifyMusic, 650);
  });
  urlIn.addEventListener('blur', identifyMusic);

  // 图片上传
  const imgLabel = document.createElement('span');
  imgLabel.className = 'adv-lab';
  imgLabel.style.marginTop = '10px';
  imgLabel.innerHTML = 'une image <i>上传图片（≤5MB）</i>';
  frame.appendChild(imgLabel);

  const imgIn = document.createElement('input');
  imgIn.className = 'adv-file';
  imgIn.type = 'file';
  imgIn.accept = 'image/jpeg,image/png,image/gif,image/webp';
  imgIn.style.fontSize = '13px';
  imgIn.style.color = 'var(--adv-muted)';
  frame.appendChild(imgIn);

  const imgPreviewWrap = document.createElement('div');
  imgPreviewWrap.className = 'adv-upload-preview';
  frame.appendChild(imgPreviewWrap);

  let uploadedImageUrl = existingPhoto?.front?.url || existingItems.find(item => item.type === 'image')?.url || null;
  let previewObjectUrl = '';
  const photoOptions=document.createElement('div');photoOptions.className='adv-photo-editor-options';photoOptions.innerHTML='<label><input type="checkbox" id="asPhoto"> 作为可翻转照片</label><label>相纸边框<select id="photoFrame"><option value="polaroid">拍立得</option><option value="vintage">复古冲印</option><option value="plain">普通照片</option><option value="postcard">明信片</option><option value="stamp">邮票边框</option></select></label><label>显示方式<select id="photoFit"><option value="cover">填满裁切</option><option value="contain">完整显示</option></select></label><label>横向焦点 <input id="photoX" type="range" min="0" max="100" value="50"></label><label>纵向焦点 <input id="photoY" type="range" min="0" max="100" value="50"></label><input id="photoTitle" class="adv-in1" type="text" maxlength="200" placeholder="照片正面小标题（可选）"><textarea id="photoBack" class="adv-ta" placeholder="照片背面的故事、日期或签名"></textarea><div class="adv-photo-live" id="photoLive"></div>';
  if (existingPhoto) {
    photoOptions.querySelector('#asPhoto').checked = true;
    photoOptions.querySelector('#photoFrame').value = existingPhoto.front.frame || 'polaroid';
    photoOptions.querySelector('#photoFit').value = existingPhoto.front.fit || 'cover';
    photoOptions.querySelector('#photoX').value = existingPhoto.front.positionX ?? 50;
    photoOptions.querySelector('#photoY').value = existingPhoto.front.positionY ?? 50;
    photoOptions.querySelector('#photoTitle').value = existingPhoto.front.title || '';
    photoOptions.querySelector('#photoBack').value = existingPhoto.back.text || '';
  }
  frame.appendChild(photoOptions);
  const currentPhoto = () => ({
    front: {
      url: uploadedImageUrl || '', frame: photoOptions.querySelector('#photoFrame').value,
      fit: photoOptions.querySelector('#photoFit').value,
      positionX: +photoOptions.querySelector('#photoX').value,
      positionY: +photoOptions.querySelector('#photoY').value,
      title: photoOptions.querySelector('#photoTitle').value,
    },
    back: { text: photoOptions.querySelector('#photoBack').value, date: existingPhoto?.back?.date || '', signature: existingPhoto?.back?.signature || '' },
  });
  function updatePhotoPreview() {
    const live = photoOptions.querySelector('#photoLive');
    live.replaceChildren();
    if (uploadedImageUrl || previewObjectUrl) live.appendChild(buildPhotoView(currentPhoto(), '一张冬日照片', { src: previewObjectUrl || undefined }));
  }
  photoOptions.addEventListener('input', updatePhotoPreview);
  photoOptions.addEventListener('change', updatePhotoPreview);
  imgIn.onchange = async () => {
    const file = imgIn.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('图片不能超过 5MB'); imgIn.value = ''; return; }
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(file);
    imgPreviewWrap.replaceChildren();
    updatePhotoPreview();
    previewBtn.disabled = true;
    saveBtn.disabled = true;
    try {
      const res = await Backend.uploadFile(file);
      uploadedImageUrl = res.url;
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = '';
      updatePhotoPreview();
      persistDraft();
    } catch (e) {
      toast('上传失败：' + e.message);
    } finally {
      previewBtn.disabled = false;
      saveBtn.disabled = false;
    }
  };

  const attachmentLabel = document.createElement('span');
  attachmentLabel.className = 'adv-lab';
  attachmentLabel.style.marginTop = '10px';
  attachmentLabel.innerHTML = 'une pièce jointe <i>PDF、MIDI 或 MusicXML（≤25MB）</i>';
  frame.appendChild(attachmentLabel);
  const attachmentIn = document.createElement('input');
  attachmentIn.className = 'adv-file';
  attachmentIn.type = 'file';
  attachmentIn.accept = '.pdf,.mid,.midi,.musicxml,application/pdf,audio/midi,application/vnd.recordare.musicxml+xml';
  frame.appendChild(attachmentIn);
  const attachmentInfo = document.createElement('div'); attachmentInfo.className = 'adv-attachment-info'; frame.appendChild(attachmentInfo);
  let uploadedAttachment = existingItems.find(item => item.type === 'attachment') || null;
  if (uploadedAttachment) attachmentInfo.textContent = `已保留附件：${uploadedAttachment.name || uploadedAttachment.filename || '附件'}`;
  attachmentIn.onchange = async () => {
    const file = attachmentIn.files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { toast('附件不能超过 25MB'); attachmentIn.value = ''; return; }
    const ext = file.name.toLowerCase().split('.').pop();
    const mimeByExt = { pdf: 'application/pdf', mid: 'audio/midi', midi: 'audio/midi', musicxml: 'application/vnd.recordare.musicxml+xml' };
    if (!mimeByExt[ext]) { toast('只支持 PDF、MIDI 与 MusicXML'); attachmentIn.value = ''; return; }
    try {
      const res = await Backend.uploadFile(file);
      uploadedAttachment = { type: 'attachment', url: res.url, name: file.name, mime: mimeByExt[ext] };
      attachmentInfo.textContent = `已暂存附件：${file.name}`;
    } catch (e) { toast('附件上传失败：' + e.message); }
  };

  // 录音
  const recLabel = document.createElement('span');
  recLabel.className = 'adv-lab';
  recLabel.style.marginTop = '10px';
  recLabel.innerHTML = 'une voix <i>录一段语音</i>';
  frame.appendChild(recLabel);

  const recRow = document.createElement('div');
  recRow.className = 'adv-rec';

  const recBtn = document.createElement('button');
  recBtn.className = 'adv-btn';
  recBtn.textContent = '开始录音';

  const recStatus = document.createElement('span');
  recStatus.className = 'adv-hint';

  recRow.appendChild(recBtn);
  recRow.appendChild(recStatus);
  frame.appendChild(recRow);

  let mediaRecorder = null;
  let recChunks = [];
  let recUrl = null;
  let recUploadUrl = existingItems.find(item => item.type === 'voice')?.url || null;
  if (recUploadUrl) recStatus.textContent = '已保留原有语音';

  recBtn.onclick = async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => recChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        recUrl = URL.createObjectURL(blob);
        recStatus.innerHTML = `<span class="adv-rec-dot"></span>已录制 · 暂存中…`;
        // 暂存到浏览器（发布时再转存到 GitHub 仓库）
        try {
          const res = await Backend.uploadFile(blob);
          recUploadUrl = res.url;
          recStatus.textContent = '已暂存 ✓';
        } catch (e) {
          recStatus.textContent = '暂存失败：' + e.message;
        }
        recBtn.textContent = '重新录';
      };
      mediaRecorder.start();
      recBtn.innerHTML = `<span class="adv-rec-dot"></span>停止`;
      recStatus.textContent = '录音中…';
    } catch {
      recStatus.textContent = '无法访问麦克风';
    }
  };

  const makeGroup = (title, subtitle, nodes, open = false) => {
    const group = document.createElement('details'); group.className = 'adv-editor-group'; group.open = open;
    const summary = document.createElement('summary'); summary.textContent = title;
    const hint = document.createElement('small'); hint.textContent = subtitle; summary.appendChild(hint);
    group.appendChild(summary); frame.insertBefore(group, nodes[0]); group.append(...nodes); return group;
  };
  makeGroup('信与日期', '文字是礼物的主角', [dayLabel, dayIn, textLabel, textArea], true);
  makeGroup('一首歌', '公开元数据自动识别，手填优先', [spLabel, urlRow, musicMetaRow, albumIn, coverIn, musicStatus, urlPreview]);
  makeGroup('照片与相纸', '五种边框与裁切焦点实时预览', [imgLabel, imgIn, imgPreviewWrap, photoOptions]);
  makeGroup('附件与声音', 'PDF、MIDI、MusicXML 与录音', [attachmentLabel, attachmentIn, attachmentInfo, recLabel, recRow]);

  // 操作行
  const msgSpan = document.createElement('span');
  msgSpan.className = 'adv-hint';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'adv-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.onclick = () => closeOverlay();

  // 从当前编辑器内容构造 items，供「封好」与「预览对方视角」共用。
  function collectItems() {
    const items = [...preservedItems];
    const bodyText = textArea.value.trim();
    if (bodyText) items.push({ type: 'text', text: bodyText });

    const musicUrl = urlIn.value.trim();
    if (musicUrl) {
      const parsed = window.AdventMusic?.parseMusicUrl(musicUrl, {
        name: nameIn.value.trim(), artist: artistIn.value.trim(), album: albumIn.value.trim(), cover: coverIn.value.trim(),
      });
      if (parsed) items.push(parsed);
      else return { error: '音乐链接格式不认识' };
    }

    if (uploadedImageUrl) {
      const asPhoto=photoOptions.querySelector('#asPhoto').checked;
      if(asPhoto)items.push({type:'photo',photo:currentPhoto()});
      else items.push({ type: 'image', url: uploadedImageUrl });
    }
    if (recUploadUrl) items.push({ type: 'voice', url: recUploadUrl });
    if (uploadedAttachment) items.push(uploadedAttachment);
    return { items };
  }

  // 预览：以对方打开礼物时看到的样子展示当前内容，不写入存档、不记录偷看。
  const previewBtn = document.createElement('button');
  previewBtn.className = 'adv-btn';
  previewBtn.textContent = '👁 预览对方视角';
  previewBtn.onclick = async () => {
    const day = parseInt(dayIn.value);
    if (!day || day < 1 || day > 25) { msgSpan.textContent = '日期要在 1—25 之间'; return; }
    previewBtn.disabled = true;
    try { await identifyMusic(); } finally { previewBtn.disabled = false; }
    const { items, error } = collectItems();
    if (error) { msgSpan.textContent = error; return; }
    if (!items || !items.length) { msgSpan.textContent = '写点什么再预览~'; return; }
    showSelfPreview(day, items);
  };

  const saveBtn = document.createElement('button');
  saveBtn.className = 'adv-btn solid';
  saveBtn.textContent = editorRules.canCreate ? '封好礼盒' : '当前阶段只读';
  saveBtn.disabled = !editorRules.canCreate;
  saveBtn.onclick = async () => {
    const day = parseInt(dayIn.value);
    if (!day || day < 1 || day > 25) { msgSpan.textContent = '日期要在 1—25 之间'; return; }

    const { items, error } = collectItems();
    if (error) { msgSpan.textContent = error; return; }
    if (!items || !items.length) { msgSpan.textContent = '写点什么再封好~'; return; }

    saveBtn.disabled = true;
    try {
      await identifyMusic();
      const collected = collectItems();
      if (collected.error) { msgSpan.textContent = collected.error; saveBtn.disabled = false; return; }
      if (!collected.items?.length) { msgSpan.textContent = '写点什么再封好~'; saveBtn.disabled = false; return; }
      const options = { title: titleIn.value.trim(), icon: collected.items.some(i => i.type === 'song') ? 'chanson' : 'lettre' };
      if (editing) Backend.updateGift(day, giftId, collected.items, options);
      else Backend.hide(day, collected.items, options.icon, options);
      board = Backend.getBoard();
      refresh();
      editorDirty = false;
      try { localStorage.removeItem(draftKey); } catch {}
      toast(editing ? '礼物已更新，发布后双方同步' : `12月${day}日又多了一份礼物 ♥`);
      closeOverlay(true);
    } catch (e) {
      msgSpan.textContent = e.message;
      saveBtn.disabled = false;
    }
  };

  const row = document.createElement('div');
  row.className = 'adv-row adv-editor-actions';
  row.appendChild(msgSpan);
  row.appendChild(cancelBtn);
  row.appendChild(previewBtn);
  row.appendChild(saveBtn);
  frame.appendChild(row);

  const editorScroll = document.createElement('div'); editorScroll.className = 'adv-editor-scroll';
  for (const child of [...frame.children]) if (child !== editorTop && child !== row) editorScroll.appendChild(child);
  frame.insertBefore(editorScroll, row);
  sheet.appendChild(frame);
  overlay.appendChild(sheet);
  // 草稿只存在本地，按身份/日期隔离；不会进入 Backend.hide 或 GitHub 同步。
  const draftKey = editing ? `advent-v4-edit:${writer}:${giftId}` : `advent-v4-draft:${writer}:${dayIn.value || 'new'}`;
  const draftFields = [...sheet.querySelectorAll('input:not([type=file]), select, textarea')];
  const fieldKeys = draftFields.map((el, i) => el.id || el.name || `${el.tagName.toLowerCase()}:${i}`);
  let restoredDraft = null;
  try { restoredDraft = editing ? null : JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { /* ignore malformed local draft */ }
  if (restoredDraft?.values) {
    draftFields.forEach((el, i) => {
      const key = fieldKeys[i];
      const value = Array.isArray(restoredDraft.values) ? restoredDraft.values[i] : restoredDraft.values[key];
      if (value === undefined) return;
      if (el.type === 'checkbox') el.checked = Boolean(value); else el.value = value;
    });
  }
  if (!editing) {
    uploadedImageUrl = restoredDraft?.assets?.image || '';
    uploadedAttachment = restoredDraft?.assets?.attachment || null;
    recUploadUrl = restoredDraft?.assets?.voice || '';
  }
  const restoredAutoFields = new Set(restoredDraft?.auto_music || []);
  for (const [field, input] of Object.entries(musicInputs)) {
    if (restoredAutoFields.has(field) && input.value) autoMusicValues[field] = input.value;
    else if (input.value) manualMusicFields.add(field);
  }
  if (uploadedImageUrl) updatePhotoPreview();
  editorDirty = false;
  function persistDraft() {
    if (editorClosed) return;
    editorDirty = true;
    const values = {};
    draftFields.forEach((el, i) => { values[fieldKeys[i]] = el.type === 'checkbox' ? el.checked : el.value; });
    try { localStorage.setItem(draftKey, JSON.stringify({
      version: 2, saved_at: Date.now(), values,
      legacy_values: draftFields.map(el => el.type === 'checkbox' ? el.checked : el.value),
      assets: { image: uploadedImageUrl, attachment: uploadedAttachment, voice: recUploadUrl },
      auto_music: Object.keys(autoMusicValues).filter(field => !manualMusicFields.has(field)),
    })); } catch { /* storage full */ }
  }
  draftFields.forEach(el => {
    el.addEventListener('input', persistDraft);
    el.addEventListener('change', persistDraft);
  });
  window.addEventListener('beforeunload', beforeUnload);
  overlay.onclick = e => { if (e.target === overlay) closeOverlay(); };

  function beforeUnload(e) {
    if (!editorDirty || editorClosed) return;
    e.preventDefault(); e.returnValue = '';
  }
  function closeOverlay(force = false) {
    if (!force && editorDirty && !window.confirm('礼物尚未封好。要保留本地草稿并关上编辑器吗？')) return;
    editorClosed = true;
    clearTimeout(musicTimer);
    musicRequestSeq++;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    window.removeEventListener('beforeunload', beforeUnload);
    overlay.classList.remove('on');
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }
}

/* ── 存档浮层 ─────────────────────────────────────────────────────── */
function showArchive() {
  {
    const b = Backend.getBoard();
    board = b;
    const overlay = document.getElementById('overlay');
    overlay.innerHTML = '';
    overlay.style.display = 'flex';
    overlay.classList.add('on');

    const sheet = document.createElement('div');
    sheet.className = 'adv-sheet adv-paper adv-face';

    const frame = document.createElement('div');
    frame.className = 'adv-frame';

    const ctop = document.createElement('div');
    ctop.className = 'adv-ctop';
    ctop.innerHTML = `<span class="d">存档</span><span class="by">我们的十二月</span>`;
    frame.appendChild(ctop);

    const list = document.createElement('ul');
    list.className = 'adv-list';

    const opened = b.cells.filter(c => Object.values(c.opened_by || {}).length > 0);
    const peeks = b.peeks;
    const counts = b.peek_counts || {};

    const summary = document.createElement('li');
    summary.innerHTML = `<span class="w">已打开 ${opened.length}/25 扇窗 · 泡芙记录 ${peeks} 次（三三 ${counts.san || 0} / 砚砚 ${counts.yan || 0}）</span>`;
    list.appendChild(summary);

    for (const event of b.peek_events || []) {
      const li = document.createElement('li');
      const who = event.who === 'yan' ? '砚砚' : '三三';
      const outcome = event.outcome === 'read' ? '实际偷看到礼物' : '尝试提前开窗（未看到内容）';
      const when = event.peeked_at ? new Date(event.peeked_at).toLocaleString('zh-CN', { timeZone: TZ }) : '时间未知';
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = `DAY ${event.day}`;
      const w = document.createElement('span');
      w.className = 'w';
      w.textContent = `${who} · ${outcome} · ${when}`;
      li.append(n, w);
      list.appendChild(li);
    }

    // 有回答的问题
    for (const c of b.cells) {
      const answer = c.gifts?.ai?.answer;
      if (answer) {
        const li = document.createElement('li');
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = `DAY ${c.day}`;
        const w = document.createElement('span');
        w.className = 'w ok';
        w.textContent = answer;
        li.append(n, w);
        list.appendChild(li);
      }
    }

    frame.appendChild(list);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'adv-btn';
    closeBtn.style.marginTop = '12px';
    closeBtn.textContent = '关闭';
    closeBtn.onclick = () => { overlay.classList.remove('on'); overlay.style.display = 'none'; overlay.innerHTML = ''; };
    frame.appendChild(closeBtn);

    sheet.appendChild(frame);
    overlay.appendChild(sheet);
    overlay.onclick = e => { if (e.target === overlay) closeBtn.onclick(); };
  }
}

/* ── 发布浮层 ─────────────────────────────────────────────────────── */
function showPublish() {
  const overlay = document.getElementById('overlay');
  overlay.innerHTML = '';
  overlay.style.display = 'flex';
  overlay.classList.add('on');

  const sheet = document.createElement('div');
  sheet.className = 'adv-sheet adv-paper adv-face';

  const frame = document.createElement('div');
  frame.className = 'adv-frame';
  const alreadyPat = Backend.hasPat();
  const rememberedPat = Backend.hasRememberedPat();
  frame.innerHTML = `
    <div class="adv-ctop"><span class="d">发布</span><span class="by">加密推送到 GitHub</span></div>
    <p class="adv-body" style="margin-top:12px;font-size:13.5px;line-height:1.9">
      把你写好的礼物加密后推送到 GitHub，砚砚同步后就能看到。<br>
      Token 不会写入源码、礼物数据、公开仓库或日志。默认只留在当前标签页；
      勾选记住后会明文保存在此浏览器的 localStorage，直到你主动清除。<br>
      localStorage 不是安全凭证库；共享电脑或浏览器配置文件时请勿记住 Token。
    </p>
  `;

  // Token 默认仅本次会话有效；勾选记住后明文保存在本机 localStorage
  const tokenLabel = document.createElement('span');
  tokenLabel.className = 'adv-lab';
  tokenLabel.style.marginTop = '10px';
  tokenLabel.innerHTML = alreadyPat
    ? `GitHub Token <i>${rememberedPat ? '此设备已记住' : '本标签页已提供'}，如需更换请在下方粘贴新 Token</i>`
    : 'GitHub Token <i>Fine-grained PAT，仅限礼物数据仓库的 Contents 读写</i>';
  frame.appendChild(tokenLabel);

  const tokenIn = document.createElement('input');
  tokenIn.className = 'adv-in1';
  tokenIn.type = 'password';
  tokenIn.placeholder = 'github_pat_…' + (alreadyPat ? '（留空则使用本次会话已提供的 Token）' : '');
  tokenIn.autocomplete = 'off';
  frame.appendChild(tokenIn);

  const rememberLabel = document.createElement('label');
  rememberLabel.className = 'adv-token-remember';
  const rememberIn = document.createElement('input'); rememberIn.type = 'checkbox'; rememberIn.checked = rememberedPat;
  rememberLabel.append(rememberIn, document.createTextNode('在此设备记住 Token（明文 localStorage，有风险）'));
  frame.appendChild(rememberLabel);

  const clearTokenBtn = document.createElement('button');
  clearTokenBtn.className = 'adv-btn adv-clear-token'; clearTokenBtn.type = 'button'; clearTokenBtn.textContent = '清除本机 Token';
  clearTokenBtn.disabled = !alreadyPat;
  clearTokenBtn.onclick = () => {
    Backend.clearPat(); tokenIn.value = ''; rememberIn.checked = false; clearTokenBtn.disabled = true;
    tokenLabel.querySelector('i').textContent = '本机与当前标签页的 Token 已清除';
    msgSpan.textContent = 'Token 已清除；已发布到 GitHub 的数据不会被删除。';
  };
  frame.appendChild(clearTokenBtn);

  const msgSpan = document.createElement('div');
  msgSpan.className = 'adv-status';
  frame.appendChild(msgSpan);

  const row = document.createElement('div');
  row.className = 'adv-row';
  row.style.marginTop = '12px';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'adv-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.onclick = () => closeOverlay();

  const pubBtn = document.createElement('button');
  pubBtn.className = 'adv-btn solid';
  pubBtn.textContent = '发布';
  pubBtn.onclick = async () => {
    const tokenValue = tokenIn.value.trim();
    if (tokenValue) {
      try { Backend.setPat(tokenValue, rememberIn.checked); }
      catch (e) { msgSpan.textContent = e.message; return; }
    } else if (alreadyPat) {
      Backend.setPatRemember(rememberIn.checked);
    }
    if (!Backend.hasPat()) {
      msgSpan.textContent = '请先粘贴 GitHub Token（Fine-grained PAT）';
      return;
    }
    pubBtn.disabled = true;
    tokenIn.value = ''; // 不在 DOM 里留存 Token 明文
    msgSpan.textContent = '正在加密并推送…';
    try {
      const r = await Backend.publish(msg => { msgSpan.textContent = msg; });
      msgSpan.replaceChildren();
      const ok = document.createElement('b'); ok.textContent = '已发布并核验远端';
      msgSpan.append(ok, document.createTextNode(` · ${r.message}`));
      board = Backend.getBoard(); refresh();
      setTimeout(closeOverlay, 2200);
    } catch (e) {
      const labels = { invalid_token: 'Token 无效或已撤销', permission: '权限不足', api_limit: 'GitHub 接口限流', network: '网络失败' };
      msgSpan.replaceChildren();
      const fail = document.createElement('b'); fail.textContent = labels[e.reason] || '发布失败';
      msgSpan.append(fail, document.createTextNode(` · ${e.message}`));
      pubBtn.disabled = false;
    }
  };

  row.appendChild(cancelBtn);
  row.appendChild(pubBtn);
  frame.appendChild(row);

  sheet.appendChild(frame);
  overlay.appendChild(sheet);
  overlay.onclick = e => { if (e.target === overlay) closeOverlay(); };

  function closeOverlay() {
    overlay.classList.remove('on');
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }
}

/* ── 说明 ─────────────────────────────────────────────────────────── */
function showHelp() {
  toast('每天双方都能藏多份礼物 · 新礼物会重新点亮 · 泡芙分别记录双方偷看', 5000);
}

/* ── 辅助 ─────────────────────────────────────────────────────────── */
function kindToIcon(kind) {
  const map = {
    letter: 'lettre', song: 'chanson', melody: 'melodie', melodie: 'melodie',
    picture: 'dessin', dessin: 'dessin', question: 'question',
    gift: 'cadeau', cadeau: 'cadeau', joint: 'ensemble', ensemble: 'ensemble',
    finale: 'cadeau', game: 'cadeau', quest: 'question',
  };
  return map[kind] || 'lettre';
}

/* ── 暴露给 HTML inline onclick ─────────────────────────────────── */
window.UI = {
  openEditor,
  openCollection,
  openPostOffice,
  openScrapbook,
  syncNow: syncRemote,
  showArchive,
  showPublish,
  showHelp,
};
window.Backend = Backend; // 供测试与排查使用（不含任何敏感信息）

/* ── 初始化 ───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  mountStage();
  Backend.init();
  const deskWrite = document.getElementById('deskWrite');
  const deskDiary = document.getElementById('deskDiary');
  const deskMail = document.getElementById('deskMail');
  const deskCollection = document.getElementById('deskCollection');
  const yanGiftPile = document.getElementById('yanGiftPile');
  const sanGiftPile = document.getElementById('sanGiftPile');
  const deskPhoto = document.getElementById('deskPhoto');
  const deskNote = document.getElementById('deskNote');
  const deskRecord = document.getElementById('deskRecord');
  if (deskWrite) deskWrite.onclick = () => UI.openEditor();
  if (deskDiary) deskDiary.onclick = () => openScrapbook();
  if (deskMail) deskMail.onclick = () => openPostOffice();
  if (deskCollection) deskCollection.onclick = () => openCollection();
  if (yanGiftPile) yanGiftPile.onclick = () => openCollection('yan');
  if (sanGiftPile) sanGiftPile.onclick = () => openCollection('san');
  if (deskPhoto) deskPhoto.onclick = () => openPhotoFrame();
  if (deskNote) deskNote.onclick = () => openTodayNote();
  if (deskRecord) deskRecord.onclick = () => openRecordPlayer();
  document.getElementById('deskRecordCard').onclick = () => openRecordPlayer();
  refreshWhoBtn();
  const whoBtn = document.getElementById('whoBtn');
  if (whoBtn) {
    whoBtn.onclick = () => {
      Backend.setWho(Backend.getWho() === 'yan' ? 'san' : 'yan');
      refreshWhoBtn();
      toast(Backend.getWho() === 'yan' ? '泡芙会把她提前开窗的事记在砚砚名下' : '泡芙会把你提前开窗的事记在三三名下');
    };
  }
  const writerBtn = document.getElementById('writerBtn');
  if (writerBtn) writerBtn.onclick = () => {
    const url = new URL(location.href);
    if (Backend.getWriter() === 'yan') url.searchParams.delete('writer'); else url.searchParams.set('writer', 'yan');
    location.assign(url);
  };
  // 显示模式：自动 → 白昼 → 夜间 → 自动 循环
  const displayBtn = document.getElementById('displayBtn');
  if (displayBtn) {
    displayBtn.onclick = () => {
      const order = ['auto', 'day', 'night'];
      const cur = Backend.getDisplay();
      const next = order[(order.indexOf(cur) + 1) % order.length];
      Backend.setDisplay(next);
      loadBoard();  // 重算 night 并刷新模式按钮
      toast(next === 'auto' ? '显示模式：自动（按北京时间）' : next === 'day' ? '显示模式：白昼' : '显示模式：夜间');
    };
  }

  // 流畅模式：降低非必要动效，保留全部美术资源
  const smoothBtn = document.getElementById('smoothBtn');
  if (smoothBtn) {
    smoothBtn.onclick = () => {
      const on = !Backend.getSmooth();
      Backend.setSmooth(on);
      loadBoard();
      toast(on ? '流畅模式已开启 · 减少动画与特效' : '流畅模式已关闭 · 恢复完整动效');
    };
  }

  await loadBoard();
  syncRemote();

  // 每分钟按北京时间 + 显示模式刷新夜间状态（不再用设备本地时区）
  setInterval(() => {
    if (!board) return;
    const night = isNight();
    document.getElementById('page').classList.toggle('dusk', night);
    houseCtrl?.configure({ night, smooth: Backend.getSmooth() });
  }, 60_000);
});
