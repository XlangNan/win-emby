# 织影 Weave · Windows 原生版（开发中）

C# + WPF（.NET 8），不用网页界面。和 `src-tauri` 里的网页版互相独立，原生版功能追平之前，网页版继续保留。

## 编译（GitHub Actions）
推送后在 Actions 里运行 `build-windows-native`，下载 `Weave-win-native`，解压后是 `Weave.exe` + `libmpv-2.dll`，两个文件要放在同一个文件夹里。

## 阶段
1. ✅ 骨架：登录 Emby、媒体库、继续观看
2. ✅ 首页、媒体库（排序、滚动加载）、详情页（简介、选集、演职员、收藏、已看）、搜索、设置
3. ✅ 内置播放器（libmpv）：播放 / 暂停 / 进度 / 音量 / 倍速 / 音轨 / 字幕 / 全屏、进度回报、自动下一集、strm 直链换 UA 重试 · 待做：跳过片头、外挂字幕、画面比例
4. 一起看（party-server）
5. 音乐（Navidrome）、一起听、歌词、离线下载（存成真正的文件）
6. 弹幕、直播、追更等其余功能、更多设置
