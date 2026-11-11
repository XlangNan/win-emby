// 「一起看」的全局部分：房间里换集 / 刚加入时自动跳到对应的播放页；顶部提示条。
import { useEffect, useRef, useState } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { usePartyStore } from '../lib/party';
import { startMusicParty } from '../music/musicParty';

export default function PartyBridge() {
  const p = usePartyStore();
  const nav = useNavigate();
  const loc = useLocation();
  const lastItem = useRef('');
  const isMusic = p.room?.type === 'music';
  const itemId = isMusic ? '' : p.room?.state.item.id || '';
  useEffect(() => startMusicParty(), []);
  const roomId = p.room?.id || '';

  useEffect(() => {
    if (!roomId || isMusic) { lastItem.current = ''; return; }
    if (itemId === lastItem.current) return;
    const inPlayer = matchPath('/player/:id', loc.pathname);
    lastItem.current = itemId;
    if (inPlayer?.params.id === itemId) return;
    nav(`/player/${itemId}`, { replace: !!inPlayer });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, itemId, isMusic]);

  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!p.notice) return;
    setShown(p.notice);
    const t = window.setTimeout(() => setShown(''), 3500);
    return () => window.clearTimeout(t);
  }, [p.noticeAt, p.notice]);
  return shown ? <div className="we-ptoast" role="status">{shown}</div> : null;
}
