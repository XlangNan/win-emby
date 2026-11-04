// 直接访问 TMDB（不经过追更服务）。支持 v3 API Key 或 v4「API 读访问令牌」，可设置 HTTP 代理。
import { httpFetch } from '../emby/http';

const KEY = 'wemby-tmdb';

export interface TmdbConfig {
  apiKey: string;
  /** 形如 http://127.0.0.1:7890；留空 = 直连 */
  proxy: string;
  apiBase: string;
  imgBase: string;
}

const DEFAULTS: TmdbConfig = { apiKey: '', proxy: '', apiBase: 'https://api.themoviedb.org/3', imgBase: 'https://image.tmdb.org' };

export function loadTmdb(): TmdbConfig {
  try {
    const c = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<TmdbConfig>) };
    return { ...c, apiBase: c.apiBase || DEFAULTS.apiBase, imgBase: c.imgBase || DEFAULTS.imgBase };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveTmdb(c: TmdbConfig): void {
  let proxy = c.proxy.trim();
  if (proxy && !/^[a-z]+:\/\//i.test(proxy)) proxy = `http://${proxy}`;
  const clean = (u: string, d: string): string => (u.trim().replace(/\/+$/, '') || d);
  try {
    localStorage.setItem(KEY, JSON.stringify({ apiKey: c.apiKey.trim(), proxy, apiBase: clean(c.apiBase, DEFAULTS.apiBase), imgBase: clean(c.imgBase, DEFAULTS.imgBase) }));
  } catch {
    /* ignore */
  }
  imgCache.clear();
  idxCache = null;
}

export const tmdbReady = (): boolean => !!loadTmdb().apiKey;

async function tmdb<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const c = loadTmdb();
  if (!c.apiKey) throw new Error('还没有填 TMDB API Key（设置 → TMDB）');
  const u = new URLSearchParams({ language: 'zh-CN' });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.set(k, String(v));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (c.apiKey.length > 40) headers.Authorization = `Bearer ${c.apiKey}`; // v4 令牌
  else u.set('api_key', c.apiKey);
  let res: Response;
  try {
    res = await httpFetch(`${c.apiBase}${path}?${u.toString()}`, { headers }, { proxy: c.proxy });
  } catch (e) {
    throw new Error(`连不上 TMDB：${e instanceof Error ? e.message : String(e)}（国内访问需要设置代理，或换 API 域名）`);
  }
  if (res.status === 401) throw new Error('TMDB API Key 无效');
  if (!res.ok) throw new Error(`TMDB 请求失败 ${res.status}`);
  return (await res.json()) as T;
}

// ───────── 图片：同样走代理，带并发限制，转 blob 显示 ─────────
const imgCache = new Map<string, Promise<string>>();
let active = 0;
const waiting: (() => void)[] = [];
const MAX = 6;
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

export function tmdbImage(path: string, size = 'w342'): Promise<string> {
  const c = loadTmdb();
  const url = `${c.imgBase}/t/p/${size}${path}`;
  let p = imgCache.get(url);
  if (!p) {
    p = slot(async () => {
      const r = await httpFetch(url, undefined, { proxy: c.proxy });
      if (!r.ok) throw new Error(String(r.status));
      return URL.createObjectURL(await r.blob());
    }).catch((e) => {
      imgCache.delete(url);
      throw e;
    });
    imgCache.set(url, p);
  }
  return p;
}

// ───────── 数据 ─────────
export interface TmdbItem {
  id: number;
  media: 'movie' | 'tv';
  title: string;
  year: string;
  rating: number;
  poster: string;
  backdrop: string;
  overview: string;
  date: string;
  pop: number;
}

interface RawItem {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  popularity?: number;
  vote_count?: number;
}

function norm(x: RawItem, forced?: 'movie' | 'tv'): TmdbItem | null {
  const media = (x.media_type as string) === 'movie' || (x.media_type as string) === 'tv' ? (x.media_type as 'movie' | 'tv') : forced;
  if (!media) return null;
  return {
    id: x.id,
    media,
    title: x.title || x.name || '',
    year: (x.release_date || x.first_air_date || '').slice(0, 4),
    rating: Math.round((x.vote_average || 0) * 10) / 10,
    poster: x.poster_path || '',
    backdrop: x.backdrop_path || '',
    overview: x.overview || '',
    date: x.release_date || x.first_air_date || '',
    pop: x.popularity || 0,
  };
}

export interface Page { items: TmdbItem[]; pages: number }

async function list(path: string, forced: 'movie' | 'tv' | undefined, params: Record<string, string | number | undefined>, page: number): Promise<Page> {
  const d = await tmdb<{ results: RawItem[]; total_pages: number }>(path, { ...params, page });
  return { items: d.results.map((x) => norm(x, forced)).filter((x): x is TmdbItem => !!x && !!x.poster), pages: Math.min(d.total_pages || 1, 500) };
}

export type SortId = 'default' | 'date' | 'pop' | 'rating';

/** 榜单行：load(page, sort)。server = true 的行由 TMDB 服务端按 sort 排序（整库有序）；否则前端只排每一页内部 */
export interface RowDef { id: string; title: string; server?: boolean; load: (page: number, sort?: SortId) => Promise<Page> }

const today = (): string => new Date().toISOString().slice(0, 10);

/** 发现接口的排序参数（date 只取已上映 / 已播出的，rating 要求有足够票数避免冷门高分） */
function sortParams(kind: 'movie' | 'tv', sort: SortId = 'default'): Record<string, string | number> {
  const f = kind === 'movie' ? 'primary_release_date' : 'first_air_date';
  if (sort === 'date') return { sort_by: `${f}.desc`, [`${f}.lte`]: today() };
  if (sort === 'rating') return { sort_by: 'vote_average.desc', 'vote_count.gte': 200 };
  return { sort_by: 'popularity.desc' };
}

const tvD = (p: Record<string, string>) => (page: number, sort?: SortId) => list('/discover/tv', 'tv', { 'vote_count.gte': 20, ...p, ...sortParams('tv', sort) }, page);
const mvD = (p: Record<string, string>) => (page: number, sort?: SortId) => list('/discover/movie', 'movie', { 'vote_count.gte': 20, ...p, ...sortParams('movie', sort) }, page);

const R = {
  trending: { id: 'trending', title: '流行趋势', load: (p: number) => list('/trending/all/week', undefined, {}, p) },
  nowPlaying: { id: 'now', title: '正在热映', load: (p: number) => list('/movie/now_playing', 'movie', { region: 'CN' }, p) },
  upcoming: { id: 'upcoming', title: '即将上映', load: (p: number) => list('/movie/upcoming', 'movie', { region: 'CN' }, p) },
  popMovie: { id: 'popm', title: '热门电影', load: (p: number) => list('/movie/popular', 'movie', {}, p) },
  topMovie: { id: 'topm', title: '高分电影', load: (p: number) => list('/movie/top_rated', 'movie', {}, p) },
  cnMovie: { id: 'cnm', title: '华语电影', server: true, load: mvD({ with_original_language: 'zh|cn' }) },
  asiaMovie: { id: 'asm', title: '日韩电影', server: true, load: mvD({ with_original_language: 'ja|ko' }) },
  westMovie: { id: 'wsm', title: '欧美电影', server: true, load: mvD({ with_original_language: 'en|fr|de|es|it' }) },
  popTv: { id: 'poptv', title: '热门电视剧', load: (p: number) => list('/tv/popular', 'tv', {}, p) },
  airing: { id: 'air', title: '正在播出', load: (p: number) => list('/tv/on_the_air', 'tv', {}, p) },
  topTv: { id: 'toptv', title: '高分剧集', load: (p: number) => list('/tv/top_rated', 'tv', {}, p) },
  cnTv: { id: 'cntv', title: '国产剧', server: true, load: tvD({ with_origin_country: 'CN', without_genres: '16,10764,10767' }) },
  asiaTv: { id: 'astv', title: '日韩剧', server: true, load: tvD({ with_origin_country: 'JP|KR', without_genres: '16,10764,10767' }) },
  westTv: { id: 'wstv', title: '欧美剧', server: true, load: tvD({ with_origin_country: 'US|GB|FR|DE|ES|IT', without_genres: '16,10764,10767' }) },
  anime: { id: 'anime', title: '日本动漫', server: true, load: tvD({ with_genres: '16', with_origin_country: 'JP' }) },
  cnAnime: { id: 'cnanime', title: '国产动漫', server: true, load: tvD({ with_genres: '16', with_origin_country: 'CN' }) },
  animeMovie: { id: 'animem', title: '动画电影', server: true, load: mvD({ with_genres: '16' }) },
  variety: { id: 'variety', title: '综艺', server: true, load: tvD({ with_genres: '10764|10767' }) },
  docu: { id: 'docu', title: '纪录片', server: true, load: tvD({ with_genres: '99' }) },
};

export const TABS: { id: string; label: string; rows: RowDef[] }[] = [
  { id: 'rec', label: '推荐', rows: [R.trending, R.nowPlaying, R.popMovie, R.popTv, R.cnTv, R.asiaTv, R.westTv, R.anime] },
  { id: 'movie', label: '电影', rows: [R.nowPlaying, R.upcoming, R.popMovie, R.topMovie, R.cnMovie, R.asiaMovie, R.westMovie] },
  { id: 'tv', label: '电视剧', rows: [R.airing, R.popTv, R.topTv, R.cnTv, R.asiaTv, R.westTv, R.docu] },
  { id: 'anime', label: '动漫 / 综艺', rows: [R.anime, R.cnAnime, R.animeMovie, R.variety] },
];

export const findRow = (id: string): RowDef | undefined => TABS.flatMap((t) => t.rows).find((r) => r.id === id);

export async function tmdbSearch(q: string, page = 1): Promise<Page> {
  return list('/search/multi', undefined, { query: q, include_adult: 'false' }, page);
}

export interface TmdbDetail extends TmdbItem {
  tagline: string;
  genres: string[];
  runtime: number;
  seasons: { season_number: number; name: string; episode_count: number }[];
  status: string;
  cast: { id: number; name: string; character: string; profile: string }[];
  similar: TmdbItem[];
}

export async function tmdbDetail(media: 'movie' | 'tv', id: number): Promise<TmdbDetail> {
  const d = await tmdb<
    RawItem & {
      tagline?: string;
      genres?: { name: string }[];
      runtime?: number;
      episode_run_time?: number[];
      seasons?: { season_number: number; name: string; episode_count: number }[];
      status?: string;
      credits?: { cast?: { id: number; name: string; character?: string; profile_path?: string | null }[] };
      recommendations?: { results: RawItem[] };
    }
  >(`/${media}/${id}`, { append_to_response: 'credits,recommendations' });
  const base = norm({ ...d, media_type: media }, media)!;
  return {
    ...base,
    tagline: d.tagline || '',
    genres: (d.genres || []).map((g) => g.name),
    runtime: d.runtime || d.episode_run_time?.[0] || 0,
    seasons: (d.seasons || []).filter((s) => s.season_number > 0),
    status: d.status || '',
    cast: (d.credits?.cast || []).slice(0, 18).map((c) => ({ id: c.id, name: c.name, character: c.character || '', profile: c.profile_path || '' })),
    similar: (d.recommendations?.results || []).map((x) => norm(x, media)).filter((x): x is TmdbItem => !!x && !!x.poster).slice(0, 18),
  };
}

// ───────── 本地 Emby 里已有哪些（按 TMDB 编号） ─────────
let idxCache: { at: number; ids: Set<string> } | null = null;
export async function embyTmdbIndex(load: () => Promise<Set<string>>): Promise<Set<string>> {
  if (idxCache && Date.now() - idxCache.at < 300000) return idxCache.ids;
  const ids = await load().catch(() => new Set<string>());
  idxCache = { at: Date.now(), ids };
  return ids;
}
