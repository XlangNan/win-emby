// Emby API 里本项目用到的字段子集（其余字段忽略）

export interface UserData {
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
  ColorTransfer?: string;
  IsForced?: boolean;
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
  token: string;
  deviceId: string;
}
