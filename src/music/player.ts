// 全局音乐播放器：一个 <audio>，队列 / 随机 / 循环 / 系统媒体控制（锁屏、耳机按键）
import { logMusicPlay } from '../dash/log';
import { initThumb, thumbPlaying } from './thumb';
import { useSyncExternalStore } from 'react';
import { coverUrl, nd, streamUrl, type Song } from './navidrome';
import { isOffline, offlineUrl } from './offline';
import { CastSession, type CastTick } from './cast';
import { buildDidl, mimeOf, type DlnaDevice } from './dlna';

export type Repeat = 'off' | 'all' | 'one';
export interface MusicState {
  queue: Song[]; index: number; playing: boolean; pos: number; dur: number;
  shuffle: boolean; repeat: Repeat; open: boolean; loading: boolean; error: string; cur: Song | null;
  volume: number; sleepAt: number;
  /** 正在投屏的设备名；空串 = 没在投屏 */
  castName: string;
}

const VOL_KEY = 'wemby-music-prefs';   // 必须先于 prefs() 的首次调用（否则 TDZ 报错被吞，偏好永远读不出来）
let audio: HTMLAudioElement | null = null;
const P0 = prefs();
let st: MusicState = { queue: [], index: -1, playing: false, pos: 0, dur: 0, shuffle: P0.shuffle, repeat: P0.repeat, open: false, loading: false, error: '', cur: null, volume: P0.vol, sleepAt: 0, castName: '' };
const subs = new Set<() => void>();
const posSubs = new Set<() => void>();
let stS: MusicState = st;   // 不含实时进度的快照
let history: number[] = [];
let sleepTimer = 0;
export interface SleepInfo { at: number }
function prefs(): { vol: number; shuffle: boolean; repeat: Repeat } {
  try { return { vol: 0.8, shuffle: false, repeat: 'off', ...(JSON.parse(localStorage.getItem(VOL_KEY) || '{}') as object) }; } catch { return { vol: 0.8, shuffle: false, repeat: 'off' }; }
}
function savePrefs(): void { try { localStorage.setItem(VOL_KEY, JSON.stringify({ vol: cast ? localVol : st.volume, shuffle: st.shuffle, repeat: st.repeat })); } catch { /* ignore */ } }
let triedTranscode = false;
let scrobbled = '';
// 投屏：cast 不为空时，声音由 DLNA 设备播放，本机 <audio> 只留着不出声（队列 / 随机 / 循环逻辑仍走这里）
interface CastCtx { s: CastSession; dev: DlnaDevice; fallback: boolean /* 这台设备要用 MP3 转码才能播 */ }
let cast: CastCtx | null = null;
let localVol = P0.vol;      // 投屏期间 st.volume 表示设备音量，本机音量存在这里，断开后还原

let keepOn = false;
let keepAt = 0;
function keepAwake(on: boolean): void {
  const now = Date.now();
  if (on === keepOn && !(on && now - keepAt > 30 * 60 * 1000)) return;   // 播放中每 30 分钟续一次唤醒锁
  keepOn = on;
  keepAt = now;
  try { (window as unknown as { AndroidMusic?: { playing(b: boolean): void } }).AndroidMusic?.playing(on); } catch { /* 非安卓 */ }
}

// 安卓：把当前歌曲 / 状态交给原生通知（状态栏 + 锁屏，带上一首 / 暂停 / 下一首 / 关闭）
type NotifBridge = { update(json: string): void; clear(): void };
const notifBridge = (): NotifBridge | undefined => (window as unknown as { AndroidMusicNotif?: NotifBridge }).AndroidMusicNotif;
let notifKey = '';
function pushNotif(force = false): void {
  const b = notifBridge();
  if (!b) return;
  const c = st.queue[st.index] || null;
  const key = c ? `${c.id}|${st.playing}|${Math.round(st.dur || c.duration || 0)}` : '';
  if (!force && key === notifKey) return;
  notifKey = key;
  try {
    if (!c) { b.clear(); return; }
    b.update(JSON.stringify({ title: c.title, artist: c.artist, album: c.album, cover: coverUrl(c.coverArt, 512), dur: Math.round(st.dur || c.duration || 0), pos: Math.round(st.pos), playing: st.playing }));
  } catch { /* ignore */ }
}

function emit(p: Partial<MusicState>): void {
  st = { ...st, ...p };
  if (p.playing !== undefined) thumbPlaying(st.playing);
  if (p.playing !== undefined || st.playing) keepAwake(st.playing);
  if (p.playing !== undefined) { try { navigator.mediaSession.playbackState = st.playing ? 'playing' : 'paused'; } catch { /* ignore */ } }
  st.cur = st.queue[st.index] || null;
  pushNotif();
  // 只有播放进度（pos / dur）变化时，只通知需要进度的组件；歌曲行、页面这些不用跟着每秒重绘几次
  if (Object.keys(p).every((k) => k === 'pos' || k === 'dur')) { posSubs.forEach((f) => f()); return; }
  stS = st;
  subs.forEach((f) => f());
  posSubs.forEach((f) => f());
}

function el(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'auto';
  a.volume = cast ? localVol : st.volume;
  let psAt = 0;
  a.addEventListener('timeupdate', () => {
    if (cast) return;
    if (Date.now() - psAt > 4000 && Number.isFinite(a.duration) && a.duration > 0) { psAt = Date.now(); try { navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate || 1 }); } catch { /* ignore */ } }
    emit({ pos: a.currentTime, dur: Number.isFinite(a.duration) ? a.duration : st.cur?.duration || 0 });
    if (st.cur && scrobbled !== st.cur.id && a.currentTime > Math.min(30, (st.cur.duration || 60) / 2)) {
      scrobbled = st.cur.id;
      void nd.scrobble(st.cur.id, true);
      logMusicPlay(st.cur);
    }
  });
  a.addEventListener('play', () => { if (!cast) emit({ playing: true, error: '' }); });
  a.addEventListener('pause', () => { if (!cast) emit({ playing: false }); });
  a.addEventListener('waiting', () => { if (!cast) emit({ loading: true }); });
  a.addEventListener('playing', () => { if (!cast) emit({ loading: false, playing: true }); });
  a.addEventListener('canplay', () => {
    if (cast) return;
    emit({ loading: false });
    if (pendingStart) { // 一起听：加载好后跳到房间现在的进度 / 保持暂停
      const ps = pendingStart; pendingStart = null;
      if (ps.pos > 0.5) { a.currentTime = ps.pos; emit({ pos: ps.pos }); }
      if (ps.paused) { a.pause(); emit({ playing: false }); }
    }
  });
  a.addEventListener('ended', () => { if (!cast) next(true); });
  a.addEventListener('error', () => {
    if (cast) return;
    const c = st.cur;
    if (c && !triedTranscode) {
      // 浏览器不支持这个格式（比如部分 ALAC / APE）：让服务器转成 mp3 再播
      triedTranscode = true;
      a.src = a.src.startsWith('blob:') && navigator.onLine ? streamUrl(c.id) : streamUrl(c.id, true);   // 本地文件坏了：先退回在线播放
      void a.play().catch(() => undefined);
      return;
    }
    emit({ error: '这首歌播放失败', playing: false, loading: false });
  });
  audio = a;
  setupMediaSession();
  return a;
}

let pendingStart: { pos: number; paused: boolean } | null = null;
let loadTok = 0;
function load(i: number, autoplay = true): void {
  const a = el();
  const sg = st.queue[i];
  if (!sg) return;
  if (cast) { loadCast(i, autoplay); return; }
  triedTranscode = false;
  scrobbled = '';
  emit({ index: i, pos: 0, dur: sg.duration, loading: true, error: '' });
  const tok = ++loadTok;
  const start = (src: string): void => {
    if (tok !== loadTok) return;
    a.src = src;
    if (autoplay) void a.play().catch(() => emit({ playing: false, loading: false }));
    else a.load();
  };
  // 已下载的歌：直接放本地文件（断网也能播）；读不出来再退回在线
  if (isOffline(sg.id)) void offlineUrl(sg.id).then((u) => start(u || streamUrl(sg.id)));
  else start(streamUrl(sg.id));
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
  if (!st.cur) return;
  if (cast) { if (st.playing) castPause(); else castPlay(); return; }
  const a = el();
  if (a.paused) void a.play().catch(() => undefined); else a.pause();
}
export function pause(): void {
  if (cast) { if (st.playing) castPause(); return; }
  if (audio && !audio.paused) audio.pause();
}
/** 现在是不是在出声（本机 <audio> 在播，或设备在播） */
const isPlayingNow = (): boolean => (cast ? st.playing : !!audio && !audio.paused);
const curPos = (): number => (cast ? st.pos : audio ? audio.currentTime : st.pos);
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
  if (curPos() > 3) { seek(0); return; }
  if (history.length) { load(history.pop() as number); return; }
  if (st.index > 0 && !st.shuffle) { load(st.index - 1); return; }
  seek(0);
}
/** 用户主动拖动 / 点击进度（一起听据此向房间上报；房间同步过来的跳转走 partySeek，不触发） */
const userSeekSubs = new Set<(t: number) => void>();
export function onUserSeek(f: (t: number) => void): () => void { userSeekSubs.add(f); return () => { userSeekSubs.delete(f); }; }
function jump(t: number): void {
  if (!Number.isFinite(t)) return;
  if (cast) { void cast.s.seek(t); return; }   // 设备的进度由会话每秒回报，界面上的进度已在 seek() 里先行更新
  const a = el();
  a.currentTime = Math.max(0, t);
  emit({ pos: a.currentTime });
  pushNotif(true);   // 通知 / 锁屏的进度也跟着校正
}
export function seek(t: number): void {
  if (!Number.isFinite(t)) return;
  jump(t);
  const p = musicState().pos;
  userSeekSubs.forEach((f) => f(p));
}
export function partySeek(t: number): void { jump(t); }
export function setShuffle(v: boolean): void { emit({ shuffle: v }); savePrefs(); }
export function setRepeat(r: Repeat): void { emit({ repeat: r }); savePrefs(); }
export function cycleRepeat(): void { emit({ repeat: st.repeat === 'off' ? 'all' : st.repeat === 'all' ? 'one' : 'off' }); savePrefs(); }
export function setVolume(v: number): void {
  const x = Math.min(1, Math.max(0, v));
  if (cast) { emit({ volume: x }); cast.s.setVolume(x * 100); return; }   // 投屏时调的是设备音量，不改本机偏好
  el().volume = x; emit({ volume: x }); savePrefs();
}
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
  const vol = cast ? localVol : st.volume;
  if (cast) { const c = cast; cast = null; loadTok++; void c.s.stop(); }   // 关掉播放器 = 断开投屏
  if (audio) { audio.volume = vol; audio.pause(); audio.removeAttribute('src'); audio.load(); }
  history = [];
  upNext = [];
  emit({ queue: [], index: -1, playing: false, pos: 0, dur: 0, open: false, sleepAt: 0, castName: '', volume: vol });
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
  // 原生通知 / 锁屏按钮的回调入口
  (window as unknown as { __musicCmd?: (c: string, a?: number) => void }).__musicCmd = (c, a) => {
    if (c === 'play') { if (!isPlayingNow()) togglePlay(); }
    else if (c === 'pause') pause();
    else if (c === 'next') next();
    else if (c === 'prev') prev();
    else if (c === 'stop') stopMusic();
    else if (c === 'seek' && a != null) { seek(a); pushNotif(true); }
  };
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (a: MediaSessionAction, f: MediaSessionActionHandler): void => { try { ms.setActionHandler(a, f); } catch { /* ignore */ } };
  set('play', () => { if (!isPlayingNow()) togglePlay(); });
  set('pause', () => pause());
  set('stop', () => stopMusic());
  set('previoustrack', () => prev());
  set('nexttrack', () => next());
  set('seekto', (d) => { if (d.seekTime != null) seek(d.seekTime); });
}

const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
const subscribePos = (f: () => void): (() => void) => { posSubs.add(f); return () => { posSubs.delete(f); }; };
/** 不含实时进度：播放进度变化不会触发重渲染（歌曲行、页面用这个） */
export function useMusic(): MusicState { return useSyncExternalStore(subscribe, () => stS); }
/** 含实时进度（pos / dur）：只给进度条、歌词、时间显示用 */
export function useMusicPos(): MusicState { return useSyncExternalStore(subscribePos, () => st); }
export const musicState = (): MusicState => st;

// ───────── 一起听（由 musicParty.ts 调用）─────────
/** 订阅播放器的每一次变化（含进度），回调里用 musicState() 读最新状态 */
export function listenMusic(f: () => void): () => void { subs.add(f); posSubs.add(f); return () => { subs.delete(f); posSubs.delete(f); }; }
/** 按房间状态装载：可选换整个队列；换歌时加载完成后跳到 pos，paused 为真则保持暂停 */
export function partyApply(o: { songs?: Song[]; index: number; pos: number; paused: boolean }): void {
  initThumb({ prev: () => prev(), toggle: () => togglePlay(), next: () => next() });
  if (o.songs) { history = []; upNext = []; emit({ queue: o.songs }); }
  if (!st.queue[o.index]) return;
  pendingStart = { pos: o.pos, paused: o.paused };
  load(o.index, !o.paused);
  if (o.paused) emit({ playing: false });
}
export function partyPlay(want: boolean): void {
  if (!st.cur) return;
  if (cast) { if (want && !st.playing) castPlay(); else if (!want && st.playing) castPause(); return; }
  const a = el();
  if (want && a.paused) void a.play().catch(() => undefined);
  else if (!want && !a.paused) a.pause();
}
export function partyRate(r: number): void { if (audio && !cast) audio.playbackRate = r; }
export const musicRate = (): number => (audio ? audio.playbackRate : 1);
export const musicPaused = (): boolean => (cast ? !st.playing : audio ? audio.paused : true);

// ───────── 投屏（DLNA）─────────
const CAST_KEY = 'wemby-cast-prefs';
function castPrefs(): { mp3: boolean } {
  try { return { mp3: false, ...(JSON.parse(localStorage.getItem(CAST_KEY) || '{}') as object) }; } catch { return { mp3: false }; }
}
/** 「兼容模式」：投屏时一律让服务器转成 MP3（设备不认 FLAC / ALAC 时用） */
export const getCastMp3 = (): boolean => castPrefs().mp3;
export function setCastMp3(v: boolean): void {
  try { localStorage.setItem(CAST_KEY, JSON.stringify({ mp3: v })); } catch { /* ignore */ }
  if (cast && st.cur) loadCast(st.index, st.playing, st.pos);   // 正在投屏：马上用新设置从当前位置重新送一次
}
export const castDevice = (): DlnaDevice | null => cast?.dev ?? null;

function makeSession(dev: DlnaDevice): CastSession {
  let me: CastSession | null = null;
  const live = (): boolean => !!cast && cast.s === me;   // 已经换设备 / 断开的旧会话，回调一律忽略
  me = new CastSession(dev, {
    tick: (t) => { if (live()) onCastTick(t); },
    ended: () => { if (live()) next(true); },
    failed: (kind, msg) => { if (live()) onCastFail(kind, msg); },
    volume: (v) => { if (live()) emit({ volume: Math.min(1, Math.max(0, v / 100)) }); },
    notice: (m) => { if (!live()) return; emit({ error: m }); window.setTimeout(() => { if (st.error === m) emit({ error: '' }); }, 4000); },
  });
  return me;
}

function onCastTick(t: CastTick): void {
  if (t.playing !== st.playing || t.loading !== st.loading) emit(t.playing && !st.playing ? { playing: t.playing, loading: t.loading, error: '' } : { playing: t.playing, loading: t.loading });
  emit({ pos: t.pos, dur: t.dur || st.dur });
  const c = st.cur;
  if (c && scrobbled !== c.id && t.playing && t.pos > Math.min(30, (c.duration || 60) / 2)) {
    scrobbled = c.id;
    void nd.scrobble(c.id, true);
    logMusicPlay(c);
  }
}

function onCastFail(kind: 'format' | 'lost', msg: string): void {
  const c = cast;
  if (!c) return;
  if (kind === 'format' && !c.fallback && !castPrefs().mp3) {
    // 设备不认原格式：这台设备之后都改用 MP3 转码，并从当前位置重试这一首
    c.fallback = true;
    loadCast(st.index, true, st.pos);
    return;
  }
  if (kind === 'format') { emit({ error: `设备播不了这首歌：${msg}`, playing: false, loading: false }); return; }
  emit({ error: '投屏设备没有响应，已切回本机（暂停）' });
  stopCast(false);
}

function loadCast(i: number, autoplay: boolean, start = 0): void {
  const c = cast;
  const sg = st.queue[i];
  if (!c || !sg) return;
  loadTok++;   // 作废还没跑完的本机装载
  const ps = pendingStart;   // 一起听 / 切回时带来的「跳到某处、保持暂停」
  pendingStart = null;
  if (ps) { start = ps.pos > 0.5 ? ps.pos : 0; if (ps.paused) autoplay = false; }
  triedTranscode = false;
  scrobbled = '';
  const mp3 = c.fallback || castPrefs().mp3;
  const url = streamUrl(sg.id, mp3);
  const cv = sg.coverArt ? coverUrl(sg.coverArt, 300) : '';
  emit({ index: i, pos: start, dur: sg.duration, loading: true, playing: autoplay, error: '' });
  void c.s.load(url, buildDidl(url, { title: sg.title, artist: sg.artist, album: sg.album, cover: cv && !cv.startsWith('blob:') ? cv : undefined, duration: sg.duration, mime: mimeOf(sg.suffix, mp3) }), { dur: sg.duration, start, autoplay });
  void nd.scrobble(sg.id, false);
  updateSession();
}
function castPlay(): void { if (cast) { emit({ error: '' }); void cast.s.play(); } }
function castPause(): void { if (cast) void cast.s.pause(); }

/** 开始（或换到另一台设备）投屏：当前这首从现在的位置接着在设备上放，本机停声 */
export function startCast(dev: DlnaDevice): void {
  if (cast?.dev.id === dev.id) return;
  const wasPlaying = isPlayingNow();
  const pos = curPos();
  if (cast) { const old = cast.s; cast = null; void old.stop(); }
  else localVol = st.volume;
  cast = { s: makeSession(dev), dev, fallback: false };
  loadTok++;
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  emit({ castName: dev.name, error: '' });
  if (st.cur) loadCast(st.index, wasPlaying, pos);
}

/** 断开投屏：设备停止，当前这首从设备上的位置接着在本机放（resume=false 则保持暂停） */
export function stopCast(resume = true): void {
  const c = cast;
  if (!c) return;
  const wasPlaying = st.playing;
  const pos = st.pos;
  cast = null;
  loadTok++;
  void c.s.stop();
  if (audio) audio.volume = localVol;
  emit({ castName: '', volume: localVol });
  if (st.cur) { pendingStart = { pos, paused: !(resume && wasPlaying) }; load(st.index, resume && wasPlaying); }
}
