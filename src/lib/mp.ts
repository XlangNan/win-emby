// MoviePilot v2 对接：订阅 / 取消订阅（下载到本地）和查订阅状态。
// 鉴权：优先用「用户名 + 密码」登录换 token（Bearer）；也可只填 API 令牌（X-API-KEY）。
import { httpFetch } from '../emby/http';

const KEY = 'wemby-mp';

export interface MpConfig {
  url: string;
  username: string;
  password: string;
  apiToken: string;
}

export function loadMp(): MpConfig {
  try {
    return { url: '', username: '', password: '', apiToken: '', ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<MpConfig>) };
  } catch {
    return { url: '', username: '', password: '', apiToken: '' };
  }
}

export function saveMp(c: MpConfig): void {
  let url = c.url.trim().replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
  if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`;
  jwt = null;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...c, url, username: c.username.trim(), apiToken: c.apiToken.trim() }));
  } catch {
    /* ignore */
  }
}

export const mpReady = (): boolean => {
  const c = loadMp();
  return !!c.url && (!!c.apiToken || !!c.username);
};

let jwt: string | null = null;

async function login(c: MpConfig): Promise<string> {
  const res = await httpFetch(`${c.url}/api/v1/login/access-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ username: c.username, password: c.password }).toString(),
  });
  if (!res.ok) throw new Error(res.status === 401 || res.status === 400 ? 'MoviePilot 登录失败：用户名或密码不对' : `MoviePilot 登录失败 ${res.status}`);
  const d = (await res.json()) as { access_token?: string };
  if (!d.access_token) throw new Error('MoviePilot 登录失败：没有拿到令牌');
  return d.access_token;
}

async function mpRaw(path: string, init: { method?: string; body?: unknown }, c: MpConfig, retry: boolean): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let url = `${c.url}/api/v1${path}`;
  if (c.username) {
    if (!jwt) jwt = await login(c);
    headers.Authorization = `Bearer ${jwt}`;
  } else {
    headers['X-API-KEY'] = c.apiToken;
    url += `${path.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(c.apiToken)}`;
  }
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await httpFetch(url, { method: init.method || 'GET', headers, body });
  if ((res.status === 401 || res.status === 403) && retry && c.username) {
    jwt = null; // 令牌过期：重新登录一次
    return mpRaw(path, init, c, false);
  }
  return res;
}

export async function mp<T>(path: string, init: { method?: string; body?: unknown } = {}, cfg = loadMp()): Promise<T> {
  if (!cfg.url) throw new Error('还没有设置 MoviePilot 地址（设置 → MoviePilot）');
  const res = await mpRaw(path, init, cfg, true);
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const d = data as { detail?: unknown; message?: string } | undefined;
    const detail = typeof d?.detail === 'string' ? d.detail : d?.message;
    throw new Error(detail || (res.status === 401 || res.status === 403 ? 'MoviePilot 鉴权失败：检查用户名密码或 API 令牌' : `MoviePilot 请求失败 ${res.status}`));
  }
  return data as T;
}

export interface MpSub { id: number; name?: string; tmdbid?: number; type?: string; season?: number; state?: string; note?: unknown }

/** MoviePilot 里已有的订阅 */
export async function mpSubs(): Promise<MpSub[]> {
  const r = await mp<MpSub[]>('/subscribe/');
  return Array.isArray(r) ? r.filter((s) => s.tmdbid) : [];
}

export const mpMediaKey = (s: MpSub): string => `${s.type === '电影' || s.type === 'movie' ? 'movie' : 'tv'}:${s.tmdbid}`;

export async function mpSubscribe(media: 'movie' | 'tv', tmdbid: number, name: string, year: string, season: number): Promise<void> {
  const body: Record<string, unknown> = { name, year, type: media === 'movie' ? '电影' : '电视剧', tmdbid };
  if (media === 'tv') body.season = season;
  const r = await mp<{ success?: boolean; message?: string }>('/subscribe/', { method: 'POST', body });
  if (r && r.success === false) throw new Error(r.message || 'MoviePilot 拒绝了这个订阅');
}

export async function mpUnsubscribe(id: number): Promise<void> {
  const r = await mp<{ success?: boolean; message?: string }>(`/subscribe/${id}`, { method: 'DELETE' });
  if (r && r.success === false) throw new Error(r.message || '取消订阅失败');
}
