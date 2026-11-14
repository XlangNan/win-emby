// Audiobookshelf 客户端：登录、书库、封面、详情、进度
import { useEffect, useState } from 'react';
import { httpFetch } from '../emby/http';

export interface AbsConfig { server: string; token: string; user: string }
const KEY = 'wemby-abs';
const EMPTY: AbsConfig = { server: '', token: '', user: '' };

export function normalizeAbsServer(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, '');
  const hasPort = /^https?:\/\/[^/?#]*:\d+(?:[/?#]|$)/i.test(s);
  if (!hasPort && /^http:\/\//i.test(s)) {
    try { const u = new URL(s); u.port = '13378'; s = u.toString().replace(/\/+$/, ''); } catch { /* ignore */ }
  }
  return s;
}

export function loadAbs(): AbsConfig {
  try { return { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<AbsConfig>) }; } catch { return { ...EMPTY }; }
}
export function saveAbs(c: AbsConfig): void {
  try { localStorage.setItem(KEY, JSON.stringify({ server: normalizeAbsServer(c.server), token: c.token.trim(), user: c.user.trim() })); } catch { /* ignore */ }
  window.dispatchEvent(new Event('wemby-abs-changed'));
}
export function clearAbs(): void { saveAbs({ ...EMPTY }); }
export const absConfigured = (): boolean => { const c = loadAbs(); return !!(c.server && c.token); };
/** 配置变化时让组件重新渲染 */
export function useAbsKey(): string {
  const [k, setK] = useState(() => JSON.stringify(loadAbs()));
  useEffect(() => {
    const f = (): void => setK(JSON.stringify(loadAbs()));
    window.addEventListener('wemby-abs-changed', f);
    return () => window.removeEventListener('wemby-abs-changed', f);
  }, []);
  return k;
}

type Obj = Record<string, unknown>;
async function api<T = Obj>(path: string, init?: { method?: string; body?: unknown }, cfg = loadAbs()): Promise<T> {
  if (!cfg.server || !cfg.token) throw new Error('还没有连接 Audiobookshelf');
  let res: Response;
  try {
    res = await httpFetch(cfg.server + path, {
      method: init?.method || 'GET',
      headers: { Authorization: `Bearer ${cfg.token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw new Error(`连不上服务器：${(e as Error).message || e}`);
  }
  if (res.status === 401 || res.status === 403) throw new Error('登录已失效，请重新连接');
  if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
  const t = await res.text();
  return (t ? JSON.parse(t) : {}) as T;
}

/** 用户名 + 密码登录，换取 token */
export async function absLogin(server: string, user: string, pass: string): Promise<AbsConfig> {
  const s = normalizeAbsServer(server);
  let res: Response;
  try {
    res = await httpFetch(`${s}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) });
  } catch (e) {
    throw new Error(`连不上服务器：${(e as Error).message || e}`);
  }
  if (res.status === 401) throw new Error('用户名或密码不对');
  if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
  const j = (await res.json()) as { user?: { accessToken?: string; token?: string; username?: string } };
  const token = j.user?.accessToken || j.user?.token;
  if (!token) throw new Error('服务器没有返回 token');
  return { server: s, token, user: j.user?.username || user };
}

/** 直接用 API token 连接：先试一下能不能访问 */
export async function absCheckToken(server: string, token: string): Promise<AbsConfig> {
  const c = { server: normalizeAbsServer(server), token: token.trim(), user: '' };
  const me = await api<{ username?: string }>('/api/me', undefined, c);
  return { ...c, user: me.username || '' };
}

export interface AbsLibrary { id: string; name: string }
export async function absLibraries(): Promise<AbsLibrary[]> {
  const r = await api<{ libraries?: { id: string; name: string; mediaType: string }[] }>('/api/libraries');
  return (r.libraries || []).filter((l) => l.mediaType === 'book').map((l) => ({ id: l.id, name: l.name }));
}

export interface AbsBook {
  id: string; title: string; subtitle: string; author: string; narrator: string; series: string;
  duration: number; year: string;
}
interface RawItem { id: string; media?: { duration?: number; metadata?: Obj } }
function toBook(it: RawItem): AbsBook {
  const m = (it.media?.metadata || {}) as Record<string, string | undefined>;
  return {
    id: it.id, title: m.title || '未命名', subtitle: m.subtitle || '', author: m.authorName || '', narrator: m.narratorName || '',
    series: m.seriesName || '', duration: it.media?.duration || 0, year: m.publishedYear || '',
  };
}

export interface AbsShelf { id: string; label: string; books: AbsBook[] }
const SHELF_NAME: Record<string, string> = { 'continue-listening': '继续收听', 'recently-added': '最近添加', 'listen-again': '再听一遍', discover: '发现' };
export async function absShelves(lib: string): Promise<AbsShelf[]> {
  const r = await api<{ id: string; label: string; type: string; entities: RawItem[] }[]>(`/api/libraries/${lib}/personalized?limit=14`);
  return (Array.isArray(r) ? r : [])
    .filter((s) => s.type === 'book' && SHELF_NAME[s.id] && s.entities?.length)
    .map((s) => ({ id: s.id, label: SHELF_NAME[s.id], books: s.entities.map(toBook) }));
}

export type AbsSort = 'media.metadata.title' | 'addedAt' | 'media.metadata.authorName' | 'media.duration';
export async function absBooks(lib: string, page: number, sort: AbsSort, desc: boolean, limit = 60): Promise<{ books: AbsBook[]; total: number }> {
  const r = await api<{ results: RawItem[]; total: number }>(`/api/libraries/${lib}/items?limit=${limit}&page=${page}&sort=${encodeURIComponent(sort)}&desc=${desc ? 1 : 0}&minified=1`);
  return { books: (r.results || []).map(toBook), total: r.total || 0 };
}
export async function absSearch(lib: string, q: string): Promise<AbsBook[]> {
  const r = await api<{ book?: { libraryItem: RawItem }[] }>(`/api/libraries/${lib}/search?q=${encodeURIComponent(q)}&limit=30`);
  return (r.book || []).map((b) => toBook(b.libraryItem));
}

export const absCover = (id: string, width = 400): string => {
  const c = loadAbs();
  return c.server ? `${c.server}/api/items/${id}/cover?width=${width}&token=${encodeURIComponent(c.token)}` : '';
};

export interface AbsChapter { id: number; start: number; end: number; title: string }
export interface AbsFile { ino: string; index: number; duration: number }
export interface AbsDetail extends AbsBook {
  description: string; genres: string[]; chapters: AbsChapter[]; files: AbsFile[];
}
export async function absDetail(id: string): Promise<AbsDetail> {
  const r = await api<{
    id: string;
    media: {
      duration?: number;
      metadata: { title?: string; subtitle?: string; authors?: { name: string }[]; narrators?: string[]; series?: { name: string; sequence?: string }[]; description?: string; genres?: string[]; publishedYear?: string };
      audioFiles?: { ino: string; index: number; duration: number }[];
      chapters?: { id: number; start: number; end: number; title: string }[];
    };
  }>(`/api/items/${id}?expanded=1`);
  const m = r.media.metadata;
  return {
    id: r.id, title: m.title || '未命名', subtitle: m.subtitle || '',
    author: (m.authors || []).map((a) => a.name).join('、'), narrator: (m.narrators || []).join('、'),
    series: (m.series || []).map((s) => (s.sequence ? `${s.name} #${s.sequence}` : s.name)).join('、'),
    duration: r.media.duration || 0, year: m.publishedYear || '',
    description: (m.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim(),
    genres: m.genres || [],
    chapters: r.media.chapters || [],
    files: [...(r.media.audioFiles || [])].sort((a, b) => a.index - b.index).map((f) => ({ ino: f.ino, index: f.index, duration: f.duration })),
  };
}
export const absFileUrl = (id: string, ino: string): string => {
  const c = loadAbs();
  return `${c.server}/api/items/${id}/file/${ino}?token=${encodeURIComponent(c.token)}`;
};

// ───────── 进度 ─────────
export interface AbsProgress { currentTime: number; duration: number; progress: number; isFinished: boolean }
let progCache: Map<string, AbsProgress> | null = null;
export async function absProgressMap(force = false): Promise<Map<string, AbsProgress>> {
  if (progCache && !force) return progCache;
  const me = await api<{ mediaProgress?: { libraryItemId: string; episodeId?: string; currentTime: number; duration: number; progress: number; isFinished: boolean }[] }>('/api/me');
  const m = new Map<string, AbsProgress>();
  for (const p of me.mediaProgress || []) if (!p.episodeId) m.set(p.libraryItemId, { currentTime: p.currentTime, duration: p.duration, progress: p.progress, isFinished: p.isFinished });
  progCache = m;
  return m;
}
export function setLocalProgress(id: string, p: AbsProgress): void { progCache?.set(id, p); }
export async function absSaveProgress(id: string, currentTime: number, duration: number, finished = false): Promise<void> {
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  setLocalProgress(id, { currentTime, duration, progress, isFinished: finished });
  try { await api(`/api/me/progress/${id}`, { method: 'PATCH', body: { currentTime, duration, progress, isFinished: finished } }); } catch { /* 下次再同步 */ }
}

export function fmtDur(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function fmtLong(sec: number): string {
  if (sec <= 0) return '';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
}

// ───────── 首页仪表盘用：书库统计 / 收听统计 ─────────
export async function absLibStats(lib: string): Promise<{ items: number; duration: number }> {
  const r = await api<{ totalItems?: number; totalDuration?: number }>(`/api/libraries/${lib}/stats`);
  return { items: r.totalItems || 0, duration: r.totalDuration || 0 };
}
export interface AbsSession { id: string; title: string; author: string; sec: number; at: number }
export async function absListening(): Promise<{ days: Record<string, number>; sessions: AbsSession[] }> {
  const r = await api<{ days?: Record<string, number>; recentSessions?: { libraryItemId: string; displayTitle?: string; displayAuthor?: string; timeListening?: number; updatedAt?: number }[] }>('/api/me/listening-stats');
  const sessions = (r.recentSessions || []).map((x) => ({ id: x.libraryItemId, title: x.displayTitle || '', author: x.displayAuthor || '', sec: x.timeListening || 0, at: x.updatedAt || 0 }));
  return { days: r.days || {}, sessions };
}
