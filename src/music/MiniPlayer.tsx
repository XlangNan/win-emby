// 底部播放条（网易云风格）：桌面三段式 + 音量 / 模式 / 歌词 / 队列；手机为旋转封面小条
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Cover, fmtTime, Ic, Slider } from './MusicUi';
import { nd } from './navidrome';
import { useBackClose } from './useBackClose';
import { setRepeat, setStarred, next, pause, playIndex, prev, removeAt, seek, setOpen, setShuffle, setVolume, stopMusic, togglePlay, useMusic } from './player';

const MODE_NAME = { loop: '列表循环', shuffle: '随机播放', one: '单曲循环' } as const;

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
      <div className="mu-queue mu-scope" role="dialog" aria-label="播放队列">
        <div className="mu-queue-h"><b>播放队列 · {m.queue.length}</b><button type="button" className="mu-queue-clr" onClick={() => { stopMusic(); onClose(); }}><Ic n="trash" size={14} /> 清空</button></div>
        <div className="mu-queue-l">
          {m.queue.map((s, i) => (
            <div key={`${s.id}-${i}`} className={`mu-qrow${i === m.index ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => playIndex(i)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) playIndex(i); }}>
              <span className="mu-qrow-i">{i === m.index ? <Ic n={m.playing ? 'vol' : 'play'} size={14} /> : i + 1}</span>
              <b>{s.title}</b><em>{s.artist}</em>
              <button type="button" className="mu-qrow-x" aria-label="从队列移除" onClick={(e) => { e.stopPropagation(); removeAt(i); }}><Ic n="close" size={14} /></button>
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
  const lastVol = useRef(0.8);
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
  const mode: 'loop' | 'shuffle' | 'one' = m.shuffle ? 'shuffle' : m.repeat === 'one' ? 'one' : 'loop';
  const cycleMode = (): void => {
    if (mode === 'loop') { setShuffle(true); setRepeat('all'); }
    else if (mode === 'shuffle') { setShuffle(false); setRepeat('one'); }
    else { setShuffle(false); setRepeat('all'); }
  };
  const pct = m.dur > 0 ? Math.min(100, (m.pos / m.dur) * 100) : 0;
  if (inline) {
    return (
      <div className="mu-mini mu-scope inline" onTouchStart={(e) => { sy.current = e.touches[0].clientY; }} onTouchEnd={(e) => { if (sy.current - e.changedTouches[0].clientY > 36) setOpen(true); }}>
        <div className="mu-mini-main" role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpen(true); }}>
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
    <div className="mu-mini mu-scope">
      <div className="mu-mini-left" role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpen(true); }} title="打开播放页">
        <Cover id={c.coverArt} size={120} className="mu-mini-cv" label={c.title} />
        <div className="mu-mini-txt"><b>{c.title}</b><span>{m.error || c.artist}</span></div>
      </div>
      <div className="mu-mini-mid">
        <div className="mu-mini-btns">
          <button type="button" className={`mu-ib${c.starred ? ' on' : ''}`} aria-label="收藏" onClick={() => { const v = !c.starred; setStarred(c.id, v); nd.star(c.id, v).catch(() => setStarred(c.id, !v)); }}><Ic n="heart" size={19} fill={c.starred} /></button>
          <button type="button" className="mu-ib" aria-label="上一首" onClick={() => prev()}><Ic n="prev" size={22} /></button>
          <button type="button" className="mu-ib mu-ib-main" aria-label={m.playing ? '暂停' : '播放'} onClick={togglePlay}>{m.loading && !m.playing ? <span className="spinner" aria-hidden="true" /> : <Ic n={m.playing ? 'pause' : 'play'} size={20} />}</button>
          <button type="button" className="mu-ib" aria-label="下一首" onClick={() => next()}><Ic n="next" size={22} /></button>
          <button type="button" className={`mu-ib${mode !== 'loop' ? ' on' : ''}`} aria-label={`播放模式：${MODE_NAME[mode]}（点击切换）`} title={MODE_NAME[mode]} onClick={cycleMode}><Ic n={mode === 'shuffle' ? 'shuffle' : 'repeat'} size={19} />{mode === 'one' && <i className="mu-rep1">1</i>}</button>
        </div>
        <div className="mu-mini-prog">
          <span>{fmtTime(m.pos)}</span>
          <Slider value={m.pos} max={m.dur} onSeek={seek} />
          <span>{fmtTime(m.dur)}</span>
        </div>
      </div>
      <div className="mu-mini-right">
        {c.suffix && <span className="mu-qtag">{c.suffix.toUpperCase()}</span>}
        <button type="button" className="mu-ib" aria-label="歌词" onClick={() => setOpen(true)}><span className="mu-ci">词</span></button>
        <button type="button" className="mu-ib" aria-label={m.volume > 0 ? '静音' : '取消静音'} onClick={() => { if (m.volume > 0) { lastVol.current = m.volume; setVolume(0); } else setVolume(lastVol.current); }}><Ic n={m.volume > 0 ? 'vol' : 'mute'} size={19} /></button>
        <input type="range" className="mu-vol" min={0} max={100} value={Math.round(m.volume * 100)} aria-label="音量" onChange={(e) => setVolume(Number(e.target.value) / 100)} style={{ ['--p' as string]: `${m.volume * 100}%` }} />
        <button type="button" className={`mu-ib${q ? ' on' : ''}`} aria-label="播放队列" onClick={() => setQ((v) => !v)}><Ic n="list" size={20} /></button>
        <button type="button" className="mu-ib mu-ib-stop" aria-label="停止播放并关闭播放条" title="停止并关闭" onClick={() => stopMusic()}><Ic n="close" size={18} /></button>
      </div>
      <div className="mu-mini-bar"><div style={{ width: `${pct}%` }} /></div>
      {q && <Queue onClose={() => setQ(false)} />}
    </div>
  );
}
