import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { installDragRegion } from './lib/dragRegion';
import { installKeyboardAware } from './lib/keyboard';
import { installWinFit } from './lib/win';
import { applyTheme, initTheme } from './lib/theme';
import { isMobileApp } from './lib/platform';
import { initFont } from './lib/font';
import { initMode } from './lib/mode';
import { startSync } from './sync/sync';
import './lib/platform';
import './styles/global.css';
import './styles/netflix.css';
import './styles/app.css';
import './styles/mobile.css';
import './styles/music.css';
import './styles/ed.css';
import './styles/abs.css';
import './styles/local.css';
import './styles/cfg.css';
import './styles/dash.css';
import './styles/tablet.css';
import './styles/light.css';
import './styles/noir.css'; // 黑金皮肤：放最后，修饰规则才能盖过结构层
import './styles/refresh.css'; // 电脑版首页 / 影视界面重做（只覆盖，不改原文件）
import './styles/jade.css'; // 织绿皮肤（侧栏 + 翠绿令牌），只在 data-theme='jade' 下生效

// 挂载前先应用皮肤，避免首屏闪烁
initTheme();
if (isMobileApp) applyTheme('netflix'); // 手机端固定用流媒体风格
initFont();
initMode();
installDragRegion();
if (isMobileApp) installKeyboardAware();
installWinFit();
startSync();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
