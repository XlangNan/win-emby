// 首页「正在一起看」：有人开了公开房间就显示，点卡片加入
import { useEffect, useState } from 'react';
import { emby } from '../emby/client';
import { getSession } from '../emby/session';
import { joinRoom, partyNotice, retain, roomTitle, usePartyStore, type RoomSummary } from '../lib/party';
import { coverUrl } from '../music/navidrome';

export default function PartyRow({ music = false }: { music?: boolean }) {
  const p = usePartyStore();
  useEffect(() => retain(), []);
  const [asking, setAsking] = useState(false);
  const [code, setCode] = useState('');
  if (!p.url) return null;
  const rooms = p.rooms.filter((r) => r.id !== p.room?.id && (music ? r.type === 'music' : r.type !== 'music'));
  if (!rooms.length && !asking) return null;
  const s = getSession();
  const join = async (r: RoomSummary | string): Promise<void> => {
    const id = typeof r === 'string' ? r : r.id;
    if (typeof r !== 'string' && !music) {
      try { await emby.item(r.item.id); } catch { partyNotice('你的账号没有权限观看这部影片'); return; }
    }
    const e = await joinRoom(id);
    if (e) partyNotice(e);
  };
  return (
    <div className="pt-row">
      <div className="pt-head">
        <h3>{music ? '正在一起听' : '正在一起看'}</h3>
        <button type="button" onClick={() => setAsking(!asking)}>{asking ? '收起' : '输入房间号'}</button>
      </div>
      {asking && (
        <div className="we-party-join" style={{ marginBottom: 10, maxWidth: 320 }}>
          <input inputMode="numeric" maxLength={6} placeholder="6 位房间号" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void join(code)} />
          <button type="button" className="we-party-btn" onClick={() => code.length === 6 && void join(code)}>加入</button>
        </div>
      )}
      <div className="pt-cards">
        {rooms.map((r) => (
          <div key={r.id} className="pt-card" role="button" tabIndex={0} onClick={() => void join(r)} onKeyDown={(e) => e.key === 'Enter' && void join(r)}>
            {music ? <img className="pt-sq" loading="lazy" alt="" src={coverUrl(r.item.id, 200)} /> : s && <img loading="lazy" alt="" src={`${s.server}/emby/Items/${r.item.seriesId || r.item.id}/Images/Primary?maxHeight=300&api_key=${s.token}`} />}
            <div>
              <div className="pt-t">{roomTitle(r)}</div>
              <div className="pt-s"><span className="pt-live">{music ? '一起听' : '一起看'}</span>{r.count} 人在{music ? '听' : '看'}</div>
              <div className="pt-s">{r.host} 开的房间{r.paused ? ' · 已暂停' : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
