// 「一起听」：把全局音乐播放器和房间状态互相同步。
// 房间里同步的是：播放列表（版本号变了才去取）+ 当前第几首 + 进度 + 暂停。每个人用自己的 Navidrome 账号取歌。
import { fetchPartyQueue, getParty, leaveRoom, onParty, partyNotice, sendOp, srvNow, targetPos, type PartyRoom, type PartySong } from '../lib/party';
import { listenMusic, musicPaused, musicRate, musicState, partyApply, partyPlay, partyRate, seek } from './player';
import { ndConfigured, nd, type Song } from './navidrome';

export const toPartySong = (s: Song): PartySong => ({ id: s.id, title: s.title, artist: s.artist, album: s.album, albumId: s.albumId, artistId: s.artistId, duration: s.duration, coverArt: s.coverArt, suffix: s.suffix });
const toSong = (p: PartySong): Song => ({ id: p.id, title: p.title, album: p.album, albumId: p.albumId, artist: p.artist, artistId: p.artistId, track: 0, discNumber: 1, duration: p.duration, coverArt: p.coverArt, suffix: p.suffix, bitRate: 0, samplingRate: 0, bitDepth: 0, year: 0, starred: false, size: 0 });
const sig = (q: { id: string }[]): string => q.map((x) => x.id).join(',');

let started = false;
let room: PartyRoom | null = null;
let aligned = false;
let loadingRoom = false;
let lastSeq = -1;
let localQv = -1;
let lastSig = '';
let lastCur = '';
let lastPlaying = false;
let lastPos: { pos: number; wall: number } | null = null;
let quietUntil = 0;
let expect: { to: number; until: number } | null = null;
let lastDriftSeek = 0;
let mism = 0;
let bufTimer = 0;
let bufSent = false;
let adjRate = 1;

const quiet = (ms = 1800): void => { quietUntil = performance.now() + ms; };
const calm = (): boolean => aligned && !!room && performance.now() > quietUntil;
const me = (): string => getParty().cid;
const wantPause = (r: PartyRoom): boolean => r.state.paused || r.state.hold;

async function loadFromRoom(r: PartyRoom, first: boolean): Promise<void> {
  if (loadingRoom) return;
  loadingRoom = true;
  try {
    if (first) {
      if (!ndConfigured()) { partyNotice('先在「设置」里配置 Navidrome 音乐服务，才能一起听'); void leaveRoom(); return; }
      // 权限 / 同一个音乐服务器的检查：自己的 Navidrome 里要能取到房间正在放的这首歌
      try { await nd.song(r.state.item.id); } catch { partyNotice('你的音乐库里找不到这首歌（可能不是同一个音乐服务器），已退出房间'); void leaveRoom(); return; }
    }
    const q = await fetchPartyQueue(r.id);
    const cur = getParty().room;
    if (!q || !cur || cur.id !== r.id) return;
    const st = cur.state;
    localQv = q.qv;
    const songs = q.queue.map(toSong);
    lastSig = sig(songs);
    expect = null;
    quiet(2500);
    partyApply({ songs, index: Math.min(st.index ?? 0, songs.length - 1), pos: targetPos(st), paused: wantPause(cur) });
    lastCur = songs[st.index ?? 0]?.id || '';
    lastSeq = st.seq;
    aligned = true;
    lastPlaying = !wantPause(cur);
    void sendOp({ kind: 'buf', on: false });
  } finally { loadingRoom = false; }
}

/** 房间里别人的操作 → 本机 */
function onRoomChange(): void {
  const r = getParty().room;
  if (!r || r.type !== 'music') {
    if (room) { room = null; aligned = false; window.clearTimeout(bufTimer); bufSent = false; partyRate(1); adjRate = 1; }
    return;
  }
  if (!room || room.id !== r.id) {
    room = r; aligned = false; lastSeq = -1;
    if (r.state.by === me() && r.state.seq === 1) { // 自己刚创建的房间：本机已经在播，不用重新装载
      const m = musicState();
      localQv = r.state.qv ?? 1; lastSig = sig(m.queue); lastCur = m.cur?.id || ''; lastPlaying = m.playing; lastSeq = r.state.seq; aligned = true;
      return;
    }
    void loadFromRoom(r, true);
    return;
  }
  room = r;
  if (!aligned) return;
  const st = r.state;
  if (st.seq === lastSeq) return;
  lastSeq = st.seq;
  if (st.by === me()) return;
  if (st.qv !== localQv) { void loadFromRoom(r, false); return; } // 播放列表变了（含换歌）：重新取列表再装载
  const m = musicState();
  if (m.cur?.id !== st.item.id) { // 换歌
    const idx = m.queue.findIndex((x) => x.id === st.item.id);
    expect = null;
    quiet(2500);
    if (idx >= 0) { partyApply({ index: idx, pos: targetPos(st), paused: wantPause(r) }); lastCur = st.item.id; } else void loadFromRoom(r, false);
    return;
  }
  quiet();
  partyPlay(!wantPause(r));
  const tgt = targetPos(st);
  if (Math.abs(tgt - m.pos) > 0.8) { expect = { to: tgt, until: performance.now() + 5000 }; seek(tgt); }
}

/** 本机的变化 → 房间 */
function onLocalChange(): void {
  if (!room) return;
  const m = musicState();
  const now = performance.now();
  // 位置
  const l = lastPos;
  lastPos = { pos: m.pos, wall: now };
  // 播放列表为空：用户关掉了音乐播放器 → 退出房间
  if (aligned && !m.queue.length && !loadingRoom) { void leaveRoom(); return; }
  // 缓冲：持续 0.8 秒以上才报告
  window.clearTimeout(bufTimer);
  if (aligned && m.loading) bufTimer = window.setTimeout(() => { bufSent = true; void sendOp({ kind: 'buf', on: true }); }, 800);
  else if (aligned && !m.loading && bufSent) { bufSent = false; void sendOp({ kind: 'buf', on: false }); }
  if (!calm()) { lastCur = m.cur?.id || ''; lastSig = sig(m.queue); lastPlaying = m.playing; return; }
  let waiting = false; // 正在等自己发起的跳转完成：期间的位置变化不算「用户拖动」，但暂停 / 换歌仍然要报告
  if (expect) { if (now > expect.until || Math.abs(m.pos - expect.to) < 3) expect = null; else waiting = true; }
  const r = getParty().room; if (!r) return;
  // 队列 / 当前歌变化
  const s = sig(m.queue), cur = m.cur?.id || '';
  if (s !== lastSig) {
    lastSig = s; lastCur = cur;
    const idx = Math.max(0, m.queue.findIndex((x) => x.id === cur));
    void sendOp({ kind: 'queue', queue: m.queue.map(toPartySong), index: idx }).then(() => { const rr = getParty().room; if (rr) { localQv = rr.state.qv ?? localQv; lastSeq = rr.state.seq; } });
    quiet(); return;
  }
  if (cur !== lastCur) {
    lastCur = cur;
    const idx = m.queue.findIndex((x) => x.id === cur);
    if (idx >= 0) void sendOp({ kind: 'track', index: idx, from: r.state.index }).then(() => { const rr = getParty().room; if (rr) lastSeq = rr.state.seq; });
    quiet(); return;
  }
  // 暂停 / 播放（加载中的短暂变化不算）
  if (m.playing !== lastPlaying && !m.loading) {
    lastPlaying = m.playing;
    void sendOp({ kind: m.playing ? 'play' : 'pause', pos: m.pos }).then(() => { const rr = getParty().room; if (rr) lastSeq = rr.state.seq; });
    return;
  }
  // 拖动进度：位置突然跳了
  if (l && !waiting) {
    const exp = l.pos + (m.playing && !m.loading ? (now - l.wall) / 1000 : 0);
    if (Math.abs(m.pos - exp) > 2.2) void sendOp({ kind: 'seek', pos: m.pos }).then(() => { const rr = getParty().room; if (rr) lastSeq = rr.state.seq; });
  }
}

/** 每秒：漂移纠正 + 状态核对 + 心跳 */
let tick = 0;
function onTick(): void {
  const r = getParty().room;
  if (!room || !r || !aligned) return;
  const m = musicState();
  const st = r.state;
  if (expect && performance.now() > expect.until) expect = null;
  // 状态核对：房间在播而本机暂停（或反过来）连续两次
  if (m.playing === wantPause(r) && !m.loading && m.cur?.id === st.item.id) {
    if (++mism >= 2) { mism = 0; quiet(); partyPlay(!wantPause(r)); }
  } else mism = 0;
  if (++tick % 3 === 0) void sendOp({ kind: 'hb', pos: m.pos });
  if (wantPause(r) || !m.playing || m.loading || expect || m.cur?.id !== st.item.id) { if (adjRate !== 1) { adjRate = 1; partyRate(1); } return; }
  const diff = targetPos(st, srvNow()) - m.pos;
  const a = Math.abs(diff);
  if (a > 1.5) {
    if (performance.now() - lastDriftSeek > 4000) { lastDriftSeek = performance.now(); quiet(); expect = { to: targetPos(st), until: performance.now() + 5000 }; seek(targetPos(st)); }
    return;
  }
  const want = a > 0.3 ? 1 + Math.max(-0.05, Math.min(0.05, diff / 8)) : 1;
  if (Math.abs(musicRate() - want) > 0.004) { adjRate = want; partyRate(want); }
}

/** 手动「同步播放」 */
export function musicResync(): void {
  const r = getParty().room;
  if (!r || r.type !== 'music') return;
  const st = r.state;
  const m = musicState();
  quiet(2500);
  if (m.cur?.id !== st.item.id) { void loadFromRoom(r, false); } else {
    partyPlay(!wantPause(r));
    const tgt = targetPos(st);
    if (Math.abs(tgt - m.pos) > 0.3) { expect = { to: tgt, until: performance.now() + 5000 }; seek(tgt); }
  }
  partyNotice('已同步到房间进度');
}

/** 在全局只启动一次（PartyBridge 里调用） */
export function startMusicParty(): () => void {
  if (started) return () => undefined;
  started = true;
  const u1 = onParty(onRoomChange);
  const u2 = listenMusic(onLocalChange);
  const t = window.setInterval(onTick, 1000);
  onRoomChange();
  return () => { started = false; u1(); u2(); window.clearInterval(t); musicPaused(); };
}
