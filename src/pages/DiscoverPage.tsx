// 片库：来自追更服务（kuakego-plus）的推荐电影 / 剧集。点进去可以「想看 / 订阅」，由它自动找资源存进网盘。
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HScrollRow from '../components/HScrollRow';
import KgImg from '../components/KgImg';
import { kgHome, kgReady, kgSearch, kgYear, type KgItem, type KgScope } from '../lib/kg';
import { useAsync } from '../lib/useAsync';

const SCOPES: [KgScope, string][] = [['tv', '剧集'], ['movie', '电影'], ['anime', '动漫'], ['variety', '综艺']];
const SCOPE_KEY = 'wemby-kg-scope';

export function KgCard({ it }: { it: KgItem }) {
  const nav = useNavigate();
  const go = (): void => nav(`/discover/${it.media}/${it.id}`);
  const badge = it.in_emby ? '已入库' : it.sub_id ? (it.media === 'movie' ? '已想看' : '已订阅') : '';
  return (
    <div className="card-media" role="button" tabIndex={0} style={{ cursor: 'pointer' }} title={it.name} onClick={go} onKeyDown={(e) => e.key === 'Enter' && go()}>
      <div className="card">
        <div style={{ position: 'relative' }}>
          <KgImg path={it.poster_url} />
          {badge && <span className="we-kg-badge">{badge}</span>}
        </div>
        <div className="meta">
          <div className="name">{it.name}</div>
          <div className="remarks">{[kgYear(it), it.vote_average ? `★ ${it.vote_average}` : ''].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const nav = useNavigate();
  const [scope, setScope] = useState<KgScope>(() => (localStorage.getItem(SCOPE_KEY) as KgScope) || 'tv');
  const [q, setQ] = useState('');
  const [kw, setKw] = useState('');
  const ready = kgReady();
  const home = useAsync(() => (ready && !kw ? kgHome(scope) : Promise.resolve(null)), [scope, kw, ready]);
  const found = useAsync(() => (ready && kw ? kgSearch(kw, scope) : Promise.resolve(null)), [scope, kw, ready]);

  const pick = (s: KgScope): void => {
    setScope(s);
    try {
      localStorage.setItem(SCOPE_KEY, s);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>片库</h3>
        <div className="row" style={{ gap: 6, marginLeft: 16 }}>
          {SCOPES.map(([k, l]) => (
            <button key={k} className={`tag ${scope === k ? 'active' : ''}`} onClick={() => pick(k)}>{l}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <form onSubmit={(e) => { e.preventDefault(); setKw(q.trim()); }} className="row" style={{ gap: 6 }}>
          <input value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setKw(''); }} placeholder="搜索想看的片名…" style={{ width: 200 }} />
          <button type="submit">搜索</button>
        </form>
      </div>
      <div className="content">
        {!ready ? (
          <div className="empty">
            还没有连接追更服务（kuakego-plus）。
            <button style={{ marginLeft: 10 }} onClick={() => nav('/config')}>去设置</button>
          </div>
        ) : kw ? (
          found.loading ? (
            <div className="empty"><span className="spinner" aria-hidden="true" />搜索中…</div>
          ) : found.error ? (
            <div className="err">{found.error}</div>
          ) : (
            <div className="grid">{(found.data?.items || []).map((it) => <KgCard key={`${it.media}-${it.id}`} it={it} />)}</div>
          )
        ) : home.loading && !home.data ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />加载推荐…</div>
        ) : home.error ? (
          <div className="err">{home.error}<button style={{ marginLeft: 10 }} onClick={home.reload}>重试</button></div>
        ) : (
          (home.data?.rows || []).filter((r) => r.items.length).map((r) => (
            <div key={r.label} style={{ marginBottom: 22 }}>
              <h3 style={{ margin: '0 0 10px' }}>{r.label}</h3>
              <HScrollRow style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
                {r.items.map((it) => (
                  <div key={`${it.media}-${it.id}`} style={{ flex: '0 0 140px', minWidth: 0 }}><KgCard it={it} /></div>
                ))}
              </HScrollRow>
            </div>
          ))
        )}
      </div>
    </>
  );
}
