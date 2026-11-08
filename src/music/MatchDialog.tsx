// 匹配 / 编辑 歌词与封面：从 netease-api / Meting 搜索，或手动编辑歌词、选本地图片当封面。只改本机显示。
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { nd, type Song } from './navidrome';
import { fetchCoverData, fetchLyric, imageToData, onlineConfigured, searchOnline, type OnlineHit } from './online';
import { getCoverOverride, getLrcOverride, setCoverOverride, setLrcOverride } from './overrides';
import { toLrc } from './lyrics';
import { toast } from './Dialog';
import { useBackClose } from './useBackClose';

function Box({ s, done }: { s: Song; done: () => void }) {
  const [tab, setTab] = useState<'net' | 'edit'>(onlineConfigured() ? 'net' : 'edit');
  const [q, setQ] = useState(`${s.title} ${s.artist}`.trim());
  const [hits, setHits] = useState<OnlineHit[] | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [text, setText] = useState(getLrcOverride(s.id));
  const file = useRef<HTMLInputElement>(null);
  useBackClose(true, done);
  useEffect(() => {
    const k = (e: KeyboardEvent): void => { if (e.key === 'Escape') done(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [done]);
  useEffect(() => {
    if (text) return;
    let dead = false;
    nd.lyrics(s).then((l) => { if (!dead) setText((t) => t || toLrc(l)); }, () => undefined);
    return () => { dead = true; };
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = (): void => {
    setErr(''); setBusy('search'); setHits(null);
    searchOnline(q).then((r) => { setHits(r); if (!r.length) setErr('没有搜到结果，换个关键词试试'); }, (e: Error) => setErr(e.message)).finally(() => setBusy(''));
  };
  const apply = async (h: OnlineHit, what: 'lrc' | 'cover' | 'all'): Promise<void> => {
    setErr(''); setBusy(h.key + what);
    const ok: string[] = [], bad: string[] = [];
    if (what !== 'cover') { try { setLrcOverride(s.id, await fetchLyric(h)); ok.push('歌词'); } catch (e) { bad.push(`歌词：${(e as Error).message}`); } }
    if (what !== 'lrc') {
      try {
        if (!s.coverArt) throw new Error('这首歌没有封面编号');
        if (!setCoverOverride(s.coverArt, await fetchCoverData(h.pic))) throw new Error('本机存储空间不足');
        ok.push('封面');
      } catch (e) { bad.push(`封面：${(e as Error).message}`); }
    }
    setBusy('');
    if (ok.length) toast(`已更新${ok.join('、')}${bad.length ? '；' + bad.join('；') : ''}`);
    if (bad.length && !ok.length) setErr(bad.join('；'));
    else if (ok.length && !bad.length) done();
  };
  const saveText = (): void => { setLrcOverride(s.id, text); toast(text.trim() ? '歌词已保存（仅本机）' : '已恢复服务器歌词'); done(); };
  const pickFile = (f: File | undefined): void => {
    if (!f) return;
    if (!s.coverArt) { setErr('这首歌没有封面编号'); return; }
    imageToData(f).then((d) => { if (setCoverOverride(s.coverArt, d)) { toast('封面已更新（仅本机）'); done(); } else setErr('本机存储空间不足'); }, () => setErr('这张图片读不出来'));
  };
  const hasCov = !!getCoverOverride(s.coverArt);

  return (
    <div className="mu-dlg-mask mu-scope" onClick={done}>
      <div className="mu-dlg mu-match" role="dialog" aria-label="匹配歌词与封面" onClick={(e) => e.stopPropagation()}>
        <div className="mu-dlg-t">{s.title}<small>{s.artist}</small></div>
        <div className="mu-match-tabs">
          <button type="button" className={tab === 'net' ? 'on' : ''} onClick={() => setTab('net')}>在线匹配</button>
          <button type="button" className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>编辑歌词</button>
        </div>
        {tab === 'net' ? (
          <>
            {!onlineConfigured() && <div className="mu-match-tip">还没有设置在线来源：到「设置 → 音乐选项」填写 netease-api 或 meting-api 的地址。</div>}
            <div className="mu-match-q">
              <input className="mu-dlg-in" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} placeholder="歌名 歌手" />
              <button type="button" className="mu-dlg-btn ok" disabled={busy === 'search'} onClick={search}>{busy === 'search' ? '搜索中' : '搜索'}</button>
            </div>
            {err && <div className="mu-match-err">{err}</div>}
            <div className="mu-match-list">
              {hits?.map((h) => (
                <div key={h.key} className="mu-match-it">
                  <span className="mu-match-pic">{h.pic ? <img src={h.pic} alt="" loading="lazy" referrerPolicy="no-referrer" /> : '♪'}</span>
                  <span className="mu-match-tx"><b>{h.title}</b><i>{[h.artist, h.album].filter(Boolean).join(' · ')}</i></span>
                  <span className="mu-match-ac">
                    {(['lrc', 'cover', 'all'] as const).map((w) => (
                      <button key={w} type="button" disabled={!!busy} onClick={() => { void apply(h, w); }}>{busy === h.key + w ? '…' : w === 'lrc' ? '歌词' : w === 'cover' ? '封面' : '全部'}</button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <textarea className="mu-match-ta" value={text} onChange={(e) => setText(e.target.value)} placeholder="[00:12.30]一行歌词" spellCheck={false} />
            <div className="mu-match-row">
              <button type="button" onClick={() => file.current?.click()}>选择本地图片作封面</button>
              {hasCov && <button type="button" onClick={() => { setCoverOverride(s.coverArt, null); toast('已恢复原封面'); done(); }}>恢复原封面</button>}
              {!!getLrcOverride(s.id) && <button type="button" onClick={() => { setLrcOverride(s.id, null); toast('已恢复服务器歌词'); done(); }}>恢复服务器歌词</button>}
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            {err && <div className="mu-match-err">{err}</div>}
            <div className="mu-dlg-b">
              <button type="button" className="mu-dlg-btn" onClick={done}>取消</button>
              <button type="button" className="mu-dlg-btn ok" onClick={saveText}>保存歌词</button>
            </div>
          </>
        )}
        {tab === 'net' && <div className="mu-dlg-b"><button type="button" className="mu-dlg-btn" onClick={done}>关闭</button></div>}
      </div>
    </div>
  );
}

export function openMatch(s: Song): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const done = (): void => { root.unmount(); host.remove(); };
  root.render(<Box s={s} done={done} />);
}
