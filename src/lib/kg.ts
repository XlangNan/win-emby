// 追更服务（kuakego-plus）对接：只用来「订阅 / 取消订阅」（它会自动找资源存入网盘）和查订阅状态。
// 鉴权用它自带的 Basic 认证（WEBUI_USERNAME / WEBUI_PASSWORD）。
import { httpFetch } from '../emby/http';

const KEY = 'wemby-kg';

export interface KgConfig {
  url: string;
  username: string;
  password: string;
}

export function loadKg(): KgConfig {
  try {
    return { url: '', username: 'admin', password: '', ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<KgConfig>) };
  } catch {
    return { url: '', username: 'admin', password: '' };
  }
}

export function saveKg(c: KgConfig): void {
  let url = c.url.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...c, url }));
  } catch {
    /* ignore */
  }
}

export const kgReady = (): boolean => !!loadKg().url;

function auth(c: KgConfig): Record<string, string> {
  const raw = `${c.username}:${c.password}`;
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(raw)));
  return { Authorization: `Basic ${b64}` };
}

export async function kgFetch(path: string, init: { method?: string; body?: unknown } = {}, cfg = loadKg()): Promise<Response> {
  if (!cfg.url) throw new Error('还没有设置追更服务地址（设置 → 追更服务）');
  const headers: Record<string, string> = { ...auth(cfg), Accept: 'application/json' };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  return httpFetch(`${cfg.url}${path}`, { method: init.method || 'GET', headers, body });
}

export async function kg<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await kgFetch(path, init);
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | undefined)?.error;
    throw new Error(msg || (res.status === 401 ? '追更服务登录失败：用户名或密码不对' : `追更服务请求失败 ${res.status}`));
  }
  return data as T;
}

// ───────── 订阅 ─────────
export interface KgTask { id: string; media?: string; tmdb_id?: number; season?: number; kind?: string; status?: string }

/** 追更服务里已有的订阅：按 media:tmdb_id 归类（剧集可有多季） */
export async function kgTasks(): Promise<KgTask[]> {
  return (await kg<{ tasks: KgTask[] }>('/api/tasks')).tasks.filter((t) => t.tmdb_id);
}

export interface KgAccount { id: string; drive: 'quark' | 'xunlei' | 'guangya'; name: string; primary: boolean; state: string; logged: boolean; nickname: string }
export const DRIVE_NAMES: Record<string, string> = { quark: '夸克', xunlei: '迅雷', guangya: '光鸭' };

/** 追更服务里已有的网盘账号（每个网盘的主账号 + 其他账号） */
export async function kgAccounts(): Promise<KgAccount[]> {
  return (await kg<{ accounts: KgAccount[] }>('/api/accounts')).accounts;
}

export const accountKey = (a: { drive: string; id: string }): string => `${a.drive}|${a.id}`;
export const accountLabel = (a: KgAccount): string =>
  `${DRIVE_NAMES[a.drive] || a.drive} · ${a.name}${a.nickname ? `（${a.nickname}）` : ''}${a.logged ? (a.state === 'bad' ? ' · 登录失效' : '') : ' · 未登录'}`;

export const kgSubscribe = (media: 'tv' | 'movie', id: number, season?: number, drive?: string, account?: string) =>
  kg<{ task: { id: string } }>('/api/quick-subscribe', { method: 'POST', body: { media, tmdb_id: id, season, drive, account } });
export const kgUnsubscribe = (taskId: string) => kg<unknown>(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
