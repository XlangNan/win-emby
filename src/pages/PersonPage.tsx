// 演员 / 导演页：头像 + 简介 + 在媒体库里的作品
import { useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import MediaCard from '../components/MediaCard';
import { emby, personUrl } from '../emby/client';
import { getSession } from '../emby/session';
import { useCachedAsync } from '../lib/useAsync';

// 离开演员页（点进作品）再返回时：数据走缓存不重新请求，滚动位置和「展开简介」状态也恢复
const mem = new Map<string, { scroll: number; more: boolean }>();

const day = (v?: string): string => (v ? v.slice(0, 10) : '');

export default function PersonPage() {
  const { id = '' } = useParams();
  const sk = `${getSession()?.server ?? ''}:${getSession()?.userId ?? ''}:${id}`;
  const [more, setMoreRaw] = useState(() => mem.get(sk)?.more ?? false);
  const setMore = (f: (v: boolean) => boolean): void => setMoreRaw((v) => { const n = f(v); const m = mem.get(sk) ?? { scroll: 0, more: false }; mem.set(sk, { ...m, more: n }); return n; });
  const box = useRef<HTMLDivElement>(null);
  const who = useCachedAsync(`person:${sk}`, () => emby.person(id), 30 * 60 * 1000);
  const works = useCachedAsync(
    `person-works:${sk}`,
    () => emby.items({ personIds: id, types: 'Movie,Series', sortBy: 'ProductionYear,SortName', sortOrder: 'Descending', limit: 200 }).then((r) => r.Items),
    30 * 60 * 1000,
  );
  const ready = !!who.data && !!works.data;
  useLayoutEffect(() => {
    const y = mem.get(sk)?.scroll ?? 0;
    if (ready && box.current && y > 0) box.current.scrollTop = y;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sk]);
  const p = who.data;
  const img = p ? personUrl({ Id: p.Id, PrimaryImageTag: p.ImageTags?.Primary }, 300) : '';
  const born = day(p?.PremiereDate);
  const place = p?.ProductionLocations?.[0];
  const ov = (p?.Overview || '').trim();

  return (
    <>
      <div className="topbar">
        <BackButton fallback="/" label="返回" />
        <span className="muted">{p?.Name}</span>
      </div>
      <div className="content" ref={box} onScroll={(e) => { const m = mem.get(sk) ?? { scroll: 0, more: false }; mem.set(sk, { ...m, scroll: e.currentTarget.scrollTop }); }}>
        {who.loading && !p ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
        ) : who.error || !p ? (
          <div className="err" style={{ margin: 16 }}>{who.error || '没有找到这个人'}</div>
        ) : (
          <>
            <div className="we-person">
              {img ? <img className="we-person-img" src={img} alt="" /> : <div className="we-person-img we-cast-ph">{p.Name.slice(0, 1)}</div>}
              <div className="we-person-info">
                <h2>{p.Name}</h2>
                <div className="muted we-person-meta">{[born && `出生 ${born}`, place].filter(Boolean).join(' · ') || '暂无资料'}</div>
                {ov && (
                  <div className={`we-person-ov${more ? ' open' : ''}`} role="button" tabIndex={0} onClick={() => setMore((v) => !v)} onKeyDown={(e) => e.key === 'Enter' && setMore((v) => !v)}>
                    {ov}
                  </div>
                )}
                {ov.length > 90 && <button className="we-person-more" onClick={() => setMore((v) => !v)}>{more ? '收起' : '展开简介'}</button>}
              </div>
            </div>
            <h3 className="we-person-h">媒体库中的作品{works.data ? `（${works.data.length}）` : ''}</h3>
            {works.loading && !works.data ? (
              <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
            ) : (works.data || []).length === 0 ? (
              <div className="empty">媒体库里还没有这位的作品</div>
            ) : (
              <div className="grid">
                {(works.data || []).map((it) => <MediaCard key={it.Id} it={it} />)}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
