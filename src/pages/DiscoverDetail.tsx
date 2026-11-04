// 片库详情（MoviePilot 风格）：背景大图 + 海报 + 信息 + 订阅按钮，下方演员和相关推荐
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import HScrollRow from '../components/HScrollRow';
import TmdbImg from '../components/TmdbImg';
import { emby } from '../emby/client';
import { accountKey, accountLabel, kgAccounts, kgReady, kgSubscribe, kgUnsubscribe } from '../lib/kg';
import { mpReady, mpSubscribe, mpUnsubscribe } from '../lib/mp';
import { tmdbDetail } from '../lib/tmdb';
import { useAsync } from '../lib/useAsync';
import { PosterCard, useStatus } from './DiscoverPage';

export default function DiscoverDetail() {
  const { media: m = 'tv', id: sid = '0' } = useParams();
  const media = m === 'movie' ? 'movie' : 'tv';
  const id = Number(sid);
  const nav = useNavigate();
  const status = useStatus();
  const d = useAsync(() => tmdbDetail(media, id), [media, id]);
  const embyId = useAsync(
    () => emby.items({ providerId: `tmdb.${id}`, types: media === 'movie' ? 'Movie' : 'Series', limit: 1 }).then((r) => r.Items[0]?.Id || '').catch(() => ''),
    [media, id],
  );
  const accounts = useAsync(() => (kgReady() ? kgAccounts().catch(() => []) : Promise.resolve([])), []);
  const [acct, setAcct] = useState(() => localStorage.getItem('wemby-kg-acct') || '');
  const usable = (accounts.data || []).filter((a) => a.logged && a.state !== 'bad');
  // 默认选上次用的；上次的不可用就选第一个已登录的
  useEffect(() => {
    if (!accounts.data) return;
    if (!usable.some((a) => accountKey(a) === acct)) setAcct(usable[0] ? accountKey(usable[0]) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.data]);
  const pickAcct = (v: string): void => {
    setAcct(v);
    try {
      localStorage.setItem('wemby-kg-acct', v);
    } catch {
      /* ignore */
    }
  };
  const [drv, accId] = acct.split('|');
  const kgOn = kgReady();
  const mpOn = mpReady();
  const [target, setTarget] = useState<'kg' | 'mp'>(() => (localStorage.getItem('wemby-sub-target') === 'mp' ? 'mp' : 'kg'));
  const tgt: 'kg' | 'mp' = target === 'mp' ? (mpOn ? 'mp' : 'kg') : kgOn ? 'kg' : 'mp';
  const pickTarget = (v: 'kg' | 'mp'): void => {
    setTarget(v);
    try {
      localStorage.setItem('wemby-sub-target', v);
    } catch {
      /* ignore */
    }
  };
  const [season, setSeason] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const it = d.data;
  const tasks = status.subs.get(`${media}:${id}`) || [];
  const curTask = media === 'movie' ? tasks[0] : tasks.find((t) => (t.season || 1) === season);
  const mpTasks = status.mps.get(`${media}:${id}`) || [];
  const curMp = media === 'movie' ? mpTasks[0] : mpTasks.find((t) => (t.season || 1) === season);

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await fn();
      setMsg(ok);
      status.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const meta = useMemo(
    () => (it ? [it.year, it.rating ? `★ ${it.rating.toFixed(1)}` : '', it.runtime ? `${it.runtime} 分钟` : '', media === 'tv' && it.seasons.length ? `共 ${it.seasons.length} 季` : ''].filter(Boolean).join(' · ') : ''),
    [it, media],
  );

  return (
    <>
      <div className="topbar">
        <BackButton fallback="/discover" label="返回" />
        <span className="muted">{it?.title}</span>
      </div>
      <div className="content" style={{ padding: 0 }}>
        {d.loading && !it ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
        ) : d.error || !it ? (
          <div className="err" style={{ margin: 16 }}>{d.error || '没有详情'}</div>
        ) : (
          <>
            <div className="mp-hero">
              <TmdbImg path={it.backdrop || it.poster} size="w1280" className="mp-hero-bg" />
              <div className="mp-hero-shade" />
              <div className="mp-hero-body">
                <div className="mp-hero-poster"><TmdbImg path={it.poster} size="w500" className="mp-img" /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2 className="mp-hero-title">{it.title}<span className={`mp-type inline ${media}`}>{media === 'movie' ? '电影' : '电视剧'}</span></h2>
                  <div className="mp-meta">{meta}</div>
                  <div className="mp-chips">{it.genres.map((g) => <span key={g} className="mp-chip">{g}</span>)}</div>
                  {it.tagline && <div className="mp-tag">{it.tagline}</div>}
                  <div className="mp-ov">{it.overview || '暂无简介'}</div>

                  <div className="row" style={{ marginTop: 16, gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {embyId.data && <button className="primary" onClick={() => nav(`/detail/${embyId.data}`)}>▶ 已入库，去播放</button>}
                    {media === 'tv' && it.seasons.length > 0 && (
                      <select value={season} onChange={(e) => setSeason(Number(e.target.value))} aria-label="季">
                        {it.seasons.map((s) => {
                          const sub = tasks.some((t) => (t.season || 1) === s.season_number) || mpTasks.some((t) => (t.season || 1) === s.season_number);
                          return <option key={s.season_number} value={s.season_number}>{s.name || `第 ${s.season_number} 季`}（{s.episode_count} 集）{sub ? ' ✓已订阅' : ''}</option>;
                        })}
                      </select>
                    )}
                    {!kgOn && !mpOn ? (
                      <button onClick={() => nav('/config')}>去设置追更服务 / MoviePilot 后可订阅</button>
                    ) : (
                      <>
                        {kgOn && mpOn && (
                          <div className="seg" role="group" aria-label="订阅方式">
                            <button type="button" className={`tag ${tgt === 'kg' ? 'active' : ''}`} aria-pressed={tgt === 'kg'} onClick={() => pickTarget('kg')}>转存网盘 · kuake go</button>
                            <button type="button" className={`tag ${tgt === 'mp' ? 'active' : ''}`} aria-pressed={tgt === 'mp'} onClick={() => pickTarget('mp')}>下载本地 · MoviePilot</button>
                          </div>
                        )}
                        {tgt === 'kg' && (curTask ? (
                          <>
                            <span className="mp-chip on">{media === 'movie' ? '网盘 · 已想看' : `网盘 · 第 ${season} 季已订阅`}{curTask.status ? ` · ${curTask.status}` : ''}</span>
                            <button disabled={busy} onClick={() => void act(() => kgUnsubscribe(curTask.id), '已取消网盘订阅')}>取消订阅</button>
                          </>
                        ) : (
                          <>
                            {(accounts.data || []).length > 0 && (
                              <select value={acct} onChange={(e) => pickAcct(e.target.value)} aria-label="存入哪个网盘" title="存入哪个网盘">
                                {(accounts.data || []).map((a) => (
                                  <option key={accountKey(a)} value={accountKey(a)} disabled={!a.logged || a.state === 'bad'}>{accountLabel(a)}</option>
                                ))}
                              </select>
                            )}
                            <button className={embyId.data ? '' : 'primary'} disabled={busy || ((accounts.data || []).length > 0 && usable.length === 0)} onClick={() => void act(() => kgSubscribe(media, id, season, drv || undefined, accId || undefined), media === 'movie' ? '已提交，追更服务会自动找资源存入网盘' : `已订阅第 ${season} 季，追更服务会自动找资源存入网盘`)}>
                              {busy ? '提交中…' : media === 'movie' ? '＋ 想看（转存网盘）' : '＋ 订阅（转存网盘）'}
                            </button>
                          </>
                        ))}
                        {tgt === 'mp' && (curMp ? (
                          <>
                            <span className="mp-chip on">{media === 'movie' ? 'MoviePilot · 已订阅' : `MoviePilot · 第 ${season} 季已订阅`}</span>
                            <button disabled={busy} onClick={() => void act(() => mpUnsubscribe(curMp.id), '已取消 MoviePilot 订阅')}>取消订阅</button>
                          </>
                        ) : (
                          <button className={embyId.data ? '' : 'primary'} disabled={busy} onClick={() => void act(() => mpSubscribe(media, id, it.title, it.year, season), media === 'movie' ? '已提交，MoviePilot 会自动搜索并下载到本地' : `已订阅第 ${season} 季，MoviePilot 会自动搜索并下载到本地`)}>
                            {busy ? '提交中…' : media === 'movie' ? '＋ 订阅（下载本地）' : '＋ 订阅（下载本地）'}
                          </button>
                        ))}
                        {kgOn && mpOn && (curTask || curMp) && tgt === (curTask ? 'mp' : 'kg') && (
                          <span className="muted" style={{ fontSize: 12 }}>{curTask ? '已在网盘订阅' : '已在 MoviePilot 订阅'}</span>
                        )}
                      </>
                    )}
                  </div>
                  {msg && <div className="muted" style={{ marginTop: 8 }}>{msg}</div>}
                  {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
                </div>
              </div>
            </div>

            <div style={{ padding: '4px 24px 24px' }}>
              {it.cast.length > 0 && (
                <section className="mp-sec">
                  <div className="mp-sec-head"><span className="mp-bar" /><h3>演员</h3></div>
                  <HScrollRow style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
                    {it.cast.map((p) => (
                      <div key={p.id} className="we-cast" title={p.character ? `${p.name} 饰 ${p.character}` : p.name}>
                        {p.profile ? <TmdbImg path={p.profile} size="w185" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 6px' }} /> : <div className="we-cast-ph">{p.name.slice(0, 1)}</div>}
                        <div className="we-cast-name">{p.name}</div>
                        {p.character && <div className="muted we-cast-role">{p.character}</div>}
                      </div>
                    ))}
                  </HScrollRow>
                </section>
              )}
              {it.similar.length > 0 && (
                <section className="mp-sec">
                  <div className="mp-sec-head"><span className="mp-bar" /><h3>相关推荐</h3></div>
                  <HScrollRow style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
                    {it.similar.map((s) => {
                      const k = `${s.media}:${s.id}`;
                      return <div key={k} className="mp-cell"><PosterCard it={s} have={status.have.has(k)} subbed={status.anySub(k)} /></div>;
                    })}
                  </HScrollRow>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
