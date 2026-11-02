// 播放页右侧信息抽屉：简介 / 演职员 / 选集
import { useState } from 'react';
import { personUrl, thumbUrl } from '../emby/client';
import { fmtRuntime } from '../emby/format';
import type { EmbyItem } from '../emby/types';

type Tab = 'info' | 'cast' | 'eps';

export default function PlayerDrawer({
  item,
  episodes,
  currentId,
  onClose,
  onPickEpisode,
}: {
  item: EmbyItem | null;
  episodes: EmbyItem[];
  currentId: string;
  onClose: () => void;
  onPickEpisode: (ep: EmbyItem) => void;
}) {
  const hasEps = episodes.length > 0;
  const [tab, setTab] = useState<Tab>('info');
  const cast = (item?.People || []).filter((p) => p.Type === 'Actor' || p.Type === 'GuestStar' || p.Type === 'Director' || p.Type === 'Writer');
  const meta = item
    ? [item.ProductionYear, item.OfficialRating, fmtRuntime(item.RunTimeTicks), item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : '']
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <aside className="we-drawer" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="we-drawer-head">
        <div className="we-drawer-tabs">
          <button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>简介</button>
          <button className={tab === 'cast' ? 'active' : ''} onClick={() => setTab('cast')}>演职员</button>
          {hasEps && <button className={tab === 'eps' ? 'active' : ''} onClick={() => setTab('eps')}>选集</button>}
        </div>
        <button className="we-btn" title="关闭（I）" onClick={onClose}>✕</button>
      </div>

      <div className="we-drawer-body">
        {tab === 'info' && (
          <>
            <h3 style={{ margin: '0 0 6px' }}>{item?.Type === 'Episode' ? item.SeriesName : item?.Name}</h3>
            {item?.Type === 'Episode' && (
              <div style={{ marginBottom: 6 }}>S{item.ParentIndexNumber ?? 1}E{item.IndexNumber ?? 1} · {item.Name}</div>
            )}
            {meta && <div className="we-d-muted">{meta}</div>}
            {item?.Genres && item.Genres.length > 0 && <div className="we-d-muted">{item.Genres.join(' / ')}</div>}
            <p className="we-d-ov">{item?.Overview || '暂无简介'}</p>
          </>
        )}

        {tab === 'cast' && (
          cast.length === 0 ? (
            <div className="we-d-muted">没有演职员信息</div>
          ) : (
            <div className="we-d-cast">
              {cast.map((p, i) => (
                <div key={`${p.Id}-${i}`} className="we-d-person" title={p.Role ? `${p.Name} 饰 ${p.Role}` : p.Name}>
                  {personUrl(p) ? <img src={personUrl(p)} loading="lazy" alt="" /> : <div className="we-d-ph">{p.Name.slice(0, 1)}</div>}
                  <div className="we-d-pname">{p.Name}</div>
                  <div className="we-d-muted we-d-prole">{p.Type === 'Director' ? '导演' : p.Type === 'Writer' ? '编剧' : p.Role || '演员'}</div>
                </div>
              ))}
            </div>
          )
        )}

        {tab === 'eps' && (
          <div className="we-d-eps">
            {episodes.map((e) => (
              <div key={e.Id} ref={e.Id === currentId ? (el) => el?.scrollIntoView({ block: 'center' }) : undefined} className={`we-d-ep${e.Id === currentId ? ' active' : ''}`} role="button" tabIndex={0} onClick={() => onPickEpisode(e)} onKeyDown={(ev) => ev.key === 'Enter' && onPickEpisode(e)}>
                <div className="we-d-ep-thumb">
                  {thumbUrl(e, 240) ? <img src={thumbUrl(e, 240)} loading="lazy" alt="" /> : null}
                </div>
                <div className="we-d-ep-info">
                  <div className="we-d-ep-title">
                    S{e.ParentIndexNumber ?? 1}E{e.IndexNumber ?? 1} · {e.Name}
                  </div>
                  <div className="we-d-muted">{fmtRuntime(e.RunTimeTicks)}{e.UserData?.Played ? ' · 已看' : ''}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
