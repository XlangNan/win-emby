// 同步与备份：把本机设置（账号、hosts、各项开关……）加密后存到自建的同步服务；电脑 / 手机各存一份。
// 加密在本机完成：同步密码 → PBKDF2 → 两把独立的钥匙（一把登录用、一把加密用），服务器只看得到密文。
import { useEffect, useState } from 'react';
import { httpFetch } from '../emby/http';
import { isMobileApp } from '../lib/platform';

export type Platform = 'desktop' | 'mobile';
export const platform: Platform = isMobileApp ? 'mobile' : 'desktop';
export const platformLabel = (p: Platform = platform): string => (p === 'mobile' ? '手机' : '电脑');

/** 参与同步的本机存储项（不含：设备 ID、各种缓存、页面记忆、观看位置等随设备变化的内容） */
const KEYS = [
  'wemby-session', 'wemby-accounts', 'wemby-play-prefs', 'wemby-hosts', 'wemby-ua', 'wemby-tmdb', 'wemby-kg', 'wemby-kg-acct',
  'wemby-mp', 'wemby-danmaku', 'wemby-font', 'wemby-mode', 'weave-theme', 'wemby-sub-style', 'wemby-sub-target', 'wemby-introdb',
  'wemby-introdb-on', 'wemby-introdb-proxy', 'wemby-intro-manual', 'wemby-track-memory', 'wemby-navidrome', 'wemby-music-opts',
  'wemby-music-prefs', 'wemby-abs', 'wemby-abs-rate', 'wemby-party-opts', 'wemby-party-url', 'wemby-live-sources', 'wemby-live-fav',
  'wemby-epg-url', 'wemby-local', 'wemby-local-prefs',
];

const CFG_KEY = 'wemby-sync';
export interface SyncCfg {
  server: string; user: string; token: string; ek: string;
  auto: boolean; ver: number; hash: string; at: number;
  conflict?: { ver: number; at: number } | null;
}

export function loadSync(): SyncCfg | null {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null') as SyncCfg | null;
    return c && c.server && c.token && c.ek ? c : null;
  } catch { return null; }
}
function saveCfg(c: SyncCfg | null): void {
  try { if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY); } catch { /* ignore */ }
  window.dispatchEvent(new Event('wemby-sync-changed'));
}
export function useSync(): SyncCfg | null {
  const [c, setC] = useState(loadSync);
  useEffect(() => {
    const f = (): void => setC(loadSync());
    window.addEventListener('wemby-sync-changed', f);
    return () => window.removeEventListener('wemby-sync-changed', f);
  }, []);
  return c;
}

// ───────── 加密 ─────────
const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (u: Uint8Array): string => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const hex = (u: Uint8Array): string => Array.from(u).map((b) => b.toString(16).padStart(2, '0')).join('');

function needCrypto(): void { if (!globalThis.crypto?.subtle) throw new Error('这个环境不支持加密功能（需要 https 或本机地址打开）'); }
async function pbkdf2(pw: string, salt: string): Promise<Uint8Array> {
  needCrypto();
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 200000 }, k, 256));
}
async function encrypt(ekB64: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', fromB64(ekB64) as BufferSource, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)));
  return `${toB64(iv)}.${toB64(ct)}`;
}
async function decrypt(ekB64: string, blob: string): Promise<string> {
  const [iv, ct] = blob.split('.');
  const key = await crypto.subtle.importKey('raw', fromB64(ekB64) as BufferSource, 'AES-GCM', false, ['decrypt']);
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) as BufferSource }, key, fromB64(ct) as BufferSource));
}
async function sha(text: string): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)))); }

// ───────── 本机数据 ─────────
function collect(): string {
  const o: Record<string, string> = {};
  for (const k of KEYS) { try { const v = localStorage.getItem(k); if (v !== null) o[k] = v; } catch { /* ignore */ } }
  return JSON.stringify(o, Object.keys(o).sort());
}
function applyLocal(text: string): void {
  const o = JSON.parse(text) as Record<string, string>;
  for (const k of KEYS) {
    try { if (k in o) localStorage.setItem(k, o[k]); else localStorage.removeItem(k); } catch { /* ignore */ }
  }
}
const deviceName = (): string => {
  const u = navigator.userAgent;
  return /iPad/.test(u) ? 'iPad' : /iPhone/.test(u) ? 'iPhone' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac/.test(u) ? 'Mac' : 'Linux';
};

// ───────── 服务器接口 ─────────
export const normServer = (s: string): string => {
  let v = s.trim().replace(/\/+$/, '');
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  return v;
};
async function api<T>(server: string, path: string, opt: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await httpFetch(`${server}${path}`, {
      method: opt.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opt.token ? { Authorization: `Bearer ${opt.token}` } : {}) },
      body: opt.body === undefined ? undefined : JSON.stringify(opt.body),
    });
  } catch (e) { throw new Error(`连不上同步服务：${e instanceof Error ? e.message : String(e)}`); }
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) { const err = new Error(j.error || `同步服务返回 HTTP ${res.status}`) as Error & { status?: number; data?: unknown }; err.status = res.status; err.data = j; throw err; }
  return j;
}

/** 登录（或注册）同步账号。返回的配置已保存到本机。 */
export async function syncLogin(serverIn: string, userIn: string, pw: string, register: boolean): Promise<SyncCfg> {
  const server = normServer(serverIn);
  const user = userIn.trim().toLowerCase();
  if (!server || !user || !pw) throw new Error('服务器地址、用户名、密码都要填');
  const salt = register ? hex(crypto.getRandomValues(new Uint8Array(16))) : (await api<{ salt: string }>(server, `/api/salt?user=${encodeURIComponent(user)}`)).salt;
  const [auth, ek] = await Promise.all([pbkdf2(pw, `${salt}:auth`), pbkdf2(pw, `${salt}:enc`)]);
  const body = { user, authKey: toB64(auth), salt, device: deviceName() };
  const r = await api<{ token: string }>(server, register ? '/api/register' : '/api/login', { method: 'POST', body });
  const cfg: SyncCfg = { server, user, token: r.token, ek: toB64(ek), auto: true, ver: 0, hash: '', at: 0, conflict: null };
  saveCfg(cfg);
  return cfg;
}
export async function syncLogout(): Promise<void> {
  const c = loadSync();
  if (c) { try { await api(c.server, '/api/logout', { method: 'POST', token: c.token }); } catch { /* 服务器连不上也照样退出 */ } }
  saveCfg(null);
}
export function setAuto(auto: boolean): void { const c = loadSync(); if (c) saveCfg({ ...c, auto }); }

export interface Meta { version: number; updated: number; device: string }
export const fetchMeta = (c: SyncCfg): Promise<Meta> => api<Meta>(c.server, `/api/profile/${platform}/meta`, { token: c.token });
export const fetchHistory = (c: SyncCfg): Promise<Meta[]> => api<{ items: Meta[] }>(c.server, `/api/profile/${platform}/history`, { token: c.token }).then((r) => r.items);

/** 上传本机设置。force = 不管云端有没有更新的版本，直接覆盖。 */
export async function pushNow(force = false): Promise<void> {
  const c = loadSync();
  if (!c) throw new Error('还没有登录同步账号');
  const text = collect();
  const blob = await encrypt(c.ek, text);
  try {
    const r = await api<{ version: number; updated: number }>(c.server, `/api/profile/${platform}`, { method: 'PUT', token: c.token, body: { blob, baseVersion: force ? undefined : c.ver, force, device: deviceName() } });
    saveCfg({ ...c, ver: r.version, hash: await sha(text), at: Date.now(), conflict: null });
  } catch (e) {
    const err = e as Error & { status?: number; data?: { version?: number; updated?: number } };
    if (err.status === 409) { saveCfg({ ...c, conflict: { ver: err.data?.version ?? 0, at: (err.data?.updated ?? 0) * 1000 } }); throw new Error('云端有更新的设置，请选择用云端还是用本机'); }
    throw e;
  }
}

/** 下载云端设置并应用到本机（会重新载入应用）。version 为空 = 最新。返回 false = 云端还没有这个平台的设置。 */
export async function pullApply(version?: number, reload = true): Promise<boolean> {
  const c = loadSync();
  if (!c) throw new Error('还没有登录同步账号');
  const r = await api<{ version: number; blob: string; updated: number }>(c.server, `/api/profile/${platform}${version ? `?version=${version}` : ''}`, { token: c.token });
  if (!r.version || !r.blob) return false;
  let text: string;
  try { text = await decrypt(c.ek, r.blob); } catch { throw new Error('解密失败：同步密码和上传时不一致？'); }
  applyLocal(text);
  saveCfg({ ...(loadSync() ?? c), ver: r.version, hash: await sha(collect()), at: Date.now(), conflict: null });
  if (reload) window.location.reload();
  return true;
}

/** 新装时在登录页用：登录同步账号 → 拉取这个平台的设置 → 应用并重新载入 */
export async function restoreFromAccount(server: string, user: string, pw: string): Promise<boolean> {
  await syncLogin(server, user, pw, false);
  const ok = await pullApply();
  if (!ok) { const c = loadSync(); if (c) saveCfg({ ...c, ver: 0 }); }
  return ok;
}

/** 登录后第一次对账：云端是空的 → 直接上传；云端已有 → 记成「待选择」，由用户决定用哪边 */
export async function firstSync(): Promise<'uploaded' | 'choose'> {
  const c = loadSync();
  if (!c) throw new Error('还没有登录同步账号');
  const m = await fetchMeta(c);
  if (m.version === 0) { await pushNow(true); return 'uploaded'; }
  saveCfg({ ...c, ver: m.version, hash: '', conflict: { ver: m.version, at: m.updated * 1000 } });
  return 'choose';
}

// ───────── 自动同步 ─────────
let started = false;
let busy = false;
/** 应用启动后调用一次：先对账（云端更新且本机没动过 → 自动应用；两边都改过 → 标记冲突），再每 15 秒检查本机有没有变化 */
export function startSync(): void {
  if (started) return;
  started = true;
  const tick = async (first: boolean): Promise<void> => {
    const c = loadSync();
    if (!c || !c.auto || busy || c.conflict) return;
    busy = true;
    try {
      const now = await sha(collect());
      if (first) {
        const m = await fetchMeta(c);
        if (m.version > c.ver) {
          if (now === c.hash) { await pullApply(); return; }
          saveCfg({ ...c, conflict: { ver: m.version, at: m.updated * 1000 } });
          return;
        }
      }
      if (now !== c.hash) await pushNow(false);
    } catch { /* 下次再试；错误在设置页手动同步时会显示 */ } finally { busy = false; }
  };
  window.setTimeout(() => void tick(true), 2500);
  window.setInterval(() => void tick(false), 15000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) void tick(false); });
}
