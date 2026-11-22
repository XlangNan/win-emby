package com.weave.player

import android.app.Activity
import android.content.Context
import android.content.pm.ActivityInfo
import android.media.AudioManager
import android.provider.Settings
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONArray
import org.json.JSONObject
import __MPVLIB__

/**
 * 网页层 <-> libmpv 的桥。网页里通过 window.AndroidMpv.* 调用，事件通过 window.__mpvEvt(name, value) 回到网页。
 * 画面渲染在 WebView 下面的 SurfaceView 上（网页背景透明，控制层叠在上面）。
 */
class MpvBridge(private val act: Activity, private val web: WebView) : MPVLib.EventObserver, SurfaceHolder.Callback {
    private var sv: SurfaceView? = null
    private var alive = false
    private var haveSurface = false
    private var attached = false
    private var lastTime = -10.0
    private var lastCache = -10.0
    private val lock = Any()
    private var voName = "gpu"
    private val audio: AudioManager by lazy { act.getSystemService(Context.AUDIO_SERVICE) as AudioManager }

    companion object {
        /** 播放页全屏时为 true：此时不给内容区加系统栏留白 */
        @Volatile var fullscreen = false
        /** 手机主界面（底部标签栏那套）：网页铺到导航栏下面，导航栏区域不再留一条底色 */
        @Volatile var edgeBottom = false
    }
    // 这个版本的 libmpv 是「实例」接口：MPVLib.create(context) 返回实例，之后都调实例方法
    private var mpv: MPVLib? = null
    private val m: MPVLib get() = mpv ?: throw IllegalStateException("mpv 未初始化")

    // ───────── 初始化 / 销毁 ─────────
    @JavascriptInterface
    fun init(json: String): String {
        return try {
            release()
            boxTop = 0; boxH = 0
            val cfg = JSONObject(json)
            val opts = cfg.getJSONObject("options")
            voName = opts.optString("vo", "gpu")
            act.runOnUiThread { addSurface() }
            mpv = MPVLib.create(act.applicationContext)
            val keys = opts.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                m.setOptionString(k, opts.getString(k))
            }
            m.init()
            m.addObserver(this)
            val obs = cfg.getJSONArray("observed")
            for (i in 0 until obs.length()) {
                val o = obs.getJSONArray(i)
                m.observeProperty(o.getString(0), fmt(o.getString(1)))
            }
            synchronized(lock) { alive = true }
            act.runOnUiThread { act.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
            tryAttach()
            "ok"
        } catch (t: Throwable) {
            "MPV 初始化失败：$t"
        }
    }

    private fun fmt(t: String): Int = when (t) {
        "flag" -> 3
        "int64" -> 4
        "double" -> 5
        else -> 1
    }

    private fun addSurface() {
        if (sv != null) return
        val v = SurfaceView(act)
        v.holder.addCallback(this)
        val parent = web.parent as? ViewGroup ?: return
        parent.addView(v, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        sv = v
        applyBox()
    }

    // 直播竖屏：把画面视图限制在顶部一块（像素）；heightPx<=0 = 还原成铺满
    private var boxTop = 0
    private var boxH = 0

    @JavascriptInterface
    fun setVideoBox(topPx: Int, heightPx: Int) {
        boxTop = topPx
        boxH = heightPx
        act.runOnUiThread { applyBox() }
    }

    private fun applyBox() {
        val v = sv ?: return
        val lp = v.layoutParams as? ViewGroup.MarginLayoutParams ?: return
        lp.topMargin = if (boxH > 0) boxTop.coerceAtLeast(0) else 0
        lp.height = if (boxH > 0) boxH else ViewGroup.LayoutParams.MATCH_PARENT
        v.layoutParams = lp
    }

    private fun tryAttach() {
        synchronized(lock) {
            if (!alive || !haveSurface || attached) return
            val s = sv?.holder?.surface ?: return
            try {
                m.attachSurface(s)
                m.setOptionString("force-window", "yes")
                m.setPropertyString("vo", voName)
                attached = true
            } catch (_: Throwable) {
                return
            }
        }
        emit("__ready", "true")
    }

    override fun surfaceCreated(holder: SurfaceHolder) {
        haveSurface = true
        tryAttach()
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        if (alive && attached) {
            try { m.setPropertyString("android-surface-size", "${width}x$height") } catch (_: Throwable) {}
        }
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        haveSurface = false
        synchronized(lock) {
            if (alive && attached) {
                try {
                    m.setPropertyString("vo", "null")
                    m.setOptionString("force-window", "no")
                    m.detachSurface()
                } catch (_: Throwable) {}
            }
            attached = false
        }
    }

    @JavascriptInterface
    fun destroy() = release()

    fun release() {
        val wasAlive: Boolean
        synchronized(lock) {
            wasAlive = alive
            alive = false
        }
        if (wasAlive) {
            try { m.removeObserver(this) } catch (_: Throwable) {}
            try { m.destroy() } catch (_: Throwable) {}
            mpv = null
        }
        attached = false
        haveSurface = false
        act.runOnUiThread {
            sv?.let { (it.parent as? ViewGroup)?.removeView(it) }
            sv = null
            act.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }

    /** 切到后台时暂停，免得一直在后台出声 */
    fun pauseForBackground() {
        if (alive) try { m.setPropertyBoolean("pause", true) } catch (_: Throwable) {}
    }

    // ───────── 命令 / 属性 ─────────
    @JavascriptInterface
    fun command(json: String): String {
        return try {
            val a = JSONArray(json)
            m.command(Array(a.length()) { a.getString(it) })
            "ok"
        } catch (t: Throwable) {
            "命令失败：$t"
        }
    }

    @JavascriptInterface
    fun getProp(name: String, type: String): String {
        return try {
            when (type) {
                "flag" -> m.getPropertyBoolean(name)?.toString() ?: "null"
                "int64" -> m.getPropertyInt(name)?.toString() ?: "null"
                "double" -> m.getPropertyDouble(name)?.toString() ?: "null"
                else -> m.getPropertyString(name)?.let { JSONObject.quote(it) } ?: "null"
            }
        } catch (_: Throwable) {
            "null"
        }
    }

    // ───────── 窗口 ─────────
    @JavascriptInterface
    fun setFullscreen(on: Boolean) {
        act.runOnUiThread {
            val w = act.window
            val c = WindowInsetsControllerCompat(w, w.decorView)
            fullscreen = on
            if (on) {
                c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                c.hide(WindowInsetsCompat.Type.systemBars())
                val lp = w.attributes
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                w.attributes = lp
                act.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            } else {
                c.show(WindowInsetsCompat.Type.systemBars())
                // 离开播放页：还原手势改过的窗口亮度，回到系统亮度
                val lp = act.window.attributes
                lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                act.window.attributes = lp
                act.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            }
            ViewCompat.requestApplyInsets(act.findViewById(android.R.id.content))
        }
    }

    /** 窗口底色：系统栏（手势条）那一块没有网页内容，露出来的就是它；让它跟页面背景同色 */
    @JavascriptInterface
    fun setWindowBg(argb: Int) {
        act.runOnUiThread {
            try { act.window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(argb)) } catch (_: Throwable) { }
        }
    }

    /** 状态栏 / 导航栏图标颜色：浅色主题（白底）用深色图标，深色主题用浅色图标 */
    @JavascriptInterface
    fun setStatusBarLight(light: Boolean) {
        act.runOnUiThread {
            try {
                val c = WindowInsetsControllerCompat(act.window, act.window.decorView)
                c.isAppearanceLightStatusBars = light
                c.isAppearanceLightNavigationBars = light
                // 旧式标志位：部分国产 ROM 只认这个
                @Suppress("DEPRECATION")
                run {
                    val d = act.window.decorView
                    var f = d.systemUiVisibility
                    f = if (light) f or android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR else f and android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
                    d.systemUiVisibility = f
                }
                // 小米 / 澎湃 OS 自家接口（MIUI extraFlags：0x2 = 状态栏深色图标）
                try {
                    val cls = act.window.javaClass
                    val lp = Class.forName("android.view.MiuiWindowManager\$LayoutParams")
                    val bit = lp.getField("EXTRA_FLAG_STATUS_BAR_DARK_MODE").getInt(null)
                    cls.getMethod("setExtraFlags", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
                        .invoke(act.window, if (light) bit else 0, bit)
                } catch (_: Throwable) { }
            } catch (_: Throwable) { }
        }
    }

    @JavascriptInterface
    fun setBrightness(v: Float) {
        act.runOnUiThread {
            val lp = act.window.attributes
            lp.screenBrightness = if (v < 0f) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE else v.coerceIn(0.02f, 1f)
            act.window.attributes = lp
        }
    }

    /** 系统「媒体音量」0..1：应用里的音量手势直接调系统音量，和手机音量键一致 */
    @JavascriptInterface
    fun getSysVolume(): Float {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        return if (max > 0) audio.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / max else 0f
    }

    @JavascriptInterface
    fun setSysVolume(v: Float) {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(v.coerceIn(0f, 1f) * max), 0)
    }

    @JavascriptInterface
    fun getBrightness(): Float {
        val b = act.window.attributes.screenBrightness
        if (b >= 0f) return b
        // 没被手势改过：取系统当前亮度，第一次手势就不会突然跳变
        return try {
            Settings.System.getInt(act.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128) / 255f
        } catch (e: Exception) { 0.5f }
    }

    /** 状态栏 / 刘海高度（CSS px）；播放全屏时为 0 */
    @JavascriptInterface
    fun getInsetTop(): Float {
        if (fullscreen) return 0f
        val ins = ViewCompat.getRootWindowInsets(act.window.decorView)
            ?.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        return (ins?.top ?: 0) / act.resources.displayMetrics.density
    }

    /** 手机主界面打开：网页内容延伸到系统导航栏下面（导航栏透明），底部留白改由网页按 --sab 自己留 */
    @JavascriptInterface
    fun setEdgeBottom(on: Boolean) {
        edgeBottom = on
        act.runOnUiThread { try { act.findViewById<android.view.View>(android.R.id.content).requestApplyInsets() } catch (_: Throwable) { } }
    }

    /** 系统导航栏（手势条）的高度，单位 dp */
    @JavascriptInterface
    fun getInsetBottom(): Float {
        if (fullscreen) return 0f
        val ins = ViewCompat.getRootWindowInsets(act.window.decorView)
            ?.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        return (ins?.bottom ?: 0) / act.resources.displayMetrics.density
    }

    // ───────── 原生定时停止（网页被系统挂起时也能准点） ─────────
    private val sleepH = android.os.Handler(android.os.Looper.getMainLooper())
    private var sleepEnd = 0L
    private var sleepBase = -1.0
    private val sleepTick = object : Runnable {
        override fun run() {
            if (sleepEnd <= 0L) return
            val left = (sleepEnd - System.currentTimeMillis()) / 1000.0
            try {
                if (left <= 0) {
                    sleepEnd = 0L
                    if (alive) m.setPropertyBoolean("pause", true)
                    act.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    act.finishAndRemoveTask()
                    return
                }
                if (left <= 60 && alive) {
                    if (sleepBase < 0) sleepBase = m.getPropertyDouble("volume") ?: 100.0
                    m.command(arrayOf("set", "volume", (sleepBase * left / 60.0).toInt().toString()))
                }
            } catch (_: Throwable) {}
            sleepH.postDelayed(this, 1000)
        }
    }

    @JavascriptInterface
    fun setSleep(endAtMs: Long) {
        act.runOnUiThread {
            sleepH.removeCallbacks(sleepTick)
            if (sleepBase >= 0 && alive) { try { m.command(arrayOf("set", "volume", sleepBase.toInt().toString())) } catch (_: Throwable) {} }
            sleepBase = -1.0
            sleepEnd = endAtMs
            if (endAtMs > 0L) sleepH.post(sleepTick)
        }
    }

    @JavascriptInterface
    fun exit() {
        act.runOnUiThread { act.finish() }
    }

    // ───────── mpv 事件 → 网页 ─────────
    private fun emit(name: String, valueJson: String) {
        val js = "window.__mpvEvt&&window.__mpvEvt(${JSONObject.quote(name)},$valueJson)"
        web.post { web.evaluateJavascript(js, null) }
    }

    override fun eventProperty(property: String) = emit(property, "null")
    override fun eventProperty(property: String, value: Long) = emit(property, value.toString())
    override fun eventProperty(property: String, value: Boolean) = emit(property, value.toString())
    override fun eventProperty(property: String, value: String) = emit(property, JSONObject.quote(value))
    override fun eventProperty(property: String, value: Double) {
        if (value.isNaN() || value.isInfinite()) return emit(property, "null")
        // time-pos / 缓冲进度很密，网页层每 0.25 秒更新一次足够
        if (property == "time-pos") {
            if (kotlin.math.abs(value - lastTime) < 0.25) return
            lastTime = value
        } else if (property == "demuxer-cache-time") {
            if (kotlin.math.abs(value - lastCache) < 0.5) return
            lastCache = value
        }
        emit(property, value.toString())
    }
    override fun event(eventId: Int) {}
}
