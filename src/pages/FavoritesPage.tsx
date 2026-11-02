import ListPage from './ListPage';
import { emby } from '../emby/client';

export default function FavoritesPage() {
  return (
    <ListPage
      title="我的收藏"
      empty="还没有收藏 —— 在详情页点「收藏」，会同步到 Emby 账号"
      deps={[]}
      load={(start, limit) =>
        emby.items({ types: 'Movie,Series,BoxSet', filters: 'IsFavorite', sortBy: 'SortName', start, limit })
      }
    />
  );
}
