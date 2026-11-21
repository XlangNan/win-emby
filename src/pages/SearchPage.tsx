import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ListPage from './ListPage';
import TmdbImg from '../components/TmdbImg';
import { emby, personUrl } from '../emby/client';
import { mpReady, mpSubscribe } from '../lib/mp';
import { tmdbReady, tmdbSearch, type TmdbItem } from '../lib/tmdb';
import { useStatus } from './DiscoverPage';
import type { EmbyItem } from '../emby/types';

/** 片库（TMDB）里搜到、但本地 Emby 还没有的作品：可以直接订阅 */
function NotInLibrary({ q }: { q: string }) {
  const nav = useNavigate();
  const status = useStatus();
  const [items, setItems] = useState<TmdbItem[] | null>(null);
  const [err, setErr] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState<Set<string>>(new Set());
  const on = tmdbReady();
  useEffect(() => {
    setItems(null); setErr(''); setMsg('');
    if (!q || !on) return;
    let dead = false;
    tmdbSearch(q).then((r) => !dead && setItems(r.items)).catch((e: unknown) => !dead && setErr(e instanceof Error ? e.message : String(e)));
    return () => { dead = true; };
  }, [q, on]);
  if (!q) return null;
  if (!on) return <div className="muted" style={{ margin: '22px 4px', fontSize: 13 }}>想同时看到「片库里还没入库的作品」并直接订阅：到 设置 里填上 TMDB 密钥。</div>;
  const rest = (items || []).filter((x) => !status.have.has(`${x.media}:${x.id}`));
  const subbed = (x: TmdbItem): boolean => status.anySub(`${x.media}:${x.id}`) || done.has(`${x.media}:${x.id}`);
  const subscribe = async (x: TmdbItem): Promise<void> => {
    const k = `${x.media}:${x.id}`;
    if (!mpReady()) { nav(`/discover/${x.media}/${x.id}`); return; }   // 没接 MoviePilot：去详情页选网盘 / 季再订阅
    setBusyKey(k); setMsg('');
    try {
      await mpSubscribe(x.media, x.id, x.title, x.year, 1);
      setDone((d) => new Set(d).add(k));
      setMsg(x.media === 'movie' ? `已订阅《${x.title}》` : `已订阅《${x.title}》第 1 季（其他季到详情页订阅）`);
      status.reload();
    } catch (e) {
      setMsg(`订阅失败：${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusyKey(''); }
  };
  return (
    <div className="we-sr-nl">
      <div className="we-sr-h">片库中未入库{items ? `（${rest.length}）` : ''}</div>
      {msg && <div className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>{msg}</div>}
      {err ? <div className="err">{err}</div>
        : !items ? <div className="muted"><span className="spinner" aria-hidden="true" />搜索片库…</div>
        : rest.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>片库里没有更多未入库的匹配作品。</div>
        : (
          <div className="mp-grid">
            {rest.map((x) => {
              const k = `${x.media}:${x.id}`;
              const sb = subbed(x);
              return (
                <div key={k} className="mp-card we-sr-nlc" role="button" tabIndex={0} title={x.title} onClick={() => nav(`/discover/${x.media}/${x.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/discover/${x.media}/${x.id}`)}>
                  <div className="mp-poster">
                    <TmdbImg path={x.poster} className="mp-img" />
                    <span className={`mp-type ${x.media}`}>{x.media === 'movie' ? '电影' : '电视剧'}</span>
                    {x.rating > 0 && <span className="mp-rate">{x.rating.toFixed(1)}</span>}
                    {sb && <span className="mp-state">已订阅</span>}
                  </div>
                  <div className="mp-title">{x.title}</div>
                  <div className="mp-sub">{x.year}</div>
                  <button className={`we-sr-sub${sb ? '' : ' primary'}`} disabled={sb || busyKey === k} onClick={(e) => { e.stopPropagation(); void subscribe(x); }}>
                    {sb ? '已订阅' : busyKey === k ? '提交中…' : mpReady() ? '＋ 订阅' : '去订阅'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

export default function SearchPage() {
  const [sp] = useSearchParams();
  const q = (sp.get('q') || '').trim();
  const nav = useNavigate();
  const [people, setPeople] = useState<EmbyItem[]>([]);
  useEffect(() => {
    setPeople([]);
    if (!q) return;
    let dead = false;
    emby.searchPersons(q, 20).then((r) => !dead && setPeople(r)).catch(() => undefined);
    return () => { dead = true; };
  }, [q]);
  return (
    <ListPage
      title={`搜索：${q}`}
      footer={<NotInLibrary q={q} />}
      empty={`已入库里没有匹配「${q}」的内容`}
      deps={[q]}
      header={people.length > 0 && (
        <div className="we-sr-people">
          <div className="we-sr-h">演员 / 导演</div>
          <div className="we-sr-row">
            {people.map((p) => (
              <div key={p.Id} className="we-sr-p" role="button" tabIndex={0} onClick={() => nav(`/person/${p.Id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/person/${p.Id}`)}>
                {p.ImageTags?.Primary ? <img src={personUrl({ Id: p.Id, PrimaryImageTag: p.ImageTags.Primary }, 160)} alt="" loading="lazy" /> : <span className="we-sr-ph">{p.Name.slice(0, 1)}</span>}
                <span>{p.Name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      load={(start, limit) =>
        q
          ? emby.items({ search: q, types: 'Movie,Series,BoxSet', sortBy: 'SortName', start, limit })
          : Promise.resolve({ Items: [], TotalRecordCount: 0 })
      }
    />
  );
}
