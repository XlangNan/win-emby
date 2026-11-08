// 在线歌词 / 封面来源：NeteaseCloudMusicApi（netease-api）与 Meting API，二选一（都填时优先 netease-api）
import { httpFetch } from '../emby/http';
import { loadOpts } from './prefs';

export interface OnlineHit { key: string; title: string; artist: string; album: string; pic: string; source: 'netease' | 'meting'; id: string; lrc?: string }
const str = (v: unknown): string => (v == null ? '' : String(v));

export const onlineConfigured = (): boolean => !!(loadOpts().neteaseApi || loadOpts().metingApi);

async function getJson<T>(url: string): Promise<T> {
  const res = await httpFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`接口返回 ${res.status}`);
  return (await res.json()) as T;
}
async function getText(url: string): Promise<string> {
  const res = await httpFetch(url);
  if (!res.ok) throw new Error(`接口返回 ${res.status}`);
  return res.text();
}
const withBase = (u: string): string => (/^https?:\/\//i.test(u) ? u : `http://${u}`);

export async function searchOnline(q: string): Promise<OnlineHit[]> {
  const o = loadOpts();
  const kw = q.trim();
  if (!kw) return [];
  if (o.neteaseApi) {
    const base = withBase(o.neteaseApi);
    type R = { result?: { songs?: { id: number; name: string; ar?: { name: string }[]; artists?: { name: string }[]; al?: { name: string; picUrl?: string }; album?: { name: string; picUrl?: string } }[] } };
    let r: R;
    try { r = await getJson<R>(`${base}/cloudsearch?keywords=${encodeURIComponent(kw)}&limit=12`); }
    catch { r = await getJson<R>(`${base}/search?keywords=${encodeURIComponent(kw)}&limit=12`); }
    return (r.result?.songs || []).map((x) => {
      const al = x.al || x.album;
      const pic = al?.picUrl ? `${al.picUrl}${al.picUrl.includes('?') ? '' : '?param=600y600'}` : '';
      return { key: `n${x.id}`, title: x.name, artist: (x.ar || x.artists || []).map((a) => a.name).join(' / '), album: al?.name || '', pic, source: 'netease' as const, id: String(x.id) };
    });
  }
  if (o.metingApi) {
    const b = withBase(o.metingApi);
    const url = `${b}${b.includes('?') ? '&' : '?'}server=netease&type=search&id=${encodeURIComponent(kw)}`;
    const r = await getJson<Record<string, unknown>[]>(url);
    return (Array.isArray(r) ? r : []).map((x, i) => ({
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
