// 影片卡：沿用原项目 .card-media 结构，大果 / 大豆各自的悬停播放徽标、进度条、未看数
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ItemMenu, { type MenuState } from './ItemMenu';
import { cardSub, cardTitle, progressPct } from '../emby/format';
import { posterUrl, thumbUrl } from '../emby/client';
import type { EmbyItem } from '../emby/types';
import { useSkinLayout } from '../lib/theme';

export default function MediaCard({
  it, onOpen, landscape, inResume, onChanged,
}: {
  it: EmbyItem;
  onOpen?: (it: EmbyItem) => void;
  /** 横版海报（继续观看用） */
  landscape?: boolean;
  /** 在「继续观看」里：右键菜单多一项「移除」 */
  inResume?: boolean;
  /** 右键菜单改了已看/收藏后刷新列表 */
  onChanged?: () => void;
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const nav = useNavigate();
  const shell = useSkinLayout().shell;
  const ap = shell === 'sidebar';
  const db = shell === 'pillbar';
  const poster = landscape ? thumbUrl(it, 560) : posterUrl(it);
  const pct = progressPct(it);
  const sub = cardSub(it);
  const open = (): void => {
    if (onOpen) onOpen(it);
    else nav(`/detail/${it.Id}`);
  };
  return (
    <div
      className={`card-media${landscape ? ' we-land' : ''}`}
      style={{ cursor: 'pointer' }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY, it });
      }}
      role="button"
      tabIndex={0}
      title={cardTitle(it)}
      onClick={(e) => { if (!e.currentTarget.contains(e.target as Node)) return; open(); }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
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
      {menu && (
        <ItemMenu
          state={menu}
          inResume={inResume}
          onClose={() => setMenu(null)}
          onPlay={(x) => (x.Type === 'Series' || x.Type === 'Season' ? nav(`/detail/${x.Id}`) : nav(`/player/${x.Id}`))}
          onOpen={(x) => nav(`/detail/${x.Type === 'Episode' && x.SeriesId ? x.SeriesId : x.Id}`)}
          onChanged={() => onChanged?.()}
        />
      )}
    </div>
  );
}
