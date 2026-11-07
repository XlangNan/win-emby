// 完整播放页：封面 + 滚动歌词 + 进度 + 控制
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cover, fmtTime, Ic } from './MusicUi';
import { coverUrl, nd, type Song } from './navidrome';
import { cycleRepeat, next, playIndex, prev, removeAt, seek, setOpen, setShuffle, setSleep, setStarred, setVolume, stopMusic, togglePlay, useMusic, musicState } from './player';

type Lyr = { synced: boolean; lines: { t: number; text: string }[] };
const cache = new Map<string, Lyr>();

function useLyrics(s: Song | null): Lyr | null {
  const [l, setL] = useState<Lyr | null>(null);
  useEffect(() => {
    if (!s) { setL(null); return; }
    const hit = cache.get(s.id);
    if (hit) { setL(hit); return; }
    setL(null);
    let dead = false;
    nd.lyrics(s).then((r) => { cache.set(s.id, r); if (!dead) setL(r); }).catch(() => !dead && setL({ synced: false, lines: [] }));
    return () => { dead = true; };
  }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return l;
}

const musicPos = (): number => musicState().pos;
const SLEEPS = [15, 30, 45, 60, 90];

export default function NowPlaying() {
  const m = useMusic();
  const nav = useNavigate();
  const lyr = useLyrics(m.open ? m.cur : null);
  const box = useRef<HTMLDivElement>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [star, setStar] = useState(false);
  const [lyrMode, setLyrMode] = useState(false); // 手机：点碟片切换歌词
  const [sleepOpen, setSleepOpen] = useState(false);
  const cur = m.cur;
  useEffect(() => setStar(!!cur?.starred), [cur?.id, cur?.starred]);

  let active = -1;
  if (lyr?.synced) for (let i = 0; i < lyr.lines.length; i++) { if (lyr.lines[i].t <= m.pos + 0.25) active = i; else break; }
  useEffect(() => {
    if (!m.open || active < 0) return;
    box.current?.querySelector<HTMLElement>('[data-active="1"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active, m.open]);
  useEffect(() => {
    if (!m.open) return;
    const k = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') setOpen(false);
      else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowRight' && e.ctrlKey) next();
      else if (e.key === 'ArrowLeft' && e.ctrlKey) prev();
      else if (e.key === 'ArrowRight') seek(musicPos() + 5);
      else if (e.key === 'ArrowLeft') seek(Math.max(0, musicPos() - 5));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [m.open]);
  if (!m.open || !cur) return null;

  const toggleStar = (): void => {
    const v = !star;
    setStar(v);
    setStarred(cur.id, v);
    nd.star(cur.id, v).catch(() => setStar(!v));
  };
  const pct = m.dur > 0 ? Math.min(100, (m.pos / m.dur) * 100) : 0;
  const quality = [cur.suffix.toUpperCase(), cur.bitDepth ? `${cur.bitDepth}bit` : '', cur.samplingRate ? `${(cur.samplingRate / 1000).toFixed(cur.samplingRate % 1000 ? 1 : 0)}kHz` : '', cur.bitRate ? `${cur.bitRate}kbps` : ''].filter(Boolean).join(' · ');

  return (
    <div className="mu-np" role="dialog" aria-label="正在播放">
      <div className="mu-np-bg" style={{ backgroundImage: `url("${coverUrl(cur.coverArt, 200)}")` }} />
      <div className="mu-np-top">
        <button type="button" className="mu-ib" aria-label="收起" onClick={() => setOpen(false)}><Ic n="down" size={26} /></button>
        <span className="mu-np-top-t">正在播放</span>
        <button type="button" className="mu-ib" aria-label="播放队列" onClick={() => setQueueOpen((v) => !v)}><Ic n="list" /></button>
      </div>
      <div className={`mu-np-body${lyrMode || queueOpen ? ' lyr-mode' : ''}`}>
        <div className="mu-np-left">
          <div className="mu-disc-wrap" role="button" tabIndex={0} aria-label="切换歌词" onClick={() => setLyrMode((v) => !v)} onKeyDown={(e) => { if (e.key === 'Enter') setLyrMode((v) => !v); }}>
            <div className={`mu-needle${m.playing ? ' on' : ''}`} />
            <div className={`mu-disc${m.playing ? ' spin' : ''}`}>
              <Cover id={cur.coverArt} size={600} className="mu-disc-cv" label={cur.title} />
            </div>
          </div>
          <div className="mu-np-info">
            <div className="mu-np-title">{cur.title}</div>
            <div className="mu-np-artist">
              <a href="#a" onClick={(e) => { e.preventDefault(); if (cur.artistId) { setOpen(false); nav(`/music/artist/${cur.artistId}`); } }}>{cur.artist}</a>
              {cur.album && <> · <a href="#b" onClick={(e) => { e.preventDefault(); if (cur.albumId) { setOpen(false); nav(`/music/album/${cur.albumId}`); } }}>{cur.album}</a></>}
            </div>
            <div className="mu-np-q">{quality}</div>
          </div>
        </div>
        <div className="mu-np-right" ref={box}>
          {queueOpen ? (
            <div className="mu-np-queue">
              <div className="mu-np-qh">播放队列 · {m.queue.length}</div>
              {m.queue.map((s, i) => (
                <div key={`${s.id}-${i}`} className={`mu-np-qrow${i === m.index ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => playIndex(i)}>
                  <span>{i + 1}</span><b>{s.title}</b><em>{s.artist}</em>
                  <button type="button" aria-label="移除" className="mu-np-qx" onClick={(e) => { e.stopPropagation(); removeAt(i); }}><Ic n="close" size={14} /></button>
                </div>
              ))}
            </div>
          ) : !lyr ? <div className="mu-np-nolyr">歌词加载中…</div>
            : !lyr.lines.length ? <div className="mu-np-nolyr">纯音乐，请欣赏 · 或这首歌没有歌词</div>
            : (
              <div className="mu-lyr">
                {lyr.lines.map((l, i) => (
                  <div key={i} data-active={i === active ? '1' : undefined} className={`mu-lyr-l${i === active ? ' on' : ''}${lyr.synced ? '' : ' plain'}`}
                    onClick={() => { if (lyr.synced) seek(l.t); }}>{l.text || ' '}</div>
                ))}
              </div>
            )}
        </div>
      </div>
      <div className="mu-np-ctl">
        <div className="mu-np-prog">
          <span>{fmtTime(m.pos)}</span>
          <input type="range" min={0} max={Math.max(1, Math.floor(m.dur))} value={Math.floor(m.pos)} aria-label="播放进度" onChange={(e) => seek(Number(e.target.value))} style={{ ['--p' as string]: `${pct}%` }} />
          <span>-{fmtTime(Math.max(0, m.dur - m.pos))}</span>
        </div>
        <div className="mu-np-btns">
          <button type="button" className={`mu-ib${m.shuffle ? ' on' : ''}`} aria-label="随机播放" onClick={() => setShuffle(!m.shuffle)}><Ic n="shuffle" /></button>
          <button type="button" className="mu-ib" aria-label="上一首" onClick={() => prev()}><Ic n="prev" size={28} /></button>
          <button type="button" className="mu-ib mu-ib-big" aria-label={m.playing ? '暂停' : '播放'} onClick={togglePlay}>{m.loading && !m.playing ? <span className="spinner" aria-hidden="true" /> : <Ic n={m.playing ? 'pause' : 'play'} size={30} />}</button>
          <button type="button" className="mu-ib" aria-label="下一首" onClick={() => next()}><Ic n="next" size={28} /></button>
          <button type="button" className={`mu-ib${m.repeat !== 'off' ? ' on' : ''}`} aria-label="循环" onClick={cycleRepeat}><Ic n="repeat" />{m.repeat === 'one' && <i className="mu-rep1">1</i>}</button>
        </div>
        <div className="mu-np-foot">
          <button type="button" className={`mu-ib${star ? ' on' : ''}`} aria-label="收藏" onClick={toggleStar}><Ic n="heart" size={20} fill={star} /></button>
          <span className="mu-np-st">{m.error || (m.sleepAt ? `${Math.max(1, Math.ceil((m.sleepAt - Date.now()) / 60000))} 分钟后停止` : m.queue.length ? `队列 ${m.index + 1} / ${m.queue.length}` : '')}</span>
          <span className="mu-np-vol"><Ic n={m.volume > 0 ? 'vol' : 'mute'} size={18} /><input type="range" min={0} max={100} value={Math.round(m.volume * 100)} aria-label="音量" onChange={(e) => setVolume(Number(e.target.value) / 100)} style={{ ['--p' as string]: `${m.volume * 100}%` }} /></span>
          <span className="mu-sleep-w">
            <button type="button" className={`mu-ib${m.sleepAt ? ' on' : ''}`} aria-label="定时关闭" onClick={() => setSleepOpen((v) => !v)}><Ic n="moon" size={20} /></button>
            {sleepOpen && (
              <>
                <div className="mu-pop-mask" onClick={() => setSleepOpen(false)} />
                <div className="mu-sleep">
                  <div className="mu-sleep-h">定时关闭</div>
                  {SLEEPS.map((x) => <button key={x} type="button" onClick={() => { setSleep(x); setSleepOpen(false); }}>{x} 分钟后</button>)}
                  {m.sleepAt > 0 && <button type="button" className="off" onClick={() => { setSleep(0); setSleepOpen(false); }}>取消定时</button>}
                </div>
              </>
            )}
          </span>
          <button type="button" className="mu-stop" onClick={() => stopMusic()}><Ic n="close" size={14} /> 停止播放</button>
        </div>
      </div>
    </div>
  );
}
