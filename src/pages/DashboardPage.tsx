// 首页（仪表盘，电脑版）：日期 + 四个数量 + 足迹（影视 / 音乐 / 有声书按时间排在一起）+ 接着来 + 本周 + 最近入库
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession } from '../emby/session';
import { ndConfigured, loadNd } from '../music/navidrome';
import { absConfigured, useAbsKey } from '../abs/abs';
import { musicLocal, loadMusic, loadVideo, loadBooks, lastDays, dayKey, fmtCn, type BookStats, type Entry, type MusicStats, type VideoStats } from '../dash/stats';

const fmt = (n: number): string => n.toLocaleString('en-US');
const KIND = { v: '影视', m: '音乐', a: '有声书' } as const;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

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

const hue = (s: string): number => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
/** 封面：有图用图，没图（或加载失败）用书名 + 渐变色底 */
function Cv({ src, title, cls }: { src?: string; title: string; cls?: string }) {
  const [bad, setBad] = useState(!src);
  const h = hue(title);
  return (
    <div className={`ed-cv${cls ? ` ${cls}` : ''}`} style={{ background: `linear-gradient(145deg,hsl(${h},52%,38%),hsl(${(h + 40) % 360},55%,13%))` }}>
      {bad ? <span>{title.slice(0, 6)}</span> : <img src={src} alt="" loading="lazy" draggable={false} onError={() => setBad(true)} />}
    </div>
  );
}

const PLAY = <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 3.2v9.6l7.4-4.8-7.4-4.8Z" fill="currentColor" /></svg>;

/** 足迹里的一条：时间 · 轨道圆点 · 封面 · 标题 · 备注 */
function Ev({ e, go }: { e: Entry; go: (to: string) => void }) {
  const kind = e.kind || 'v';
  return (
    <div className={`dx-ev ${kind}`} role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
      <time>{e.when}</time>
      <i className="dx-pin" aria-hidden="true" />
      <Cv src={e.img} title={e.title} cls={kind === 'v' ? 'w' : ''} />
      <div className="x"><div className="t">{e.title}</div><div className="s"><b>{KIND[kind]}</b>{e.sub}</div></div>
      <em>{e.note}</em>
    </div>
  );
}

/** 「接着来」：横版封面 + 底部进度 + 悬停播放钮 */
function RCard({ e, go }: { e: Entry; go: (to: string) => void }) {
  const kind = e.to.startsWith('/audiobooks') ? 'a' : 'v';
  return (
    <div className={`dx-rc ${kind}`} role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
      <div className="dx-rc-pic">
        <Cv src={e.img} title={e.title} cls="w" />
        <span className="dx-rc-kind">{KIND[kind]}</span>
        <span className="dx-rc-play">{PLAY}</span>
        <div className="dx-rc-bar"><i style={{ width: `${Math.max(0, Math.min(100, e.pct))}%` }} /></div>
      </div>
      <div className="dx-rc-t">{e.title}</div>
      <div className="dx-rc-n">{e.note}</div>
    </div>
  );
}

function Cover({ e, go, kind }: { e: Entry; go: (to: string) => void; kind: 'v' | 'm' | 'a' }) {
  return (
    <div className={`dx-cover ${kind}`} role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
      <Cv src={e.img} title={e.title} cls={kind === 'v' ? 'p' : ''} />
      <div className="t">{e.title}</div>
      <div className="s">{e.sub}</div>
    </div>
  );
}

const IC = {
  v: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></svg>,
  t: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M8 3l4 4 4-4" /></svg>,
  m: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></svg>,
  a: <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6c-2-1.6-5-2-8-1.5v13c3-.5 6-.1 8 1.5 2-1.6 5-2 8-1.5v-13C17 4 14 4.4 12 6zM12 6v13" /></svg>,
};

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
  const v = video.v, m = music.v, b = books.v;
  const todayK = dayKey(now);
  const yd = new Date(now); yd.setDate(yd.getDate() - 1);
  const yestK = dayKey(yd);

  // 足迹：影视 + 音乐 + 有声书，按时间从新到旧
  const feed = useMemo(() => [...(v?.plays || []), ...local.plays, ...(b?.plays || [])].sort((a, c) => (c.at || 0) - (a.at || 0)), [v, b, local]);
  const groups = [
    { key: todayK, label: '今天', date: now, items: feed.filter((e) => dayKey(new Date(e.at || 0)) === todayK) },
    { key: yestK, label: '昨天', date: yd, items: feed.filter((e) => dayKey(new Date(e.at || 0)) === yestK) },
  ];
  const sum = (items: Entry[], k?: 'v' | 'm' | 'a'): number => items.filter((e) => !k || e.kind === k).reduce((s, e) => s + (e.sec || 0), 0);

  const week = useMemo(() => lastDays().map((d) => ({ ...d, v: v?.week[d.key] || 0, m: local.days[d.key] || 0, a: b?.days[d.key] || 0 })), [v, b, local]);
  const weekTotal = week.reduce((s, d) => s + d.v + d.m + d.a, 0);
  const weekBy = { v: week.reduce((s, d) => s + d.v, 0), m: week.reduce((s, d) => s + d.m, 0), a: week.reduce((s, d) => s + d.a, 0) };

  const states = [['Emby', !!getSession(), video.err], ['Navidrome', hasNd, music.err], ['Audiobookshelf', hasAbs, books.err]] as const;

  const peak = Math.max(1, ...week.map((d) => d.v + d.m + d.a));
  const bh = (x: number): number => (x > 0 ? Math.max(3, Math.round((x / peak) * 100)) : 0);
  const resumeAll = [v?.resume[0], ...(b?.resume.slice(0, 2) || []), ...(v?.resume.slice(1, 4) || [])].filter((x): x is Entry => !!x).slice(0, 8);
  const stat = (cls: 'v' | 't' | 'm' | 'a', to: string, k: string, n: string, unit: string, sub: React.ReactNode) => (
    <div className={`dx-stat ${cls}`} role="button" tabIndex={0} onClick={() => go(to)} onKeyDown={(ev) => ev.key === 'Enter' && go(to)}>
      <div className="dx-sk"><i className="ic">{IC[cls]}</i><span>{k}</span></div>
      <div className="dx-sn">{n}<small>{unit}</small></div>
      <div className="dx-ss">{sub}</div>
    </div>
  );
  const shelf = (kind: 'v' | 'm' | 'a', label: string, items: Entry[] | undefined, to: string, emptyText: string) => (
    <div className={`dx-shelf ${kind}`}>
      <div className="dx-sh sm"><h3><i aria-hidden="true" />{label}</h3><span role="button" tabIndex={0} onClick={() => go(to)} onKeyDown={(ev) => ev.key === 'Enter' && go(to)}>查看全部 ›</span></div>
      {items?.length ? <div className="dx-covers">{items.slice(0, 10).map((e) => <Cover key={e.id} e={e} go={go} kind={kind} />)}</div> : <div className="dx-empty">{emptyText}</div>}
    </div>
  );

  return (
    <div className="content ed-page dx-page">
      <header className="dx-mast">
        <div className="dx-when"><span>星期{WEEK[now.getDay()]}</span><h1>{now.getMonth() + 1}月{now.getDate()}日</h1></div>
        <div className="dx-who">
          <div className="dx-hi">{hello}，{getSession()?.userName || ''}</div>
          <div className="dx-svc">
            {states.map(([n, on, err]) => (
              <span key={n} className={!on ? 'off' : err ? 'bad' : 'ok'} title={!on ? '未连接' : err ? '读取失败' : '已连接'}><i />{n}</span>
            ))}
          </div>
        </div>
      </header>

      <section className="dx-stats">
        {stat('v', '/movies', '电影', v ? fmt(v.movies) : '—', '部', v ? (v.newMovies ? <>昨天新增 <b>{v.newMovies}</b> 部</> : '昨天没有新增') : video.err ? '读取失败' : '读取中…')}
        {stat('t', '/movies', '剧集', v ? fmt(v.series) : '—', '部', v ? <>共 {fmt(v.episodes)} 集{v.newEpisodes ? <>，昨天新增 <b>{v.newEpisodes}</b> 集</> : null}</> : video.err ? '读取失败' : '读取中…')}
        {stat('m', '/music', '歌曲', m && m.songs ? fmt(m.songs) : '—', '首', m ? `${fmt(m.albums)} 张专辑，${fmt(m.artists)} 位艺术家` : !hasNd ? '未连接' : music.err ? '读取失败' : '读取中…')}
        {stat('a', '/audiobooks', '有声书', b ? fmt(b.books) : '—', '本', b ? `约 ${fmt(b.hours)} 小时${b.listening ? `，正在听 ${b.listening} 本` : ''}` : !hasAbs ? '未连接' : books.err ? '读取失败' : '读取中…')}
      </section>

      {resumeAll.length > 0 && (
        <section className="dx-sec dx-next">
          <div className="dx-sh"><h2>接着来</h2><span>{resumeAll.length} 项没看完 / 没听完</span></div>
          <div className="dx-rail">{resumeAll.map((e) => <RCard key={e.id} e={e} go={go} />)}</div>
        </section>
      )}

      <div className="dx-grid">
        <section className="dx-card dx-log">
          <div className="dx-sh"><h2>你的足迹</h2><span>{weekTotal > 0 ? `本周共 ${fmtCn(weekTotal)}` : ''}</span></div>
          {groups.map((g) => (
            <div key={g.key} className="dx-day">
              <div className="dx-dl"><b>{g.label}</b><span>周{WEEK[g.date.getDay()]}{g.items.length ? ` · 共 ${fmtCn(sum(g.items))}` : ''}</span></div>
              {g.items.length ? (
                <div className="dx-evs">{g.items.slice(0, 6).map((e) => <Ev key={e.id} e={e} go={go} />)}</div>
              ) : (
                <div className="dx-empty">{g.key === todayK ? '今天还没有看过、听过东西' : '昨天没有记录'}</div>
              )}
            </div>
          ))}
        </section>

        <section className="dx-card dx-week">
          <div className="dx-sh"><h2>本周</h2><span>{weekTotal > 0 ? `共 ${fmtCn(weekTotal)}` : '这一周还没有看过、听过东西'}</span></div>
          <div className="dx-wk">
            {week.map((d) => {
              const tot = d.v + d.m + d.a;
              return (
                <div key={d.key} className={d.today ? 'today' : ''} title={`影视 ${fmtCn(d.v)}，音乐 ${fmtCn(d.m)}，有声书 ${fmtCn(d.a)}`}>
                  <u>{tot > 0 ? `${(tot / 3600).toFixed(1)}h` : ''}</u>
                  <div className="col">
                    {d.a > 0 ? <b className="a" style={{ height: `${bh(d.a)}%` }} /> : null}
                    {d.v > 0 ? <b className="v" style={{ height: `${bh(d.v)}%` }} /> : null}
                    {d.m > 0 ? <b className="m" style={{ height: `${bh(d.m)}%` }} /> : null}
                  </div>
                  <em>{d.label}</em>
                </div>
              );
            })}
          </div>
          <div className="dx-lg">
            <span className="v"><i />影视<b>{weekBy.v ? fmtCn(weekBy.v) : '—'}</b></span>
            <span className="m"><i />音乐<b>{weekBy.m ? fmtCn(weekBy.m) : '—'}</b></span>
            <span className="a"><i />有声书<b>{weekBy.a ? fmtCn(weekBy.a) : '—'}</b></span>
          </div>
        </section>
      </div>

      <section className="dx-sec dx-new">
        <div className="dx-sh"><h2>最近入库</h2></div>
        {shelf('v', '影视', v?.recent, '/movies', '暂无')}
        {shelf('m', '音乐', m?.recent, '/music', hasNd ? '暂无' : '未连接')}
        {shelf('a', '有声书', b?.recent, '/audiobooks', hasAbs ? '暂无' : '未连接')}
      </section>
    </div>
  );
}
