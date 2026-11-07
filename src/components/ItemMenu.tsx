// 影片右键菜单（自绘，代替浏览器自带菜单）：播放 / 标记已看·未看 / 收藏 / 详情 / 从继续观看移除
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { emby } from '../emby/client';
import type { EmbyItem } from '../emby/types';

export interface MenuState {
  x: number;
  y: number;
  it: EmbyItem;
}

export default function ItemMenu({
  state, inResume, onClose, onPlay, onOpen, onChanged,
}: {
  state: MenuState;
  inResume?: boolean;
  onClose: () => void;
  onPlay: (it: EmbyItem) => void;
  onOpen: (it: EmbyItem) => void;
  /** info.remove：该项应立刻从「继续观看」里消失（先乐观移除，服务器完成后会再无参调用一次以刷新） */
  onChanged: (info?: { id: string; remove?: boolean }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });
  const it = state.it;
  const played = !!it.UserData?.Played;
  const fav = !!it.UserData?.IsFavorite;

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      x: Math.max(4, Math.min(state.x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(state.y, window.innerHeight - r.height - 4)),
    });
  }, [state.x, state.y]);

  useEffect(() => {
    const close = (): void => onClose();
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const run = (fn: () => Promise<void> | void, drop?: boolean): void => {
    onClose();
    if (drop && inResume) onChanged({ id: it.Id, remove: true });
    Promise.resolve(fn()).then(() => onChanged(), () => onChanged());
  };

  const row = (label: string, fn: () => Promise<void> | void, danger?: boolean, drop?: boolean): React.ReactNode => (
    <div className={`we-ctx-item${danger ? ' danger' : ''}`} role="menuitem" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); e.preventDefault(); run(fn, drop); }}>
      {label}
    </div>
  );

  return createPortal(
    <div
      ref={ref}
      className="we-ctx"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {row('▶ 播放', () => onPlay(it))}
      {it.Type !== 'Series' && it.Type !== 'Season' && !played && row(it.Type === 'Episode' ? '✓ 标记本集为已观看' : '✓ 标记为已观看', () => emby.setPlayed(it.Id, true), false, true)}
      {(played || inResume || (it.UserData?.PlaybackPositionTicks || 0) > 0 || it.Type === 'Series') && row(it.Type === 'Episode' ? '○ 标记本集为未观看' : '○ 标记为未观看', async () => { await emby.setPlayed(it.Id, false); if ((it.UserData?.PlaybackPositionTicks || 0) > 0) await emby.clearResume(it.Id); }, false, true)}
      {it.Type === 'Series' && row('✓ 标记整部为已观看', () => emby.setPlayed(it.Id, true))}
      {row(fav ? '★ 取消收藏' : '☆ 加入收藏', () => emby.setFavorite(it.Id, !fav))}
      {row(it.Type === 'Episode' ? '▤ 查看剧集（标记已看 / 未看）' : 'ⓘ 查看详情', () => onOpen(it))}
      {inResume && row('✕ 从继续观看中移除', () => emby.clearResume(it.Id), true, true)}
    </div>,
    document.body,
  );
}
