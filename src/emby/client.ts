// Emby REST 客户端：登录 / 媒体库 / 列表 / 详情 / 播放信息 / 进度回报 / 收藏
import { httpFetch } from './http';
import { deviceId, getSession, normalizeServer } from './session';
import type { EmbyItem, ItemsResult, PlaybackInfo, Session } from './types';

const CLIENT = 'Win-Emby';
const VERSION = '0.1.0';

function authHeader(token?: string): Record<string, string> {
  const v = `MediaBrowser Client="${CLIENT}", Device="Windows", DeviceId="${deviceId()}", Version="${VERSION}"`;
  const h: Record<string, string> = { 'X-Emby-Authorization': v, Accept: 'application/json' };
  if (token) h['X-Emby-Token'] = token;
  return h;
}

function need(): Session {
  const s = getSession();
  if (!s) throw new Error('未登录');
  return s;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

async function call<T>(
  server: string,
  token: string | undefined,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
  body?: unknown,
): Promise<T> {
  const url = `${server}/emby${path}${qs(query || {})}`;
  const headers = authHeader(token);
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await httpFetch(url, { method, headers, body: payload });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const t = await res.text();
      if (t) msg += ` ${t.slice(0, 120)}`;
    } catch {
      /* ignore */
    }
    const err = new Error(`Emby 请求失败 ${method} ${path}：${msg}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** 已登录请求 */
function api<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
  body?: unknown,
): Promise<T> {
  const s = need();
  return call<T>(s.server, s.token, method, path, query, body);
}

/** 列表默认请求的字段（卡片 + 详情都够用） */
const LIST_FIELDS = 'PrimaryImageAspectRatio,ProductionYear,Overview,CommunityRating,RunTimeTicks,UserData';

export interface ListOpts {
  parentId?: string;
  types?: string;
  sortBy?: string;
  sortOrder?: 'Ascending' | 'Descending';
  start?: number;
  limit?: number;
  filters?: string;
  search?: string;
  genres?: string;
  recursive?: boolean;
  extraFields?: string;
  /** 按外部编号找，如 tmdb.12345 */
  providerId?: string;
}

export const emby = {
  /** 登录：成功返回会话（调用方负责 saveSession） */
  async login(serverInput: string, username: string, password: string): Promise<Session> {
    const server = normalizeServer(serverInput);
    if (!server) throw new Error('请填写服务器地址');
    const r = await call<{ AccessToken: string; User: { Id: string; Name: string } }>(
      server,
      undefined,
      'POST',
      '/Users/AuthenticateByName',
      undefined,
      { Username: username, Pw: password },
    );
    const info = await call<{ ServerName?: string }>(server, undefined, 'GET', '/System/Info/Public').catch(() => ({} as { ServerName?: string }));
    return { server, userId: r.User.Id, userName: r.User.Name, serverName: info.ServerName, token: r.AccessToken, deviceId: deviceId() };
  },

  /** 仅探测服务器是否可达（登录前给出更友好的报错） */
  async ping(serverInput: string): Promise<{ ServerName?: string; Version?: string }> {
    const server = normalizeServer(serverInput);
    return call(server, undefined, 'GET', '/System/Info/Public');
  },

  /** 媒体库（电影 / 剧集 / 混合…） */
  async views(): Promise<EmbyItem[]> {
    const s = need();
    const r = await api<ItemsResult>('GET', `/Users/${s.userId}/Views`);
    return r.Items || [];
  },

  async items(o: ListOpts): Promise<ItemsResult> {
    const s = need();
    return api<ItemsResult>('GET', `/Users/${s.userId}/Items`, {
      ParentId: o.parentId,
      IncludeItemTypes: o.types,
      Recursive: o.recursive ?? true,
      SortBy: o.sortBy ?? 'SortName',
      SortOrder: o.sortOrder ?? 'Ascending',
      StartIndex: o.start ?? 0,
      Limit: o.limit ?? 60,
      Filters: o.filters,
      SearchTerm: o.search,
      AnyProviderIdEquals: o.providerId,
      Genres: o.genres,
      Fields: o.extraFields ? `${LIST_FIELDS},${o.extraFields}` : LIST_FIELDS,
      ImageTypeLimit: 1,
      EnableImageTypes: 'Primary,Backdrop,Thumb',
    });
  },

  /** 继续观看 */
  async resume(limit = 24): Promise<EmbyItem[]> {
    const s = need();
    const r = await api<ItemsResult>('GET', `/Users/${s.userId}/Items/Resume`, {
      Limit: limit,
      Recursive: true,
      Fields: LIST_FIELDS,
      MediaTypes: 'Video',
      ImageTypeLimit: 1,
      EnableImageTypes: 'Primary,Backdrop,Thumb',
    });
    return r.Items || [];
  },

  /** 剧集「下一集」 */
  async nextUp(limit = 24): Promise<EmbyItem[]> {
    const s = need();
    const r = await api<ItemsResult>('GET', '/Shows/NextUp', {
      UserId: s.userId,
      Limit: limit,
      Fields: LIST_FIELDS,
      ImageTypeLimit: 1,
      EnableImageTypes: 'Primary,Backdrop,Thumb',
    });
    return r.Items || [];
  },

  /** 某媒体库的最新入库 */
  async latest(parentId: string, limit = 24): Promise<EmbyItem[]> {
    const s = need();
    return api<EmbyItem[]>('GET', `/Users/${s.userId}/Items/Latest`, {
      ParentId: parentId,
      Limit: limit,
      Fields: LIST_FIELDS,
      ImageTypeLimit: 1,
      EnableImageTypes: 'Primary,Backdrop,Thumb',
    });
  },

  async item(id: string): Promise<EmbyItem> {
    const s = need();
    return api<EmbyItem>('GET', `/Users/${s.userId}/Items/${id}`, {
      Fields: 'Overview,People,Genres,Studios,Taglines,MediaSources,MediaStreams,ProviderIds,Chapters,Path',
    });
  },

  /** 库里所有电影 / 剧集的 TMDB 编号，形如 movie:123、tv:456（用来标「已入库」） */
  async tmdbIndex(): Promise<Set<string>> {
    const s = need();
    const out = new Set<string>();
    for (const [type, tag] of [['Movie', 'movie'], ['Series', 'tv']] as const) {
      const r = await api<ItemsResult & { Items: { ProviderIds?: Record<string, string> }[] }>('GET', `/Users/${s.userId}/Items`, {
        IncludeItemTypes: type, Recursive: true, Fields: 'ProviderIds', EnableImages: false, EnableUserData: false, Limit: 20000,
      });
      for (const it of r.Items as { ProviderIds?: Record<string, string> }[]) {
        const id = it.ProviderIds?.Tmdb || it.ProviderIds?.tmdb;
        if (id) out.add(`${tag}:${id}`);
      }
    }
    return out;
  },

  async seasons(seriesId: string): Promise<EmbyItem[]> {
    const s = need();
    const r = await api<ItemsResult>('GET', `/Shows/${seriesId}/Seasons`, {
      UserId: s.userId,
      Fields: 'Overview,UserData',
    });
    return r.Items || [];
  },

  async episodes(seriesId: string, seasonId?: string): Promise<EmbyItem[]> {
    const s = need();
    const r = await api<ItemsResult>('GET', `/Shows/${seriesId}/Episodes`, {
      UserId: s.userId,
      SeasonId: seasonId,
      Fields: 'Overview,UserData,RunTimeTicks,MediaSources',
      ImageTypeLimit: 1,
      EnableImageTypes: 'Primary',
    });
    return r.Items || [];
  },

  async similar(id: string, limit = 12): Promise<EmbyItem[]> {
    const s = need();
    const r = await api<ItemsResult>('GET', `/Items/${id}/Similar`, {
      UserId: s.userId,
      Limit: limit,
      Fields: LIST_FIELDS,
    });
    return r.Items || [];
  },

  async genres(parentId: string): Promise<string[]> {
    const s = need();
    const r = await api<ItemsResult>('GET', '/Genres', { UserId: s.userId, ParentId: parentId, SortBy: 'SortName' });
    return (r.Items || []).map((g) => g.Name);
  },

  async setFavorite(id: string, on: boolean): Promise<void> {
    const s = need();
    await api(on ? 'POST' : 'DELETE', `/Users/${s.userId}/FavoriteItems/${id}`);
  },

  async setPlayed(id: string, on: boolean): Promise<void> {
    const s = need();
    await api(on ? 'POST' : 'DELETE', `/Users/${s.userId}/PlayedItems/${id}`);
  },

  /** 把影片从「继续观看」里移除（进度清零，不改已看状态） */
  async clearResume(id: string): Promise<void> {
    const s = need();
    await api('POST', `/Users/${s.userId}/Items/${id}/UserData`, undefined, { PlaybackPositionTicks: 0 });
  },

  /** 向服务器请求播放决策（直连 / 转封装 / 转码），由 DeviceProfile 决定 */
  async playbackInfo(
    id: string,
    opts: {
      deviceProfile: unknown;
      maxBitrate?: number;
      mediaSourceId?: string;
      audioIndex?: number;
      subtitleIndex?: number;
    },
  ): Promise<PlaybackInfo> {
    const s = need();
    return api<PlaybackInfo>(
      'POST',
      `/Items/${id}/PlaybackInfo`,
      {
        UserId: s.userId,
        IsPlayback: true,
        AutoOpenLiveStream: true,
        MaxStreamingBitrate: opts.maxBitrate,
        MediaSourceId: opts.mediaSourceId,
        AudioStreamIndex: opts.audioIndex,
        SubtitleStreamIndex: opts.subtitleIndex,
      },
      { DeviceProfile: opts.deviceProfile },
    );
  },

  reportStart(b: PlayReport): Promise<void> {
    return api('POST', '/Sessions/Playing', undefined, toReport(b)).catch(() => undefined) as Promise<void>;
  },
  reportProgress(b: PlayReport): Promise<void> {
    return api('POST', '/Sessions/Playing/Progress', undefined, toReport(b)).catch(() => undefined) as Promise<void>;
  },
  reportStop(b: PlayReport): Promise<void> {
    return api('POST', '/Sessions/Playing/Stopped', undefined, toReport(b)).catch(() => undefined) as Promise<void>;
  },
};

export interface PlayReport {
  itemId: string;
  mediaSourceId: string;
  playSessionId?: string;
  positionSec: number;
  paused?: boolean;
  method: 'DirectPlay' | 'DirectStream' | 'Transcode';
  audioIndex?: number;
  subtitleIndex?: number;
}

function toReport(b: PlayReport): Record<string, unknown> {
  return {
    ItemId: b.itemId,
    MediaSourceId: b.mediaSourceId,
    PlaySessionId: b.playSessionId,
    PositionTicks: Math.max(0, Math.floor(b.positionSec * 1e7)),
    IsPaused: !!b.paused,
    CanSeek: true,
    PlayMethod: b.method,
    AudioStreamIndex: b.audioIndex,
    SubtitleStreamIndex: b.subtitleIndex,
  };
}

// ───────────────────────── URL 工具（图片 / 视频流） ─────────────────────────

function withAuth(path: string, extra: Record<string, string | number | undefined> = {}): string {
  const s = need();
  return `${s.server}/emby${path}${qs({ ...extra, api_key: s.token })}`;
}

/** 把 Emby 返回的相对地址（/videos/... 或 /emby/videos/...）补成完整 URL */
export function absUrl(rel: string): string {
  const s = need();
  if (/^https?:\/\//i.test(rel)) return rel;
  const p = rel.startsWith('/emby/') ? rel : `/emby${rel.startsWith('/') ? '' : '/'}${rel}`;
  return `${s.server}${p}`;
}

export function posterUrl(it: EmbyItem, width = 360): string {
  if (!getSession()) return '';
  const tag = it.ImageTags?.Primary;
  if (tag) return withAuth(`/Items/${it.Id}/Images/Primary`, { maxWidth: width, quality: 90, tag });
  // 单集没有竖版海报 → 用剧集海报
  if (it.SeriesId && it.SeriesPrimaryImageTag) {
    return withAuth(`/Items/${it.SeriesId}/Images/Primary`, { maxWidth: width, quality: 90, tag: it.SeriesPrimaryImageTag });
  }
  return '';
}

/** 横版缩略图（单集剧照 / Thumb），没有则退回背景图 */
export function thumbUrl(it: EmbyItem, width = 480): string {
  if (!getSession()) return '';
  const t = it.ImageTags?.Primary;
  if (it.Type === 'Episode' && t) return withAuth(`/Items/${it.Id}/Images/Primary`, { maxWidth: width, quality: 85, tag: t });
  if (it.ImageTags?.Thumb) return withAuth(`/Items/${it.Id}/Images/Thumb`, { maxWidth: width, quality: 85, tag: it.ImageTags.Thumb });
  return backdropUrl(it, width) || posterUrl(it, width);
}

export function backdropUrl(it: EmbyItem, width = 1600): string {
  if (!getSession()) return '';
  const own = it.BackdropImageTags?.[0];
  if (own) return withAuth(`/Items/${it.Id}/Images/Backdrop/0`, { maxWidth: width, quality: 85, tag: own });
  const pt = it.ParentBackdropImageTags?.[0];
  if (it.ParentBackdropItemId && pt) {
    return withAuth(`/Items/${it.ParentBackdropItemId}/Images/Backdrop/0`, { maxWidth: width, quality: 85, tag: pt });
  }
  return '';
}

/** 片名 Logo（有的话用来代替文字标题） */
export function logoUrl(it: EmbyItem, width = 600): string {
  if (!getSession()) return '';
  const tag = it.ImageTags?.Logo;
  return tag ? withAuth(`/Items/${it.Id}/Images/Logo`, { maxWidth: width, quality: 90, tag }) : '';
}

export function personUrl(p: { Id: string; PrimaryImageTag?: string }, width = 200): string {
  if (!getSession() || !p.PrimaryImageTag) return '';
  return withAuth(`/Items/${p.Id}/Images/Primary`, { maxWidth: width, quality: 85, tag: p.PrimaryImageTag });
}

/** 直连播放地址（原文件，不转码） */
export function directStreamUrl(itemId: string, source: { Id: string; Container?: string }, playSessionId?: string): string {
  return withAuth(`/Videos/${itemId}/stream${source.Container ? `.${source.Container.split(',')[0]}` : ''}`, {
    Static: 'true',
    MediaSourceId: source.Id,
    PlaySessionId: playSessionId,
  });
}

/** 文本字幕（WebVTT） */
export function subtitleUrl(itemId: string, mediaSourceId: string, index: number, ext = 'vtt'): string {
  return withAuth(`/Videos/${itemId}/${mediaSourceId}/Subtitles/${index}/Stream.${ext}`);
}
