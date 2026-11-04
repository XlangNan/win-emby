import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { installDragRegion } from './lib/dragRegion';
import { initTheme } from './lib/theme';
import { initFont } from './lib/font';
import './lib/platform';
import './styles/global.css';
import './styles/netflix.css';
import './styles/bilibili.css';
import './styles/apple.css';
import './styles/douban.css';
import './styles/app.css';

// 挂载前先应用皮肤，避免首屏闪烁
initTheme();
initFont();
installDragRegion();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
