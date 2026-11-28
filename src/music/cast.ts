// 投屏会话：管「一台设备上的当前这一首」。队列 / 下一首 / 随机这些仍由 player.ts 负责，
// 这里只做三件事：把一首歌送到设备上播放、每秒问设备进度并转给界面、判断「这首放完了」。
//
// 判断放完（最容易出 BUG 的地方）：
//   · 设备状态变成 STOPPED / NO_MEDIA_PRESENT，并且之前确实 PLAYING 过，并且最后一次进度离总时长不到 6 秒 → 放完了
//   · 如果离结尾还远（有人在电视上按了「停止」）→ 只显示为暂停，不切下一首
//   · 部分设备到结尾后仍然报 PLAYING 且进度不动：连续 4 次进度 ≥ 总时长 -0.5 秒也算放完
//   · 一直没进入 PLAYING（设备不认这个格式）→ 报 format，由播放器改用 MP3 转码重试一次
import { DlnaError, DlnaRenderer, type DlnaDevice } from './dlna';

export interface CastTick { pos: number; dur: number; playing: boolean; loading: boolean }
export interface CastCb {
  tick(t: CastTick): void;
  ended(): void;
  /** format：设备拒绝 / 播不出来这个地址（可换 MP3 重试）；lost：连不上设备 */
  failed(kind: 'format' | 'lost', msg: string): void;
  /** 设备当前音量 0-100（刚连上时读一次） */
  volume?(v: number): void;
  /** 不致命的提示（比如这台设备不支持拖动进度） */
  notice?(msg: string): void;
}
export interface CastOpts { pollMs?: number; graceMs?: number }

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

export class CastSession {
  readonly r: DlnaRenderer;
  private tok = 0;                       // 每装载一首 / 停止 +1，旧操作据此作废
  private cmd = 0;                       // 每次用户操作 +1，操作前发出的轮询结果作废
  private q: Promise<unknown> = Promise.resolve();   // 控制命令按顺序一条条发，避免「先发后到」
  private inflight = 0;
  private quietUntil = 0;
  private polling = false;
  private disposed = false;
  private timer = 0;
  private itimer = 0;
  private readonly pollMs: number;
  private readonly graceMs: number;

  private seen = false;                  // 这一首在设备上确实进入过 PLAYING
  private done = false;                  // 这一首已判定放完（等播放器装载下一首）
  private wantPlay = false;
  private t0 = 0;
  private lastPos = 0;                   // 最后一次 PLAYING 时的进度
  private dur = 0;
  private expectDur = 0;
  private base = 0;                      // 进度插值：base + 经过的时间
  private baseAt = 0;
  private playingNow = false;
  private loadingNow = false;
  private pendingSeek: number | null = null;
  private fails = 0;
  private stuck = 0;
  private rs = '';                       // 最近一次轮询到的设备状态
  private volSynced = false;
  private volTimer = 0;

  constructor(readonly dev: DlnaDevice, private cb: CastCb, o: CastOpts = {}) {
    this.r = new DlnaRenderer(dev);
    this.pollMs = o.pollMs ?? 1000;
    this.graceMs = o.graceMs ?? 9000;
  }

  private now(): number { return Date.now(); }
  private curPos(): number {
    // 设备还没真正开始播（没进入过 PLAYING）时不插值，免得进度条先往前跑
    const p = this.playingNow && this.seen ? this.base + (this.now() - this.baseAt) / 1000 : this.base;
    const d = this.dur || this.expectDur;
    return Math.max(0, d > 0 ? Math.min(p, d) : p);
  }
  private emitTick(): void {
    if (this.disposed) return;
    this.cb.tick({ pos: this.curPos(), dur: this.dur || this.expectDur, playing: this.playingNow, loading: this.loadingNow });
  }
  private startTimers(): void {
    if (this.disposed) return;
    if (!this.timer) this.timer = window.setInterval(() => { void this.poll(); }, this.pollMs);
    if (!this.itimer) this.itimer = window.setInterval(() => this.emitTick(), 250);
  }
  private stopTimers(): void {
    if (this.timer) { window.clearInterval(this.timer); this.timer = 0; }
    if (this.itimer) { window.clearInterval(this.itimer); this.itimer = 0; }
  }

  /** 控制命令排队执行；tok 过期的命令在轮到它时直接丢弃 */
  private run<T>(tok: number, fn: () => Promise<T>): Promise<T | undefined> {
    this.inflight++;
    const p = this.q.then(async () => (tok !== this.tok || this.disposed ? undefined : fn()));
    this.q = p.catch(() => undefined);
    return p.finally(() => { this.inflight--; this.quietUntil = this.now() + 700; });
  }

  private async playRetry(tok: number): Promise<void> {
    let err: unknown;
    for (let i = 0; i < 4; i++) {
      if (tok !== this.tok || this.disposed) return;
      try { await this.r.play(); return; }
      catch (e) {
        err = e;
        // 701 / 705：设备刚收到地址还在准备，稍等再 Play；其它错误直接抛
        if (!(e instanceof DlnaError) || (e.code !== 701 && e.code !== 705)) throw e;
        await sleep(500);
      }
    }
    throw err;
  }

  private fail(e: unknown, tok: number): void {
    if (tok !== this.tok || this.disposed) return;
    this.stopTimers();
    this.loadingNow = false; this.playingNow = false;
    const code = e instanceof DlnaError ? e.code : 0;
    const msg = e instanceof Error ? e.message : String(e);
    // 设备明确回了 UPnP 错误（多半是不认这个格式 / 地址）→ format；网络层失败 → lost
    this.cb.failed(code > 0 ? 'format' : 'lost', msg);
  }

  /** 装载并（可选）播放一首歌 */
  async load(url: string, didl: string, o: { dur: number; start: number; autoplay: boolean }): Promise<void> {
    if (this.disposed) return;
    const tok = ++this.tok;
    this.cmd++;
    this.seen = false; this.done = false; this.stuck = 0; this.fails = 0;
    this.wantPlay = o.autoplay; this.t0 = this.now(); this.lastPos = 0; this.rs = '';
    this.dur = 0; this.expectDur = o.dur > 0 ? o.dur : 0;
    this.base = o.start > 0 ? o.start : 0; this.baseAt = this.now();
    this.pendingSeek = o.start > 1 ? o.start : null;
    this.playingNow = o.autoplay; this.loadingNow = true;
    this.startTimers();
    this.emitTick();
    try {
      await this.run(tok, () => this.r.setUri(url, didl));
      if (tok !== this.tok) return;
      if (o.autoplay) await this.run(tok, () => this.playRetry(tok));
      if (tok !== this.tok) return;
      if (!this.volSynced) {
        this.volSynced = true;
        void this.r.getVolume().then((v) => { if (v != null && !this.disposed) this.cb.volume?.(v); });
      }
    } catch (e) { this.fail(e, tok); }
  }

  play(): Promise<void> {
    const tok = this.tok;
    this.cmd++;
    if (this.done || this.rs === 'STOPPED' || this.rs === 'NO_MEDIA_PRESENT') {
      // 设备已停（放完 / 被停止）：Play 会从头开始
      this.done = false; this.seen = false; this.lastPos = 0; this.stuck = 0; this.t0 = this.now(); this.pendingSeek = null;
      this.base = 0; this.baseAt = this.now();
      this.startTimers();
    } else { this.base = this.curPos(); this.baseAt = this.now(); }
    this.wantPlay = true; this.playingNow = true; this.loadingNow = !this.seen;
    this.emitTick();
    return this.run(tok, () => this.playRetry(tok)).then(() => undefined).catch((e) => { this.fail(e, tok); });
  }

  pause(): Promise<void> {
    const tok = this.tok;
    this.cmd++;
    this.base = this.curPos(); this.baseAt = this.now();
    this.wantPlay = false; this.playingNow = false; this.loadingNow = false;
    this.emitTick();
    return this.run(tok, () => this.r.pause()).then(() => undefined).catch((e) => { this.cb.notice?.(e instanceof Error ? e.message : '暂停失败'); });
  }

  seek(t: number): Promise<void> {
    const tok = this.tok;
    this.cmd++;
    const d = this.dur || this.expectDur;
    const to = Math.max(0, d > 0 ? Math.min(t, Math.max(0, d - 1)) : t);
    this.base = to; this.baseAt = this.now();
    this.emitTick();
    if (!this.seen) { this.pendingSeek = to; return Promise.resolve(); }   // 还没开始播：等进入播放 / 暂停后再跳
    this.lastPos = to;
    return this.run(tok, () => this.r.seek(to)).then(() => undefined).catch(() => { this.cb.notice?.('这台设备不支持拖动进度'); });
  }

  /** 音量 0-100，连续拖动时合并成最后一次 */
  setVolume(v: number): void {
    window.clearTimeout(this.volTimer);
    this.volTimer = window.setTimeout(() => { this.r.setVolume(v).catch((e) => this.cb.notice?.(e instanceof Error ? e.message : '调音量失败')); }, 150);
  }

  private finish(): void {
    if (this.done) return;
    this.done = true; this.playingNow = false; this.loadingNow = false;
    this.stopTimers();
    this.cb.ended();
  }

  private async poll(): Promise<void> {
    if (this.polling || this.disposed || this.done || this.inflight > 0 || this.now() < this.quietUntil) return;
    this.polling = true;
    const tok = this.tok, cmd = this.cmd;
    try {
      const st = await this.r.state();
      const pi = await this.r.position().catch(() => ({ pos: NaN, dur: 0 }));
      if (tok !== this.tok || cmd !== this.cmd || this.disposed) return;
      this.fails = 0;
      this.onPolled(st, pi.pos, pi.dur);
    } catch (e) {
      if (tok !== this.tok || this.disposed) return;
      if (++this.fails >= 4) this.fail(e, tok);
    } finally { this.polling = false; }
  }

  private onPolled(st: string, pos: number, dur: number): void {
    this.rs = st;
    const playing = st === 'PLAYING';
    const known = Number.isFinite(pos);
    if (playing) this.seen = true;
    if (dur > 0) this.dur = dur;
    const d = this.dur || this.expectDur;

    // 进入播放 / 暂停后，补做之前排队的跳转
    if (this.pendingSeek != null && (playing || st === 'PAUSED_PLAYBACK')) {
      const t = this.pendingSeek;
      this.pendingSeek = null;
      this.base = t; this.baseAt = this.now(); this.lastPos = t;
      this.playingNow = playing; this.loadingNow = false;
      const tok = this.tok;
      void this.run(tok, () => this.r.seek(t)).catch(() => { this.cb.notice?.('这台设备不支持拖动进度'); });
      this.emitTick();
      return;
    }

    if (playing && known) this.lastPos = pos;
    if (known && (playing || st === 'PAUSED_PLAYBACK')) { this.base = pos; this.baseAt = this.now(); }

    // 放完了
    if (this.seen && (st === 'STOPPED' || st === 'NO_MEDIA_PRESENT')) {
      if (d <= 0 || this.lastPos >= d - 6) { this.finish(); return; }
      this.wantPlay = false;   // 离结尾还远：是有人在设备上按了停止，保持连接、显示暂停
    }
    if (playing && known && d > 0 && pos >= d - 0.5) { if (++this.stuck >= 4) { this.finish(); return; } } else this.stuck = 0;

    // 设备明确出错 / 一直没开始播
    if (!this.seen && this.wantPlay) {
      if (st === 'ERROR_OCCURRED' || ((st === 'STOPPED' || st === 'NO_MEDIA_PRESENT') && this.now() - this.t0 > this.graceMs)) {
        this.fail(new DlnaError('设备没能开始播放这首歌', 1), this.tok);
        return;
      }
    }

    // 设备上被人暂停 / 继续了，界面跟着变
    if (this.seen) this.wantPlay = playing || st === 'TRANSITIONING';
    this.playingNow = playing || (st === 'TRANSITIONING' && this.wantPlay);
    this.loadingNow = st === 'TRANSITIONING' || (!this.seen && this.wantPlay);
    this.emitTick();
  }

  /** 结束并让设备停止（用户断开投屏） */
  async stop(): Promise<void> {
    this.dispose();
    try { await this.r.stop(); } catch { /* 设备已经不在了 */ }
  }
  /** 只丢弃本地状态，不通知设备（切换到另一台设备时用） */
  dispose(): void {
    this.disposed = true;
    this.tok++; this.cmd++;
    window.clearTimeout(this.volTimer);
    this.stopTimers();
  }
}
