/**
 * app.js — 砚砚 × 三三 · 双人降临历前端主逻辑
 *
 * 网页版说明（GitHub Pages 静态移植）：
 * - 原本由 Python 后端提供的接口（board/touch/seen/answer/hide/sync/publish/upload）
 *   全部由 backend.js 在浏览器端等价实现，本文件的 UI 逻辑保持原样
 * - GitHub PAT 只保存在当前标签页会话（sessionStorage），不进入任何日志或仓库
 * - data/ 状态保存在浏览器 localStorage，上传媒体暂存 IndexedDB
 */

/* 版本号与 index.html 保持一致：每次发布同步更新，强制移动 Safari 重新拉取（它缓存较强） */
import { mountHouse, iconSvg } from './house.js?v=705ecd1';
import { Backend } from './backend.js?v=705ecd1';

/* ── 常量 ─────────────────────────────────────────────────────────── */
const TZ = 'Asia/Shanghai';
const YEAR = 2026;

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

  const { today, night, display, smooth, peeks, peek_counts: peekCounts = {}, cells, sync } = board;

  // 顶栏：已开启数量严格以 opened_by 为准（与格子亮灯同源，杜绝「亮灯但计数0」）
  document.getElementById('topDay').textContent = today || '—';
  const opened = cells.filter(c => Object.values(c.opened_by || {}).length > 0).length;
  document.getElementById('topStars').textContent = `★ ${opened} · 三三 ${peekCounts.san || 0} / 砚砚 ${peekCounts.yan || 0}`;

  // 书桌默认态：不改变旧协议，只把已有看板信息投影成实体物件
  const deskDay = document.getElementById('deskDay');
  const deskDate = document.getElementById('deskDate');
  const deskCountdown = document.getElementById('deskCountdown');
  const deskMailStatus = document.getElementById('deskMailStatus');
  if (deskDay) deskDay.textContent = today || '—';
  if (deskDate) deskDate.textContent = today ? `12 月 ${today} 日 · 北京时间` : '十二月 · 北京时间';
  if (deskCountdown) deskCountdown.textContent = today ? (today >= 25 ? '圣诞快乐，今天也有信' : `距离圣诞还有 ${Math.max(0, 25 - today)} 天`) : '等候十二月的雪';
  if (deskMailStatus) {
    const incoming = cells.reduce((n, c) => n + (c.new_count || 0), 0);
    deskMailStatus.textContent = incoming ? `${incoming} 件新礼物 / 追加礼物` : `${opened} 扇窗已点亮`;
  }

  // 偷看提示
  const peekEl = document.getElementById('peekLine');
  peekEl.textContent = peeks > 0 ? `泡芙记下了 ${peeks} 次偷看：三三 ${peekCounts.san || 0}，砚砚 ${peekCounts.yan || 0}。` : '';

  // 显示模式（自动 / 白昼 / 夜间）与流畅模式：统一作用于页面与房子
  const page = document.getElementById('page');
  page.classList.toggle('dusk', night);
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
  const { rect, done } = await (houseCtrl?.play?.(day) ?? { rect: { left: 0, top: 0, width: 0, height: 0 }, done: null });
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

  /* 渲染砚砚的礼物 */
  const yanGift = gifts?.ai;
  if (yanGift) {
    const pic = document.createElement('div');
    pic.className = 'adv-pic';
    const iconKey = kindToIcon(yanGift.kind || yanGift.icon);
    pic.innerHTML = iconSvg(iconKey);
    frame.appendChild(pic); // body 稍后才 append，这里直接追加即可保持顺序

    for (const item of yanGift.items || []) {
      renderItem(body, item, day, 'ai', yanGift.answer, yanGift.id || `builtin-yan-${day}`);
    }

    if (yanGift.note) {
      const note = document.createElement('div');
      note.className = 'adv-note';
      note.textContent = yanGift.note;
      frame.appendChild(note);
    }
  }

  /* 砚砚的远程追加 */
  for (const entry of remoteExtras) {
    renderRemoteEntry(body, entry, '砚砚后来追加', day);
  }

  /* 三三本地礼物 */
  const sanEntries = gifts?.human_entries || (gifts?.human ? [gifts.human] : []);
  for (const sanGift of sanEntries) {
    renderHalf(body, sanGift, '三三放进来的');
  }

  /* 三三的远程礼物 */
  for (const entry of sannanExtras) {
    renderRemoteEntry(body, entry, '三三放进来的', day);
  }

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
  requestAnimationFrame(() => {
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
  host.className = 'adv-zoom';
  host.id = 'selfPreviewOverlay';
  host.style.zIndex = '1280';
  document.body.appendChild(host);

  const kind = items.some(i => i.type === 'song') ? 'chanson' : 'lettre';
  const gifts = {
    ai: {
      day, kind, items,
      note: '这是对方打开时会看到的样子（预览）',
      id: `preview-${day}`,
      answer: '',
    },
  };
  const rect = { left: innerWidth / 2 - 20, top: innerHeight / 2 - 20, width: 40, height: 40 };
  showGiftCard(day, gifts, [], [], rect, () => host.remove(), 'selfPreviewOverlay');

  // 在封面上标注「预览」，并区分这不是真正在开启的礼物
  requestAnimationFrame(() => {
    const front = host.querySelector('.adv-front .fhint');
    if (front) front.textContent = '对方视角预览 · 轻触翻开';
    const fd = host.querySelector('.adv-front .fby');
    if (fd) fd.textContent = 'aperçu · 仅你可见';
    const hint = host.querySelector('.adv-row .adv-hint');
    if (hint) hint.textContent = '仅为预览，未真正封好';
  });
}

/* ── 渲染单个 item ────────────────────────────────────────────────── */
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

function renderPhoto(container, photo, title) {
  const wrap = document.createElement('button');
  wrap.type = 'button'; wrap.className = 'adv-photo3d'; wrap.setAttribute('aria-label', '翻转照片');
  const front = document.createElement('span'); front.className = 'adv-photo-face adv-photo-front';
  const back = document.createElement('span'); back.className = 'adv-photo-face adv-photo-back';
  const img = document.createElement('img'); img.alt = title; img.loading = 'lazy';
  const url = photo?.front?.url || photo?.url;
  if (url) Backend.resolveMediaUrl(url).then(src => { if (src) img.src = src; });
  front.append(img, Object.assign(document.createElement('small'), { textContent: photo?.front?.title || title }));
  back.textContent = photo?.back?.text || '背面还没有留言';
  wrap.append(front, back); wrap.onclick = () => wrap.classList.toggle('flipped'); container.appendChild(wrap);
}

function renderComic(container, comic, title) {
  const pages = Array.isArray(comic?.pages) ? comic.pages : [];
  if (!pages.length) return;
  const reader = document.createElement('div'); reader.className = 'adv-comic-reader';
  const img = document.createElement('img'); img.alt = title; img.loading = 'lazy';
  const caption = document.createElement('span'); caption.className = 'adv-hint';
  let index = 0;
  const draw = () => { caption.textContent = `${title} · ${index + 1}/${pages.length}`; const u = pages[index]?.url; if (u) Backend.resolveMediaUrl(u).then(src => { if (src) img.src = src; }); };
  const prev = document.createElement('button'); prev.className = 'adv-btn'; prev.textContent = '‹';
  const next = document.createElement('button'); next.className = 'adv-btn'; next.textContent = '›';
  prev.onclick = () => { index = (index + pages.length - 1) % pages.length; draw(); };
  next.onclick = () => { index = (index + 1) % pages.length; draw(); };
  reader.append(img, caption, prev, next); container.appendChild(reader); draw();
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
  if (!entry) return;
  const source = Array.isArray(entry.items_v2) && entry.items_v2.length
    ? entry.items_v2
    : (Array.isArray(entry.items) && entry.items.length ? entry.items : legacyEntryItems(entry));
  const items = source.filter(item => item && ['text', 'question', 'song', 'abc', 'image', 'photo', 'comic', 'voice', 'audio', 'attachment'].includes(item.type));
  if (!items.length) return;
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
  container.appendChild(half);
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
  if (!gift) return;
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
  container.appendChild(half);
}

/* ── 编辑器（三三追加礼物） ─────────────────────────────────────── */
async function openEditor(defaultDay) {
  const overlay = document.getElementById('overlay');
  overlay.innerHTML = '';
  overlay.style.display = 'flex';
  overlay.classList.add('on');

  const sheet = document.createElement('div');
  sheet.className = 'adv-sheet adv-paper adv-face';
  sheet.setAttribute('role', 'dialog');

  const frame = document.createElement('div');
  frame.className = 'adv-frame';

  const editorTop = document.createElement('div');
  editorTop.className = 'adv-ctop adv-editor-head';
  editorTop.innerHTML = `<span class="d">藏一份礼物</span><span class="by">pour mon amour</span>`;
  frame.appendChild(editorTop);

  const editorIntro = document.createElement('p');
  editorIntro.className = 'adv-editor-intro';
  editorIntro.textContent = '把今天突然想说的话，悄悄封进十二月的一扇窗。';
  frame.appendChild(editorIntro);

  // 日期选择
  const dayLabel = document.createElement('span');
  dayLabel.className = 'adv-lab';
  dayLabel.innerHTML = 'le jour <i>放进哪天</i>';
  frame.appendChild(dayLabel);

  const dayIn = document.createElement('input');
  dayIn.className = 'adv-in1';
  dayIn.type = 'number';
  dayIn.min = 1;
  dayIn.max = 25;
  // 默认日期按北京时间：12 月取当日，否则取 1（与解锁规则同源）
  const bj = Backend.shanghaiNowIso();
  dayIn.value = defaultDay || (bj.slice(5, 7) === '12' ? parseInt(bj.slice(8, 10), 10) : 1);
  dayIn.style.marginBottom = '10px';
  frame.appendChild(dayIn);

  // 文字内容
  const textLabel = document.createElement('span');
  textLabel.className = 'adv-lab';
  textLabel.innerHTML = 'le cadeau <i>写给砚砚的话</i>';
  frame.appendChild(textLabel);

  const textArea = document.createElement('textarea');
  textArea.className = 'adv-ta';
  textArea.style.minHeight = '100px';
  textArea.placeholder = '文字内容（可选）';
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

  const urlPreviewBtn = document.createElement('button');
  urlPreviewBtn.textContent = '预览';
  urlPreviewBtn.onclick = () => {
    const parsed = window.AdventMusic?.parseMusicUrl(urlIn.value, {
      name: nameIn.value.trim(), artist: artistIn.value.trim(), cover: coverIn.value.trim(),
    });
    if (!parsed) { toast('链接格式不认识，支持 Spotify track 和网易云歌曲链接'); return; }
    urlPreview.innerHTML = '';
    urlPreview.style.display = 'block';
    window.AdventMusic?.renderMusicItem(urlPreview, parsed);
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

  const coverIn = document.createElement('input');
  coverIn.className = 'adv-in1';
  coverIn.type = 'url';
  coverIn.placeholder = '专辑封面图片链接（可选，留空自动抓）';
  coverIn.style.marginTop = '6px';
  frame.appendChild(coverIn);

  const urlPreview = document.createElement('div');
  urlPreview.className = 'adv-music-preview';
  urlPreview.style.display = 'none';
  frame.appendChild(urlPreview);

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

  let uploadedImageUrl = null;
  imgIn.onchange = async () => {
    const file = imgIn.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('图片不能超过 5MB'); imgIn.value = ''; return; }
    // 预览
    const preview = document.createElement('img');
    preview.className = 'adv-img-preview';
    preview.src = URL.createObjectURL(file);
    imgPreviewWrap.innerHTML = '';
    imgPreviewWrap.appendChild(preview);
    // 暂存到浏览器（发布时再转存到 GitHub 仓库）
    try {
      const res = await Backend.uploadFile(file);
      uploadedImageUrl = res.url;
    } catch (e) {
      toast('上传失败：' + e.message);
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
  let uploadedAttachment = null;
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
  let recUploadUrl = null;

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

  // 操作行
  const msgSpan = document.createElement('span');
  msgSpan.className = 'adv-hint';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'adv-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.onclick = closeOverlay;

  // 从当前编辑器内容构造 items，供「封好」与「预览对方视角」共用。
  function collectItems() {
    const items = [];
    const bodyText = textArea.value.trim();
    if (bodyText) items.push({ type: 'text', text: bodyText });

    const musicUrl = urlIn.value.trim();
    if (musicUrl) {
      const parsed = window.AdventMusic?.parseMusicUrl(musicUrl, {
        name: nameIn.value.trim(), artist: artistIn.value.trim(), cover: coverIn.value.trim(),
      });
      if (parsed) items.push(parsed);
      else return { error: '音乐链接格式不认识' };
    }

    if (uploadedImageUrl) items.push({ type: 'image', url: uploadedImageUrl });
    if (recUploadUrl) items.push({ type: 'voice', url: recUploadUrl });
    if (uploadedAttachment) items.push(uploadedAttachment);
    return { items };
  }

  // 预览：以对方打开礼物时看到的样子展示当前内容，不写入存档、不记录偷看。
  const previewBtn = document.createElement('button');
  previewBtn.className = 'adv-btn';
  previewBtn.textContent = '👁 预览对方视角';
  previewBtn.onclick = () => {
    const day = parseInt(dayIn.value);
    if (!day || day < 1 || day > 25) { msgSpan.textContent = '日期要在 1—25 之间'; return; }
    const { items, error } = collectItems();
    if (error) { msgSpan.textContent = error; return; }
    if (!items || !items.length) { msgSpan.textContent = '写点什么再预览~'; return; }
    showSelfPreview(day, items);
  };

  const saveBtn = document.createElement('button');
  saveBtn.className = 'adv-btn solid';
  saveBtn.textContent = '封好礼盒';
  saveBtn.onclick = async () => {
    const day = parseInt(dayIn.value);
    if (!day || day < 1 || day > 25) { msgSpan.textContent = '日期要在 1—25 之间'; return; }

    const { items, error } = collectItems();
    if (error) { msgSpan.textContent = error; return; }
    if (!items || !items.length) { msgSpan.textContent = '写点什么再封好~'; return; }

    saveBtn.disabled = true;
    try {
      Backend.hide(day, items, items.some(i => i.type === 'song') ? 'chanson' : 'lettre');
      board = Backend.getBoard();
      refresh();
      toast(`12月${day}日又多了一份礼物 ♥`);
      closeOverlay();
    } catch (e) {
      msgSpan.textContent = e.message;
      saveBtn.disabled = false;
    }
  };

  const row = document.createElement('div');
  row.className = 'adv-row';
  row.appendChild(msgSpan);
  row.appendChild(cancelBtn);
  row.appendChild(previewBtn);
  row.appendChild(saveBtn);
  frame.appendChild(row);

  sheet.appendChild(frame);
  overlay.appendChild(sheet);
  // 草稿只存在本地，按身份/日期隔离；不会进入 Backend.hide 或 GitHub 同步。
  const draftKey = `advent-v4-draft:${Backend.getWho()}:${dayIn.value || 'new'}`;
  const draftFields = [...sheet.querySelectorAll('input:not([type=file]), textarea')];
  try { const draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); if (draft?.values) draftFields.forEach((el, i) => { if (draft.values[i] !== undefined) el.value = draft.values[i]; }); } catch { /* ignore malformed local draft */ }
  const persistDraft = () => { try { localStorage.setItem(draftKey, JSON.stringify({ version:1, saved_at:Date.now(), values:draftFields.map(el => el.value) })); } catch { /* storage full */ } };
  draftFields.forEach(el => el.addEventListener('input', persistDraft));
  saveBtn.addEventListener('click', () => { try { localStorage.removeItem(draftKey); } catch {} }, { once:true });
  overlay.onclick = e => { if (e.target === overlay) closeOverlay(); };

  function closeOverlay() {
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
  frame.innerHTML = `
    <div class="adv-ctop"><span class="d">发布</span><span class="by">加密推送到 GitHub</span></div>
    <p class="adv-body" style="margin-top:12px;font-size:13.5px;line-height:1.9">
      把你写好的礼物加密后推送到 GitHub，砚砚同步后就能看到。<br>
      Token 只保存在当前浏览器标签页里（关闭标签页即清除），<br>
      不写入本页源码、仓库、链接或日志，只用于写入礼物数据仓库。
    </p>
  `;

  // Token 输入（当前标签页会话内有效；关闭标签页自动清除）
  const tokenLabel = document.createElement('span');
  tokenLabel.className = 'adv-lab';
  tokenLabel.style.marginTop = '10px';
  tokenLabel.innerHTML = alreadyPat
    ? 'GitHub Token <i>本标签页已提供，如需更换请在下方粘贴新 Token</i>'
    : 'GitHub Token <i>Fine-grained PAT，仅限礼物数据仓库的 Contents 读写</i>';
  frame.appendChild(tokenLabel);

  const tokenIn = document.createElement('input');
  tokenIn.className = 'adv-in1';
  tokenIn.type = 'password';
  tokenIn.placeholder = 'github_pat_…' + (alreadyPat ? '（留空则使用本次会话已提供的 Token）' : '');
  tokenIn.autocomplete = 'off';
  frame.appendChild(tokenIn);

  const msgSpan = document.createElement('div');
  msgSpan.className = 'adv-status';
  frame.appendChild(msgSpan);

  const row = document.createElement('div');
  row.className = 'adv-row';
  row.style.marginTop = '12px';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'adv-btn';
  cancelBtn.textContent = '取消';
  cancelBtn.onclick = closeOverlay;

  const pubBtn = document.createElement('button');
  pubBtn.className = 'adv-btn solid';
  pubBtn.textContent = '发布';
  pubBtn.onclick = async () => {
    const tokenValue = tokenIn.value.trim();
    if (tokenValue) {
      try { Backend.setPat(tokenValue); }
      catch (e) { msgSpan.textContent = e.message; return; }
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
      msgSpan.innerHTML = `<b>已发布</b> · ${r.message}`;
      setTimeout(closeOverlay, 2200);
    } catch (e) {
      msgSpan.innerHTML = `<b style="color:#8d2f2f">失败</b> · ${e.message}`;
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
  const deskRecord = document.getElementById('deskRecord');
  if (deskWrite) deskWrite.onclick = () => UI.openEditor();
  if (deskDiary) deskDiary.onclick = () => UI.openEditor();
  if (deskMail) deskMail.onclick = () => UI.showArchive();
  if (deskRecord) deskRecord.onclick = () => {
    const audio = document.querySelector('audio');
    if (audio) audio.paused ? audio.play().catch(() => toast('请再次点击唱片机开始播放')) : audio.pause();
    else toast('唱片机已准备好：打开一份音乐礼物后可继续播放');
  };
  refreshWhoBtn();
  const whoBtn = document.getElementById('whoBtn');
  if (whoBtn) {
    whoBtn.onclick = () => {
      Backend.setWho(Backend.getWho() === 'yan' ? 'san' : 'yan');
      refreshWhoBtn();
      toast(Backend.getWho() === 'yan' ? '泡芙会把她提前开窗的事记在砚砚名下' : '泡芙会把你提前开窗的事记在三三名下');
    };
  }
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
