// Windows 任务栏缩略图工具栏：鼠标移到任务栏图标上时，预览图下面出现 上一首 / 播放·暂停 / 下一首。
// 点击后给前端发 "thumb-click" 事件（payload: "prev" | "toggle" | "next"），由前端调用播放器。
// 非 Windows 平台只留空实现，前端调用不会报错。

#[cfg(windows)]
mod imp {
    use std::cell::RefCell;
    use std::sync::OnceLock;
    use tauri::{AppHandle, Emitter, Manager};
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{CreateBitmap, DeleteObject};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::UI::Shell::{
        DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THB_FLAGS, THB_ICON, THB_TOOLTIP, THBF_ENABLED, THUMBBUTTON,
    };
    use windows::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, RegisterWindowMessageW, HICON, ICONINFO, WM_COMMAND};

    const THBN_CLICKED: u32 = 0x1800;
    const ID_PREV: u32 = 100;
    const ID_TOGGLE: u32 = 101;
    const ID_NEXT: u32 = 102;

    static APP: OnceLock<AppHandle> = OnceLock::new();

    struct Tb {
        list: ITaskbarList3,
        hwnd: HWND,
        prev: HICON,
        play: HICON,
        pause: HICON,
        next: HICON,
        playing: bool,
        added: bool,
    }

    thread_local! { static TB: RefCell<Option<Tb>> = const { RefCell::new(None) }; }

    /// 画 32x32 的白色图标（ARGB）。kind: 0 上一首 1 播放 2 暂停 3 下一首
    fn make_icon(kind: u8) -> Option<HICON> {
        let mut px = [0u32; 32 * 32];
        let tri = |x: f32, y: f32, x0: f32, x1: f32| -> bool {
            // 指向右的三角形：左边 x0，尖端 x1，垂直中心 16，半高 9
            let (lo, hi) = if x1 > x0 { (x0, x1) } else { (x1, x0) };
            if x < lo || x > hi { return false; }
            let t = if x1 > x0 { (x - x0) / (x1 - x0) } else { (x0 - x) / (x0 - x1) };
            (y - 16.0).abs() <= 9.0 * (1.0 - t)
        };
        for yy in 0..32 {
            for xx in 0..32 {
                let (x, y) = (xx as f32 + 0.5, yy as f32 + 0.5);
                let on = match kind {
                    0 => (x >= 7.0 && x <= 10.0 && (y - 16.0).abs() <= 9.0) || tri(x, y, 24.0, 11.0),
                    1 => tri(x, y, 10.0, 25.0),
                    2 => ((x >= 9.0 && x <= 14.0) || (x >= 18.0 && x <= 23.0)) && (y - 16.0).abs() <= 9.0,
                    _ => (x >= 22.0 && x <= 25.0 && (y - 16.0).abs() <= 9.0) || tri(x, y, 8.0, 21.0),
                };
                if on { px[yy * 32 + xx] = 0xFFFF_FFFF; }
            }
        }
        unsafe {
            let color = CreateBitmap(32, 32, 1, 32, Some(px.as_ptr() as *const core::ffi::c_void));
            let mask = CreateBitmap(32, 32, 1, 1, None);
            let info = ICONINFO { fIcon: true.into(), xHotspot: 0, yHotspot: 0, hbmMask: mask, hbmColor: color };
            let icon = CreateIconIndirect(&info).ok();
            let _ = DeleteObject(color.into());
            let _ = DeleteObject(mask.into());
            icon
        }
    }

    fn tip(s: &str) -> [u16; 260] {
        let mut t = [0u16; 260];
        for (i, c) in s.encode_utf16().take(259).enumerate() { t[i] = c; }
        t
    }

    fn buttons(tb: &Tb) -> [THUMBBUTTON; 3] {
        let mask = THB_ICON | THB_TOOLTIP | THB_FLAGS;
        let mk = |id: u32, icon: HICON, t: &str| THUMBBUTTON { dwMask: mask, iId: id, iBitmap: 0, hIcon: icon, szTip: tip(t), dwFlags: THBF_ENABLED };
        [
            mk(ID_PREV, tb.prev, "上一首"),
            if tb.playing { mk(ID_TOGGLE, tb.pause, "暂停") } else { mk(ID_TOGGLE, tb.play, "播放") },
            mk(ID_NEXT, tb.next, "下一首"),
        ]
    }

    fn add_buttons() {
        TB.with(|c| {
            if let Some(tb) = c.borrow_mut().as_mut() {
                let b = buttons(tb);
                unsafe { if tb.list.ThumbBarAddButtons(tb.hwnd, &b).is_ok() { tb.added = true; } }
            }
        });
    }

    fn created_msg() -> u32 { unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) } }

    unsafe extern "system" fn subclass_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
        if msg == WM_COMMAND && (((wp.0 >> 16) & 0xffff) as u32) == THBN_CLICKED {
            let which = match (wp.0 & 0xffff) as u32 { ID_PREV => Some("prev"), ID_TOGGLE => Some("toggle"), ID_NEXT => Some("next"), _ => None };
            if let (Some(w), Some(app)) = (which, APP.get()) { let _ = app.emit("thumb-click", w); }
        } else if msg == created_msg() {
            TB.with(|c| { if let Some(tb) = c.borrow_mut().as_mut() { tb.added = false; } });
            add_buttons();
        }
        DefSubclassProc(hwnd, msg, wp, lp)
    }

    fn init_main(app: &AppHandle) {
        if TB.with(|c| c.borrow().is_some()) { add_buttons(); return; }
        let Some(w) = app.get_webview_window("main") else { return };
        let Ok(h) = w.hwnd() else { return };
        // tauri 内部的 windows 版本可能与这里不同，只取原始指针值
        let hwnd = HWND(h.0 as isize as *mut core::ffi::c_void);
        unsafe {
            let Ok(list) = CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_INPROC_SERVER) else { return };
            if list.HrInit().is_err() { return; }
            let (Some(prev), Some(play), Some(pause), Some(next)) = (make_icon(0), make_icon(1), make_icon(2), make_icon(3)) else { return };
            TB.with(|c| *c.borrow_mut() = Some(Tb { list, hwnd, prev, play, pause, next, playing: false, added: false }));
            let _ = SetWindowSubclass(hwnd, Some(subclass_proc), 0xA11CE, 0);
        }
        add_buttons();
    }

    fn set_playing_main(playing: bool) {
        TB.with(|c| {
            if let Some(tb) = c.borrow_mut().as_mut() {
                tb.playing = playing;
                if tb.added {
                    let b = buttons(tb);
                    unsafe { let _ = tb.list.ThumbBarUpdateButtons(tb.hwnd, &b); }
                }
            }
        });
    }

    pub fn init(app: AppHandle) {
        let _ = APP.set(app.clone());
        let a = app.clone();
        let _ = app.run_on_main_thread(move || init_main(&a));
    }
    pub fn playing(app: AppHandle, p: bool) {
        let _ = app.run_on_main_thread(move || set_playing_main(p));
    }
}

#[cfg(windows)]
#[tauri::command]
pub fn thumb_init(app: tauri::AppHandle) { imp::init(app); }
#[cfg(windows)]
#[tauri::command]
pub fn thumb_playing(app: tauri::AppHandle, playing: bool) { imp::playing(app, playing); }

#[cfg(not(windows))]
#[tauri::command]
pub fn thumb_init() {}
#[cfg(not(windows))]
#[tauri::command]
pub fn thumb_playing(_playing: bool) {}
