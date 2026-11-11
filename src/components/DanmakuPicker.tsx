// 弹幕「选择弹幕源」：同名电视剧自动匹配错了，就在这里搜一下、自己挑对的那一个（按剧记住，换集不用重选）。
import { useState } from 'react';
import { searchDanmakuAnime, type DanmakuCfg, type DmCand, type DmPick } from '../lib/danmaku';

export default function DanmakuPicker({ cfg, keyword, current, onPick, onClose }: { cfg: DanmakuCfg; keyword: string; current: DmPick | null; onPick: (p: DmPick | null) => void; onClose: () => void }) {
  const [kw, setKw] = useState(keyword);
  const [list, setList] = useState<DmCand[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (): Promise<void> => {
    if (!kw.trim()) return;
    setBusy(true); setErr('');
    try { setList(await searchDanmakuAnime(cfg, kw.trim())); } catch (e) { setErr(e instanceof Error ? e.message : '搜索失败'); setList([]); }
    setBusy(false);
  };
  return (
    <div className="we-dmpick">
      <div className="we-dmpick-h"><span>选择弹幕</span><button type="button" className="we-dmpick-x" onClick={onClose}>返回</button></div>
      <div className="we-dmpick-cur">{current ? <>当前：{current.title}<button type="button" className="we-dmpick-x" onClick={() => onPick(null)}>恢复自动匹配</button></> : '当前：自动匹配'}</div>
      <div className="we-dmpick-s">
        <input value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void go(); }} placeholder="剧名 / 片名" />
        <button type="button" className="we-dmpick-go" disabled={busy} onClick={() => void go()}>{busy ? '搜索中' : '搜索'}</button>
      </div>
      {err && <div className="we-dmpick-m">{err}</div>}
      {list && !list.length && !err && <div className="we-dmpick-m">没有搜到，换个关键词试试</div>}
      <div className="we-dmpick-l">
        {(list || []).map((c) => (
          <div key={c.id} className={`we-dmpick-i${current?.id === c.id ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => onPick({ id: c.id, title: c.title })} onKeyDown={(e) => { if (e.key === 'Enter') onPick({ id: c.id, title: c.title }); }}>
            <b>{c.title}</b><span>{[c.type, c.eps ? `${c.eps} 集` : ''].filter(Boolean).join(' · ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
