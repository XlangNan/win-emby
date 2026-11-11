// 织影「一起看」中转服务：房间 / 同步 / Emby 身份验证 / 管理网页。零依赖，只要 Node 18+。
// 环境变量：EMBY_URL（用来验证登录，必填）  ADMIN_PASSWORD（管理网页密码，不设则不开放）  PORT（默认 8787）
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8787);
const EMBY_URL = (process.env.EMBY_URL || '').replace(/\/+$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const IDLE_MS = 30000; // 超过这么久没有任何请求 = 掉线
const HOLD_MAX_MS = 25000; // 等某个人缓冲最多等这么久
const STARTED = Date.now();

/** @type {Map<string, any>} */ const rooms = new Map();
/** @type {Map<string, any>} */ const clients = new Map(); // cid -> {cid,name,userId,room,seen}
let ver = 1;
const waiters = new Set(); // 长轮询
const bump = () => { ver++; for (const w of [...waiters]) w.fire(); };

const now = () => Date.now();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ───────── Emby 身份验证 ─────────
const authCache = new Map(); // token+userId -> {name, exp}
async function verify(token, userId) {
  if (!token || !userId) return null;
  if (!EMBY_URL) return { name: 'user' };
  const k = token + '|' + userId;
  const c = authCache.get(k);
  if (c && c.exp > now()) return c;
  try {
    const r = await fetch(`${EMBY_URL}/emby/Users/${encodeURIComponent(userId)}`, { headers: { 'X-Emby-Token': token }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const u = await r.json();
    if (!u || u.Id !== userId) return null;
    const v = { name: u.Name || 'user', exp: now() + 5 * 60 * 1000 };
    authCache.set(k, v);
    return v;
  } catch (e) { log('verify fail', e.message); return null; }
}

// ───────── 房间逻辑 ─────────
const rid = () => { for (;;) { const s = String(crypto.randomInt(0, 1000000)).padStart(6, '0'); if (!rooms.has(s)) return s; } };
const targetPos = (st, t = now()) => (st.paused || st.hold ? st.pos : st.pos + ((t - st.at) / 1000) * st.rate);
const itemOf = (x) => ({ id: String(x.id || ''), name: String(x.name || '').slice(0, 120), seriesId: x.seriesId ? String(x.seriesId) : '', seriesName: String(x.seriesName || '').slice(0, 120), s: x.s == null ? null : Number(x.s), e: x.e == null ? null : Number(x.e) });

function freeze(r) { // 把位置推进到「现在」再改状态
  const st = r.state; st.pos = targetPos(st); st.at = now();
}
function recomputeHold(r) {
  const t = now();
  for (const m of r.members.values()) if (m.buf && m.bufAt && t - m.bufAt > HOLD_MAX_MS) { m.buf = false; }
  const want = r.wait && [...r.members.values()].some((m) => m.buf);
  if (want !== r.state.hold) { freeze(r); r.state.hold = want; r.state.seq++; r.state.by = ''; r.state.why = want ? 'hold' : 'release'; }
}
function leaveRoom(c, why) {
  const r = c.room && rooms.get(c.room); c.room = '';
  if (!r) return;
  r.members.delete(c.cid);
  if (r.members.size === 0) { rooms.delete(r.id); log('room closed (empty)', r.id); return; }
  if (r.host === c.cid) { r.host = r.members.keys().next().value; }
  recomputeHold(r);
  log('leave', c.name, r.id, why || '');
}
function sweep() {
  const t = now();
  for (const c of [...clients.values()]) if (t - c.seen > IDLE_MS) { leaveRoom(c, 'idle'); clients.delete(c.cid); bump(); }
  for (const r of rooms.values()) { const h = r.state.hold; recomputeHold(r); if (h !== r.state.hold) bump(); }
}
setInterval(sweep, 3000).unref();

const summary = (r) => ({ id: r.id, host: r.members.get(r.host)?.name || '', item: r.state.item, count: r.members.size, paused: r.state.paused });
function snap(c) {
  const r = c.room && rooms.get(c.room);
  return {
    ver, now: now(),
    rooms: [...rooms.values()].filter((x) => x.pub).map(summary),
    room: r ? {
      id: r.id, pub: r.pub, ctl: r.ctl, wait: r.wait, host: r.host,
      members: [...r.members.values()].map((m) => ({ cid: m.cid, name: m.name, buf: m.buf })),
      state: r.state,
    } : null,
    kicked: c.kicked || '',
  };
}

function apply(c, o) {
  const k = o.kind;
  if (k === 'create') {
    leaveRoom(c);
    const item = itemOf(o.item || {});
    if (!item.id) return 'bad item';
    const r = { id: rid(), pub: o.pub !== false, ctl: o.ctl === 'host' ? 'host' : 'all', wait: o.wait !== false, host: c.cid, created: now(), members: new Map(), log: [],
      state: { item, paused: false, pos: Number(o.pos) || 0, rate: 1, at: now(), hold: false, seq: 1, by: c.cid, why: 'create' } };
    r.members.set(c.cid, { cid: c.cid, name: c.name, buf: !o.ready, bufAt: o.ready ? 0 : now(), joined: now(), pos: 0, lag: 0 });
    rooms.set(r.id, r); c.room = r.id; // 创建者如果还没开始播（ready 不为真），先算「加载中」
    pushLog(r, c.name, '创建房间');
    log('create', c.name, r.id, item.name);
    return '';
  }
  if (k === 'join') {
    const r = rooms.get(String(o.room || '').trim());
    if (!r) return '房间不存在或已关闭';
    if (c.room !== r.id) {
      leaveRoom(c);
      r.members.set(c.cid, { cid: c.cid, name: c.name, buf: true, bufAt: now(), joined: now(), pos: 0, lag: 0 });
      c.room = r.id; pushLog(r, c.name, '加入'); recomputeHold(r);
    }
    return '';
  }
  if (k === 'leave') { const r = c.room && rooms.get(c.room); if (r) pushLog(r, c.name, '离开'); leaveRoom(c, 'leave'); return ''; }
  const r = c.room && rooms.get(c.room);
  if (!r) return k === 'hb' ? '' : '不在房间里';
  const m = r.members.get(c.cid);
  if (k === 'hb') { m.pos = Number(o.pos) || 0; return ''; }
  if (k === 'buf') {
    const on = !!o.on; if (m.buf === on) return '';
    m.buf = on; m.bufAt = on ? now() : 0; recomputeHold(r); return '';
  }
  // 以下都是控制操作
  if (r.ctl === 'host' && r.host !== c.cid) return '只有房主能控制';
  const st = r.state;
  // 客户端给出它估算的服务端时间，用来抵消网络延迟；限制在 [-3s, 0]
  const at = Math.min(now(), Math.max(now() - 3000, Number(o.at) || now()));
  if (k === 'play' || k === 'pause') {
    st.pos = Number.isFinite(+o.pos) ? Number(o.pos) : targetPos(st); st.at = at; st.paused = k === 'pause';
    pushLog(r, c.name, (k === 'pause' ? '暂停 ' : '播放 ') + fmt(st.pos));
  } else if (k === 'seek') {
    st.pos = Math.max(0, Number(o.pos) || 0); st.at = at; pushLog(r, c.name, '拖到 ' + fmt(st.pos));
  } else if (k === 'rate') {
    const rt = Math.min(4, Math.max(0.25, Number(o.rate) || 1));
    st.pos = Number.isFinite(+o.pos) ? Number(o.pos) : targetPos(st); st.at = at; st.rate = rt; pushLog(r, c.name, `倍速 ${rt}x`);
  } else if (k === 'item') {
    const item = itemOf(o.item || {}); if (!item.id) return 'bad item';
    if (item.id === st.item.id) return ''; // 大家几乎同时播到片尾、都发来「下一集」：只认第一个
    st.item = item; st.pos = 0; st.at = now(); st.paused = false; st.hold = false; st.rate = 1;
    for (const x of r.members.values()) { x.buf = true; x.bufAt = now(); } // 大家都在加载新的一集
    pushLog(r, c.name, '切换到 ' + (item.seriesName ? item.seriesName + ' ' : '') + item.name);
  } else return 'bad kind';
  st.by = c.cid; st.seq++; st.why = k;
  recomputeHold(r);
  return '';
}
const fmt = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
function pushLog(r, who, what) { r.log.push({ t: now(), who, what }); if (r.log.length > 60) r.log.shift(); }

// ───────── HTTP ─────────
function body(req) {
  return new Promise((res) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > 20000) req.destroy(); }); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch { res({}); } }); });
}
const send = (res, code, obj) => { const s = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end(s); };
const cors = (res) => { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Max-Age': '600' }); res.end(); };

async function client(req, url, o) {
  const cid = String(url.searchParams.get('cid') || o.cid || '').slice(0, 64);
  const token = req.headers['x-emby-token'] || '', userId = req.headers['x-emby-userid'] || '';
  if (!cid) return null;
  const v = await verify(String(token), String(userId));
  if (!v) return null;
  let c = clients.get(cid);
  if (!c) { c = { cid, name: v.name, userId, room: '', seen: now(), kicked: '' }; clients.set(cid, c); }
  c.name = v.name; c.seen = now();
  return c;
}

const adminOk = (req) => {
  if (!ADMIN_PASSWORD) return false;
  const a = Buffer.from(String(req.headers['x-admin-password'] || '')), b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const adminState = () => ({
  now: now(), up: now() - STARTED, online: clients.size, ver,
  rooms: [...rooms.values()].map((r) => ({
    id: r.id, pub: r.pub, ctl: r.ctl, wait: r.wait, host: r.host, created: r.created, state: r.state, target: targetPos(r.state),
    members: [...r.members.values()].map((m) => ({ cid: m.cid, name: m.name, buf: m.buf, joined: m.joined, pos: m.pos, host: m.cid === r.host })),
    log: r.log.slice(-30),
  })),
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'OPTIONS') return cors(res);
    if (p === '/api/time') return send(res, 200, { now: now() });
    if (p === '/api/health') return send(res, 200, { ok: true, rooms: rooms.size, emby: !!EMBY_URL });
    if (p === '/api/sync') { // 长轮询：版本有变化（或 20 秒到）才返回
      const c = await client(req, url, {});
      if (!c) return send(res, 401, { error: '登录验证失败（Emby 令牌无效，或服务端的 EMBY_URL 填错）' });
      const since = Number(url.searchParams.get('ver') || 0);
      if (since !== ver || c.kicked) { const s = snap(c); c.kicked = ''; return send(res, 200, s); }
      const w = { fire: () => { clearTimeout(t); waiters.delete(w); c.seen = now(); const s = snap(c); c.kicked = ''; if (!res.writableEnded) send(res, 200, s); } };
      const t = setTimeout(() => { waiters.delete(w); c.seen = now(); if (!res.writableEnded) send(res, 200, snap(c)); }, 20000);
      waiters.add(w); req.on('close', () => { clearTimeout(t); waiters.delete(w); });
      return;
    }
    if (p === '/api/op' && req.method === 'POST') {
      const o = await body(req);
      const c = await client(req, url, o);
      if (!c) return send(res, 401, { error: '登录验证失败' });
      const before = ver;
      const err = apply(c, o);
      if (o.kind !== 'hb') bump();
      const s = snap(c); c.kicked = '';
      return send(res, 200, { ...s, error: err, was: before });
    }
    // ── 管理网页 ──
    if (p === '/admin' || p === '/admin/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(__dirname, 'admin.html'))); }
    if (p.startsWith('/admin/api/')) {
      if (!adminOk(req)) { await new Promise((r) => setTimeout(r, 600)); return send(res, 401, { error: ADMIN_PASSWORD ? '密码不对' : '服务端没有设置 ADMIN_PASSWORD，管理网页未开放' }); }
      if (p === '/admin/api/state') return send(res, 200, adminState());
      const o = await body(req); const r = rooms.get(String(o.room || ''));
      if (p === '/admin/api/close') { if (r) { for (const m of r.members.keys()) { const c = clients.get(m); if (c) { c.room = ''; c.kicked = '房间已被管理员关闭'; } } rooms.delete(r.id); log('admin close', r.id); bump(); } return send(res, 200, { ok: true }); }
      if (p === '/admin/api/kick') { const c = clients.get(String(o.cid || '')); if (r && c && c.room === r.id) { leaveRoom(c, 'kicked'); c.kicked = '你已被管理员移出房间'; bump(); } return send(res, 200, { ok: true }); }
      if (p === '/admin/api/vis') { if (r) { r.pub = !!o.pub; bump(); } return send(res, 200, { ok: true }); }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { log('error', e && e.stack || e); try { send(res, 500, { error: 'server error' }); } catch { /* ignore */ } }
});
server.keepAliveTimeout = 65000;
server.listen(PORT, () => log(`party server on :${PORT}  emby=${EMBY_URL || '(未设置，不验证身份)'}  admin=${ADMIN_PASSWORD ? 'on' : 'off'}`));
