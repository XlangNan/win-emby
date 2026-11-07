// 通用列表页：收藏 / 观看历史 / 搜索结果 共用（只是数据源不同）
import { useEffect, useRef, useState } from 'react';
import BackButton from '../components/BackButton';
import MediaCard from '../components/MediaCard';
import type { EmbyItem } from '../emby/types';
import type { ItemsResult } from '../emby/types';

const PAGE = 60;

export default function ListPage({
  title,
  load,
  empty,
  deps,
  onOpen,
  header,
}: {
  title: string;
  load: (start: number, limit: number) => Promise<ItemsResult>;
  empty: string;
  deps: unknown[];
  onOpen?: (it: EmbyItem) => void;
  header?: React.ReactNode;
}) {
  const [items, setItems] = useState<EmbyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const fetchPage = (start: number, reset: boolean): void => {
    const my = ++seq.current;
    setLoading(true);
    setErr('');
    loadRef
      .current(start, PAGE)
      .then((r) => {
        if (my !== seq.current) return;
        setItems((prev) => (reset ? r.Items : [...prev, ...r.Items]));
        setTotal(r.TotalRecordCount);
      })
      .catch((e: unknown) => my === seq.current && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => my === seq.current && setLoading(false));
  };

  useEffect(() => {
    setItems([]);
    fetchPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return (
    <>
      <div className="topbar">
        <BackButton fallback="/" label="返回" />
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span className="muted" style={{ fontSize: 12 }}>{total ? `${total} 项` : ''}</span>
      </div>
      <div className="content">
        {header}
        {err ? (
          <div className="err">{err}<button style={{ marginLeft: 10 }} onClick={() => fetchPage(0, true)}>重试</button></div>
        ) : items.length === 0 && loading ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
        ) : items.length === 0 ? (
          <div className="empty">{empty}</div>
        ) : (
          <>
            <div className="grid">
              {items.map((it) => <MediaCard key={it.Id} it={it} onOpen={onOpen} />)}
            </div>
            {items.length < total && (
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
