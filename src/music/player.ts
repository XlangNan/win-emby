// 全局音乐播放器：一个 <audio>，队列 / 随机 / 循环 / 系统媒体控制（锁屏、耳机按键）
import { initThumb, thumbPlaying } from './thumb';
import { useSyncExternalStore } from 'react';
import { coverUrl, nd, streamUrl, type Song } from './navidrome';

export type Repeat = 'off' | 'all' | 'one';
export interface MusicState {
  queue: Song[]; index: number; playing: boolean; pos: number; dur: number;
  shuffle: boolean; repeat: Repeat; open: boolean; loading: boolean; error: string; cur: Song | null;
  volume: number; sleepAt: number;
}

const VOL_KEY = 'wemby-music-prefs';   // 必须先于 prefs() 的首次调用（否则 TDZ 报错被吞，偏好永远读不出来）
let audio: HTMLAudioElement | null = null;
const P0 = prefs();
let st: MusicState = { queue: [], index: -1, playing: false, pos: 0, dur: 0, shuffle: P0.shuffle, repeat: P0.repeat, open: false, loading: false, error: '', cur: null, volume: P0.vol, sleepAt: 0 };
const subs = new Set<() => void>();
let history: number[] = [];
let sleepTimer = 0;
export interface SleepInfo { at: number }
function prefs(): { vol: number; shuffle: boolean; repeat: Repeat } {
  try { return { vol: 0.8, shuffle: false, repeat: 'off', ...(JSON.parse(localStorage.getItem(VOL_KEY) || '{}') as object) }; } catch { return { vol: 0.8, shuffle: false, repeat: 'off' }; }
}
function savePrefs(): void { try { localStorage.setItem(VOL_KEY, JSON.stringify({ vol: st.volume, shuffle: st.shuffle, repeat: st.repeat })); } catch { /* ignore */ } }
let triedTranscode = false;
let scrobbled = '';

let keepOn = false;
let keepAt = 0;
function keepAwake(on: boolean): void {
  const now = Date.now();
  if (on === keepOn && !(on && now - keepAt > 30 * 60 * 1000)) return;   // 播放中每 30 分钟续一次唤醒锁
  keepOn = on;
  keepAt = now;
  try { (window as unknown as { AndroidMusic?: { playing(b: boolean): void } }).AndroidMusic?.playing(on); } catch { /* 非安卓 */ }
}

function emit(p: Partial<MusicState>): void {
  st = { ...st, ...p };
  if (p.playing !== undefined) thumbPlaying(st.playing);
  if (p.playing !== undefined || st.playing) keepAwake(st.playing);
  if (p.playing !== undefined) { try { navigator.mediaSession.playbackState = st.playing ? 'playing' : 'paused'; } catch { /* ignore */ } }
  st.cur = st.queue[st.index] || null;
  subs.forEach((f) => f());
}

function el(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'auto';
  a.volume = st.volume;
  let psAt = 0;
  a.addEventListener('timeupdate', () => {
    if (Date.now() - psAt > 4000 && Number.isFinite(a.duration) && a.duration > 0) { psAt = Date.now(); try { navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate || 1 }); } catch { /* ignore */ } }
    emit({ pos: a.currentTime, dur: Number.isFinite(a.duration) ? a.duration : st.cur?.duration || 0 });
    if (st.cur && scrobbled !== st.cur.id && a.currentTime > Math.min(30, (st.cur.duration || 60) / 2)) {
      scrobbled = st.cur.id;
      void nd.scrobble(st.cur.id, true);
    }
  });
  a.addEventListener('play', () => emit({ playing: true, error: '' }));
  a.addEventListener('pause', () => emit({ playing: false }));
  a.addEventListener('waiting', () => emit({ loading: true }));
  a.addEventListener('playing', () => emit({ loading: false, playing: true }));
  a.addEventListener('canplay', () => emit({ loading: false }));
  a.addEventListener('ended', () => { next(true); });
  a.addEventListener('error', () => {
    const c = st.cur;
    if (c && !triedTranscode) {
      // 浏览器不支持这个格式（比如部分 ALAC / APE）：让服务器转成 mp3 再播
      triedTranscode = true;
      a.src = streamUrl(c.id, true);
      void a.play().catch(() => undefined);
      return;
    }
    emit({ error: '这首歌播放失败', playing: false, loading: false });
  });
  audio = a;
  setupMediaSession();
  return a;
}

function load(i: number): void {
  const a = el();
  const sg = st.queue[i];
  if (!sg) return;
  triedTranscode = false;
  scrobbled = '';
  emit({ index: i, pos: 0, dur: sg.duration, loading: true, error: '' });
  a.src = streamUrl(sg.id);
  void a.play().catch(() => emit({ playing: false, loading: false }));
  void nd.scrobble(sg.id, false);
  updateSession();
}

export function playQueue(songs: Song[], start = 0): void {
  if (!songs.length) return;
  initThumb({ prev: () => prev(), toggle: () => togglePlay(), next: () => next() });
  history = [];
  upNext = [];
  emit({ queue: songs, open: st.open });
  load(Math.min(Math.max(start, 0), songs.length - 1));
}
export function togglePlay(): void {
  const a = el();
  if (!st.cur) return;
  if (a.paused) void a.play().catch(() => undefined); else a.pause();
}
export function pause(): void { if (audio && !audio.paused) audio.pause(); }
// 「下一首播放」排的队：不管是不是随机模式，切歌时先按这个顺序播（按歌曲 id 记，队列被改动后也不会错位）
let upNext: string[] = [];
export function next(auto = false): void {
  const { queue, index, repeat, shuffle } = st;
  if (!queue.length) return;
  if (auto && repeat === 'one') { load(index); return; }
  let n = -1;
  while (upNext.length && n < 0) {
    const id = upNext.shift() as string;
    const after = queue.findIndex((x, k) => k > index && x.id === id);
    n = after >= 0 ? after : queue.findIndex((x, k) => k !== index && x.id === id);
  }
  if (n >= 0) { history.push(index); load(n); return; }
  if (shuffle && queue.length > 1) {
    do { n = Math.floor(Math.random() * queue.length); } while (n === index);
  } else if (index + 1 < queue.length) n = index + 1;
  else if (repeat === 'all') n = 0;
  else { if (auto) { emit({ playing: false, pos: 0 }); el().pause(); } return; }
  history.push(index);
  load(n);
}
export function prev(): void {
  const a = el();
  if (a.currentTime > 3) { a.currentTime = 0; return; }
  if (history.length) { load(history.pop() as number); return; }
  if (st.index > 0 && !st.shuffle) { load(st.index - 1); return; }
  a.currentTime = 0;
}
export function seek(t: number): void { const a = el(); if (Number.isFinite(t)) a.currentTime = Math.max(0, t); }
export function setShuffle(v: boolean): void { emit({ shuffle: v }); savePrefs(); }
export function setRepeat(r: Repeat): void { emit({ repeat: r }); savePrefs(); }
export function cycleRepeat(): void { emit({ repeat: st.repeat === 'off' ? 'all' : st.repeat === 'all' ? 'one' : 'off' }); savePrefs(); }
export function setVolume(v: number): void { const x = Math.min(1, Math.max(0, v)); el().volume = x; emit({ volume: x }); savePrefs(); }
/** 下一首播放 / 加入队列 */
export function playNext(songs: Song[]): void {
  if (!st.queue.length) { playQueue(songs, 0); return; }
  // 连续点多首「下一首播放」：排在已经排好的后面，而不是插队到最前
  const q = [...st.queue];
  const pos = Math.min(q.length, st.index + 1 + upNext.length);
  q.splice(pos, 0, ...songs);
  upNext.push(...songs.map((x) => x.id));
  emit({ queue: q });
}
export function enqueue(songs: Song[]): void {
  if (!st.queue.length) { playQueue(songs, 0); return; }
  emit({ queue: [...st.queue, ...songs] });
}
export function removeAt(i: number): void {
  if (i < 0 || i >= st.queue.length) return;
  if (st.queue.length === 1) { stopMusic(); return; }
  const q = st.queue.filter((_, k) => k !== i);
  // 先去掉指向被删项的记录，再把后面的下标整体前移
  history = history.filter((h) => h !== i).map((h) => (h > i ? h - 1 : h));
  if (i < st.index) { emit({ queue: q, index: st.index - 1 }); return; }
  if (i === st.index) { emit({ queue: q }); load(Math.min(i, q.length - 1)); return; }
  emit({ queue: q });
}
/** 打乱一份歌曲列表（不改全局随机模式） */
export function shuffled<T>(l: T[]): T[] {
  const a = [...l];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** 定时关闭：minutes=0 取消 */
export function setSleep(minutes: number): void {
  window.clearTimeout(sleepTimer);
  if (!minutes) { emit({ sleepAt: 0 }); return; }
  const at = Date.now() + minutes * 60000;
  emit({ sleepAt: at });
  sleepTimer = window.setTimeout(() => { pause(); emit({ sleepAt: 0 }); }, minutes * 60000);
}
export function setOpen(v: boolean): void { emit({ open: v }); }
export function playIndex(i: number): void { if (st.queue[i]) { history.push(st.index); load(i); } }
/** 服务器收藏请求完成后再通知收藏页刷新，免得它抢在写入之前拿到旧数据 */
export const notifyStarred = (): void => { window.dispatchEvent(new Event('wemby-nd-starred')); };
export function setStarred(id: string, on: boolean): void {
  emit({ queue: st.queue.map((x) => (x.id === id ? { ...x, starred: on } : x)) });
}
export function stopMusic(): void {
  window.clearTimeout(sleepTimer);
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  history = [];
  upNext = [];
  emit({ queue: [], index: -1, playing: false, pos: 0, dur: 0, open: false, sleepAt: 0 });
}

function updateSession(): void {
  const c = st.cur;
  if (!c || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: c.title, artist: c.artist, album: c.album,
      artwork: [{ src: coverUrl(c.coverArt, 512), sizes: '512x512' }],
    });
  } catch { /* ignore */ }
}
function setupMediaSession(): void {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (a: MediaSessionAction, f: MediaSessionActionHandler): void => { try { ms.setActionHandler(a, f); } catch { /* ignore */ } };
  set('play', () => { if (audio?.paused) togglePlay(); });
  set('pause', () => pause());
  set('stop', () => stopMusic());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekto', (d) => { if (d.seekTime != null) seek(d.seekTime); });
}

const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useMusic(): MusicState { return useSyncExternalStore(subscribe, () => st); }
export const musicState = (): MusicState => st;
