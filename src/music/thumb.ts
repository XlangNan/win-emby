// Windows 任务栏缩略图按钮（上一首 / 播放·暂停 / 下一首）的前端一侧；其它平台什么也不做。
interface Handlers { prev: () => void; toggle: () => void; next: () => void }
const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const isWin = (): boolean => typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

let started = false;
let last: boolean | null = null;

export function initThumb(h: Handlers): void {
  if (started || !inTauri() || !isWin()) return;
  started = true;
  void (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');
      await listen('thumb-click', (e: { payload: unknown }) => {
        if (e.payload === 'prev') h.prev();
        else if (e.payload === 'next') h.next();
        else if (e.payload === 'toggle') h.toggle();
      });
      await invoke('thumb_init');
      if (last !== null) await invoke('thumb_playing', { playing: last });
    } catch { started = false; }
  })();
}

export function thumbPlaying(p: boolean): void {
  if (p === last) return;
  last = p;
  if (!started) return;
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('thumb_playing', { playing: p })).catch(() => undefined);
}
