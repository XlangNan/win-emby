// 完整播放页：封面 + 滚动歌词 + 进度 + 控制
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Cover, fmtTime, Ic } from './MusicUi';
import { coverUrl, nd, type Song } from './navidrome';
import { cycleRepeat, next, playIndex, prev, seek, setOpen, setShuffle, setStarred, togglePlay, useMusic } from './player';

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

export default function NowPlaying() {
  const m = useMusic();
  const nav = useNavigate();
  const lyr = useLyrics(m.open ? m.cur : null);
  const box = useRef<HTMLDivElement>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [star, setStar] = useState(false);
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
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false); };
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
      <div className="mu-np-body">
        <div className="mu-np-left">
          <Cover id={cur.coverArt} size={800} className="mu-np-cv" label={cur.title} />
          <div className="mu-np-title">{cur.title}</div>
          <div className="mu-np-artist">
            <a href="#a" onClick={(e) => { e.preventDefault(); if (cur.artistId) { setOpen(false); nav(`/music/artist/${cur.artistId}`); } }}>{cur.artist}</a>
            {cur.album && <> · <a href="#b" onClick={(e) => { e.preventDefault(); if (cur.albumId) { setOpen(false); nav(`/music/album/${cur.albumId}`); } }}>{cur.album}</a></>}
          </div>
          <div className="mu-np-q">{quality}</div>
        </div>
        <div className="mu-np-right" ref={box}>
          {queueOpen ? (
            <div className="mu-np-queue">
              {m.queue.map((s, i) => (
                <div key={`${s.id}-${i}`} className={`mu-np-qrow${i === m.index ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => playIndex(i)}>
                  <span>{i + 1}</span><b>{s.title}</b><em>{s.artist}</em>
                </div>
              ))}
            </div>
          ) : !lyr ? <div className="mu-np-nolyr">歌词加载中…</div>
            : !lyr.lines.length ? <div className="mu-np-nolyr">这首歌没有歌词</div>
            : (
              <div className="mu-lyr">
                {lyr.lines.map((l, i) => (
                  <div key={i} data-active={i === active ? '1' : undefined} className={`mu-lyr-l${i === active ? ' on' : ''}${lyr.synced ? '' : ' plain'}`}
                    onClick={() => { if (lyr.synced) seek(l.t); }}>{l.text || ' '}</div>
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
          <span>{m.error || (m.queue.length ? `队列 ${m.index + 1} / ${m.queue.length}` : '')}</span>
        </div>
      </div>
    </div>
  );
}
