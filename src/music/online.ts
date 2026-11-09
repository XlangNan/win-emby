// 在线歌词 / 封面来源：NeteaseCloudMusicApi（netease-api）与 Meting API，二选一（都填时优先 netease-api）
import { httpFetch } from '../emby/http';
import { loadOpts } from './prefs';

export interface OnlineHit { key: string; title: string; artist: string; album: string; dur?: number; pic: string; source: 'netease' | 'meting'; id: string; lrc?: string }
const str = (v: unknown): string => (v == null ? '' : String(v));

export const onlineConfigured = (): boolean => !!(loadOpts().neteaseApi || loadOpts().metingApi);

/** 带超时的请求：12 秒没响应就报错，并把具体地址写进错误里，方便判断是哪里不通 */
async function req(url: string): Promise<Response> {
  const ctl = new AbortController();
  const tm = window.setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await httpFetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`接口返回 ${res.status}（${shortUrl(url)}）`);
    return res;
  } catch (e) {
    if (e instanceof Error && /接口返回/.test(e.message)) throw e;
    throw new Error(`连不上 ${shortUrl(url)}：${e instanceof Error ? e.message : String(e)}`);
  } finally { window.clearTimeout(tm); }
}
const shortUrl = (u: string): string => u.replace(/\?.*$/, '');
async function getJson<T>(url: string): Promise<T> {
  const res = await req(url);
  const t = await res.text();
  try { return JSON.parse(t) as T; } catch { throw new Error(`返回的不是 JSON（${shortUrl(url)}）：${t.slice(0, 60)}`); }
}
async function getText(url: string): Promise<string> { return (await req(url)).text(); }
/** 补 http://，去掉末尾斜杠；如果粘贴成了完整接口地址（/search、/cloudsearch、/lyric…）也截回根地址 */
const withBase = (u: string): string => {
  let s = u.trim();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s.replace(/\/(cloudsearch|search|lyric|song\/detail)\/?(\?.*)?$/i, '').replace(/\/+$/, '');
};

export async function searchOnline(q: string): Promise<OnlineHit[]> {
  const o = loadOpts();
  const kw = q.trim();
  if (!kw) return [];
  if (o.neteaseApi) {
    const base = withBase(o.neteaseApi);
    type R = { result?: { songs?: { id: number; name: string; ar?: { name: string }[]; artists?: { name: string }[]; dt?: number; al?: { name: string; picUrl?: string }; album?: { name: string; picUrl?: string } }[] } };
    let r: R;
    try { r = await getJson<R>(`${base}/cloudsearch?keywords=${encodeURIComponent(kw)}&limit=12`); }
    catch (e1) {
      try { r = await getJson<R>(`${base}/search?keywords=${encodeURIComponent(kw)}&limit=12`); }
      catch { throw e1; }
    }
    return (r.result?.songs || []).map((x) => {
      const al = x.al || x.album;
      const pic = al?.picUrl ? `${al.picUrl}${al.picUrl.includes('?') ? '' : '?param=600y600'}` : '';
      return { key: `n${x.id}`, title: x.name, artist: (x.ar || x.artists || []).map((a) => a.name).join(' / '), album: al?.name || '', dur: x.dt ? x.dt / 1000 : undefined, pic, source: 'netease' as const, id: String(x.id) };
    });
  }
  if (o.metingApi) {
    const b = o.metingApi.trim().replace(/^(?!https?:\/\/)/i, 'http://');
    const url = `${b}${b.includes('?') ? '&' : '?'}server=netease&type=search&id=${encodeURIComponent(kw)}`;
    const raw = await getJson<Record<string, unknown>[] | { data?: Record<string, unknown>[] }>(url);
    const r = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
    return r.map((x, i) => ({
      key: `m${i}`, title: str(x.title || x.name), artist: str(x.author || x.artist), album: '', pic: str(x.pic), source: 'meting' as const, id: str(x.id || x.songid || ''), lrc: str(x.lrc),
    }));
  }
  throw new Error('还没有设置在线来源：到「设置 → 音乐选项」里填写 netease-api 或 meting-api 的地址');
}

export async function fetchLyric(h: OnlineHit): Promise<string> {
  const o = loadOpts();
  if (h.source === 'netease') {
    const r = await getJson<{ lrc?: { lyric?: string } }>(`${withBase(o.neteaseApi)}/lyric?id=${encodeURIComponent(h.id)}`);
    const t = str(r.lrc?.lyric);
    if (!t.trim()) throw new Error('这首歌在网易云上没有歌词');
    return t;
  }
  const l = h.lrc || '';
  let t = '';
  if (/^https?:\/\//i.test(l)) t = await getText(l);
  else if (l.includes('[')) t = l;
  else if (h.id) { const b = withBase(o.metingApi); t = await getText(`${b}${b.includes('?') ? '&' : '?'}server=netease&type=lrc&id=${encodeURIComponent(h.id)}`); }
  if (!t.trim()) throw new Error('没有取到歌词');
  return t;
}

/** 下载封面并缩小成 JPEG（≤500px）的 data URL，保存在本机，之后不依赖外网 */
export async function fetchCoverData(url: string): Promise<string> {
  if (!url) throw new Error('这条结果没有封面');
  const res = await httpFetch(url);
  if (!res.ok) throw new Error(`封面下载失败 ${res.status}`);
  return imageToData(await res.blob());
}
export async function imageToData(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 500 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.86);
}
