// 「一起看」客户端：和中转服务（party-server）之间用 HTTP 长轮询通信（走 httpFetch，安卓 / iPad 局域网 http 也能用）。
// 模块级单例：播放页换集（组件重建）时房间不会断。
import { useSyncExternalStore } from 'react';
import { httpFetch } from '../emby/http';
import { deviceId, getSession } from '../emby/session';
import type { EmbyItem } from '../emby/types';

export interface PartyItem { id: string; name: string; seriesId: string; seriesName: string; s: number | null; e: number | null }
export interface PartyState { item: PartyItem; paused: boolean; pos: number; rate: number; at: number; hold: boolean; seq: number; by: string; why: string; qv?: number; index?: number }
/** 音乐房间里的一首歌（只带显示和取流需要的字段） */
export interface PartySong { id: string; title: string; artist: string; album: string; albumId: string; artistId: string; duration: number; coverArt: string; suffix: string }
export interface PartyRoom {
  type?: 'video' | 'music';
  id: string; pub: boolean; ctl: 'all' | 'host'; wait: boolean; host: string;
  members: { cid: string; name: string; buf: boolean; away?: boolean }[];
  state: PartyState;
}
export interface RoomSummary { type?: 'video' | 'music'; id: string; host: string; item: PartyItem; count: number; paused: boolean }
interface Snap { ver: number; now: number; rooms: RoomSummary[]; room: PartyRoom | null; kicked: string; error?: string }

export interface PartyStore {
  url: string;
  rooms: RoomSummary[];
  room: PartyRoom | null;
  cid: string;
  /** 与服务端连接是否正常 */
  online: boolean;
  /** 出错提示（令牌无效 / 连不上等），空 = 正常 */
  error: string;
  notice: string;
  noticeAt: number;
}

const URL_KEY = 'wemby-party-url';
export const partyUrl = (): string => { try { return (localStorage.getItem(URL_KEY) || '').trim().replace(/\/+$/, ''); } catch { return ''; } };
export function setPartyUrl(u: string): void {
  let v = u.trim().replace(/\/+$/, '');
  if (v && !/^https?:\/\//i.test(v)) v = 'http://' + v;
  try { localStorage.setItem(URL_KEY, v); } catch { /* ignore */ }
  st = { ...st, url: v, rooms: [], error: '', online: false };
  emit();
  restart();
}

export const toPartyItem = (it: EmbyItem): PartyItem => ({
  id: it.Id, name: it.Name || '', seriesId: it.SeriesId || '', seriesName: it.SeriesName || '',
  s: it.Type === 'Episode' ? it.ParentIndexNumber ?? null : null, e: it.Type === 'Episode' ? it.IndexNumber ?? null : null,
});
/** 房间卡片 / 面板里显示的标题：视频「剧名 S1E2」，音乐「歌名 - 歌手」 */
export const roomTitle = (r: { type?: string; item?: PartyItem; state?: PartyState }): string => {
  const it = (r.item || r.state?.item) as PartyItem;
  return r.type === 'music' ? `${it.name} - ${it.seriesName}` : partyItemTitle(it);
};
export const partyItemTitle = (p: PartyItem): string =>
  `${p.seriesName ? p.seriesName + ' ' : ''}${p.s != null && p.e != null ? `S${p.s}E${p.e} ` : ''}${p.seriesName ? '' : p.name}`.trim() || p.name;

let st: PartyStore = { url: partyUrl(), rooms: [], room: null, cid: deviceId(), online: false, error: '', notice: '', noticeAt: 0 };
const subs = new Set<() => void>();
const emit = (): void => { subs.forEach((f) => f()); };
export const getParty = (): PartyStore => st;
const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** 非 React 代码订阅房间状态变化 */
export const onParty = subscribe;
export const usePartyStore = (): PartyStore => useSyncExternalStore(subscribe, getParty);
function notice(t: string): void { st = { ...st, notice: t, noticeAt: Date.now() }; emit(); }
export const partyNotice = notice;

// ───────── 时钟：和服务端对齐 ─────────
let offset = 0; // 服务端时间 - 本机时间
let bestRtt = Infinity;
let lastClock = 0;
export const srvNow = (): number => Date.now() + offset;
/** 房间状态里的「现在应该播到第几秒」 */
export const targetPos = (s: PartyState, t = srvNow()): number => (s.paused || s.hold ? s.pos : s.pos + ((t - s.at) / 1000) * s.rate);

async function readJson<T>(r: Response): Promise<T> {
  const t = await r.text();
  try { return JSON.parse(t) as T; } catch { throw new Error(`服务返回了异常内容（HTTP ${r.status}）。请确认群晖上的一起看服务已更新，且反向代理没有拦截请求`); }
}
async function req(path: string, init?: RequestInit, ms = 15000): Promise<Response> {
  const s = getSession();
  if (!s) throw new Error('未登录');
  const ac = new AbortController();
  const tm = setTimeout(() => ac.abort(), ms);
  try {
    return await httpFetch(`${st.url}${path}${path.includes('?') ? '&' : '?'}cid=${encodeURIComponent(st.cid)}`, {
      ...init,
      signal: ac.signal,
      headers: { 'X-Emby-Token': s.token, 'X-Emby-UserId': s.userId, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } finally { clearTimeout(tm); }
}

async function syncClock(): Promise<void> {
  if (!st.url) return;
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    try {
      const r = await httpFetch(`${st.url}/api/time`);
      const j = (await r.json()) as { now: number };
      const t1 = Date.now(), rtt = t1 - t0;
      if (rtt <= bestRtt * 1.5 || i === 0) { offset = j.now - (t0 + rtt / 2); bestRtt = Math.min(bestRtt, rtt); }
    } catch { return; }
  }
  lastClock = Date.now();
}

// ───────── 轮询循环 ─────────
let loopId = 0;
let ver = 0;
let refs = 0; // 谁需要保持连接：首页（看房间列表）/ 在房间里
export function retain(): () => void {
  refs++; kick();
  let done = false;
  return () => { if (done) return; done = true; refs--; };
}
const wanted = (): boolean => !!st.url && !!getSession() && (refs > 0 || !!st.room);
function restart(): void { loopId++; ver = 0; lastClock = 0; kick(); }
function kick(): void { if (!running && wanted()) void loop(); }
let running = false;

function applySnap(j: Snap): void {
  ver = j.ver;
  const prev = st.room;
  const room = j.room;
  let n = st.notice, na = st.noticeAt;
  if (j.kicked) { n = j.kicked; na = Date.now(); }
  else if (prev && !room) { n = '已退出房间'; na = Date.now(); }
  // 房主换人了：提示一下
  if (prev && room && prev.host !== room.host) {
    const h = room.members.find((m) => m.cid === room.host);
    if (h) { n = `${h.name} 成为新房主`; na = Date.now(); }
  }
  st = { ...st, rooms: j.rooms || [], room, online: true, error: '', notice: n, noticeAt: na };
  emit();
  if (room) kick();
}

async function loop(): Promise<void> {
  if (running) return;
  running = true;
  const my = ++loopId;
  let fail = 0;
  try {
    while (my === loopId && wanted()) {
      try {
        if (Date.now() - lastClock > 60000) await syncClock();
        const r = await req(`/api/sync?ver=${ver}`, undefined, 30000);
        if (my !== loopId) break;
        if (r.status === 401) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          st = { ...st, online: false, error: j.error || '登录验证失败' }; emit();
          await sleep(15000); continue;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        applySnap(await readJson<Snap>(r));
        fail = 0;
      } catch (e) {
        if (my !== loopId) break;
        fail++;
        st = { ...st, online: false, error: `连不上一起看服务（${e instanceof Error ? e.message : '网络错误'}）` }; emit();
        await sleep(Math.min(10000, 1500 * fail));
      }
    }
  } finally { if (my === loopId) running = false; }
  if (my !== loopId) { running = false; kick(); }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ───────── 操作 ─────────
export interface OpBody { kind: string; [k: string]: unknown }
export async function sendOp(o: OpBody): Promise<string> {
  if (!st.url) return '还没有设置一起看服务地址';
  try {
    if (!lastClock) await syncClock();
    const r = await req('/api/op', { method: 'POST', body: JSON.stringify({ ...o, at: srvNow() }) });
    if (r.status === 401) return '登录验证失败（检查服务端的 EMBY_URL）';
    const j = await readJson<Snap>(r);
    applySnap(j);
    return j.error || '';
  } catch (e) { return `连不上一起看服务（${e instanceof Error ? e.message : '网络错误'}）`; }
}

export async function createRoom(item: EmbyItem, o: { pub: boolean; ctl: 'all' | 'host'; wait: boolean; pos: number; ready: boolean }): Promise<string> {
  cancelLeave();
  return sendOp({ kind: 'create', item: toPartyItem(item), pub: o.pub, ctl: o.ctl, wait: o.wait, pos: o.pos, ready: o.ready });
}
export async function joinRoom(room: string): Promise<string> { cancelLeave(); return sendOp({ kind: 'join', room: room.trim() }); }
export async function leaveRoom(): Promise<void> { cancelLeave(); if (st.room) await sendOp({ kind: 'leave' }); }

let leaveTimer = 0;
/** 离开播放页时调用：稍等一下，如果马上又进了同一个房间的播放页（换集）就不退 */
export function scheduleLeave(): void { cancelLeave(); if (st.room && st.room.type !== 'music') leaveTimer = window.setTimeout(() => { leaveTimer = 0; void leaveRoom(); }, 2500); }
export function cancelLeave(): void { if (leaveTimer) { window.clearTimeout(leaveTimer); leaveTimer = 0; } }

export const iAmHost = (): boolean => !!st.room && st.room.host === st.cid;
export const canControl = (): boolean => !st.room || st.room.ctl === 'all' || iAmHost();

// ───────── 音乐房间 ─────────
/** 队列太长就只带当前歌前后各 150 首（整个请求不要太大，反向代理会拦） */
function trimQueue(queue: PartySong[], index: number): { queue: PartySong[]; index: number } {
  if (queue.length <= 300) return { queue, index };
  const from = Math.max(0, Math.min(index - 150, queue.length - 300));
  return { queue: queue.slice(from, from + 300), index: index - from };
}
export async function createMusicRoom(queue: PartySong[], index: number, o: { pub: boolean; ctl: 'all' | 'host'; wait: boolean; pos: number }): Promise<string> {
  cancelLeave();
  ({ queue, index } = trimQueue(queue, index));
  return sendOp({ kind: 'create', type: 'music', queue, index, pub: o.pub, ctl: o.ctl, wait: o.wait, pos: o.pos, ready: true });
}
export async function fetchPartyQueue(room: string): Promise<{ qv: number; queue: PartySong[] } | null> {
  try {
    const r = await req(`/api/queue?room=${encodeURIComponent(room)}`);
    if (!r.ok) return null;
    return await readJson<{ qv: number; queue: PartySong[] }>(r);
  } catch { return null; }
}
