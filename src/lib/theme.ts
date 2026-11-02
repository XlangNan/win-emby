// 皮肤应用：写 <html data-theme / data-base / data-shell / data-detail / data-discover / data-filter>，
// 并把布局度量写成 CSS 变量；global.css 的「宿主结构层」按这些属性生效。
import { useEffect, useState } from 'react';
import { DEFAULT_THEME, normalizeTheme, skinBase, skinLayout, type Theme, type ThemeLayout } from './themeTokens';

export type { Theme };
const KEY = 'wemby-theme';
export const THEME_EVENT = 'wemby:theme-changed';

export function currentTheme(): Theme {
  return normalizeTheme(document.documentElement.getAttribute('data-theme'));
}

function applyLayoutVars(layout: ThemeLayout): void {
  const root = document.documentElement;
  const set = (name: string, px?: number): void => {
    if (typeof px === 'number' && Number.isFinite(px)) root.style.setProperty(name, `${px}px`);
    else root.style.removeProperty(name);
  };
  set('--nav-h', layout.navHeight);
  set('--side-w', layout.sideWidth);
  set('--card-w', layout.cardWidth);
}

export function applyTheme(t: Theme): void {
  const theme = normalizeTheme(t);
  const layout = skinLayout(theme);
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-base', skinBase(theme));
  root.setAttribute('data-shell', layout.shell ?? 'topbar');
  root.setAttribute('data-detail', layout.detailStyle ?? 'basic');
  root.setAttribute('data-discover', layout.discoverStyle ?? 'basic');
  root.setAttribute('data-filter', layout.filterStyle ?? 'plain');
  applyLayoutVars(layout);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function initTheme(): Theme {
  let raw: string = DEFAULT_THEME;
  try {
    raw = localStorage.getItem(KEY) || DEFAULT_THEME;
  } catch {
    /* ignore */
  }
  applyTheme(normalizeTheme(raw));
  return currentTheme();
}

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());
  useEffect(() => {
    const on = (): void => setTheme(currentTheme());
    window.addEventListener(THEME_EVENT, on);
    return () => window.removeEventListener(THEME_EVENT, on);
  }, []);
  return theme;
}

export function useSkinLayout(): ThemeLayout {
  return skinLayout(useTheme());
}
