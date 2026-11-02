// 播放页公用：影片详情 + 同剧集全部单集（用来找下一集 / 选集抽屉）
import { useEffect, useState } from 'react';
import { emby } from '../emby/client';
import type { EmbyItem } from '../emby/types';

export function usePlayItem(id: string): {
  item: EmbyItem | null;
  episodes: EmbyItem[];
  nextEp: EmbyItem | null;
  error: string;
} {
  const [item, setItem] = useState<EmbyItem | null>(null);
  const [episodes, setEpisodes] = useState<EmbyItem[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let dead = false;
    setItem(null);
    setEpisodes([]);
    setError('');
    emby
      .item(id)
      .then(async (it) => {
        if (dead) return;
        setItem(it);
        if (it.Type === 'Episode' && it.SeriesId) {
          const all = await emby.episodes(it.SeriesId).catch(() => [] as EmbyItem[]);
          if (!dead) setEpisodes(all);
        }
      })
      .catch((e: unknown) => !dead && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
    };
  }, [id]);

  const i = episodes.findIndex((e) => e.Id === id);
  const nextEp = i >= 0 ? episodes[i + 1] || null : null;
  return { item, episodes, nextEp, error };
}
