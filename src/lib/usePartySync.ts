// 播放页的「一起看」同步：把本机的暂停 / 拖动 / 倍速 / 缓冲报告给房间，并把房间里别人的操作应用到本机播放器。
// 播放器只需提供一个 adapter（读位置、读写暂停和倍速、拖动），再在对应的事件里调用返回的 on* 函数。
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { EmbyItem } from '../emby/types';
import { canControl, cancelLeave, getParty, partyNotice, retain, scheduleLeave, sendOp, targetPos, toPartyItem, usePartyStore } from './party';

export interface PartyAdapter {
  /** 当前播放位置（秒，已按播放速度推算到「此刻」） */
  pos(): number;
  paused(): boolean;
  caching(): boolean;
  rate(): number;
  seek(sec: number): void;
  setPause(p: boolean): void;
  setRate(r: number): void;
}

export function usePartySync(id: string, adapter: React.MutableRefObject<PartyAdapter>) {
  const p = usePartyStore();
  const inRoom = !!p.room && p.room.state.item.id === id;
  const inRoomRef = useRef(inRoom);
  inRoomRef.current = inRoom;
  const aligned = useRef(false);
  const suppress = useRef(0);
  const lastSeq = useRef(-1);
  const appliedRate = useRef(1);
  const last = useRef<{ pos: number; wall: number } | null>(null);
  const bufSent = useRef(false);
  const bufTimer = useRef(0);
  // 直链上拖动进度要几秒才完成：这段时间里「位置跳了」是我们自己刚做的跳转，不能当成用户拖动再发回房间（否则两台设备互相来回拖，片源被反复请求）
  const expect = useRef<{ to: number; until: number } | null>(null);
  const lastDriftSeek = useRef(0);
  const doSeek = (sec: number): void => { expect.current = { to: sec, until: performance.now() + 8000 }; quiet(); adapter.current.seek(Math.max(0, sec)); };

  const quiet = (ms = 1500): void => { suppress.current = performance.now() + ms; };
  const act = (): boolean => aligned.current && inRoomRef.current && performance.now() > suppress.current;

  // 进入 / 离开播放页：保持连接；离开时稍后退出房间（换集重建组件时不退）
  useEffect(() => {
    cancelLeave();
    const rel = retain();
    return () => { rel(); window.clearTimeout(bufTimer.current); scheduleLeave(); };
  }, []);

  /** 把房间状态应用到本机 */
  const applyState = useCallback((withSeek: boolean): void => {
    const room = getParty().room;
    if (!room) return;
    const s = room.state;
    const ad = adapter.current;
    quiet();
    const wantPause = s.paused || s.hold;
    if (ad.paused() !== wantPause) ad.setPause(wantPause);
    if (Math.abs(ad.rate() - s.rate) > 0.001) { appliedRate.current = s.rate; ad.setRate(s.rate); }
    if (withSeek) {
      const tgt = targetPos(s);
      if (Math.abs(tgt - ad.pos()) > (aligned.current ? 0.8 : 1.5)) doSeek(tgt);
    }
  }, [adapter]);

  // 播放器开始出画面（或者播放中途才进房间）：对齐到房间，然后告诉房间「我准备好了」
  const started = useRef(false);
  const tryAlign = useCallback((): void => {
    if (!started.current || !inRoomRef.current || aligned.current) return;
    applyState(true);
    aligned.current = true;
    lastSeq.current = getParty().room?.state.seq ?? -1;
    void sendOp({ kind: 'buf', on: false });
  }, [applyState]);
  const onStarted = useCallback((): void => { started.current = true; tryAlign(); }, [tryAlign]);
  useEffect(() => { if (inRoom) tryAlign(); }, [inRoom, tryAlign]);

  // 别人的操作 / 等待缓冲状态变化
  const seq = p.room?.state.seq;
  useEffect(() => {
    if (!aligned.current || !inRoom || seq == null) return;
    if (seq === lastSeq.current) return;
    lastSeq.current = seq;
    const s = getParty().room!.state;
    if (s.by === getParty().cid) return; // 自己的操作，已经在本机生效
    applyState(true);
  }, [seq, inRoom, applyState]);

  // 漂移纠正：每秒比一次，小偏差悄悄调速追上，大偏差直接跳
  useEffect(() => {
    if (!inRoom) return;
    const t = window.setInterval(() => {
      if (!aligned.current) return;
      const room = getParty().room; if (!room) return;
      const s = room.state, ad = adapter.current;
      if (expect.current && performance.now() > expect.current.until) expect.current = null; // 跳转超时没等到结果：不再等
      if (s.paused || s.hold || ad.paused() || ad.caching() || expect.current) return;
      const diff = targetPos(s) - ad.pos();
      const a = Math.abs(diff);
      // 直链上每次跳转都是一次新的片源请求：请求太密片源会拒绝（403）。所以只有偏差很大才跳转（且有冷却），
      // 平时用微调播放速度慢慢追（落后 3 秒约 25 秒追上）
      if (a > 10) { if (performance.now() - lastDriftSeek.current > 20000) { lastDriftSeek.current = performance.now(); doSeek(targetPos(s)); } return; }
      const adj = a > 0.35 ? Math.max(-0.12, Math.min(0.12, diff / 10)) : 0;
      const want = s.rate * (1 + adj);
      if (Math.abs(ad.rate() - want) > 0.005) { quiet(800); appliedRate.current = want; ad.setRate(want); }
    }, 1000);
    return () => window.clearInterval(t);
  }, [inRoom, adapter]);

  // 心跳：告诉服务端我播到哪（管理网页用来看谁落后）
  useEffect(() => {
    if (!inRoom) return;
    const t = window.setInterval(() => { if (aligned.current) void sendOp({ kind: 'hb', pos: adapter.current.pos() }); }, 3000);
    return () => window.clearInterval(t);
  }, [inRoom, adapter]);

  const revert = useCallback((): void => {
    partyNotice('这个房间只有房主能控制');
    window.setTimeout(() => applyState(true), 50);
  }, [applyState]);

  const onPause = useCallback((paused: boolean): void => {
    if (!act()) return;
    if (!canControl()) return revert();
    void sendOp({ kind: paused ? 'pause' : 'play', pos: adapter.current.pos() });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, revert]);

  const onRate = useCallback((r: number): void => {
    if (!act() || Math.abs(r - appliedRate.current) < 0.001) return;
    if (!canControl()) return revert();
    appliedRate.current = r;
    void sendOp({ kind: 'rate', rate: r, pos: adapter.current.pos() });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, revert]);

  /** 每次收到播放位置时调用：位置突然跳了 = 有人拖了进度条 */
  const onTime = useCallback((pos: number): void => {
    const now = performance.now();
    const l = last.current;
    last.current = { pos, wall: now };
    const ex = expect.current;
    if (ex) { // 正在等自己发起的跳转完成
      if (now > ex.until || Math.abs(pos - ex.to) < 3.5) expect.current = null;
      return;
    }
    if (!l || !act()) return;
    const ad = adapter.current;
    const playing = !ad.paused() && !ad.caching();
    const exp = l.pos + (playing ? ((now - l.wall) / 1000) * ad.rate() : 0);
    if (Math.abs(pos - exp) < 2.2) return;
    if (!canControl()) return revert();
    void sendOp({ kind: 'seek', pos });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, revert]);

  /** 缓冲中（持续 0.8 秒以上才报告，避免抖动） */
  const onCache = useCallback((on: boolean): void => {
    window.clearTimeout(bufTimer.current);
    if (!inRoomRef.current || !aligned.current) return;
    if (on) bufTimer.current = window.setTimeout(() => { bufSent.current = true; void sendOp({ kind: 'buf', on: true }); }, 800);
    else if (bufSent.current) { bufSent.current = false; void sendOp({ kind: 'buf', on: false }); }
  }, []);

  /** 换集前调用：在房间里就通知所有人一起换；返回 false = 没有权限，别换 */
  const switchTo = useCallback((it: EmbyItem): boolean => {
    if (!inRoomRef.current) return true;
    if (!canControl()) { partyNotice('这个房间只有房主能换集'); return false; }
    void sendOp({ kind: 'item', item: toPartyItem(it) });
    return true;
  }, []);

  return useMemo(() => ({ inRoom, room: p.room, onStarted, onPause, onRate, onTime, onCache, switchTo }), [inRoom, p.room, onStarted, onPause, onRate, onTime, onCache, switchTo]);
}
