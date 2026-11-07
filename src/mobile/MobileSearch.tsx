// 手机搜索页：输入即搜，结果是海报网格
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { personUrl } from '../emby/client';
import MediaCard from '../components/MediaCard';
import { emby } from '../emby/client';
import type { EmbyItem } from '../emby/types';
import { loadSearchHistory, pushSearchHistory } from '../lib/prefs';

export default function MobileSearch() {
  const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') || '');
  const [items, setItems] = useState<EmbyItem[]>([]);
  const [ppl, setPpl] = useState<EmbyItem[]>([]);
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<string[]>(() => loadSearchHistory());

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setItems([]);
      setPpl([]);
      return;
    }
    let dead = false;
    setBusy(true);
    const t = setTimeout(() => {
      emby.searchPersons(term, 8).then((r) => !dead && setPpl(r)).catch(() => !dead && setPpl([]));
      emby
        .items({ search: term, types: 'Movie,Series,BoxSet', sortBy: 'SortName', start: 0, limit: 60 })
        .then((r) => {
          if (dead) return;
          setItems(r.Items);
          pushSearchHistory(term);
          setHist(loadSearchHistory());
        })
        .catch(() => !dead && setItems([]))
        .finally(() => !dead && setBusy(false));
    }, 350);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <>
      <div className="m-search-bar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索电影、剧集" autoFocus spellCheck={false} />
        {q && <button className="m-search-x" aria-label="清空" onClick={() => setQ('')}><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg></button>}
      </div>
      <div className="content">
        {!q.trim() ? (
          hist.length > 0 ? (
            <>
              <div className="muted" style={{ marginBottom: 8 }}>最近搜索</div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {hist.map((h) => <button key={h} className="tag" onClick={() => setQ(h)}>{h}</button>)}
              </div>
            </>
          ) : (
            <div className="empty">输入片名开始搜索</div>
          )
        ) : busy && items.length === 0 && ppl.length === 0 ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />搜索中…</div>
        ) : items.length === 0 && ppl.length === 0 ? (
          <div className="empty">没有匹配「{q.trim()}」的内容</div>
        ) : (
          <>
            {ppl.length > 0 && (
              <>
                <div className="muted" style={{ margin: '0 12px 8px' }}>演员 / 导演</div>
                <div className="row" style={{ gap: 14, overflowX: 'auto', padding: '0 12px 14px' }}>
                  {ppl.map((p) => (
                    <button key={p.Id} className="m-person" onClick={() => nav(`/person/${p.Id}`)}>
                      <span className="m-person-img" style={personUrl({ Id: p.Id, PrimaryImageTag: p.ImageTags?.Primary }, 160) ? { backgroundImage: `url("${personUrl({ Id: p.Id, PrimaryImageTag: p.ImageTags?.Primary }, 160)}")` } : undefined} />
                      <span className="m-person-name">{p.Name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {items.length > 0 && <div className="grid">{items.map((it) => <MediaCard key={it.Id} it={it} />)}</div>}
          </>
        )}
      </div>
    </>
  );
}
