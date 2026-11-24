// 随便看看：直接读群晖里的本地视频（DSM File Station 接口），不经过 Emby。
// 登录 → 列文件夹 → 拼播放地址交给 MPV。播放地址里带会话 id（sid），长时间播放时定期保活，过期自动重新登录。
import { useEffect, useState } from 'react';
import { httpFetch } from '../emby/http';

export interface DsmConfig { server: string; user: string; pass: string; folder: string }
const KEY = 'wemby-local';
const EMPTY: DsmConfig = { server: '', user: '', pass: '', folder: '' };

/** 补全协议；没写端口时 http 默认 5000、https 默认 5001 */
export function normalizeDsmServer(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, '');
  const hasPort = /^https?:\/\/[^/?#]*:\d+(?:[/?#]|$)/i.test(s);
  if (!hasPort) {
    try { const u = new URL(s); u.port = /^https:/i.test(s) ? '5001' : '5000'; s = u.toString().replace(/\/+$/, ''); } catch { /* ignore */ }
  }
  return s;
}

const coverCache = new Map<string, Promise<string>>();

export function loadDsm(): DsmConfig {
  try { return { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<DsmConfig>) }; } catch { return { ...EMPTY }; }
}
export function saveDsm(c: DsmConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify({ server: normalizeDsmServer(c.server), user: c.user.trim(), pass: c.pass, folder: c.folder.trim() })); } catch { /* ignore */ }
  sid = '';
  coverCache.clear();
  window.dispatchEvent(new Event('wemby-local-changed'));
}
export function clearDsm(): void { saveDsm({ ...EMPTY }); }
export const dsmConfigured = (): boolean => { const c = loadDsm(); return !!(c.server && c.user && c.pass && c.folder); };
export function useDsmKey(): string {
  const key = (): string => { const c = loadDsm(); return JSON.stringify([c.server, c.user, c.folder]); };
  const [k, setK] = useState(key);
  useEffect(() => {
    const f = (): void => setK(key());
    window.addEventListener('wemby-local-changed', f);
    return () => window.removeEventListener('wemby-local-changed', f);
  }, []);
  return k;
}

// ───────── 会话 ─────────
let sid = '';
let loginP: Promise<string> | null = null;

interface DsmResp<T> { success: boolean; data?: T; error?: { code: number } }
const SESSION_ERR = new Set([105, 106, 107, 119]);

const ERR_TEXT: Record<number, string> = {
  400: '账号或密码不对', 401: '账号已停用', 402: '这个账号没有权限（要给它 File Station 的访问权限）', 403: '这个账号开了两步验证，请换一个没开两步验证的专用账号',
  404: '登录验证失败', 407: '登录失败次数太多，IP 被群晖暂时封了，请稍后再试',
};

async function rawLogin(cfg: DsmConfig): Promise<string> {
  const body = new URLSearchParams({ api: 'SYNO.API.Auth', version: '6', method: 'login', account: cfg.user, passwd: cfg.pass, session: 'FileStation', format: 'sid' });
  let res: Response;
  try {
    res = await httpFetch(`${cfg.server}/webapi/auth.cgi`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  } catch (e) {
    throw new Error(`连不上群晖（${cfg.server}）：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new Error(`群晖返回 HTTP ${res.status}（地址或端口不对？）`);
  let j: DsmResp<{ sid?: string }>;
  try { j = (await res.json()) as DsmResp<{ sid?: string }>; } catch { throw new Error('这个地址不是群晖的 DSM（返回的不是 JSON）'); }
  if (!j.success || !j.data?.sid) throw new Error(ERR_TEXT[j.error?.code ?? 0] || `登录失败（错误码 ${j.error?.code ?? '未知'}）`);
  return j.data.sid;
}

/** 取当前会话 id；没有就登录。force=true 强制重新登录 */
export function dsmSid(force = false): Promise<string> {
  if (!force && sid) return Promise.resolve(sid);
  if (!loginP) {
    loginP = rawLogin(loadDsm()).then((s) => { sid = s; return s; }).finally(() => { loginP = null; });
  }
  return loginP;
}

/** 用给定配置试登录（设置页的「连接」按钮用），不保存 */
export async function dsmTest(cfg: DsmConfig): Promise<void> {
  const c = { ...cfg, server: normalizeDsmServer(cfg.server), user: cfg.user.trim() };
  await rawLogin(c);
}

async function call<T>(params: Record<string, string>, cfg?: DsmConfig, retried = false): Promise<T> {
  const c = cfg ?? loadDsm();
  const s = await dsmSid(retried);
  const q = new URLSearchParams({ ...params, _sid: s });
  let res: Response;
  try { res = await httpFetch(`${c.server}/webapi/entry.cgi?${q.toString()}`); } catch (e) { throw new Error(`连不上群晖：${e instanceof Error ? e.message : String(e)}`); }
  if (!res.ok) throw new Error(`群晖返回 HTTP ${res.status}`);
  const j = (await res.json()) as DsmResp<T>;
  if (j.success && j.data !== undefined) return j.data;
  if (!retried && SESSION_ERR.has(j.error?.code ?? 0)) return call<T>(params, cfg, true);
  const code = j.error?.code ?? 0;
  throw new Error(code === 408 ? '找不到这个文件夹' : code === 105 ? '没有权限访问' : `群晖接口出错（错误码 ${code}）`);
}

// ───────── 文件夹 / 文件 ─────────
export interface DsmEntry { name: string; path: string; isdir: boolean; size: number; mtime: number }
interface RawFile { name: string; path: string; isdir: boolean; additional?: { size?: number; time?: { mtime?: number } } }
const toEntry = (f: RawFile): DsmEntry => ({ name: f.name, path: f.path, isdir: !!f.isdir, size: f.additional?.size ?? 0, mtime: f.additional?.time?.mtime ?? 0 });

/** 所有共享文件夹（选文件夹时的第一层） */
export async function dsmShares(): Promise<DsmEntry[]> {
  const d = await call<{ shares: RawFile[] }>({ api: 'SYNO.FileStation.List', version: '2', method: 'list_share', additional: '["size","time"]', limit: '200' });
  return (d.shares || []).map(toEntry);
}

/** 列一个文件夹里的内容（文件夹在前，其余按名称） */
export async function dsmList(path: string): Promise<DsmEntry[]> {
  const d = await call<{ files: RawFile[] }>({ api: 'SYNO.FileStation.List', version: '2', method: 'list', folder_path: path, additional: '["size","time"]', sort_by: 'name', sort_direction: 'asc', limit: '1000' });
  return (d.files || []).map(toEntry);
}

/** 测试用：用给定配置先登录，再列共享文件夹 / 子文件夹（设置页选文件夹用，此时配置还没保存） */
export async function dsmBrowse(cfg: DsmConfig, path: string): Promise<DsmEntry[]> {
  const c = { ...cfg, server: normalizeDsmServer(cfg.server), user: cfg.user.trim() };
  sid = '';
  const prev = localStorage.getItem(KEY);
  try {
    localStorage.setItem(KEY, JSON.stringify(c)); // call() 从配置里读服务器地址
    if (!path) return await dsmShares();
    return await dsmList(path);
  } finally {
    if (prev === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, prev);
    sid = ''; // 测试用的会话不留给正式使用
  }
}

const VIDEO_EXT = /\.(mp4|mkv|avi|mov|m4v|ts|webm|wmv|flv|mpg|mpeg|rmvb|rm|3gp|m2ts|iso|mp3|flac|m4a|aac|wav|ogg|opus)$/i;
export const isMedia = (name: string): boolean => VIDEO_EXT.test(name);

/** 播放地址：带当前会话 id，MPV 直接拉流（支持拖动进度） */
export async function dsmPlayUrl(path: string, forceLogin = false): Promise<string> {
  const c = loadDsm();
  const s = await dsmSid(forceLogin);
  const q = new URLSearchParams({ api: 'SYNO.FileStation.Download', version: '2', method: 'download', path: JSON.stringify([path]), mode: 'open', _sid: s });
  return `${c.server}/webapi/entry.cgi?${q.toString()}`;
}

/** 保活：长时间播放时定期调用，避免会话因闲置过期 */
export async function dsmKeepAlive(): Promise<void> {
  try { await call<unknown>({ api: 'SYNO.FileStation.List', version: '2', method: 'list_share', limit: '1' }); } catch { /* 下次播放会重新登录 */ }
}

// ───────── 随便看看的视频清单 ─────────
export interface LocalVideo { path: string; name: string; title: string; size: number; mtime: number; list: string }
export interface LocalLibrary { lists: { name: string; path: string; items: LocalVideo[] }[]; all: LocalVideo[] }

const titleOf = (n: string): string => n.replace(/\.[^.]+$/, '');

let cache: { at: number; key: string; lib: LocalLibrary } | null = null;

/** 根文件夹下的子文件夹 = 播放列表；根目录里直接放的视频归到「未分组」。结果缓存 60 秒 */
export async function loadLibrary(force = false): Promise<LocalLibrary> {
  const c = loadDsm();
  const key = `${c.server}|${c.user}|${c.folder}`;
  if (!force && cache && cache.key === key && Date.now() - cache.at < 60000) return cache.lib;
  const root = await dsmList(c.folder);
  const mk = (e: DsmEntry, list: string): LocalVideo => ({ path: e.path, name: e.name, title: titleOf(e.name), size: e.size, mtime: e.mtime, list });
  const lists: LocalLibrary['lists'] = [];
  const loose = root.filter((e) => !e.isdir && isMedia(e.name)).map((e) => mk(e, '未分组'));
  const dirs = root.filter((e) => e.isdir).slice(0, 60);
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < dirs.length) {
      const d = dirs[i++];
      try {
        const fs = (await dsmList(d.path)).filter((e) => !e.isdir && isMedia(e.name)).map((e) => mk(e, d.name));
        if (fs.length) lists.push({ name: d.name, path: d.path, items: fs });
      } catch { /* 这个文件夹读不了就跳过 */ }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  lists.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  if (loose.length) lists.push({ name: '未分组', path: c.folder, items: loose });
  const lib: LocalLibrary = { lists, all: lists.flatMap((l) => l.items) };
  cache = { at: Date.now(), key, lib };
  return lib;
}

// ───────── 播放进度（本机记忆） ─────────
const POS_KEY = 'wemby-local-pos';
export interface LocalPos { t: number; d: number; at: number }
export function readPos(): Record<string, LocalPos> {
  try { return JSON.parse(localStorage.getItem(POS_KEY) || '{}') as Record<string, LocalPos>; } catch { return {}; }
}
export function writePos(path: string, t: number, d: number): void {
  try {
    const m = readPos();
    if (d > 0 && t > d - 20) delete m[path]; else m[path] = { t, d, at: Date.now() };
    const keys = Object.keys(m);
    if (keys.length > 300) keys.sort((a, b) => m[a].at - m[b].at).slice(0, keys.length - 300).forEach((k) => delete m[k]);
    localStorage.setItem(POS_KEY, JSON.stringify(m));
  } catch { /* ignore */ }
}

// ───────── 小工具 ─────────
export function fmtSize(n: number): string {
  if (!n) return '';
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / 1048576))} MB`;
}
export function fmtClock(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
/** 稳定的渐变封面：同一个名字永远同一个颜色 */
export function coverStyle(name: string): { background: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const a = h % 360, b = (a + 40 + (h >> 8) % 50) % 360;
  return { background: `linear-gradient(150deg, hsl(${a} 38% 26%), hsl(${b} 45% 12%))` };
}

// ───────── 播放队列（页面之间传递） ─────────
let queue: { items: LocalVideo[]; index: number; title: string } | null = null;
export function setPlayQueue(items: LocalVideo[], index: number, title: string): void { queue = { items, index, title }; }
export function takePlayQueue(): { items: LocalVideo[]; index: number; title: string } | null { return queue; }


// ───────── 封面：取群晖生成的缩略图 ─────────
let coverBusy = 0;
const coverWait: Array<() => void> = [];
async function coverSlot(): Promise<void> {
  if (coverBusy >= 3) await new Promise<void>((r) => coverWait.push(r));
  coverBusy++;
}
function coverFree(): void { coverBusy--; coverWait.shift()?.(); }

export const coverStat = { ok: 0, fail: 0, why: '' };
const coverEvt = (): void => { window.dispatchEvent(new Event('wemby-cover-stat')); };
const coverWhy = (w: string): string => { coverStat.fail++; if (!coverStat.why) coverStat.why = w; coverEvt(); return ''; };

// 已经取到的封面存在本地（小图，几十 KB 一张），下次打开直接用
const COV_KEY = 'wemby-local-cov2';
function covLoad(): Record<string, string> { try { return JSON.parse(localStorage.getItem(COV_KEY) || '{}') as Record<string, string>; } catch { return {}; } }
function covSave(path: string, data: string): void {
  try {
    const m = covLoad();
    m[path] = data;
    const keys = Object.keys(m);
    if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete m[k];
    localStorage.setItem(COV_KEY, JSON.stringify(m));
  } catch { /* 存满了就算了 */ }
}

let thumbMiss = 0;   // 连续 404 次数：群晖没生成缩略图时不再白白去问
let thumbHit = false;

async function fetchThumb(path: string, retried = false): Promise<string> {
  const c = loadDsm();
  const q = new URLSearchParams({ api: 'SYNO.FileStation.Thumb', version: '2', method: 'get', path, size: 'medium', _sid: await dsmSid(retried) });
  const res = await httpFetch(`${c.server}/webapi/entry.cgi?${q.toString()}`);
  const type = res.headers.get('content-type') || '';
  if (res.ok && type.startsWith('image/')) {
    const blob = await res.blob();
    if (blob.size > 0) { thumbHit = true; thumbMiss = 0; return URL.createObjectURL(blob); }
    return '';
  }
  if (!res.ok) { thumbMiss++; return ''; }
  let code = 0;
  try { code = ((await res.json()) as { error?: { code?: number } }).error?.code ?? 0; } catch { /* ignore */ }
  if (!retried && SESSION_ERR.has(code)) return fetchThumb(path, true);
  thumbMiss++;
  return '';
}

/** 群晖没有缩略图时：下载视频开头一小段，在本地截一帧当封面（需要这段里带有视频头信息，且系统能解码） */
async function fetchFrame(path: string): Promise<string> {
  const url = await dsmPlayUrl(path);
  const res = await httpFetch(url, { headers: { Range: 'bytes=0-4194303' } });
  if (!res.ok) throw new Error(`下载视频开头失败 HTTP ${res.status}`);
  const blob = await res.blob();
  const obj = URL.createObjectURL(blob);
  try {
    return await new Promise<string>((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.playsInline = true;
      const done = (e?: string, d?: string): void => { clearTimeout(t); v.removeAttribute('src'); v.load(); e ? reject(new Error(e)) : resolve(d || ''); };
      const t = setTimeout(() => done('截图超时（这个视频的开头部分不能直接解码）'), 15000);
      v.onerror = () => done('系统播放器解不了这个视频格式');
      // 依次试几个时间点，跳过全黑的帧（片头黑屏，或系统不让读取画面）
      const times = [1.5, 4, 8, 0.4];
      let ti = 0;
      const seek = (): void => {
        if (ti >= times.length) { done('截到的画面都是黑的'); return; }
        const want = Math.min(times[ti++], Math.max(0.1, (v.duration || 10) - 0.2));
        try { v.currentTime = want; } catch { seek(); }
      };
      v.onloadedmetadata = () => seek();
      v.onseeked = () => {
        try {
          const w = 480, h = Math.max(1, Math.round((w * (v.videoHeight || 9)) / (v.videoWidth || 16)));
          const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
          const cx = cv.getContext('2d')!;
          cx.drawImage(v, 0, 0, w, h);
          const px = cx.getImageData(0, 0, w, h).data;
          let sum = 0, n = 0;
          for (let i = 0; i < px.length; i += 4 * 97) { sum += px[i] + px[i + 1] + px[i + 2]; n += 3; }
          if (sum / Math.max(1, n) < 14) { seek(); return; }
          done(undefined, cv.toDataURL('image/jpeg', 0.72));
        } catch (e) { done(e instanceof Error ? e.message : String(e)); }
      };
      v.src = obj;
    });
  } finally { URL.revokeObjectURL(obj); }
}

// 截帧一次只做一个（要下载 4MB）
let frameChain: Promise<unknown> = Promise.resolve();

/** 返回封面图地址；取不到返回空串。结果有缓存。顺序：本地已存 → 群晖缩略图 → 本地截帧 */
export function dsmCover(path: string): Promise<string> {
  let p = coverCache.get(path);
  if (!p) {
    p = (async () => {
      const saved = covLoad()[path];
      if (saved) { coverStat.ok++; coverEvt(); return saved; }
      await coverSlot();
      let why = '';
      try {
        if (thumbHit || thumbMiss < 3) {
          const u = await fetchThumb(path);
          if (u) { coverStat.ok++; coverEvt(); return u; }
        }
      } catch (e) { why = `请求失败：${e instanceof Error ? e.message : String(e)}`; } finally { coverFree(); }
      const job = frameChain.then(async () => {
        try { const d = await fetchFrame(path); covSave(path, d); coverStat.ok++; coverEvt(); return d; }
        catch (e) { return coverWhy(why || (e instanceof Error ? e.message : String(e))); }
      });
      frameChain = job.catch(() => undefined);
      return job;
    })();
    coverCache.set(path, p);
  }
  return p;
}

/** 刷新时清掉封面缓存（包括取失败的），让它重新去取 */
export function clearCovers(): void { coverCache.clear(); thumbMiss = 0; coverStat.ok = 0; coverStat.fail = 0; coverStat.why = ''; }

// ───────── 自建播放列表（本机保存，按视频路径记） ─────────
export interface MyList { id: string; name: string; paths: string[] }
const PL_KEY = 'wemby-local-mylists';
export function readMyLists(): MyList[] {
  try { const a = JSON.parse(localStorage.getItem(PL_KEY) || '[]') as MyList[]; return Array.isArray(a) ? a : []; } catch { return []; }
}
export function writeMyLists(a: MyList[]): void {
  try { localStorage.setItem(PL_KEY, JSON.stringify(a)); } catch { /* ignore */ }
  window.dispatchEvent(new Event('wemby-mylists'));
}

// ───────── 文件夹浏览（安卓「刷刷看」）：区分视频 / 图片 ─────────
export const isImage = (name: string): boolean => /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(name);
/** 视频（不含音乐） */
export const isVideoFile = (name: string): boolean => /\.(mp4|mkv|avi|mov|m4v|ts|webm|wmv|flv|mpg|mpeg|rmvb|rm|3gp|m2ts|iso)$/i.test(name);
/** 手机系统自带播放器大概率能直接放的容器；其余的（mkv / avi …）走 MPV */
export const isWebVideo = (name: string): boolean => /\.(mp4|m4v|webm|mov|3gp)$/i.test(name);

const imgCache = new Map<string, Promise<string>>();
async function fetchImage(path: string, retried: boolean): Promise<string> {
  const c = loadDsm();
  const get = async (q: URLSearchParams): Promise<Blob | null> => {
    const res = await httpFetch(`${c.server}/webapi/entry.cgi?${q.toString()}`);
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.startsWith('image/')) { const b = await res.blob(); return b.size > 0 ? b : null; }
    return null;
  };
  const sidv = await dsmSid(retried);
  // 先要群晖生成的大图（体积小、加载快）；没有再下载原图
  let blob = await get(new URLSearchParams({ api: 'SYNO.FileStation.Thumb', version: '2', method: 'get', path, size: 'large', _sid: sidv })).catch(() => null);
  if (!blob) blob = await get(new URLSearchParams({ api: 'SYNO.FileStation.Download', version: '2', method: 'download', path: JSON.stringify([path]), mode: 'open', _sid: sidv })).catch(() => null);
  if (!blob) {
    if (!retried) return fetchImage(path, true);
    throw new Error('图片读取失败');
  }
  return URL.createObjectURL(blob);
}
/** 取一张可直接放进 <img> 的图片地址（结果有缓存，最多留 60 张，超出的释放掉） */
export function dsmImage(path: string): Promise<string> {
  let p = imgCache.get(path);
  if (!p) {
    p = fetchImage(path, false);
    imgCache.set(path, p);
    p.catch(() => imgCache.delete(path));
    if (imgCache.size > 60) {
      const k = imgCache.keys().next().value as string;
      const old = imgCache.get(k);
      imgCache.delete(k);
      void old?.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
    }
  }
  return p;
}
