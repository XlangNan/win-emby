// Win-Emby 的 Rust 侧只做两件事：
//   1. 创建无边框窗口（窗口配置见 tauri.conf.json）
//   2. 挂载 http 插件 —— 前端用它直连局域网 Emby，不受浏览器 CORS 限制
//   3. 挂载 libmpv 插件 —— 把 MPV 嵌进窗口，播放 HDR / 杜比视界
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_libmpv::init())
        .run(tauri::generate_context!())
        .expect("启动 Win-Emby 失败");
}
