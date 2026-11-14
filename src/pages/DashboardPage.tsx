// 首页（仪表盘）：各个板块的现状——影视 / 音乐 / 有声书的数量、昨天看了什么、今天听了什么、本周活动、继续、最近入库
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession } from '../emby/session';
import { ndConfigured, loadNd } from '../music/navidrome';
import { absConfigured, useAbsKey } from '../abs/abs';
import { musicLocal, loadMusic, loadVideo, loadBooks, lastDays, fmtHM, fmtCn, fmtShort, type BookStats, type Entry, type MusicStats, type VideoStats } from '../dash/stats';

const fmt = (n: number): string => n.toLocaleString('en-US');
const ico = (d: React.ReactNode): React.ReactNode => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

function useLoad<T>(f: () => Promise<T>, on: boolean, key: string): { v: T | null; err: boolean } {
  const [s, setS] = useState<{ v: T | null; err: boolean }>({ v: null, err: false });
  useEffect(() => {
    let dead = false;
    if (!on) { setS({ v: null, err: false }); return; }
    f().then((v) => { if (!dead) setS({ v, err: false }); }).catch(() => { if (!dead) setS({ v: null, err: true }); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key]);
  return s;
}

function Time({ sec }: { sec: number }) {
  const { h, m } = fmtHM(sec);
  return h > 0 ? <>{h}<small style={{ marginLeft: 2, marginRight: 6 }}>时</small>{m}<small>分</small></> : <>{m}<small>分</small></>;
}

function Row({ e, sq, go }: { e: Entry; sq?: boolean; go: (to: string) => void }) {
  return (
    <div className="dsh-row" role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
      <div className={`dsh-th${sq ? ' sq' : ''}`}>
        {e.img ? <img src={e.img} alt="" loading="lazy" draggable={false} onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }} /> : null}
        {e.pct > 0 && e.pct < 100 ? <i style={{ width: `${e.pct}%` }} /> : null}
      </div>
      <div className="dsh-info"><div className="dsh-t">{e.title}</div><div className="dsh-s">{e.sub}</div></div>
      <div className="dsh-when">{e.when ? <b>{e.when}</b> : null}{e.note}</div>
    </div>
  );
}

export default function DashboardPage() {
  const nav = useNavigate();
  const go = (to: string): void => nav(to);
  const absKey = useAbsKey();
  const hasNd = ndConfigured();
  const hasAbs = absConfigured();
  const ndKey = JSON.stringify(loadNd());
  const video = useLoad<VideoStats>(loadVideo, !!getSession(), 'v');
  const music = useLoad<MusicStats>(loadMusic, hasNd, ndKey);
  const books = useLoad<BookStats>(loadBooks, hasAbs, absKey);
  const local = useMemo(musicLocal, []);

  const now = new Date();
  const hr = now.getHours();
  const hello = hr < 5 ? '夜深了' : hr < 12 ? '上午好' : hr < 14 ? '中午好' : hr < 18 ? '下午好' : '晚上好';
  const W = ['日', '一', '二', '三', '四', '五', '六'];
  const v = video.v, m = music.v, b = books.v;

  const todaySec = local.todaySec + (b?.todaySec || 0);
  const week = useMemo(() => {
    return lastDays().map((d) => ({ ...d, v: v?.week[d.key] || 0, m: local.days[d.key] || 0, a: b?.days[d.key] || 0 }));
  }, [v, b, local]);
  const weekTotal = week.reduce((s, d) => s + d.v + d.m + d.a, 0);
  const peak = Math.max(1, ...week.map((d) => d.v + d.m + d.a));
  const H = 120;
  const weekV = week.reduce((s, d) => s + d.v, 0);

  const resume = [...(v?.resume || []).slice(0, 3), ...(b?.resume || []).slice(0, 2)].slice(0, 5);
  const recent = [...(v?.recent || []), ...(m?.recent || []).slice(0, 6), ...(b?.recent || []).slice(0, 6)];
  const missing = (on: boolean, loading: boolean, err: boolean): string => (!on ? '未连接' : err ? '读取失败' : loading ? '读取中…' : '');

  return (
    <div className="content dsh-page">
      <div className="dsh-hello">
        <div>
          <h1>{hello}，{getSession()?.userName || ''}</h1>
          <div className="dsh-date">{now.getMonth() + 1} 月 {now.getDate()} 日 · 星期{W[now.getDay()]}</div>
        </div>
        <div className="dsh-status">
          <i className={video.err ? 'off' : ''}>Emby</i>
          <i className={hasNd && !music.err ? '' : 'off'}>Navidrome</i>
          <i className={hasAbs && !books.err ? '' : 'off'}>Audiobookshelf</i>
        </div>
      </div>

      <div className="dsh-tiles">
        <div className="dsh-tile t-film" role="button" tabIndex={0} onClick={() => go('/movies')}>
          <div className="dsh-tile-ico">{ico(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m10 9 5 3-5 3V9Z" /></>)}</div>
          <div className="dsh-tile-n">{v ? fmt(v.movies) : '—'}<small>部</small></div>
          <div className="dsh-tile-l">电影</div>
          <div className="dsh-tile-s">{v ? (v.newMovies ? <>昨日新增 <b>+{v.newMovies}</b></> : '昨日没有新增') : missing(true, !video.err, video.err)}</div>
        </div>
        <div className="dsh-tile t-tv" role="button" tabIndex={0} onClick={() => go('/movies')}>
          <div className="dsh-tile-ico">{ico(<><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8M12 17v4" /></>)}</div>
          <div className="dsh-tile-n">{v ? fmt(v.series) : '—'}<small>部</small></div>
          <div className="dsh-tile-l">剧集</div>
          <div className="dsh-tile-s">{v ? <>共 {fmt(v.episodes)} 集{v.newEpisodes ? <> · 昨日新增 <b>+{v.newEpisodes}</b> 集</> : null}</> : missing(true, !video.err, video.err)}</div>
        </div>
        <div className="dsh-tile t-song" role="button" tabIndex={0} onClick={() => go('/music')}>
          <div className="dsh-tile-ico">{ico(<><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>)}</div>
          <div className="dsh-tile-n">{m ? (m.songs ? fmt(m.songs) : '—') : '—'}<small>首</small></div>
          <div className="dsh-tile-l">歌曲</div>
          <div className="dsh-tile-s">{m ? `${fmt(m.albums)} 张专辑 · ${fmt(m.artists)} 位艺术家` : missing(hasNd, !music.err, music.err)}</div>
        </div>
        <div className="dsh-tile t-book" role="button" tabIndex={0} onClick={() => go('/audiobooks')}>
          <div className="dsh-tile-ico">{ico(<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z" /><path d="M8 7h7" /></>)}</div>
          <div className="dsh-tile-n">{b ? fmt(b.books) : '—'}<small>本</small></div>
          <div className="dsh-tile-l">有声书</div>
          <div className="dsh-tile-s">{b ? `约 ${fmt(b.hours)} 小时${b.listening ? ` · 在听 ${b.listening} 本` : ''}` : missing(hasAbs, !books.err, books.err)}</div>
        </div>
        <div className="dsh-tile t-watch" role="button" tabIndex={0} onClick={() => go('/history')}>
          <div className="dsh-tile-ico">{ico(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)}</div>
          <div className="dsh-tile-n">{v ? <Time sec={v.yesterdaySec} /> : '—'}</div>
          <div className="dsh-tile-l">昨日观看</div>
          <div className="dsh-tile-s">{v ? `${v.yesterday.length} 部 · 本周累计 ${fmtCn(weekV)}` : ''}</div>
        </div>
        <div className="dsh-tile t-listen">
          <div className="dsh-tile-ico">{ico(<><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /></>)}</div>
          <div className="dsh-tile-n"><Time sec={todaySec} /></div>
          <div className="dsh-tile-l">今日收听</div>
          <div className="dsh-tile-s">歌曲 {Math.round(local.todaySec / 60)} 分 · 有声书 {Math.round((b?.todaySec || 0) / 60)} 分</div>
        </div>
      </div>

      <div className="dsh-grid">
        <div className="dsh-card">
          <h3>昨天看了什么<span>{v ? (v.yesterday.length ? `${v.yesterday.length} 部 · ${fmtCn(v.yesterdaySec)}` : '') : ''}</span></h3>
          {v && v.yesterday.length ? v.yesterday.slice(0, 6).map((e) => <Row key={e.id} e={e} go={go} />) : <div className="dsh-empty">{v ? '昨天没有观看记录' : missing(true, !video.err, video.err)}</div>}
        </div>
        <div className="dsh-card">
          <h3>今天听了什么<span>歌曲 {Math.round(local.todaySec / 60)} 分 · 有声书 {Math.round((b?.todaySec || 0) / 60)} 分</span></h3>
          {local.today.length ? local.today.slice(0, 5).map((e) => <Row key={e.id} e={e} sq go={go} />) : null}
          {b && b.today.length ? (<><div className="dsh-sub-h">有声书</div>{b.today.slice(0, 3).map((e) => <Row key={e.id} e={e} sq go={go} />)}</>) : null}
          {!local.today.length && !(b && b.today.length) ? <div className="dsh-empty">今天还没听过东西</div> : null}
        </div>
      </div>

      <div className="dsh-grid w">
        <div className="dsh-card">
          <h3>本周活动<span>{weekTotal > 0 ? `共 ${fmtCn(weekTotal)}` : ''}</span></h3>
          <div className="dsh-chart">
            {week.map((d) => {
              const tot = d.v + d.m + d.a;
              const hv = (x: number): number => (x > 0 ? Math.max(3, Math.round((x / peak) * H)) : 0);
              return (
                <div key={d.key} className={`dsh-col${d.today ? ' today' : ''}`} title={`影视 ${fmtShort(d.v)} · 音乐 ${fmtShort(d.m)} · 有声书 ${fmtShort(d.a)}`}>
                  <span className="dsh-min">{tot > 0 ? fmtShort(tot) : ''}</span>
                  <div className="dsh-bars">
                    {d.v > 0 ? <b className="v" style={{ height: hv(d.v) }} /> : null}
                    {d.m > 0 ? <b className="m" style={{ height: hv(d.m) }} /> : null}
                    {d.a > 0 ? <b className="a" style={{ height: hv(d.a) }} /> : null}
                  </div>
                  <em>{d.label}</em>
                </div>
              );
            })}
          </div>
          <div className="dsh-legend"><span className="v">影视</span><span className="m">音乐</span><span className="a">有声书</span></div>
          <div className="dsh-note">影视按每部最后一次观看估算；音乐为本机记录（从装上这版开始累计）；有声书来自服务器。</div>
        </div>
        <div className="dsh-card">
          <h3>继续<span>从上次的位置接着来</span></h3>
          {resume.length ? resume.map((e) => <Row key={e.id} e={e} go={go} />) : <div className="dsh-empty">没有看到一半、听到一半的内容</div>}
        </div>
      </div>

      <div className="dsh-card" style={{ marginTop: 16 }}>
        <h3>最近入库<span>影视 · 音乐 · 有声书</span></h3>
        {recent.length ? (
          <div className="dsh-shelf">
            {recent.map((e) => (
              <div key={e.note + e.id} className="dsh-poster" role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
                <div className={`dsh-poster-i${e.note === '专辑' || e.note === '有声书' ? ' sq' : ''}`}>
                  {e.img ? <img src={e.img} alt="" loading="lazy" draggable={false} onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }} /> : null}
                  <span className="dsh-badge">{e.note}</span>
                </div>
                <div className="dsh-poster-t">{e.title}</div>
                <div className="dsh-poster-s">{e.sub}</div>
              </div>
            ))}
          </div>
        ) : <div className="dsh-empty">暂无</div>}
      </div>
    </div>
  );
}
