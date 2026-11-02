// 窗口控制（Tauri）。浏览器里调试时退化为无操作 / 浏览器全屏。
import { isTauri } from '../emby/http';

async function cur() {
  const m = await import('@tauri-apps/api/window');
  return m.getCurrentWindow();
}

export async function winMinimize(): Promise<void> {
  if (isTauri()) await (await cur()).minimize();
}

export async function winToggleMax(): Promise<boolean> {
  if (!isTauri()) return false;
  const w = await cur();
  await w.toggleMaximize();
  return w.isMaximized();
}

export async function winIsMaximized(): Promise<boolean> {
  return isTauri() ? (await cur()).isMaximized() : false;
}

export async function winClose(): Promise<void> {
  if (isTauri()) await (await cur()).close();
  else window.close();
}

export async function winStartDrag(): Promise<void> {
  if (isTauri()) await (await cur()).startDragging();
}

export async function winSetFullscreen(on: boolean): Promise<void> {
  if (isTauri()) {
    await (await cur()).setFullscreen(on);
    return;
  }
  if (on) await document.documentElement.requestFullscreen?.().catch(() => undefined);
  else if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
}

export async function winIsFullscreen(): Promise<boolean> {
  return isTauri() ? (await cur()).isFullscreen() : !!document.fullscreenElement;
}
