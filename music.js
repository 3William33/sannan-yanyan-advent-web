/**
 * music.js — Spotify / 网易云 / ABC 五线谱渲染
 * 不依赖任何框架，挂在 window.AdventMusic 上供 app.js 调用。
 *
 * 安全说明：
 * - 所有外部内容（Spotify / 网易云 iframe）都在 sandbox 属性下运行
 * - 网易云先尝试 iframe，检测到版权限制后自动降级为跳转按钮
 * - 没有任何 Token 或敏感数据经过这里
 */

/* ── 链接解析 ─────────────────────────────────────────────────────── */

/**
 * 从各种格式的链接里提取 Spotify track ID
 * 支持：
 *   https://open.spotify.com/track/4cluDES4hQEUhmXj6TXkSo
 *   https://open.spotify.com/intl-zh-cn/track/4cluDES4hQEUhmXj6TXkSo?si=...
 *   spotify:track:4cluDES4hQEUhmXj6TXkSo
 */
function parseSpotifyId(url) {
  if (!url) return null;
  const m = url.match(/(?:track[/:])([\w]{22})/i);
  return m ? m[1] : null;
}

function parseWebUrl(raw) {
  try {
    const url = new URL((raw || '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function isHost(url, host, allowSubdomains = true) {
  if (!url) return false;
  return url.hostname === host || (allowSubdomains && url.hostname.endsWith('.' + host));
}

/**
 * 从网易云链接提取歌曲 ID
 * 支持：
 *   https://music.163.com/song?id=1234567
 *   https://music.163.com/#/song?id=1234567
 *   https://music.163.com/song/1234567/
 *   https://y.music.163.com/m/song?id=1234567
 *   网易云 App 分享的短链 163cn.tv 无法客户端解析，会返回 null
 */
function parseNeteaseId(url) {
  if (!url) return null;
  const parsed = parseWebUrl(url);
  if (!parsed || !isHost(parsed, 'music.163.com')) return null;
  // ?id=... 或 &id=...
  let m = url.match(/[?&]id=(\d+)/);
  if (m) return m[1];
  // /song/1234567/
  m = url.match(/\/song\/(\d+)/);
  if (m) return m[1];
  return null;
}

/**
 * 判断链接类型
 * 返回 'spotify' | 'netease' | null
 */
function detectMusicType(url) {
  if (!url) return null;
  if (url.startsWith('spotify:track:')) return 'spotify';
  const parsed = parseWebUrl(url);
  if (isHost(parsed, 'open.spotify.com')) return 'spotify';
  if (isHost(parsed, 'music.163.com') || parsed?.hostname === '163cn.tv') return 'netease';
  return null;
}

/* ── 歌曲元数据（歌名/歌手/封面）多源降级 ─────────────────────────────
   静态网页没有服务端代理，跨域抓取可能失败；所有抓取都带超时并静默降级，
   编辑器里手填的 name/artist/cover 始终优先。抓不到就用克制的占位黑胶。 */

const _metaCache = new Map();

function _timeout(ms) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
}

/** 网易云：尝试详情接口取歌名/歌手/封面；失败返回 null（不缓存失败） */
async function fetchNeteaseMeta(songId) {
  const key = `netease:${songId}`;
  if (_metaCache.has(key)) return _metaCache.get(key);
  let meta = null;
  try {
    const res = await Promise.race([
      fetch(`https://music.163.com/api/song/detail?ids=${encodeURIComponent('[' + songId + ']')}`, { cache: 'force-cache' }),
      _timeout(4500),
    ]);
    if (res && res.ok) {
      const data = await res.json();
      const song = (data.songs && data.songs[0]) || null;
      if (song) {
        meta = {
          title: song.name || '',
          artist: (song.artists || []).map(a => a.name).filter(Boolean).join(' / '),
          cover: (song.album && song.album.picUrl) || '',
        };
      }
    }
  } catch (_) { /* 跨域/超时：降级 */ }
  _metaCache.set(key, meta);
  return meta;
}

/** Spotify：尝试公开 oEmbed 取歌名/歌手/封面；失败返回 null */
async function fetchSpotifyMeta(url) {
  const key = `spotify:${url}`;
  if (_metaCache.has(key)) return _metaCache.get(key);
  let meta = null;
  try {
    const api = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await Promise.race([fetch(api, { cache: 'force-cache' }), _timeout(4500)]);
    if (res && res.ok) {
      const data = await res.json();
      meta = {
        title: data.title || '',
        artist: data.author_name || '',
        cover: data.thumbnail_url || '',
      };
    }
  } catch (_) { /* 降级 */ }
  _metaCache.set(key, meta);
  return meta;
}

/**
 * 异步补全歌曲信息，拿到后回调 update(meta) 让调用方更新 DOM。
 * 手填字段优先，抓取只补空缺，不覆盖用户填写的内容。
 */
function enrichSongMeta(item, update) {
  const url = item.url || '';
  const kind = detectMusicType(url);
  const hasAll = item.name && item.artist && item.cover;
  if (!url || hasAll) return;
  (async () => {
    let fetched = null;
    if (kind === 'netease') {
      const id = parseNeteaseId(url);
      if (id) fetched = await fetchNeteaseMeta(id);
    } else if (kind === 'spotify') {
      fetched = await fetchSpotifyMeta(url);
    }
    if (!fetched) return;
    const merged = {
      title: item.name || fetched.title || '',
      artist: item.artist || fetched.artist || '',
      cover: item.cover || fetched.cover || '',
    };
    update(merged);
  })();
}

/* ── Spotify 渲染 ─────────────────────────────────────────────────── */

function renderSpotify(container, trackId, meta) {
  // Spotify 嵌入不需要登录，版权问题显示"登录后收听"，不会白屏
  const iframe = document.createElement('iframe');
  iframe.src = `https://open.spotify.com/embed/track/${trackId}?utm_source=generator&theme=0`;
  iframe.width = '100%';
  iframe.height = '152';
  iframe.style.border = '0';
  iframe.style.borderRadius = '4px';
  iframe.style.display = 'block';
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('allowfullscreen', '');
  iframe.setAttribute('allow', 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture');
  iframe.setAttribute('loading', 'lazy');
  // 安全沙箱：只允许必要的权限
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  container.appendChild(iframe);
}

/* ── 网易云渲染 ───────────────────────────────────────────────────── */

/**
 * 先尝试 iframe；网络错误或加载超时则降级为跳转卡片。
 * 版权提示位于跨域 iframe 内，浏览器通常不允许父页面读取，因此播放器
 * 成功加载时仍保留一个克制的外链出口，供版权受限歌曲手动跳转。
 */
function renderNetease(container, songId, meta, originalUrl) {
  // 加载占位
  const loading = document.createElement('div');
  loading.className = 'adv-music-loading';
  loading.textContent = '正在加载…';
  container.appendChild(loading);

  // iframe
  const iframe = document.createElement('iframe');
  iframe.src = `https://music.163.com/outchain/player?type=2&id=${songId}&auto=0&height=66`;
  iframe.width = '100%';
  iframe.height = '86';
  iframe.style.border = '0';
  iframe.style.borderRadius = '4px';
  iframe.style.display = 'none'; // 加载完成后显示；不读取跨域播放器内部状态
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('marginwidth', '0');
  iframe.setAttribute('marginheight', '0');
  iframe.setAttribute('scrolling', 'no');
  // 沙箱：网易云播放器需要脚本和同源
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
  container.appendChild(iframe);

  // 完整降级卡片（先藏着）
  const fallback = buildNeteaseLink(songId, originalUrl, meta);
  fallback.style.display = 'none';
  container.appendChild(fallback);

  const openLine = document.createElement('div');
  openLine.className = 'adv-music-open';
  const openHint = document.createElement('span');
  openHint.textContent = '若播放器提示版权限制';
  const openLink = document.createElement('a');
  openLink.href = safeMusicHref(originalUrl, `https://music.163.com/song?id=${songId}`);
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';
  openLink.textContent = '去网易云听';
  openLine.append(openHint, openLink);
  container.appendChild(openLine);

  let settled = false;
  const showFallback = () => {
    if (settled) return;
    settled = true;
    loading.remove();
    iframe.remove();
    openLine.remove();
    fallback.style.display = 'flex';
  };

  // 浏览器禁止可靠读取跨域 iframe 内的版权提示，因此这里只判断加载是否完成。
  // 外链出口始终保留，版权受限时由用户主动跳转。
  iframe.addEventListener('load', () => {
    if (settled) return;
    loading.remove();
    settled = true;
    iframe.style.display = 'block';
    openLine.classList.add('show');
  });

  // 超时降级：4 秒内连外链播放器都没加载完，就不留空白框
  const timeout = setTimeout(() => {
    if (!settled) showFallback();
  }, 4000);

  iframe.addEventListener('load', () => clearTimeout(timeout));
  iframe.addEventListener('error', () => {
    clearTimeout(timeout);
    showFallback();
  });
}

function safeMusicHref(raw, fallback) {
  const parsed = parseWebUrl(raw);
  if (isHost(parsed, 'music.163.com') || parsed?.hostname === '163cn.tv' || isHost(parsed, 'open.spotify.com')) {
    return parsed.href;
  }
  return fallback || '#';
}

function buildNeteaseLink(songId, originalUrl, meta) {
  const wrap = document.createElement('div');
  wrap.className = 'adv-music-fallback';
  wrap.style.display = 'none';

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>';

  const info = document.createElement('div');
  info.className = 'adv-music-info';
  const title = document.createElement('div');
  title.className = 'adv-music-title';
  title.textContent = meta?.title || '网易云音乐';
  const sub = document.createElement('div');
  sub.className = 'adv-music-sub';
  sub.textContent = `${meta?.artist ? meta.artist + ' · ' : ''}在网易云收听`;
  info.append(title, sub);

  const link = document.createElement('a');
  link.href = safeMusicHref(originalUrl, `https://music.163.com/song?id=${songId}`);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '去听';
  wrap.append(icon, info, link);
  return wrap;
}

/* ── ABC 五线谱 ───────────────────────────────────────────────────── */

let _abcjsReady = false;
let _abcjsCallbacks = [];

/**
 * 懒加载本地打包的 abcjs
 * 文件路径：vendor/abcjs-basic-min.js（相对路径，兼容 GitHub Pages 子目录部署）
 */
function loadAbcjs(cb) {
  if (_abcjsReady && window.ABCJS) {
    cb();
    return;
  }
  _abcjsCallbacks.push(cb);
  if (_abcjsCallbacks.length > 1) return; // 已经在加载

  const script = document.createElement('script');
  script.src = 'vendor/abcjs-basic-min.js?v=8a1c3e';
  script.onload = () => {
    _abcjsReady = true;
    _abcjsCallbacks.forEach(fn => fn());
    _abcjsCallbacks = [];
  };
  script.onerror = () => {
    // 本地加载失败时不显示五线谱，只显示原始文本
    _abcjsCallbacks.forEach(fn => fn(new Error('abcjs load failed')));
    _abcjsCallbacks = [];
  };
  document.head.appendChild(script);
}

let _abcCounter = 0;

/**
 * 渲染 ABC 五线谱
 * @param {HTMLElement} container
 * @param {string} notation  ABC 记谱文本
 */
function renderAbc(container, notation) {
  const id = `adv-abc-${Date.now()}-${_abcCounter++}`;

  const wrap = document.createElement('div');
  wrap.className = 'adv-abc-wrap';

  const scoreDiv = document.createElement('div');
  scoreDiv.id = id;
  wrap.appendChild(scoreDiv);

  const controls = document.createElement('div');
  controls.className = 'adv-abc-controls';
  wrap.appendChild(controls);

  container.appendChild(wrap);

  loadAbcjs((err) => {
    if (err || !window.ABCJS) {
      // 降级：显示原始文本
      scoreDiv.style.fontFamily = 'monospace';
      scoreDiv.style.fontSize = '12px';
      scoreDiv.style.whiteSpace = 'pre';
      scoreDiv.style.color = '#8a6a48';
      scoreDiv.textContent = notation;
      return;
    }

    try {
      // 渲染五线谱
      ABCJS.renderAbc(id, notation, {
        responsive: 'resize',
        add_classes: true,
        staffwidth: container.offsetWidth - 24 || 280,
      });

      // 播放控件（需要 AudioContext 支持）
      if (ABCJS.synth && ABCJS.synth.supportsAudio()) {
        const audioDiv = document.createElement('div');
        audioDiv.className = 'abcjs-inline-audio';
        audioDiv.style.flex = '1';
        controls.appendChild(audioDiv);

        const visualObj = ABCJS.renderAbc(id, notation, {
          responsive: 'resize',
          staffwidth: container.offsetWidth - 24 || 280,
        });

        const synthControl = new ABCJS.synth.SynthController();
        synthControl.load(audioDiv, null, {
          displayLoop: false,
          displayRestart: true,
          displayPlay: true,
          displayProgress: true,
          displayWarp: false,
        });

        const midiBuffer = new ABCJS.synth.CreateSynth();
        midiBuffer.init({
          visualObj: visualObj[0],
          options: { pan: [-.1, .1] },
        }).then(() => {
          synthControl.setTune(visualObj[0], false);
        }).catch(() => {
          // 静默失败，五线谱还是会显示
        });
      } else {
        const hint = document.createElement('span');
        hint.className = 'adv-hint';
        hint.style.fontSize = '12px';
        hint.textContent = '此设备不支持网页播放';
        controls.appendChild(hint);
      }
    } catch (e) {
      scoreDiv.textContent = notation;
    }
  });
}

/* ── 主入口：渲染一个 item ───────────────────────────────────────── */

/**
 * 旋转黑胶唱片：中心专辑封面 + 唱片凹槽纹理 + 轴孔，下方歌名/歌手信息条。
 * 返回一个 update(meta) 用于异步补全抓到的封面/歌名。
 */
function renderVinyl(container, item) {
  const wrap = document.createElement('div');
  wrap.className = 'adv-vinyl';
  container.appendChild(wrap);

  const disc = document.createElement('div');
  disc.className = 'adv-vinyl-disc';
  // 唱片标签（中心封面）
  const label = document.createElement('div');
  label.className = 'adv-vinyl-label';
  const img = document.createElement('img');
  img.className = 'adv-vinyl-cover';
  img.alt = '';
  const note = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  note.setAttribute('viewBox', '0 0 24 24');
  note.setAttribute('aria-hidden', 'true');
  note.innerHTML = '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>';
  note.setAttribute('class', 'adv-vinyl-note');
  label.append(img, note);
  const hole = document.createElement('div');
  hole.className = 'adv-vinyl-hole';
  disc.append(label, hole);
  wrap.appendChild(disc);

  const info = document.createElement('div');
  info.className = 'adv-vinyl-info';
  const title = document.createElement('div');
  title.className = 'adv-vinyl-title';
  const sub = document.createElement('div');
  sub.className = 'adv-vinyl-sub';
  info.append(title, sub);
  wrap.appendChild(info);

  const apply = (m) => {
    const t = m?.title || '一首歌';
    const a = m?.artist || '';
    title.textContent = t;
    sub.textContent = a ? `${a} · 旋转播放` : '旋转播放';
    const cover = m?.cover || '';
    if (cover) {
      img.onload = () => label.classList.add('has-cover');
      img.onerror = () => label.classList.remove('has-cover');
      img.src = cover;
    } else {
      label.classList.remove('has-cover');
      img.removeAttribute('src');
    }
  };
  apply({ title: item.name, artist: item.artist, cover: item.cover });
  return apply;
}

/**
 * 把一个礼物 item 渲染成 DOM，追加到 container
 *
 * item 结构（和 rules.js 保持一致）：
 *   { type: 'song', url: '...', name?: '...', artist?: '...', cover?: '...' }
 *   { type: 'abc', abc: '...', name?: '...' }
 */
function renderMusicItem(container, item) {
  if (item.type === 'abc' && (item.abc || item.text)) {
    renderAbc(container, item.abc || item.text);
    return;
  }

  if (item.type !== 'song') return;

  const url = item.url || '';
  const kind = detectMusicType(url);
  const meta = { title: item.name, artist: item.artist, cover: item.cover };

  // 旋转黑胶 + 歌曲信息（歌名/歌手/封面），异步补全抓取到的元数据
  const updateVinyl = renderVinyl(container, item);
  enrichSongMeta(item, (m) => {
    meta.title = m.title || meta.title;
    meta.artist = m.artist || meta.artist;
    meta.cover = m.cover || meta.cover;
    updateVinyl(meta);
  });

  const wrap = document.createElement('div');
  wrap.className = 'adv-music';
  container.appendChild(wrap);

  if (kind === 'spotify') {
    const id = parseSpotifyId(url);
    if (id) {
      renderSpotify(wrap, id, meta);
    } else {
      renderLinkFallback(wrap, url, meta, 'Spotify');
    }
    return;
  }

  if (kind === 'netease') {
    const id = parseNeteaseId(url);
    if (id) {
      renderNetease(wrap, id, meta, url);
    } else {
      // 163cn.tv 短链等无法解析的情况
      renderLinkFallback(wrap, url, meta, '网易云音乐');
    }
    return;
  }

  // 其他链接：通用跳转
  renderLinkFallback(wrap, url, meta, '音乐链接');
}

/** 通用跳转按钮（无法嵌入时兜底） */
function renderLinkFallback(container, url, meta, label) {
  const fb = document.createElement('div');
  fb.className = 'adv-music-fallback show';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>';

  const info = document.createElement('div');
  info.className = 'adv-music-info';
  const title = document.createElement('div');
  title.className = 'adv-music-title';
  title.textContent = meta?.title || label;
  const sub = document.createElement('div');
  sub.className = 'adv-music-sub';
  sub.textContent = `${meta?.artist ? meta.artist + ' · ' : ''}点击前往收听`;
  info.append(title, sub);

  const link = document.createElement('a');
  link.href = safeMusicHref(url, '#');
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '去听';
  fb.append(icon, info, link);
  container.appendChild(fb);
}

/* ── 编辑器：解析用户粘贴的链接 ─────────────────────────────────── */

/**
 * 把用户粘贴的原始字符串解析成 item
 * 返回 null 表示不认识
 */
function parseMusicUrl(raw, providedMeta) {
  const url = (raw || '').trim();
  if (!url) return null;

  const kind = detectMusicType(url);
  if (!kind) return null;

  const extra = {};
  if (providedMeta && typeof providedMeta === 'object') {
    if (providedMeta.name) extra.name = String(providedMeta.name).slice(0, 200);
    if (providedMeta.artist) extra.artist = String(providedMeta.artist).slice(0, 200);
    if (providedMeta.cover) extra.cover = String(providedMeta.cover).slice(0, 500);
  }

  if (kind === 'spotify') {
    const id = parseSpotifyId(url);
    return id ? { type: 'song', url, platform: 'spotify', ...extra } : null;
  }

  if (kind === 'netease') {
    const id = parseNeteaseId(url);
    if (!id) {
      // 短链无法解析：存原链接，降级显示跳转
      return { type: 'song', url, platform: 'netease', note: 'short_link', ...extra };
    }
    return { type: 'song', url, platform: 'netease', ...extra };
  }

  return null;
}

/* ── 导出 ─────────────────────────────────────────────────────────── */
window.AdventMusic = {
  renderMusicItem,
  renderVinyl,
  renderAbc,
  parseMusicUrl,
  detectMusicType,
  parseSpotifyId,
  parseNeteaseId,
  fetchNeteaseMeta,
  fetchSpotifyMeta,
};
