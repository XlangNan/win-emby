// 告诉 Emby「这个客户端（WebView2 / Chromium）能直接播什么」，由服务器决定直连 / 转封装 / 转码。
import type { PlayPrefs } from '../lib/prefs';

export function buildDeviceProfile(p: PlayPrefs): Record<string, unknown> {
  const videoCodecs = ['h264', 'vp8', 'vp9', 'av1', ...(p.hevc ? ['hevc'] : [])].join(',');
  const maxBps = p.maxMbps > 0 ? p.maxMbps * 1_000_000 : 200_000_000;
  return {
    Name: 'Win-Emby',
    MaxStreamingBitrate: maxBps,
    MaxStaticBitrate: maxBps,
    MusicStreamingTranscodingBitrate: 192000,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v,mov', Type: 'Video', VideoCodec: videoCodecs, AudioCodec: 'aac,mp3,opus,flac,vorbis' },
      { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'vorbis,opus' },
    ],
    TranscodingProfiles: [
      {
        Container: 'ts',
        Type: 'Video',
        Protocol: 'hls',
        Context: 'Streaming',
        VideoCodec: p.hevc ? 'h264,hevc' : 'h264',
        AudioCodec: 'aac,mp3',
        MaxAudioChannels: '6',
        MinSegments: '1',
        BreakOnNonKeyFrames: true,
      },
    ],
    CodecProfiles: [
      {
        Type: 'Video',
        Codec: 'h264',
        Conditions: [{ Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false }],
      },
    ],
    // 文本字幕走外挂 WebVTT；图片字幕（PGS/VobSub）不在此列 → 服务器会按需烧录
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'External' },
      { Format: 'srt', Method: 'External' },
      { Format: 'ass', Method: 'External' },
      { Format: 'ssa', Method: 'External' },
      { Format: 'subrip', Method: 'External' },
    ],
    ResponseProfiles: [{ Type: 'Video', Container: 'm4v', MimeType: 'video/mp4' }],
  };
}
