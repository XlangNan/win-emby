// 刷刷看（只有安卓端）：把刷刷看自己选的根文件夹（和随便看看分开）连成一条抖音式信息流。
// 每个子文件夹（比如 宫保鸡丁）先依次播里面的视频，再是一条「图文」（里面的图片左右滑），
// 刷完往下滑就接着下一个子文件夹（鱼香肉丝）。上下滑切换，系统返回键退出。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useNavigate } from 'react-router-dom';
import { androidBridge, isMobileApp } from '../lib/platform';
import { winSetFullscreen } from '../lib/win';
import { dsmConnected, dsmDirs, dsmImage, dsmList, dsmPlayUrl, fmtClock, isImage, isVideoFile, isWebVideo, loadFeedFolder, saveFeedFolder, setPlayQueue, type DsmEntry, type LocalVideo } from './dsm';

type Post = ({ kind: 'video'; e: DsmEntry } | { kind: 'images'; es: DsmEntry[] }) & { group: string };
const titleOf = (n: string): string => n.replace(/\.[^.]+$/, '');
const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

// ───────── 一条图文：左右滑 ─────────
function ImgSlide({ e, near }: { e: DsmEntry; near: boolean }) {
  const [url, setUrl] = useState('');
  const [bad, setBad] = useState(false);
  const tries = useRef(0);
  useEffect(() => {
    if (!near || url) return;
    let dead = false;
    dsmImage(e.path).then((u) => { if (!dead) setUrl(u); }).catch(() => { if (!dead) setBad(true); });
    return () => { dead = true; };
  }, [near, e.path, url]);
  return (
    <div className="fd-slide">
      {url ? <img src={url} alt={e.name} draggable={false} onError={() => { if (tries.current++ < 2) setUrl(''); else setBad(true); }} /> : <span className="fd-dim">{bad ? '这张图片读不出来' : '加载中…'}</span>}
    </div>
  );
}

function ImagesPost({ es, active, name }: { es: DsmEntry[]; active: boolean; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(0);
  const onScroll = (): void => {
    const el = ref.current;
    if (el) setCur(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  };
  return (
    <div className="fd-post">
      <div className="fd-imgs" ref={ref} onScroll={onScroll}>
        {es.map((e, i) => <ImgSlide key={e.path} e={e} near={active && Math.abs(i - cur) <= 1} />)}
      </div>
      <div className="fd-info"><b>{name}</b><span>图片 {cur + 1}/{es.length}</span></div>
      {es.length > 1 && (
        <>
          <div className="fd-cnt">{cur + 1}/{es.length}</div>
          <div className="fd-dots">{es.length <= 12 ? es.map((e, i) => <i key={e.path} className={i === cur ? 'on' : ''} />) : null}</div>
        </>
      )}
    </div>
  );
}

// ───────── 一条视频 ─────────
function VideoPost({ e, active, near, name, onExternal, onTouched }: { e: DsmEntry; active: boolean; near: boolean; name: string; onExternal: () => void; onTouched: () => void }) {
  const v = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState('');
  const [paused, setPaused] = useState(false);
  const [muted, setMutedS] = useState(feedMuted);
  const setMuted = (m: boolean): void => { feedMuted = m; setMutedS(m); };
  const [bad, setBad] = useState(false);
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  const retried = useRef(false);
  const web = isWebVideo(e.name);
  // 手势：左右滑 = 快进 / 快退（整屏宽 = 整个视频，最长按 3 分钟算，松手才跳转）；
  //       屏幕最左 / 最右各 20% 竖着滑 = 亮度 / 音量（中间竖着滑仍是切换视频）
  const g = useRef<{ x: number; y: number; id: number; mode: '' | 'h' | 'bri' | 'vol'; from: number; zone: '' | 'bri' | 'vol'; base: number } | null>(null);
  const swallow = useRef(false);
  const [pv, setPv] = useState<number | null>(null);
  const [hud, setHud] = useState<{ t: string; p: number } | null>(null);
  const hudT = useRef(0);
  const showHud = (t: string, p: number): void => { setHud({ t, p }); window.clearTimeout(hudT.current); hudT.current = window.setTimeout(() => setHud(null), 700); };
  const range = (): number => Math.max(10, Math.min(d || 60, 180));
  const target = (dx: number, w: number, from: number): number => Math.max(0, Math.min(d || 0, from + (dx / Math.max(1, w)) * range()));
  const pDown = (ev: React.PointerEvent<HTMLDivElement>): void => {
    if (!web || bad || (ev.target as HTMLElement).closest('button,.fd-seek')) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const fx = (ev.clientX - r.left) / Math.max(1, r.width);
    g.current = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, mode: '', from: v.current?.currentTime ?? 0, zone: fx < 0.2 ? 'bri' : fx > 0.8 ? 'vol' : '', base: 0 };
  };
  const pMove = (ev: React.PointerEvent<HTMLDivElement>): void => {
    const s = g.current;
    if (!s || s.id !== ev.pointerId) return;
    const dx = ev.clientX - s.x, dy = ev.clientY - s.y;
    if (!s.mode) {
      if (s.zone && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 1.4) {
        s.mode = s.zone;
        const br = androidBridge();
        s.base = s.zone === 'bri' ? br?.getBrightness() ?? 0.5 : br ? br.getSysVolume() : v.current?.volume ?? 1;
        onTouched();
      } else if (d && Math.abs(dx) >= 12 && Math.abs(dx) >= Math.abs(dy) * 1.4) s.mode = 'h'; // 够横：快进快退
      else return; // 还没分出方向，或者是中间竖滑（切换视频）
      try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    }
    if (s.mode === 'h') { setPv(target(dx, ev.currentTarget.clientWidth, s.from)); return; }
    const h = Math.max(1, ev.currentTarget.clientHeight);
    const val = Math.max(s.mode === 'bri' ? 0.02 : 0, Math.min(1, s.base - (dy / h) * 1.3));
    const br = androidBridge();
    if (s.mode === 'bri') { br?.setBrightness(val); showHud(`亮度 ${Math.round(val * 100)}%`, val); }
    else {
      if (br) br.setSysVolume(val); else if (v.current) v.current.volume = val;
      showHud(`音量 ${Math.round(val * 100)}%`, val);
    }
  };
  const pUp = (ev: React.PointerEvent<HTMLDivElement>): void => {
    const s = g.current;
    g.current = null;
    if (!s || !s.mode) return;
    swallow.current = true; setTimeout(() => { swallow.current = false; }, 350); // 滑完不要当成「点一下暂停」
    if (s.mode === 'h') {
      const el = v.current;
      if (el) el.currentTime = target(ev.clientX - s.x, ev.currentTarget.clientWidth, s.from);
      setPv(null);
    }
  };
  const pCancel = (): void => { g.current = null; setPv(null); };

  useEffect(() => {
    if (!near || !web || src) return;
    let dead = false;
    dsmPlayUrl(e.path).then((u) => { if (!dead) setSrc(u); }).catch(() => { if (!dead) setBad(true); });
    return () => { dead = true; };
  }, [near, web, e.path, src]);

  useEffect(() => {
    const el = v.current;
    if (!el || !src) return;
    if (!active) { el.pause(); return; }
    el.currentTime = 0;
    el.muted = feedMuted;
    el.play().then(() => setPaused(false)).catch(() => {
      // 系统不让带声音自动播放：先静音放，让用户点右下角开声
      el.muted = true; setMuted(true);
      el.play().then(() => setPaused(false)).catch(() => setPaused(true));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, src]);

  const onErr = (): void => {
    if (!retried.current) { // 会话可能过期：重新登录取一个新地址再试一次
      retried.current = true;
      dsmPlayUrl(e.path, true).then(setSrc).catch(() => setBad(true));
      return;
    }
    setBad(true);
  };
  const tap = (): void => {
    const el = v.current;
    if (!el || swallow.current) return;
    if (el.paused) { void el.play(); setPaused(false); } else { el.pause(); setPaused(true); }
  };
  const seek = (ev: React.PointerEvent<HTMLDivElement>): void => {
    const el = v.current; if (!el || !d) return;
    const r = ev.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * d;
  };

  return (
    <div className="fd-post fd-vpost" onClick={(ev) => { if (!(ev.target as HTMLElement).closest('button,.fd-seek')) tap(); }} onPointerDown={pDown} onPointerMove={pMove} onPointerUp={pUp} onPointerCancel={pCancel}>
      {web && !bad && src && (
        <video ref={v} src={src} playsInline loop preload={active ? 'auto' : 'metadata'} className="fd-video"
          onTimeUpdate={(ev) => setT(ev.currentTarget.currentTime)} onLoadedMetadata={(ev) => setD(ev.currentTarget.duration || 0)} onError={onErr} />
      )}
      {web && !bad && !src && <span className="fd-dim">加载中…</span>}
      {(!web || bad) && (
        <div className="fd-ext">
          <div className="fd-ext-t">{e.name}</div>
          <p>{web ? '这个视频读取失败了' : '这种格式手机内置播放器放不了'}，用 MPV 播放器打开。</p>
          <button onClick={onExternal}>用 MPV 播放</button>
        </div>
      )}
      {paused && web && !bad && pv === null && <div className="fd-pp" aria-hidden="true"><svg width="44" height="44" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" /></svg></div>}
      {hud && <div className="fd-hud fd-hud2"><span>{hud.t}</span><i><u style={{ width: `${hud.p * 100}%` }} /></i></div>}
      {web && !bad && <><div className="fd-edge fd-edge-l" /><div className="fd-edge fd-edge-r" /></>}
      {pv !== null && <div className="fd-hud"><b>{fmtClock(pv)}</b> / {fmtClock(d)}<small>{pv - t >= 0 ? '+' : '−'}{Math.round(Math.abs(pv - t))} 秒</small></div>}
      <div className="fd-info"><b>{titleOf(e.name)}</b><span>{name}</span></div>
      {web && !bad && (
        <>
          <button className="fd-mute" aria-label={muted ? '开声音' : '静音'} onClick={() => { const el = v.current; const m = !muted; setMuted(m); if (el) el.muted = m; }}>{muted ? '🔇' : '🔊'}</button>
          <div className="fd-seek" onPointerDown={(ev) => { ev.currentTarget.setPointerCapture(ev.pointerId); seek(ev); }} onPointerMove={(ev) => { if (ev.buttons) seek(ev); }}>
            <i style={{ width: `${d ? ((pv ?? t) / d) * 100 : 0}%` }} />
          </div>
        </>
      )}
    </div>
  );
}

// ───────── 读取：根文件夹下所有子文件夹，按名称排好 ─────────
/** 群晖自己生成的 @eaDir（缩略图）、#recycle（回收站）、@tmp，和 . 开头的隐藏文件，都不是内容 */
const hidden = (n: string): boolean => /^[@#.]/.test(n) || n === 'Thumbs.db';
let feedMuted = false; // 声音开关记住，不用每个视频都重新开

const MAX_DEPTH = 15;   // 最多往下读几层
const MAX_DIRS = 800;  // 最多读多少个文件夹

interface Group { name: string; vids: DsmEntry[]; imgs: DsmEntry[] }

async function loadGroups(root: string, onProgress: (n: number) => void): Promise<Group[]> {
  const lists = new Map<string, DsmEntry[]>();
  const order: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  let busy = 0, done = 0;
  await new Promise<void>((resolve, reject) => {
    const pump = (): void => {
      while (busy < 6 && queue.length && lists.size + busy < MAX_DIRS) {
        const it = queue.shift()!;
        busy++;
        dsmList(it.path).then((rows) => {
          lists.set(it.path, rows);
          if (it.depth < MAX_DEPTH) for (const d of rows.filter((r) => r.isdir && !hidden(r.name))) queue.push({ path: d.path, depth: it.depth + 1 });
        }).catch((e) => { if (it.depth === 0) reject(e); /* 子文件夹读不了就跳过 */ }).finally(() => { busy--; done++; onProgress(done); if (!busy && (!queue.length || lists.size + busy >= MAX_DIRS)) resolve(); else pump(); });
      }
    };
    pump();
  });
  // 深度优先：自己的内容在前，再依次是子文件夹
  const walk = (path: string): void => {
    order.push(path);
    for (const d of (lists.get(path) || []).filter((r) => r.isdir && !hidden(r.name))) if (lists.has(d.path)) walk(d.path);
  };
  walk(root);
  const out: Group[] = [];
  for (const path of order) {
    const rows = lists.get(path) || [];
    const vids = rows.filter((r) => !r.isdir && !hidden(r.name) && isVideoFile(r.name));
    const imgs = rows.filter((r) => !r.isdir && !hidden(r.name) && isImage(r.name));
    if (vids.length || imgs.length) {
      // 播放单元 = 直接放着视频 / 图片的那一层文件夹；名字带上上一级（2026 / 宫保鸡丁），不同年份下的同名文件夹才分得开
      const rel = path === root ? [] : path.slice(root.length).split('/').filter(Boolean);
      const name = rel.length === 0 ? baseName(root) || '根目录' : rel.slice(-2).join(' / ');
      out.push({ name, vids, imgs });
    }
  }
  return out;
}

// ───────── 选刷刷看的文件夹 ─────────
function FolderPick({ init, onPick, onClose }: { init: string; onPick: (p: string) => void; onClose: () => void }) {
  const [path, setPath] = useState(init);
  const [rows, setRows] = useState<DsmEntry[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false;
    setRows(null); setErr('');
    dsmDirs(path).then((r) => { if (!dead) setRows(r); }).catch((e) => { if (!dead) { setErr(e instanceof Error ? e.message : String(e)); setRows([]); } });
    return () => { dead = true; };
  }, [path]);
  const up = (): void => setPath(path.lastIndexOf('/') <= 0 ? '' : path.slice(0, path.lastIndexOf('/')));
  return createPortal(
    <div className="fd-pick">
      <div className="fd-pick-h"><button className="fd-pick-x" onClick={onClose} aria-label="返回">‹</button><b>选刷刷看的文件夹</b></div>
      <div className="lc-path">{path || '先点进一个文件夹（这里和「随便看看」的文件夹是分开的）'}</div>
      <div className="lc-rows fd-pick-rows">
        {path && <button className="lc-row" onClick={up}>‹ 上一级</button>}
        {rows === null && <div className="lc-empty">读取中…</div>}
        {rows?.map((r) => <button key={r.path} className="lc-row" onClick={() => setPath(r.path)}>📁 {r.name}</button>)}
        {rows && rows.length === 0 && !err && <div className="lc-empty">这里没有子文件夹了</div>}
      </div>
      {err && <div className="lc-err">{err}</div>}
      <div className="lc-acts fd-pick-f"><button className="lc-pri" disabled={!path} onClick={() => onPick(path)}>{path ? '就用这个文件夹' : '先点进一个文件夹'}</button></div>
    </div>,
    document.body,
  );
}

const POS_KEY = 'wemby-feed-pos';
const postKey = (p: Post): string => (p.kind === 'video' ? p.e.path : p.es[0].path);

// ───────── 全屏浏览 ─────────
function Viewer({ posts, start, root, onClose, onSettings, onExternal }: { posts: Post[]; start: number; root: string; onClose: () => void; onSettings: () => void; onExternal: (e: DsmEntry, group: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [act, setAct] = useState(start);
  const actR = useRef(start);
  actR.current = act;
  const [land, setLand] = useState(false);
  const touched = useRef(false);
  const onTouched = useCallback(() => { touched.current = true; }, []);
  const rotate = (): void => { touched.current = true; const n = !land; setLand(n); void winSetFullscreen(n); };
  // 横竖屏切换后窗口高度变了：重新对齐到当前这一条，别停在两条中间
  useEffect(() => {
    const f = (): void => { const el = box.current; if (el) { el.style.scrollSnapType = 'none'; el.scrollTop = actR.current * el.clientHeight; requestAnimationFrame(() => { if (el) el.style.scrollSnapType = ''; }); } };
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  // 退出时还原：横屏 → 竖屏，手势改过的亮度回到系统亮度（原生那边 setFullscreen(false) 一起做了）
  useEffect(() => () => { if (touched.current) void winSetFullscreen(false); }, []);
  useEffect(() => { const el = box.current; if (el && start > 0) el.scrollTop = start * el.clientHeight; }, [start]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      for (const x of es) if (x.isIntersecting && x.intersectionRatio > 0.6) setAct(Number((x.target as HTMLElement).dataset.i));
    }, { root: el, threshold: [0.6] });
    el.querySelectorAll('[data-i]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [posts]);
  useEffect(() => {
    const p = posts[act];
    if (p) try { localStorage.setItem(POS_KEY, JSON.stringify({ root, key: postKey(p) })); } catch { /* ignore */ }
  }, [act, posts, root]);
  return createPortal(
    <div className="fd-v">
      <div className="fd-scroll" ref={box}>
        {posts.map((p, i) => (
          <div key={postKey(p)} className="fd-cell" data-i={i}>
            {Math.abs(i - act) <= 1 ? (
              p.kind === 'video'
                ? <VideoPost e={p.e} active={i === act} near name={p.group} onExternal={() => onExternal(p.e, p.group)} onTouched={onTouched} />
                : <ImagesPost es={p.es} active={i === act} name={p.group} />
            ) : null}
          </div>
        ))}
      </div>
      <button className="fd-x" aria-label="返回" onClick={onClose}>‹</button>
      <button className="fd-set" aria-label="换文件夹" onClick={onSettings}>📁</button>
      <button className="fd-rot" aria-label={land ? '竖屏' : '横屏'} onClick={rotate}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="12" rx="2" transform={land ? 'rotate(90 12 12)' : undefined} /><path d="M12 15.5h.01" /></svg></button>
      <div className="fd-pg">{posts[act]?.group}　{act + 1}/{posts.length}</div>
    </div>,
    document.body,
  );
}

function FeedInner() {
  const nav = useNavigate();
  const [root, setRoot] = useState(loadFeedFolder());
  const [picking, setPicking] = useState(!loadFeedFolder());
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [n, setN] = useState(0);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!root) return;
    let dead = false;
    setGroups(null); setErr('');
    loadGroups(root, (k) => { if (!dead) setN(k); }).then((g) => { if (!dead) setGroups(g); }).catch((e) => { if (!dead) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { dead = true; };
  }, [root, tick]);

  // 每个文件夹：先视频，后一条图文
  const posts = useMemo<Post[]>(() => {
    const out: Post[] = [];
    for (const g of groups || []) {
      for (const e of g.vids) out.push({ kind: 'video', e, group: g.name });
      if (g.imgs.length) out.push({ kind: 'images', es: g.imgs, group: g.name });
    }
    return out;
  }, [groups]);

  const start = useMemo(() => {
    try {
      const o = JSON.parse(localStorage.getItem(POS_KEY) || 'null') as { root: string; key: string } | null;
      if (o && o.root === root) { const i = posts.findIndex((p) => postKey(p) === o.key); if (i > 0) return i; }
    } catch { /* ignore */ }
    return 0;
  }, [posts, root]);

  const external = (e: DsmEntry, group: string): void => {
    const vids = posts.filter((p): p is Extract<Post, { kind: 'video' }> => p.kind === 'video' && p.group === group).map((p) => p.e);
    const items: LocalVideo[] = vids.map((x) => ({ path: x.path, name: x.name, title: titleOf(x.name), size: x.size, mtime: x.mtime, list: group }));
    setPlayQueue(items, Math.max(0, vids.findIndex((x) => x.path === e.path)), group);
    nav('/local/play');
  };
  const back = (): void => { if (window.history.length > 1) nav(-1); else nav('/local', { replace: true }); };

  const picker = picking ? (
    <FolderPick init={root} onClose={() => { if (root) setPicking(false); else back(); }} onPick={(p) => { saveFeedFolder(p); setRoot(p); setPicking(false); }} />
  ) : null;
  if (!root) return picker;
  if (groups && posts.length > 0) return <><Viewer posts={posts} start={start} root={root} onClose={back} onSettings={() => setPicking(true)} onExternal={external} />{picker}</>;
  return createPortal(
    <div className="fd-v fd-load">
      <button className="fd-x" aria-label="返回" onClick={back}>‹</button>
      <button className="fd-set" aria-label="换文件夹" onClick={() => setPicking(true)}>📁</button>
      {picker}
      {err ? (
        <div className="fd-ext"><p>{err}</p><button onClick={() => setTick(tick + 1)}>重试</button></div>
      ) : groups ? (
        <div className="fd-ext"><p>这个文件夹里没有视频和图片。可以到随便看看里换一个文件夹。</p></div>
      ) : (
        <div className="fd-ext"><span className="spinner" aria-hidden="true" /><p>正在读取文件夹…（已读 {n} 个）</p></div>
      )}
    </div>,
    document.body,
  );
}

export default function FeedPage() {
  if (!isMobileApp || !dsmConnected()) return <Navigate to="/local" replace />;
  return <FeedInner />;
}
