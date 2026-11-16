// 用本机安装的 VLC 播放当前片源（电脑版；MPV 读不了的 strm 直链兜底）
export async function openVlc(url: string, startSec: number, title: string): Promise<string> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_vlc', { url, start: startSec, title });
    return '';
  } catch (e) {
    return typeof e === 'string' ? e : e instanceof Error ? e.message : '启动 VLC 失败';
  }
}
