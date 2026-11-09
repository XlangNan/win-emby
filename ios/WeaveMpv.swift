// iOS 端的 mpv 桥：MPVKit（libmpv + MoltenVK + VideoToolbox）。
// 做三件事：① 找到 Tauri 创建的 WKWebView 并设为透明；② 在它后面放一个 Metal 画面层，让 mpv 往里画；
// ③ 注册 weaveMpv 消息通道，给网页（src/lib/platform.ts 里的 iOS 桥）调用。
import UIKit
import WebKit
import AVFoundation
#if canImport(Libmpv)
import Libmpv
#elseif canImport(MPVKit)
import MPVKit
#endif

// MoltenVK 在尺寸异常（1x1）时会崩，照 MPVKit 官方示例忽略这类设置
final class MpvMetalLayer: CAMetalLayer {
    override var drawableSize: CGSize {
        get { super.drawableSize }
        set { if Int(newValue.width) > 1 && Int(newValue.height) > 1 { super.drawableSize = newValue } }
    }
    @available(iOS 16.0, *)
    override var wantsExtendedDynamicRangeContent: Bool {
        get { super.wantsExtendedDynamicRangeContent }
        set { if Thread.isMainThread { super.wantsExtendedDynamicRangeContent = newValue } else { DispatchQueue.main.sync { super.wantsExtendedDynamicRangeContent = newValue } } }
    }
}

final class MpvHostView: UIView {
    let metal = MpvMetalLayer()
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        isUserInteractionEnabled = false
        metal.contentsGravity = .resizeAspect
        metal.framebufferOnly = true
        metal.backgroundColor = UIColor.black.cgColor
        layer.addSublayer(metal)
    }
    required init?(coder: NSCoder) { fatalError() }
    override func layoutSubviews() {
        super.layoutSubviews()
        metal.frame = bounds
        metal.contentsScale = window?.screen.scale ?? UIScreen.main.scale
        metal.drawableSize = CGSize(width: bounds.width * metal.contentsScale, height: bounds.height * metal.contentsScale)
    }
}

@objc(WeaveBoot)
final class WeaveBoot: NSObject, WKScriptMessageHandlerWithReply {
    static let shared = WeaveBoot()
    @objc static func attach() { shared.tryAttach(0) }

    private weak var web: WKWebView?
    private var host: MpvHostView?
    private var mpv: OpaquePointer?
    private var savedBrightness: CGFloat?
    private let q = DispatchQueue(label: "weave.mpv")
    private var lastTime = -1.0, lastCache = -1.0

    // ───────── 找 WebView ─────────
    private func findWeb(_ v: UIView) -> WKWebView? {
        if let w = v as? WKWebView { return w }
        for s in v.subviews { if let w = findWeb(s) { return w } }
        return nil
    }
    private func tryAttach(_ n: Int) {
        let wins = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.windows }.flatMap { $0 }
        for w in wins { if let wk = findWeb(w) { setup(wk); return } }
        if n < 60 { DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.tryAttach(n + 1) } }
        else { NSLog("[Weave] 没找到 WKWebView") }
    }
    private func setup(_ wk: WKWebView) {
        web = wk
        wk.isOpaque = false
        wk.backgroundColor = .clear
        wk.scrollView.backgroundColor = .clear
        wk.scrollView.bounces = false
        wk.scrollView.contentInsetAdjustmentBehavior = .never
        wk.configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "weaveMpv")
        // 后台播放音乐 / 静音键不影响声音
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, options: [])
        try? AVAudioSession.sharedInstance().setActive(true)
        NSLog("[Weave] 已接管 WKWebView")
    }

    // ───────── 网页 → 原生 ─────────
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let d = m.body as? [String: Any], let op = d["op"] as? String else { replyHandler("参数错误", nil); return }
        switch op {
        case "init": replyHandler(initMpv(d["json"] as? String ?? "{}"), nil)
        case "destroy": destroyMpv(); replyHandler("ok", nil)
        case "command": replyHandler(command(d["json"] as? String ?? "[]"), nil)
        case "getProp": replyHandler(getProp(d["name"] as? String ?? "", d["type"] as? String ?? "string"), nil)
        case "fullscreen": UIApplication.shared.isIdleTimerDisabled = (d["on"] as? Bool) ?? false; replyHandler("ok", nil)
        case "brightness":
            if let v = d["v"] as? Double { if savedBrightness == nil { savedBrightness = UIScreen.main.brightness }; UIScreen.main.brightness = CGFloat(max(0.02, min(1, v))) }
            replyHandler("ok", nil)
        case "volume":
            if let v = d["v"] as? Double, mpv != nil { _ = command("[\"set\",\"volume\",\"\(Int(max(0, min(1, v)) * 100))\"]") }
            replyHandler("ok", nil)
        default: replyHandler("未知操作 \(op)", nil)
        }
    }

    // ───────── mpv ─────────
    private func initMpv(_ json: String) -> String {
        destroyMpv()
        guard let wk = web, let sup = wk.superview else { return "没找到 WebView（iOS 壳没接管成功）" }
        guard let data = json.data(using: .utf8), let cfg = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let opts = cfg["options"] as? [String: String] else { return "配置解析失败" }
        let h = MpvHostView(frame: sup.bounds)
        h.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        sup.insertSubview(h, belowSubview: wk)
        h.layoutIfNeeded()
        host = h
        guard let m = mpv_create() else { return "mpv_create 失败" }
        mpv = m
        var layerPtr = Unmanaged.passUnretained(h.metal).toOpaque()   // wid = CAMetalLayer 的指针值
        var err = mpv_set_option(m, "wid", MPV_FORMAT_INT64, &layerPtr)
        if err < 0 { return "设置 wid 失败：\(String(cString: mpv_error_string(err)))" }
        for (k, v) in opts {
            let e = mpv_set_option_string(m, k, v)
            if e < 0 { NSLog("[Weave] 选项 \(k)=\(v) 无效：\(String(cString: mpv_error_string(e)))") }
        }
        err = mpv_initialize(m)
        if err < 0 { destroyMpv(); return "MPV 初始化失败：\(String(cString: mpv_error_string(err)))" }
        if let obs = cfg["observed"] as? [[Any]] {
            for (i, o) in obs.enumerated() {
                guard let name = o.first as? String, o.count > 1, let t = o[1] as? String else { continue }
                mpv_observe_property(m, UInt64(i), name, fmt(t))
            }
        }
        mpv_set_wakeup_callback(m, { ctx in
            guard let ctx = ctx else { return }
            Unmanaged<WeaveBoot>.fromOpaque(ctx).takeUnretainedValue().drain()
        }, Unmanaged.passUnretained(self).toOpaque())
        UIApplication.shared.isIdleTimerDisabled = true
        emit("__ready", "true")
        return "ok"
    }
    private func fmt(_ t: String) -> mpv_format {
        switch t {
        case "flag": return MPV_FORMAT_FLAG
        case "int64": return MPV_FORMAT_INT64
        case "double": return MPV_FORMAT_DOUBLE
        default: return MPV_FORMAT_STRING
        }
    }
    private func destroyMpv() {
        if let m = mpv {
            mpv = nil
            mpv_set_wakeup_callback(m, nil, nil)
            mpv_terminate_destroy(m)
        }
        DispatchQueue.main.async {
            self.host?.removeFromSuperview()
            self.host = nil
            UIApplication.shared.isIdleTimerDisabled = false
            if let b = self.savedBrightness { UIScreen.main.brightness = b; self.savedBrightness = nil }
        }
        lastTime = -1; lastCache = -1
    }
    private func command(_ json: String) -> String {
        guard let m = mpv else { return "mpv 未初始化" }
        guard let d = json.data(using: .utf8), let a = try? JSONSerialization.jsonObject(with: d) as? [String] else { return "命令解析失败" }
        var c: [UnsafePointer<CChar>?] = a.map { UnsafePointer(strdup($0)) } + [nil]
        defer { for p in c { if let p = p { free(UnsafeMutableRawPointer(mutating: p)) } } }
        let e = mpv_command(m, &c)
        return e < 0 ? "命令失败：\(String(cString: mpv_error_string(e)))" : "ok"
    }
    private func getProp(_ name: String, _ type: String) -> String {
        guard let m = mpv else { return "null" }
        switch type {
        case "flag":
            var v: Int32 = 0
            return mpv_get_property(m, name, MPV_FORMAT_FLAG, &v) < 0 ? "null" : (v != 0 ? "true" : "false")
        case "int64":
            var v: Int64 = 0
            return mpv_get_property(m, name, MPV_FORMAT_INT64, &v) < 0 ? "null" : String(v)
        case "double":
            var v: Double = 0
            if mpv_get_property(m, name, MPV_FORMAT_DOUBLE, &v) < 0 || v.isNaN || v.isInfinite { return "null" }
            return String(v)
        default:
            guard let p = mpv_get_property_string(m, name) else { return "null" }
            defer { mpv_free(p) }
            return jsonQuote(String(cString: p))
        }
    }

    // ───────── mpv 事件 → 网页 ─────────
    private func drain() {
        q.async { [weak self] in
            guard let self = self else { return }
            while let m = self.mpv {
                guard let ev = mpv_wait_event(m, 0), ev.pointee.event_id != MPV_EVENT_NONE else { break }
                if ev.pointee.event_id == MPV_EVENT_PROPERTY_CHANGE, let p = ev.pointee.data?.assumingMemoryBound(to: mpv_event_property.self) {
                    self.onProp(p.pointee)
                }
            }
        }
    }
    private func onProp(_ p: mpv_event_property) {
        let name = String(cString: p.name)
        guard let data = p.data else { return emit(name, "null") }
        switch p.format {
        case MPV_FORMAT_FLAG: emit(name, data.assumingMemoryBound(to: Int32.self).pointee != 0 ? "true" : "false")
        case MPV_FORMAT_INT64: emit(name, String(data.assumingMemoryBound(to: Int64.self).pointee))
        case MPV_FORMAT_DOUBLE:
            let v = data.assumingMemoryBound(to: Double.self).pointee
            if v.isNaN || v.isInfinite { return emit(name, "null") }
            // time-pos / 缓冲进度很密，网页层每 0.25 秒更新一次足够
            if name == "time-pos" { if abs(v - lastTime) < 0.25 { return }; lastTime = v }
            else if name == "demuxer-cache-time" { if abs(v - lastCache) < 0.5 { return }; lastCache = v }
            emit(name, String(v))
        case MPV_FORMAT_STRING:
            if let cs = data.assumingMemoryBound(to: UnsafePointer<CChar>?.self).pointee { emit(name, jsonQuote(String(cString: cs))) } else { emit(name, "null") }
        default: emit(name, "null")
        }
    }
    private func jsonQuote(_ s: String) -> String {
        if let d = try? JSONSerialization.data(withJSONObject: [s], options: []), let t = String(data: d, encoding: .utf8) { return String(t.dropFirst().dropLast()) }
        return "\"\""
    }
    private func emit(_ name: String, _ valueJson: String) {
        let js = "window.__mpvEvt&&window.__mpvEvt(\(jsonQuote(name)),\(valueJson))"
        DispatchQueue.main.async { self.web?.evaluateJavaScript(js, completionHandler: nil) }
    }
}
