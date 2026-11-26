/**
 * stickers.js — 圣诞贴纸素材库选择器（v7）
 *
 * 设计目标：
 * - 复用现有手账编辑器（app.js openScrapbook），不另起炉灶。
 * - 索引来自数据仓库 assets/stickers/sticker_index.json，仅元数据。
 * - 图案为单位展示，八色按需加载，避免一次性拉取全部 328 张原图。
 * - 触摸优先、分类浏览、搜索、配色筛选、最近/收藏、同图案快速切色。
 * - 只使用 raw.githubusercontent.com 白名单 URL，绝不加载第三方图片。
 */
import { CONFIG } from './config.js?v=8a1c3e';

const INDEX_PATH = 'assets/stickers/sticker_index.json';
const LS_FAV = 'advent-sticker-favs';
const LS_RECENT = 'advent-sticker-recent';

let indexPromise = null;          // 单次装载缓存，避免重复请求
let indexCache = null;

/** 读取索引（带缓存；失败不自动重试，交给调用方按需重试） */
export function loadStickerIndex() {
  if (indexCache) return Promise.resolve(indexCache);
  if (indexPromise) return indexPromise;
  const params = new URLSearchParams(location.search);
  const base = params.get('data') || CONFIG.dataBase();
  indexPromise = fetch(`${base}/${INDEX_PATH}?t=${Date.now()}`, { cache: 'no-store' })
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(data => {
      if (!data || !Array.isArray(data.stickers)) throw new Error('索引格式不正确');
      // 安全：只信任数据仓库 raw 前缀下的图片 URL，拒绝任何第三方地址
      const prefix = `https://raw.githubusercontent.com/${CONFIG.OWNER}/${CONFIG.DATA_REPO}/${CONFIG.BRANCH}/assets/stickers/`;
      data.stickers = data.stickers.filter(s => {
        try { const u = new URL(s.raw_url); return u.protocol === 'https:' && String(s.raw_url).startsWith(prefix) && !String(s.path).includes('..'); }
        catch { return false; }
      });
      indexCache = data;
      return data;
    })
    .catch(err => { indexPromise = null; throw err; }); // 允许手动重试，避免无限循环
  return indexPromise;
}

function readIds(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.slice(0, 60) : []; }
  catch { return []; }
}
function writeIds(key, ids) { try { localStorage.setItem(key, JSON.stringify(ids.slice(0, 60))); } catch {} }
export function getFavorites() { return readIds(LS_FAV); }
export function getRecent() { return readIds(LS_RECENT); }
export function toggleFavorite(id) {
  const ids = readIds(LS_FAV); const i = ids.indexOf(id);
  if (i >= 0) ids.splice(i, 1); else ids.unshift(id);
  writeIds(LS_FAV, ids); return ids.includes(id);
}
function pushRecent(id) { const ids = readIds(LS_RECENT).filter(x => x !== id); ids.unshift(id); writeIds(LS_RECENT, ids); }

/**
 * 在 host 内挂载贴纸库。
 * options:
 *   onPick(sticker)    —— 点击贴纸：添加到手账
 *   onReplace(sticker) —— 替换模式：替换当前选中贴纸
 *   hasSelection()     —— 当前是否有选中贴纸（决定是否显示“替换”提示）
 * 返回 { destroy, refresh }
 */
export function mountStickerLibrary(host, options = {}) {
  const { onPick = () => {}, onReplace = () => {}, hasSelection = () => false } = options;
  let index = null;
  let state = { category: 'all', color: 'all', query: '', subcategory: 'all', favoritesOnly: false, recentOnly: false };
  let replaceMode = false;
  let searchTimer = null;
  const byId = new Map();
  const byPattern = new Map();

  host.classList.add('adv-stklib');
  host.innerHTML = '<div class="adv-stklib-loading">正在翻开贴纸收纳册…</div>';

  function indexData() {
    byId.clear(); byPattern.clear();
    for (const s of index.stickers) {
      byId.set(s.id, s);
      if (!byPattern.has(s.pattern_id)) byPattern.set(s.pattern_id, []);
      byPattern.get(s.pattern_id).push(s);
    }
  }

  function buildShell() {
    const cats = [{ key: 'all', zh: '全部' }, ...Object.entries(index.categories || {}).map(([key, v]) => ({ key, zh: v.name_zh || key }))];
    host.innerHTML = `
      <div class="adv-stklib-head">
        <div class="adv-stklib-tabs" role="tablist">
          ${cats.map(c => `<button type="button" role="tab" class="adv-stklib-tab${c.key === 'all' ? ' on' : ''}" data-cat="${c.key}">${c.zh}</button>`).join('')}
        </div>
        <div class="adv-stklib-filters">
          <input class="adv-stklib-search" type="search" placeholder="搜名称 / 标签，如 雪人、邮戳、peacock" aria-label="搜索贴纸">
          <select class="adv-stklib-color" aria-label="配色筛选">
            <option value="all">全部配色</option>
            ${Object.entries(index.palettes || {}).filter(([k]) => k !== 'original').map(([k, v]) => `<option value="${k}">${v.name_zh} ${v.hex || ''}</option>`).join('')}
          </select>
          <button type="button" class="adv-stklib-mode" data-mode="fav" aria-pressed="false">♡ 收藏</button>
          <button type="button" class="adv-stklib-mode" data-mode="recent" aria-pressed="false">◷ 最近</button>
          <button type="button" class="adv-stklib-replace" aria-pressed="false">↺ 替换选中</button>
        </div>
        <div class="adv-stklib-subs"></div>
        <div class="adv-stklib-count" aria-live="polite"></div>
      </div>
      <div class="adv-stklib-grid" role="list"></div>
      <div class="adv-stklib-empty" hidden>没有符合条件的贴纸，换个词或分类试试。</div>`;

    host.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
      state.category = b.dataset.cat; state.subcategory = 'all';
      host.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('on', x === b));
      renderSubs(); renderGrid();
    });
    const search = host.querySelector('.adv-stklib-search');
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.query = search.value.trim().toLowerCase(); renderGrid(); }, 140);
    });
    host.querySelector('.adv-stklib-color').onchange = e => { state.color = e.target.value; renderGrid(); };
    host.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
      const key = b.dataset.mode;
      if (key === 'fav') state.favoritesOnly = !state.favoritesOnly;
      else state.recentOnly = !state.recentOnly;
      b.setAttribute('aria-pressed', String(key === 'fav' ? state.favoritesOnly : state.recentOnly));
      b.classList.toggle('on', key === 'fav' ? state.favoritesOnly : state.recentOnly);
      renderGrid();
    });
    const replaceBtn = host.querySelector('.adv-stklib-replace');
    replaceBtn.onclick = () => {
      replaceMode = !replaceMode;
      replaceBtn.setAttribute('aria-pressed', String(replaceMode));
      replaceBtn.classList.toggle('on', replaceMode);
      host.classList.toggle('adv-stklib-replacing', replaceMode);
    };
    renderSubs();
  }

  function renderSubs() {
    const box = host.querySelector('.adv-stklib-subs');
    if (!box) return;
    const subs = new Set();
    for (const s of index.stickers) {
      if (state.category !== 'all' && s.category !== state.category) continue;
      subs.add(s.subcategory);
    }
    box.innerHTML = [...subs].map(s => `<button type="button" class="adv-stklib-sub${s === state.subcategory ? ' on' : ''}" data-sub="${s}">${s}</button>`).join('');
    box.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => {
      state.subcategory = state.subcategory === b.dataset.sub ? 'all' : b.dataset.sub;
      renderSubs(); renderGrid();
    });
  }

  // 每张图案卡默认只加载一张代表色，其余配色切换时按需加载
  function defaultVariant(list) {
    const wanted = state.color !== 'all' ? list.find(s => s.color === state.color) : null;
    return wanted || list.find(s => s.color === 'ink') || list[0];
  }

  function matches(s) {
    if (state.category !== 'all' && s.category !== state.category) return false;
    if (state.subcategory !== 'all' && s.subcategory !== state.subcategory) return false;
    if (state.color !== 'all' && s.color !== state.color) return false;
    if (state.favoritesOnly && !getFavorites().includes(s.id)) return false;
    if (state.recentOnly && !getRecent().includes(s.id)) return false;
    if (state.query) {
      const q = state.query;
      const text = (s.search_text || [s.name_zh, s.name_en, s.description, s.subcategory].join(' ')).toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  }

  function cardHtml(patId, list) {
    const rep = defaultVariant(list);
    const colorKeys = list.map(s => s.color).filter(c => c !== 'original');
    const fav = list.some(s => getFavorites().includes(s.id));
    const dots = colorKeys.length ? `<div class="adv-stklib-dots">${list.map(s => {
      const hex = s.color_hex || '#888'; const on = s.id === rep.id;
      return `<button type="button" class="adv-stklib-dot${on ? ' on' : ''}" data-id="${s.id}" title="${s.color_name_zh}" style="--dot:${hex}" aria-label="切换到${s.color_name_zh}"></button>`;
    }).join('')}</div>` : '';
    return `<div class="adv-stklib-card" role="listitem" data-pattern="${patId}">
      <button type="button" class="adv-stklib-fav${fav ? ' on' : ''}" data-fav="${rep.id}" aria-label="收藏">${fav ? '♥' : '♡'}</button>
      <button type="button" class="adv-stklib-thumb" data-pick="${rep.id}" aria-label="添加 ${rep.name_zh}">
        <img loading="lazy" decoding="async" src="${rep.raw_url}" alt="${rep.name_zh}" width="${rep.width}" height="${rep.height}">
      </button>
      <div class="adv-stklib-name" title="${rep.description}">${rep.pattern_name_zh || rep.name_zh}</div>
      ${dots}
    </div>`;
  }

  function renderGrid() {
    const grid = host.querySelector('.adv-stklib-grid');
    const empty = host.querySelector('.adv-stklib-empty');
    const count = host.querySelector('.adv-stklib-count');
    if (!grid) return;
    // 收藏/最近为贴纸级筛选：先筛单张，再按图案聚合
    const patternMap = new Map();
    for (const s of index.stickers) {
      if (!matches(s)) continue;
      if (!patternMap.has(s.pattern_id)) patternMap.set(s.pattern_id, []);
      patternMap.get(s.pattern_id).push(s);
    }
    const tmp = document.createElement('div');
    let cards = '', n = 0;
    for (const [patId, list] of patternMap) { cards += cardHtml(patId, list); n++; }
    tmp.innerHTML = cards;
    grid.replaceChildren(...tmp.childNodes);
    if (count) count.textContent = `${n} 种图案 · ${[...patternMap.values()].reduce((a, l) => a + l.length, 0)} 枚贴纸`;
    if (empty) empty.hidden = n !== 0;

    grid.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => {
      const s = byId.get(b.dataset.pick); if (!s) return;
      pushRecent(s.id);
      if (replaceMode) { if (!hasSelection()) return false; onReplace(s); }
      else onPick(s);
    });
    grid.querySelectorAll('[data-id]').forEach(b => b.onclick = () => {
      // 同图案切色：只更新该卡的代表图与圆点，不整页重绘
      const s = byId.get(b.dataset.id); if (!s) return;
      const card = b.closest('.adv-stklib-card');
      const img = card.querySelector('img');
      if (img) { img.src = s.raw_url; img.alt = s.name_zh; }
      card.querySelectorAll('[data-id]').forEach(x => x.classList.toggle('on', x === b));
      card.querySelector('[data-pick]').dataset.pick = s.id;
      card.querySelector('.adv-stklib-fav').dataset.fav = s.id;
      const fav = getFavorites().includes(s.id);
      card.querySelector('.adv-stklib-fav').classList.toggle('on', fav);
      card.querySelector('.adv-stklib-fav').textContent = fav ? '♥' : '♡';
    });
    grid.querySelectorAll('[data-fav]').forEach(b => b.onclick = () => {
      const on = toggleFavorite(b.dataset.fav);
      b.classList.toggle('on', on); b.textContent = on ? '♥' : '♡';
      if (state.favoritesOnly) renderGrid();
    });
  }

  function load() {
    return loadStickerIndex().then(data => {
      index = data; indexData(); buildShell(); renderGrid();
    }).catch(err => {
      host.innerHTML = `<div class="adv-stklib-error">贴纸收纳册暂时打不开（${err.message}）。<button type="button" class="adv-btn" id="stklibRetry">再试一次</button></div>`;
      host.querySelector('#stklibRetry').onclick = () => { indexPromise = null; host.innerHTML = '<div class="adv-stklib-loading">正在翻开贴纸收纳册…</div>'; load(); };
    });
  }
  load();

  return {
    destroy() { clearTimeout(searchTimer); },
    refresh() { if (index) renderGrid(); },
  };
}
