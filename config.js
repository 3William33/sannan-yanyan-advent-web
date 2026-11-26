/**
 * config.js — 网页版全局配置
 *
 * 说明：
 * - 原版把 XOR 混淆密钥放在 Python 服务端；网页版没有服务端，因此这里只放
 *   密钥 SHA-256 摘要（混淆所需的全部材料），密钥明文本身不出现在前端。
 * - 混淆（XOR + Base64）与原版一样，只用于防止在公开仓库里直接看到礼物正文，
 *   不是真正的加密。
 * - ?data= 与 ?ghapi= 仅用于本地/自动化测试时指向虚构数据，不影响解锁规则。
 */

const OWNER = '3William33';
const DATA_REPO = 'sannan-yanyan-advent-2026';
const BRANCH = 'main';

const PARAMS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

export const CONFIG = {
  TZ: 'Asia/Shanghai',
  YEAR: 2026,
  BIRTHDAY: { month: 12, day: 25, label: '生日' },

  OWNER,
  DATA_REPO,
  BRANCH,

  /* XOR 混淆密钥的 SHA-256 摘要（hex）。与 advent-gifts-v3.2 协议一致。 */
  YAN_DIGEST_HEX: 'b52854d482f1040024bf2db8734b74ac60bb43bcb26c37170986ec673214757f',
  SAN_DIGEST_HEX: 'eb135c1744d756e7bca04f630db146419c5fd039b4f9ec76c54dffcabceaa771',

  /* 远程 JSON 数据基础地址（raw.githubusercontent.com 支持跨域读取） */
  dataBase() {
    return PARAMS.get('data') || `https://raw.githubusercontent.com/${OWNER}/${DATA_REPO}/${BRANCH}`;
  },

  /* GitHub Contents API 基础地址（发布用） */
  ghApiBase() {
    return PARAMS.get('ghapi') || `https://api.github.com/repos/${OWNER}/${DATA_REPO}/contents/`;
  },

  /* 发布后的资源链接前缀（接收端白名单） */
  rawAssetPrefix: `https://raw.githubusercontent.com/${OWNER}/${DATA_REPO}/${BRANCH}/assets/`,
};

export const UPLOAD_MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'application/pdf': '.pdf',
  'audio/midi': '.mid',
  'audio/x-midi': '.mid',
  'application/vnd.recordare.musicxml+xml': '.musicxml',
  'application/xml': '.musicxml',
};

export const REMOTE_MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.webm', '.m4a', '.mp4', '.mp3', '.ogg', '.wav',
  '.pdf', '.mid', '.midi', '.musicxml',
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
