// Weave 的 Rust 侧只做几件事：
//   1. 创建窗口（桌面端无边框，配置见 tauri.conf.json）
//   2. 挂载 http 插件 —— 前端用它直连局域网 Emby，不受浏览器 CORS 限制
//   3. Windows 任务栏缩略图按钮（thumbbar.rs）
//   4. 桌面端记住窗口大小 / 位置（window-state 插件）
//   6. open_vlc：用本机 VLC 播放（MPV 读不了的直链兜底）
//   5. 桌面端挂载 libmpv 插件（HDR / 杜比视界）；安卓端 mpv 由 Kotlin 桥（MpvBridge）提供
mod ssdp;
mod thumbbar;

/// 用本机安装的 VLC 播放（电脑版）：先找默认安装位置，再退到 PATH 里的 vlc
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn open_vlc(url: String, start: f64, title: String) -> Result<(), String> {
    let mut cands: Vec<String> = Vec::new();
    #[cfg(windows)]
    {
        for k in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Ok(d) = std::env::var(k) {
                cands.push(format!("{}\\VideoLAN\\VLC\\vlc.exe", d));
                cands.push(format!("{}\\Programs\\VideoLAN\\VLC\\vlc.exe", d));
            }
        }
    }
    #[cfg(target_os = "macos")]
    cands.push("/Applications/VLC.app/Contents/MacOS/VLC".to_string());
    cands.push("vlc".to_string());
    let mut last = String::new();
    for c in cands {
        if c != "vlc" && !std::path::Path::new(&c).exists() { continue; }
        let mut cmd = std::process::Command::new(&c);
        cmd.arg(&url);
        if start > 1.0 { cmd.arg(format!("--start-time={}", start as u64)); }
        if !title.is_empty() { cmd.arg(format!("--meta-title={}", title)); }
        match cmd.spawn() {
            Ok(_) => return Ok(()),
            Err(e) => last = e.to_string(),
        }
    }
    Err(if last.is_empty() { "没找到 VLC，请先安装（默认位置即可）".to_string() } else { format!("启动 VLC 失败：{}", last) })
}
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
fn open_vlc(_url: String, _start: f64, _title: String) -> Result<(), String> { Err("手机版不支持".to_string()) }


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_http::init());

    #[cfg(desktop)]
    // 记住窗口的大小、位置和是否最大化（不记全屏：播放时全屏退出软件，下次不该直接全屏启动）
    let builder = builder
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .plugin(tauri_plugin_libmpv::init())
        .setup(|app| {
        // 明确设置窗口 / 任务栏图标（不依赖默认值，避免任务栏显示旧图标或默认图标）
        use tauri::Manager;
        if let Some(w) = app.get_webview_window("main") {
            if let Ok(img) = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png")) {
                let _ = w.set_icon(img.clone());
                // 窗口真正显示、状态恢复之后再设一次，避免 Alt+Tab / 任务栏拿到空白图标
                let app2 = app.handle().clone();
                std::thread::spawn(move || {
                    for ms in [600u64, 2000] {
                        std::thread::sleep(std::time::Duration::from_millis(ms));
                        if let Some(w2) = app2.get_webview_window("main") { let _ = w2.set_icon(img.clone()); }
                    }
                });
            }
        }
        Ok(())
    });

    builder
        .invoke_handler(tauri::generate_handler![thumbbar::thumb_init, thumbbar::thumb_playing, open_vlc, ssdp::ssdp_search])
        .run(tauri::generate_context!())
        .expect("启动 Weave 失败");
}
