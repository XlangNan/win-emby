import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ListPage from './ListPage';
import { emby, personUrl } from '../emby/client';
import type { EmbyItem } from '../emby/types';

export default function SearchPage() {
  const [sp] = useSearchParams();
  const q = (sp.get('q') || '').trim();
  const nav = useNavigate();
  const [people, setPeople] = useState<EmbyItem[]>([]);
  useEffect(() => {
    setPeople([]);
    if (!q) return;
    let dead = false;
    emby.searchPersons(q, 20).then((r) => !dead && setPeople(r)).catch(() => undefined);
    return () => { dead = true; };
  }, [q]);
  return (
    <ListPage
      title={`搜索：${q}`}
      empty={`没有匹配「${q}」的内容`}
      deps={[q]}
      header={people.length > 0 && (
        <div className="we-sr-people">
          <div className="we-sr-h">演员 / 导演</div>
          <div className="we-sr-row">
            {people.map((p) => (
              <div key={p.Id} className="we-sr-p" role="button" tabIndex={0} onClick={() => nav(`/person/${p.Id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/person/${p.Id}`)}>
                {p.ImageTags?.Primary ? <img src={personUrl({ Id: p.Id, PrimaryImageTag: p.ImageTags.Primary }, 160)} alt="" loading="lazy" /> : <span className="we-sr-ph">{p.Name.slice(0, 1)}</span>}
                <span>{p.Name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      load={(start, limit) =>
        q
          ? emby.items({ search: q, types: 'Movie,Series,BoxSet', sortBy: 'SortName', start, limit })
          : Promise.resolve({ Items: [], TotalRecordCount: 0 })
      }
    />
  );
}
