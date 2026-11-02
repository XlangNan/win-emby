# Win-Emby

局域网 Emby 桌面播放器（Windows）。由 [Win-box](https://github.com/yagami-hue/Win-box) 重构而来：去掉了 TVBox 站源 / 蜘蛛 / 网盘 / 磁力 / 弹幕 / 插件等全部旧功能，只保留「连接 Emby 播放」，**界面沿用原来的四套皮肤**（网飝 / 哔哔 / 大果 / 大豆）。

框架从 Electron 换成 **Tauri 2**（系统自带 WebView2），安装包和内存占用都小很多。

## 功能

- 登录 Emby（地址 + 账号密码，只保存 token）
- 首页：最近添加聚光卡、继续观看、下一集、各媒体库最近添加
- 媒体库：排序 / 类型 / 未看 / 已看 / 收藏筛选，分页加载
- 详情：简介、季与单集列表（带剧照和进度）、演职员、相关推荐、收藏、标记已看
- 播放（默认内嵌 MPV）：mpv 直接解码原文件，支持 HDR10 / HLG / 杜比视界、MKV、DTS / TrueHD；返回按钮、简介 / 演职员 / 选集抽屉、音轨与字幕切换（含外挂字幕）、倍速、自动下一集
- 备用内核：内置网页播放器（`<video>` + hls.js，由 Emby 转封装 / 转码）；MPV 起不来时自动改用它
- 进度与 Emby 账号双向同步（和其它 Emby 客户端互通）
- 搜索、收藏、观看历史
- 四套皮肤切换（设置页）

快捷键（播放页）：空格 播放/暂停，←/→ 快退/快进 10 秒（Shift 为 30 秒），↑/↓ 音量，F 全屏，M 静音，N 下一集，I 信息抽屉，Esc 返回。

**HDR / 杜比视界**：想让显示器真的亮起 HDR，需要在 Windows「设置 → 显示 → 使用 HDR」里打开；没打开时 mpv 会把 HDR 片源自动映射成 SDR，颜色不会发灰。杜比视界 Profile 5 / 8 正常显示；Profile 7（蓝光原盘双层）只显示基础层。

## 本地运行 / 打包（Windows，复制粘贴）

### 1. 装环境（只需一次）

装 [Node.js 20+](https://nodejs.org/zh-cn)，再装 Visual Studio Build Tools（勾选「使用 C++ 的桌面开发」），然后在 PowerShell 里：

```powershell
npm i -g pnpm --registry=https://registry.npmmirror.com
$env:RUSTUP_DIST_SERVER="https://rsproxy.cn"
$env:RUSTUP_UPDATE_ROOT="https://rsproxy.cn/rustup"
Invoke-WebRequest https://rsproxy.cn/rustup-init.exe -OutFile rustup-init.exe
.\rustup-init.exe -y
```

装完关掉 PowerShell 重新打开。

### 2. 开发调试

```powershell
cd win-emby
pnpm install
pnpm exec tauri-plugin-libmpv-api setup-lib
pnpm tauri dev
```

`setup-lib` 会把 MPV 要用的两个 dll 下载到 `src-tauri/lib/`（从 GitHub 下载，慢的话给终端开代理），只需要执行一次。

项目里已带 `.npmrc`（npmmirror）和 `src-tauri/.cargo/config.toml`（rsproxy），依赖默认走国内镜像。

### 3. 打安装包

```powershell
pnpm tauri build
```

安装包在 `src-tauri\target\release\bundle\nsis\Win-Emby_0.1.0_x64-setup.exe`。第一次打包 Tauri 会从 GitHub 下载 NSIS，卡住的话给终端开代理再试。

## 用 GitHub Actions 打包

推送到 `main` 分支会自动编译；也可以在 Actions 页手动运行 `build-windows`。

- 普通推送：安装包在这次运行页面底部的 Artifacts（`Win-Emby-setup`）里下载。
- 发布版本：打一个 `v` 开头的标签，安装包会自动挂到 Releases。

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 目录

```
src/emby/        Emby 接口、登录会话、DeviceProfile、hls.js 加载器
src/pages/       首页 / 媒体库 / 详情 / 播放 / 设置 / 登录 等
src/components/  外壳组件（标题栏、搜索、卡片、聚光卡…）
src/styles/      四套皮肤（沿用原项目）+ app.css（新增部分）
src-tauri/       Rust 壳：无边框透明窗口 + http 插件（直连局域网）+ libmpv 插件（内嵌 MPV）
```

## 说明

- MPV 内核直接读 Emby 的原文件，不经过服务器转码，局域网带宽要够跑原画。
- 切到「内置网页播放器」时，WebView2 解不了的片源（MKV、HEVC、DTS/AC3 音轨…）由 Emby 转封装或转码，服务器需要能正常调用 ffmpeg。
- 本项目是个人学习性质的开源实现，与 Emby 官方无隶属关系。Fork 二改请注明原项目 Win-box。

## 许可

MIT
