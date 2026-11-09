// 手机「媒体」页：Emby 各媒体库，封面取自 Emby 媒体库自己的图片
import { useNavigate } from 'react-router-dom';
import { isMobileApp } from '../lib/platform';
import { emby, posterUrl, thumbUrl } from '../emby/client';
import type { EmbyItem } from '../emby/types';
import { loadPlayPrefs } from '../lib/prefs';
import { getSession } from '../emby/session';
import { useCachedAsync } from '../lib/useAsync';

const SKIP = new Set(['playlists', 'livetv', 'music', 'books', 'photos', 'musicvideos', 'trailers', 'folders']);

async function load(): Promise<{ v: EmbyItem; n: number }[]> {
  const prefs = loadPlayPrefs();
  const views = (await emby.views())
    .filter((v) => !SKIP.has(v.CollectionType || '') && !prefs.hiddenLibs.includes(v.Id))
    .sort((a, b) => {
      const ia = prefs.libOrder.indexOf(a.Id), ib = prefs.libOrder.indexOf(b.Id);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  return Promise.all(views.map(async (v) => {
    const r = await emby.items({ parentId: v.Id, types: 'Movie,Series', start: 0, limit: 1 }).catch(() => null);
    return { v, n: r?.TotalRecordCount ?? 0 };
  }));
}

/** 缓存键：区分账号 / 服务器，也区分隐藏、排序设置 */
function mediaKey(): string {
  const s = getSession();
  const p = loadPlayPrefs();
  return `media-libs:${s?.server || ''}:${s?.userId || ''}:${JSON.stringify([p.hiddenLibs, p.libOrder])}`;
}

export default function MediaPage() {
  const nav = useNavigate();
  const { data, loading, error, reload } = useCachedAsync(mediaKey(), load, 60 * 1000);
  return (
    <div className="content m-media">
      <div className="m-media-title">媒体</div>
      {!isMobileApp && (
        <div className="we-cats" style={{ padding: '0 16px 12px' }}>
          <button type="button" className="tag" onClick={() => nav('/discover')}>🎞 片库（TMDB 发现）</button>
          <button type="button" className="tag" onClick={() => nav('/favorites')}>⭐ 收藏</button>
          <button type="button" className="tag" onClick={() => nav('/history')}>🕘 历史</button>
        </div>
      )}
      {loading && !data && <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>}
      {error && <div className="err">{error}<button style={{ marginLeft: 10 }} onClick={reload}>重试</button></div>}
      <div className="m-lib-grid">
      {data?.map(({ v, n }) => {
        const img = v.ImageTags?.Primary ? posterUrl(v, 900) : thumbUrl(v, 900);
        return (
          <div key={v.Id} className="m-lib" role="button" onClick={() => nav(`/lib/${v.Id}`)}>
            {img && <img src={img} alt="" draggable={false} />}
            <i />
            <b>{v.Name}</b>
            <span>{n ? `${n} 部` : ''}</span>
          </div>
        );
      })}
      </div>
    </div>
  );
}
