// 影片卡：沿用原项目 .card-media 结构，大果 / 大豆各自的悬停播放徽标、进度条、未看数
import { useNavigate } from 'react-router-dom';
import { cardSub, cardTitle, progressPct } from '../emby/format';
import { posterUrl } from '../emby/client';
import type { EmbyItem } from '../emby/types';
import { useSkinLayout } from '../lib/theme';

export default function MediaCard({ it, onOpen }: { it: EmbyItem; onOpen?: (it: EmbyItem) => void }) {
  const nav = useNavigate();
  const shell = useSkinLayout().shell;
  const ap = shell === 'sidebar';
  const db = shell === 'pillbar';
  const poster = posterUrl(it);
  const pct = progressPct(it);
  const sub = cardSub(it);
  const open = (): void => {
    if (onOpen) onOpen(it);
    else nav(`/detail/${it.Id}`);
  };
  return (
    <div
      className="card-media"
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      title={cardTitle(it)}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="card">
        <div style={{ position: 'relative' }}>
          {poster ? <img src={poster} loading="lazy" decoding="async" alt="" /> : <div className="no-cover">暂无封面</div>}
          {ap && (
            <span className="ap-card-play" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 16 16"><path d="M4.9 2.9v10.2l8-5.1-8-5.1Z" fill="currentColor" /></svg>
            </span>
          )}
          {db && (
            <span className="db-card-play" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 16 16"><path d="M5.1 3.1v9.8l7.6-4.9-7.6-4.9Z" fill="currentColor" /></svg>
            </span>
          )}
          {db && it.ProductionYear ? <span className="badge db-year-badge">{it.ProductionYear}</span> : null}
          {it.UserData?.Played && it.Type !== 'Series' ? <span className="we-played" aria-label="已看">✓</span> : null}
          {pct > 0 && (
            <div className="we-progress" aria-hidden="true">
              <div className="we-progress-bar" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <div className="meta">
          <div className="name" title={cardTitle(it)}>{cardTitle(it)}</div>
          {sub && !db ? <div className="remarks">{sub}</div> : null}
        </div>
      </div>
    </div>
  );
}
