// 有声书（Audiobookshelf）：连接 → 书库首页（继续收听 / 最近添加 / 全部）→ 详情（章节 / 播放）
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  absBooks, absCheckToken, absCover, absDetail, absLibraries, absLogin, absProgressMap, absSearch, absShelves, clearAbs,
  fmtDur, fmtLong, saveAbs, useAbsKey, absConfigured, loadAbs,
  type AbsBook, type AbsDetail, type AbsLibrary, type AbsProgress, type AbsShelf, type AbsSort,
} from './abs';
import { absPlay, absSeek, currentChapter, useAbsPlayer } from './absPlayer';

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
    <div className="content abs-page">
      <div className="abs-title">有声书</div>
      <div className="card abs-conn">
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
        {!bad ? <img src={absCover(b.id, 360)} alt="" loading="lazy" draggable={false} onError={() => setBad(true)} /> : <span className="abs-cover-t">{b.title.slice(0, 6)}</span>}
        {prog?.isFinished && <i className="abs-done" title="已听完">✓</i>}
        {!prog?.isFinished && pct > 0 && <i className="abs-bar"><b style={{ width: `${pct}%` }} /></i>}
      </div>
      <div className="abs-card-t" title={b.title}>{b.title}</div>
      <div className="abs-card-s">{b.author || b.series || ' '}</div>
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

  return (
    <div className="content abs-page">
      <div className="abs-head">
        <div className="abs-title">有声书</div>
        {libs && libs.length > 1 && (
          <div className="abs-pills">{libs.map((l) => <button key={l.id} type="button" className={l.id === lib ? 'on' : ''} onClick={() => { setLib(l.id); setQ(''); }}>{l.name}</button>)}</div>
        )}
        <span style={{ flex: 1 }} />
        <input className="abs-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索书名 / 作者" />
        <button type="button" className="abs-link" title={`已连接：${loadAbs().server}`} onClick={() => { if (confirm('断开与 Audiobookshelf 的连接？（已听进度保存在服务器上，不会丢）')) clearAbs(); }}>断开连接</button>
      </div>
      {err && <div className="err">{err}</div>}
      {found ? (
        found.length ? <div className="abs-grid">{found.map((b) => <BookCard key={b.id} b={b} prog={prog.get(b.id)} />)}</div> : <div className="empty">没有匹配「{q}」的书</div>
      ) : (
        <>
          {shelves.map((s) => (
            <section key={s.id} className="abs-sec">
              <h3>{s.label}</h3>
              <div className="abs-hrow">{s.books.map((b) => <BookCard key={b.id} b={b} prog={prog.get(b.id)} />)}</div>
            </section>
          ))}
          <section className="abs-sec">
            <div className="abs-sec-h">
              <h3>全部书籍{total ? ` · ${total}` : ''}</h3>
              <div className="abs-pills">{SORTS.map((s, i) => <button key={s[2]} type="button" className={i === sortI ? 'on' : ''} onClick={() => setSortI(i)}>{s[2]}</button>)}</div>
            </div>
            {!books.length && busy && <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>}
            <div className="abs-grid">{books.map((b) => <BookCard key={b.id} b={b} prog={prog.get(b.id)} />)}</div>
            {books.length < total && <div style={{ textAlign: 'center', margin: '16px 0' }}><button type="button" onClick={more} disabled={busy}>{busy ? '加载中…' : `加载更多（${books.length}/${total}）`}</button></div>}
          </section>
        </>
      )}
    </div>
  );
}

// ───────── 详情 ─────────
export function AbsDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const p = useAbsPlayer();
  const [d, setD] = useState<AbsDetail | null>(null);
  const [err, setErr] = useState('');
  const [prog, setProg] = useState<AbsProgress | undefined>();
  const [bad, setBad] = useState(false);

  useEffect(() => {
    setD(null); setErr('');
    absDetail(id).then(setD).catch((e: Error) => setErr(e.message));
    absProgressMap().then((m) => setProg(m.get(id))).catch(() => undefined);
  }, [id]);

  const mine = p.id === id;
  const pos = mine ? p.pos : prog?.currentTime || 0;
  const dur = d?.duration || prog?.duration || 0;
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  const chap = d ? currentChapter(d.chapters, pos) : null;
  const playChapter = (start: number): void => { if (mine) absSeek(start); else void absPlay(id, start); };

  return (
    <div className="content abs-page">
      <button type="button" className="abs-link" onClick={() => nav('/audiobooks')}>← 返回有声书</button>
      {err && <div className="err">{err}</div>}
      {!d && !err && <div className="empty"><span className="spinner" aria-hidden="true" />加载中…</div>}
      {d && (
        <>
          <div className="abs-det">
            <div className="abs-det-cover">{!bad ? <img src={absCover(id, 600)} alt="" draggable={false} onError={() => setBad(true)} /> : <span className="abs-cover-t">{d.title}</span>}</div>
            <div className="abs-det-info">
              <h1>{d.title}</h1>
              {d.subtitle && <div className="muted">{d.subtitle}</div>}
              <div className="abs-meta">
                {d.author && <span>作者：{d.author}</span>}
                {d.narrator && <span>朗读：{d.narrator}</span>}
                {d.series && <span>系列：{d.series}</span>}
                {d.year && <span>{d.year} 年</span>}
                {d.duration > 0 && <span>{fmtLong(d.duration)}</span>}
              </div>
              {d.genres.length > 0 && <div className="abs-tags">{d.genres.map((g) => <i key={g}>{g}</i>)}</div>}
              {(pos > 5 || prog?.isFinished) && (
                <div className="abs-prog">
                  <div className="abs-prog-bar"><b style={{ width: `${prog?.isFinished && !mine ? 100 : pct}%` }} /></div>
                  <span>{prog?.isFinished && !mine ? '已听完' : `已听 ${fmtDur(pos)} / ${fmtDur(dur)}`}{chap ? ` · ${chap.title}` : ''}</span>
                </div>
              )}
              <div className="abs-btns">
                <button type="button" className="primary" onClick={() => void absPlay(id)}>
                  {mine ? (p.playing ? '⏸ 暂停' : '▶ 继续播放') : pos > 5 && !prog?.isFinished ? '▶ 继续收听' : '▶ 开始收听'}
                </button>
                {(pos > 5 || prog?.isFinished) && <button type="button" onClick={() => void absPlay(id, 0)}>从头开始</button>}
              </div>
              {p.err && mine && <div className="err" style={{ marginTop: 10 }}>{p.err}</div>}
              {d.description && <div className="abs-desc">{d.description}</div>}
            </div>
          </div>
          {d.chapters.length > 0 && (
            <section className="abs-sec">
              <h3>章节 · {d.chapters.length}</h3>
              <div className="abs-chaps">
                {d.chapters.map((c) => (
                  <button key={c.id} type="button" className={`abs-chap${chap?.id === c.id ? ' on' : ''}`} onClick={() => playChapter(c.start)}>
                    <span className="abs-chap-t">{c.title}</span>
                    <span className="abs-chap-d">{fmtDur(c.end - c.start)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
