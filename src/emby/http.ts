// 统一的 fetch：桌面端走 Tauri http 插件（Rust 侧发请求，不受 CORS 限制）；
// 浏览器里调试（pnpm web）时退回原生 fetch。
type FetchFn = typeof fetch;

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let tauriFetch: Promise<FetchFn> | null = null;

/** proxy：形如 http://127.0.0.1:7890，只在桌面端生效（访问 TMDB 用） */
export async function httpFetch(input: string, init?: RequestInit, opts?: { proxy?: string }): Promise<Response> {
  if (!isTauri()) return fetch(input, init);
  tauriFetch ??= import('@tauri-apps/plugin-http').then((m) => m.fetch as FetchFn);
  const p = opts?.proxy?.trim();
  const full = p ? ({ ...(init || {}), proxy: { all: p } } as RequestInit) : init;
  return (await tauriFetch)(input, full);
}
