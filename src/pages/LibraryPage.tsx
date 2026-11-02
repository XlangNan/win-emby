// 媒体库：分页网格 + 排序 / 类型 / 筛选
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import MediaCard from '../components/MediaCard';
import { emby } from '../emby/client';
import type { EmbyItem } from '../emby/types';
import { useAsync } from '../lib/useAsync';

const PAGE = 60;

const SORTS: { id: string; label: string; by: string; order: 'Ascending' | 'Descending' }[] = [
  { id: 'added', label: '最近添加', by: 'DateCreated,SortName', order: 'Descending' },
  { id: 'name', label: '名称', by: 'SortName', order: 'Ascending' },
  { id: 'year', label: '发行日期', by: 'PremiereDate,SortName', order: 'Descending' },
  { id: 'rating', label: '评分', by: 'CommunityRating,SortName', order: 'Descending' },
  { id: 'played', label: '最近观看', by: 'DatePlayed,SortName', order: 'Descending' },
];

const FILTERS: { id: string; label: string; v: string }[] = [
  { id: 'all', label: '全部', v: '' },
  { id: 'unplayed', label: '未观看', v: 'IsUnplayed' },
  { id: 'played', label: '已观看', v: 'IsPlayed' },
  { id: 'fav', label: '收藏', v: 'IsFavorite' },
];

function typesFor(collectionType?: string): string {
  if (collectionType === 'movies') return 'Movie';
  if (collectionType === 'tvshows') return 'Series';
  if (collectionType === 'boxsets') return 'BoxSet';
  return 'Movie,Series,BoxSet,Video';
}

export default function LibraryPage() {
  const { id = '' } = useParams();
  const view = useAsync(async () => (await emby.views()).find((v) => v.Id === id) || null, [id]);
  const genres = useAsync(() => emby.genres(id).catch(() => [] as string[]), [id]);
  const [sort, setSort] = useState('added');
  const [filter, setFilter] = useState('all');
  const [genre, setGenre] = useState('');
  const [items, setItems] = useState<EmbyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const seq = useRef(0);

  const fetchPage = (start: number, reset: boolean): void => {
    const my = ++seq.current;
    const s = SORTS.find((x) => x.id === sort) || SORTS[0];
    setLoading(true);
    setErr('');
    emby
      .items({
        parentId: id,
        types: typesFor(view.data?.CollectionType),
        sortBy: s.by,
        sortOrder: s.order,
        start,
        limit: PAGE,
        filters: FILTERS.find((f) => f.id === filter)?.v,
        genres: genre,
      })
      .then((r) => {
        if (my !== seq.current) return;
        setItems((prev) => (reset ? r.Items : [...prev, ...r.Items]));
        setTotal(r.TotalRecordCount);
      })
      .catch((e: unknown) => my === seq.current && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => my === seq.current && setLoading(false));
  };

  // 切库 / 改排序筛选 → 回到第一页
  useEffect(() => {
    if (view.loading) return;
    setItems([]);
    fetchPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sort, filter, genre, view.loading]);

  const title = view.data?.Name || '媒体库';
  const more = items.length < total;

  return (
    <>
      <div className="topbar">
        <BackButton fallback="/" label="返回" />
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span className="muted" style={{ fontSize: 12 }}>{total ? `${total} 项` : ''}</span>
        <span style={{ flex: 1 }} />
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="排序">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="类型">
          <option value="">全部类型</option>
          {(genres.data || []).map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div className="content">
        <div className="quick-picks" role="group" aria-label="筛选" style={{ marginBottom: 12 }}>
          {FILTERS.map((f) => (
            <button key={f.id} className={`tag ${filter === f.id ? 'active' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        {err ? (
          <div className="err">{err}<button style={{ marginLeft: 10 }} onClick={() => fetchPage(0, true)}>重试</button></div>
        ) : items.length === 0 && loading ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
        ) : items.length === 0 ? (
          <div className="empty">没有符合条件的内容</div>
        ) : (
          <>
            <div className="grid">
              {items.map((it) => <MediaCard key={it.Id} it={it} />)}
            </div>
            {more && (
              <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
                <button disabled={loading} onClick={() => fetchPage(items.length, false)}>
                  {loading ? '加载中…' : `加载更多（${items.length} / ${total}）`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
