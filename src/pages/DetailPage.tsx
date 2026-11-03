// 详情页：电影 / 剧集（季 + 单集列表）/ 合集。
// 外壳类名沿用原项目：网飝 = nf-detail-*（影院背景）、大果 = ap-detail-*（玻璃）、大豆 = db-hero-*（左海报右信息）。
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import HeroBackdrop from '../components/HeroBackdrop';
import HScrollRow from '../components/HScrollRow';
import MediaCard from '../components/MediaCard';
import NfDetail from '../components/NfDetail';
import PlayOptions, { type PlayChoice } from '../components/PlayOptions';
import { backdropUrl, emby, personUrl, posterUrl, thumbUrl } from '../emby/client';
import { fmtDuration, fmtRuntime, progressPct, ticksToSec } from '../emby/format';
import type { EmbyItem } from '../emby/types';
import { useAsync } from '../lib/useAsync';
import { useSkinLayout } from '../lib/theme';

interface SeasonGroup {
  id: string;
  name: string;
  index: number;
  eps: EmbyItem[];
}

function groupSeasons(eps: EmbyItem[]): SeasonGroup[] {
  const m = new Map<string, SeasonGroup>();
  for (const e of eps) {
    const sid = e.SeasonId || `s${e.ParentIndexNumber ?? 0}`;
    let g = m.get(sid);
    if (!g) {
      g = { id: sid, name: e.SeasonName || (e.ParentIndexNumber === 0 ? '特别篇' : `第 ${e.ParentIndexNumber ?? 1} 季`), index: e.ParentIndexNumber ?? 0, eps: [] };
      m.set(sid, g);
    }
    g.eps.push(e);
  }
  return [...m.values()].sort((a, b) => (a.index || 999) - (b.index || 999));
}

/** 继续看哪一集：有进度的 > 第一个没看完的 > 第一集 */
function pickResume(eps: EmbyItem[]): EmbyItem | undefined {
  return (
    eps.find((e) => (e.UserData?.PlaybackPositionTicks || 0) > 0 && !e.UserData?.Played) ||
    eps.find((e) => !e.UserData?.Played && e.ParentIndexNumber !== 0) ||
    eps.find((e) => !e.UserData?.Played) ||
    eps[0]
  );
}

export default function DetailPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const shell = useSkinLayout().shell;
  const nf = shell === 'topbar';
  const ap = shell === 'sidebar';
  const db = shell === 'pillbar';

  const item = useAsync(() => emby.item(id), [id]);
  const it = item.data;

  // 单集 / 季 → 跳到所属剧集详情（保留选中信息）
  useEffect(() => {
    if (!it) return;
    if (it.Type === 'Episode' && it.SeriesId) nav(`/detail/${it.SeriesId}?ep=${it.Id}`, { replace: true });
    else if (it.Type === 'Season' && it.SeriesId) nav(`/detail/${it.SeriesId}?season=${it.Id}`, { replace: true });
  }, [it, nav]);

  const isSeries = it?.Type === 'Series';
  const isBox = it?.Type === 'BoxSet';
  const eps = useAsync(() => (isSeries ? emby.episodes(id) : Promise.resolve([] as EmbyItem[])), [id, isSeries]);
  const kids = useAsync(
    () => (isBox ? emby.items({ parentId: id, types: 'Movie,Series', sortBy: 'ProductionYear,SortName', limit: 200 }).then((r) => r.Items) : Promise.resolve([] as EmbyItem[])),
    [id, isBox],
  );
  const similar = useAsync(() => (it && !isBox ? emby.similar(id).catch(() => [] as EmbyItem[]) : Promise.resolve([] as EmbyItem[])), [id, it?.Id]);

  const seasons = useMemo(() => groupSeasons(eps.data || []), [eps.data]);
  const resumeEp = useMemo(() => pickResume(eps.data || []), [eps.data]);
  const [seasonId, setSeasonId] = useState('');
  useEffect(() => {
    if (!seasons.length) return;
    const wantEp = sp.get('ep');
    const wantSeason = sp.get('season');
    const byEp = wantEp ? eps.data?.find((e) => e.Id === wantEp)?.SeasonId : undefined;
    const target = byEp || wantSeason || resumeEp?.SeasonId || seasons[0].id;
    setSeasonId(seasons.some((s) => s.id === target) ? target : seasons[0].id);
  }, [seasons, resumeEp, eps.data, sp]);
  const selEpId = sp.get('ep');
  const selEp = eps.data?.find((e) => e.Id === selEpId);
  const curSeason = seasons.find((s) => s.id === seasonId) || seasons[0];

  const [fav, setFav] = useState(false);
  const [played, setPlayed] = useState(false);
  useEffect(() => {
    setFav(!!it?.UserData?.IsFavorite);
    setPlayed(!!it?.UserData?.Played);
  }, [it]);

  const toggleFav = async (): Promise<void> => {
    const next = !fav;
    setFav(next);
    try {
      await emby.setFavorite(id, next);
    } catch {
      setFav(!next);
    }
  };
  const togglePlayed = async (): Promise<void> => {
    const next = !played;
    setPlayed(next);
    try {
      await emby.setPlayed(id, next);
    } catch {
      setPlayed(!next);
    }
  };

  const [choice, setChoice] = useState<PlayChoice | null>(null);
  const play = (target?: EmbyItem): void => {
    const t = target || (isSeries ? selEp || resumeEp : it || undefined);
    if (t) nav(`/player/${t.Id}${choice && choice.itemId === t.Id ? choice.query : ''}`);
  };

  const backdrops = it ? [backdropUrl(it)].filter(Boolean) : [];
  const cast = (it?.People || []).filter((p) => p.Type === 'Actor' || p.Type === 'GuestStar').slice(0, 24);
  const directors = (it?.People || []).filter((p) => p.Type === 'Director').map((p) => p.Name).join('、');
  const resumeSec = ticksToSec((isSeries ? selEp || resumeEp : it)?.UserData?.PlaybackPositionTicks);
  const playLabel = isSeries
    ? (selEp || resumeEp)
      ? `▶ ${resumeSec > 30 ? '继续' : '播放'} S${(selEp || resumeEp)!.ParentIndexNumber ?? 1}E${(selEp || resumeEp)!.IndexNumber ?? 1}`
      : '▶ 播放'
    : resumeSec > 30
      ? `▶ 继续播放（${fmtDuration(resumeSec)}）`
      : '▶ 播放';

  const poster = it ? posterUrl(it, 480) : '';
  const meta = it
    ? [it.ProductionYear, it.OfficialRating, fmtRuntime(it.RunTimeTicks), it.CommunityRating ? `★ ${it.CommunityRating.toFixed(1)}` : '']
        .filter(Boolean)
        .join(' · ')
    : '';

  const favBtn = (
    <button type="button" className={`fav-btn${fav ? ' active' : ''}`} aria-pressed={fav} onClick={() => void toggleFav()}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
      </svg>
      {fav ? '已收藏' : '收藏'}
    </button>
  );

  // 网飝皮肤：仿流媒体网站的详情（电影 / 剧集），合集仍用通用布局
  if (nf && it && !isBox && it.Type !== 'Episode' && it.Type !== 'Season') {
    return (
      <NfDetail
        it={it}
        isSeries={isSeries}
        seasons={seasons}
        curSeason={curSeason}
        onSeason={setSeasonId}
        epsLoading={eps.loading}
        selEpId={selEpId}
        target={isSeries ? selEp || resumeEp : it}
        playLabel={playLabel}
        onPlay={play}
        fav={fav}
        onFav={() => void toggleFav()}
        played={played}
        onPlayed={() => void togglePlayed()}
        similar={similar.data || []}
        onChoice={setChoice}
      />
    );
  }

  return (
    <>
      <div className="topbar">
        <BackButton fallback="/" label="返回" />
        <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it?.Name}</span>
      </div>
      <div className={`content${nf ? ' nf-detail-wrap' : ap ? ' ap-detail-wrap' : db ? ' db-detail' : ''}`}>
        {item.loading && !it ? (
          <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>
        ) : item.error ? (
          <div className="err">{item.error}</div>
        ) : !it ? (
          <div className="empty">无详情</div>
        ) : (
          <>
            {backdrops.length > 0 && (nf || ap) && (
              <div className={nf ? 'nf-detail-backdrop' : 'ap-detail-backdrop'} style={nf ? { position: 'absolute' } : undefined} aria-hidden="true">
                <HeroBackdrop urls={backdrops} />
              </div>
            )}
            <div className={db ? 'db-hero' : 'row'} style={db ? undefined : { alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
              {poster ? (
                <img
                  src={poster}
                  alt=""
                  className={db ? 'db-hero-poster' : undefined}
                  style={db ? undefined : { width: 150, aspectRatio: '2/3', objectFit: 'cover', borderRadius: 8, background: 'var(--surface-3)' }}
                />
              ) : (
                <div className={db ? 'db-hero-poster db-hero-nocover' : 'we-nocover'}>暂无封面</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }} className={db ? 'db-hero-info' : undefined}>
                <h2 className={db ? 'db-hero-title' : undefined} style={db ? undefined : { margin: '0 0 8px' }}>{it.Name}</h2>
                {meta && <div className="muted" style={{ marginBottom: 4 }}>{meta}</div>}
                {it.Genres && it.Genres.length > 0 && <div className="muted" style={{ marginBottom: 4 }}>{it.Genres.join(' / ')}</div>}
                {directors && <div className="muted" style={{ marginBottom: 4 }}>导演：{directors}</div>}
                {it.Taglines?.[0] && (db ? <div className="db-remark-pill">{it.Taglines[0]}</div> : <div style={{ color: 'var(--accent-2)', marginBottom: 4 }}>{it.Taglines[0]}</div>)}
                <div
                  className={db ? 'muted db-hero-intro' : 'muted'}
                  style={db ? { fontSize: 13, overflow: 'auto', marginTop: 8 } : { fontSize: 12, maxHeight: 110, overflow: 'auto', marginTop: 8 }}
                >
                  {it.Overview || '暂无简介'}
                </div>
                {!isBox && (
                  <div className="row" style={{ marginTop: 14, alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button className={`primary${nf ? ' nf-play-btn' : ''}`} onClick={() => play()} disabled={isSeries && !resumeEp}>
                      {playLabel}
                    </button>
                    {favBtn}
                    <button type="button" className="fav-btn" aria-pressed={played} onClick={() => void togglePlayed()}>
                      {played ? '✓ 已看' : '标为已看'}
                    </button>
                  </div>
                )}
                {isBox && <div className="row" style={{ marginTop: 14 }}>{favBtn}</div>}
              </div>
            </div>

            {!isBox && (isSeries ? (selEp || resumeEp) : it) && (
              <PlayOptions itemId={(isSeries ? (selEp || resumeEp) : it)!.Id} onChange={setChoice} />
            )}

            {isSeries && (
              <>
                {db && <div className="db-sec-title">选集</div>}
                {eps.loading ? (
                  <div className="empty"><span className="spinner" aria-hidden="true" />加载剧集…</div>
                ) : eps.error ? (
                  <div className="err">{eps.error}</div>
                ) : (
                  <>
                    {seasons.length > 1 && (
                      <div className="quick-picks" role="group" aria-label="季" style={{ marginBottom: 10 }}>
                        {seasons.map((s) => (
                          <button key={s.id} className={`tag ${s.id === curSeason?.id ? 'active' : ''}`} aria-pressed={s.id === curSeason?.id} onClick={() => setSeasonId(s.id)}>
                            {s.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="we-eps">
                      {(curSeason?.eps || []).map((e) => {
                        const pct = progressPct(e);
                        const sel = sp.get('ep') === e.Id;
                        return (
                          <div key={e.Id} className={`we-ep${sel ? ' active' : ''}`} role="button" tabIndex={0} onClick={() => play(e)} onKeyDown={(ev) => ev.key === 'Enter' && play(e)}>
                            <div className="we-ep-thumb">
                              {thumbUrl(e, 320) ? <img src={thumbUrl(e, 320)} loading="lazy" alt="" /> : <span className="muted">无图</span>}
                              {pct > 0 && <div className="we-progress"><div className="we-progress-bar" style={{ width: `${pct}%` }} /></div>}
                              {e.UserData?.Played && <span className="we-played">✓</span>}
                            </div>
                            <div className="we-ep-info">
                              <div className="we-ep-title">{e.IndexNumber != null ? `${e.IndexNumber}. ` : ''}{e.Name}</div>
                              <div className="muted we-ep-meta">{fmtRuntime(e.RunTimeTicks)}</div>
                              {e.Overview && <div className="muted we-ep-ov">{e.Overview}</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}

            {isBox && (
              <div style={{ marginTop: 8 }}>
                <div className="grid">{(kids.data || []).map((k) => <MediaCard key={k.Id} it={k} />)}</div>
              </div>
            )}

            {cast.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="muted" style={{ marginBottom: 8 }}>演职员</div>
                <HScrollRow style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
                  {cast.map((p) => (
                    <div key={`${p.Id}-${p.Role}`} className="we-cast" title={p.Role ? `${p.Name} 饰 ${p.Role}` : p.Name}>
                      {personUrl(p) ? <img src={personUrl(p)} loading="lazy" alt="" /> : <div className="we-cast-ph">{p.Name.slice(0, 1)}</div>}
                      <div className="we-cast-name">{p.Name}</div>
                      {p.Role && <div className="muted we-cast-role">{p.Role}</div>}
                    </div>
                  ))}
                </HScrollRow>
              </div>
            )}

            {(similar.data || []).length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div className="muted" style={{ marginBottom: 8 }}>相关推荐</div>
                <HScrollRow style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 }}>
                  {(similar.data || []).map((s) => (
                    <div key={s.Id} style={{ flex: '0 0 132px', minWidth: 0 }}>
                      <MediaCard it={s} />
                    </div>
                  ))}
                </HScrollRow>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
