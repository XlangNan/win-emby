// 本机收听记录：听满一半（或 30 秒）的歌曲记一笔，供首页「今天听了什么」和「本周活动」使用
import type { Song } from '../music/navidrome';

export interface PlayLog { t: number; id: string; title: string; artist: string; album: string; albumId: string; cover: string; sec: number }
const KEY = 'wemby-music-log';

export function readMusicLog(): PlayLog[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]') as PlayLog[]; return Array.isArray(v) ? v : []; } catch { return []; }
}
export function logMusicPlay(s: Song): void {
  try {
    const all = readMusicLog();
    all.push({ t: Date.now(), id: s.id, title: s.title, artist: s.artist, album: s.album, albumId: s.albumId, cover: s.coverArt, sec: Math.round(s.duration || 0) });
    const cut = Date.now() - 30 * 86400000;
    localStorage.setItem(KEY, JSON.stringify(all.filter((x) => x.t > cut).slice(-1500)));
  } catch { /* 存储不可用就不记 */ }
}
