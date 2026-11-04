// 首页首屏聚光卡：结构沿用原 DiscoverSpotlight（.spot*），数据换成 Emby 最近入库
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backdropUrl, posterUrl } from '../emby/client';
import { cardTitle, fmtRuntime } from '../emby/format';
import type { EmbyItem } from '../emby/types';

export default function HomeSpotlight({
  items,
  landscape = false,
  onOpen,
  onPlay,
}: {
  items: EmbyItem[];
  /** true = 用横版剧照当满幅景（网飝 billboard）；false = 竖版海报做柔化底 */
  landscape?: boolean;
  onOpen: (it: EmbyItem) => void;
  onPlay: (it: EmbyItem) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [prev, setPrev] = useState(-1); // 正在滑出的那一张
  const [dir, setDir] = useState<1 | -1>(1); // 1 = 向左滑（下一张），-1 = 向右滑（上一张）
  const clr = useRef<number | null>(null);
  const key = items.map((i) => i.Id).join('|');

  // 横版模式只轮播「真有背景图」的片子；一张都没有时退回全部
  const list = useMemo(() => {
    const withBg = landscape ? items.filter((it) => backdropUrl(it)) : items;
    return (withBg.length ? withBg : items).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, landscape]);

  const idxRef = useRef(0);
  idxRef.current = idx;
  /** 切到第 n 张：新图从一侧滑入、旧图向另一侧滑出 */
  const go = useCallback((n: number, d?: 1 | -1) => {
    const cur = idxRef.current;
    if (n === cur) return;
    setDir(d ?? (n > cur ? 1 : -1));
    setPrev(cur);
    setIdx(n);
    if (clr.current) window.clearTimeout(clr.current);
    clr.current = window.setTimeout(() => setPrev(-1), 760);
  }, []);
  useEffect(() => {
    setIdx(0);
    setPrev(-1);
  }, [key]);
  useEffect(() => () => {
    if (clr.current) window.clearTimeout(clr.current);
  }, []);
  // 自动轮播：每次手动切换后重新计时
  useEffect(() => {
    if (list.length <= 1) return;
    const t = setTimeout(() => go((idxRef.current + 1) % list.length, 1), 7000);
    return () => clearTimeout(t);
  }, [list.length, key, idx, go]);
  const stepBy = (d: 1 | -1): void => go((idx + d + list.length) % list.length, d);

  if (!list.length) return null;
  const pos = idx % list.length;
  const cur = list[pos];
  const artOf = (it: EmbyItem): string => (landscape ? backdropUrl(it) || posterUrl(it, 600) : posterUrl(it, 600));
  const curArt = artOf(cur);
  const next = list[(pos + 1) % list.length];
  const nextArt = list.length > 1 ? artOf(next) : '';
  const kind = cur.Type === 'Series' ? '剧集' : cur.Type === 'Episode' ? '单集' : '电影';

  return (
    <section className="spot" aria-label="最近添加">
      <div className="spot-art" aria-hidden="true">
        {list.map((it, i) => {
          const src = artOf(it);
          if (!src) return null;
          const sharp = landscape && !!backdropUrl(it);
          return (
            <div
              key={it.Id}
              className={
                'spot-art-layer' + (sharp ? '' : ' spot-art-blur') +
                (i === pos && prev >= 0 ? (dir > 0 ? ' spot-in-r' : ' spot-in-l') : '') +
                (i === prev ? (dir > 0 ? ' spot-out-l' : ' spot-out-r') : '')
              }
              style={{ backgroundImage: `url("${src}")`, opacity: i === pos || i === prev ? 1 : 0, transition: 'none' }}
            />
          );
        })}
      </div>
      <div className="spot-veil" aria-hidden="true" />

      <div className="spot-body" key={`b-${cur.Id}`}>
        <span className="spot-kicker">
          <span className="spot-kicker-dot" aria-hidden="true" />
          最近添加
        </span>
        <h2 className="spot-title" title={cardTitle(cur)}>{cardTitle(cur)}</h2>
        <div className="spot-meta">
          {cur.ProductionYear ? <span className="spot-year">{cur.ProductionYear}</span> : null}
          {cur.ProductionYear ? <span className="spot-sep" aria-hidden="true">·</span> : null}
          <span>{kind}</span>
          {cur.RunTimeTicks ? <><span className="spot-sep" aria-hidden="true">·</span><span>{fmtRuntime(cur.RunTimeTicks)}</span></> : null}
          {cur.CommunityRating ? <span className="spot-rank">★ {cur.CommunityRating.toFixed(1)}</span> : null}
        </div>
        <div className="spot-acts">
          <button type="button" className="primary spot-go" onClick={() => onPlay(cur)}>
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 3.2v9.6l7.4-4.8-7.4-4.8Z" fill="currentColor" /></svg>
            播放
          </button>
          <button type="button" className="spot-next" onClick={() => onOpen(cur)}>详情</button>
          {list.length > 1 && (
            <button type="button" className="spot-next" onClick={() => stepBy(1)}>换一部</button>
          )}
        </div>
      </div>

      <div className="spot-stage" aria-hidden="true">
        <div className="spot-poster" style={curArt ? { backgroundImage: `url("${curArt}")` } : undefined}>
          {!curArt && <span className="spot-poster-none">暂无封面</span>}
        </div>
        {nextArt && <div className="spot-poster spot-poster-ghost" style={{ backgroundImage: `url("${nextArt}")` }} />}
      </div>

      {list.length > 1 && (
        <>
          <button type="button" className="spot-arrow prev" aria-label="上一部" onClick={() => stepBy(-1)}>‹</button>
          <button type="button" className="spot-arrow next" aria-label="下一部" onClick={() => stepBy(1)}>›</button>
        </>
      )}

      {list.length > 1 && (
        <div className="spot-dots">
          {list.map((it, i) => (
            <button key={it.Id} type="button" className={'spot-dot' + (i === pos ? ' active' : '')} aria-label={`第 ${i + 1} 部`} onClick={() => go(i)} />
          ))}
        </div>
      )}
    </section>
  );
}
