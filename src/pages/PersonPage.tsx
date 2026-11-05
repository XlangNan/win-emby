// 演员 / 导演页：头像 + 简介 + 在媒体库里的作品
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import MediaCard from '../components/MediaCard';
import { emby, personUrl } from '../emby/client';
import { useAsync } from '../lib/useAsync';

const day = (v?: string): string => (v ? v.slice(0, 10) : '');

export default function PersonPage() {
  const { id = '' } = useParams();
  const [more, setMore] = useState(false);
  const who = useAsync(() => emby.person(id), [id]);
  const works = useAsync(
    () => emby.items({ personIds: id, types: 'Movie,Series', sortBy: 'ProductionYear,SortName', sortOrder: 'Descending', limit: 200 }).then((r) => r.Items),
    [id],
  );
  const p = who.data;
  const born = day(p?.PremiereDate);
  const place = p?.ProductionLocations?.[0];
  const ov = (p?.Overview || '').trim();

  return (
    <>
      <div className="topbar">
        <BackButton fallback="/" label="返回" />
        <span className="muted">{p?.Name}</span>
      </div>
      <div className="content">
        {who.loading && !p ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
        ) : who.error || !p ? (
          <div className="err" style={{ margin: 16 }}>{who.error || '没有找到这个人'}</div>
        ) : (
          <>
            <div className="we-person">
              {personUrl(p, 300) ? <img className="we-person-img" src={personUrl(p, 300)} alt="" /> : <div className="we-person-img we-cast-ph">{p.Name.slice(0, 1)}</div>}
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
