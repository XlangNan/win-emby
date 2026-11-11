// 「一起看」面板：创建房间 / 输入房间号加入 / 房间里的成员和退出。播放页菜单和详情页弹窗共用。
import { useState } from 'react';
import type { EmbyItem } from '../emby/types';
import { createRoom, joinRoom, leaveRoom, partyItemTitle, partyUrl, usePartyStore } from '../lib/party';

interface Opts { pub: boolean; ctl: 'all' | 'host'; wait: boolean }
const OPT_KEY = 'wemby-party-opts';
const loadOpts = (): Opts => {
  try { return { pub: true, ctl: 'all', wait: true, ...(JSON.parse(localStorage.getItem(OPT_KEY) || '{}') as Partial<Opts>) }; } catch { return { pub: true, ctl: 'all', wait: true }; }
};

export default function PartyPanel({ item, getPos, started, onCreated, onClose }: {
  item: EmbyItem | null;
  getPos: () => number;
  /** 播放器已经在出画面（创建房间时按当前位置开始，不让别人等） */
  started: boolean;
  onCreated?: () => void;
  onClose?: () => void;
}) {
  const p = usePartyStore();
  const [o, setO] = useState<Opts>(loadOpts);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const upd = (patch: Partial<Opts>): void => {
    const n = { ...o, ...patch };
    setO(n);
    try { localStorage.setItem(OPT_KEY, JSON.stringify(n)); } catch { /* ignore */ }
  };
  if (!partyUrl()) return <div className="we-party"><div className="we-party-hint">还没有设置一起看服务地址。到「设置 → 一起看」里填上就能用了。</div></div>;
  const room = p.room;

  if (room) {
    const me = p.cid;
    return (
      <div className="we-party">
        <div className="we-party-h">房间号</div>
        <div className="we-party-code" title="点击复制" onClick={() => { try { void navigator.clipboard.writeText(room.id); setMsg('已复制房间号'); } catch { /* ignore */ } }}>{room.id}</div>
        <div className="we-party-sub">{partyItemTitle(room.state.item)} · {room.pub ? '公开' : '私密'} · {room.ctl === 'host' ? '仅房主控制' : '所有人可控制'}{room.wait ? ' · 等待缓冲' : ''}</div>
        <div className="we-party-list">
          {room.members.map((m) => (
            <div key={m.cid} className="we-party-m">
              <span>{m.name}{m.cid === me ? '（我）' : ''}</span>
              {m.cid === room.host && <i>房主</i>}
              {m.buf && <i className="w">加载 / 缓冲中</i>}
            </div>
          ))}
        </div>
        {(msg || p.error) && <div className="we-party-msg">{msg || p.error}</div>}
        <button type="button" className="we-party-btn danger" onClick={() => { void leaveRoom(); onClose?.(); }}>退出房间</button>
      </div>
    );
  }

  const create = async (): Promise<void> => {
    if (!item) return;
    setBusy(true); setMsg('');
    const e = await createRoom(item, { ...o, pos: getPos(), ready: started });
    setBusy(false);
    if (e) setMsg(e); else onCreated?.();
  };
  const join = async (): Promise<void> => {
    if (code.trim().length < 6) { setMsg('请输入 6 位房间号'); return; }
    setBusy(true); setMsg('');
    const e = await joinRoom(code);
    setBusy(false);
    if (e) setMsg(e); else onClose?.();
  };
  return (
    <div className="we-party">
      {item && (
        <>
          <div className="we-party-h">开一个房间，一起看</div>
          <div className="we-party-sub">{item.Type === 'Episode' ? `${item.SeriesName || ''} ` : ''}{item.Name}</div>
          <div className="we-party-row"><span>谁能看到</span>
            <button type="button" className={o.pub ? 'on' : ''} onClick={() => upd({ pub: true })}>公开（出现在首页）</button>
            <button type="button" className={!o.pub ? 'on' : ''} onClick={() => upd({ pub: false })}>私密（凭房间号）</button></div>
          <div className="we-party-row"><span>谁能控制</span>
            <button type="button" className={o.ctl === 'all' ? 'on' : ''} onClick={() => upd({ ctl: 'all' })}>所有人</button>
            <button type="button" className={o.ctl === 'host' ? 'on' : ''} onClick={() => upd({ ctl: 'host' })}>只有我</button></div>
          <div className="we-party-row"><span>有人卡顿</span>
            <button type="button" className={o.wait ? 'on' : ''} onClick={() => upd({ wait: true })}>大家等他</button>
            <button type="button" className={!o.wait ? 'on' : ''} onClick={() => upd({ wait: false })}>不等</button></div>
          <button type="button" className="we-party-btn" disabled={busy} onClick={() => void create()}>创建房间</button>
          <div className="we-party-sep" />
        </>
      )}
      <div className="we-party-h">加入别人的房间</div>
      <div className="we-party-join">
        <input inputMode="numeric" maxLength={6} placeholder="6 位房间号" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void join(); }} />
        <button type="button" className="we-party-btn" disabled={busy} onClick={() => void join()}>加入</button>
      </div>
      {(msg || p.error) && <div className="we-party-msg">{msg || p.error}</div>}
    </div>
  );
}
