// 有声书（Audiobookshelf）：连接 → 书库首页（继续收听 / 最近添加 / 全部）→ 详情（章节 / 播放）
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  absBooks, absCheckToken, absCover, absDetail, absLibraries, absLibStats, absLogin, absProgressMap, absSearch, absShelves, clearAbs,
  fmtDur, fmtLong, saveAbs, useAbsKey, absConfigured, loadAbs,
  type AbsBook, type AbsDetail, type AbsLibrary, type AbsProgress, type AbsShelf, type AbsSort,
} from './abs';
import { absPlay, absSeek, absSetRate, absSkip, absToggle, currentChapter, setSleep, useAbsPlayer } from './absPlayer';

// ───────── 连接 ─────────
function Connect() {
  const [server, setServer] = useState(loadAbs().server || '');
  const [user, setUser] = useState(loadAbs().user || '');
  const [pass, setPass] = useState('');
  const [token, setToken] = useState('');
  const [useTok, setUseTok] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (): Promise<void> => {
    setErr('');
    if (!server.trim()) { setErr('请填写服务器地址'); return; }
    setBusy(true);
    try {
      const c = useTok ? await absCheckToken(server, token) : await absLogin(server, user.trim(), pass);
      saveAbs(c);
    } catch (e) {
      setErr((e as Error).message || String(e));
    } finally { setBusy(false); }
  };
  return (
    <div className="content abs-page ed-page">
      <div className="ab-top"><div><h1>有声书</h1><p>连接你的 Audiobookshelf 服务器</p></div></div>
      <div className="abs-conn">
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>连接 Audiobookshelf</div>
        <div className="muted" style={{ marginBottom: 14, fontSize: 13 }}>填写你的 Audiobookshelf 服务器地址（不写端口默认 13378）。</div>
        <label className="abs-lab">服务器地址</label>
        <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="例：192.168.1.10:13378" autoCapitalize="off" spellCheck={false} />
        {useTok ? (
          <>
            <label className="abs-lab">API Token</label>
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="在 Audiobookshelf 的 设置 → 用户 里生成" autoCapitalize="off" spellCheck={false} />
          </>
        ) : (
          <>
            <label className="abs-lab">用户名</label>
            <input value={user} onChange={(e) => setUser(e.target.value)} autoCapitalize="off" spellCheck={false} />
            <label className="abs-lab">密码</label>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void go()} />
          </>
        )}
        {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
          <button type="button" className="primary" disabled={busy} onClick={() => void go()}>{busy ? '连接中…' : '连接'}</button>
          <button type="button" className="abs-link" onClick={() => { setUseTok(!useTok); setErr(''); }}>{useTok ? '改用用户名密码' : '改用 API Token'}</button>
        </div>
      </div>
    </div>
  );
}

// ───────── 封面卡片 ─────────
function BookCard({ b, prog }: { b: AbsBook; prog?: AbsProgress }) {
  const nav = useNavigate();
  const [bad, setBad] = useState(false);
  const pct = prog ? Math.round(prog.progress * 100) : 0;
  return (
    <div className="abs-card" role="button" tabIndex={0} onClick={() => nav(`/audiobooks/${b.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/audiobooks/${b.id}`)}>
      <div className="abs-cover">
        {!bad ? <img src={absCover(b.id, 360)} alt="" loading="lazy" draggable={false} onError={() => setBad(true)} /> : <span className="abs-cover-t">{b.title.slice(0, 8)}</span>}
      </div>
      <div className="abs-card-t" title={b.title}>{b.title}</div>
      <div className="abs-card-s">{b.author || b.series || ' '}</div>
      {!prog?.isFinished && pct > 0 && <div className="ab-pg"><i style={{ width: `${pct}%` }} /></div>}
      {prog?.isFinished && <div className="abs-done">已听完</div>}
    </div>
  );
}

/** 继续收听：一行一本，带进度和播放键 */
function ResumeRow({ b, prog }: { b: AbsBook; prog?: AbsProgress }) {
  const nav = useNavigate();
  const [bad, setBad] = useState(false);
  const pct = prog ? Math.round(prog.progress * 100) : 0;
  const left = prog && prog.duration > 0 ? Math.max(0, prog.duration - prog.currentTime) : 0;
  return (
    <div className="ab-r" role="button" tabIndex={0} onClick={() => nav(`/audiobooks/${b.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/audiobooks/${b.id}`)}>
      <div className="ed-cv">{!bad ? <img src={absCover(b.id, 240)} alt="" loading="lazy" draggable={false} onError={() => setBad(true)} /> : <span>{b.title.slice(0, 6)}</span>}</div>
      <div className="x">
        <div className="ed-tt">{b.title}</div>
        <div className="ed-ss">{b.author || b.series || ' '}</div>
        <div className="ab-pg"><i style={{ width: `${pct}%` }} /></div>
        <div className="ab-pt">{pct}%{left > 0 ? `，剩 ${fmtLong(left)}` : ''}</div>
      </div>
      <button type="button" className="ab-go" title="继续收听" onClick={(e) => { e.stopPropagation(); void absPlay(b.id); }}>▶</button>
    </div>
  );
}

const SORTS: [AbsSort, boolean, string][] = [
  ['addedAt', true, '最近添加'], ['media.metadata.title', false, '书名'], ['media.metadata.authorName', false, '作者'], ['media.duration', true, '时长'],
];

// ───────── 书库首页 ─────────
export default function AbsPage() {
  const k = useAbsKey();
  const ok = useMemo(() => absConfigured(), [k]);
  if (!ok) return <Connect />;
  return <Library key={k} />;
}

function Library() {
  const [libs, setLibs] = useState<AbsLibrary[] | null>(null);
  const [lib, setLib] = useState('');
  const [err, setErr] = useState('');
  const [shelves, setShelves] = useState<AbsShelf[]>([]);
  const [prog, setProg] = useState<Map<string, AbsProgress>>(new Map());
  const [books, setBooks] = useState<AbsBook[]>([]);
  const [total, setTotal] = useState(0);
  const [hours, setHours] = useState(0);
  const [page, setPage] = useState(0);
  const [sortI, setSortI] = useState(0);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<AbsBook[] | null>(null);
  const [busy, setBusy] = useState(false);
  const gen = useRef(0);

  useEffect(() => {
    absLibraries().then((l) => {
      setLibs(l);
      const saved = localStorage.getItem('wemby-abs-lib');
      setLib(l.find((x) => x.id === saved)?.id || l[0]?.id || '');
      if (!l.length) setErr('这个账号下没有「书籍」类型的库（播客暂不支持）');
    }).catch((e: Error) => setErr(e.message));
    absProgressMap(true).then(setProg).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!lib) return;
    try { localStorage.setItem('wemby-abs-lib', lib); } catch { /* ignore */ }
    absShelves(lib).then(setShelves).catch(() => setShelves([]));
    absLibStats(lib).then((s) => setHours(Math.round(s.duration / 3600))).catch(() => setHours(0));
  }, [lib]);

  useEffect(() => {
    if (!lib) return;
    const g = ++gen.current;
    setBooks([]); setPage(0); setBusy(true);
    const [s, d] = SORTS[sortI];
    absBooks(lib, 0, s, d).then((r) => { if (g === gen.current) { setBooks(r.books); setTotal(r.total); } })
      .catch((e: Error) => g === gen.current && setErr(e.message)).finally(() => g === gen.current && setBusy(false));
  }, [lib, sortI]);

  const more = (): void => {
    if (busy) return;
    const g = gen.current;
    const [s, d] = SORTS[sortI];
    setBusy(true);
    absBooks(lib, page + 1, s, d).then((r) => { if (g === gen.current) { setBooks((b) => [...b, ...r.books]); setPage(page + 1); } })
      .catch((e: Error) => setErr(e.message)).finally(() => setBusy(false));
  };

  useEffect(() => {
    if (!q.trim() || !lib) { setFound(null); return; }
    const t = setTimeout(() => { absSearch(lib, q.trim()).then(setFound).catch(() => setFound([])); }, 350);
    return () => clearTimeout(t);
  }, [q, lib]);

  const listening = [...prog.values()].filter((p) => !p.isFinished && p.progress > 0).length;
  const resume = shelves.filter((s) => s.id === 'continue-listening');
  const others = shelves.filter((s) => s.id !== 'continue-listening');

  return (
    <div className="content abs-page ed-page">
      <div className="ab-top">
        <div>
          <h1>有声书</h1>
          <p>{total ? `${total} 本` : ' '}{hours ? `，约 ${hours.toLocaleString('en-US')} 小时` : ''}{listening ? `，正在听 ${listening} 本` : ''}</p>
        </div>
        <div className="ab-tools">
          <input className="abs-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索书名 / 作者" />
          <button type="button" className="abs-link" title={`已连接：${loadAbs().server}`} onClick={() => { if (confirm('断开与 Audiobookshelf 的连接？（已听进度保存在服务器上，不会丢）')) clearAbs(); }}>断开连接</button>
        </div>
      </div>
      <div className="ab-bar">
        <div className="ab-tabs">{(libs || []).map((l) => <span key={l.id} className={l.id === lib ? 'on' : ''} role="button" tabIndex={0} onClick={() => { setLib(l.id); setQ(''); }} onKeyDown={(e) => e.key === 'Enter' && (setLib(l.id), setQ(''))}>{l.name}</span>)}</div>
        <div className="ab-sort">排序：{SORTS.map((x, i) => <button key={x[2]} type="button" className={i === sortI ? 'on' : ''} onClick={() => setSortI(i)}>{x[2]}</button>)}</div>
      </div>
      {err && <div className="err" style={{ marginTop: 16 }}>{err}</div>}
      {found ? (
        <section className="abs-sec">
          {found.length ? <div className="abs-grid">{found.map((b) => <BookCard key={b.id} b={b} prog={prog.get(b.id)} />)}</div> : <div className="ed-ss">没有匹配「{q}」的书</div>}
        </section>
      ) : (
        <>
          {resume.map((s) => (
            <section key={s.id} className="abs-sec">
              <h3>继续收听<span>从上次的位置接着来</span></h3>
              <div className="ab-resume">{s.books.slice(0, 3).map((b) => <ResumeRow key={b.id} b={b} prog={prog.get(b.id)} />)}</div>
            </section>
          ))}
          {others.map((s) => (
            <section key={s.id} className="abs-sec">
              <h3>{s.label}</h3>
              <div className="abs-hrow">{s.books.map((b) => <BookCard key={b.id} b={b} prog={prog.get(b.id)} />)}</div>
            </section>
          ))}
          <section className="abs-sec">
            <h3>全部有声书<span>{total ? `${total} 本` : ''}</span></h3>
            {!books.length && busy && <div className="ed-ss"><span className="spinner" aria-hidden="true" />加载中…</div>}
            <div className="abs-grid">{books.map((b) => <BookCard key={b.id} b={b} prog={prog.get(b.id)} />)}</div>
            {books.length < total && <div style={{ textAlign: 'center', margin: '28px 0' }}><button type="button" onClick={more} disabled={busy}>{busy ? '加载中…' : `加载更多（${books.length}/${total}）`}</button></div>}
          </section>
        </>
      )}
    </div>
  );
}

// ───────── 详情（手机上同时是播放页） ─────────
const RATES = [1, 1.25, 1.5, 1.75, 2, 0.75];
export function AbsDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const p = useAbsPlayer();
  const [d, setD] = useState<AbsDetail | null>(null);
  const [err, setErr] = useState('');
  const [prog, setProg] = useState<AbsProgress | undefined>();
  const [bad, setBad] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);

  useEffect(() => {
    setD(null); setErr(''); setBad(false);
    absDetail(id).then(setD).catch((e: Error) => setErr(e.message));
    absProgressMap().then((m) => setProg(m.get(id))).catch(() => undefined);
  }, [id]);

  const mine = p.id === id;
  const finished = !!prog?.isFinished && !mine;
  const pos = mine ? p.pos : prog?.currentTime || 0;
  const dur = d?.duration || prog?.duration || 0;
  const pct = finished ? 100 : dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  const chap = d ? currentChapter(d.chapters, pos) : null;
  const playChapter = (start: number): void => { if (mine) absSeek(start); else void absPlay(id, start); };
  const doneN = d ? d.chapters.filter((c) => finished || (pos > 0 && pos >= c.end - 1)).length : 0;
  const shown = drag ?? pos;
  const nextRate = RATES[(RATES.indexOf(p.rate) + 1) % RATES.length] ?? 1;
  const sleepMin = p.sleepLeft > 0 ? Math.ceil(p.sleepLeft / 60) : 0;
  const sleepNext = sleepMin === 0 ? 15 : sleepMin > 30 ? 0 : sleepMin > 15 ? 60 : 30;
  const commit = (): void => { if (drag != null) { absSeek(drag); setDrag(null); } };

  return (
    <div className="content abs-page ed-page">
      <button type="button" className="abs-link ab-back" onClick={() => nav('/audiobooks')}>← 返回有声书</button>
      {err && <div className="err">{err}</div>}
      {!d && !err && <div className="ed-ss" style={{ marginTop: 20 }}><span className="spinner" aria-hidden="true" />加载中…</div>}
      {d && (
        <>
          <div className={`ad${mine ? ' mine' : ''}`}>
            <div className="ad-cv">{!bad ? <img src={absCover(id, 600)} alt="" draggable={false} onError={() => setBad(true)} /> : <span className="abs-cover-t">{d.title}</span>}</div>
            <div className="ad-main">
              <h1>{d.title}</h1>
              {d.subtitle && <div className="ad-sub">{d.subtitle}</div>}
              <div className="by">{d.author}{d.narrator && <span>朗读　{d.narrator}</span>}{d.series && <span>{d.series}</span>}{d.year && <span>{d.year} 年</span>}</div>
              <div className="facts">
                {d.duration > 0 && <div><b>{fmtLong(d.duration)}</b><span>总时长</span></div>}
                {d.chapters.length > 0 && <div><b>{d.chapters.length}</b><span>章节</span></div>}
                {(pos > 5 || finished) && <div><b>{finished ? '已听完' : `${Math.round(pct)}%`}</b><span>{finished ? '这本听完了' : `已听，还剩 ${fmtLong(Math.max(0, dur - pos))}`}</span></div>}
              </div>
              {d.genres.length > 0 && <div className="tags">{d.genres.join('，')}</div>}
              {d.description && <p className="desc">{d.description}</p>}
              <div className="acts">
                <button type="button" className="primary" onClick={() => void absPlay(id)}>
                  {mine ? (p.playing ? '❚❚ 暂停' : '▶ 继续播放') : pos > 5 && !finished ? `▶ 继续收听${chap ? ` ${chap.title}` : ''}` : '▶ 开始收听'}
                </button>
                {(pos > 5 || finished) && <button type="button" onClick={() => void absPlay(id, 0)}>从头开始</button>}
              </div>
              {p.err && mine && <div className="err" style={{ marginTop: 10 }}>{p.err}</div>}
              {(pos > 5 || finished) && (
                <div className="ov">
                  <div className="ab-pg"><i style={{ width: `${pct}%` }} /></div>
                  <div className="tm"><span>{fmtDur(finished ? dur : pos)}</span><span>{fmtDur(dur)}</span></div>
                </div>
              )}
            </div>
            {/* 手机上的播放控制：进度条、跳转、播放、倍速、定时 */}
            <div className={`ad-ctl${mine ? ' on' : ''}`}>
              {chap && <div className="ed-kind a" style={{ textAlign: 'center', marginBottom: 10 }}>{chap.title}</div>}
              <div className="ad-sk">
                <input type="range" min={0} max={Math.max(1, p.duration)} step={1} value={Math.min(shown, Math.max(1, p.duration))} onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} aria-label="播放进度" />
                <div><span>{fmtDur(shown)}</span><span>剩 {fmtDur(Math.max(0, p.duration - shown))}</span></div>
              </div>
              <div className="ad-pl">
                <button type="button" onClick={() => absSkip(-15)}>15 秒</button>
                <button type="button" className="pp" onClick={absToggle}>{p.loading && !p.playing ? '…' : p.playing ? '❚❚' : '▶'}</button>
                <button type="button" onClick={() => absSkip(30)}>30 秒</button>
              </div>
              <div className="ad-op">
                <button type="button" onClick={() => absSetRate(nextRate)}>{p.rate} 倍速</button>
                <button type="button" className={sleepMin ? 'on' : ''} onClick={() => setSleep(sleepNext)}>{sleepMin ? `定时 ${sleepMin} 分` : '定时关闭'}</button>
              </div>
            </div>
          </div>
          {d.chapters.length > 0 && (
            <section className="toc">
              <h2>目录<span>共 {d.chapters.length} 章{doneN ? `，已听 ${doneN} 章` : ''}</span></h2>
              <ol>
                {d.chapters.map((c, i) => {
                  const now = !finished && chap?.id === c.id;
                  const done = !now && (finished || (pos > 0 && pos >= c.end - 1));
                  return (
                    <li key={c.id} className={now ? 'now' : done ? 'done' : ''} role="button" tabIndex={0} onClick={() => playChapter(c.start)} onKeyDown={(e) => e.key === 'Enter' && playChapter(c.start)}>
                      <span className="no">{i + 1}</span><span className="nm">{c.title}</span><span className="ld" /><span className="du">{fmtDur(c.end - c.start)}</span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </>
      )}
    </div>
  );
}
