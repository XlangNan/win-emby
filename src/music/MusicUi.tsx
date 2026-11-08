// 音乐页面共用的小组件：图标、封面、歌曲行
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { coverUrl, nd, type Playlist, type Song } from './navidrome';
import { askText, toast } from './Dialog';
import { useBackClose } from './useBackClose';
import { enqueue, playNext, playQueue, setStarred, useMusic } from './player';

const P: Record<string, string> = {
  play: 'M7 4.5v15l13-7.5z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  prev: 'M18 5v14l-9-7zM5 5h2v14H5z',
  next: 'M6 5v14l9-7zM17 5h2v14h-2z',
  heart: 'M12 20.5s-8-4.7-8-10.6A4.4 4.4 0 0 1 12 7.4a4.4 4.4 0 0 1 8 2.5c0 5.9-8 10.6-8 10.6z',
  down: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
};
const STROKE: Record<string, string> = {
  shuffle: 'M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3',
  repeat: 'M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4',
  list: 'M4 6h16M4 12h16M4 18h10',
  search: 'M20 20l-4.2-4.2M11 17.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13z',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  vol: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  disc: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
  radio: 'M3 12a9 9 0 0 1 18 0M7 12a5 5 0 0 1 10 0M12 12h.01M5 16l-2 4M19 16l2 4',
  note: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 9 18zM19 16a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 19 16z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  fwd: 'M9 6l6 6-6 6',
};

const SOLID = new Set(['play', 'pause', 'prev', 'next']);
export function Ic({ n, size = 22, fill }: { n: string; size?: number; fill?: boolean }) {
  const d = P[n] ?? STROKE[n] ?? '';
  const solid = SOLID.has(n);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={solid || (n === 'heart' && fill) ? 'currentColor' : 'none'} stroke={solid ? 'none' : 'currentColor'} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const GRAD = ['#f0414b,#7a1c52', '#2f6f73,#0f2f3a', '#d9a441,#6b3a1f', '#4a5fc1,#1b1f4b', '#3fa66b,#124032', '#c2566b,#4a1830', '#7b5fc9,#2a1b5c', '#e0883e,#7a2d1c'];
export function Cover({ id, size = 300, radius, label, className }: { id?: string; size?: number; radius?: number | string; label?: string; className?: string }) {
  const [bad, setBad] = useState(false);
  const g = GRAD[(id || label || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % GRAD.length];
  const url = id ? coverUrl(id, size) : '';
  return (
    <div className={`mu-cover ${className || ''}`} style={{ background: `linear-gradient(135deg,${g})`, borderRadius: radius }}>
      {url && !bad ? <img src={url} alt="" loading="lazy" draggable={false} onError={() => setBad(true)} /> : <span className="mu-cover-ph">{(label || '♪').slice(0, 1)}</span>}
    </div>
  );
}

export const fmtTime = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/* ───────── 歌曲「···」菜单 ───────── */
export interface MenuCtx { onRemove?: () => void }
export function SongMenu({ s, anchor, onClose, ctx }: { s: Song; anchor: DOMRect; onClose: () => void; ctx?: MenuCtx }) {
  const nav = useNavigate();
  const [sub, setSub] = useState<'' | 'pl'>('');
  const [pls, setPls] = useState<Playlist[] | null>(null);
  const [msg, setMsg] = useState('');
  useBackClose(true, onClose);
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  useEffect(() => { if (sub === 'pl' && !pls) nd.playlists().then(setPls).catch(() => setPls([])); }, [sub, pls]);
  const W = 200;
  const left = Math.min(Math.max(8, anchor.right - W), window.innerWidth - W - 8);
  const below = anchor.bottom + 8;
  const top = below + 300 > window.innerHeight ? Math.max(8, anchor.top - 8 - (sub ? 300 : 290)) : below;
  const flash = (t: string): void => { setMsg(t); window.setTimeout(onClose, 900); };
  const item = (label: string, fn: () => void, icon?: string): React.ReactNode => (
    <button type="button" className="mu-menu-i" onClick={fn}>{icon && <Ic n={icon} size={16} />}<span>{label}</span></button>
  );
  const addTo = (id: string): void => { nd.addToPlaylist(id, [s.id]).then(() => flash('已添加到歌单'), (e: Error) => flash(e.message)); };
  const create = (): void => {
    askText('新建歌单', '歌单名称').then((name) => {
      if (!name) return;
      nd.createPlaylist(name, [s.id]).then(() => { window.dispatchEvent(new Event('wemby-nd-playlists')); toast('已创建并添加'); onClose(); }, (e: Error) => toast(e.message));
    });
  };
  return createPortal(
    <>
      <div className="mu-menu-mask" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="mu-menu" style={{ left, top, width: W }} role="menu">
        {msg ? <div className="mu-menu-msg">{msg}</div> : sub === 'pl' ? (
          <>
            {item('返回', () => setSub(''), 'back')}
            {item('新建歌单', create, 'plus')}
            <div className="mu-menu-list">{!pls ? <div className="mu-menu-msg">加载中…</div> : pls.length === 0 ? <div className="mu-menu-msg">还没有歌单</div> : pls.map((p) => <button key={p.id} type="button" className="mu-menu-i" onClick={() => addTo(p.id)}><span>{p.name}</span></button>)}</div>
          </>
        ) : (
          <>
            {item('下一首播放', () => { playNext([s]); flash('已加入下一首'); }, 'next')}
            {item('添加到播放队列', () => { enqueue([s]); flash('已加入队列'); }, 'list')}
            {item('添加到歌单', () => setSub('pl'), 'plus')}
            {item(s.starred ? '取消收藏' : '收藏', () => { nd.star(s.id, !s.starred).then(() => { setStarred(s.id, !s.starred); s.starred = !s.starred; flash(s.starred ? '已收藏' : '已取消'); }, () => flash('操作失败')); }, 'heart')}
            {s.albumId && item('查看专辑', () => { onClose(); nav(`/music/album/${s.albumId}`); }, 'disc')}
            {s.artistId && item('查看艺术家', () => { onClose(); nav(`/music/artist/${s.artistId}`); }, 'user')}
            {ctx?.onRemove && item('从歌单中删除', () => { ctx.onRemove?.(); onClose(); }, 'trash')}
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

/** 品质小标：无损 / 高解析 */
export function Quality({ s }: { s: Song }) {
  const lossless = /^(flac|alac|wav|ape|dsf|dff|aiff?)$/i.test(s.suffix);
  if (!lossless && s.bitRate < 320) return null;
  const hires = s.bitDepth > 16 || s.samplingRate > 48000;
  return <i className={`mu-q${hires ? ' hr' : ''}`}>{hires ? 'HR' : lossless ? 'SQ' : 'HQ'}</i>;
}

export function SongRow({ s, i, list, showCover, ctx, showAlbum = true }: { s: Song; i: number; list: Song[]; showArtist?: boolean; showCover?: boolean; ctx?: MenuCtx; showAlbum?: boolean }) {
  const m = useMusic();
  const active = m.cur?.id === s.id;
  const [star, setStar] = useState(s.starred);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  useEffect(() => setStar(s.starred), [s.starred]);
  const toggle = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const v = !star;
    setStar(v);
    setStarred(s.id, v);
    s.starred = v;
    nd.star(s.id, v).catch(() => setStar(!v));
  };
  return (
    <div className={`mu-song${active ? ' active' : ''}`} role="button" tabIndex={0} onClick={() => playQueue(list, i)}
      onContextMenu={(e) => { e.preventDefault(); setMenu(new DOMRect(e.clientX, e.clientY, 0, 0)); }}
      onKeyDown={(e) => { if (e.key === 'Enter') playQueue(list, i); }}>
      {showCover ? <Cover id={s.coverArt} size={80} className="mu-song-cv" /> : <span className="mu-song-no">{active ? <Ic n={m.playing ? 'vol' : 'play'} size={15} /> : String(i + 1).padStart(2, '0')}</span>}
      <span className="mu-song-main">
        <span className="mu-song-name">{s.title}<Quality s={s} /></span>
        <span className="mu-song-sub">{s.artist}</span>
      </span>
      {showAlbum && <span className="mu-song-album">{s.album}</span>}
      <button type="button" className={`mu-star${star ? ' on' : ''}`} aria-label={star ? '取消收藏' : '收藏'} onClick={toggle}><Ic n="heart" size={18} fill={star} /></button>
      <button type="button" className="mu-star mu-more" aria-label="更多" onClick={(e) => { e.stopPropagation(); setMenu((e.currentTarget as HTMLElement).getBoundingClientRect()); }}><Ic n="more" size={18} /></button>
      <span className="mu-song-len">{fmtTime(s.duration)}</span>
      {menu && <SongMenu s={s} anchor={menu} onClose={() => setMenu(null)} ctx={ctx} />}
    </div>
  );
}

/** 封面 + 悬停播放按钮（点按钮直接播放，点封面进入详情） */
export function PlayCover({ id, size, label, onPlay, round, badge }: { id: string; size?: number; label: string; onPlay: () => Promise<Song[]>; round?: boolean; badge?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mu-pc">
      <Cover id={id} size={size} label={label} radius={round ? '50%' : undefined} />
      {badge && <span className="mu-pc-badge">{badge}</span>}
      <button type="button" className="mu-pc-play" aria-label={`播放 ${label}`} disabled={busy}
        onClick={(e) => { e.stopPropagation(); setBusy(true); onPlay().then((l) => playQueue(l, 0)).catch(() => undefined).finally(() => setBusy(false)); }}>
        <Ic n="play" size={18} />
      </button>
    </div>
  );
}

/** 进度条：触屏友好（28px 触控区、拖动时不被播放进度拉回、松手才跳转） */
export function Slider({ value, max, onSeek, onDrag, label = '播放进度', className }: { value: number; max: number; onSeek: (v: number) => void; onDrag?: (v: number | null) => void; label?: string; className?: string }) {
  const [drag, setDrag] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const dragRef = useRef<number | null>(null);
  const calc = (x: number): number => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return Math.min(1, Math.max(0, (x - r.left) / r.width)) * max;
  };
  const set = (v: number | null): void => { dragRef.current = v; setDrag(v); onDrag?.(v); };
  const shown = drag ?? value;
  const pct = max > 0 ? Math.min(100, (shown / max) * 100) : 0;
  return (
    <div ref={box} className={`mu-sl ${className || ''}${drag !== null ? ' drag' : ''}`} role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={Math.round(max)} aria-valuenow={Math.round(shown)}
      onPointerDown={(e) => { if (max <= 0) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); set(calc(e.clientX)); }}
      onPointerMove={(e) => { if (dragRef.current !== null) set(calc(e.clientX)); }}
      onPointerUp={(e) => { const v = dragRef.current; if (v !== null) { set(null); onSeek(calc(e.clientX)); } }}
      onPointerCancel={() => set(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); onSeek(Math.min(max, Math.max(0, value + (e.key === 'ArrowRight' ? 5 : -5)))); }
      }}>
      <div className="mu-sl-tr"><div className="mu-sl-fill" style={{ width: `${pct}%` }} /></div>
      <div className="mu-sl-th" style={{ left: `${pct}%` }} />
    </div>
  );
}
