// 「一起听」：把全局音乐播放器和房间状态互相同步。
// 房间里同步的是：播放列表（版本号变了才去取）+ 当前第几首 + 进度 + 暂停。每个人用自己的 Navidrome 账号取歌。
import { fetchPartyQueue, getParty, leaveRoom, onParty, partyNotice, sendOp, srvNow, targetPos, type OpBody, type PartyRoom, type PartySong } from '../lib/party';
import { listenMusic, musicPaused, musicRate, musicState, onUserSeek, partyApply, partyPlay, partyRate, partySeek } from './player';
import { ndConfigured, nd, type Song } from './navidrome';

export const toPartySong = (s: Song): PartySong => ({ id: s.id, title: s.title, artist: s.artist, album: s.album, albumId: s.albumId, artistId: s.artistId, duration: s.duration, coverArt: s.coverArt, suffix: s.suffix });
const toSong = (p: PartySong): Song => ({ id: p.id, title: p.title, album: p.album, albumId: p.albumId, artist: p.artist, artistId: p.artistId, track: 0, discNumber: 1, duration: p.duration, coverArt: p.coverArt, suffix: p.suffix, bitRate: 0, samplingRate: 0, bitDepth: 0, year: 0, starred: false, size: 0 });
const sig = (q: { id: string }[]): string => q.map((x) => x.id).join(',');

// 同步思路（和房间「比对状态」，而不是靠时间窗口去猜哪些变化是自己引起的）：
// ① 本机用户的操作（切歌 / 改列表 / 暂停 / 拖进度）→ 排进一个串行队列，发出去时再读最新状态；和房间一致就不发。
// ② 房间的变化 → 和本机状态逐项比对（列表版本 / 当前歌 / 播放暂停 / 进度），不一样就改本机。
// ③ 每秒再做一次同样的比对兜底，并把「我加载好了」按房间里记录的状态补报。
let started = false;
let room: PartyRoom | null = null;
let aligned = false;
let loadingRoom = false;
let reloadAgain = false;
let lastSeq = -1;
let localQv = -1;
let lastSig = '';
let lastCur = '';
let lastPlaying = false;
let expect: { to: number; until: number } | null = null;
let lastDriftSeek = 0;
let mism = 0;
let bufTimer = 0;
let bufSent = false;
let adjRate = 1;
let lastReady = 0;
let inflight = 0;
let chain: Promise<void> = Promise.resolve();

const me = (): string => getParty().cid;
const wantPause = (r: PartyRoom): boolean => r.state.paused || r.state.hold;
const realPlaying = (): boolean => !musicPaused();

/** 本机操作 → 房间：串行发送，build 在轮到它的时候才执行（读最新的房间状态），返回 null 表示无需发送 */
function push(build: () => OpBody | null, after?: () => void): void {
  inflight++;
  chain = chain.then(async () => {
    try {
      const o = room && aligned ? build() : null;
      if (o) { await sendOp(o); after?.(); }
    } catch { /* 网络错误：兜底比对会把本机拉回房间状态 */ } finally {
      inflight--;
      if (inflight === 0) window.setTimeout(() => { const r = getParty().room; if (r) reconcile(r, true); }, 0);
    }
  });
}

async function loadFromRoom(r: PartyRoom, first: boolean): Promise<void> {
  if (loadingRoom) { reloadAgain = true; return; }
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
    const idx = Math.max(0, Math.min(st.index ?? 0, songs.length - 1));
    lastSig = sig(songs);
    lastCur = songs[idx]?.id || '';
    lastPlaying = !wantPause(cur);
    expect = null;
    partyApply({ songs, index: idx, pos: targetPos(st), paused: wantPause(cur) });
    lastSeq = st.seq;
    aligned = true;
  } finally {
    loadingRoom = false;
    if (reloadAgain) { reloadAgain = false; window.setTimeout(() => { const r2 = getParty().room; if (r2) reconcile(r2, true); }, 0); }
  }
}

/** 把本机调整到和房间一致（逐项比对）。force=true 时不看 seq 是否变化 */
function reconcile(r: PartyRoom, force: boolean): void {
  if (!aligned || loadingRoom || inflight > 0 || r.type !== 'music') return;
  const st = r.state;
  if (!force && st.seq === lastSeq) return;
  lastSeq = st.seq;
  const m = musicState();
  if (st.qv !== undefined && st.qv !== localQv) { void loadFromRoom(r, false); return; }  // 播放列表变了
  if (m.cur?.id !== st.item.id) {                                                          // 换歌
    const idx = m.queue.findIndex((x) => x.id === st.item.id);
    expect = null;
    if (idx >= 0) { lastCur = st.item.id; lastPlaying = !wantPause(r); partyApply({ index: idx, pos: targetPos(st), paused: wantPause(r) }); } else void loadFromRoom(r, false);
    return;
  }
  lastPlaying = !wantPause(r);
  if (realPlaying() === wantPause(r)) partyPlay(!wantPause(r));
  const tgt = targetPos(st);
  const th = st.why === 'seek' ? 0.8 : 1.5;
  if (!m.loading && Math.abs(tgt - m.pos) > th) { expect = { to: tgt, until: performance.now() + 5000 }; partySeek(tgt); }
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
      localQv = r.state.qv ?? 1; lastSig = sig(m.queue); lastCur = m.cur?.id || ''; lastPlaying = realPlaying(); lastSeq = r.state.seq; aligned = true;
      return;
    }
    void loadFromRoom(r, true);
    return;
  }
  room = r;
  reconcile(r, false);
}

/** 补报「我加载好了」：以房间里记录的我的状态为准（避免服务端晚一步把我标成加载中而没人再报） */
function reportReady(r: PartyRoom, m: ReturnType<typeof musicState>): void {
  const mine = r.members.find((x) => x.cid === me());
  if (!mine || !mine.buf || m.loading || m.cur?.id !== r.state.item.id) return;
  const t = performance.now();
  if (t - lastReady < 1200) return;
  lastReady = t; bufSent = false;
  void sendOp({ kind: 'buf', on: false });
}

/** 本机的变化 → 房间 */
function onLocalChange(): void {
  if (!room) return;
  const m = musicState();
  // 播放列表为空：用户关掉了音乐播放器 → 退出房间
  if (aligned && !m.queue.length && !loadingRoom) { void leaveRoom(); return; }
  // 缓冲：持续 0.8 秒以上才报告
  window.clearTimeout(bufTimer);
  if (aligned && m.loading) bufTimer = window.setTimeout(() => { bufSent = true; void sendOp({ kind: 'buf', on: true }); }, 800);
  else if (aligned && !m.loading && bufSent) { bufSent = false; void sendOp({ kind: 'buf', on: false }); }
  const r = getParty().room;
  if (!aligned || loadingRoom || !r) return;
  reportReady(r, m);
  const s = sig(m.queue), cur = m.cur?.id || '';
  // 播放列表变化（含用户点了另一首歌而换了整个列表）
  if (s !== lastSig) {
    lastSig = s; lastCur = cur;
    push(() => {
      const mm = musicState();
      if (!mm.queue.length) return null;
      const idx = Math.max(0, mm.queue.findIndex((x) => x.id === mm.cur?.id));
      localQv = (getParty().room?.state.qv ?? localQv) + 1;   // 服务端每次改列表 +1，先记下，免得把自己的改动当成别人的去重载
      return { kind: 'queue', queue: mm.queue.map(toPartySong), index: idx };
    }, () => { const rr = getParty().room; if (rr?.state.qv !== undefined) localQv = rr.state.qv; });
    return;
  }
  // 切歌（用户点了下一首 / 上一首 / 列表里另一首 / 自动播完）：已经和房间一致就不用发
  if (cur !== lastCur) {
    lastCur = cur;
    push(() => {
      const rm = getParty().room, mm = musicState();
      if (!rm || !mm.cur || mm.cur.id === rm.state.item.id) return null;
      const idx = mm.queue.findIndex((x) => x.id === mm.cur?.id);
      return idx >= 0 ? { kind: 'track', index: idx, from: rm.state.index } : null;
    });
    return;
  }
  // 暂停 / 播放：看音频元素的真实状态（调用 play()/pause() 后立刻变），不看播放器状态里的 playing（它要等事件才更新，
  // 会让「我刚按房间要求暂停」被误当成用户操作又发回房间，两台设备就互相来回切）。加载中的短暂变化不算；和房间一致不发。
  const rp = realPlaying();
  if (rp !== lastPlaying && !m.loading) {
    lastPlaying = rp;
    push(() => {
      const rm = getParty().room, mm = musicState();
      const now = realPlaying();
      if (!rm || mm.loading || mm.cur?.id !== rm.state.item.id) return null;
      if (now === !rm.state.paused) return null;   // 和房间记录的「用户意图」一致（等缓冲造成的暂停不算用户暂停）
      return { kind: now ? 'play' : 'pause', pos: mm.pos };
    });
  }
}

/** 用户拖动 / 点击进度条 → 房间（明确的用户动作，不再靠「位置突然跳了」去猜） */
function onSeekByUser(): void {
  if (!room || !aligned || loadingRoom) return;
  const id0 = musicState().cur?.id;
  push(() => {
    const rm = getParty().room, mm = musicState();
    if (!rm || mm.cur?.id !== id0 || mm.cur?.id !== rm.state.item.id) return null;
    return { kind: 'seek', pos: mm.pos };
  });
}

/** 每秒：漂移纠正 + 状态核对 + 心跳 */
let tick = 0;
function onTick(): void {
  const r = getParty().room;
  if (!room || !r || !aligned) return;
  const m = musicState();
  const st = r.state;
  if (expect && performance.now() > expect.until) expect = null;
  reportReady(r, m);
  // 兜底：本机和房间的列表 / 当前歌对不上（比如某次更新没收到、或自己的操作被服务端忽略）→ 以房间为准
  if (!loadingRoom && inflight === 0 && !m.loading && (m.cur?.id !== st.item.id || (st.qv !== undefined && st.qv !== localQv))) { reconcile(r, true); return; }
  // 状态核对：房间在播而本机暂停（或反过来）连续两次
  if (realPlaying() === wantPause(r) && !m.loading && m.cur?.id === st.item.id && inflight === 0) {
    if (++mism >= 2) { mism = 0; lastPlaying = !wantPause(r); partyPlay(!wantPause(r)); }
  } else mism = 0;
  if (++tick % 3 === 0) void sendOp({ kind: 'hb', pos: m.pos });
  if (m.loading || expect || m.cur?.id !== st.item.id || inflight > 0) { if (adjRate !== 1) { adjRate = 1; partyRate(1); } return; }
  // 暂停中：位置对不上也校准（别人在暂停时拖了进度）
  if (wantPause(r) || !realPlaying()) {
    if (adjRate !== 1) { adjRate = 1; partyRate(1); }
    if (wantPause(r) && Math.abs(st.pos - m.pos) > 1.5 && performance.now() - lastDriftSeek > 3000) { lastDriftSeek = performance.now(); expect = { to: st.pos, until: performance.now() + 5000 }; partySeek(st.pos); }
    return;
  }
  const diff = targetPos(st, srvNow()) - m.pos;
  const a = Math.abs(diff);
  if (a > 1.5) {
    if (performance.now() - lastDriftSeek > 4000) { lastDriftSeek = performance.now(); const t = targetPos(st); expect = { to: t, until: performance.now() + 5000 }; partySeek(t); }
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
  if (st.qv !== undefined && st.qv !== localQv) void loadFromRoom(r, false);
  else if (m.cur?.id !== st.item.id) reconcile(r, true);
  else {
    lastPlaying = !wantPause(r);
    partyPlay(!wantPause(r));
    const tgt = targetPos(st);
    if (Math.abs(tgt - m.pos) > 0.3) { expect = { to: tgt, until: performance.now() + 5000 }; partySeek(tgt); }
  }
  partyNotice('已同步到房间进度');
}

/** 在全局只启动一次（PartyBridge 里调用） */
export function startMusicParty(): () => void {
  if (started) return () => undefined;
  started = true;
  const u1 = onParty(onRoomChange);
  const u2 = listenMusic(onLocalChange);
  const u3 = onUserSeek(onSeekByUser);
  const t = window.setInterval(onTick, 1000);
  onRoomChange();
  return () => { started = false; u1(); u2(); u3(); window.clearInterval(t); musicPaused(); };
}
