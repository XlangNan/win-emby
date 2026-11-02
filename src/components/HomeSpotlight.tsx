// 首页首屏聚光卡：结构沿用原 DiscoverSpotlight（.spot*），数据换成 Emby 最近入库
import { useEffect, useMemo, useState } from 'react';
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
  const key = items.map((i) => i.Id).join('|');

  // 横版模式只轮播「真有背景图」的片子；一张都没有时退回全部
  const list = useMemo(() => {
    const withBg = landscape ? items.filter((it) => backdropUrl(it)) : items;
    return (withBg.length ? withBg : items).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, landscape]);

  useEffect(() => setIdx(0), [key]);
  useEffect(() => {
    if (list.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % list.length), 7000);
    return () => clearInterval(t);
  }, [list.length, key]);

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
              className={'spot-art-layer' + (sharp ? '' : ' spot-art-blur')}
              style={{ backgroundImage: `url("${src}")`, opacity: i === pos ? 1 : 0 }}
            />
          );
        })}
      </div>
      <div className="spot-veil" aria-hidden="true" />

      <div className="spot-body">
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
            <button type="button" className="spot-next" onClick={() => setIdx((i) => (i + 1) % list.length)}>换一部</button>
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
        <div className="spot-dots">
          {list.map((it, i) => (
            <button key={it.Id} type="button" className={'spot-dot' + (i === pos ? ' active' : '')} aria-label={`第 ${i + 1} 部`} onClick={() => setIdx(i)} />
          ))}
        </div>
      )}
    </section>
  );
}
