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

export function loadDsm(): DsmConfig {
  try { return { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<DsmConfig>) }; } catch { return { ...EMPTY }; }
}
export function saveDsm(c: DsmConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify({ server: normalizeDsmServer(c.server), user: c.user.trim(), pass: c.pass, folder: c.folder.trim() })); } catch { /* ignore */ }
  sid = '';
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
