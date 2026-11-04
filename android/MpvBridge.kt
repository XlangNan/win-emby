package com.winemby.app

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
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
    // 这个版本的 libmpv 是「实例」接口：MPVLib.create(context) 返回实例，之后都调实例方法
    private var mpv: MPVLib? = null
    private val m: MPVLib get() = mpv ?: throw IllegalStateException("mpv 未初始化")

    // ───────── 初始化 / 销毁 ─────────
    @JavascriptInterface
    fun init(json: String): String {
        return try {
            release()
            val cfg = JSONObject(json)
            val opts = cfg.getJSONObject("options")
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
    }

    private fun tryAttach() {
        synchronized(lock) {
            if (!alive || !haveSurface || attached) return
            val s = sv?.holder?.surface ?: return
            try {
                m.attachSurface(s)
                m.setOptionString("force-window", "yes")
                m.setPropertyString("vo", "gpu")
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
            if (on) {
                WindowCompat.setDecorFitsSystemWindows(w, false)
                c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                c.hide(WindowInsetsCompat.Type.systemBars())
                val lp = w.attributes
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                w.attributes = lp
                act.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            } else {
                c.show(WindowInsetsCompat.Type.systemBars())
                WindowCompat.setDecorFitsSystemWindows(w, true)
                act.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
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

    @JavascriptInterface
    fun getBrightness(): Float {
        val b = act.window.attributes.screenBrightness
        return if (b < 0f) 0.5f else b
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
