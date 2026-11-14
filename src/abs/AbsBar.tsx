// 有声书底部播放条：点封面 / 书名回到这本书的详情页
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { absCover, fmtDur } from './abs';
import { absSeek, absSetRate, absSkip, absStop, absToggle, currentChapter, setSleep, useAbsPlayer } from './absPlayer';

const RATES = [1, 1.25, 1.5, 1.75, 2, 0.75];

export default function AbsBar() {
  const p = useAbsPlayer();
  const nav = useNavigate();
  const [drag, setDrag] = useState<number | null>(null);
  const bad = useRef(false);
  if (!p.id) return null;
  const chap = currentChapter(p.chapters, p.pos);
  const shown = drag ?? p.pos;
  const nextRate = RATES[(RATES.indexOf(p.rate) + 1) % RATES.length] ?? 1;
  const sleepMin = p.sleepLeft > 0 ? Math.ceil(p.sleepLeft / 60) : 0;
  const sleepNext = sleepMin === 0 ? 15 : sleepMin > 30 ? 0 : sleepMin > 15 ? 60 : 30;
  return (
    <div className="abs-bar-wrap" role="region" aria-label="有声书播放">
      <div className="abs-bar-cov" role="button" tabIndex={0} title="打开详情" onClick={() => nav(`/audiobooks/${p.id}`)}>
        {!bad.current ? <img src={absCover(p.id, 120)} alt="" draggable={false} onError={() => { bad.current = true; }} /> : null}
      </div>
      <div className="abs-bar-info" onClick={() => nav(`/audiobooks/${p.id}`)} role="button" tabIndex={0}>
        <div className="abs-bar-t">{p.title}</div>
        <div className="abs-bar-s">{p.err ? p.err : chap ? chap.title : p.author}</div>
      </div>
      <div className="abs-bar-ctl">
        <button type="button" title="后退 15 秒" onClick={() => absSkip(-15)}>↺15</button>
        <button type="button" className="abs-bar-play" title={p.playing ? '暂停' : '播放'} onClick={absToggle}>{p.loading && !p.playing ? '…' : p.playing ? '❚❚' : '▶'}</button>
        <button type="button" title="前进 30 秒" onClick={() => absSkip(30)}>30↻</button>
      </div>
      <div className="abs-bar-seek">
        <span>{fmtDur(shown)}</span>
        <input
          type="range" min={0} max={Math.max(1, p.duration)} step={1} value={Math.min(shown, Math.max(1, p.duration))}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={() => { if (drag != null) { absSeek(drag); setDrag(null); } }}
          onKeyUp={() => { if (drag != null) { absSeek(drag); setDrag(null); } }}
          aria-label="播放进度"
        />
        <span>-{fmtDur(Math.max(0, p.duration - shown))}</span>
      </div>
      <div className="abs-bar-opts">
        <button type="button" title="播放速度" onClick={() => absSetRate(nextRate)}>{p.rate}×</button>
        <button type="button" title="定时关闭（点一下切换：15 / 30 / 60 分钟 / 关）" className={sleepMin ? 'on' : ''} onClick={() => setSleep(sleepNext)}>{sleepMin ? `${sleepMin}分` : '定时'}</button>
        <button type="button" title="关闭有声书" onClick={absStop}>✕</button>
      </div>
    </div>
  );
}
