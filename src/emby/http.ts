// 统一的 fetch：桌面端走 Tauri http 插件（Rust 侧发请求，不受 CORS 限制）；
// 浏览器里调试（pnpm web）时退回原生 fetch。
// 安卓端：设置了代理或域名命中自定义 hosts 时，改走 Kotlin 的 AndroidNet（支持 HTTP/SOCKS5 代理和 hosts 强制解析）。
import { hostsMap } from '../lib/net';
import { isAndroid } from '../lib/platform';

type FetchFn = typeof fetch;

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let tauriFetch: Promise<FetchFn> | null = null;

interface NetNative { request(id: string, json: string): void }
type NetWin = Window & { AndroidNet?: NetNative; __netDone?: (id: string, json: string) => void };
const pending = new Map<string, (v: string) => void>();
let seq = 0;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function nativeFetch(input: string, init: RequestInit | undefined, proxy: string, hosts: Record<string, string[]>): Promise<Response> {
  const w = window as NetWin;
  w.__netDone ??= (id, json) => {
    const f = pending.get(id);
    pending.delete(id);
    f?.(json);
  };
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
  let body = '';
  if (init?.body != null) {
    const buf = typeof init.body === 'string' ? new TextEncoder().encode(init.body) : new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
    body = b64(buf);
  }
  const id = `n${++seq}`;
  const done = new Promise<string>((res) => pending.set(id, res));
  w.AndroidNet!.request(id, JSON.stringify({ url: input, method: init?.method || 'GET', headers, body, proxy, hosts }));
  const r = JSON.parse(await done) as { error?: string; status?: number; headers?: Record<string, string>; body?: string };
  if (r.error) throw new Error(r.error);
  const bin = atob(r.body || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const st = r.status || 200;
  return new Response(st === 204 || st === 304 || !bytes.length ? null : bytes, { status: st, headers: r.headers });
}

/** proxy：形如 http://127.0.0.1:7890 或 socks5://127.0.0.1:7891（访问 TMDB 用） */
export async function httpFetch(input: string, init?: RequestInit, opts?: { proxy?: string }): Promise<Response> {
  if (!isTauri()) return fetch(input, init);
  const p = opts?.proxy?.trim();
  if (isAndroid && (window as NetWin).AndroidNet) {
    const hosts = hostsMap();
    let h = '';
    try {
      h = new URL(input).hostname.toLowerCase();
    } catch {
      /* ignore */
    }
    if (p || hosts[h]) return nativeFetch(input, init, p || '', hosts);
  }
  tauriFetch ??= import('@tauri-apps/plugin-http').then((m) => m.fetch as FetchFn);
  const full = p ? ({ ...(init || {}), proxy: { all: p } } as RequestInit) : init;
  return (await tauriFetch)(input, full);
}
