// 详情页（剧集）：TheIntroDB 片头数据 —— 看这部剧有没有数据，并可手动扫描
import { useMemo, useState } from 'react';
import type { EmbyItem } from '../emby/types';
import { introDbOn, introStatus, scanSeries, setIntroDbOn } from '../lib/introdb';

export default function IntroDbCard({ tmdbId, eps }: { tmdbId: string; eps: EmbyItem[] }) {
  const [tick, setTick] = useState(0);
  const [on, setOn] = useState(introDbOn);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);
  const [msg, setMsg] = useState('');
  const list = useMemo(() => eps.filter((e) => e.IndexNumber != null).map((e) => ({ season: e.ParentIndexNumber ?? 1, ep: e.IndexNumber as number })), [eps]);
  const st = useMemo(() => {
    let has = 0, none = 0, unk = 0;
    list.forEach((e) => { const x = introStatus(tmdbId, e.season, e.ep); if (x === 'has') has++; else if (x === 'none') none++; else unk++; });
    return { has, none, unk };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, tmdbId, tick]);
  const scan = async (): Promise<void> => {
    setBusy(true); setMsg(''); setProg(0);
    const r = await scanSeries(tmdbId, list, setProg);
    setBusy(false); setTick((n) => n + 1);
    setMsg(r.fail ? `有 ${r.fail} 集查询失败（网络？），可再扫一次` : r.has ? '' : 'TheIntroDB 暂时没有这部剧的数据');
  };
  return (
    <section className="nfd-sec">
      <h3>片头数据 · TheIntroDB</h3>
      <div className="we-introdb">
        <div>
          {!tmdbId ? '这部剧在 Emby 里没有 TMDB 编号，无法查询（可在 Emby 里对它「识别」）。' : (
            <>已收录 <b>{st.has}</b> 集{st.none > 0 && <>，无数据 {st.none} 集</>}{st.unk > 0 && <>，未扫描 {st.unk} 集</>}（共 {list.length} 集）</>
          )}
        </div>
        <div className="we-introdb-act">
          <button disabled={busy || !tmdbId || !list.length} onClick={() => void scan()}>{busy ? `扫描中 ${prog}/${list.length}` : st.unk === list.length ? '扫描本剧片头' : '重新扫描'}</button>
          <label style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setIntroDbOn(e.target.checked); }} /> 播放时自动使用
          </label>
        </div>
        {msg && <div className="muted" style={{ fontSize: 12 }}>{msg}</div>}
      </div>
    </section>
  );
}
