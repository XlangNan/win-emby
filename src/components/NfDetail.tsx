// 网飞皮肤的电影 / 剧集详情：整幅背景大图 + 大标题 + 白色播放按钮，下方剧集列表、更多类似内容、详细信息
import BackButton from './BackButton';
import MediaCard from './MediaCard';
import PlayOptions, { type PlayChoice } from './PlayOptions';
import { backdropUrl, logoUrl, personUrl, thumbUrl } from '../emby/client';
import { fmtRuntime, progressPct } from '../emby/format';
import type { EmbyItem } from '../emby/types';

export interface NfSeason { id: string; name: string; eps: EmbyItem[] }

export interface NfDetailProps {
  it: EmbyItem;
  isSeries: boolean;
  seasons: NfSeason[];
  curSeason?: NfSeason;
  onSeason: (id: string) => void;
  epsLoading: boolean;
  selEpId: string | null;
  /** 当前要播放的对象（剧集 = 续播那一集） */
  target?: EmbyItem;
  playLabel: string;
  onPlay: (t?: EmbyItem) => void;
  fav: boolean;
  onFav: () => void;
  played: boolean;
  onPlayed: () => void;
  similar: EmbyItem[];
  onChoice: (c: PlayChoice) => void;
}

const resBadge = (it: EmbyItem): string => {
  const h = it.MediaSources?.[0]?.MediaStreams?.find((s) => s.Type === 'Video')?.Height || 0;
  return h >= 2000 ? '4K' : h >= 700 ? 'HD' : '';
};

export default function NfDetail(p: NfDetailProps) {
  const { it } = p;
  const bg = backdropUrl(it, 1920);
  const logo = logoUrl(it);
  const actors = (it.People || []).filter((x) => x.Type === 'Actor' || x.Type === 'GuestStar');
  const directors = (it.People || []).filter((x) => x.Type === 'Director').map((x) => x.Name);
  const badge = resBadge(it) || resBadge(p.target || it);

  return (
    <div className="nfd">
      <div className="nfd-back"><BackButton fallback="/" label="返回" /></div>

      <section className="nfd-hero">
        {bg && <img className="nfd-bg" src={bg} alt="" />}
        <div className="nfd-shade" />
        <div className="nfd-body">
          {logo ? <img className="nfd-logo" src={logo} alt={it.Name} /> : <h1 className="nfd-title">{it.Name}</h1>}
          <div className="nfd-meta">
            {it.CommunityRating ? <span className="nfd-match">★ {it.CommunityRating.toFixed(1)}</span> : null}
            {it.ProductionYear ? <span>{it.ProductionYear}</span> : null}
            {it.OfficialRating ? <span className="nfd-age">{it.OfficialRating}</span> : null}
            {fmtRuntime(it.RunTimeTicks) ? <span>{fmtRuntime(it.RunTimeTicks)}</span> : null}
            {p.isSeries && p.seasons.length > 0 ? <span>{p.seasons.length} 季</span> : null}
            {badge ? <span className="nfd-hd">{badge}</span> : null}
          </div>
          {it.Taglines?.[0] && <div className="nfd-tagline">{it.Taglines[0]}</div>}
          <p className="nfd-ov">{it.Overview || '暂无简介'}</p>
          <div className="nfd-actions">
            <button className="nfd-play" onClick={() => p.onPlay()} disabled={p.isSeries && !p.target}>
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" /></svg>
              {p.playLabel.replace(/^▶\s*/, '')}
            </button>
            <button className={`nfd-circle${p.fav ? ' on' : ''}`} title={p.fav ? '已收藏' : '加入收藏'} aria-pressed={p.fav} onClick={p.onFav}>
              {p.fav ? '✓' : '＋'}
            </button>
            <button className={`nfd-circle${p.played ? ' on' : ''}`} title={p.played ? '标为未看' : '标为已看'} aria-pressed={p.played} onClick={p.onPlayed}>
              👁
            </button>
          </div>
        </div>
        <div className="nfd-side">
          {actors.length > 0 && <div><span>主演：</span>{actors.slice(0, 5).map((x) => x.Name).join('、')}</div>}
          {it.Genres && it.Genres.length > 0 && <div><span>类型：</span>{it.Genres.join('、')}</div>}
          {directors.length > 0 && <div><span>导演：</span>{directors.join('、')}</div>}
        </div>
      </section>

      <div className="nfd-sections">
        {p.isSeries && (
          <section className="nfd-sec">
            <div className="nfd-sec-head">
              <h2>剧集</h2>
              {p.seasons.length > 1 && (
                <select className="nfd-select" value={p.curSeason?.id} onChange={(e) => p.onSeason(e.target.value)} aria-label="季">
                  {p.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
            {p.epsLoading ? (
              <div className="empty"><span className="spinner" aria-hidden="true" />加载剧集…</div>
            ) : (
              <div className="nfd-eps">
                {(p.curSeason?.eps || []).map((e, i) => {
                  const pct = progressPct(e);
                  const sel = p.selEpId === e.Id || (!p.selEpId && p.target?.Id === e.Id);
                  return (
                    <div key={e.Id} className={`nfd-ep${sel ? ' sel' : ''}`} role="button" tabIndex={0} onClick={() => p.onPlay(e)} onKeyDown={(ev) => ev.key === 'Enter' && p.onPlay(e)}>
                      <div className="nfd-ep-n">{e.IndexNumber ?? i + 1}</div>
                      <div className="nfd-ep-thumb">
                        {thumbUrl(e, 360) ? <img src={thumbUrl(e, 360)} loading="lazy" alt="" /> : null}
                        <span className="nfd-ep-play" aria-hidden="true">▶</span>
                        {pct > 0 && <div className="we-progress"><div className="we-progress-bar" style={{ width: `${pct}%` }} /></div>}
                      </div>
                      <div className="nfd-ep-info">
                        <div className="nfd-ep-top">
                          <span className="nfd-ep-title">{e.Name}{e.UserData?.Played ? ' ✓' : ''}</span>
                          <span className="nfd-ep-rt">{fmtRuntime(e.RunTimeTicks)}</span>
                        </div>
                        {e.Overview && <div className="nfd-ep-ov">{e.Overview}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {p.similar.length > 0 && (
          <section className="nfd-sec">
            <div className="nfd-sec-head"><h2>更多类似内容</h2></div>
            <div className="nfd-sim">
              {p.similar.slice(0, 12).map((s) => <MediaCard key={s.Id} it={s} />)}
            </div>
          </section>
        )}

        <section className="nfd-sec">
          <div className="nfd-sec-head"><h2>关于 {it.Name}</h2></div>
          {actors.length > 0 && (
            <div className="nfd-cast">
              {actors.slice(0, 12).map((x) => (
                <div key={`${x.Id}-${x.Role}`} className="we-cast" title={x.Role ? `${x.Name} 饰 ${x.Role}` : x.Name}>
                  {personUrl(x) ? <img src={personUrl(x)} loading="lazy" alt="" /> : <div className="we-cast-ph">{x.Name.slice(0, 1)}</div>}
                  <div className="we-cast-name">{x.Name}</div>
                  {x.Role && <div className="muted we-cast-role">{x.Role}</div>}
                </div>
              ))}
            </div>
          )}
          {(p.isSeries ? p.target : it) && <PlayOptions itemId={(p.isSeries ? p.target : it)!.Id} onChange={p.onChoice} />}
        </section>
      </div>
    </div>
  );
}
