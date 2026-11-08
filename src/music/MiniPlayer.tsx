// 底部播放条（网易云风格）：桌面三段式 + 音量 / 模式 / 歌词 / 队列；手机为旋转封面小条
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Cover, fmtTime, Ic, Slider } from './MusicUi';
import { useBackClose } from './useBackClose';
import { cycleRepeat, next, pause, playIndex, prev, removeAt, seek, setOpen, setShuffle, setVolume, stopMusic, togglePlay, useMusic } from './player';

function Queue({ onClose }: { onClose: () => void }) {
  const m = useMusic();
  useBackClose(true, onClose);
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="mu-pop-mask" onClick={onClose} />
      <div className="mu-queue" role="dialog" aria-label="播放队列">
        <div className="mu-queue-h"><b>播放队列 · {m.queue.length}</b><button type="button" onClick={() => { stopMusic(); onClose(); }}><Ic n="trash" size={14} /> 清空</button></div>
        <div className="mu-queue-l">
          {m.queue.map((s, i) => (
            <div key={`${s.id}-${i}`} className={`mu-qrow${i === m.index ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => playIndex(i)} onKeyDown={(e) => { if (e.key === 'Enter') playIndex(i); }}>
              <span className="mu-qrow-i">{i === m.index ? <Ic n={m.playing ? 'vol' : 'play'} size={14} /> : i + 1}</span>
              <b>{s.title}</b><em>{s.artist}</em>
              <button type="button" aria-label="从队列移除" onClick={(e) => { e.stopPropagation(); removeAt(i); }}><Ic n="close" size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default function MiniPlayer({ inline }: { inline?: boolean }) {
  const m = useMusic();
  const p = useLocation().pathname;
  const [q, setQ] = useState(false);
  const sy = useRef(0);
  const video = p.startsWith('/player/') || p === '/live/play';
  useEffect(() => { if (video) pause(); }, [video]);
  const show = !!m.cur && !m.open && !video;
  useEffect(() => {
    document.documentElement.style.setProperty('--mini-h', show ? (inline ? '64px' : '76px') : '0px');
    return () => { document.documentElement.style.setProperty('--mini-h', '0px'); };
  }, [show, inline]);
  useEffect(() => { if (!show) setQ(false); }, [show]);
  if (!show || !m.cur) return null;
  const c = m.cur;
  const pct = m.dur > 0 ? Math.min(100, (m.pos / m.dur) * 100) : 0;
  if (inline) {
    return (
      <div className="mu-mini inline" onTouchStart={(e) => { sy.current = e.touches[0].clientY; }} onTouchEnd={(e) => { if (sy.current - e.changedTouches[0].clientY > 36) setOpen(true); }}>
        <div className="mu-mini-main" role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(true); }}>
          <Cover id={c.coverArt} size={120} className={`mu-mini-cv mu-spin${m.playing ? '' : ' paused'}`} label={c.title} />
          <div className="mu-mini-txt"><b>{c.title}</b><span>{m.error || c.artist}</span></div>
        </div>
        <button type="button" className="mu-ib mu-ib-main" aria-label={m.playing ? '暂停' : '播放'} onClick={togglePlay}><Ic n={m.playing ? 'pause' : 'play'} size={22} /></button>
        <button type="button" className="mu-ib" aria-label="播放队列" onClick={() => setQ(true)}><Ic n="list" /></button>
        <button type="button" className="mu-ib mu-ib-stop" aria-label="停止播放并关闭播放条" onClick={() => stopMusic()}><Ic n="close" size={18} /></button>
        <div className="mu-mini-bar"><div style={{ width: `${pct}%` }} /></div>
        {q && <Queue onClose={() => setQ(false)} />}
      </div>
    );
  }
  return (
    <div className="mu-mini">
      <div className="mu-mini-left" role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(true); }} title="打开播放页">
        <Cover id={c.coverArt} size={120} className="mu-mini-cv" label={c.title} />
        <div className="mu-mini-txt"><b>{c.title}</b><span>{m.error || c.artist}</span></div>
      </div>
      <div className="mu-mini-mid">
        <div className="mu-mini-btns">
          <button type="button" className={`mu-ib${m.shuffle ? ' on' : ''}`} aria-label="随机播放" onClick={() => setShuffle(!m.shuffle)}><Ic n="shuffle" size={19} /></button>
          <button type="button" className="mu-ib" aria-label="上一首" onClick={() => prev()}><Ic n="prev" size={22} /></button>
          <button type="button" className="mu-ib mu-ib-main" aria-label={m.playing ? '暂停' : '播放'} onClick={togglePlay}>{m.loading && !m.playing ? <span className="spinner" aria-hidden="true" /> : <Ic n={m.playing ? 'pause' : 'play'} size={20} />}</button>
          <button type="button" className="mu-ib" aria-label="下一首" onClick={() => next()}><Ic n="next" size={22} /></button>
          <button type="button" className={`mu-ib${m.repeat !== 'off' ? ' on' : ''}`} aria-label="循环模式" onClick={cycleRepeat}><Ic n="repeat" size={19} />{m.repeat === 'one' && <i className="mu-rep1">1</i>}</button>
        </div>
        <div className="mu-mini-prog">
          <span>{fmtTime(m.pos)}</span>
          <Slider value={m.pos} max={m.dur} onSeek={seek} />
          <span>{fmtTime(m.dur)}</span>
        </div>
      </div>
      <div className="mu-mini-right">
        <button type="button" className="mu-ib" aria-label="歌词" onClick={() => setOpen(true)}><span className="mu-ci">词</span></button>
        <button type="button" className="mu-ib" aria-label={m.volume > 0 ? '静音' : '取消静音'} onClick={() => setVolume(m.volume > 0 ? 0 : 0.8)}><Ic n={m.volume > 0 ? 'vol' : 'mute'} size={19} /></button>
        <input type="range" className="mu-vol" min={0} max={100} value={Math.round(m.volume * 100)} aria-label="音量" onChange={(e) => setVolume(Number(e.target.value) / 100)} style={{ ['--p' as string]: `${m.volume * 100}%` }} />
        <button type="button" className={`mu-ib${q ? ' on' : ''}`} aria-label="播放队列" onClick={() => setQ((v) => !v)}><Ic n="list" size={20} /></button>
        <button type="button" className="mu-ib mu-ib-stop" aria-label="停止播放并关闭播放条" title="停止并关闭" onClick={() => stopMusic()}><Ic n="close" size={18} /></button>
      </div>
      <div className="mu-mini-bar"><div style={{ width: `${pct}%` }} /></div>
      {q && <Queue onClose={() => setQ(false)} />}
    </div>
  );
}
