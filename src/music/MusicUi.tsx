// 音乐页面共用的小组件：图标、封面、歌曲行
import { useState } from 'react';
import { coverUrl, nd, type Song } from './navidrome';
import { playQueue, setStarred, useMusic } from './player';

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

export function SongRow({ s, i, list, showArtist, showCover }: { s: Song; i: number; list: Song[]; showArtist?: boolean; showCover?: boolean }) {
  const m = useMusic();
  const active = m.cur?.id === s.id;
  const [star, setStar] = useState(s.starred);
  const toggle = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const v = !star;
    setStar(v);
    setStarred(s.id, v);
    nd.star(s.id, v).catch(() => setStar(!v));
  };
  const meta = [showArtist ? s.artist : '', s.suffix ? s.suffix.toUpperCase() : '', s.bitDepth > 16 ? `${s.bitDepth}bit` : ''].filter(Boolean).join(' · ');
  return (
    <div className={`mu-song${active ? ' active' : ''}`} role="button" tabIndex={0} onClick={() => playQueue(list, i)} onKeyDown={(e) => { if (e.key === 'Enter') playQueue(list, i); }}>
      {showCover ? <Cover id={s.coverArt} size={80} className="mu-song-cv" /> : <span className="mu-song-no">{active && m.playing ? '♪' : s.track || i + 1}</span>}
      <span className="mu-song-main">
        <span className="mu-song-name">{s.title}</span>
        {meta && <span className="mu-song-sub">{meta}</span>}
      </span>
      <button type="button" className={`mu-star${star ? ' on' : ''}`} aria-label={star ? '取消收藏' : '收藏'} onClick={toggle}><Ic n="heart" size={18} fill={star} /></button>
      <span className="mu-song-len">{fmtTime(s.duration)}</span>
    </div>
  );
}
