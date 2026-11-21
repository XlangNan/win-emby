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

function Ev({ e, go }: { e: Entry; go: (to: string) => void }) {
  const kind = e.kind || 'v';
  return (
    <div className={`ed-ev ${kind}`} role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
      <div className="ed-t">{e.when}</div>
      <div className="ed-rail"><i /></div>
      <div className="ed-main">
        {e.imgs && e.imgs.length > 1
          ? <div className="ed-stack">{e.imgs.map((u, i) => <Cv key={i} src={u} title={e.title} />)}</div>
          : <Cv src={e.img} title={e.title} cls={kind === 'v' ? 'w' : ''} />}
        <div className="x"><div className="ed-kind">{KIND[kind]}</div><div className="ed-tt">{e.title}</div><div className="ed-ss">{e.sub}</div></div>
      </div>
      <div className="ed-note">{e.note}</div>
    </div>
  );
}

function Mini({ e, go, p }: { e: Entry; go: (to: string) => void; p?: boolean }) {
  return (
    <div className="ed-mini" role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
      <Cv src={e.img} title={e.title} cls={p ? 'p' : ''} />
      <div className="x"><div className="ed-tt">{e.title}</div><div className="ed-ss">{e.sub}</div></div>
    </div>
  );
}

const IC = {
  v: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></svg>,
  t: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M8 3l4 4 4-4" /></svg>,
  m: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></svg>,
  a: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 6c-2-1.6-5-2-8-1.5v13c3-.5 6-.1 8 1.5 2-1.6 5-2 8-1.5v-13C17 4 14 4.4 12 6zM12 6v13" /></svg>,
};

function Tile({ e, go }: { e: Entry; go: (to: string) => void }) {
  const kind = e.to.startsWith('/audiobooks') ? 'a' : 'v';
  return (
    <div className={`dh-tile ${kind}`} role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
      <Cv src={e.img} title={e.title} />
      <div className="t">{e.title}</div>
      <div className="k">{KIND[kind]}</div>
      <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, e.pct))}%` }} /></div>
      <div className="n">{e.note}</div>
    </div>
  );
}

function Pic({ e, go, kind }: { e: Entry; go: (to: string) => void; kind: 'v' | 'm' | 'a' }) {
  return (
    <div className={`dh-pic ${kind}`} role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
      <Cv src={e.img} title={e.title} />
      <div className="t">{e.title}</div>
      <div className="s">{e.sub}</div>
    </div>
  );
}

function FRow({ e, go }: { e: Entry; go: (to: string) => void }) {
  const kind = e.kind || 'v';
  return (
    <div className={`dh-fr ${kind}`} role="button" tabIndex={0} onClick={() => go(e.to)} onKeyDown={(ev) => ev.key === 'Enter' && go(e.to)}>
      <Cv src={e.img} title={e.title} />
      <div className="x"><div className="t">{e.title}</div><div className="s">{KIND[kind]} · {e.sub}{e.note ? ` · ${e.note}` : ''}</div></div>
      <em>{e.when}</em>
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

  const states = [['Emby', !!getSession(), video.err], ['Navidrome', hasNd, music.err], ['Audiobookshelf', hasAbs, books.err]] as const;
  const bad = states.filter(([, on, err]) => !on || err).map(([n, on]) => `${n}${on ? ' 读取失败' : ' 未连接'}`);
  const status = bad.length ? bad.join('，') : 'Emby、Navidrome、Audiobookshelf 均已连接';

  const peak = Math.max(1, ...week.map((d) => d.v + d.m + d.a));
  const bh = (x: number): number => (x > 0 ? Math.max(3, Math.round((x / peak) * 100)) : 0);
  const resumeAll = [v?.resume[0], ...(b?.resume.slice(0, 2) || []), ...(v?.resume.slice(1, 3) || [])].filter((x): x is Entry => !!x).slice(0, 8);
  const stat = (cls: 'v' | 't' | 'm' | 'a', to: string, k: string, n: string, unit: string, sub: React.ReactNode) => (
    <div className={`dh-stat ${cls}`} role="button" tabIndex={0} onClick={() => go(to)} onKeyDown={(ev) => ev.key === 'Enter' && go(to)}>
      <i className="ic">{IC[cls]}</i>
      <div className="tx"><div className="k">{k}</div><div className="n">{n}<small>{unit}</small></div><div className="s">{sub}</div></div>
    </div>
  );

  return (
    <div className="content ed-page dh-page">
      <header className="dh-mast">
        <div className="dh-date"><b>{now.getMonth() + 1}月{now.getDate()}日</b><span>星期{WEEK[now.getDay()]}</span></div>
        <div className="dh-hi">{hello}，{getSession()?.userName || ''}<small>{status}</small></div>
      </header>

      <section className="dh-stats">
        {stat('v', '/movies', '电影', v ? fmt(v.movies) : '—', '部', v ? (v.newMovies ? <>昨天新增 <b>{v.newMovies}</b> 部</> : '昨天没有新增') : video.err ? '读取失败' : '读取中…')}
        {stat('t', '/movies', '剧集', v ? fmt(v.series) : '—', '部', v ? <>共 {fmt(v.episodes)} 集{v.newEpisodes ? <>，昨天新增 <b>{v.newEpisodes}</b> 集</> : null}</> : video.err ? '读取失败' : '读取中…')}
        {stat('m', '/music', '歌曲', m && m.songs ? fmt(m.songs) : '—', '首', m ? `${fmt(m.albums)} 张专辑，${fmt(m.artists)} 位艺术家` : !hasNd ? '未连接' : music.err ? '读取失败' : '读取中…')}
        {stat('a', '/audiobooks', '有声书', b ? fmt(b.books) : '—', '本', b ? `约 ${fmt(b.hours)} 小时${b.listening ? `，正在听 ${b.listening} 本` : ''}` : !hasAbs ? '未连接' : books.err ? '读取失败' : '读取中…')}
      </section>

      <div className="dh-row">
        <section className="dh-card dh-log">
          <div className="dh-h"><h2>你的足迹</h2><span>{weekTotal > 0 ? `本周共 ${fmtCn(weekTotal)}` : ''}</span></div>
          {groups.map((g) => (
            <div key={g.key} className="dh-day">
              <div className="dh-dl"><b>{g.label}</b><span>周{WEEK[g.date.getDay()]}{g.items.length ? `，共 ${fmtCn(sum(g.items))}` : ''}</span></div>
              {g.items.length ? (
                <div className="dh-list">{g.items.slice(0, 8).map((e) => <FRow key={e.id} e={e} go={go} />)}</div>
              ) : (
                <div className="dh-none"><i /><div><b>暂无记录</b><span>{g.key === todayK ? '今天还没有看过、听过东西' : '昨天没有记录'}</span></div></div>
              )}
            </div>
          ))}
        </section>

        <section className="dh-card dh-next">
          <div className="dh-h"><h2>接着来</h2></div>
          {resumeAll.length ? (
            <div className="dh-tiles">{resumeAll.map((e) => <Tile key={e.id} e={e} go={go} />)}</div>
          ) : <div className="dh-none"><i /><div><b>暂无</b><span>没有看到一半、听到一半的内容</span></div></div>}
        </section>
      </div>

      <div className="dh-low">
      <section className="dh-card dh-weekc">
        <div className="dh-h"><h2>本周</h2><span>{weekTotal > 0 ? `共 ${fmtCn(weekTotal)}` : '这一周还没有看过、听过东西'}</span></div>
        <div className="dh-wk">
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
        <div className="dh-lg"><span className="v">影视</span><span className="m">音乐</span><span className="a">有声书</span></div>
      </section>

      <section className="dh-card dh-new">
        <div className="dh-h"><h2>最近入库</h2></div>
        <div className="dh-cols">
          <div className="dh-col v"><div className="dh-ch"><b>影视</b><span role="button" tabIndex={0} onClick={() => go('/movies')}>查看全部 ›</span></div>{v?.recent.length ? <div className="dh-pics">{v.recent.slice(0, 4).map((e) => <Pic key={e.id} e={e} go={go} kind="v" />)}</div> : <div className="ed-ss">暂无</div>}</div>
          <div className="dh-col m"><div className="dh-ch"><b>音乐</b><span role="button" tabIndex={0} onClick={() => go('/music')}>查看全部 ›</span></div>{m?.recent.length ? <div className="dh-pics">{m.recent.slice(0, 4).map((e) => <Pic key={e.id} e={e} go={go} kind="m" />)}</div> : <div className="ed-ss">{hasNd ? '暂无' : '未连接'}</div>}</div>
          <div className="dh-col a"><div className="dh-ch"><b>有声书</b><span role="button" tabIndex={0} onClick={() => go('/audiobooks')}>查看全部 ›</span></div>{b?.recent.length ? <div className="dh-pics">{b.recent.slice(0, 4).map((e) => <Pic key={e.id} e={e} go={go} kind="a" />)}</div> : <div className="ed-ss">{hasAbs ? '暂无' : '未连接'}</div>}</div>
        </div>
      </section>
      </div>
    </div>
  );
}
