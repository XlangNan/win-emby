// 全局音乐播放器：一个 <audio>，队列 / 随机 / 循环 / 系统媒体控制（锁屏、耳机按键）
import { useSyncExternalStore } from 'react';
import { coverUrl, nd, streamUrl, type Song } from './navidrome';

export type Repeat = 'off' | 'all' | 'one';
export interface MusicState {
  queue: Song[]; index: number; playing: boolean; pos: number; dur: number;
  shuffle: boolean; repeat: Repeat; open: boolean; loading: boolean; error: string; cur: Song | null;
}

let audio: HTMLAudioElement | null = null;
let st: MusicState = { queue: [], index: -1, playing: false, pos: 0, dur: 0, shuffle: false, repeat: 'off', open: false, loading: false, error: '', cur: null };
const subs = new Set<() => void>();
let history: number[] = [];
let triedTranscode = false;
let scrobbled = '';

function emit(p: Partial<MusicState>): void {
  st = { ...st, ...p };
  st.cur = st.queue[st.index] || null;
  subs.forEach((f) => f());
}

function el(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'auto';
  a.addEventListener('timeupdate', () => {
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
  history = [];
  emit({ queue: songs, open: st.open });
  load(Math.min(Math.max(start, 0), songs.length - 1));
}
export function togglePlay(): void {
  const a = el();
  if (!st.cur) return;
  if (a.paused) void a.play().catch(() => undefined); else a.pause();
}
export function pause(): void { if (audio && !audio.paused) audio.pause(); }
export function next(auto = false): void {
  const { queue, index, repeat, shuffle } = st;
  if (!queue.length) return;
  if (auto && repeat === 'one') { load(index); return; }
  let n: number;
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
  if (a.currentTime > 3 || !history.length) {
    if (history.length === 0 && a.currentTime <= 3 && st.index > 0 && !st.shuffle) { load(st.index - 1); return; }
    a.currentTime = 0;
    return;
  }
  load(history.pop() as number);
}
export function seek(t: number): void { const a = el(); if (Number.isFinite(t)) a.currentTime = Math.max(0, t); }
export function setShuffle(v: boolean): void { emit({ shuffle: v }); }
export function cycleRepeat(): void { emit({ repeat: st.repeat === 'off' ? 'all' : st.repeat === 'all' ? 'one' : 'off' }); }
export function setOpen(v: boolean): void { emit({ open: v }); }
export function playIndex(i: number): void { if (st.queue[i]) { history.push(st.index); load(i); } }
export function setStarred(id: string, on: boolean): void {
  emit({ queue: st.queue.map((x) => (x.id === id ? { ...x, starred: on } : x)) });
}
export function stopMusic(): void {
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  history = [];
  emit({ queue: [], index: -1, playing: false, pos: 0, dur: 0, open: false });
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
  set('play', () => togglePlay());
  set('pause', () => togglePlay());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekto', (d) => { if (d.seekTime != null) seek(d.seekTime); });
}

const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function useMusic(): MusicState { return useSyncExternalStore(subscribe, () => st); }
export const musicState = (): MusicState => st;
