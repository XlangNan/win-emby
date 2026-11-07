// 飞牛影视（fnOS 影视）适配层：把飞牛私有接口翻译成织影内部使用的 Emby 数据形态，
// 这样首页 / 媒体库 / 详情 / 播放器等页面不用改。
// 接口与签名来自社区逆向（fnos-emby-bridge / fntv_danmu_all），飞牛升级后可能变化。
import { md5, sha256 } from '../lib/hash';
import { httpFetch } from './http';
import { getSession } from './session';
import type { Chapter, EmbyItem, ItemsResult, MediaSource, MediaStream, PlaybackInfo, Session } from './types';

const API_KEY = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh';
const API_SECRET = '16CCEB3D-AB42-077D-36A1-F355324E4237';
const FN_UA = '1.12.0 (com.trim.media; build:1120009; Android 16) Flutter/3.11.5';
const DEVICE_IP = '16a9d43e38a5f992b3f1c44d68940523';

export const isFnos = (): boolean => getSession()?.kind === 'fnos';

export function normalizeFnServer(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, '');
  try {
    const u = new URL(s);
    if (!u.port && u.protocol === 'http:') u.port = '8056';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return s;
  }
}

// ───────── 签名 / 请求 ─────────
function authx(path: string, signData: string): string {
  const nonce = String(Math.floor(Math.random() * 900000) + 100000);
  const ts = Date.now();
  const sign = md5([API_KEY, path, nonce, String(ts), md5(signData), API_SECRET].join('_'));
  return `nonce=${nonce}&timestamp=${ts}&sign=${sign}`;
}

function querySign(q?: Record<string, string | number | undefined>): string {
  if (!q) return '';
  return Object.keys(q).filter((k) => q[k] !== undefined && q[k] !== '').sort().map((k) => `${k}=${q[k]}`).join('&');
}

function headers(server: { token?: string }, path: string, signData: string, json: boolean): Record<string, string> {
  const h: Record<string, string> = { Authx: authx(path, signData), Accept: 'application/json' };
  if (json) h['Content-Type'] = 'application/json';
  if (server.token) {
    h.Authorization = server.token;
    h.Cookie = `Trim-MC-token=${server.token}; mode=relay`;
  } else h.Cookie = 'mode=relay';
  return h;
}

interface FnResult<T> { code: number; msg?: string; data: T }

async function fcall<T>(
  base: { server: string; token?: string },
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  query?: Record<string, string | number | undefined>,
  body?: unknown,
): Promise<T> {
  const bodyStr = body !== undefined ? JSON.stringify(body) : '';
  const qs = querySign(query);
  const h = headers(base, path, qs || bodyStr, body !== undefined);
  const url = `${base.server}${path}${qs ? `?${qs.split('&').map((p) => { const i = p.indexOf('='); return `${p.slice(0, i)}=${encodeURIComponent(p.slice(i + 1))}`; }).join('&')}` : ''}`;
  const res = await httpFetch(url, { method, headers: h, body: body !== undefined ? bodyStr : undefined });
  const text = await res.text();
  let j: FnResult<T>;
  try { j = JSON.parse(text) as FnResult<T>; } catch { throw new Error(`飞牛返回了无法识别的内容（${res.status}）`); }
  if (j.code !== 0) {
    const err = new Error(j.code === 5000 ? '飞牛接口签名被拒绝（可能是飞牛影视版本太新）' : j.msg || `飞牛请求失败 ${j.code}`) as Error & { status?: number };
    if (j.code === 401 || /token|登录|auth/i.test(j.msg || '')) err.status = 401;
    throw err;
  }
  return j.data;
}

function sess(): Session {
  const s = getSession();
  if (!s) throw new Error('未登录');
  return s;
}
const f = <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, query?: Record<string, string | number | undefined>, body?: unknown): Promise<T> =>
  fcall<T>(sess(), method, `/v/api/v1/${path}`, query, body);

// ───────── 数据转换 ─────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = Record<string, any>;
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]).filter(Boolean) : typeof v === 'string' && v ? [v] : []);
const nz = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const seriesOfSeason = new Map<string, string>();

export function toItem(x: Fn, ctx: { seriesId?: string; seriesName?: string } = {}): EmbyItem {
  const t = String(x.type || '');
  const type = t === 'TV' ? 'Series' : t === 'Video' ? 'Movie' : t === 'MediaDB' ? 'CollectionFolder' : t === 'Directory' ? 'Folder' : t || 'Movie';
  const isEp = type === 'Episode';
  const isSeason = type === 'Season';
  const id = String(x.item_guid || x.guid || '');
  const played = !!(nz(x.watched) || nz(x.is_watched));
  const dur = nz(x.duration) || nz(x.runtime) * 60;
  const pos = played ? 0 : nz(x.ts) || nz(x.watched_ts);
  const rel = String(x.release_date || x.air_date || x.first_air_date || '');
  const poster = String(Array.isArray(x.poster) ? x.poster[0] : x.poster || arr(x.posters)[0] || arr(x.poster_list)[0] || '');
  const backs = arr(x.backdrops);
  const logo = arr(x.logos)[0];
  const seasonNo = nz(x.season_number);
  if (isSeason && x.parent_guid && ctx.seriesId) seriesOfSeason.set(id, ctx.seriesId);
  const it: EmbyItem = {
    Id: id,
    Name: isEp || isSeason ? String(x.title || '') : String(x.title || x.tv_title || ''),
    Type: type,
    CollectionType: type === 'CollectionFolder' ? (x.category === 'TV' ? 'tvshows' : x.category === 'Movie' ? 'movies' : 'homevideos') : undefined,
    Overview: x.overview ? String(x.overview) : undefined,
    OriginalTitle: x.original_title ? String(x.original_title) : undefined,
    PremiereDate: rel ? `${rel.slice(0, 10)}T00:00:00.0000000Z` : undefined,
    ProductionYear: rel ? Number(rel.slice(0, 4)) || undefined : undefined,
    CommunityRating: nz(x.vote_average) || undefined,
    RunTimeTicks: dur > 0 ? dur * 1e7 : undefined,
    ImageTags: { ...(poster ? { Primary: poster } : {}), ...(logo ? { Logo: logo } : {}) },
    BackdropImageTags: backs,
    ProviderIds: x.imdb_id ? { Imdb: String(x.imdb_id) } : {},
    UserData: {
      Played: played,
      IsFavorite: !!nz(x.is_favorite),
      PlaybackPositionTicks: pos > 0 ? pos * 1e7 : 0,
      PlayedPercentage: dur > 0 && pos > 0 ? Math.min(100, (pos / dur) * 100) : undefined,
      UnplayedItemCount: type === 'Series' && nz(x.local_number_of_episodes) ? undefined : undefined,
    },
  };
  if (isEp) {
    const sid = ctx.seriesId || seriesOfSeason.get(String(x.parent_guid || ''));
    it.SeriesId = sid;
    it.SeriesName = ctx.seriesName || String(x.tv_title || '');
    it.SeasonId = x.parent_guid ? String(x.parent_guid) : undefined;
    it.SeasonName = x.parent_title ? String(x.parent_title) : undefined;
    it.IndexNumber = nz(x.episode_number) || undefined;
    it.ParentIndexNumber = seasonNo || 1;
  } else if (isSeason) {
    it.IndexNumber = seasonNo || undefined;
    it.SeriesId = x.parent_guid ? String(x.parent_guid) : ctx.seriesId;
    it.ChildCount = nz(x.local_number_of_episodes) || undefined;
  } else if (type === 'Series') {
    it.ChildCount = nz(x.local_number_of_seasons) || undefined;
    it.RecursiveItemCount = nz(x.local_number_of_episodes) || undefined;
  }
  return it;
}

const CONTAINER_TYPES = ['Movie', 'TV', 'Directory', 'Video'];

async function listPage(body: Fn): Promise<{ list: Fn[]; total: number }> {
  const r = await f<{ list: Fn[] | null; total?: number; total_count?: number }>('POST', 'item/list', undefined, { exclude_grouped_video: 1, sort_type: 'DESC', sort_column: 'create_time', ...body });
  return { list: r.list || [], total: r.total ?? r.total_count ?? 0 };
}

// 整库缓存：飞牛的排序 / 筛选能力有限，所以整库取回来在本地排序筛选
const libCache = new Map<string, { at: number; items: EmbyItem[] }>();
async function libAll(guid: string): Promise<EmbyItem[]> {
  const hit = libCache.get(guid);
  if (hit && Date.now() - hit.at < 2 * 60 * 1000) return hit.items;
  const out: EmbyItem[] = [];
  for (let page = 1; page <= 60; page++) {
    const { list, total } = await listPage({ ancestor_guid: guid, tags: { type: CONTAINER_TYPES }, page, page_size: 200 });
    out.push(...list.map((x) => toItem(x)));
    if (!list.length || out.length >= total) break;
  }
  libCache.set(guid, { at: Date.now(), items: out });
  return out;
}
export function clearFnCache(): void { libCache.clear(); }

const typeMatch = (types: string | undefined, it: EmbyItem): boolean => {
  if (!types) return true;
  const set = types.split(',');
  return set.includes(it.Type) || (set.includes('Movie') && it.Type === 'Movie');
};

function sortItems(list: EmbyItem[], sortBy: string, order: string): EmbyItem[] {
  const dir = order === 'Descending' ? -1 : 1;
  const key = sortBy.split(',')[0];
  const val = (it: EmbyItem): number | string => {
    switch (key) {
      case 'DateCreated': return 0;
      case 'PremiereDate': return it.PremiereDate || '';
      case 'ProductionYear': return it.ProductionYear || 0;
      case 'CommunityRating': return it.CommunityRating || 0;
      case 'Runtime': return it.RunTimeTicks || 0;
      case 'DatePlayed': return 0;
      default: return (it.Name || '').toLowerCase();
    }
  };
  if (key === 'Random') return [...list].sort(() => Math.random() - 0.5);
  // DateCreated / DatePlayed：服务端原顺序就是入库时间倒序，保持稳定排序即可
  if (key === 'DateCreated' || key === 'DatePlayed') return dir === -1 ? list : [...list].reverse();
  return [...list].sort((a, b) => {
    const x = val(a), y = val(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

// ───────── 对外：与 emby 同名的方法 ─────────
export interface FnListOpts {
  parentId?: string; types?: string; sortBy?: string; sortOrder?: 'Ascending' | 'Descending';
  start?: number; limit?: number; filters?: string; search?: string; genres?: string; ids?: string; personIds?: string;
}

export const fn = {
  async login(serverInput: string, username: string, password: string): Promise<Session> {
    const server = normalizeFnServer(serverInput);
    if (!server) throw new Error('请填写服务器地址');
    const r = await fcall<{ token: string }>({ server }, 'POST', '/v/api/v2/user/loginByPassword', undefined, {
      app_name: 'trimemedia-web', username, password: sha256(password),
    });
    if (!r?.token) throw new Error('登录失败：没有拿到令牌');
    let name = '飞牛影视';
    try { name = (await fcall<{ name?: string }>({ server }, 'GET', '/v/api/v1/server/info')).name || name; } catch { /* ignore */ }
    return { server, userId: username, userName: username, serverName: name, token: r.token, deviceId: 'fnos', kind: 'fnos' };
  },

  async ping(serverInput: string): Promise<{ ServerName?: string; Version?: string }> {
    const server = normalizeFnServer(serverInput);
    const v = await fcall<{ version?: string }>({ server }, 'GET', '/v/api/v1/sys/version');
    return { Version: v?.version, ServerName: '飞牛影视' };
  },

  async views(): Promise<EmbyItem[]> {
    const l = await f<Fn[]>('GET', 'mediadb/list');
    return (l || []).filter((x) => x.category !== 'Live').map((x) => toItem({ ...x, type: 'MediaDB', poster: x.poster || x.posters }));
  },

  async items(o: FnListOpts): Promise<ItemsResult> {
    if (o.ids) {
      const r = await Promise.all(o.ids.split(',').filter(Boolean).map((id) => fn.item(id, true).catch(() => null)));
      const Items = r.filter((x): x is EmbyItem => !!x);
      return { Items, TotalRecordCount: Items.length };
    }
    if (o.personIds) {
      const r = await f<{ list: Fn[] | null; total: number }>('POST', 'person/item/list', undefined, { person_guid: o.personIds, page: 1, page_size: 100, sort_column: 'update_time', sort_type: 'desc', lan: 'zh-CN' });
      const Items = (r.list || []).map((x) => toItem(x));
      return { Items, TotalRecordCount: r.total || Items.length };
    }
    let all: EmbyItem[];
    if (/DatePlayed/.test(o.sortBy || '') && !o.parentId) {
      // 观看历史：用飞牛的播放记录（本身就是按最近播放排序）
      const l = (await f<Fn[]>('GET', 'play/list')) || [];
      const Items = l.map((x) => toItem(x));
      return { Items: Items.slice(o.start ?? 0, (o.start ?? 0) + (o.limit ?? 60)), TotalRecordCount: Items.length };
    }
    if (o.search) {
      const q = o.search.trim();
      let raw: Fn[] = [];
      try { raw = await f<Fn[]>('GET', 'search/list', { q }); } catch { raw = await f<Fn[]>('POST', 'search/list', undefined, { q }); }
      all = (raw || []).filter((x) => x.type !== 'Person').map((x) => toItem(x));
    } else if (o.parentId) {
      const par = o.parentId;
      // 剧 / 季下面要集：走 episodes
      if (/Episode/.test(o.types || '') && !/Series|Movie/.test(o.types || '')) all = await fn.episodes(par);
      else all = await libAll(par);
    } else {
      all = (await Promise.all((await fn.views()).map((v) => libAll(v.Id).catch(() => [] as EmbyItem[])))).flat();
    }
    all = all.filter((it) => typeMatch(o.types, it));
    const fl = (o.filters || '').split(',');
    if (fl.includes('IsFavorite')) all = all.filter((it) => it.UserData?.IsFavorite);
    if (fl.includes('IsUnplayed')) all = all.filter((it) => !it.UserData?.Played);
    if (fl.includes('IsPlayed')) all = all.filter((it) => it.UserData?.Played);
    const sorted = o.search ? all : sortItems(all, o.sortBy || 'SortName', o.sortOrder || 'Ascending');
    const start = o.start ?? 0;
    return { Items: sorted.slice(start, start + (o.limit ?? 60)), TotalRecordCount: sorted.length };
  },

  async resume(limit = 24): Promise<EmbyItem[]> {
    const l = (await f<Fn[]>('GET', 'play/list')) || [];
    const items = l.filter((x) => x.type === 'Episode' || x.type === 'Movie' || x.type === 'Video').map((x) => toItem(x));
    // 单集需要知道所属的剧：季 → 剧
    await Promise.all(items.filter((x) => x.Type === 'Episode' && !x.SeriesId && x.SeasonId).map(async (x) => {
      try {
        let sid = seriesOfSeason.get(x.SeasonId!);
        if (!sid) { sid = String((await f<Fn>('GET', `item/${x.SeasonId}`)).parent_guid || ''); if (sid) seriesOfSeason.set(x.SeasonId!, sid); }
        x.SeriesId = sid || undefined;
      } catch { /* ignore */ }
    }));
    return items.filter((x) => (x.UserData?.PlaybackPositionTicks || 0) > 0 && !x.UserData?.Played).slice(0, limit);
  },

  async nextUp(): Promise<EmbyItem[]> {
    return []; // 飞牛没有「下一集」接口
  },

  async latest(parentId: string, limit = 24): Promise<EmbyItem[]> {
    const { list } = await listPage({ ancestor_guid: parentId, tags: { type: CONTAINER_TYPES }, page: 1, page_size: limit });
    return list.map((x) => toItem(x));
  },

  async item(id: string, light = false): Promise<EmbyItem> {
    const d = await f<Fn>('GET', `item/${id}`);
    const it = toItem(d);
    if (it.Type === 'Season' && d.parent_guid) { it.SeriesId = String(d.parent_guid); seriesOfSeason.set(id, it.SeriesId); }
    if (it.Type === 'Episode' && d.parent_guid && !it.SeriesId) {
      try {
        let sid = seriesOfSeason.get(String(d.parent_guid));
        if (!sid) { sid = String((await f<Fn>('GET', `item/${d.parent_guid}`)).parent_guid || ''); if (sid) seriesOfSeason.set(String(d.parent_guid), sid); }
        it.SeriesId = sid || undefined;
      } catch { /* ignore */ }
    }
    if (light) return it;
    if (it.Type === 'Movie' || it.Type === 'Series' || it.Type === 'Episode') {
      try {
        const pl = await f<{ list: Fn[] | null }>('POST', `person/list/${id}`, undefined, { guid: id, page: 1, page_size: 60, lan: 'zh-CN' });
        it.People = (pl.list || []).map((p) => ({
          Id: String(p.person_guid), Name: String(p.name || p.original_name || ''), Role: p.role ? String(p.role) : undefined,
          Type: p.job === 'Director' || p.job === 'Writer' ? String(p.job) : 'Actor', PrimaryImageTag: p.profile_path ? String(p.profile_path) : undefined,
        }));
      } catch { /* 没有演员表就算了 */ }
    }
    if (it.Type === 'Movie' || it.Type === 'Episode') {
      try {
        const src = await mediaSources(id);
        it.MediaSources = src;
        it.MediaStreams = src[0]?.MediaStreams;
        const pi = await f<Fn>('POST', 'play/info', undefined, { item_guid: id });
        if (pi?.ts && !it.UserData?.Played) it.UserData = { ...it.UserData, PlaybackPositionTicks: nz(pi.ts) * 1e7 };
        if (pi?.item?.overview && !it.Overview) it.Overview = String(pi.item.overview);
        playInfoCache.set(id, { media_guid: String(pi?.media_guid || ''), video_guid: pi?.video_guid, audio_guid: pi?.audio_guid, subtitle_guid: pi?.subtitle_guid });
      } catch { /* 取不到媒体源，播放时会提示 */ }
    }
    it.Chapters = [] as Chapter[];
    return it;
  },

  async searchPersons(): Promise<EmbyItem[]> { return []; },

  async person(id: string): Promise<EmbyItem & { PremiereDate?: string }> {
    const p = await f<Fn>('GET', `person/${id}`);
    return { Id: id, Name: String(p.name || ''), Type: 'Person', Overview: p.biography ? String(p.biography) : undefined, ImageTags: p.profile ? { Primary: String(p.profile) } : {} };
  },

  async tmdbIndex(): Promise<Set<string>> { return new Set(); },

  async seasons(seriesId: string): Promise<EmbyItem[]> {
    const l = (await f<Fn[]>('GET', `season/list/${seriesId}`)) || [];
    return l.map((x) => toItem(x, { seriesId }));
  },

  async episodes(seriesId: string, seasonId?: string): Promise<EmbyItem[]> {
    const g = seasonId || seriesId;
    const l = (await f<Fn[]>('GET', `episode/list/${g}`, { guid: g, lan: 'zh-CN' })) || [];
    let sid = seriesId;
    if (seasonId) {
      // 传入的是季：剧 id 要从缓存或季详情里取
      sid = seriesOfSeason.get(seasonId) || seriesId;
    }
    return l.map((x) => toItem({ ...x, type: 'Episode' }, { seriesId: sid }));
  },

  async similar(): Promise<EmbyItem[]> { return []; },
  async genres(parentId: string): Promise<string[]> { void parentId; return []; },

  async setFavorite(id: string, on: boolean): Promise<void> {
    await f(on ? 'PUT' : 'DELETE', 'item/favorite', undefined, { item_guid: id, lan: 'zh-CN' });
  },

  async setPlayed(id: string, on: boolean): Promise<void> {
    await f(on ? 'POST' : 'DELETE', 'item/watched', undefined, { item_guid: id, lan: 'zh-CN' });
  },

  async clearResume(id: string): Promise<void> {
    try { await f('DELETE', 'play/record', undefined, { item_guid: id }); }
    catch { await f('POST', 'play/record', undefined, { item_guid: id, media_guid: playInfoCache.get(id)?.media_guid || '', ts: 0, duration: 0 }); }
  },

  async playbackInfo(id: string): Promise<PlaybackInfo> {
    const srcs = await mediaSources(id);
    const src = srcs[0];
    if (!src) throw new Error('这个条目没有可播放的媒体文件');
    const s = sess();
    const sr = await f<Fn>('POST', 'stream', undefined, { media_guid: src.Id, ip: DEVICE_IP, level: 1, header: { 'User-Agent': [FN_UA] } });
    const direct = (sr?.direct_link_qualities as Fn[] | undefined)?.[0];
    if (direct?.url) {
      const hs: string[] = [];
      const ua = arr(sr.header?.['User-Agent'])[0] || FN_UA;
      hs.push(`User-Agent: ${ua}`);
      const ck = arr(sr.header?.Cookie);
      if (ck.length) hs.push(`Cookie: ${ck.join('; ')}`);
      src.DirectStreamUrl = String(direct.url);
      src.HttpHeaders = hs;
    } else {
      const path = `/v/api/v1/media/range/${src.Id}`;
      src.DirectStreamUrl = `${s.server}${path}?direct_link_quality_index=1`;
      // 本地文件：飞牛要求每次请求带签名头
      src.HttpHeaders = [`Authx: ${authx(path, querySign({ direct_link_quality_index: 1 }))}`, `Authorization: ${s.token}`, `Cookie: Trim-MC-token=${s.token}; mode=relay`, `User-Agent: ${FN_UA}`];
    }
    src.SupportsDirectPlay = true;
    src.SupportsDirectStream = true;
    return { MediaSources: [src], PlaySessionId: id };
  },

  async report(itemId: string, mediaGuid: string, ts: number, duration: number): Promise<void> {
    await f('POST', 'play/record', undefined, { item_guid: itemId, media_guid: mediaGuid, ts: Math.floor(ts), duration: Math.floor(duration) }).catch(() => undefined);
  },
};

// ───────── 媒体源 ─────────
const playInfoCache = new Map<string, { media_guid: string; video_guid?: string; audio_guid?: string; subtitle_guid?: string }>();
const extSubGuid = new Map<string, string>();
const durOf = new Map<string, number>();
export const fnDuration = (mediaGuid: string): number => durOf.get(mediaGuid) || 0;
export const fnSubGuid = (mediaGuid: string, index: number): string | undefined => extSubGuid.get(`${mediaGuid}:${index}`);

async function mediaSources(id: string): Promise<MediaSource[]> {
  const sl = await f<Fn>('GET', `stream/list/${id}`);
  const files: Fn[] = sl?.files || [];
  if (!files.length) {
    const pi = await f<Fn>('POST', 'play/info', undefined, { item_guid: id });
    if (!pi?.media_guid) return [];
    files.push({ guid: pi.media_guid, file_name: '', size: 0 });
  }
  const v: Fn[] = sl?.video_streams || [], a: Fn[] = sl?.audio_streams || [], sb: Fn[] = sl?.subtitle_streams || [];
  return files.map((file) => {
    const mg = String(file.guid);
    const mine = (x: Fn): boolean => !x.media_guid || x.media_guid === mg;
    const streams: MediaStream[] = [];
    let idx = 0;
    v.filter(mine).forEach((x) => {
      const fr = parseFloat(String(x.r_frame_rate || ''));
      streams.push({ Index: idx++, Type: 'Video', Codec: x.codec_name, Width: x.width, Height: x.height, BitRate: nz(x.bps) || undefined, BitDepth: nz(x.bit_depth) || undefined, Profile: x.profile, VideoRange: x.color_range_type, VideoRangeType: x.color_range_type, RealFrameRate: fr || undefined, DisplayTitle: x.resolution_type });
    });
    a.filter(mine).forEach((x) => {
      streams.push({ Index: idx++, Type: 'Audio', Codec: x.codec_name, Language: x.language, Title: x.title, Channels: x.channels, ChannelLayout: x.channel_layout, IsDefault: !!nz(x.is_default), DisplayTitle: [x.title, x.language, x.codec_name].filter(Boolean).join(' · ') });
    });
    sb.filter(mine).forEach((x) => {
      const ext = !!nz(x.is_external);
      const i = idx++;
      if (ext && x.guid) extSubGuid.set(`${mg}:${i}`, String(x.guid));
      streams.push({ Index: i, Type: 'Subtitle', Codec: x.codec_name, Language: x.language, Title: x.title, IsExternal: ext, IsDefault: !!nz(x.is_default), IsTextSubtitleStream: !nz(x.is_bitmap), DisplayTitle: [x.title, x.language, x.codec_name].filter(Boolean).join(' · ') });
    });
    const name = String(file.file_name || '');
    const dur = nz(v[0]?.duration);
    if (dur > 0) durOf.set(mg, dur);
    return {
      Id: mg, Name: name, Container: name.includes('.') ? name.split('.').pop() : undefined, Size: nz(file.size) || undefined, Path: file.path,
      RunTimeTicks: dur > 0 ? dur * 1e7 : undefined, MediaStreams: streams, SupportsDirectPlay: true, SupportsDirectStream: true,
    } as MediaSource;
  });
}

/** 取外挂字幕文本（需要签名，mpv 自己取不了，所以由我们取回后以 memory:// 交给 mpv） */
export async function fnSubtitleText(subGuid: string): Promise<string> {
  const s = sess();
  const path = `/v/api/v1/subtitle/dl/${subGuid}`;
  const res = await httpFetch(`${s.server}${path}`, { headers: headers(s, path, '', false) });
  if (!res.ok) throw new Error(`字幕下载失败 ${res.status}`);
  return res.text();
}

/** 飞牛图片：需要带令牌取回，转成 blob 再显示 */
export async function fnImageBlob(path: string, w: number): Promise<Blob> {
  const s = sess();
  const p = `/v/api/v1/sys/img${path}`;
  const res = await httpFetch(`${s.server}${p}?w=${w}`, { headers: headers(s, p, querySign({ w }), false) });
  if (!res.ok) throw new Error(`图片 ${res.status}`);
  return res.blob();
}
