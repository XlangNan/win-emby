// 手机首页主推卡：圆角竖版海报 + 底部居中的标题 / 类型 / 两个并排按钮；手指拖动跟手滑动切换。
import { useEffect, useMemo, useRef, useState } from 'react';
import { emby, logoUrl, posterUrl } from '../emby/client';
import type { EmbyItem } from '../emby/types';

export default function MobileHero({ items, onOpen, onPlay }: { items: EmbyItem[]; onOpen: (it: EmbyItem) => void; onPlay: (it: EmbyItem) => void }) {
  const list = useMemo(() => items.slice(0, 6), [items]);
  const key = list.map((i) => i.Id).join('|');
  const [idx, setIdx] = useState(0);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [favs, setFavs] = useState<Record<string, boolean>>({});
  const box = useRef<HTMLDivElement>(null);
  const t0 = useRef<{ x: number; y: number; lock: '' | 'h' | 'v' } | null>(null);

  useEffect(() => setIdx(0), [key]);
  // 自动轮播（拖动时暂停）
  useEffect(() => {
    if (list.length < 2 || dragging) return;
    const t = setTimeout(() => setIdx((i) => (i + 1) % list.length), 6500);
    return () => clearTimeout(t);
  }, [list.length, idx, dragging]);

  if (!list.length) return null;

  const onTs = (e: React.TouchEvent): void => {
    t0.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, lock: '' };
  };
  const onTm = (e: React.TouchEvent): void => {
    const s = t0.current;
    if (!s) return;
    const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
    if (!s.lock) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) s.lock = 'h';
      else if (Math.abs(dy) > 8) s.lock = 'v';
    }
    if (s.lock === 'h') {
      setDragging(true);
      // 两端加一点阻尼
      const edge = (idx === 0 && dx > 0) || (idx === list.length - 1 && dx < 0);
      setDrag(edge ? dx * 0.3 : dx);
    }
  };
  const onTe = (): void => {
    const s = t0.current;
    t0.current = null;
    if (s?.lock === 'h') {
      const w = box.current?.clientWidth || 360;
      if (drag < -w * 0.18 && idx < list.length - 1) setIdx(idx + 1);
      else if (drag > w * 0.18 && idx > 0) setIdx(idx - 1);
    }
    setDrag(0);
    setDragging(false);
  };

  const isFav = (it: EmbyItem): boolean => favs[it.Id] ?? !!it.UserData?.IsFavorite;
  const toggleFav = (it: EmbyItem): void => {
    const next = !isFav(it);
    setFavs((f) => ({ ...f, [it.Id]: next }));
    emby.setFavorite(it.Id, next).catch(() => setFavs((f) => ({ ...f, [it.Id]: !next })));
  };

  return (
    <section className="mh">
      <div className="mh-card" ref={box} onTouchStart={onTs} onTouchMove={onTm} onTouchEnd={onTe} onTouchCancel={onTe}>
        <div
          className="mh-track"
          style={{ transform: `translateX(calc(${-idx * 100}% + ${drag}px))`, transition: dragging ? 'none' : 'transform 380ms cubic-bezier(.22,.8,.24,1)' }}
        >
          {list.map((it, i) => {
            const logo = logoUrl(it);
            const tags = [...(it.Genres || []).slice(0, 3), it.Type === 'Series' ? '' : ''].filter(Boolean);
            return (
              <div key={it.Id} className="mh-slide">
                {Math.abs(i - idx) <= 1 && <img className="mh-img" src={posterUrl(it, 800)} alt="" draggable={false} onClick={() => onOpen(it)} />}
                <div className="mh-shade" />
                <div className="mh-info">
                  {logo ? <img className="mh-logo" src={logo} alt={it.Name} /> : <div className="mh-title">{it.Name}</div>}
                  <div className="mh-tags">{tags.length ? tags.join(' · ') : it.ProductionYear || ''}</div>
                  <div className="mh-btns">
                    <button className="mh-play" onClick={() => onPlay(it)}>
                      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" /></svg>
                      播放
                    </button>
                    <button className="mh-list" onClick={() => toggleFav(it)}>
                      <span aria-hidden="true">{isFav(it) ? '✓' : '＋'}</span>
                      {isFav(it) ? '已收藏' : '收藏'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {list.length > 1 && (
        <div className="mh-dots">
          {list.map((it, i) => <span key={it.Id} className={i === idx ? 'on' : ''} />)}
        </div>
      )}
    </section>
  );
}
