// 底部迷你播放条（点开进入完整播放页）；看视频时自动暂停音乐
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Cover, Ic } from './MusicUi';
import { next, pause, prev, setOpen, togglePlay, useMusic } from './player';

export default function MiniPlayer({ inline }: { inline?: boolean }) {
  const m = useMusic();
  const p = useLocation().pathname;
  const video = p.startsWith('/player/') || p === '/live/play';
  useEffect(() => { if (video) pause(); }, [video]);
  const show = !!m.cur && !m.open && !video;
  useEffect(() => {
    document.documentElement.style.setProperty('--mini-h', show ? (inline ? '64px' : '84px') : '0px');
    return () => { document.documentElement.style.setProperty('--mini-h', '0px'); };
  }, [show, inline]);
  if (!show || !m.cur) return null;
  const c = m.cur;
  const pct = m.dur > 0 ? (m.pos / m.dur) * 100 : 0;
  return (
    <div className={`mu-mini${inline ? ' inline' : ''}`}>
      <div className="mu-mini-main" role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(true); }}>
        <Cover id={c.coverArt} size={120} className="mu-mini-cv" label={c.title} />
        <div className="mu-mini-txt"><b>{c.title}</b><span>{m.error || c.artist}</span></div>
      </div>
      {!inline && <button type="button" className="mu-ib" aria-label="上一首" onClick={() => prev()}><Ic n="prev" /></button>}
      <button type="button" className="mu-ib mu-ib-main" aria-label={m.playing ? '暂停' : '播放'} onClick={togglePlay}><Ic n={m.playing ? 'pause' : 'play'} size={inline ? 26 : 22} /></button>
      <button type="button" className="mu-ib" aria-label="下一首" onClick={() => next()}><Ic n="next" /></button>
      <div className="mu-mini-bar"><div style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
