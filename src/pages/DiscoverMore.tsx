// 「查看更多」：某一行的完整列表，分页加载
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { findRow, type TmdbItem } from '../lib/tmdb';
import { PosterCard, useStatus } from './DiscoverPage';

export default function DiscoverMore() {
  const { row = '' } = useParams();
  const def = findRow(row);
  const status = useStatus();
  const [items, setItems] = useState<TmdbItem[]>([]);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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
    void more();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);

  return (
    <>
      <div className="topbar"><BackButton fallback="/discover" label="返回" /><h3 style={{ margin: 0 }}>{def?.title || '片库'}</h3></div>
      <div className="content">
        <div className="mp-grid">
          {items.map((it) => {
            const k = `${it.media}:${it.id}`;
            return <PosterCard key={k} it={it} have={status.have.has(k)} subbed={status.subs.has(k)} />;
          })}
        </div>
        {err && <div className="err">{err}</div>}
        {busy && <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>}
        {!busy && page < pages && items.length > 0 && <div style={{ textAlign: 'center', margin: 16 }}><button onClick={() => void more()}>加载更多</button></div>}
      </div>
    </>
  );
}
