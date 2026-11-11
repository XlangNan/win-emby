// Emby API 里本项目用到的字段子集（其余字段忽略）

export interface UserData {
  LastPlayedDate?: string;
  PlaybackPositionTicks?: number;
  PlayedPercentage?: number;
  Played?: boolean;
  IsFavorite?: boolean;
  UnplayedItemCount?: number;
  PlayCount?: number;
}

export interface Person {
  Id: string;
  Name: string;
  Role?: string;
  Type?: string;
  PrimaryImageTag?: string;
}

export interface MediaStream {
  Index: number;
  Type: 'Video' | 'Audio' | 'Subtitle' | 'EmbeddedImage' | string;
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  Title?: string;
  IsDefault?: boolean;
  IsExternal?: boolean;
  IsTextSubtitleStream?: boolean;
  Width?: number;
  Height?: number;
  Channels?: number;
  BitRate?: number;
  VideoRange?: string;
  VideoRangeType?: string;
  ExtendedVideoSubType?: string;
  ExtendedVideoSubTypeDescription?: string;
  DvProfile?: number;
  ColorTransfer?: string;
  IsForced?: boolean;
  RealFrameRate?: number;
  AverageFrameRate?: number;
  BitDepth?: number;
  Profile?: string;
  ChannelLayout?: string;
  SampleRate?: number;
}

export interface MediaSource {
  Id: string;
  Name?: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  RunTimeTicks?: number;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  DirectStreamUrl?: string;
  TranscodingUrl?: string;
  TranscodingSubProtocol?: string;
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
  MediaStreams?: MediaStream[];
  Path?: string;
  /** strm / 网络源：Emby 记的是远端地址，客户端可以直接去取 */
  Protocol?: string;
  IsRemote?: boolean;
  Chapters?: Chapter[];
}

export interface Chapter {
  StartPositionTicks: number;
  Name?: string;
  MarkerType?: string;
}

export interface EmbyItem {
  Id: string;
  Name: string;
  Type: string; // Movie | Series | Season | Episode | BoxSet | CollectionFolder | ...
  CollectionType?: string;
  ProductionYear?: number;
  PremiereDate?: string;
  Overview?: string;
  Taglines?: string[];
  CommunityRating?: number;
  OfficialRating?: string;
  RunTimeTicks?: number;
  Genres?: string[];
  Studios?: { Name: string }[];
  People?: Person[];
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  ParentBackdropImageTags?: string[];
  SeriesId?: string;
  ProviderIds?: Record<string, string>;
  OriginalTitle?: string;
  SeriesName?: string;
  SeriesPrimaryImageTag?: string;
  SeasonId?: string;
  SeasonName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ChildCount?: number;
  RecursiveItemCount?: number;
  UserData?: UserData;
  MediaSources?: MediaSource[];
  MediaStreams?: MediaStream[];
  Path?: string;
  Chapters?: Chapter[];
}

export interface ItemsResult {
  Items: EmbyItem[];
  TotalRecordCount: number;
}

export interface PlaybackInfo {
  MediaSources: MediaSource[];
  PlaySessionId?: string;
}

export interface Session {
  /** 形如 http://192.168.1.5:8096（不含 /emby） */
  server: string;
  userId: string;
  userName: string;
  serverName?: string;
  token: string;
  deviceId: string;
}
