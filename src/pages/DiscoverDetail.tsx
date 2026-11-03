// 片库详情：简介 / 演员 / 相似推荐 + 「想看 / 订阅」（交给追更服务自动找资源存进网盘）
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import HScrollRow from '../components/HScrollRow';
import KgImg from '../components/KgImg';
import { emby } from '../emby/client';
import { kgDetail, kgSimilar, kgSubscribe, kgUnsubscribe, kgYear } from '../lib/kg';
import { useAsync } from '../lib/useAsync';
import { KgCard } from './DiscoverPage';

export default function DiscoverDetail() {
  const { media: m = 'tv', id: sid = '0' } = useParams();
  const media = m === 'movie' ? 'movie' : 'tv';
  const id = Number(sid);
  const nav = useNavigate();
  const d = useAsync(() => kgDetail(media, id), [media, id]);
  const sim = useAsync(() => kgSimilar(media, id).then((r) => r.items).catch(() => []), [media, id]);
  // 这部片在 Emby 里有没有（按 TMDB 编号找）
  const have = useAsync(
    () => emby.items({ providerId: `tmdb.${id}`, types: media === 'movie' ? 'Movie' : 'Series', limit: 1 }).then((r) => r.Items[0]?.Id || '').catch(() => ''),
    [media, id],
  );
  const [season, setSeason] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const it = d.data;
  const subId = !it ? '' : media === 'movie' ? it.sub_id || '' : it.subscribed_seasons?.[String(season)] || '';

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await fn();
      setMsg(ok);
      d.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const label = media === 'movie' ? '想看' : '订阅';
  return (
    <>
      <div className="topbar">
        <BackButton fallback="/discover" label="返回" />
        <span className="muted">{it?.name}</span>
      </div>
      <div className="content">
        {d.loading && !it ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
        ) : d.error || !it ? (
          <div className="err">{d.error || '没有详情'}</div>
        ) : (
          <>
            <div className="row" style={{ alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
              <div style={{ width: 150, flex: 'none' }}><KgImg path={it.poster_url} style={{ width: 150, aspectRatio: '2/3', objectFit: 'cover', borderRadius: 8 }} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ margin: '0 0 8px' }}>{it.name}</h2>
                <div className="muted" style={{ marginBottom: 4 }}>
                  {[kgYear(it), it.vote_average ? `★ ${it.vote_average}` : '', it.runtime ? `${it.runtime} 分钟` : '', it.number_of_seasons ? `共 ${it.number_of_seasons} 季` : ''].filter(Boolean).join(' · ')}
                </div>
                {it.genres && it.genres.length > 0 && <div className="muted" style={{ marginBottom: 4 }}>{it.genres.join(' / ')}</div>}
                {it.tagline && <div style={{ color: 'var(--accent-2)', marginBottom: 4 }}>{it.tagline}</div>}
                <div className="muted" style={{ fontSize: 12, maxHeight: 120, overflow: 'auto', marginTop: 8 }}>{it.overview || '暂无简介'}</div>

                <div className="row" style={{ marginTop: 14, gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  {have.data && <button className="primary" onClick={() => nav(`/detail/${have.data}`)}>▶ 已在 Emby 里，去播放</button>}
                  {media === 'tv' && (it.seasons?.length || 0) > 0 && (
                    <select value={season} onChange={(e) => setSeason(Number(e.target.value))} aria-label="季">
                      {it.seasons!.map((s) => (
                        <option key={s.season_number} value={s.season_number}>
                          {s.name || `第 ${s.season_number} 季`}（{s.episode_count} 集）{it.subscribed_seasons?.[String(s.season_number)] ? ' ✓已订阅' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {subId ? (
                    <>
                      <span className="tag active">{media === 'movie' ? '已想看，追更服务正在找资源' : `第 ${season} 季已订阅`}</span>
                      <button disabled={busy} onClick={() => void act(() => kgUnsubscribe(subId), '已取消')}>取消</button>
                    </>
                  ) : (
                    <button className={have.data ? '' : 'primary'} disabled={busy} onClick={() => void act(() => kgSubscribe(media, id, season), media === 'movie' ? '已提交，追更服务会自动找资源存入网盘' : `已订阅第 ${season} 季，追更服务会自动找资源存入网盘`)}>
                      {busy ? '提交中…' : media === 'movie' ? '＋ 想看（自动找资源）' : '＋ 订阅（自动找资源）'}
                    </button>
                  )}
                </div>
                {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}
                {err && <div className="err" style={{ marginTop: 8 }}>{label}失败：{err}</div>}
              </div>
            </div>

            {(it.cast?.length || 0) > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="muted" style={{ marginBottom: 8 }}>演员</div>
                <HScrollRow style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
                  {it.cast!.map((p) => (
                    <div key={p.id} className="we-cast" title={p.character ? `${p.name} 饰 ${p.character}` : p.name}>
                      {p.profile_url ? <KgImg path={p.profile_url} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 6px' }} /> : <div className="we-cast-ph">{p.name.slice(0, 1)}</div>}
                      <div className="we-cast-name">{p.name}</div>
                      {p.character && <div className="muted we-cast-role">{p.character}</div>}
                    </div>
                  ))}
                </HScrollRow>
              </div>
            )}

            {(sim.data || []).length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="muted" style={{ marginBottom: 8 }}>相似推荐</div>
                <HScrollRow style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
                  {(sim.data || []).map((s) => <div key={`${s.media}-${s.id}`} style={{ flex: '0 0 132px', minWidth: 0 }}><KgCard it={s} /></div>)}
                </HScrollRow>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
