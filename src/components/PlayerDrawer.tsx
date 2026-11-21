// 播放页右侧信息抽屉：简介 / 演职员 / 选集（Emby 风格：深色平面板 + 下划线标签 + 竖版长方形演员卡）
import { useState } from 'react';
import { backdropUrl, personUrl, thumbUrl } from '../emby/client';
import { fmtRuntime } from '../emby/format';
import type { EmbyItem } from '../emby/types';

type Tab = 'info' | 'cast' | 'eps';

// 模块级函数 = 引用稳定，只在元素刚挂载时滚动一次，不会在每次重渲染时把滚动位置拉回去
const scrollToActive = (el: HTMLElement | null): void => el?.scrollIntoView({ block: 'center' });

const epLabel = (e: EmbyItem): string => `E${String(e.IndexNumber ?? 1).padStart(2, '0')}`;

export default function PlayerDrawer({
  item,
  episodes,
  tech,
  currentId,
  onClose,
  onPickEpisode,
}: {
  item: EmbyItem | null;
  episodes: EmbyItem[];
  tech: { v: string; k: string }[];
  currentId: string;
  onClose: () => void;
  onPickEpisode: (ep: EmbyItem) => void;
}) {
  const hasEps = episodes.length > 0;
  const [tab, setTab] = useState<Tab>('info');
  const cast = (item?.People || []).filter((p) => p.Type === 'Actor' || p.Type === 'GuestStar' || p.Type === 'Director' || p.Type === 'Writer');
  const isEp = item?.Type === 'Episode';
  const title = (isEp ? item?.SeriesName : item?.Name) || '';
  const sub = isEp && item ? `第 ${item.ParentIndexNumber ?? 1} 季 第 ${item.IndexNumber ?? 1} 集 · ${item.Name}` : tab === 'eps' ? `共 ${episodes.length} 集` : '';
  const hero = item ? backdropUrl(item, 900) || thumbUrl(item, 900) : '';
  const chips = [item?.ProductionYear ? String(item.ProductionYear) : '', item?.OfficialRating || '', fmtRuntime(item?.RunTimeTicks), ...(item?.Genres || []).slice(0, 3)].filter(Boolean);
  const personCard = (p: (typeof cast)[number], i: number) => (
    <div key={`${p.Id}-${i}`} className="we-d-person" title={p.Role ? `${p.Name} 饰 ${p.Role}` : p.Name}>
      <div className="we-d-pimg">{personUrl(p) ? <img src={personUrl(p)} loading="lazy" alt="" draggable={false} /> : <span>{p.Name.slice(0, 1)}</span>}</div>
      <div className="we-d-pname">{p.Name}</div>
      <div className="we-d-prole">{p.Type === 'Director' ? '导演' : p.Type === 'Writer' ? '编剧' : p.Role || '演员'}</div>
    </div>
  );

  return (
    <aside className="we-drawer" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="we-d-hero">
        {hero && <img src={hero} alt="" draggable={false} />}
        <button className="we-btn we-d-x" title="关闭（I）" aria-label="关闭" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
        </button>
        <div className="we-d-ht">
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
      </div>
      <div className="we-d-tabs" role="tablist">
        <button role="tab" className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>简介</button>
        <button role="tab" className={tab === 'cast' ? 'active' : ''} onClick={() => setTab('cast')}>演职员</button>
        {hasEps && <button role="tab" className={tab === 'eps' ? 'active' : ''} onClick={() => setTab('eps')}>选集</button>}
      </div>

      <div className="we-d-body">
        {tab === 'info' && (
          <>
            <div className="we-d-meta">
              {item?.CommunityRating ? <span className="we-d-star">★ {item.CommunityRating.toFixed(1)}</span> : null}
              {chips.map((c, i) => <span key={i} className="we-d-chip">{c}</span>)}
            </div>
            <p className="we-d-ov">{item?.Overview || '暂无简介'}</p>
            {tech.length > 0 && (
              <div className="we-d-techbox">
                <div className="we-d-sec">当前片源</div>
                <div className="we-d-tech">{tech.map((t, i) => <div key={i}><b>{t.v}</b>{t.k && <span>{t.k}</span>}</div>)}</div>
              </div>
            )}
            {cast.length > 0 && (
              <>
                <div className="we-d-sec">演员</div>
                <div className="we-d-castrow">{cast.slice(0, 12).map(personCard)}</div>
              </>
            )}
          </>
        )}

        {tab === 'cast' && (
          cast.length === 0 ? (
            <div className="we-d-empty">没有演职员信息</div>
          ) : (
            <div className="we-d-cast">{cast.map(personCard)}</div>
          )
        )}

        {tab === 'eps' && (
          <div className="we-d-eps">
            {episodes.map((e) => {
              const now = e.Id === currentId;
              const pos = e.UserData?.PlaybackPositionTicks || 0;
              const pct = e.RunTimeTicks && pos > 0 ? Math.min(100, (pos / e.RunTimeTicks) * 100) : 0;
              return (
                <div key={e.Id} ref={now ? scrollToActive : undefined} className={`we-d-ep${now ? ' active' : ''}`} role="button" tabIndex={0} onClick={() => onPickEpisode(e)} onKeyDown={(ev) => ev.key === 'Enter' && onPickEpisode(e)}>
                  <div className="we-d-ep-thumb">
                    {thumbUrl(e, 240) ? <img src={thumbUrl(e, 240)} loading="lazy" alt="" draggable={false} /> : null}
                    <em>{epLabel(e)}</em>
                    {pct > 0 && !e.UserData?.Played && <u style={{ width: `${pct}%` }} />}
                  </div>
                  <div className="we-d-ep-info">
                    <div className="we-d-ep-title">{e.Name}</div>
                    <div className={`we-d-ep-sub${now ? ' now' : ''}`}>{now ? '正在播放' : [fmtRuntime(e.RunTimeTicks), e.UserData?.Played ? '已看' : ''].filter(Boolean).join(' · ')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
