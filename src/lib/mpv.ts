// 内嵌 MPV（tauri-plugin-libmpv）的薄封装。
// 原理：mpv 把画面渲染进主窗口里的一个原生子窗口，网页层（透明背景）叠在上面当控制层。
// 所有对 mpv 的操作串行执行：React StrictMode / 切集时 init → destroy → init 不会交错。
import * as lib from 'tauri-plugin-libmpv-api';

interface MpvApi {
  init(cfg: { initialOptions: Record<string, string>; observedProperties: unknown[] }): Promise<unknown>;
  destroy(): Promise<void>;
  command(name: string, args?: string[]): Promise<unknown>;
  getProperty(name: string, type: string): Promise<unknown>;
  observeProperties(props: unknown[], cb: (e: { name: string; data: unknown }) => void): Promise<() => void>;
}

const api = lib as unknown as MpvApi;

/** 要订阅的属性：[名称, 类型, 可选 'none' = 允许为空] */
const OBSERVED: unknown[] = [
  ['pause', 'flag'],
  ['time-pos', 'double', 'none'],
  ['duration', 'double', 'none'],
  ['demuxer-cache-time', 'double', 'none'],
  ['paused-for-cache', 'flag'],
  ['speed', 'double'],
  ['volume', 'double'],
  ['mute', 'flag'],
  ['aid', 'int64', 'none'],
  ['sid', 'int64', 'none'],
  ['eof-reached', 'flag', 'none'],
  ['hwdec-current', 'string', 'none'],
];

let queue: Promise<unknown> = Promise.resolve();
/** 把任务排进串行队列；前一个失败不影响后一个 */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export interface MpvSession {
  loadfile(url: string, opts?: Record<string, string>): Promise<void>;
  /** 设置属性（统一走 `set` 命令，让 mpv 自己解析字符串，避免数值类型不匹配） */
  set(name: string, value: string | number | boolean): Promise<void>;
  cmd(name: string, args?: string[]): Promise<void>;
  get(name: string, type: string): Promise<unknown>;
  close(): Promise<void>;
}

export interface MpvOpenOpts {
  /** 把 HDR 直通给显示器 */
  hdr: boolean;
  onProp: (name: string, data: unknown) => void;
}

export function openMpv(o: MpvOpenOpts): Promise<MpvSession> {
  return enqueue(async () => {
    await api.init({
      initialOptions: {
        // 渲染：libplacebo（gpu-next）+ D3D11，支持 HDR10 / HLG / 杜比视界(P5/P8) 与色调映射
        vo: 'gpu-next',
        'gpu-api': 'd3d11',
        'gpu-context': 'd3d11',
        hwdec: 'auto-safe',
        'target-colorspace-hint': o.hdr ? 'yes' : 'no',
        'hdr-compute-peak': 'yes',
        // 窗口 / 交互：全部交给网页控制层
        'keep-open': 'yes',
        'force-window': 'yes',
        osc: 'no',
        'input-default-bindings': 'no',
        'input-vo-keyboard': 'no',
        'load-scripts': 'no',
        config: 'no',
        ytdl: 'no',
        // 局域网大文件：多缓冲一点
        cache: 'yes',
        'demuxer-max-bytes': '400MiB',
        'demuxer-max-back-bytes': '120MiB',
        'demuxer-readahead-secs': '90',
        // 字幕 / 音频
        'sub-auto': 'no',
        slang: 'chi,zho,chs,cht,zh,eng',
        'sub-font': 'Microsoft YaHei',
        'audio-display': 'no',
      },
      observedProperties: OBSERVED,
    });
    const unlisten = await api.observeProperties(OBSERVED, (e) => o.onProp(e.name, e.data));
    const sess: MpvSession = {
      async loadfile(url, opts = {}) {
        const kv = Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',');
        // mpv ≥ 0.38：loadfile <url> <flags> <index> <options>
        await api.command('loadfile', [url, 'replace', '-1', kv]);
      },
      async set(name, value) {
        await api.command('set', [name, String(value)]);
      },
      async cmd(name, args = []) {
        await api.command(name, args);
      },
      get: (name, type) => api.getProperty(name, type),
      close() {
        return enqueue(async () => {
          try {
            unlisten();
          } catch {
            /* ignore */
          }
          await api.destroy().catch(() => undefined);
        });
      },
    };
    return sess;
  });
}
