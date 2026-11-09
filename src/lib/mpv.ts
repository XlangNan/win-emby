// 内嵌 MPV（tauri-plugin-libmpv）的薄封装。
// 原理：mpv 把画面渲染进主窗口里的一个原生子窗口，网页层（透明背景）叠在上面当控制层。
// 所有对 mpv 的操作串行执行：React StrictMode / 切集时 init → destroy → init 不会交错。
import * as lib from 'tauri-plugin-libmpv-api';
import { androidBridge, isIOS } from './platform';

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
  ['container-fps', 'double', 'none'],
  ['width', 'int64', 'none'],
  ['height', 'int64', 'none'],
  ['video-bitrate', 'double', 'none'],
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

/** 安卓：走 Kotlin 桥（android/MpvBridge.kt），接口与桌面端一致 */
function openAndroid(o: MpvOpenOpts): Promise<MpvSession> {
  return enqueue(async () => {
    const b = androidBridge();
    if (!b) throw new Error('没有找到安卓 MPV 桥（应用版本不对？）');
    const w = window as unknown as { __mpvEvt?: (name: string, data: unknown) => void };
    let ready!: () => void;
    const readyP = new Promise<void>((r) => (ready = r));
    w.__mpvEvt = (name, data) => {
      if (name === '__ready') ready();
      else o.onProp(name, data);
    };
    const common = {
      'tone-mapping': 'bt.2390',
      'force-window': 'no',
      idle: 'yes',
      'keep-open': 'yes',
      config: 'no',
      'load-scripts': 'no',
      ytdl: 'no',
      cache: 'yes',
      'demuxer-max-bytes': '64MiB',
      'demuxer-max-back-bytes': '32MiB',
      'demuxer-readahead-secs': '60',
      'sub-auto': 'no',
      slang: 'chi,zho,chs,cht,zh,eng',
      'audio-display': 'no',
      'target-colorspace-hint': o.hdr ? 'yes' : 'no',
    };
    // iOS：MPVKit（MoltenVK + VideoToolbox 硬解），画面层由 Swift 端提供
    const platOpts: Record<string, string> = isIOS
      ? { vo: 'gpu-next', 'gpu-api': 'vulkan', 'gpu-context': 'moltenvk', hwdec: 'videotoolbox' }
      : {
          // gpu-next（libplacebo）负责 HDR → SDR 色调映射和杜比视界重塑；没有就退回 gpu
          vo: 'gpu-next,gpu',
          'gpu-context': 'android',
          'opengl-es': 'yes',
          // copy 模式把画面读回内存再交给 libplacebo，颜色才对（零拷贝模式 HDR 会发灰）
          hwdec: 'mediacodec-copy',
          'hwdec-codecs': 'all',
          ao: 'audiotrack,opensles',
          'sub-fonts-dir': '/system/fonts',
        };
    const r = await b.init(JSON.stringify({ options: { ...common, ...platOpts }, observed: OBSERVED }));
    if (r !== 'ok') throw new Error(r);
    await Promise.race([readyP, new Promise<void>((_, rej) => setTimeout(() => rej(new Error('视频画面层没有就绪（超时）')), 8000))]);
    const call = async (cmd: string[]): Promise<void> => {
      const res = await b.command(JSON.stringify(cmd));
      if (res !== 'ok') throw new Error(res);
    };
    const sess: MpvSession = {
      async loadfile(url, opts = {}) {
        const kv = Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',');
        await call(['loadfile', url, 'replace', '-1', kv]);
      },
      async set(name, value) {
        await call(['set', name, String(value)]);
      },
      async cmd(name, args = []) {
        await call([name, ...args]);
      },
      async get(name, type) {
        try {
          return JSON.parse(await b.getProp(name, type));
        } catch {
          return null;
        }
      },
      close() {
        return enqueue(async () => {
          try {
            b.destroy();
          } catch {
            /* ignore */
          }
          w.__mpvEvt = undefined;
        });
      },
    };
    return sess;
  });
}

export function openMpv(o: MpvOpenOpts): Promise<MpvSession> {
  if (androidBridge()) return openAndroid(o);
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
