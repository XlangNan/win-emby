// 追更服务（kuakego-plus）对接：用它的 HTTP 接口取推荐 / 详情，并一键订阅（它会自动找资源存入网盘）。
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
  imgCache.clear();
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

// 图片接口也要登录：带上认证头取回来，转成 blob 地址（<img> 自己没法带 Authorization）
const imgCache = new Map<string, Promise<string>>();
export function kgImage(path: string): Promise<string> {
  let p = imgCache.get(path);
  if (!p) {
    p = kgFetch(path)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return URL.createObjectURL(await r.blob());
      })
      .catch((e) => {
        imgCache.delete(path);
        throw e;
      });
    imgCache.set(path, p);
  }
  return p;
}

// ───────── 类型（只列用到的字段） ─────────
export type KgScope = 'tv' | 'movie' | 'anime' | 'variety';

export interface KgItem {
  id: number;
  name: string;
  media: 'tv' | 'movie';
  year?: number | string;
  first_air_date?: string;
  release_date?: string;
  vote_average?: number;
  overview?: string;
  poster_url?: string;
  sub_id?: string | null;
  sub_status?: string;
  in_emby?: boolean;
}

export interface KgRow { label: string; category: string; sort: string; items: KgItem[]; err?: string }

export interface KgDetail extends KgItem {
  backdrop_url?: string;
  genres?: string[];
  tagline?: string;
  runtime?: number;
  status?: string;
  number_of_seasons?: number;
  seasons?: { season_number: number; name: string; episode_count: number; air_date: string; emby_have?: number }[];
  subscribed_seasons?: Record<string, string>;
  cast?: { id: number; name: string; character: string; profile_url: string }[];
}

export const kgYear = (it: KgItem): string => String(it.year || (it.first_air_date || it.release_date || '').slice(0, 4) || '');

export const kgHome = (scope: KgScope) => kg<{ rows: KgRow[] }>(`/api/tmdb/home?scope=${scope}`);
export const kgSearch = (q: string, scope: KgScope) => kg<{ items: KgItem[] }>(`/api/tmdb/search?scope=${scope}&q=${encodeURIComponent(q)}`);
export const kgDetail = (media: 'tv' | 'movie', id: number) => kg<KgDetail>(`/api/tmdb/${media}/${id}`);
export const kgSimilar = (media: 'tv' | 'movie', id: number) => kg<{ items: KgItem[] }>(`/api/tmdb/${media}/${id}/similar`);
export const kgSubscribe = (media: 'tv' | 'movie', id: number, season?: number) =>
  kg<{ task: { id: string } }>('/api/quick-subscribe', { method: 'POST', body: { media, tmdb_id: id, season } });
export const kgUnsubscribe = (taskId: string) => kg<unknown>(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
