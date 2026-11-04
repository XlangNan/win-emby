// 片库（MoviePilot 风格）：顶部分类标签 + 横向海报行，数据直接取自 TMDB。
// 海报悬停显示评分 / 简介和「订阅」按钮，点击进详情。订阅交给追更服务（kuakego-plus）。
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HScrollRow from '../components/HScrollRow';
import TmdbImg from '../components/TmdbImg';
import { emby } from '../emby/client';
import { kgReady, kgTasks, type KgTask } from '../lib/kg';
import { mpMediaKey, mpReady, mpSubs, type MpSub } from '../lib/mp';
import { TABS, embyTmdbIndex, tmdbReady, tmdbSearch, type Page, type RowDef, type TmdbItem } from '../lib/tmdb';
import { useAsync } from '../lib/useAsync';

const TAB_KEY = 'wemby-disc-tab';

/** 已入库 / 已订阅状态（整页共用，只查一次） */
export function useStatus(): { have: Set<string>; subs: Map<string, KgTask[]>; mps: Map<string, MpSub[]>; anySub: (k: string) => boolean; reload: () => void } {
  const [tick, setTick] = useState(0);
  const have = useAsync(() => embyTmdbIndex(() => emby.tmdbIndex()), [tick]);
  const tasks = useAsync(() => (kgReady() ? kgTasks().catch(() => [] as KgTask[]) : Promise.resolve([] as KgTask[])), [tick]);
  const mpl = useAsync(() => (mpReady() ? mpSubs().catch(() => [] as MpSub[]) : Promise.resolve([] as MpSub[])), [tick]);
  const mps = useMemo(() => {
    const m = new Map<string, MpSub[]>();
    for (const t of mpl.data || []) {
      const k = mpMediaKey(t);
      m.set(k, [...(m.get(k) || []), t]);
    }
    return m;
  }, [mpl.data]);
  const subs = useMemo(() => {
    const m = new Map<string, KgTask[]>();
    for (const t of tasks.data || []) {
      const k = `${t.media === 'movie' ? 'movie' : 'tv'}:${t.tmdb_id}`;
      m.set(k, [...(m.get(k) || []), t]);
    }
    return m;
  }, [tasks.data]);
  return { have: have.data || new Set(), subs, mps, anySub: (k: string) => subs.has(k) || mps.has(k), reload: () => setTick((n) => n + 1) };
}

export function PosterCard({ it, have, subbed }: { it: TmdbItem; have: boolean; subbed: boolean }) {
  const nav = useNavigate();
  const go = (): void => nav(`/discover/${it.media}/${it.id}`);
  return (
    <div className="mp-card" role="button" tabIndex={0} onClick={go} onKeyDown={(e) => e.key === 'Enter' && go()} title={it.title}>
      <div className="mp-poster">
        <TmdbImg path={it.poster} className="mp-img" />
        <span className={`mp-type ${it.media}`}>{it.media === 'movie' ? '电影' : '电视剧'}</span>
        {it.rating > 0 && <span className="mp-rate">{it.rating.toFixed(1)}</span>}
        {(have || subbed) && <span className="mp-state">{have ? '已入库' : '已订阅'}</span>}
        <div className="mp-hover">
          <div className="mp-hover-year">{it.year}</div>
          <div className="mp-hover-ov">{it.overview || '暂无简介'}</div>
        </div>
      </div>
      <div className="mp-title">{it.title}</div>
      <div className="mp-sub">{it.year}</div>
    </div>
  );
}

function Row({ def, status }: { def: RowDef; status: ReturnType<typeof useStatus> }) {
  const nav = useNavigate();
  const d = useAsync(() => def.load(1), [def.id]);
  return (
    <section className="mp-sec">
      <div className="mp-sec-head">
        <span className="mp-bar" />
        <h3>{def.title}</h3>
        <span style={{ flex: 1 }} />
        <button className="mp-more" onClick={() => nav(`/discover/more/${def.id}`)}>查看更多 ›</button>
      </div>
      {d.loading && !d.data ? (
        <div className="muted" style={{ padding: '24px 4px' }}><span className="spinner" aria-hidden="true" />加载中…</div>
      ) : d.error ? (
        <div className="err">{d.error}<button style={{ marginLeft: 10 }} onClick={d.reload}>重试</button></div>
      ) : (
        <HScrollRow style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
          {(d.data?.items || []).map((it) => {
            const k = `${it.media}:${it.id}`;
            return <div key={k} className="mp-cell"><PosterCard it={it} have={status.have.has(k)} subbed={status.anySub(k)} /></div>;
          })}
        </HScrollRow>
      )}
    </section>
  );
}

export default function DiscoverPage() {
  const nav = useNavigate();
  const [tab, setTab] = useState(() => localStorage.getItem(TAB_KEY) || 'rec');
  const [q, setQ] = useState('');
  const [kw, setKw] = useState('');
  const [page, setPage] = useState<Page | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ready = tmdbReady();
  const status = useStatus();
  const cur = TABS.find((t) => t.id === tab) || TABS[0];

  const run = async (word: string, n: number): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      const r = await tmdbSearch(word, n);
      setPage((p) => (n > 1 && p ? { items: [...p.items, ...r.items], pages: r.pages } : r));
      setPageNo(n);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (kw) void run(kw, 1);
    else setPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kw]);

  const pick = (id: string): void => {
    setTab(id);
    setKw('');
    setQ('');
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>片库</h3>
        <div className="mp-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`mp-tab${!kw && tab === t.id ? ' active' : ''}`} onClick={() => pick(t.id)}>{t.label}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <form onSubmit={(e) => { e.preventDefault(); setKw(q.trim()); }} className="row" style={{ gap: 6 }}>
          <input value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setKw(''); }} placeholder="搜索电影 / 电视剧…" style={{ width: 220 }} />
          <button type="submit">搜索</button>
        </form>
      </div>
      <div className="content">
        {!ready ? (
          <div className="empty">
            还没有填 TMDB API Key，片库的数据直接来自 TMDB。
            <button style={{ marginLeft: 10 }} onClick={() => nav('/config')}>去设置</button>
          </div>
        ) : kw ? (
          <>
            {err && <div className="err">{err}</div>}
            <div className="mp-grid">
              {(page?.items || []).map((it) => {
                const k = `${it.media}:${it.id}`;
                return <PosterCard key={k} it={it} have={status.have.has(k)} subbed={status.anySub(k)} />;
              })}
            </div>
            {!busy && page && page.items.length === 0 && !err && <div className="empty">没有找到「{kw}」</div>}
            {busy && <div className="empty"><span className="spinner" aria-hidden="true" />搜索中…</div>}
            {!busy && page && pageNo < page.pages && <div style={{ textAlign: 'center', margin: 16 }}><button onClick={() => void run(kw, pageNo + 1)}>加载更多</button></div>}
          </>
        ) : (
          cur.rows.map((r) => <Row key={r.id} def={r} status={status} />)
        )}
      </div>
    </>
  );
}
