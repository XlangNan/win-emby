// 「查看更多」：某一行的完整列表，分页加载。
// 支持排序；列表、页码、排序、滚动位置缓存在模块里，进详情再返回不刷新、回到原位置。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { findRow, type TmdbItem } from '../lib/tmdb';
import { PosterCard, useStatus } from './DiscoverPage';

type SortId = 'default' | 'date' | 'pop' | 'rating' | 'title';
const SORTS: { id: SortId; label: string }[] = [
  { id: 'default', label: '默认顺序' },
  { id: 'date', label: '最新上映' },
  { id: 'pop', label: '热度最高' },
  { id: 'rating', label: '评分最高' },
  { id: 'title', label: '名称' },
];

interface Cache { items: TmdbItem[]; page: number; pages: number; sort: SortId; scroll: number }
const cache = new Map<string, Cache>();

function sortItems(list: TmdbItem[], sort: SortId): TmdbItem[] {
  if (sort === 'default') return list;
  const a = [...list];
  if (sort === 'date') a.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  else if (sort === 'pop') a.sort((x, y) => y.pop - x.pop);
  else if (sort === 'rating') a.sort((x, y) => y.rating - x.rating);
  else a.sort((x, y) => x.title.localeCompare(y.title, 'zh-CN'));
  return a;
}

export default function DiscoverMore() {
  const { row = '' } = useParams();
  const def = findRow(row);
  const status = useStatus();
  const init = cache.get(row);
  const [items, setItems] = useState<TmdbItem[]>(init?.items || []);
  const [page, setPage] = useState(init?.page || 0);
  const [pages, setPages] = useState(init?.pages || 1);
  const [sort, setSort] = useState<SortId>(init?.sort || 'default');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const scrollRef = useRef(init?.scroll || 0);

  // 把当前状态写进缓存
  useEffect(() => {
    if (items.length) cache.set(row, { items, page, pages, sort, scroll: scrollRef.current });
  }, [row, items, page, pages, sort]);

  // 恢复滚动位置（只在首次挂载、且有缓存时）
  useLayoutEffect(() => {
    if (init && box.current) box.current.scrollTop = init.scroll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    scrollRef.current = e.currentTarget.scrollTop;
    const c = cache.get(row);
    if (c) c.scroll = scrollRef.current;
  };

  const more = async (): Promise<void> => {
    if (!def || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await def.load(page + 1);
      setItems((x) => {
        const seen = new Set(x.map((i) => `${i.media}:${i.id}`));
        return [...x, ...r.items.filter((i) => !seen.has(`${i.media}:${i.id}`))];
      });
      setPage(page + 1);
      setPages(r.pages);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!init) void more();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);

  const shown = useMemo(() => sortItems(items, sort), [items, sort]);

  return (
    <>
      <div className="topbar">
        <BackButton fallback="/discover" label="返回" />
        <h3 style={{ margin: 0 }}>{def?.title || '片库'}</h3>
        <span style={{ flex: 1 }} />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortId)} aria-label="排序">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <div className="content" ref={box} onScroll={onScroll}>
        <div className="mp-grid">
          {shown.map((it) => {
            const k = `${it.media}:${it.id}`;
            return <PosterCard key={k} it={it} have={status.have.has(k)} subbed={status.subs.has(k)} />;
          })}
        </div>
        {err && <div className="err">{err}<button style={{ marginLeft: 10 }} onClick={() => void more()}>重试</button></div>}
        {busy && <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>}
        {!busy && page < pages && items.length > 0 && (
          <div style={{ textAlign: 'center', margin: 16 }}>
            <button onClick={() => void more()}>加载更多</button>
            {sort !== 'default' && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>排序作用于已加载的内容，加载更多后会重新排序</div>}
          </div>
        )}
      </div>
    </>
  );
}
