// 把片头 / 片尾标记写回 Emby 服务端（需要服务端装了 EmbyStrmIntroMarker 插件，并把对应媒体库勾进白名单）。
// 插件接口：GET /StrmIntroMarker/Episodes?SeasonId=<剧 Id>  /  POST /StrmIntroMarker/Markers/Bulk
import { emby } from '../emby/client';

export interface MarkerSet {
  /** 片头开始 / 结束（秒）；null = 清除；undefined = 保持各集原值 */
  st?: number | null;
  en?: number | null;
  /** 片尾：距每集结尾多少秒开始（每集时长略有不同，按结尾倒数更准）；null = 清除；undefined = 保持原值 */
  tail?: number | null;
}

interface EpDto { Id: string; RuntimeSeconds?: number | null; IntroStart?: number | null; IntroEnd?: number | null; CreditsStart?: number | null }

/** 同步到整部剧的所有集，返回 { applied } 或抛出可读错误 */
export async function syncSeriesMarkers(seriesId: string, m: MarkerSet): Promise<number> {
  let eps: EpDto[];
  try {
    eps = await emby.markerEpisodes(seriesId) as EpDto[];
  } catch {
    throw new Error('服务端没有装「片头标记插件」或没有权限');
  }
  if (!eps.length) throw new Error('插件没找到这部剧：请在插件里把这个媒体库勾进白名单');
  const items = eps.map((e) => {
    const pick = (v: number | null | undefined, old: number | null | undefined): number | null => (v === undefined ? old ?? null : v);
    let credits: number | null;
    if (m.tail === undefined) credits = e.CreditsStart ?? null;
    else if (m.tail === null) credits = null;
    else credits = e.RuntimeSeconds ? Math.max(0, e.RuntimeSeconds - m.tail) : e.CreditsStart ?? null;
    return { ItemId: e.Id, IntroStart: pick(m.st, e.IntroStart), IntroEnd: pick(m.en, e.IntroEnd), CreditsStart: credits };
  });
  const r = await emby.markerBulk(items);
  return r?.AppliedCount ?? items.length;
}
