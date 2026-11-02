// 统一的 fetch：桌面端走 Tauri http 插件（Rust 侧发请求，不受 CORS 限制）；
// 浏览器里调试（pnpm web）时退回原生 fetch。
type FetchFn = typeof fetch;

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let tauriFetch: Promise<FetchFn> | null = null;

export async function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!isTauri()) return fetch(input, init);
  tauriFetch ??= import('@tauri-apps/plugin-http').then((m) => m.fetch as FetchFn);
  return (await tauriFetch)(input, init);
}
