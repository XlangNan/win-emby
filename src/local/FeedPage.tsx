// 刷刷看（只有安卓端）：把「随便看看」选的根文件夹连成一条抖音式信息流。
// 每个子文件夹（比如 宫保鸡丁）先依次播里面的视频，再是一条「图文」（里面的图片左右滑），
// 刷完往下滑就接着下一个子文件夹（鱼香肉丝）。上下滑切换，系统返回键退出。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Navigate, useNavigate } from 'react-router-dom';
import { dsmConfigured, dsmImage, dsmList, dsmPlayUrl, isImage, isVideoFile, isWebVideo, loadDsm, setPlayQueue, type DsmEntry, type LocalVideo } from './dsm';
import { isMobileApp } from '../lib/platform';

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
function VideoPost({ e, active, near, name, onExternal }: { e: DsmEntry; active: boolean; near: boolean; name: string; onExternal: () => void }) {
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
    if (!el) return;
    if (el.paused) { void el.play(); setPaused(false); } else { el.pause(); setPaused(true); }
  };
  const seek = (ev: React.PointerEvent<HTMLDivElement>): void => {
    const el = v.current; if (!el || !d) return;
    const r = ev.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * d;
  };

  return (
    <div className="fd-post">
      {web && !bad && src && (
        <video ref={v} src={src} playsInline loop preload={active ? 'auto' : 'metadata'} className="fd-video" onClick={tap}
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
      {paused && web && !bad && <div className="fd-pp" aria-hidden="true">▶</div>}
      <div className="fd-info"><b>{titleOf(e.name)}</b><span>{name}</span></div>
      {web && !bad && (
        <>
          <button className="fd-mute" aria-label={muted ? '开声音' : '静音'} onClick={() => { const el = v.current; const m = !muted; setMuted(m); if (el) el.muted = m; }}>{muted ? '🔇' : '🔊'}</button>
          <div className="fd-seek" onPointerDown={(ev) => { ev.currentTarget.setPointerCapture(ev.pointerId); seek(ev); }} onPointerMove={(ev) => { if (ev.buttons) seek(ev); }}>
            <i style={{ width: `${d ? (t / d) * 100 : 0}%` }} />
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

interface Group { name: string; vids: DsmEntry[]; imgs: DsmEntry[] }

async function loadGroups(root: string, onProgress: (n: number) => void): Promise<Group[]> {
  const lists = new Map<string, DsmEntry[]>();
  const order: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  let busy = 0, done = 0;
  await new Promise<void>((resolve, reject) => {
    const pump = (): void => {
      while (busy < 4 && queue.length && lists.size + busy < 300) {
        const it = queue.shift()!;
        busy++;
        dsmList(it.path).then((rows) => {
          lists.set(it.path, rows);
          if (it.depth < 3) for (const d of rows.filter((r) => r.isdir && !hidden(r.name))) queue.push({ path: d.path, depth: it.depth + 1 });
        }).catch((e) => { if (it.depth === 0) reject(e); /* 子文件夹读不了就跳过 */ }).finally(() => { busy--; done++; onProgress(done); if (!busy && (!queue.length || lists.size + busy >= 300)) resolve(); else pump(); });
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
    if (vids.length || imgs.length) out.push({ name: path === root ? baseName(root) || '根目录' : baseName(path), vids, imgs });
  }
  return out;
}

const POS_KEY = 'wemby-feed-pos';
const postKey = (p: Post): string => (p.kind === 'video' ? p.e.path : p.es[0].path);

// ───────── 全屏浏览 ─────────
function Viewer({ posts, start, onClose, onExternal }: { posts: Post[]; start: number; onClose: () => void; onExternal: (e: DsmEntry, group: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [act, setAct] = useState(start);
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
    if (p) try { localStorage.setItem(POS_KEY, JSON.stringify({ root: loadDsm().folder, key: postKey(p) })); } catch { /* ignore */ }
  }, [act, posts]);
  return createPortal(
    <div className="fd-v">
      <div className="fd-scroll" ref={box}>
        {posts.map((p, i) => (
          <div key={postKey(p)} className="fd-cell" data-i={i}>
            {Math.abs(i - act) <= 1 ? (
              p.kind === 'video'
                ? <VideoPost e={p.e} active={i === act} near name={p.group} onExternal={() => onExternal(p.e, p.group)} />
                : <ImagesPost es={p.es} active={i === act} name={p.group} />
            ) : null}
          </div>
        ))}
      </div>
      <button className="fd-x" aria-label="返回" onClick={onClose}>‹</button>
      <div className="fd-pg">{posts[act]?.group}　{act + 1}/{posts.length}</div>
    </div>,
    document.body,
  );
}

function FeedInner() {
  const nav = useNavigate();
  const root = loadDsm().folder;
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [n, setN] = useState(0);
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
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

  if (groups && posts.length > 0) return <Viewer posts={posts} start={start} onClose={back} onExternal={external} />;
  return createPortal(
    <div className="fd-v fd-load">
      <button className="fd-x" aria-label="返回" onClick={back}>‹</button>
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
  if (!isMobileApp || !dsmConfigured()) return <Navigate to="/local" replace />;
  return <FeedInner />;
}
