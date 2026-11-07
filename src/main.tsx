import { installFnImg } from './emby/fnimg';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { installDragRegion } from './lib/dragRegion';
import { applyTheme, initTheme } from './lib/theme';
import { isAndroid } from './lib/platform';
import { initFont } from './lib/font';
import './lib/platform';
import './styles/global.css';
import './styles/netflix.css';
import './styles/app.css';
import './styles/mobile.css';

// 挂载前先应用皮肤，避免首屏闪烁
initTheme();
if (isAndroid) applyTheme('netflix'); // 手机端固定用流媒体风格
initFont();
installDragRegion();
installFnImg();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
