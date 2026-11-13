// 音乐离线缓存：把歌曲 / 封面 / 歌词存进本机（IndexedDB），没网时也能听。
// 存储在应用自己的 WebView 里：Windows / 安卓 / iOS 通用，卸载应用时一并清除。
import { useSyncExternalStore } from 'react';
import { httpFetch } from '../emby/http';
import { toast } from './Dialog';
import { rawCoverUrl, setOfflineCoverLookup, streamUrl, nd, type Song } from './navidrome';
import type { Lyr } from './lyrics';

interface Meta { id: string; song: Song; size: number; at: number; lyrics?: Lyr | null }

const DB = 'wemby-music-offline';
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const n of ['meta', 'blob', 'cover']) if (!d.objectStoreNames.contains(n)) d.createObjectStore(n);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('本地存储不可用'));
    });
    dbp.catch(() => { dbp = null; });
  }
  return dbp;
}
async function idb<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise<T>((res, rej) => {
    const t = d.transaction(store, mode);
    const rq = f(t.objectStore(store));
    t.oncomplete = () => res(rq.result);
    t.onerror = () => rej(t.error || new Error('写入失败'));
    t.onabort = () => rej(t.error || new Error('写入被中止（存储空间不足？）'));
  });
}

const metas = new Map<string, Meta>();
const covers = new Map<string, string>();   // coverArt → blob: 地址
const prog = new Map<string, number>();     // 正在下载：id → 0..100
let ver = 0;
const subs = new Set<() => void>();
const bump = (): void => { ver++; subs.forEach((f) => f()); };
const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** 组件订阅：下载 / 删除 / 进度变化时重绘 */
export function useOfflineVer(): number { return useSyncExternalStore(subscribe, () => ver); }

let readyP: Promise<void> | null = null;
export function offlineReady(): Promise<void> {
  if (!readyP) {
    readyP = (async () => {
      try {
        const all = await idb<Meta[]>('meta', 'readonly', (s) => s.getAll() as IDBRequest<Meta[]>);
        for (const m of all) metas.set(m.id, m);
        const d = await db();
        await new Promise<void>((res) => {
          const t = d.transaction('cover', 'readonly');
          const c = t.objectStore('cover').openCursor();
          c.onsuccess = () => {
            const cur = c.result;
            if (cur) { covers.set(String(cur.key), URL.createObjectURL(cur.value as Blob)); cur.continue(); }
          };
          t.oncomplete = () => res();
          t.onerror = () => res();
        });
      } catch { /* 存储不可用：当作没有离线歌曲 */ }
      bump();
    })();
  }
  return readyP;
}
setOfflineCoverLookup((id) => covers.get(id) || '');
void offlineReady();

export const isOffline = (id: string): boolean => metas.has(id);
export const dlProgress = (id: string): number | null => (prog.has(id) ? (prog.get(id) as number) : null);
export function offlineSongs(): Song[] {
  return [...metas.values()].sort((a, b) => b.at - a.at).map((m) => m.song);
}
export const offlineBytes = (): number => [...metas.values()].reduce((a, m) => a + m.size, 0);
export function getOfflineLyrics(id: string): Lyr | null { return metas.get(id)?.lyrics || null; }

// ───────── 播放：把本地文件变成 blob: 地址（只留最近几首，其余释放） ─────────
const urls = new Map<string, string>();
export async function offlineUrl(id: string): Promise<string | null> {
  if (!metas.has(id)) return null;
  const hit = urls.get(id);
  if (hit) { urls.delete(id); urls.set(id, hit); return hit; }
  try {
    const b = await idb<Blob | undefined>('blob', 'readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urls.set(id, u);
    while (urls.size > 4) { const k = urls.keys().next().value as string; URL.revokeObjectURL(urls.get(k) as string); urls.delete(k); }
    return u;
  } catch { return null; }
}

// ───────── 下载（排队，同时下 2 首） ─────────
const MIME: Record<string, string> = { mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', wma: 'audio/x-ms-wma', ape: 'audio/x-ape' };
const waiting: Song[] = [];
let running = 0;
let askedPersist = false;
let failToast = 0;

async function fetchBlob(url: string, type: string, total: number, onPct: (p: number) => void): Promise<Blob> {
  const res = await httpFetch(url);
  if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (/json|xml|html|text\/plain/i.test(ct)) throw new Error('服务器没有返回音频（账号权限或地址不对？）');
  const len = Number(res.headers.get('content-length')) || total;
  const t = ct && !/octet-stream/i.test(ct) ? ct : type;
  if (res.body && len > 0) {
    const rd = res.body.getReader();
    const parts: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      if (value) { parts.push(value); got += value.length; onPct(Math.min(99, Math.round((got / len) * 100))); }
    }
    return new Blob(parts as BlobPart[], { type: t });
  }
  const b = await res.blob();
  return b.type ? b : new Blob([b], { type: t });
}

async function saveOne(s: Song): Promise<void> {
  const blob = await fetchBlob(streamUrl(s.id), MIME[s.suffix.toLowerCase()] || 'audio/mpeg', s.size, (p) => { prog.set(s.id, p); bump(); });
  if (blob.size < 2048) throw new Error('下载到的文件不完整');
  let lyrics: Lyr | null = null;
  try { const l = await nd.lyrics(s); if (l.lines.length) lyrics = l; } catch { /* 没有歌词就算了 */ }
  await idb('blob', 'readwrite', (st) => st.put(blob, s.id));
  const meta: Meta = { id: s.id, song: s, size: blob.size, at: Date.now(), lyrics };
  await idb('meta', 'readwrite', (st) => st.put(meta, s.id));
  metas.set(s.id, meta);
  const ca = s.coverArt;
  if (ca && !covers.has(ca)) {
    try {
      const cu = rawCoverUrl(ca, 500);
      if (cu) {
        const r = await httpFetch(cu);
        const b = r.ok ? await r.blob() : null;
        if (b && b.size > 100 && /image/i.test(b.type)) {
          await idb('cover', 'readwrite', (st) => st.put(b, ca));
          covers.set(ca, URL.createObjectURL(b));
        }
      }
    } catch { /* 封面失败不影响歌曲 */ }
  }
}

function pump(): void {
  while (running < 2 && waiting.length) {
    const s = waiting.shift() as Song;
    if (metas.has(s.id)) { prog.delete(s.id); continue; }
    running++;
    prog.set(s.id, 0);
    bump();
    saveOne(s).catch((e: Error) => {
      if (Date.now() - failToast > 4000) { failToast = Date.now(); toast(`下载失败：${s.title}（${e.message}）`); }
    }).finally(() => { running--; prog.delete(s.id); bump(); pump(); });
  }
}

/** 加入下载队列（已下载的、已在队列里的自动跳过） */
export function downloadSongs(songs: Song[]): number {
  if (!askedPersist) { askedPersist = true; try { void navigator.storage?.persist?.(); } catch { /* ignore */ } }
  let n = 0;
  for (const s of songs) {
    if (metas.has(s.id) || prog.has(s.id) || waiting.some((w) => w.id === s.id)) continue;
    waiting.push(s); prog.set(s.id, 0); n++;
  }
  bump();
  pump();
  return n;
}
/** 还在排队 / 下载中的数量 */
export const pendingCount = (songs: Song[]): number => songs.filter((s) => prog.has(s.id)).length;

export async function removeOffline(ids: string[]): Promise<void> {
  const cas = new Set<string>();
  for (const id of ids) {
    const m = metas.get(id);
    if (!m) continue;
    metas.delete(id);
    const u = urls.get(id);
    if (u) { URL.revokeObjectURL(u); urls.delete(id); }
    cas.add(m.song.coverArt);
    await idb('blob', 'readwrite', (s) => s.delete(id)).catch(() => undefined);
    await idb('meta', 'readwrite', (s) => s.delete(id)).catch(() => undefined);
  }
  for (const ca of cas) {
    if (!ca || [...metas.values()].some((m) => m.song.coverArt === ca)) continue;
    const u = covers.get(ca);
    if (u) { URL.revokeObjectURL(u); covers.delete(ca); }
    await idb('cover', 'readwrite', (s) => s.delete(ca)).catch(() => undefined);
  }
  bump();
}
export const clearOffline = (): Promise<void> => removeOffline([...metas.keys()]);

export const fmtBytes = (n: number): string => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export async function storageInfo(): Promise<{ usage: number; quota: number } | null> {
  try { const e = await navigator.storage?.estimate?.(); return e ? { usage: e.usage || 0, quota: e.quota || 0 } : null; } catch { return null; }
}
