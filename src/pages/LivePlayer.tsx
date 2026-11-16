// 直播播放：全窗口 mpv + 渐隐控制条 + 左侧频道列表。↑/↓ 或 PgUp/PgDn 换台，L 开关频道列表，Tab 换线路。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { openMpv, type MpvSession } from '../lib/mpv';
import { loadChannels, loadFavs, type LiveChannel } from '../lib/live';
import { loadPlayPrefs, savePlayPrefs } from '../lib/prefs';
import { androidBridge, isAndroid, isMobileApp } from '../lib/platform';
import { syncStatusBar } from '../lib/theme';
import { hhmm, nowNext, progsOf } from '../lib/epg';
import { winClose, winIsFullscreen, winMinimize, winSetFullscreen, winToggleMax } from '../lib/win';

const LAND_KEY = 'wemby-live-land';
/** 手机直播：上次是横屏还是竖屏（默认竖屏） */
const readLand = (): boolean => { try { return localStorage.getItem(LAND_KEY) === '1'; } catch { return false; } };

export default function LivePlayer() {
  const nav = useNavigate();
  const [qs] = useSearchParams();
  const all = useMemo(loadChannels, []);
  const g = qs.get('g') || '';
  const pool: LiveChannel[] = useMemo(() => {
    const favs = loadFavs();
    return all.filter((c) => (g === '__fav' ? favs.includes(c.name) : !g || c.group === g));
  }, [all, g]);
  const [name, setName] = useState(qs.get('ch') || '');
  const [line, setLine] = useState(0);
  const ch = all.find((c) => c.name === name);

  const sessRef = useRef<MpvSession | null>(null);
  const readyRef = useRef<Promise<MpvSession | null> | null>(null);
  const pausedRef = useRef(false);
  const failTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const lineRef = useRef(0);
  lineRef.current = line;
  const chRef = useRef<LiveChannel | undefined>(ch);
  chRef.current = ch;

  const [paused, setPaused] = useState(false);
  const [vol, setVol] = useState(isMobileApp ? 100 : Math.round(loadPlayPrefs().volume * 100));
  const [muted, setMuted] = useState(false);
  const [fps, setFps] = useState(0);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  const [vbr, setVbr] = useState(0);
  const [hw, setHw] = useState('');
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [uiShown, setUiShown] = useState(true);
  const [list, setList] = useState(!isMobileApp);
  const [epgOpen, setEpgOpen] = useState(false);
  const [, setClock] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setClock((n) => n + 1), 30000); return () => window.clearInterval(t); }, []);
  const land0 = useRef(readLand());
  const [full, setFull] = useState(isMobileApp && land0.current);
  // 窗口宽度分档：<700 或 窗口比视频更高 → 竖屏排法（视频在上，下面是频道 / 节目单）；<1000 → 面板同时只开一个
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const f = (): void => setWin({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const portrait = win.w < 700 || win.h > win.w;
  const compact = win.w < 1000;
  const toggleList = useCallback(() => { const nv = !list; setList(nv); if (nv && compact) setEpgOpen(false); }, [list, compact]);
  const toggleEpg = useCallback(() => { const nv = !epgOpen; setEpgOpen(nv); if (nv && compact) setList(false); }, [epgOpen, compact]);
  // 状态栏高度（手机竖屏时视频要让开它）
  const [sat, setSat] = useState(0);
  useEffect(() => {
    if (!isMobileApp) return;
    const set = (): void => {
      let v = 0;
      if (!full) { try { v = androidBridge()?.getInsetTop?.() || 0; } catch { /* ignore */ } }
      setSat(v);
      document.documentElement.style.setProperty('--sat', `${v}px`);
    };
    set();
    const ts = [150, 500, 1200].map((ms) => window.setTimeout(set, ms));
    window.addEventListener('resize', set);
    return () => { ts.forEach((t) => window.clearTimeout(t)); window.removeEventListener('resize', set); };
  }, [full]);
  const vidH = portrait ? Math.min(Math.round(win.w * 9 / 16), Math.round(win.h * 0.55)) : 0;
  // 竖屏：把画面限制在顶部 16:9 区域，下面留给网页。
  // 安卓：直接设原生画面容器的位置和高度（像素）；电脑 / iOS：用 mpv 的 video-margin-ratio-*
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const topPx = portrait ? Math.round(sat * dpr) : 0;
    const hPx = portrait ? Math.round(vidH * dpr) : 0;
    const H = win.h || 1;
    void readyRef.current?.then((s) => {
      if (!s) return;
      if (isAndroid) {
        const w = window as unknown as { AndroidMpv?: { setVideoBox?: (t: number, h: number) => void }; AndroidExo?: { setVideoBox?: (t: number, h: number) => void } };
        try { w.AndroidMpv?.setVideoBox?.(topPx, hPx); } catch { /* ignore */ }
        try { w.AndroidExo?.setVideoBox?.(topPx, hPx); } catch { /* ignore */ }
        return;
      }
      const top = portrait ? sat / H : 0;
      const bot = portrait ? Math.max(0, 1 - (sat + vidH) / H) : 0;
      void s.set('video-margin-ratio-top', top).catch(() => undefined);
      void s.set('video-margin-ratio-bottom', bot).catch(() => undefined);
    });
  }, [portrait, sat, vidH, win.h]);
  // 手机：状态栏图标固定浅色（竖屏时状态栏压在黑色视频上方）；离开后按主题还原
  useEffect(() => {
    if (!isAndroid) return;
    syncStatusBar(false);
    return () => syncStatusBar();
  }, []);
  // 横屏 / 桌面：量顶栏和底栏的实际高度，面板和台标信息按它们让开
  const playerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const ctrlsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (portrait) return;
    const root = playerRef.current, t = titleRef.current, c = ctrlsRef.current;
    if (!root || !t || !c) return;
    const f = (): void => {
      const rb = root.getBoundingClientRect();
      root.style.setProperty('--lv-top', `${Math.round(t.getBoundingClientRect().bottom - rb.top + 10)}px`);
      root.style.setProperty('--lv-bot', `${Math.round(rb.bottom - c.getBoundingClientRect().top + 10)}px`);
    };
    f();
    let ro: ResizeObserver | null = null;
    try { ro = new ResizeObserver(f); ro.observe(t); ro.observe(c); } catch { /* ignore */ }
    window.addEventListener('resize', f);
    return () => { ro?.disconnect(); window.removeEventListener('resize', f); };
  }, [portrait, ch, win.w]);
  // 当前频道 / 当前节目滚到可见位置
  useEffect(() => {
    if (!portrait) return;
    const t = window.setTimeout(() => {
      document.querySelector('.lv-chi.on')?.scrollIntoView({ block: 'center' });
      document.querySelector('.lv-row.now')?.scrollIntoView({ block: 'center' });
    }, 60);
    return () => window.clearTimeout(t);
  }, [portrait, name]);
  // 像电视一样：开播 / 换台时在左上角显示 台号 · 台名 · 正在播放 · 接下来，5 秒后淡出
  const [osd, setOsd] = useState(false);
  useEffect(() => {
    if (!name) return;
    setOsd(true);
    const t = window.setTimeout(() => setOsd(false), 5000);
    return () => window.clearTimeout(t);
  }, [name]);

  const nextLine = useCallback((reason: string) => {
    const c = chRef.current;
    if (!c) return;
    if (lineRef.current + 1 < c.lines.length) {
      setLine(lineRef.current + 1);
    } else {
      setBusy(false);
      setErr(`${reason}（已试完 ${c.lines.length} 条线路，可以换个频道或稍后再试）`);
    }
  }, []);

  // 起 mpv（只一次）
  useEffect(() => {
    let dead = false;
    document.documentElement.classList.add('mpv-on');
    readyRef.current = openMpv({
      hdr: loadPlayPrefs().hdr,
      forceMpv: true,
      onProp: (n, d) => {
        switch (n) {
          case 'pause': pausedRef.current = !!d; setPaused(!!d); break;
          case 'time-pos':
            if (typeof d === 'number') {
              setBusy(false);
              setErr('');
              if (failTimer.current) window.clearTimeout(failTimer.current);
            }
            break;
          case 'container-fps': setFps(typeof d === 'number' ? d : 0); break;
          case 'video-bitrate': setVbr(typeof d === 'number' ? d : 0); break;
          case 'width': setDim((x) => ({ ...x, w: typeof d === 'number' ? d : 0 })); break;
          case 'height': setDim((x) => ({ ...x, h: typeof d === 'number' ? d : 0 })); break;
          case 'volume': if (typeof d === 'number') setVol(d); break;
          case 'mute': setMuted(!!d); break;
          case 'hwdec-current': setHw(typeof d === 'string' ? d : ''); break;
          default: break;
        }
      },
    })
      .then(async (s) => {
        if (dead) {
          await s.close();
          return null;
        }
        sessRef.current = s;
        // 手机：播放器音量固定 100，音量交给系统音量键 / 右侧竖滑（和点播一致）；电脑才用保存的音量
        await s.set('volume', isMobileApp ? 100 : Math.round(loadPlayPrefs().volume * 100));
        await s.set('mute', 'no').catch(() => undefined);
        return s;
      })
      .catch((e: unknown) => {
        setBusy(false);
        setErr(`MPV 启动失败：${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
    return () => {
      dead = true;
      if (failTimer.current) window.clearTimeout(failTimer.current);
      const s = sessRef.current;
      sessRef.current = null;
      void s?.close();
      document.documentElement.classList.remove('mpv-on');
    };
  }, []);

  // 换台 / 换线路
  useEffect(() => {
    const url = ch?.lines[line]?.url;
    if (!url) return;
    let dead = false;
    setBusy(true);
    setErr('');
    setFps(0);
    setVbr(0);
    setDim({ w: 0, h: 0 });
    void readyRef.current?.then(async (s) => {
      if (!s || dead) return;
      await s.loadfile(url);
      if (dead) return;   // 快速换台：旧频道的超时不能误伤新频道
      failTimer.current = window.setTimeout(() => nextLine('这条线路 15 秒内没有出画面'), 15000);
    });
    return () => {
      dead = true;
      if (failTimer.current) window.clearTimeout(failTimer.current);
    };
  }, [ch, line, nextLine]);

  const pick = useCallback((c: LiveChannel) => {
    setName(c.name);
    setLine(0);
  }, []);
  const step = useCallback((d: number) => {
    if (!pool.length) return;
    const i = pool.findIndex((c) => c.name === name);
    pick(pool[(i + d + pool.length) % pool.length]);
  }, [pool, name, pick]);

  const toggle = useCallback(() => void sessRef.current?.cmd('cycle', ['pause']), []);
  const setVolume = useCallback((v: number) => {
    const c = Math.max(0, Math.min(100, v));
    void sessRef.current?.set('volume', Math.round(c));
    void sessRef.current?.set('mute', 'no');
    savePlayPrefs({ volume: c / 100 });
  }, []);
  const toggleFull = useCallback(async () => {
    const next = !(await winIsFullscreen());
    await winSetFullscreen(next);
    setFull(next);
    if (isMobileApp) { try { localStorage.setItem(LAND_KEY, next ? '1' : '0'); } catch { /* ignore */ } }
  }, []);
  const exit = useCallback(async () => {
    if (await winIsFullscreen()) await winSetFullscreen(false);
    nav('/live', { replace: true });
  }, [nav]);

  const poke = useCallback(() => {
    setUiShown(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setUiShown(false), 3000);
  }, []);
  useEffect(() => {
    poke();
  }, [poke]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      switch (e.key) {
        case ' ': e.preventDefault(); toggle(); break;
        case 'ArrowUp': case 'PageUp': e.preventDefault(); step(-1); break;
        case 'ArrowDown': case 'PageDown': e.preventDefault(); step(1); break;
        case 'ArrowLeft': setVolume(vol - 5); break;
        case 'ArrowRight': setVolume(vol + 5); break;
        case 'Tab': e.preventDefault(); if (ch && ch.lines.length > 1) setLine((l) => (l + 1) % ch.lines.length); break;
        case 'l': case 'L': toggleList(); break;
        case 'm': case 'M': void sessRef.current?.cmd('cycle', ['mute']); break;
        case 'f': case 'F': void toggleFull(); break;
        case 'Escape': void exit(); break;
        default: return;
      }
      poke();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, step, setVolume, vol, ch, toggleFull, exit, poke, toggleList]);

  useEffect(() => {
    if (!isMobileApp) return;
    // 手机：默认竖屏（状态栏可见），点「横屏」才全屏横着看；记住上次的选择
    void winSetFullscreen(land0.current);
    setFull(land0.current);
    return () => {
      void winSetFullscreen(false);
    };
  }, []);

  const showUi = uiShown || paused;

  // 安卓触屏：单击显隐控制条 / 左侧竖滑亮度 / 右侧竖滑系统音量
  const [hud, setHud] = useState('');
  const hudTimer = useRef<number | null>(null);
  const showHud = (t: string): void => {
    setHud(t);
    if (hudTimer.current) window.clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => setHud(''), 900);
  };
  const tg = useRef<{ x: number; y: number; w: number; h: number; mode: '' | 'vol' | 'bri'; base: number; val: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent): void => {
    const t = e.touches[0];
    const r = e.currentTarget.getBoundingClientRect();
    tg.current = { x: t.clientX - r.left, y: t.clientY, w: r.width, h: r.height, mode: '', base: 0, val: 0 };
  };
  const onTouchMove = (e: React.TouchEvent): void => {
    const g = tg.current;
    if (!g) return;
    const t = e.touches[0];
    const dy = t.clientY - g.y;
    if (!g.mode) {
      if (Math.abs(dy) <= 12) return;
      if (g.x < g.w / 2) { g.mode = 'bri'; g.base = androidBridge()?.getBrightness() ?? 0.5; }
      else { g.mode = 'vol'; g.base = (androidBridge()?.getSysVolume() ?? 0.5) * 100; }
    }
    if (g.mode === 'vol') {
      g.val = Math.max(0, Math.min(100, g.base - (dy / g.h) * 130));
      androidBridge()?.setSysVolume(g.val / 100);
      showHud(`音量 ${Math.round(g.val)}%`);
    } else {
      g.val = Math.max(0.02, Math.min(1, g.base - (dy / g.h) * 1.3));
      androidBridge()?.setBrightness(g.val);
      showHud(`亮度 ${Math.round(g.val * 100)}%`);
    }
  };
  const onTouchEnd = (e: React.TouchEvent): void => {
    e.preventDefault();
    const g = tg.current;
    tg.current = null;
    if (!g || g.mode) return;
    if (showUi && !paused) setUiShown(false); else poke();
  };

  if (portrait) {
    const { now, next } = ch ? nowNext(ch) : { now: undefined, next: undefined };
    const pctNow = now ? Math.min(100, Math.max(0, ((Date.now() - now.s) / (now.e - now.s)) * 100)) : 0;
    const progs = ch ? progsOf(ch) : [];
    return (
      <div ref={playerRef} className={`we-player mpv lv lv-pt${showUi ? '' : ' hide-ui'}`} style={{ ['--lv-sat' as string]: `${sat}px`, ['--lv-vh' as string]: `${vidH}px` }} onMouseMove={poke}>
        <div className="we-surface" onClick={() => { if (!isMobileApp) toggle(); }} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} />
        {hud && <div className="we-hud">{hud}</div>}
        {busy && !err && <div className="we-loading"><span className="spinner" aria-hidden="true" />正在连接…</div>}
        {err && <div className="we-error">{err}</div>}
        <div className="lv-vtop">
          <button className="we-btn lv-ic" aria-label="返回" onClick={() => void exit()}>
            <svg width="22" height="22" viewBox="0 0 24 24"><path d="M15.5 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span style={{ flex: 1 }} />
          {!isMobileApp && (
            <div className="we-winbtns">
              <button className="we-btn" title="最小化" onClick={() => void winMinimize()}><svg width="12" height="12" viewBox="0 0 16 16"><line x1="3.5" y1="8" x2="12.5" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
              <button className="we-btn" title="最大化" onClick={() => void winToggleMax()}><svg width="12" height="12" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
              <button className="we-btn" title="关闭" onClick={() => void winClose()}><svg width="12" height="12" viewBox="0 0 16 16"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
            </div>
          )}
        </div>
        <button className="we-btn lv-ic lv-vplay" aria-label={paused ? '播放' : '暂停'} onClick={(e) => { e.stopPropagation(); toggle(); poke(); }}>
          {paused ? <svg width="28" height="28" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" /></svg> : <svg width="28" height="28" viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" /></svg>}
        </button>
        {isMobileApp && (
          <button className="we-btn lv-ic lv-vbot" aria-label="横屏" title="横屏全屏观看" onClick={(e) => { e.stopPropagation(); void toggleFull(); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          </button>
        )}

        <div className="lv-low">
          <div className="lv-info">
            <h1>{ch?.name || '未找到频道'}<span className="we-livedot">● 直播</span></h1>
            {now ? (
              <>
                <div className="lv-now"><span>{now.t}</span><em>{hhmm(now.s)}–{hhmm(now.e)}</em></div>
                <div className="lv-bar"><i style={{ width: `${pctNow}%` }} /></div>
              </>
            ) : <div className="lv-now dim"><span>暂无节目信息</span></div>}
            {next && <div className="lv-next">接下来　{next.t}　{hhmm(next.s)}</div>}
          </div>
          <div className="lv-ctl">
            <button onClick={() => step(-1)}>上一台</button>
            <button onClick={() => step(1)}>下一台</button>
            {ch && ch.lines.length > 1 && <button onClick={() => setLine((l) => (l + 1) % ch.lines.length)}>换线路 {line + 1}/{ch.lines.length}</button>}
            <button onClick={() => void sessRef.current?.cmd('cycle', ['mute'])}>{muted || vol === 0 ? '取消静音' : '静音'}</button>
          </div>
          <div className="lv-cols">
            <div className="lv-l">
              <div className="lv-gh">{g === '__fav' ? '收藏频道' : g || '全部频道'}（{pool.length}）</div>
              {pool.map((c) => (
                <div key={c.name} className={`lv-chi${c.name === name ? ' on' : ''}`} onClick={() => pick(c)}>{c.name}</div>
              ))}
            </div>
            <div className="lv-r">
              <div className="lv-gh">{ch ? `${ch.name} · 节目单` : '节目单'}</div>
              {progs.length === 0 && <div className="lv-row dim">没有这个频道的节目单（在直播页设置 XMLTV 地址；频道名或 tvg-id 要对得上）</div>}
              {progs.map((p) => {
                const isNow = p.s <= Date.now() && Date.now() < p.e;
                return <div key={p.s} className={`lv-row${isNow ? ' now' : p.e <= Date.now() ? ' past' : ''}`}><b>{hhmm(p.s)}</b><span>{p.t}</span></div>;
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={playerRef} className={`we-player mpv lv lv-w${compact ? ' lv-compact' : ''}${list ? ' has-list' : ''}${epgOpen ? ' has-epg' : ''}${showUi ? '' : ' hide-ui'}`} onMouseMove={poke}>
      <div className="we-surface" onClick={() => { if (!isMobileApp) toggle(); }} onDoubleClick={() => { if (!isMobileApp) void toggleFull(); }} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} />
      {hud && <div className="we-hud">{hud}</div>}
      {busy && !err && <div className="we-loading"><span className="spinner" aria-hidden="true" />正在连接…</div>}
      {osd && ch && !(compact && (list || epgOpen)) && (() => {
        const { now, next } = nowNext(ch);
        const no = Math.max(0, pool.findIndex((c) => c.name === ch.name)) + 1;
        const pctNow = now ? Math.min(100, Math.max(0, ((Date.now() - now.s) / (now.e - now.s)) * 100)) : 0;
        return (
          <div className="we-osd" key={ch.name}>
            <div className="we-osd-no">{String(no).padStart(3, '0')}</div>
            <div className="we-osd-main">
              <div className="we-osd-name">{ch.name}</div>
              {now ? (
                <>
                  <div className="we-osd-now">正在播放　{now.t}<span>{hhmm(now.s)}–{hhmm(now.e)}</span></div>
                  <div className="we-osd-bar"><i style={{ width: `${pctNow}%` }} /></div>
                </>
              ) : <div className="we-osd-now" style={{ opacity: .6 }}>暂无节目信息</div>}
              {next && <div className="we-osd-next">接下来　{next.t}<span>{hhmm(next.s)}</span></div>}
            </div>
          </div>
        );
      })()}
      {err && <div className="we-error">{err}</div>}

      <div className="we-top">
        <button className="we-btn we-back" title="返回（Esc）" aria-label="返回" onClick={() => void exit()}>
          <svg width="26" height="26" viewBox="0 0 24 24"><path d="M15.5 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="we-titlebox" ref={titleRef}>
          <div className="we-title">{ch?.name || '未找到频道'} <span className="we-livedot">● 直播</span></div>
          {ch && nowNext(ch).now && <div className="we-epg-now">正在播放：{nowNext(ch).now?.t}　{hhmm(nowNext(ch).now?.s || 0)}–{hhmm(nowNext(ch).now?.e || 0)}</div>}
          <div className="we-subline">
            {[dim.w > 0 ? `${dim.w}×${dim.h}` : '', fps > 0 ? `${Number(fps.toFixed(3))} fps` : '', vbr > 0 ? `${(vbr / 1e6).toFixed(1)} Mbps` : '', ch && ch.lines.length > 1 ? `线路 ${line + 1}/${ch.lines.length}` : '', `MPV${hw && hw !== 'no' ? ` · ${hw}` : ''}`].filter(Boolean).join('  ·  ')}
          </div>
        </div>
        {!full && !isMobileApp && (
          <div className="we-winbtns">
            <button className="we-btn" title="最小化" onClick={() => void winMinimize()}><svg width="12" height="12" viewBox="0 0 16 16"><line x1="3.5" y1="8" x2="12.5" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
            <button className="we-btn" title="最大化" onClick={() => void winToggleMax()}><svg width="12" height="12" viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
            <button className="we-btn" title="关闭" onClick={() => void winClose()}><svg width="12" height="12" viewBox="0 0 16 16"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></button>
          </div>
        )}
      </div>

      {isMobileApp && (<div className="we-center" onClick={(e) => e.stopPropagation()}>
        <button className="we-cbtn we-cplay" title="播放/暂停（空格）" aria-label={paused ? '播放' : '暂停'} onClick={toggle}>
          {paused ? <svg width="64" height="64" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" /></svg> : <svg width="64" height="64" viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" /></svg>}
        </button>
      </div>)}

      {list && (
        <div className="we-chlist">
          <div className="we-chlist-head">{g === '__fav' ? '收藏频道' : g || '全部频道'}（↑↓ 换台）</div>
          <div className="we-chlist-body">
            {pool.map((c) => (
              <div key={c.name} className={`we-menu-item${c.name === name ? ' active' : ''}`} onClick={() => pick(c)}>{c.name}</div>
            ))}
          </div>
        </div>
      )}

      {epgOpen && ch && (
        <div className="we-epg">
          <div className="we-chlist-head">{ch.name} 节目单</div>
          <div className="we-chlist-body" style={{ padding: 0 }}>
            {progsOf(ch).length === 0 && <div className="we-epg-row" style={{ color: '#aaa' }}>没有这个频道的节目单（在直播页设置 XMLTV 地址；频道名或 tvg-id 要对得上）</div>}
            {progsOf(ch).map((p) => {
              const now = p.s <= Date.now() && Date.now() < p.e;
              return <div key={p.s} className={`we-epg-row${now ? ' now' : ''}`}><b>{hhmm(p.s)}</b>{p.t}</div>;
            })}
          </div>
        </div>
      )}

      <div className="we-bottom" onClick={(e) => e.stopPropagation()}>
        <div className="we-ctrls" ref={ctrlsRef}>
          {!isMobileApp && (
            <button className="we-btn" title="播放/暂停（空格）" aria-label={paused ? '播放' : '暂停'} onClick={() => { toggle(); poke(); }}>
              {paused ? <svg width="26" height="26" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" /></svg> : <svg width="26" height="26" viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" /></svg>}
            </button>
          )}
          <div className="we-volgrp" title="鼠标滚轮调节音量" onWheel={(e) => { setVolume(vol + (e.deltaY < 0 ? 5 : -5)); poke(); }}>
            <button className="we-btn we-txt" title="静音（M）" onClick={() => void sessRef.current?.cmd('cycle', ['mute'])}>{muted || vol === 0 ? '静音' : '音量'}</button>
            <input className="we-vol" type="range" min={0} max={100} value={muted ? 0 : vol} aria-label="音量" onChange={(e) => setVolume(Number(e.target.value))} />
            <span className="we-volnum">{muted ? '静音' : Math.round(vol)}</span>
          </div>
          <span style={{ flex: 1 }} />
        <button className="we-btn" title="上一个频道（↑）" aria-label="上一台" onClick={() => { step(-1); poke(); }}>
          <svg width="24" height="24" viewBox="0 0 24 24"><path d="M18 5v14l-9-7 9-7ZM6 5h2.5v14H6z" fill="currentColor" /></svg>
        </button>
        <button className="we-btn" title="下一个频道（↓）" aria-label="下一台" onClick={() => { step(1); poke(); }}>
          <svg width="24" height="24" viewBox="0 0 24 24"><path d="M6 5v14l9-7-9-7Zm9.5 0H18v14h-2.5z" fill="currentColor" /></svg>
        </button>
          <button className="we-btn we-lbl" title="节目单" onClick={toggleEpg}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg><span>节目单</span>
          </button>
          {ch && ch.lines.length > 1 && (
            <button className="we-btn we-lbl" title="换线路（Tab）" onClick={() => setLine((l) => (l + 1) % ch.lines.length)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h12l-3-3M20 17H8l3 3" /></svg><span>换线路</span>
            </button>
          )}
          <button className="we-btn we-lbl" title="频道列表（L）" onClick={toggleList}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg><span>频道</span>
          </button>
          {isMobileApp && full && (
            <button className="we-btn we-lbl" title="切回竖屏" onClick={() => void toggleFull()}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="3" width="10" height="18" rx="2" /></svg><span>竖屏</span>
            </button>
          )}
          {!isMobileApp && (
            <button className="we-btn" title="全屏（F）" onClick={() => void toggleFull()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{full ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
