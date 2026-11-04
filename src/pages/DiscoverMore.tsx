// 「查看更多」：某一行的完整列表，分页加载。
// 支持排序；列表、页码、排序、滚动位置缓存在模块里，进详情再返回不刷新、回到原位置。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { findRow, type SortId, type TmdbItem } from '../lib/tmdb';
import { PosterCard, useStatus } from './DiscoverPage';

const SORTS: { id: SortId; label: string }[] = [
  { id: 'default', label: '默认顺序' },
  { id: 'date', label: '最新上映' },
  { id: 'pop', label: '热度最高' },
  { id: 'rating', label: '评分最高' },
];

interface Cache { items: TmdbItem[]; page: number; pages: number; sort: SortId; scroll: number }
const cache = new Map<string, Cache>();

function sortItems(list: TmdbItem[], sort: SortId): TmdbItem[] {
  if (sort === 'default') return list;
  const a = [...list];
  if (sort === 'date') a.sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  else if (sort === 'pop') a.sort((x, y) => y.pop - x.pop);
  else a.sort((x, y) => y.rating - x.rating);
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

  const seq = useRef(0);
  /** 加载一页：reset = 换排序 / 重来，清空后从第 1 页开始；否则接在列表最后（顺序不动） */
  const more = async (reset = false, sortNow: SortId = sort): Promise<void> => {
    if (!def || (busy && !reset)) return;
    const my = ++seq.current;
    const next = reset ? 1 : page + 1;
    setBusy(true);
    setErr('');
    try {
      const r = await def.load(next, sortNow);
      if (my !== seq.current) return;
      // 服务端排序的行整库有序；其它行只排这一页内部，再整体接在后面
      const batch = def.server ? r.items : sortItems(r.items, sortNow);
      setItems((x) => {
        const base = reset ? [] : x;
        const seen = new Set(base.map((i) => `${i.media}:${i.id}`));
        return [...base, ...batch.filter((i) => !seen.has(`${i.media}:${i.id}`))];
      });
      setPage(next);
      setPages(r.pages);
    } catch (e) {
      if (my === seq.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (my === seq.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (!init) void more(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);

  const changeSort = (v: SortId): void => {
    setSort(v);
    setItems([]);
    setPage(0);
    if (box.current) box.current.scrollTop = 0;
    scrollRef.current = 0;
    void more(true, v);
  };

  const shown = items;

  return (
    <>
      <div className="topbar">
        <BackButton fallback="/discover" label="返回" />
        <h3 style={{ margin: 0 }}>{def?.title || '片库'}</h3>
        <span style={{ flex: 1 }} />
        <select value={sort} onChange={(e) => changeSort(e.target.value as SortId)} aria-label="排序">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <div className="content" ref={box} onScroll={onScroll}>
        <div className="mp-grid">
          {shown.map((it) => {
            const k = `${it.media}:${it.id}`;
            return <PosterCard key={k} it={it} have={status.have.has(k)} subbed={status.anySub(k)} />;
          })}
        </div>
        {err && <div className="err">{err}<button style={{ marginLeft: 10 }} onClick={() => void more(items.length === 0)}>重试</button></div>}
        {busy && <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>}
        {!busy && page < pages && items.length > 0 && (
          <div style={{ textAlign: 'center', margin: 16 }}>
            <button onClick={() => void more()}>加载更多</button>
            {sort !== 'default' && !def?.server && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>这个榜单由 TMDB 固定排序，排序只作用于每一页内部</div>}
          </div>
        )}
      </div>
    </>
  );
}
