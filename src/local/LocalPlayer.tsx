// 随便看看 · 播放页：视频 + 播放列表（YouTube 风格）。
// 手机竖屏 / 窄窗口：视频在上，下面是标题、功能按钮、播放列表；电脑宽窗口：左边视频，右边播放列表；横屏 / 全屏：只有视频和控制条。
// 功能：定时停止（最后 60 秒音量渐小）、熄屏只听声音、夜间音量（压缩音量起伏）、暖色护眼、循环 / 随机、记住进度。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { openMpv, type MpvSession } from '../lib/mpv';
import { loadPlayPrefs } from '../lib/prefs';
import { androidBridge, isAndroid, isMobileApp } from '../lib/platform';
import { useWheelVolume } from '../lib/wheelVol';
import { syncStatusBar } from '../lib/theme';
import { winClose, winIsFullscreen, winMinimize, winSetFullscreen, winToggleMax } from '../lib/win';
import { listenMusic, musicState, stopMusic } from '../music/player';
import { absStop } from '../abs/absPlayer';
import Cover from './Cover';
import { dsmKeepAlive, dsmPlayUrl, fmtClock, fmtSize, readPos, takePlayQueue, writePos, type LocalVideo } from './dsm';
import { clearTimer, getTimer, setTimerEof, setTimerMin, stopOthers, timerLeft, useTimer } from './timer';

type Loop = 'off' | 'all' | 'one';
interface Prefs { loop: Loop; shuffle: boolean; warm: boolean; norm: boolean }
const PREF_KEY = 'wemby-local-prefs';
const loadPrefs = (): Prefs => {
  try { return { loop: 'off', shuffle: false, warm: false, norm: false, ...(JSON.parse(localStorage.getItem(PREF_KEY) || '{}') as Partial<Prefs>) }; } catch { return { loop: 'off', shuffle: false, warm: false, norm: false }; }
};
const LOOP_LABEL: Record<Loop, string> = { off: '不循环', all: '列表循环', one: '单个循环' };
const TIMER_OPTS = [15, 30, 45, 60, 90, 120];

interface Rect { x: number; y: number; w: number; h: number }

export default function LocalPlayer() {
  const nav = useNavigate();
  const q0 = useMemo(() => takePlayQueue(), []);
  const [orig] = useState<LocalVideo[]>(() => q0?.items ?? []);
  const [order, setOrder] = useState<LocalVideo[]>(() => q0?.items ?? []);
  const [idx, setIdx] = useState(q0?.index ?? 0);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const cur = order[idx];
  const listTitle = q0?.title || '播放列表';

  const sessRef = useRef<MpvSession | null>(null);
  const readyRef = useRef<Promise<MpvSession | null> | null>(null);
  const posRef = useRef(0);
  const durRef = useRef(0);
  const volRef = useRef(100);
  const fadingRef = useRef(false);
  const fadeBase = useRef(0);
  const failTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const idxRef = useRef(idx);
  const orderRef = useRef(order);
  const prefsRef = useRef(prefs);
  idxRef.current = idx;
  orderRef.current = order;
  prefsRef.current = prefs;

  const [paused, setPaused] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(isMobileApp ? 100 : Math.round(loadPlayPrefs().volume * 100));
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  // 画面还没出来（或出错）时垫一层黑底：窗口是透明的，不垫的话会透出桌面 / 后面的窗口
  const [started, setStarted] = useState(false);
  useEffect(() => { if (!busy && !err) setStarted(true); }, [busy, err]);
  const waitCls = started ? '' : ' we-wait';
  const [dark, setDark] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [uiShown, setUiShown] = useState(true);
  const [full, setFull] = useState(false);
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [sat, setSat] = useState(0);
  const [, setTick] = useState(0);
  const timer = useTimer();

  useEffect(() => {
    const f = (): void => setWin({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  // 状态栏高度（手机竖屏时视频让开它）
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
  useEffect(() => {
    if (!isAndroid) return;
    syncStatusBar(false);
    return () => syncStatusBar();
  }, []);

  const savePrefs = (p: Prefs): void => {
    setPrefs(p);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* ignore */ }
  };

  // ───────── 版面 ─────────
  const portrait = isAndroid ? !full : !full && (win.w < 700 || win.h > win.w);
  const mode: 'full' | 'portrait' | 'wide' = full ? 'full' : portrait ? 'portrait' : 'wide';
  const sideW = Math.min(400, Math.round(win.w * 0.3));
  const rect: Rect | null = useMemo(() => {
    if (mode === 'full') return null;
    if (mode === 'portrait') return { x: 0, y: sat, w: win.w, h: Math.min(Math.round(win.w * 9 / 16), Math.round(win.h * 0.55)) };
    const top = 68;
    let h = Math.round(((win.w - 48 - sideW - 20) * 9) / 16);
    h = Math.max(160, Math.min(h, win.h - top - 150));
    return { x: 24, y: top, w: Math.round((h * 16) / 9), h };
  }, [mode, sat, win.w, win.h, sideW]);

  // 把原生画面摆进 rect：
  //  安卓：设画面容器的位置和高度（像素）；
  //  电脑 / iOS：用 mpv 的 video-zoom + video-pan-x/y（不用 video-margin-ratio，它在 gpu-next 上位置不对）。
  //  原理：mpv 默认把画面按窗口「适应」并居中，这里把它缩放到 rect 的大小，再平移到 rect 的中心。
  const [dims, setDims] = useState({ w: 0, h: 0 });
  useEffect(() => {
    void readyRef.current?.then((s) => {
      if (!s) return;
      if (isAndroid) {
        const dpr = window.devicePixelRatio || 1;
        const w = window as unknown as { AndroidMpv?: { setVideoBox?: (t: number, h: number) => void } };
        try { w.AndroidMpv?.setVideoBox?.(rect ? Math.round(rect.y * dpr) : 0, rect ? Math.round(rect.h * dpr) : 0); } catch { /* ignore */ }
        return;
      }
      const set = (n: string, v: number): void => { void s.set(n, v).catch(() => undefined); };
      set('video-margin-ratio-left', 0); set('video-margin-ratio-right', 0); set('video-margin-ratio-top', 0); set('video-margin-ratio-bottom', 0);
      set('video-align-x', 0); set('video-align-y', 0);
      if (!rect || !dims.w || !dims.h) { set('video-zoom', 0); set('video-pan-x', 0); set('video-pan-y', 0); return; }
      const W = win.w || 1, H = win.h || 1;
      const s0 = Math.min(W / dims.w, H / dims.h);                   // mpv 默认的适应窗口缩放
      const s1 = Math.min(rect.w / dims.w, rect.h / dims.h);         // 想要的缩放：适应 rect
      set('video-zoom', Math.log2(s1 / s0));
      set('video-pan-x', (rect.x + rect.w / 2 - W / 2) / (dims.w * s1));
      set('video-pan-y', (rect.y + rect.h / 2 - H / 2) / (dims.h * s1));
    });
  }, [rect, win.w, win.h, dims.w, dims.h]);

  // ───────── 播放器 ─────────
  const onEndedRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!q0 || !q0.items.length) { nav('/local', { replace: true }); return; }
    let dead = false;
    document.documentElement.classList.add('mpv-on');
    stopMusic();
    absStop();
    readyRef.current = openMpv({
      hdr: loadPlayPrefs().hdr,
      forceMpv: true,
      onProp: (n, d) => {
        switch (n) {
          case 'pause': setPaused(!!d); break;
          case 'time-pos':
            if (typeof d === 'number') {
              posRef.current = d;
              setPos(d);
              setBusy(false);
              setErr('');
              if (failTimer.current) window.clearTimeout(failTimer.current);
            }
            break;
          case 'duration': if (typeof d === 'number') { durRef.current = d; setDur(d); } break;
          case 'width': setDims((x) => ({ ...x, w: typeof d === 'number' ? d : 0 })); break;
          case 'height': setDims((x) => ({ ...x, h: typeof d === 'number' ? d : 0 })); break;
          case 'volume': if (typeof d === 'number' && !fadingRef.current) { volRef.current = d; setVol(d); } break;
          case 'eof-reached': if (d === true) onEndedRef.current(); break;
          default: break;
        }
      },
    })
      .then(async (s) => {
        if (dead) { await s.close(); return null; }
        sessRef.current = s;
        const v = isMobileApp ? 100 : Math.round(loadPlayPrefs().volume * 100);
        volRef.current = v;
        await s.set('volume', v);
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
      const c = orderRef.current[idxRef.current];
      if (c) writePos(c.path, posRef.current, durRef.current);
      const s = sessRef.current;
      sessRef.current = null;
      void s?.close();
      document.documentElement.classList.remove('mpv-on');
      try { androidBridge()?.setBrightness(-1); } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 音乐开始播放时，这里暂停
  useEffect(() => listenMusic(() => { if (musicState().playing) void sessRef.current?.set('pause', true); }), []);

  // 换视频（reload>0 = 重试：重新登录群晖并从当前位置继续）
  const [rl, setRl] = useState({ p: '', n: 0 });
  const reload = rl.p === cur?.path ? rl.n : 0;
  const setReload = useCallback((n: number) => setRl({ p: orderRef.current[idxRef.current]?.path ?? '', n }), []);
  useEffect(() => {
    if (!cur) return;
    let dead = false;
    const keep = reload > 0 ? Math.floor(posRef.current) : 0;
    setBusy(true);
    setErr('');
    if (reload === 0) { setPos(0); setDur(0); posRef.current = 0; durRef.current = 0; }
    void readyRef.current?.then(async (s) => {
      if (!s || dead) return;
      try {
        const saved = readPos()[cur.path];
        const start = reload > 0 ? keep : saved && saved.t > 30 && (!saved.d || saved.t < saved.d - 30) ? saved.t : 0;
        const url = await dsmPlayUrl(cur.path, reload > 0);
        if (dead) return;
        await s.loadfile(url, start > 1 ? { start: String(Math.floor(start)) } : undefined);
        if (dead) return;
        await s.set('pause', false).catch(() => undefined);
        await s.set('loop-file', prefsRef.current.loop === 'one' ? 'inf' : 'no').catch(() => undefined);
        failTimer.current = window.setTimeout(() => {
          if (reload === 0) setReload(1); // 第一次 25 秒没出画面：重新登录群晖再试一次
          else { setBusy(false); setErr('这个视频打不开（群晖没有返回数据）。可以检查网络，或这个文件的格式是否被支持。'); }
        }, 25000);
      } catch (e) {
        setBusy(false);
        setErr(e instanceof Error ? e.message : String(e));
      }
    });
    return () => { dead = true; if (failTimer.current) window.clearTimeout(failTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.path, reload]);

  const play = useCallback((i: number) => {
    const c = orderRef.current[idxRef.current];
    if (c) writePos(c.path, posRef.current, durRef.current);
    setIdx(Math.max(0, Math.min(orderRef.current.length - 1, i)));
  }, []);
  const step = useCallback((d: number) => {
    const n = orderRef.current.length;
    if (!n) return;
    play((idxRef.current + d + n) % n);
  }, [play]);

  onEndedRef.current = (): void => {
    const c = orderRef.current[idxRef.current];
    if (c) writePos(c.path, 0, 1);
    if (getTimer()?.kind === 'eof') { // 「播完当前」
      clearTimer();
      void sessRef.current?.set('pause', true);
      stopOthers();
      setDark(false);
      return;
    }
    const n = orderRef.current.length;
    const last = idxRef.current >= n - 1;
    if (last && prefsRef.current.loop === 'off') { void sessRef.current?.set('pause', true); return; }
    step(1);
  };

  // 循环方式、夜间音量、熄屏
  useEffect(() => { void readyRef.current?.then((s) => s?.set('loop-file', prefs.loop === 'one' ? 'inf' : 'no').catch(() => undefined)); }, [prefs.loop]);
  useEffect(() => {
    void readyRef.current?.then((s) => s?.set('af', prefs.norm ? 'lavfi=[dynaudnorm=f=250:g=15:p=0.7:m=8]' : '').catch(() => undefined));
  }, [prefs.norm]);
  useEffect(() => {
    void readyRef.current?.then((s) => s?.set('vid', dark ? 'no' : 'auto').catch(() => undefined));
    try { androidBridge()?.setBrightness(dark ? 0.02 : -1); } catch { /* ignore */ }
  }, [dark]);

  // 随机 / 顺序
  const toggleShuffle = (): void => {
    const c = orderRef.current[idxRef.current];
    if (!prefs.shuffle) {
      const rest = orderRef.current.filter((x) => x.path !== c?.path);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      setOrder(c ? [c, ...rest] : rest);
      setIdx(0);
    } else {
      setOrder(orig);
      setIdx(Math.max(0, orig.findIndex((x) => x.path === c?.path)));
    }
    savePrefs({ ...prefs, shuffle: !prefs.shuffle });
  };

  // ───────── 定时停止 ─────────
  useEffect(() => {
    const t = window.setInterval(() => {
      setTick((n) => n + 1);
      const tm = getTimer();
      const left = timerLeft(tm);
      if (left === null) {
        if (fadingRef.current) { fadingRef.current = false; void sessRef.current?.set('volume', fadeBase.current || volRef.current); }
        return;
      }
      if (left <= 60) {
        if (!fadingRef.current) { fadingRef.current = true; fadeBase.current = volRef.current; }
        void sessRef.current?.set('volume', Math.round(fadeBase.current * (left / 60)));
      }
      if (left <= 0) {
        fadingRef.current = false;
        clearTimer();
        void sessRef.current?.set('pause', true).then(() => sessRef.current?.set('volume', fadeBase.current || 100));
        stopOthers();
        setDark(false);
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  // 保存进度 / 群晖会话保活
  useEffect(() => {
    const a = window.setInterval(() => { const c = orderRef.current[idxRef.current]; if (c && posRef.current > 0) writePos(c.path, posRef.current, durRef.current); }, 10000);
    const b = window.setInterval(() => { void dsmKeepAlive(); }, 240000);
    return () => { window.clearInterval(a); window.clearInterval(b); };
  }, []);

  // ───────── 控制 ─────────
  const toggle = useCallback(() => { void sessRef.current?.cmd('cycle', ['pause']); }, []);
  const seekTo = useCallback((sec: number) => { void sessRef.current?.cmd('seek', [String(Math.max(0, sec)), 'absolute']); }, []);
  const toggleFull = useCallback(async () => {
    const next = !(await winIsFullscreen());
    await winSetFullscreen(next);
    setFull(next);
  }, []);
  const exit = useCallback(async () => {
    if (await winIsFullscreen()) await winSetFullscreen(false);
    nav('/local', { replace: true });
  }, [nav]);
  const poke = useCallback(() => {
    setUiShown(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setUiShown(false), 3500);
  }, []);
  useEffect(() => { poke(); }, [poke]);
  useEffect(() => () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); }, []);

  // 手机：竖屏 ⇄ 全屏横屏；离开时恢复竖屏
  useEffect(() => {
    if (!isMobileApp) return;
    void winSetFullscreen(false);
    return () => { void winSetFullscreen(false); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      poke();
      switch (e.key) {
        case ' ': case 'k': e.preventDefault(); toggle(); break;
        case 'ArrowLeft': seekTo(posRef.current - 10); break;
        case 'ArrowRight': seekTo(posRef.current + 10); break;
        case 'n': case 'N': step(1); break;
        case 'p': case 'P': step(-1); break;
        case 'f': case 'F': void toggleFull(); break;
        case 'Escape': if (dark) setDark(false); else if (full) void toggleFull(); else void exit(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [poke, toggle, seekTo, step, toggleFull, exit, dark, full]);

  // 拖进度条
  useWheelVolume(() => volRef.current, (v) => { volRef.current = v; setVol(v); void sessRef.current?.set('volume', v); }, poke);
  const lastTap = useRef(0);
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const fracOf = (e: React.PointerEvent): number => {
    const r = barRef.current?.getBoundingClientRect();
    return r && r.width ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0;
  };
  const shownPos = drag !== null ? drag * dur : pos;

  const left = timerLeft(timer);
  const timerLabel = timer ? (timer.kind === 'eof' ? '播完当前后停止' : `${fmtClock(left ?? 0)} 后停止`) : '定时停止';
  const progPct = dur > 0 ? Math.min(100, (shownPos / dur) * 100) : 0;

  // ───────── 组件片段 ─────────
  const tools = (
    <div className="lc-tools">
      <button className={timer ? 'on' : ''} onClick={() => setSheet(true)}>☾ {timerLabel}</button>
      <button onClick={() => setDark(true)}>熄屏只听声音</button>
      <button className={prefs.norm ? 'on' : ''} onClick={() => savePrefs({ ...prefs, norm: !prefs.norm })}>夜间音量</button>
      <button className={prefs.warm ? 'on' : ''} onClick={() => savePrefs({ ...prefs, warm: !prefs.warm })}>暖色护眼</button>
      <button className={prefs.loop !== 'off' ? 'on' : ''} onClick={() => savePrefs({ ...prefs, loop: prefs.loop === 'off' ? 'all' : prefs.loop === 'all' ? 'one' : 'off' })}>{LOOP_LABEL[prefs.loop]}</button>
      <button className={prefs.shuffle ? 'on' : ''} onClick={toggleShuffle}>随机</button>
    </div>
  );
  const queueList = (
    <div className="lc-queue">
      {order.map((v, i) => (
        <div key={v.path} className={`lc-qi${i === idx ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => play(i)} onKeyDown={(e) => e.key === 'Enter' && play(i)}>
          <Cover className="lc-qth" path={v.path} title={v.title} plain />
          <div className="lc-qx">
            <div className="lc-qt">{v.title}</div>
            <div className="lc-qm">{i === idx ? (paused ? '已暂停' : '正在播放') : fmtSize(v.size)}</div>
          </div>
        </div>
      ))}
    </div>
  );
  const info = (
    <div className="lc-info">
      <h2>{cur?.title || ''}</h2>
      <div className="lc-meta">{[cur && cur.list !== '未分组' ? cur.list : '', fmtSize(cur?.size ?? 0), `${idx + 1} / ${order.length}`].filter(Boolean).join('　·　')}</div>
    </div>
  );
  const sheetEl = sheet && (
    <div className="lc-sheet-bg" onClick={() => setSheet(false)}>
      <div className="lc-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="lc-sheet-h">定时停止</div>
        {TIMER_OPTS.map((m) => <button key={m} onClick={() => { setTimerMin(m); setSheet(false); }}>{m} 分钟后停止</button>)}
        <button onClick={() => { setTimerEof(); setSheet(false); }}>播完当前这个后停止</button>
        {timer && <button className="lc-danger" onClick={() => { clearTimer(); setSheet(false); }}>关闭定时</button>}
        <div className="lc-sheet-tip">最后 60 秒音量会慢慢变小，然后自动暂停，同时停掉音乐和听书。</div>
      </div>
    </div>
  );

  const stageStyle: React.CSSProperties = rect ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h } : { left: 0, top: 0, right: 0, bottom: 0 };
  const showCtl = uiShown || paused || !!err;

  return (
    <div className={`lc-player lc-${mode}${waitCls}${showCtl ? '' : ' hide-ui'}`} onMouseMove={isMobileApp ? undefined : poke}>
      {/* 视频区：画面在原生层，这里只放控制层 */}
      <div className="lc-stage" style={stageStyle}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button,.lc-bar,.lc-top')) return;
          if (!isMobileApp) { toggle(); return; }
          // 手机：单击显示 / 隐藏控制条；双击切换全屏 / 小屏
          const now = Date.now();
          if (now - lastTap.current < 320) { lastTap.current = 0; void toggleFull(); poke(); return; }
          lastTap.current = now;
          if (uiShown) setUiShown(false); else poke();
        }}
        onDoubleClick={() => { if (!isMobileApp) void toggleFull(); }}>
        {prefs.warm && <div className="lc-warm" />}
        {busy && !err && <div className="lc-center-msg"><span className="spinner" aria-hidden="true" />正在读取…</div>}
        {err && <div className="lc-center-msg lc-err">{err}<div><button onClick={() => setReload(reload + 1)}>重试</button></div></div>}
        <div className="lc-top">
          <button className="lc-ic" aria-label="返回" onClick={() => void exit()}>
            <svg width="22" height="22" viewBox="0 0 24 24"><path d="M15.5 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {mode === 'full' && <span className="lc-top-t">{cur?.title}</span>}
        </div>
        <button className="lc-ic lc-playbtn" aria-label={paused ? '播放' : '暂停'} onClick={toggle}>
          {paused ? <svg width="28" height="28" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" /></svg> : <svg width="28" height="28" viewBox="0 0 24 24"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" /></svg>}
        </button>
        <div className="lc-bar">
          <span className="lc-time">{fmtClock(shownPos)}</span>
          <div className="lc-seek" ref={barRef}
            onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(fracOf(e)); }}
            onPointerMove={(e) => { if (drag !== null) setDrag(fracOf(e)); }}
            onPointerUp={(e) => { if (drag !== null) { seekTo(fracOf(e) * dur); setDrag(null); } }}
            onPointerCancel={() => setDrag(null)}>
            <i style={{ width: `${progPct}%` }} /><b style={{ left: `${progPct}%` }} />
          </div>
          <span className="lc-time">{fmtClock(dur)}</span>
          <button className="lc-ic lc-sm" aria-label="上一个" onClick={() => step(-1)}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2.5v14H6zM9.5 12 19 5v14z" /></svg></button>
          <button className="lc-ic lc-sm" aria-label="下一个" onClick={() => step(1)}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 5H18v14h-2.5zM14.5 12 5 5v14z" /></svg></button>
          {!isMobileApp && (
            <input className="lc-vol" type="range" min={0} max={100} value={Math.round(vol)} aria-label="音量"
              onChange={(e) => { const v = Number(e.target.value); volRef.current = v; setVol(v); void sessRef.current?.set('volume', v); }} />
          )}
          {mode === 'full' && <button className="lc-ic lc-sm" aria-label="定时停止" onClick={() => setSheet(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" /></svg></button>}
          {mode === 'full' && <button className="lc-ic lc-sm" aria-label="熄屏只听声音" onClick={() => setDark(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8M12 17v4" /></svg></button>}
          <button className="lc-ic lc-sm" aria-label={full ? '退出全屏' : '全屏'} onClick={() => void toggleFull()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          </button>
        </div>
      </div>

      {/* 电脑：窗口按钮 */}
      {mode === 'wide' && (
        <div className="lc-head">
          <button className="lc-ic" aria-label="返回" onClick={() => void exit()}>‹</button>
          <span className="lc-head-t">随便看看</span>
          <span style={{ flex: 1 }} />
          {!isMobileApp && (
            <div className="lc-win">
              <button aria-label="最小化" onClick={() => void winMinimize()}>—</button>
              <button aria-label="最大化" onClick={() => void winToggleMax()}>▢</button>
              <button aria-label="关闭" onClick={() => void winClose()}>✕</button>
            </div>
          )}
        </div>
      )}

      {mode === 'portrait' && rect && (
        <div className="lc-low" style={{ top: rect.y + rect.h }}>
          {info}
          {tools}
          <div className="lc-qh"><b>{listTitle}</b><span>{idx + 1} / {order.length}</span></div>
          <div className="lc-qscroll">{queueList}</div>
        </div>
      )}
      {mode === 'wide' && rect && (
        <>
          <div className="lc-main" style={{ left: rect.x, top: rect.y + rect.h, width: rect.w }}>
            {info}
            {tools}
          </div>
          <div className="lc-side" style={{ right: 24, top: rect.y, width: sideW }}>
            <div className="lc-qh"><b>{listTitle}</b><span>{idx + 1} / {order.length}</span></div>
            <div className="lc-qscroll">{queueList}</div>
          </div>
        </>
      )}

      {sheetEl}
      {dark && (
        <div className="lc-dark" onClick={() => setDark(false)}>
          <span>轻触屏幕唤醒</span>
        </div>
      )}
    </div>
  );
}
