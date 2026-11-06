// TheIntroDB：按 TMDB 编号 + 季/集 取片头 / 片尾时间（毫秒），结果缓存在本机，查不到也缓存避免反复请求。
import { httpFetch } from '../emby/http';
import { loadTmdb } from './tmdb';

const KEY = 'wemby-introdb';
export interface Seg { st: number; en: number }
export interface IntroInfo { intro?: Seg; credits?: Seg }

let mem: Record<string, IntroInfo & { at: number }> | null = null;
function store(): Record<string, IntroInfo & { at: number }> {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { mem = {}; }
  return mem!;
}

function pick(v: unknown): Seg | undefined {
  const a = Array.isArray(v) ? v[0] : v;
  if (!a || typeof a !== 'object') return undefined;
  const o = a as { start_ms?: number | null; end_ms?: number | null; startMs?: number | null; endMs?: number | null };
  const st = (o.start_ms ?? o.startMs ?? 0) / 1000;
  const en = o.end_ms ?? o.endMs;
  if (en == null || en <= 0) return undefined;
  return en / 1000 > st ? { st, en: en / 1000 } : undefined;
}

export async function fetchIntroDb(tmdbId: string, season?: number, episode?: number): Promise<IntroInfo> {
  const key = `${tmdbId}|${season ?? ''}|${episode ?? ''}`;
  const hit = store()[key];
  if (hit && Date.now() - hit.at < 30 * 86400e3) return hit;
  const q = `tmdb_id=${tmdbId}${season != null ? `&season=${season}&episode=${episode}` : ''}`;
  const url = `https://api.theintrodb.org/v4/media?${q}`;
  let r: Response;
  try {
    r = await httpFetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    const px = loadTmdb().proxy;
    if (!px) throw new Error('连不上 TheIntroDB');
    r = await httpFetch(url, { headers: { Accept: 'application/json' } }, { proxy: px });
  }
  let info: IntroInfo = {};
  if (r.ok) {
    const j = (await r.json()) as Record<string, unknown>;
    info = { intro: pick(j.intro), credits: pick(j.credits) };
  } else if (r.status !== 404) throw new Error(`TheIntroDB ${r.status}`);
  store()[key] = { ...info, at: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(store())); } catch { /* ignore */ }
  return info;
}

const EKEY = 'wemby-introdb-on';
/** 是否在播放时使用 TheIntroDB（默认关，手动开启） */
export const introDbOn = (): boolean => { try { return localStorage.getItem(EKEY) === '1'; } catch { return false; } };
export const setIntroDbOn = (v: boolean): void => { try { localStorage.setItem(EKEY, v ? '1' : '0'); } catch { /* ignore */ } };

/** 缓存里这一集的状态：有数据 / 查过但没有 / 还没查 */
export function introStatus(tmdbId: string, season: number, episode: number): 'has' | 'none' | 'unknown' {
  const h = store()[`${tmdbId}|${season}|${episode}`];
  if (!h) return 'unknown';
  return h.intro || h.credits ? 'has' : 'none';
}

/** 手动扫描一部剧的所有集；返回 有数据 / 无数据 / 失败 的集数 */
export async function scanSeries(tmdbId: string, eps: { season: number; ep: number }[], onProgress: (done: number) => void): Promise<{ has: number; none: number; fail: number }> {
  let has = 0, none = 0, fail = 0, done = 0, i = 0;
  const worker = async (): Promise<void> => {
    while (i < eps.length) {
      const e = eps[i++];
      try {
        const r = await fetchIntroDb(tmdbId, e.season, e.ep);
        if (r.intro || r.credits) has++; else none++;
      } catch { fail++; }
      onProgress(++done);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { has, none, fail };
}
