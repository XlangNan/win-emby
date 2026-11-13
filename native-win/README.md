# 织影 Weave · Windows 原生版（开发中）

C# + WPF（.NET 8），不用网页界面。和 `src-tauri` 里的网页版互相独立，原生版功能追平之前，网页版继续保留。

## 编译（GitHub Actions）
推送后在 Actions 里运行 `build-windows-native`，下载 `Weave-win-native`，里面是单文件 `Weave.exe`（自带运行库，不用另装 .NET）。

## 阶段
1. ✅ 骨架：登录 Emby、媒体库、继续观看
2. ✅ 首页、媒体库（排序、滚动加载）、详情页（简介、选集、演职员、收藏、已看）、搜索、设置
3. 播放页（libmpv：HDR / 杜比视界、音轨字幕、进度回报、跳过片头）—— 现在「播放」是临时方案：交给系统默认播放器
4. 一起看（party-server）
5. 音乐（Navidrome）、一起听、歌词、离线下载（存成真正的文件）
6. 弹幕、直播、追更等其余功能、更多设置
