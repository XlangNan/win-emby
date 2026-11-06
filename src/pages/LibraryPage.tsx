// 媒体库：分页网格 + 排序 / 类型 / 筛选
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import MediaCard from '../components/MediaCard';
import { emby } from '../emby/client';
import type { EmbyItem } from '../emby/types';
import { loadPlayPrefs, savePlayPrefs } from '../lib/prefs';
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

/** 媒体库页缓存：离开再回来，停在上次的排序 / 筛选 / 已加载的列表 / 滚动位置，不重新加载 */
interface LibMem { sort: string; filter: string; genre: string; items: EmbyItem[]; total: number; scroll: number }
const libMem = new Map<string, LibMem>();

export default function LibraryPage() {
  const { id = '' } = useParams();
  const hit0 = libMem.get(id);
  const hit = useRef(!!hit0 && hit0.items.length > 0);
  const box = useRef<HTMLDivElement>(null);
  const view = useAsync(async () => (await emby.views()).find((v) => v.Id === id) || null, [id]);
  const genres = useAsync(() => emby.genres(id).catch(() => [] as string[]), [id]);
  const [sort, setSort] = useState(hit0?.sort || 'added');
  const [filter, setFilter] = useState(hit0?.filter || 'all');
  const [genre, setGenre] = useState(hit0?.genre || '');
  const [size, setSize] = useState(loadPlayPrefs().posterSize);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [items, setItems] = useState<EmbyItem[]>(hit0?.items || []);
  const [total, setTotal] = useState(hit0?.total || 0);
  const [loading, setLoading] = useState(!hit0?.items.length);
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
    if (hit.current) { // 回到之前的页面：用缓存，不重新请求
      hit.current = false;
      return;
    }
    setItems([]);
    fetchPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sort, filter, genre, view.loading]);

  useEffect(() => {
    if (items.length) libMem.set(id, { sort, filter, genre, items, total, scroll: libMem.get(id)?.scroll || 0 });
  }, [id, sort, filter, genre, items, total]);
  useLayoutEffect(() => {
    if (hit0 && box.current) box.current.scrollTop = hit0.scroll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = view.data?.Name || '媒体库';
  const more = items.length < total;

  return (
    <>
      <div className="topbar">
        <BackButton fallback="/" label="返回" />
        <h3 style={{ margin: 0, whiteSpace: 'nowrap', flexShrink: 0 }}>{title}</h3>
        <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}>{total ? `${total} 项` : ''}</span>
        <span style={{ flex: 1 }} />
        <span style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" aria-label="调整海报大小" aria-expanded={sizeOpen} title="海报大小" onClick={() => setSizeOpen((v) => !v)}
            style={{ padding: '6px 10px', fontSize: 13 }}>▦</button>
          {sizeOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 30 }} onClick={() => setSizeOpen(false)} />
              <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 31, background: '#1f1f1f', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
                <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>海报</span>
                <input type="range" min={90} max={260} step={10} value={size} aria-label="海报大小"
                  onChange={(e) => { const v = Number(e.target.value); setSize(v); savePlayPrefs({ posterSize: v }); }} style={{ width: 130 }} />
              </div>
            </>
          )}
        </span>
        <select style={{ maxWidth: 130, minWidth: 0 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="排序">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select style={{ maxWidth: 160, minWidth: 0, textOverflow: 'ellipsis' }} value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="类型">
          <option value="">全部类型</option>
          {(genres.data || []).filter((g) => g.length <= 12).map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div className="content" ref={box} onScroll={(e) => { const c = libMem.get(id); if (c) c.scroll = e.currentTarget.scrollTop; }}>
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
            <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))`, ['--cols' as string]: Math.max(2, Math.min(5, Math.round(window.innerWidth / (size + 20)))) }}>
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
