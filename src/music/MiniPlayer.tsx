// 底部播放条（网易云风格）：桌面三段式 + 音量 / 模式 / 歌词 / 队列；手机为旋转封面小条
import { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Cover, fmtTime, Ic, Slider, VolumeBox } from './MusicUi';
import { activeLine, useLrcOffset, useLyrics } from './lyrics';
import { saveOpts, useOpts } from './prefs';
import { nd } from './navidrome';
import { useBackClose } from './useBackClose';
import { notifyStarred, setRepeat, setStarred, next, pause, playIndex, prev, removeAt, seek, setOpen, setShuffle, setVolume, stopMusic, togglePlay, useMusic, useMusicPos } from './player';

const MODE_NAME = { order: '顺序播放', loop: '列表循环', shuffle: '随机播放', one: '单曲循环' } as const;

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
  const m = useMusicPos();
  const opts = useOpts();
  const [dp, setDp] = useState<number | null>(null);
  const p = useLocation().pathname;
  const [q, setQ] = useState(false);
  const sy = useRef(0);
  const sx = useRef(0);
  const skip = useRef(false);
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
  const mode: 'order' | 'loop' | 'shuffle' | 'one' = m.shuffle ? 'shuffle' : m.repeat === 'one' ? 'one' : m.repeat === 'all' ? 'loop' : 'order';
  const cycleMode = (): void => {
    if (mode === 'order') { setShuffle(false); setRepeat('all'); }
    else if (mode === 'loop') { setShuffle(true); setRepeat('all'); }
    else if (mode === 'shuffle') { setShuffle(false); setRepeat('one'); }
    else { setShuffle(false); setRepeat('off'); }
  };
  const pct = m.dur > 0 ? Math.min(100, (m.pos / m.dur) * 100) : 0;
  if (inline) {
    return (
      <div className="mu-mini mu-scope inline" onTouchStart={(e) => { skip.current = !!(e.target as HTMLElement).closest('.mu-sl'); sy.current = e.touches[0].clientY; sx.current = e.touches[0].clientX; }} onTouchEnd={(e) => {
        if (skip.current) return;   // 在进度条上拖动不当作切歌 / 展开手势
        const dx = e.changedTouches[0].clientX - sx.current, dy = sy.current - e.changedTouches[0].clientY;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { if (dx < 0) next(); else prev(); }   // 左右滑：切歌
        else if (dy > 36) setOpen(true);
      }}>
        <div className="mu-mini-main" role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpen(true); }}>
          <Cover id={c.coverArt} size={120} className={`mu-mini-cv mu-spin${m.playing ? '' : ' paused'}`} label={c.title} />
          <div className="mu-mini-txt"><Marquee tag="b" text={c.title} loop /><BarSub /></div>
        </div>
        <button type="button" className="mu-ib mu-ib-main" aria-label={m.playing ? '暂停' : '播放'} onClick={togglePlay}><Ic n={m.playing ? 'pause' : 'play'} size={22} /></button>
        <button type="button" className="mu-ib" aria-label="播放队列" onClick={() => setQ(true)}><Ic n="list" /></button>
        <button type="button" className="mu-ib mu-ib-stop" aria-label="停止播放并关闭播放条" onClick={() => stopMusic()}><Ic n="close" size={18} /></button>
        <div className="mu-mini-sl"><Slider value={m.pos} max={m.dur} onSeek={seek} /></div>
        {q && <Queue onClose={() => setQ(false)} />}
      </div>
    );
  }
  return (
    <div className="mu-mini mu-scope">
      <div className="mu-mini-left" role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpen(true); }} title="打开播放页">
        <Cover id={c.coverArt} size={120} className="mu-mini-cv" label={c.title} />
        <div className="mu-mini-txt"><Marquee tag="b" text={c.title} loop /><BarSub /></div>
      </div>
      <div className="mu-mini-mid">
        <div className="mu-mini-btns">
          <button type="button" className={`mu-ib${c.starred ? ' on' : ''}`} aria-label="收藏" onClick={() => { const v = !c.starred; setStarred(c.id, v); nd.star(c.id, v).catch(() => setStarred(c.id, !v)).finally(notifyStarred); }}><Ic n="heart" size={19} fill={c.starred} /></button>
          <button type="button" className="mu-ib" aria-label="上一首" onClick={() => prev()}><Ic n="prev" size={22} /></button>
          <button type="button" className="mu-ib mu-ib-main" aria-label={m.playing ? '暂停' : '播放'} onClick={togglePlay}>{m.loading && !m.playing ? <span className="spinner" aria-hidden="true" /> : <Ic n={m.playing ? 'pause' : 'play'} size={20} />}</button>
          <button type="button" className="mu-ib" aria-label="下一首" onClick={() => next()}><Ic n="next" size={22} /></button>
          <button type="button" className={`mu-ib${mode === 'shuffle' || mode === 'one' ? ' on' : ''}`} aria-label={`播放模式：${MODE_NAME[mode]}（点击切换）`} title={MODE_NAME[mode]} onClick={cycleMode}><Ic n={mode === 'shuffle' ? 'shuffle' : 'repeat'} size={19} />{mode === 'one' && <i className="mu-rep1">1</i>}</button>
        </div>
        <div className="mu-mini-prog">
          <span>{fmtTime(dp ?? m.pos)}</span>
          <Slider value={m.pos} max={m.dur} onSeek={seek} onDrag={setDp} />
          <span>{fmtTime(m.dur)}</span>
        </div>
      </div>
      <div className="mu-mini-right">
        {c.suffix && <span className="mu-qtag">{c.suffix.toUpperCase()}</span>}
        <button type="button" className={`mu-ib${opts.barLyric ? ' on' : ''}`} aria-label={opts.barLyric ? '关闭播放条歌词' : '开启播放条歌词'} title={opts.barLyric ? '播放条歌词：开（点击关闭）' : '播放条歌词：关'} onClick={() => saveOpts({ barLyric: !opts.barLyric })}><span className="mu-ci">词</span></button>
        <VolumeBox><button type="button" className="mu-ib" aria-label={m.volume > 0 ? '静音' : '取消静音'} onClick={() => { if (m.volume > 0) { lastVol.current = m.volume; setVolume(0); } else setVolume(lastVol.current); }}><Ic n={m.volume > 0 ? 'vol' : 'mute'} size={19} /></button>
        <input type="range" className="mu-vol" min={0} max={100} value={Math.round(m.volume * 100)} aria-label="音量" onChange={(e) => setVolume(Number(e.target.value) / 100)} style={{ ['--p' as string]: `${m.volume * 100}%` }} /></VolumeBox>
        <button type="button" className={`mu-ib${q ? ' on' : ''}`} aria-label="播放队列" onClick={() => setQ((v) => !v)}><Ic n="list" size={20} /></button>
        <button type="button" className="mu-ib mu-ib-stop" aria-label="停止播放并关闭播放条" title="停止并关闭" onClick={() => stopMusic()}><Ic n="close" size={18} /></button>
      </div>
      <div className="mu-mini-bar"><div style={{ width: `${pct}%` }} /></div>
      {q && <Queue onClose={() => setQ(false)} />}
    </div>
  );
}

/** 播放条第二行：开启「歌词」且这首歌有逐行歌词时显示当前一句，否则显示歌手 */
function BarSub() {
  const m = useMusicPos();
  const o = useOpts();
  const c = m.cur;
  const lyr = useLyrics(o.barLyric ? c : null);
  const off = useLrcOffset(c?.id);
  if (!c) return null;
  const i = o.barLyric ? activeLine(lyr, m.pos, off) : -1;
  const line = i >= 0 ? lyr?.lines[i].text.trim() : '';
  if (m.error) return <span>{m.error}</span>;
  if (line && lyr) {
    // 这一句会唱多久：用来决定滚动速度，保证下一句出现前正好滚完
    const secs = (lyr.lines[i + 1]?.t ?? lyr.lines[i].t + 6) - lyr.lines[i].t;
    return <Marquee key={`${c.id}-${i}`} tag="span" cls="mu-barlyr" text={line} secs={secs} />;
  }
  return <Marquee tag="span" text={c.artist} loop />;
}

/** 放不下的文字自动滚动：loop 为来回循环（歌名 / 歌手），否则按 secs 秒滚一遍（歌词，停顿后从头滚到尾） */
function Marquee({ tag, text, cls, loop, secs }: { tag: 'b' | 'span'; text: string; cls?: string; loop?: boolean; secs?: number }) {
  const box = useRef<HTMLElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [d, setD] = useState(0);
  useLayoutEffect(() => {
    const b = box.current, i = inner.current;
    if (!b || !i) return;
    const measure = (): void => { const over = i.scrollWidth - b.clientWidth; setD(over > 2 ? Math.ceil(over) + 6 : 0); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    return () => ro.disconnect();
  }, [text]);
  const t = loop ? d / 32 + 3.5 : Math.min(30, Math.max(2.5, (secs ?? 4) - 0.6));
  const style = d ? ({ ['--mq-d' as string]: `${d}px`, ['--mq-t' as string]: `${t}s` } as React.CSSProperties) : undefined;
  const Tag = tag as 'span';
  return (
    <Tag ref={box as React.RefObject<HTMLSpanElement>} className={`mu-mq ${cls || ''}`}>
      <span ref={inner} className={d ? (loop ? 'mu-mq-in run loop' : 'mu-mq-in run') : 'mu-mq-in'} style={style}>{text}</span>
    </Tag>
  );
}
