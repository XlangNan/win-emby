// 有声书播放器：一本书可能由多个音频文件组成，这里把它们接成一条连续的时间线。
// 全局单例，切换页面不会中断；进度每 15 秒 + 暂停 / 退出时同步回 Audiobookshelf。
import { useSyncExternalStore } from 'react';
import { absCover, absDetail, absFileUrl, absProgressMap, absSaveProgress, type AbsChapter } from './abs';
import { listenMusic, musicState, stopMusic } from '../music/player';

interface Track { url: string; start: number; dur: number }
export interface AbsPlayState {
  id: string; title: string; author: string; cover: string;
  duration: number; pos: number; playing: boolean; loading: boolean; rate: number;
  chapters: AbsChapter[]; err: string; sleepLeft: number;
}
const RATE_KEY = 'wemby-abs-rate';
const loadRate = (): number => { const v = Number(localStorage.getItem(RATE_KEY)); return v >= 0.5 && v <= 3 ? v : 1; };

let st: AbsPlayState = { id: '', title: '', author: '', cover: '', duration: 0, pos: 0, playing: false, loading: false, rate: 1, chapters: [], err: '', sleepLeft: 0 };
try { st = { ...st, rate: loadRate() }; } catch { /* ignore */ }
const subs = new Set<() => void>();
function emit(p: Partial<AbsPlayState>): void { st = { ...st, ...p }; subs.forEach((f) => f()); }
const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useAbsPlayer(): AbsPlayState { return useSyncExternalStore(subscribe, () => st); }
export const absPlayState = (): AbsPlayState => st;

let audio: HTMLAudioElement | null = null;
let tracks: Track[] = [];
let cur = 0;
let lastSave = 0;
let sleepEnd = 0;
let sleepTick: ReturnType<typeof setInterval> | null = null;

function el(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'auto';
  a.addEventListener('timeupdate', () => {
    const t = tracks[cur];
    if (!t) return;
    const pos = t.start + a.currentTime;
    emit({ pos });
    if (Date.now() - lastSave > 15000) save();
  });
  a.addEventListener('play', () => emit({ playing: true }));
  a.addEventListener('pause', () => { emit({ playing: false }); save(); });
  a.addEventListener('waiting', () => emit({ loading: true }));
  a.addEventListener('playing', () => emit({ loading: false, err: '' }));
  a.addEventListener('canplay', () => emit({ loading: false }));
  a.addEventListener('error', () => emit({ loading: false, playing: false, err: '音频加载失败（地址、网络或格式不支持）' }));
  a.addEventListener('ended', () => {
    if (cur + 1 < tracks.length) { cur++; a.src = tracks[cur].url; void a.play().catch(() => undefined); return; }
    emit({ playing: false, pos: st.duration });
    void absSaveProgress(st.id, st.duration, st.duration, true);
  });
  audio = a;
  return a;
}

function save(): void {
  lastSave = Date.now();
  if (st.id && st.duration > 0) void absSaveProgress(st.id, st.pos, st.duration, false);
}

function findTrack(t: number): number {
  for (let i = tracks.length - 1; i >= 0; i--) if (t >= tracks[i].start) return i;
  return 0;
}

/** 跳到整本书时间线上的某个位置 */
function gotoGlobal(t: number, play: boolean): void {
  if (!tracks.length) return;
  const a = el();
  const pos = Math.max(0, Math.min(t, Math.max(0, st.duration - 0.5)));
  const i = findTrack(pos);
  const off = pos - tracks[i].start;
  a.playbackRate = st.rate;
  if (i !== cur || !a.src || !a.src.startsWith(tracks[i].url.split('?')[0])) {
    cur = i;
    a.src = tracks[i].url;
    a.addEventListener('loadedmetadata', () => { a.currentTime = off; a.playbackRate = st.rate; }, { once: true });
  } else {
    a.currentTime = off;
  }
  emit({ pos });
  if (play) void a.play().catch(() => emit({ playing: false, loading: false }));
}

/** 播放一本书（同一本书再点就是继续 / 暂停）。from 不传 = 接着上次听到的位置 */
export async function absPlay(id: string, from?: number): Promise<void> {
  if (id === st.id && from === undefined) { absToggle(); return; }
  stopMusic();
  emit({ id, loading: true, err: '', playing: false, pos: 0, duration: 0, chapters: [], title: '加载中…', author: '', cover: absCover(id, 300) });
  try {
    const [d, prog] = await Promise.all([absDetail(id), absProgressMap(true).catch(() => new Map())]);
    if (!d.files.length) throw new Error('这本书没有音频文件');
    let acc = 0;
    tracks = d.files.map((f) => { const t = { url: absFileUrl(id, f.ino), start: acc, dur: f.duration }; acc += f.duration; return t; });
    const duration = d.duration > 0 ? d.duration : acc;
    const p = prog.get(id);
    let start = from ?? (p && !p.isFinished ? p.currentTime : 0);
    if (start > duration - 8) start = 0;
    cur = -1;
    emit({ title: d.title, author: d.author, duration, chapters: d.chapters });
    el().pause();
    gotoGlobal(start, true);
    setupMediaSession();
  } catch (e) {
    emit({ loading: false, err: (e as Error).message || String(e), title: st.title === '加载中…' ? '' : st.title });
  }
}

export function absToggle(): void {
  const a = el();
  if (!st.id) return;
  if (a.paused) void a.play().catch(() => undefined); else a.pause();
}
export function absPause(): void { if (audio && !audio.paused) audio.pause(); }
export function absSeek(t: number): void { gotoGlobal(t, !el().paused || st.playing); }
export function absSkip(d: number): void { gotoGlobal(st.pos + d, !el().paused); }
export function absSetRate(r: number): void {
  const v = Math.max(0.5, Math.min(3, r));
  try { localStorage.setItem(RATE_KEY, String(v)); } catch { /* ignore */ }
  if (audio) audio.playbackRate = v;
  emit({ rate: v });
}
export function absStop(): void {
  save();
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  tracks = []; cur = 0;
  setSleep(0);
  emit({ id: '', title: '', author: '', cover: '', duration: 0, pos: 0, playing: false, loading: false, chapters: [], err: '' });
}

/** 定时关闭：minutes = 0 取消 */
export function setSleep(minutes: number): void {
  if (sleepTick) { clearInterval(sleepTick); sleepTick = null; }
  if (minutes <= 0) { emit({ sleepLeft: 0 }); return; }
  sleepEnd = Date.now() + minutes * 60000;
  emit({ sleepLeft: minutes * 60 });
  sleepTick = setInterval(() => {
    const left = Math.round((sleepEnd - Date.now()) / 1000);
    if (left <= 0) { if (sleepTick) clearInterval(sleepTick); sleepTick = null; absPause(); emit({ sleepLeft: 0 }); }
    else emit({ sleepLeft: left });
  }, 1000);
}

export function currentChapter(chapters: AbsChapter[], pos: number): AbsChapter | null {
  for (const c of chapters) if (pos >= c.start && pos < c.end) return c;
  return null;
}

function setupMediaSession(): void {
  const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
  if (!ms) return;
  try {
    ms.metadata = new MediaMetadata({ title: st.title, artist: st.author, album: '有声书', artwork: st.cover ? [{ src: st.cover, sizes: '300x300' }] : [] });
    ms.setActionHandler('play', () => absToggle());
    ms.setActionHandler('pause', () => absPause());
    ms.setActionHandler('seekbackward', () => absSkip(-15));
    ms.setActionHandler('seekforward', () => absSkip(30));
    ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) absSeek(d.seekTime); });
  } catch { /* 部分环境不支持 */ }
}

// 放音乐时，有声书自动暂停
listenMusic(() => { if (st.playing && musicState().playing) absPause(); });
