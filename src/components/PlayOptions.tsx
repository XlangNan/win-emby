// 详情页「播放选项 + 文件信息」：播放前选版本 / 音轨 / 字幕，并显示大小、帧率、分辨率等文件信息
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { emby } from '../emby/client';
import type { MediaSource, MediaStream } from '../emby/types';
import { isAndroid } from '../lib/platform';
import { loadPlayPrefs } from '../lib/prefs';
import { pickInitialTracks } from '../lib/tracks';
import { useAsync } from '../lib/useAsync';

export interface PlayChoice {
  itemId: string;
  /** 附在 /player/:id 后面的查询串，如 ?src=..&aud=..&sub=.. */
  query: string;
}

const fmtSize = (b?: number): string => {
  if (!b) return '';
  const g = b / 1024 ** 3;
  return g >= 1 ? `${g.toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(0)} MB`;
};
const fmtMbps = (b?: number): string => (b ? `${(b / 1e6).toFixed(1)} Mbps` : '');
const fmtFps = (v?: number): string => (v ? `${Number(v.toFixed(3))} fps` : '');

export function rangeLabel(v?: MediaStream): string {
  if (!v) return '';
  const t = `${v.VideoRangeType || ''} ${v.VideoRange || ''}`.toLowerCase();
  if (t.includes('dovi') || t.includes('dolby')) return '杜比视界';
  if (t.includes('hdr10plus')) return 'HDR10+';
  if (t.includes('hlg')) return 'HLG';
  if (t.includes('hdr10')) return 'HDR10';
  if (t.includes('hdr')) return 'HDR';
  return 'SDR';
}

const audioText = (s: MediaStream): string =>
  s.DisplayTitle || [s.Language, s.Codec?.toUpperCase(), s.Channels ? `${s.Channels}ch` : ''].filter(Boolean).join(' · ') || `音轨 ${s.Index}`;
const subText = (s: MediaStream): string =>
  `${s.DisplayTitle || [s.Language, s.Codec?.toUpperCase()].filter(Boolean).join(' · ') || `字幕 ${s.Index}`}${s.IsExternal ? '（外挂）' : ''}`;

export default function PlayOptions({ itemId, onChange }: { itemId: string; onChange: (c: PlayChoice) => void }) {
  const { data: it } = useAsync(() => emby.item(itemId), [itemId]);
  const [srcId, setSrcId] = useState('');
  const [aud, setAud] = useState('');
  const [sub, setSub] = useState('');
  // 手机：字幕 / 音轨选择放到播放按钮正下方（NfDetail 里的 #nfd-opts-slot），文件信息默认折叠
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (isAndroid) setSlot(document.getElementById('nfd-opts-slot'));
  }, [itemId]);

  const sources: MediaSource[] = it?.MediaSources || [];
  const src = sources.find((s) => s.Id === srcId) || sources[0];
  const streams = useMemo(() => src?.MediaStreams || [], [src]);
  const audios = streams.filter((s) => s.Type === 'Audio');
  const subs = streams.filter((s) => s.Type === 'Subtitle');
  const video = streams.find((s) => s.Type === 'Video');

  // 换片 / 换版本：按「上次用过 / 设置默认」预选
  useEffect(() => {
    if (!src) return;
    const p = pickInitialTracks(itemId, src.MediaStreams || [], loadPlayPrefs());
    setAud(p.audio != null ? String(p.audio) : '');
    setSub(p.sub != null ? String(p.sub) : '');
  }, [itemId, src]);

  useEffect(() => {
    if (!src) return;
    const q = new URLSearchParams();
    if (srcId) q.set('src', srcId);
    if (aud) q.set('aud', aud);
    if (sub) q.set('sub', sub);
    const s = q.toString();
    onChange({ itemId, query: s ? `?${s}` : '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, srcId, aud, sub, src]);

  if (!it || !src) return null;
  const res = video?.Width && video?.Height ? `${video.Width} × ${video.Height}` : '';
  const info: [string, string][] = [
    ['文件大小', fmtSize(src.Size)],
    ['封装', (src.Container || '').split(',')[0].toUpperCase()],
    ['分辨率', res],
    ['帧率', fmtFps(video?.RealFrameRate || video?.AverageFrameRate)],
    ['视频编码', [video?.Codec?.toUpperCase(), video?.Profile].filter(Boolean).join(' ')],
    ['动态范围', rangeLabel(video)],
    ['码率', fmtMbps(src.Bitrate)],
    ['色深', video?.BitDepth ? `${video.BitDepth} bit` : ''],
  ];

  const pickers = (
    <>
      {sources.length > 1 && (
        <div className="we-set-row">
          <span>版本</span>
          <select value={src.Id} onChange={(e) => setSrcId(e.target.value)}>
            {sources.map((s) => {
              const v = s.MediaStreams?.find((x) => x.Type === 'Video');
              return <option key={s.Id} value={s.Id}>{[s.Name || (v?.Height ? `${v.Height}p` : s.Id), rangeLabel(v), fmtSize(s.Size)].filter(Boolean).join(' · ')}</option>;
            })}
          </select>
        </div>
      )}
      <div className="we-set-row">
        <span>音轨</span>
        <select value={aud} onChange={(e) => setAud(e.target.value)}>
          <option value="">跟随默认</option>
          {audios.map((a) => <option key={a.Index} value={a.Index}>{audioText(a)}</option>)}
        </select>
      </div>
      <div className="we-set-row">
        <span>字幕</span>
        <select value={sub} onChange={(e) => setSub(e.target.value)}>
          <option value="">跟随默认</option>
          <option value="-1">不显示字幕</option>
          {subs.map((s) => <option key={s.Index} value={s.Index}>{subText(s)}</option>)}
        </select>
      </div>
    </>
  );

  const mobilePickers = (
    <div className="m-pk">
      {sources.length > 1 && (
        <label className="m-pk-item m-pk-wide">
          <span>版本</span>
          <select value={src.Id} onChange={(e) => setSrcId(e.target.value)}>
            {sources.map((s) => {
              const v = s.MediaStreams?.find((x) => x.Type === 'Video');
              return <option key={s.Id} value={s.Id}>{[s.Name || (v?.Height ? `${v.Height}p` : s.Id), rangeLabel(v), fmtSize(s.Size)].filter(Boolean).join(' · ')}</option>;
            })}
          </select>
        </label>
      )}
      <label className="m-pk-item">
        <span>音轨</span>
        <select value={aud} onChange={(e) => setAud(e.target.value)}>
          <option value="">跟随默认</option>
          {audios.map((a) => <option key={a.Index} value={a.Index}>{audioText(a)}</option>)}
        </select>
      </label>
      <label className="m-pk-item">
        <span>字幕</span>
        <select value={sub} onChange={(e) => setSub(e.target.value)}>
          <option value="">跟随默认</option>
          <option value="-1">不显示字幕</option>
          {subs.map((x) => <option key={x.Index} value={x.Index}>{subText(x)}</option>)}
        </select>
      </label>
    </div>
  );

  const fileInfo = (
    <>
      <div className="we-fileinfo">
        {info.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><div className="muted we-fi-k">{k}</div><div>{v}</div></div>
        ))}
      </div>
      {audios.length > 0 && <div className="muted we-fi-line">音轨：{audios.map(audioText).join(' · ')}</div>}
      {subs.length > 0 && <div className="muted we-fi-line">字幕：{subs.map(subText).join(' · ')}</div>}
      {(src.Path || it.Path) && <div className="muted we-fi-line" style={{ wordBreak: 'break-all' }}>路径：{src.Path || it.Path}</div>}
    </>
  );

  if (isAndroid) {
    return (
      <>
        {slot && createPortal(mobilePickers, slot)}
        <details className="m-fileinfo">
          <summary>媒体文件信息</summary>
          {fileInfo}
        </details>
      </>
    );
  }

  return (
    <div className="card we-set" style={{ marginTop: 14 }}>
      <h3>播放选项</h3>
      {pickers}
      <h3 style={{ marginTop: 14 }}>文件信息</h3>
      {fileInfo}
    </div>
  );
}
