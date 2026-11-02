// hls.js 自定义加载器：经 Tauri http 插件（Rust 侧）取 m3u8 / 分片，绕开浏览器 CORS。
// 只用到 hls.js Loader 接口的最小子集：load / abort / destroy / getCacheAge / getResponseHeader。
import type { HlsConfig, LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderStats } from 'hls.js';
import { httpFetch } from './http';

export class TauriLoader {
  context: LoaderContext | null = null;
  stats: LoaderStats;
  private ctrl: AbortController | null = null;

  constructor(_config: HlsConfig) {
    this.stats = {
      aborted: false,
      loaded: 0,
      retry: 0,
      total: 0,
      chunkCount: 0,
      bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, first: 0, end: 0 },
    };
  }

  destroy(): void {
    this.abort();
    this.context = null;
  }

  abort(): void {
    this.stats.aborted = true;
    this.ctrl?.abort();
  }

  getCacheAge(): number | null {
    return null;
  }

  getResponseHeader(_name: string): string | null {
    return null;
  }

  load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
    this.context = context;
    this.ctrl = new AbortController();
    const stats = this.stats;
    stats.loading.start = performance.now();

    const headers: Record<string, string> = {};
    if (context.rangeStart !== undefined && context.rangeEnd !== undefined) {
      headers.Range = `bytes=${context.rangeStart}-${context.rangeEnd - 1}`;
    }

    const timer = setTimeout(() => {
      this.ctrl?.abort();
    }, Math.max(config.timeout || 0, 20000));

    httpFetch(context.url, { method: 'GET', headers, signal: this.ctrl.signal })
      .then(async (res) => {
        stats.loading.first = Math.max(performance.now(), stats.loading.start);
        if (!res.ok) {
          clearTimeout(timer);
          callbacks.onError({ code: res.status, text: res.statusText }, context, res, stats);
          return;
        }
        const data = context.responseType === 'arraybuffer' ? await res.arrayBuffer() : await res.text();
        clearTimeout(timer);
        stats.loading.end = Math.max(performance.now(), stats.loading.first);
        const len = typeof data === 'string' ? data.length : data.byteLength;
        stats.loaded = stats.total = len;
        callbacks.onSuccess({ url: context.url, data }, stats, context, res);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        if (stats.aborted) return;
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        if (aborted) callbacks.onTimeout(stats, context, null);
        else callbacks.onError({ code: 0, text: String(err) }, context, null, stats);
      });
  }
}
