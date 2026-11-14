// Navidrome（Subsonic / OpenSubsonic API）客户端：专辑、艺术家、歌单、收藏、搜索、歌词、播放地址
import { httpFetch } from '../emby/http';
import { getCoverOverride } from './overrides';
import { md5 } from './md5';

export interface NdConfig { server: string; user: string; pass: string; proxy: string }
const KEY = 'wemby-navidrome';
const EMPTY: NdConfig = { server: '', user: '', pass: '', proxy: '' };

export function normalizeNdServer(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  s = s.replace(/\/+$/, '').replace(/\/rest$/i, '');
  try {
    const u = new URL(s);
    // 用原始输入判断是否写了端口：new URL('http://h:80').port 是空串（默认端口会被吞掉）
    const hasPort = /^https?:\/\/[^/?#]*:\d+(?:[/?#]|$)/i.test(s);
    if (!hasPort && !u.port && u.protocol === 'http:') u.port = '4533';
    return u.toString().replace(/\/+$/, '');
  } catch { return s; }
}

export function loadNd(): NdConfig {
  try { return { ...EMPTY, ...(JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<NdConfig>) }; } catch { return { ...EMPTY }; }
}
export function saveNd(c: NdConfig): void {
  let proxy = c.proxy.trim();
  if (proxy && !/^[a-z]+:\/\//i.test(proxy)) proxy = `http://${proxy}`;
  try { localStorage.setItem(KEY, JSON.stringify({ server: normalizeNdServer(c.server), user: c.user.trim(), pass: c.pass, proxy })); } catch { /* ignore */ }
  authCache = null;
  window.dispatchEvent(new Event('wemby-nd-changed'));
}
export const ndConfigured = (): boolean => { const c = loadNd(); return !!(c.server && c.user); };

// 登录参数：盐在一次运行内固定，这样封面 / 音频地址稳定，浏览器缓存才有效
let authCache: { key: string; qs: string } | null = null;
function authQs(c = loadNd()): string {
  const key = `${c.server}|${c.user}|${c.pass}`;
  if (authCache?.key === key) return authCache.qs;
  const salt = Math.random().toString(36).slice(2, 10);
  const qs = `u=${encodeURIComponent(c.user)}&t=${md5(c.pass + salt)}&s=${salt}&v=1.16.1&c=Weave`;
  authCache = { key, qs };
  return qs;
}

type Obj = Record<string, unknown>;
type Param = string | number | boolean | undefined | string[];
async function call<T = Obj>(endpoint: string, params: Record<string, Param> = {}, cfg = loadNd()): Promise<T> {
  if (!cfg.server || !cfg.user) throw new Error('还没有设置 Navidrome');
  const extra = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}=${encodeURIComponent(String(x))}`)).join('&');
  const url = `${cfg.server}/rest/${endpoint}.view?${authQs(cfg)}&f=json${extra ? `&${extra}` : ''}`;
  const res = await httpFetch(url, { headers: { Accept: 'application/json' } }, cfg.proxy ? { proxy: cfg.proxy } : undefined);
  if (!res.ok) throw new Error(`Navidrome 返回 ${res.status}`);
  const j = (await res.json()) as { 'subsonic-response'?: { status: string; error?: { code: number; message: string } } & Obj };
  const r = j['subsonic-response'];
  if (!r) throw new Error('不是有效的 Navidrome 地址');
  if (r.status !== 'ok') throw new Error(r.error?.code === 40 ? '用户名或密码不对' : r.error?.message || '请求失败');
  return r as unknown as T;
}

export interface Song {
  id: string; title: string; album: string; albumId: string; artist: string; artistId: string;
  track: number; discNumber: number; duration: number; coverArt: string; suffix: string;
  bitRate: number; samplingRate: number; bitDepth: number; year: number; starred: boolean; size: number;
}
export interface Album { id: string; name: string; artist: string; artistId: string; year: number; songCount: number; duration: number; coverArt: string; starred: boolean; genre: string }
export interface Artist { id: string; name: string; albumCount: number; coverArt: string; starred: boolean }
export interface Playlist { id: string; name: string; songCount: number; duration: number; coverArt: string }

const s = (v: unknown): string => (v == null ? '' : String(v));
const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const song = (o: Obj): Song => ({
  id: s(o.id), title: s(o.title), album: s(o.album), albumId: s(o.albumId), artist: s(o.artist), artistId: s(o.artistId),
  track: n(o.track), discNumber: n(o.discNumber) || 1, duration: n(o.duration), coverArt: s(o.coverArt || o.albumId || o.id), suffix: s(o.suffix),
  bitRate: n(o.bitRate), samplingRate: n(o.samplingRate), bitDepth: n(o.bitDepth), year: n(o.year), starred: !!o.starred, size: n(o.size),
});
const album = (o: Obj): Album => ({
  id: s(o.id), name: s(o.name || o.title || o.album), artist: s(o.artist), artistId: s(o.artistId), year: n(o.year), songCount: n(o.songCount),
  duration: n(o.duration), coverArt: s(o.coverArt || o.id), starred: !!o.starred, genre: s(o.genre),
});
const artist = (o: Obj): Artist => ({ id: s(o.id), name: s(o.name), albumCount: n(o.albumCount), coverArt: s(o.coverArt), starred: !!o.starred });
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

export type AlbumListType = 'byGenre' | 'newest' | 'recent' | 'frequent' | 'random' | 'alphabeticalByName' | 'alphabeticalByArtist' | 'starred';

export const nd = {
  async ping(cfg: NdConfig): Promise<{ version: string; server: string }> {
    const r = await call<{ version?: string; type?: string; serverVersion?: string }>('ping', {}, { ...cfg, server: normalizeNdServer(cfg.server) });
    return { version: s(r.serverVersion || r.version), server: s(r.type || 'Subsonic') };
  },
  async song(id: string): Promise<Song> {
    const r = await call<{ song: Obj }>('getSong', { id });
    return song(r.song);
  },
  async albumList(type: AlbumListType, size = 30, offset = 0, genre?: string): Promise<Album[]> {
    const r = await call<{ albumList2?: { album?: Obj[] } }>('getAlbumList2', { type, size, offset, genre });
    return arr(r.albumList2?.album).map(album);
  },
  async album(id: string): Promise<{ album: Album; songs: Song[] }> {
    const r = await call<{ album: Obj & { song?: Obj[] } }>('getAlbum', { id });
    return { album: album(r.album), songs: arr(r.album.song).map(song) };
  },
  /** 曲库规模：歌曲数来自扫描状态，专辑 / 艺术家来自艺术家列表 */
  async counts(): Promise<{ songs: number; albums: number; artists: number }> {
    const [sc, ar] = await Promise.all([
      call<{ scanStatus?: { count?: number } }>('getScanStatus').catch(() => ({} as { scanStatus?: { count?: number } })),
      nd.artists().catch(() => [] as Artist[]),
    ]);
    return { songs: n(sc.scanStatus?.count), albums: ar.reduce((a, x) => a + x.albumCount, 0), artists: ar.length };
  },
  async artists(): Promise<Artist[]> {
    const r = await call<{ artists?: { index?: { artist?: Obj[] }[] } }>('getArtists');
    return (r.artists?.index || []).flatMap((i) => arr(i.artist)).map(artist);
  },
  async artist(id: string): Promise<{ artist: Artist; albums: Album[] }> {
    const r = await call<{ artist: Obj & { album?: Obj[] } }>('getArtist', { id });
    return { artist: artist(r.artist), albums: arr(r.artist.album).map(album) };
  },
  /** Navidrome 自带的歌手简介（要服务器配了 Last.fm 等才有内容，没有就返回空串） */
  async artistBio(id: string): Promise<string> {
    const r = await call<{ artistInfo2?: { biography?: string } }>('getArtistInfo2', { id });
    const h = r.artistInfo2?.biography || '';
    if (!h) return '';
    // DOMParser 解析的文档不会执行脚本 / 加载图片，比 innerHTML 安全
    const t = (new DOMParser().parseFromString(h, 'text/html').body.textContent || '').replace(/\s*Read more on Last\.fm\.?\s*$/i, '').trim();
    return t;
  },
  async playlists(): Promise<Playlist[]> {
    const r = await call<{ playlists?: { playlist?: Obj[] } }>('getPlaylists');
    return arr(r.playlists?.playlist).map((p) => ({ id: s(p.id), name: s(p.name), songCount: n(p.songCount), duration: n(p.duration), coverArt: s(p.coverArt || p.id) }));
  },
  async playlist(id: string): Promise<{ playlist: Playlist; songs: Song[] }> {
    const r = await call<{ playlist: Obj & { entry?: Obj[] } }>('getPlaylist', { id });
    const p = r.playlist;
    return { playlist: { id: s(p.id), name: s(p.name), songCount: n(p.songCount), duration: n(p.duration), coverArt: s(p.coverArt || p.id) }, songs: arr(p.entry).map(song) };
  },
  async starred(): Promise<{ songs: Song[]; albums: Album[]; artists: Artist[] }> {
    const r = await call<{ starred2?: { song?: Obj[]; album?: Obj[]; artist?: Obj[] } }>('getStarred2');
    return { songs: arr(r.starred2?.song).map(song), albums: arr(r.starred2?.album).map(album), artists: arr(r.starred2?.artist).map(artist) };
  },
  async search(q: string): Promise<{ songs: Song[]; albums: Album[]; artists: Artist[] }> {
    const r = await call<{ searchResult3?: { song?: Obj[]; album?: Obj[]; artist?: Obj[] } }>('search3', { query: q, songCount: 30, albumCount: 20, artistCount: 10 });
    return { songs: arr(r.searchResult3?.song).map(song), albums: arr(r.searchResult3?.album).map(album), artists: arr(r.searchResult3?.artist).map(artist) };
  },
  async randomSongs(size = 50): Promise<Song[]> {
    const r = await call<{ randomSongs?: { song?: Obj[] } }>('getRandomSongs', { size });
    return arr(r.randomSongs?.song).map(song);
  },
  async genres(): Promise<{ name: string; albums: number }[]> {
    const r = await call<{ genres?: { genre?: Obj[] } }>('getGenres');
    return arr(r.genres?.genre).map((g) => ({ name: s(g.value), albums: n(g.albumCount) })).filter((g) => g.name).sort((a, b) => b.albums - a.albums);
  },
  async topSongs(artistName: string, count = 12): Promise<Song[]> {
    const r = await call<{ topSongs?: { song?: Obj[] } }>('getTopSongs', { artist: artistName, count });
    return arr(r.topSongs?.song).map(song);
  },
  async createPlaylist(name: string, songIds: string[] = []): Promise<string> {
    const first = songIds.slice(0, 100);
    const r = await call<{ playlist?: { id?: string } }>('createPlaylist', { name, songId: first });
    const id = s(r.playlist?.id);
    if (id && songIds.length > first.length) await this.addToPlaylist(id, songIds.slice(first.length));
    return id;
  },
  async addToPlaylist(id: string, songIds: string[]): Promise<void> {
    for (let i = 0; i < songIds.length; i += 100) await call('updatePlaylist', { playlistId: id, songIdToAdd: songIds.slice(i, i + 100) });
  },
  async removeFromPlaylist(id: string, index: number): Promise<void> {
    await call('updatePlaylist', { playlistId: id, songIndexToRemove: index });
  },
  async deletePlaylist(id: string): Promise<void> {
    await call('deletePlaylist', { id });
  },
  async star(id: string, on: boolean): Promise<void> {
    await call(on ? 'star' : 'unstar', { id });
  },
  async scrobble(id: string, done: boolean): Promise<void> {
    await call('scrobble', { id, submission: done }).catch(() => undefined);
  },
  /** 歌词：先取 OpenSubsonic 的带时间轴歌词，没有再取普通歌词（含 LRC 文本也能解析） */
  async lyrics(sg: Song): Promise<{ synced: boolean; lines: { t: number; text: string }[] }> {
    let answered = false;   // 至少有一个接口正常回答（哪怕是「没有歌词」）才算确定没有
    let lastErr: unknown = null;
    try {
      const r = await call<{ lyricsList?: { structuredLyrics?: { synced?: boolean; line?: { start?: number; value?: string }[] }[] } }>('getLyricsBySongId', { id: sg.id });
      answered = true;
      const list = r.lyricsList?.structuredLyrics || [];
      const best = list.find((l) => l.synced) || list[0];
      if (best?.line?.length) {
        return { synced: !!best.synced, lines: best.line.map((l) => ({ t: (l.start || 0) / 1000, text: s(l.value) })) };
      }
    } catch (e) { lastErr = e; /* 服务端不支持就走下面 */ }
    try {
      const r = await call<{ lyrics?: { value?: string } }>('getLyrics', { artist: sg.artist, title: sg.title });
      answered = true;
      const text = s(r.lyrics?.value);
      if (text) return parseLrc(text);
    } catch (e) { lastErr = e; }
    if (!answered) throw lastErr instanceof Error ? lastErr : new Error('歌词加载失败');
    return { synced: false, lines: [] };
  },
};

export function parseLrc(text: string): { synced: boolean; lines: { t: number; text: string }[] } {
  const out: { t: number; text: string }[] = [];
  let synced = false;
  for (const raw of text.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const body = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (tags.length) {
      synced = true;
      for (const t of tags) out.push({ t: Number(t[1]) * 60 + Number(t[2]), text: body });
    } else if (body && !/^\[(ar|ti|al|by|offset):/i.test(raw)) out.push({ t: 0, text: body });
  }
  if (synced) out.sort((a, b) => a.t - b.t);
  return { synced, lines: out };
}

let offlineCover: (id: string) => string = () => '';
/** 离线缓存（offline.ts）注册：已下载歌曲的封面直接用本地的 */
export function setOfflineCoverLookup(f: (id: string) => string): void { offlineCover = f; }
export function rawCoverUrl(id: string, size = 300): string {
  const c = loadNd();
  if (!id || !c.server) return '';
  return `${c.server}/rest/getCoverArt.view?${authQs(c)}&id=${encodeURIComponent(id)}&size=${size}`;
}
export function coverUrl(id: string, size = 300): string {
  const ov = getCoverOverride(id);
  if (ov) return ov;
  return offlineCover(id) || rawCoverUrl(id, size);
}
export function streamUrl(id: string, transcode = false): string {
  const c = loadNd();
  return `${c.server}/rest/stream.view?${authQs(c)}&id=${encodeURIComponent(id)}${transcode ? '&format=mp3&maxBitRate=320' : ''}`;
}
