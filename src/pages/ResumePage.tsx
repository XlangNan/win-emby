// 「继续观看 · 查看全部」：横屏海报网格（和首页那一行同样的样子）
import ListPage from './ListPage';
import { emby } from '../emby/client';

export default function ResumePage() {
  return (
    <ListPage
      title="继续观看"
      empty="没有正在看的内容"
      deps={[]}
      landscape
      inResume
      load={async (start) => {
        if (start > 0) return { Items: [], TotalRecordCount: 0 };   // 一次取完
        const items = await emby.resume(100);
        return { Items: items, TotalRecordCount: items.length };
      }}
    />
  );
}
