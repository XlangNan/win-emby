// 播放页入口：按设置选内核。MPV 初始化失败（缺 dll、显卡不支持等）时，本次运行内自动改用 HTML5 播放器。
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { isTauri } from '../emby/http';
import { loadPlayPrefs } from '../lib/prefs';
import Html5Player from './Html5Player';
import MpvPlayer from './MpvPlayer';

/** 本次运行里 MPV 已经确认起不来 → 后续不再重试 */
let mpvBroken = '';
const SWITCHED = '已切换到内置播放器';

export default function PlayerPage() {
  const { id = '' } = useParams();
  const [broken, setBroken] = useState(mpvBroken);
  const wantMpv = loadPlayPrefs().engine === 'mpv' && isTauri() && !broken;

  if (wantMpv) {
    return (
      <MpvPlayer
        key={id}
        id={id}
        onFail={(msg) => {
          if (msg !== SWITCHED) mpvBroken = msg;
          setBroken(msg);
        }}
      />
    );
  }
  const notice = broken && broken !== SWITCHED ? `MPV 没能启动，已改用内置播放器：${broken}` : '';
  return <Html5Player key={id} notice={notice} />;
}
