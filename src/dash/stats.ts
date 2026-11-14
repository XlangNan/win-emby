// 首页仪表盘的数据：影视（Emby）、音乐（Navidrome + 本机收听记录）、有声书（Audiobookshelf）
import { emby, thumbUrl, posterUrl } from '../emby/client';
import type { EmbyItem, ItemsResult } from '../emby/types';
import { coverUrl, nd, type Album } from '../music/navidrome';
import { absCover, absConfigured, absLibraries, absLibStats, absListening, absProgressMap, absShelves, type AbsBook } from '../abs/abs';
import { readMusicLog } from './log';

export const dayKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/** 最近 7 天（含今天），从 6 天前到今天 */
export function lastDays(): { key: string; label: string; today: boolean }[] {
  const W = ['日', '一', '二', '三', '四', '五', '六'];
  const out: { key: string; label: string; today: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    out.push({ key: dayKey(d), label: i === 0 ? '今天' : `周${W[d.getDay()]}`, today: i === 0 });
  }
  return out;
}
export const hhmm = (t: number): string => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export function fmtHM(sec: number): { h: number; m: number } { const m = Math.round(sec / 60); return { h: Math.floor(m / 60), m: m % 60 }; }
export function fmtShort(sec: number): string { const { h, m } = fmtHM(sec); return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}m`; }
export function fmtCn(sec: number): string { const { h, m } = fmtHM(sec); return h ? `${h} 小时 ${m} 分` : `${m} 分`; }

export interface Entry { id: string; title: string; sub: string; img: string; when: string; note: string; pct: number; to: string }

// ───────── 影视 ─────────
export interface VideoStats {
  movies: number; series: number; episodes: number; newMovies: number; newEpisodes: number;
  yesterday: Entry[]; yesterdaySec: number; week: Record<string, number>;
  resume: Entry[]; recent: Entry[];
}
const EMPTY: ItemsResult = { Items: [], TotalRecordCount: 0 };
type Dated = EmbyItem & { DateCreated?: string };
const target = (it: EmbyItem): string => `/detail/${it.Type === 'Episode' && it.SeriesId ? it.SeriesId : it.Id}`;
const titleOf = (it: EmbyItem): string => (it.Type === 'Episode' ? it.SeriesName || it.Name : it.Name);
const subOf = (it: EmbyItem): string => (it.Type === 'Episode'
  ? `S${it.ParentIndexNumber ?? 1}E${it.IndexNumber ?? 0} · ${it.Name}`
  : `电影${it.ProductionYear ? ` · ${it.ProductionYear}` : ''}`);

export async function loadVideo(): Promise<VideoStats> {
  const y0 = startOf(new Date()) - 86400000;
  const [mv, se, ep, played, half, newMv, newEp, resume, latest] = await Promise.all([
    emby.items({ types: 'Movie', limit: 1 }),
    emby.items({ types: 'Series', limit: 1 }).catch(() => EMPTY),
    emby.items({ types: 'Episode', limit: 1 }).catch(() => EMPTY),
    emby.items({ types: 'Movie,Episode', filters: 'IsPlayed', sortBy: 'DatePlayed', sortOrder: 'Descending', limit: 300 }).catch(() => EMPTY),
    emby.items({ types: 'Movie,Episode', filters: 'IsResumable', sortBy: 'DatePlayed', sortOrder: 'Descending', limit: 100 }).catch(() => EMPTY),
    emby.items({ types: 'Movie', sortBy: 'DateCreated', sortOrder: 'Descending', limit: 40, extraFields: 'DateCreated' }).catch(() => EMPTY),
    emby.items({ types: 'Episode', sortBy: 'DateCreated', sortOrder: 'Descending', limit: 120, extraFields: 'DateCreated' }).catch(() => EMPTY),
    emby.resume(6).catch(() => [] as EmbyItem[]),
    emby.items({ types: 'Movie,Series', sortBy: 'DateCreated', sortOrder: 'Descending', limit: 8 }).catch(() => EMPTY),
  ]);
  const isNew = (x: Dated): boolean => Date.parse(x.DateCreated || '') >= y0 && Date.parse(x.DateCreated || '') < y0 + 86400000;
  const done = new Set(played.Items.map((i) => i.Id));
  const seen = new Set<string>();
  const week: Record<string, number> = {};
  const yest: { e: Entry; at: number; sec: number }[] = [];
  for (const it of [...played.Items, ...half.Items]) {
    if (seen.has(it.Id)) continue;
    seen.add(it.Id);
    const at = Date.parse(it.UserData?.LastPlayedDate || '');
    if (!Number.isFinite(at)) continue;
    const run = (it.RunTimeTicks || 0) / 1e7;
    const isDone = done.has(it.Id);
    const sec = isDone ? run : Math.min(run, (it.UserData?.PlaybackPositionTicks || 0) / 1e7);
    const k = dayKey(new Date(at));
    week[k] = (week[k] || 0) + sec;
    if (at >= y0 && at < y0 + 86400000) {
      const pct = run > 0 ? Math.round((sec / run) * 100) : isDone ? 100 : 0;
      yest.push({ at, sec, e: { id: it.Id, title: titleOf(it), sub: subOf(it), img: thumbUrl(it, 320), when: hhmm(at), note: isDone ? `看完 · ${Math.max(1, Math.round(sec / 60))} 分` : `看到 ${pct}%`, pct: isDone ? 100 : pct, to: target(it) } });
    }
  }
  yest.sort((a, b) => b.at - a.at);
  const entry = (it: EmbyItem, note: string): Entry => {
    const run = (it.RunTimeTicks || 0) / 1e7;
    const pos = (it.UserData?.PlaybackPositionTicks || 0) / 1e7;
    return { id: it.Id, title: titleOf(it), sub: subOf(it), img: thumbUrl(it, 320), when: '', note, pct: run > 0 ? Math.round((pos / run) * 100) : 0, to: `/detail/${it.Id}` };
  };
  return {
    movies: mv.TotalRecordCount, series: se.TotalRecordCount, episodes: ep.TotalRecordCount,
    newMovies: (newMv.Items as Dated[]).filter(isNew).length, newEpisodes: (newEp.Items as Dated[]).filter(isNew).length,
    yesterday: yest.map((x) => x.e), yesterdaySec: yest.reduce((a, x) => a + x.sec, 0), week,
    resume: resume.map((it) => { const e = entry(it, '继续观看'); const left = Math.max(0, ((it.RunTimeTicks || 0) / 1e7) * (1 - e.pct / 100)); return { ...e, note: `${e.pct}% · 剩 ${Math.max(1, Math.round(left / 60))} 分`, sub: `影视 · ${subOf(it)}` }; }),
    recent: latest.Items.map((it) => ({ id: it.Id, title: it.Name, sub: it.Type === 'Series' ? `剧集${it.ProductionYear ? ` · ${it.ProductionYear}` : ''}` : `电影${it.ProductionYear ? ` · ${it.ProductionYear}` : ''}`, img: posterUrl(it, 260), when: '', note: it.Type === 'Series' ? '剧集' : '电影', pct: 0, to: `/detail/${it.Id}` })),
  };
}

// ───────── 音乐 ─────────
export interface MusicStats { songs: number; albums: number; artists: number; recent: Entry[] }
export async function loadMusic(): Promise<MusicStats> {
  const [c, al] = await Promise.all([nd.counts(), nd.albumList('newest', 8).catch(() => [] as Album[])]);
  return { ...c, recent: al.map((a) => ({ id: a.id, title: a.name, sub: a.artist, img: coverUrl(a.coverArt, 260), when: '', note: '专辑', pct: 0, to: `/music/album/${a.id}` })) };
}
/** 本机记录：今天听的歌 + 每天的收听秒数 */
export function musicLocal(): { today: Entry[]; todaySec: number; days: Record<string, number> } {
  const log = readMusicLog();
  const t0 = startOf(new Date());
  const days: Record<string, number> = {};
  for (const x of log) { const k = dayKey(new Date(x.t)); days[k] = (days[k] || 0) + x.sec; }
  const today = log.filter((x) => x.t >= t0).sort((a, b) => b.t - a.t);
  return {
    today: today.slice(0, 8).map((x) => ({ id: x.id + x.t, title: x.title, sub: [x.artist, x.album].filter(Boolean).join(' · '), img: coverUrl(x.cover, 120), when: hhmm(x.t), note: `${Math.floor(x.sec / 60)}:${String(x.sec % 60).padStart(2, '0')}`, pct: 0, to: x.albumId ? `/music/album/${x.albumId}` : '/music' })),
    todaySec: today.reduce((a, x) => a + x.sec, 0), days,
  };
}

// ───────── 有声书 ─────────
export interface BookStats { books: number; hours: number; listening: number; days: Record<string, number>; today: Entry[]; todaySec: number; resume: Entry[]; recent: Entry[] }
const bookEntry = (b: AbsBook, note: string, sub: string, pct = 0): Entry => ({ id: b.id, title: b.title, sub, img: absCover(b.id, 260), when: '', note, pct, to: `/audiobooks/${b.id}` });
export async function loadBooks(): Promise<BookStats> {
  if (!absConfigured()) throw new Error('未连接');
  const libs = await absLibraries();
  const [stats, shelves, prog, lis] = await Promise.all([
    Promise.all(libs.map((l) => absLibStats(l.id).catch(() => ({ items: 0, duration: 0 })))),
    Promise.all(libs.map((l) => absShelves(l.id).catch(() => []))),
    absProgressMap().catch(() => new Map()),
    absListening().catch(() => ({ days: {} as Record<string, number>, sessions: [] })),
  ]);
  const flat = shelves.flat();
  const cont = flat.filter((s) => s.id === 'continue-listening').flatMap((s) => s.books);
  const recent = flat.filter((s) => s.id === 'recently-added').flatMap((s) => s.books);
  const t0 = startOf(new Date());
  const per = new Map<string, { title: string; author: string; sec: number; at: number }>();
  for (const x of lis.sessions) {
    if (x.at < t0) continue;
    const o = per.get(x.id) || { title: x.title, author: x.author, sec: 0, at: 0 };
    o.sec += x.sec; o.at = Math.max(o.at, x.at); per.set(x.id, o);
  }
  const today: Entry[] = [...per.entries()].sort((a, b) => b[1].at - a[1].at).map(([id, o]) => ({ id, title: o.title, sub: o.author, img: absCover(id, 120), when: hhmm(o.at), note: `听了 ${Math.max(1, Math.round(o.sec / 60))} 分`, pct: 0, to: `/audiobooks/${id}` }));
  return {
    books: stats.reduce((a, x) => a + x.items, 0), hours: Math.round(stats.reduce((a, x) => a + x.duration, 0) / 3600),
    listening: [...prog.values()].filter((p) => !p.isFinished && p.progress > 0).length,
    days: lis.days, today, todaySec: lis.days[dayKey(new Date())] ?? [...per.values()].reduce((a, x) => a + x.sec, 0),
    resume: cont.slice(0, 4).map((b) => { const p = prog.get(b.id); const pct = Math.round((p?.progress || 0) * 100); return bookEntry(b, `${pct}% · 继续收听`, `有声书 · ${b.author}`, pct); }),
    recent: recent.slice(0, 8).map((b) => bookEntry(b, '有声书', b.author)),
  };
}
